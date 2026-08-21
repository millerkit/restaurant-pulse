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

// See MAX_PLAUSIBLE_GUESTS_PER_ORDER's comment in server/utils/toast-metrics-sync.ts
const MAX_PLAUSIBLE_GUESTS_PER_ORDER = 50

// See MIN_DINNER_HOUR_LOCAL's comment in server/utils/toast-metrics-sync.ts
const MIN_DINNER_HOUR_LOCAL = 17
const RESTAURANT_TIME_ZONE = 'America/New_York'
function isDinnerHour(openedDateIso) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: RESTAURANT_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date(openedDateIso)))
  return hour >= MIN_DINNER_HOUR_LOCAL
}

// See server/utils/toast-table-map.ts for the full rationale — duplicated
// here for the same Node-22 reason as the rest of this file.
const NUMERIC_RANGES = [
  { min: 1, max: 19, area: 'dining room' },
  { min: 20, max: 29, area: 'dining room' },
  { min: 30, max: 49, area: 'salon' },
  { min: 50, max: 59, area: 'outdoor' }
]
function classifyTableName(name) {
  if (!name) return null
  const trimmed = name.trim()
  if (/^B\d+$/i.test(trimmed)) return 'bar'
  if (/^C\d+$/i.test(trimmed)) return 'chefs counter'
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    const match = NUMERIC_RANGES.find(r => n >= r.min && n <= r.max)
    return match?.area ?? null
  }
  return null
}

// See CHEFS_COUNTER_FOOD_PRICE_PER_COVER's comment in
// server/utils/toast-metrics-sync.ts — duplicated here for the same
// Node-22 reason as the rest of this file.
const CHEFS_COUNTER_FOOD_PRICE_PER_COVER = 190
const CHEFS_COUNTER_FOOD_ITEM_NAMES = new Set(["Day Of Chef's Counter", "Pre-Paid Chef's Counter"])
function chefsCounterBeverageTotal(checks) {
  return (checks ?? [])
    .filter(c => !c.voided)
    .flatMap(c => c.selections ?? [])
    .filter(s => !s.voided && !CHEFS_COUNTER_FOOD_ITEM_NAMES.has(s.displayName ?? ''))
    .reduce((sum, s) => sum + (s.receiptLinePrice ?? s.price ?? 0), 0)
}

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
const upsertArea = db.prepare(`
  INSERT INTO daily_toast_area_metrics (date, area_id, covers, revenue, food_revenue, beverage_revenue, synced_at)
  VALUES (@date, @areaId, @covers, @revenue, @foodRevenue, @beverageRevenue, @syncedAt)
  ON CONFLICT(date, area_id) DO UPDATE SET covers = excluded.covers, revenue = excluded.revenue, food_revenue = excluded.food_revenue, beverage_revenue = excluded.beverage_revenue, synced_at = excluded.synced_at
`)
const areaIdByName = new Map(db.prepare('SELECT id, name FROM capacity_areas').all().map(r => [r.name, r.id]))

