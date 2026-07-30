// One-time historical backfill: pulls Toast's Orders (numberOfGuests) and
// Labor (timeEntries) APIs, one business date at a time, and upserts into
// daily_toast_metrics. Not part of the nightly sync — run by hand:
//
//   npm run db:backfill-toast -- [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--delay-ms=500]
//
// Defaults: --since = 2 years before today, --until = yesterday (same
// defaults as backfill-qbo-pl.mjs, for consistency — not a claim that
// Toast necessarily has 2 full years of data; see the "quiet days" note
// below).
//
// Chunked one calendar day at a time (not a date-range request) since
// that's how Toast's ordersBulk/timeEntries endpoints are shaped
// (businessDate is a single-day filter, unlike QBO's Reports API which
// accepts a date range). Idempotent (ON CONFLICT DO UPDATE) and
// day-transactional, so an interrupted run can just be re-invoked with the
// same flags.
//
// Deliberately does NOT write sync_runs, for the same reason
// backfill-qbo-pl.mjs doesn't — that table exists for nightly-freshness
// UI tracking, and a one-time bulk load's rows_synced would misrepresent
// "last synced" if a future query ever does ORDER BY started_at DESC
// LIMIT 1. Progress goes to console instead.
//
// Auth logic below is a small, deliberate duplicate of
// server/utils/toast.ts, not an import — same Node-22-can't-reliably-
// strip-TypeScript reason as backfill-qbo-pl.mjs's duplication of qbo.ts.
// Keep this in sync by hand if toast.ts's login/retry behavior changes.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
  process.exit(1)
}

const { TOAST_API_HOSTNAME, TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID } = process.env
if (!TOAST_API_HOSTNAME || !TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET || !TOAST_RESTAURANT_GUID) {
  console.error('Missing one of TOAST_API_HOSTNAME / TOAST_CLIENT_ID / TOAST_CLIENT_SECRET / TOAST_RESTAURANT_GUID (run via: node --env-file=.env.local scripts/backfill-toast-metrics.mjs).')
  process.exit(1)
}
const HOST = TOAST_API_HOSTNAME

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
const delayMs = args['delay-ms'] ? Number(args['delay-ms']) : 500

if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
  console.error(`--since/--until must be YYYY-MM-DD. Got since=${since} until=${until}`)
  process.exit(1)
}
if (since > until) {
  console.error(`--since (${since}) must not be after --until (${until})`)
  process.exit(1)
}

function isoDaysInRange(sinceISO, untilISO) {
  const days = []
  const untilD = new Date(`${untilISO}T00:00:00Z`)
  let cursor = new Date(`${sinceISO}T00:00:00Z`)
  while (cursor <= untilD) {
    days.push(isoDate(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

// Cached like toast.ts's tokenCache, but re-login is just re-called on a
// 401 rather than tracked with a decay buffer — a single backfill run
// re-authenticating occasionally isn't worth the extra state.
let cachedToken = null

async function login() {
  const res = await fetch(`${HOST}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: TOAST_CLIENT_ID,
      clientSecret: TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT'
    })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Toast login failed: ${res.status} ${JSON.stringify(body)}`)
  }
  cachedToken = body.token.accessToken
  return cachedToken
}

async function fetchAllPages(path, businessDate, retries = 2) {
  const results = []
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const url = `${HOST}${path}${sep}businessDate=${businessDate}&page=${page}&pageSize=100`
    let res
    for (let attempt = 0; ; attempt++) {
      const token = cachedToken ?? await login()
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': TOAST_RESTAURANT_GUID }
      })
      if (res.status === 401) {
        cachedToken = null
        if (attempt < retries) continue
      }
      if (!res.ok && res.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, 300 * 2 ** attempt))
        continue
      }
      break
    }
    if (!res.ok) {
      throw new Error(`${path} failed for ${businessDate}: ${res.status} ${await res.text()}`)
    }
    const body = await res.json()
    if (!Array.isArray(body) || body.length === 0) break
    results.push(...body)
    if (body.length < 100) break
  }
  return results
}

const db = new Database(dbPath)
const upsert = db.prepare(`
  INSERT INTO daily_toast_metrics (date, covers, labor_hours, synced_at)
  VALUES (@date, @covers, @laborHours, @syncedAt)
  ON CONFLICT(date) DO UPDATE SET covers = excluded.covers, labor_hours = excluded.labor_hours, synced_at = excluded.synced_at
`)

const days = isoDaysInRange(since, until)
console.log(`Backfilling ${days.length} day(s) from ${since} to ${until}...`)

let totalDaysWritten = 0
let quietStreak = 0
let maxQuietStreak = 0

for (const isoDay of days) {
  const businessDate = isoDay.replace(/-/g, '')
  let orders, timeEntries
  try {
    orders = await fetchAllPages('/orders/v2/ordersBulk', businessDate)
    timeEntries = await fetchAllPages('/labor/v1/timeEntries', businessDate)
  } catch (err) {
    console.error(`${isoDay}: FAILED — ${err.message}`)
    console.error('Stopping here — re-run with the same --since to resume (upserts are idempotent, already-written days are safely re-written).')
    process.exit(1)
  }

  const covers = orders.filter(o => !o.deleted).reduce((sum, o) => sum + (o.numberOfGuests ?? 0), 0)
  const laborHours = timeEntries.reduce((sum, te) => sum + (te.regularHours ?? 0) + (te.overtimeHours ?? 0), 0)

  // A day with zero orders AND zero time entries is either a real closed
  // day (Urban Hearth is closed Mondays — see CLAUDE.md) or a day before
  // this Toast account had data at all (e.g. before the restaurant's 2026
  // move, or before Toast was live). Both look identical from the API, so
  // this can't distinguish them — it just tracks the longest run of quiet
  // days so the summary below can flag it for a human to judge, rather
  // than silently writing what might be a meaningless zero.
  if (orders.length === 0 && timeEntries.length === 0) {
    quietStreak++
    maxQuietStreak = Math.max(maxQuietStreak, quietStreak)
  } else {
    quietStreak = 0
  }

  db.transaction(() => {
    upsert.run({ date: isoDay, covers, laborHours, syncedAt: new Date().toISOString() })
  })()
  totalDaysWritten++
  console.log(`${isoDay}: covers=${covers} laborHours=${laborHours.toFixed(2)}${orders.length === 0 && timeEntries.length === 0 ? ' (quiet — no orders or time entries)' : ''}`)

  await new Promise(r => setTimeout(r, delayMs))
}

console.log(`Done. ${totalDaysWritten} day(s) written.${maxQuietStreak >= 14 ? ` Longest quiet streak: ${maxQuietStreak} consecutive days with no orders/time entries — worth checking whether Toast genuinely had no data that far back (e.g. before this account/location went live) rather than trusting those as real zero-cover days.` : ''}`)
db.close()
