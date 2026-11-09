// Read-only check: compares what the app has stored (daily_line_items) against what QuickBooks's
// ProfitAndLoss report (cash basis, same as the sync) returns for the same dates, account by
// account. Prints only accounts that differ, plus QuickBooks accounts the app has no local row for.
// Nothing is written except a refreshed OAuth token, which QuickBooks rotates on every refresh
// (same as the backfill script).
//
//   node scripts/diff-qbo-pl.mjs [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--category=cogs]
//
// Run in production inside the container (the QBO credentials are in its environment):
//   fly ssh console -a restaurant-pulse -C "node scripts/diff-qbo-pl.mjs --since=2026-01-01 --category=cogs"
// Defaults: --since = Jan 1 of this year, --until = yesterday. OAuth/fetch helpers are a deliberate
// duplicate of scripts/backfill-qbo-pl.mjs (plain node can't import server/utils/qbo.ts).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { reportToLineItems } from '../server/utils/qbo-pl-parse.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')
if (!existsSync(dbPath)) { console.error(`Database not found at ${dbPath}`); process.exit(1) }

const { QBO_ENVIRONMENT, QBO_CLIENT_ID, QBO_CLIENT_SECRET } = process.env
if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) { console.error('Missing QBO_CLIENT_ID / QBO_CLIENT_SECRET in the environment.'); process.exit(1) }
const environment = QBO_ENVIRONMENT || 'sandbox'
const apiBase = environment === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'
const TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const isoDate = d => d.toISOString().slice(0, 10)
const now0 = new Date()
const yesterday = new Date(now0); yesterday.setUTCDate(yesterday.getUTCDate() - 1)
const since = args.since || `${now0.getUTCFullYear()}-01-01`
const until = args.until || isoDate(yesterday)
const onlyCategory = args.category && args.category !== true ? String(args.category) : null
if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || since > until) { console.error('Bad --since/--until'); process.exit(1) }

function monthChunks(sinceISO, untilISO) {
  const chunks = []
  const end = new Date(`${untilISO}T00:00:00Z`)
  let cursor = new Date(`${sinceISO}T00:00:00Z`)
  while (cursor <= end) {
    const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth()
    const monthEnd = new Date(Date.UTC(y, m + 1, 0))
    chunks.push({ start: isoDate(cursor), end: isoDate(monthEnd > end ? end : monthEnd) })
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
  // Cash basis — must match server/utils/qbo-pl-sync.ts's own accounting_method,
  // or a re-backfilled range would disagree with what the nightly sync writes.
  const params = new URLSearchParams({ start_date: start, end_date: end, summarize_column_by: 'Days', accounting_method: 'Cash' })
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


const chunks = monthChunks(since, until)
console.log(`Comparing ${since}..${until} (${environment}, cash basis) in ${chunks.length} month chunk(s)...`)
let tokenRow = loadTokenRow()
const realmId = tokenRow.realm_id
const qboTotals = new Map() // qboAccountId -> amount
for (const { start, end } of chunks) {
  const accessToken = await getValidAccessToken(tokenRow)
  tokenRow = db.prepare('SELECT * FROM qbo_tokens WHERE id = 1').get()
  const report = await fetchReportWithRetry(accessToken, realmId, start, end)
  for (const item of reportToLineItems(report)) qboTotals.set(item.qboAccountId, (qboTotals.get(item.qboAccountId) ?? 0) + item.amount)
  await new Promise(r => setTimeout(r, 700))
}

const accounts = db.prepare('SELECT id, qbo_account_id AS qboId, account_number AS num, name, category, is_active AS active FROM accounts').all()
const localTotals = new Map(db.prepare('SELECT account_id AS id, SUM(amount) AS total FROM daily_line_items WHERE date BETWEEN ? AND ? GROUP BY account_id').all(since, until).map(r => [r.id, r.total]))
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const rows = []
const byQbo = new Map(accounts.filter(a => a.qboId).map(a => [a.qboId, a]))
for (const [qboId, qbo] of qboTotals) {
  const a = byQbo.get(qboId)
  if (!a) { rows.push({ category: '(no local account)', num: '', name: `QBO account id ${qboId}`, active: '', qbo, local: 0 }); continue }
  rows.push({ category: a.category, num: a.num ?? '', name: a.name, active: a.active ? 'yes' : 'NO', qbo, local: localTotals.get(a.id) ?? 0 })
}
for (const a of accounts) {
  if (a.qboId && qboTotals.has(a.qboId)) continue
  const local = localTotals.get(a.id) ?? 0
  if (Math.abs(local) > 0.005) rows.push({ category: a.category, num: a.num ?? '', name: a.name, active: a.active ? 'yes' : 'NO', qbo: 0, local })
}
const diffs = rows.filter(r => Math.abs(r.qbo - r.local) > 0.005 && (!onlyCategory || r.category === onlyCategory || r.category.startsWith('('))).sort((x, y) => Math.abs(y.qbo - y.local) - Math.abs(x.qbo - x.local))

const cat = new Map()
for (const r of rows) { const c = cat.get(r.category) ?? { qbo: 0, local: 0 }; c.qbo += r.qbo; c.local += r.local; cat.set(r.category, c) }
console.log('\nCategory totals (QuickBooks vs app):')
for (const [c, t] of [...cat].sort()) console.log(`  ${c.padEnd(20)} QBO ${money(t.qbo).padStart(14)}  app ${money(t.local).padStart(14)}  diff ${money(t.local - t.qbo).padStart(12)}`)
console.log(`\nAccounts that differ${onlyCategory ? ` (category ${onlyCategory})` : ''}: ${diffs.length}`)
for (const r of diffs) console.log(`  ${String(r.category).padEnd(14)} ${String(r.num).padEnd(6)} ${r.name.slice(0, 40).padEnd(40)} active:${String(r.active).padEnd(3)} QBO ${money(r.qbo).padStart(13)}  app ${money(r.local).padStart(13)}  diff ${money(r.local - r.qbo).padStart(12)}`)
db.close()