// Table config (name per guid) is fetched once, not per-day — a physical
// floor plan doesn't change day to day, and re-fetching 700+ times for a
// multi-year backfill would be wasteful. Requires the TOAST_* credential
// to have Configuration API scope (granted 2026-08-13 — see
// server/utils/toast-table-map.ts); falls back to skipping per-area
// metrics entirely (with a warning) if that scope isn't present, so a
// credential without it doesn't fail the whole-restaurant backfill.
let tableAreaMap = new Map()
try {
  const token = cachedToken ?? await login()
  const res = await fetch(`${HOST}/config/v2/tables`, {
    headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': TOAST_RESTAURANT_GUID }
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const tables = await res.json()
  const unclassified = new Set()
  for (const t of tables) {
    const area = classifyTableName(t.name)
    tableAreaMap.set(t.guid, area)
    if (!area) unclassified.add(t.name)
  }
  if (unclassified.size > 0) {
    console.warn(`${unclassified.size} Toast table(s) didn't match a known naming pattern, excluded from per-area metrics: ${[...unclassified].join(', ')}`)
  }
  console.log(`Loaded ${tables.length} Toast table(s) for per-area classification.`)
} catch (err) {
  console.warn(`Could not fetch /config/v2/tables (${err.message}) — per-area metrics will be skipped for this run, whole-restaurant covers/labor still backfilled.`)
}

// See fetchSalariedJobGuids's comment in server/utils/toast-metrics-sync.ts
// — duplicated here for the same Node-22 reason as the rest of this file.
// Fetched once up front, not per day: a restaurant's job list doesn't
// change day to day, same reasoning as the table map above.
let salariedJobGuids = new Set()
{
  const token = cachedToken ?? await login()
  const res = await fetch(`${HOST}/labor/v1/jobs`, {
    headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': TOAST_RESTAURANT_GUID }
  })
  if (!res.ok) {
    console.error(`Could not fetch /labor/v1/jobs (${res.status} ${await res.text()}) — cannot safely exclude salaried staff from labor hours, aborting.`)
    process.exit(1)
  }
  const jobs = await res.json()
  salariedJobGuids = new Set(jobs.filter(j => j.wageFrequency === 'SALARY').map(j => j.guid))
  console.log(`Loaded ${jobs.length} Toast job(s), ${salariedJobGuids.size} salaried (excluded from labor hours).`)
}

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

  // See MAX_PLAUSIBLE_GUESTS_PER_ORDER in server/utils/toast-metrics-sync.ts
  // for why this cap exists (a handful of otherwise-normal orders carry an
  // implausible numberOfGuests — a staff data-entry slip, confirmed against
  // the live API, not a CSV-export artifact) — duplicated here for the same
  // Node-22-can't-reliably-strip-TypeScript reason as the rest of this file.
  const covers = orders.filter(o => !o.deleted && isDinnerHour(o.openedDate)).reduce((sum, o) => {
    const guests = o.numberOfGuests ?? 0
    if (guests > MAX_PLAUSIBLE_GUESTS_PER_ORDER) {
      console.warn(`  dropping implausible numberOfGuests=${guests} on order ${o.guid} (${isoDay})`)
      return sum
    }
    return sum + guests
  }, 0)
  const laborHours = timeEntries
    .filter(te => !salariedJobGuids.has(te.jobReference?.guid ?? ''))
    .reduce((sum, te) => sum + (te.regularHours ?? 0) + (te.overtimeHours ?? 0), 0)

  const perArea = new Map()
  if (tableAreaMap.size > 0) {
    for (const o of orders) {
      if (o.deleted || !isDinnerHour(o.openedDate)) continue
      const guests = o.numberOfGuests ?? 0
      if (guests > MAX_PLAUSIBLE_GUESTS_PER_ORDER) continue
      const areaName = o.table ? tableAreaMap.get(o.table.guid) : null
      if (!areaName) continue
      const entry = perArea.get(areaName) ?? { covers: 0, revenue: 0, foodRevenue: areaName === 'chefs counter' ? 0 : null, beverageRevenue: areaName === 'chefs counter' ? 0 : null }
      entry.covers += guests
      if (areaName === 'chefs counter') {
        const foodRevenue = guests * CHEFS_COUNTER_FOOD_PRICE_PER_COVER
        const beverageRevenue = chefsCounterBeverageTotal(o.checks)
        entry.foodRevenue += foodRevenue
        entry.beverageRevenue += beverageRevenue
        entry.revenue += foodRevenue + beverageRevenue
      } else {
        // See the comment in server/utils/toast-metrics-sync.ts on
        // check.amount (pre-tax, pre-tip) vs. check.totalAmount (amount +
        // tax + tip) — duplicated here for the same Node-22 reason.
        const checkAmount = (o.checks ?? []).filter(c => !c.voided).reduce((sum, c) => sum + (c.amount ?? 0), 0)
        entry.revenue += checkAmount
      }
      perArea.set(areaName, entry)
    }
  }

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
    const syncedAt = new Date().toISOString()
    upsert.run({ date: isoDay, covers, laborHours, syncedAt })
    for (const [areaName, { covers: areaCovers, revenue, foodRevenue, beverageRevenue }] of perArea) {
      const areaId = areaIdByName.get(areaName)
      if (areaId == null) continue
      upsertArea.run({ date: isoDay, areaId, covers: areaCovers, revenue, foodRevenue, beverageRevenue, syncedAt })
    }
  })()
  totalDaysWritten++
  console.log(`${isoDay}: covers=${covers} laborHours=${laborHours.toFixed(2)}${orders.length === 0 && timeEntries.length === 0 ? ' (quiet — no orders or time entries)' : ''}`)

  await new Promise(r => setTimeout(r, delayMs))
}

console.log(`Done. ${totalDaysWritten} day(s) written.${maxQuietStreak >= 14 ? ` Longest quiet streak: ${maxQuietStreak} consecutive days with no orders/time entries — worth checking whether Toast genuinely had no data that far back (e.g. before this account/location went live) rather than trusting those as real zero-cover days.` : ''}`)
db.close()
