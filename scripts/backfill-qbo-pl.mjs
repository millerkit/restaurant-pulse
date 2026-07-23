// One-time historical backfill: pulls QBO ProfitAndLoss reports
// (summarize_column_by=Days), month by month, and upserts into
// daily_line_items. Not part of the nightly sync — run by hand:
//
//   npm run db:backfill-pl -- [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--delay-ms=1000]
//
// Defaults: --since = 2 years before today, --until = yesterday.
//
// Prerequisite: at least one account sync must already have run (via
// POST /api/qbo/sync, or letting server/plugins/qbo-nightly-sync.ts fire
// once) so accounts.qbo_account_id is populated — this script only
// matches against qbo_account_ids that already exist locally; it does not
// duplicate the account-sync/categorization logic.
//
// Chunked month-by-month (not one multi-year request) since QBO's Reports
// API isn't reliable over very wide summarize_column_by=Days ranges in a
// single call. Idempotent (ON CONFLICT DO UPDATE) and chunk-transactional,
// so an interrupted run can just be re-invoked with the same flags.
//
// Deliberately does NOT write sync_runs — that table's purpose (see its
// own schema.sql comment) is nightly-freshness tracking for the "last
// synced from QuickBooks" UI signal; a one-time bulk historical load isn't
// part of that story, and its rows_synced (likely tens of thousands of
// rows) could get misread as "the last sync" if a future query ever just
// does ORDER BY started_at DESC LIMIT 1. Progress goes to console instead,
// matching import-budget-xlsx.mjs's reporting style.
//
// OAuth/token-refresh handling below is a small, deliberate duplicate of
// server/utils/qbo.ts, not an import: this script runs via plain `node`
// against the production Fly volume (see CLAUDE.md's db:init note about
// running scripts inside the container via `fly ssh console`), and the
// production Docker image is node:22-bookworm-slim — Node 22 doesn't
// reliably strip TypeScript without a build step, so a .ts file can't be
// safely imported here regardless of dependency-injection tricks. Keep
// this in sync by hand with qbo.ts's requestToken/qboFetch/qboFaultType
// behavior (Fault-with-200 detection, single-use refresh token rotation)
// if that file ever changes.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { reportToLineItems } from '../server/utils/qbo-pl-parse.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
  process.exit(1)
}

const { QBO_ENVIRONMENT, QBO_CLIENT_ID, QBO_CLIENT_SECRET } = process.env
if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) {
  console.error('Missing QBO_CLIENT_ID / QBO_CLIENT_SECRET in the environment (run via: node --env-file=.env.local scripts/backfill-qbo-pl.mjs).')
  process.exit(1)
}
const environment = QBO_ENVIRONMENT || 'sandbox'
const apiBase = environment === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'
// Intuit's long-stable token endpoint — same fallback constant qbo.ts uses
// when its own discovery-document fetch fails. Not worth duplicating the
// discovery-document caching machinery for a short-lived batch script.
const TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

function parseArgs(argv) {
  const args = {}
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=')
    args[key] = value ?? true
  }
  return args
}
const args = parseArgs(process.argv.slice(2))

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}
const today = new Date()
const twoYearsAgo = new Date(today)
twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2)
const yesterday = new Date(today)
yesterday.setUTCDate(yesterday.getUTCDate() - 1)

const since = args.since || isoDate(twoYearsAgo)
const until = args.until || isoDate(yesterday)
const delayMs = args['delay-ms'] ? Number(args['delay-ms']) : 1000

if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
  console.error(`--since/--until must be YYYY-MM-DD. Got since=${since} until=${until}`)
  process.exit(1)
}
if (since > until) {
  console.error(`--since (${since}) must not be after --until (${until})`)
  process.exit(1)
}

function monthChunks(sinceISO, untilISO) {
  const chunks = []
  const until = new Date(`${untilISO}T00:00:00Z`)
  let cursor = new Date(`${sinceISO}T00:00:00Z`)
  while (cursor <= until) {
    const y = cursor.getUTCFullYear()
    const m = cursor.getUTCMonth()
    const monthStart = new Date(Date.UTC(y, m, 1))
    const monthEnd = new Date(Date.UTC(y, m + 1, 0))
    const start = cursor > monthStart ? cursor : monthStart
    const end = monthEnd > until ? until : monthEnd
    chunks.push({ start: isoDate(start), end: isoDate(end) })
    cursor = new Date(Date.UTC(y, m + 1, 1))
  }
  return chunks
}

const db = new Database(dbPath)

function loadTokenRow() {
  const row = db.prepare('SELECT * FROM qbo_tokens WHERE id = 1').get()
  if (!row) {
    console.error('QBO is not connected (no qbo_tokens row) — visit /api/qbo/connect first.')
    process.exit(1)
  }
  return row
}

function saveTokenRow(realmId, tokens) {
  const now = new Date()
  const accessExpiresAt = new Date(now.getTime() + tokens.expires_in * 1000).toISOString()
  const refreshExpiresAt = new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString()
  db.prepare(`
    UPDATE qbo_tokens SET access_token = ?, refresh_token = ?, access_token_expires_at = ?, refresh_token_expires_at = ?, updated_at = ?
    WHERE id = 1
  `).run(tokens.access_token, tokens.refresh_token, accessExpiresAt, refreshExpiresAt, now.toISOString())
}

async function refreshAccessToken(tokenRow) {
  const basicAuth = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64')
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenRow.refresh_token })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`QBO token refresh failed: ${res.status} ${JSON.stringify(json)}`)
  }
  saveTokenRow(tokenRow.realm_id, json)
  return json.access_token
}

// Proactive refresh (2min buffer, matching qbo.ts's getValidAccessToken),
// re-checked before each chunk rather than only once at start — a full
// 2-year backfill can run long enough to cross an access-token expiry
// (~1hr).
async function getValidAccessToken(tokenRow) {
  const bufferMs = 2 * 60 * 1000
  if (Date.now() < new Date(tokenRow.access_token_expires_at).getTime() - bufferMs) {
    return tokenRow.access_token
  }
  return await refreshAccessToken(tokenRow)
}

function qboFaultType(body) {
  return body?.Fault ? (body.Fault.type ?? 'Fault') : null
}

async function fetchReportWithRetry(accessToken, realmId, start, end, retries = 2) {
  const params = new URLSearchParams({ start_date: start, end_date: end, summarize_column_by: 'Days' })
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${apiBase}/v3/company/${realmId}/reports/ProfitAndLoss?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    })
    const body = await res.json().catch(() => ({}))
    const faultType = qboFaultType(body)
    if (res.ok && !faultType) return body
    const transient = res.status >= 500 && !faultType
    if (!transient || attempt === retries) {
      throw new Error(`QBO ProfitAndLoss request failed (${start}..${end}): status=${res.status}${faultType ? ` fault=${faultType}` : ''} body=${JSON.stringify(body)}`)
    }
    await new Promise(r => setTimeout(r, 300 * 2 ** attempt))
  }
}

const accountsByQboId = new Map(
  db.prepare('SELECT id, qbo_account_id FROM accounts WHERE qbo_account_id IS NOT NULL').all()
    .map(r => [r.qbo_account_id, r.id])
)
if (accountsByQboId.size === 0) {
  console.error('No accounts have a qbo_account_id yet — run an account sync first (POST /api/qbo/sync, or let the nightly plugin fire once).')
  process.exit(1)
}

const upsert = db.prepare(`
  INSERT INTO daily_line_items (date, account_id, amount) VALUES (@date, @accountId, @amount)
  ON CONFLICT(date, account_id) DO UPDATE SET amount = excluded.amount
`)

const chunks = monthChunks(since, until)
console.log(`Backfilling ${chunks.length} month-chunk(s) from ${since} to ${until} (${environment})...`)

let tokenRow = loadTokenRow()
const realmId = tokenRow.realm_id
let totalWritten = 0
const allUnmatched = new Set()

for (const { start, end } of chunks) {
  const accessToken = await getValidAccessToken(tokenRow)
  tokenRow = db.prepare('SELECT * FROM qbo_tokens WHERE id = 1').get() // pick up any refresh just performed

  let report
  try {
    report = await fetchReportWithRetry(accessToken, realmId, start, end)
  } catch (err) {
    console.error(`${start}..${end}: FAILED — ${err.message}`)
    console.error('Stopping here — re-run with the same --since to resume (upserts are idempotent, already-written months are safely re-written).')
    process.exit(1)
  }

  const items = reportToLineItems(report)
  const unmatched = new Set()
  const written = db.transaction((rows) => {
    let n = 0
    for (const item of rows) {
      const accountId = accountsByQboId.get(item.qboAccountId)
      if (!accountId) { unmatched.add(item.qboAccountId); continue }
      upsert.run({ date: item.date, accountId, amount: item.amount })
      n++
    }
    return n
  })(items)

  totalWritten += written
  unmatched.forEach(id => allUnmatched.add(id))
  console.log(`${start}..${end}: wrote ${written} row(s)${unmatched.size ? `, ${unmatched.size} unmatched QBO account id(s): ${[...unmatched].join(', ')}` : ''}`)

  await new Promise(r => setTimeout(r, delayMs))
}

console.log(`Done. Total rows written: ${totalWritten}.${allUnmatched.size ? ` ${allUnmatched.size} distinct unmatched QBO account id(s) across the whole run: ${[...allUnmatched].join(', ')} — run an account sync and re-invoke to pick these up.` : ''}`)
db.close()
