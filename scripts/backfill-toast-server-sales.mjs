// One-time backfill for the FOH Hours productivity table: pulls Toast's orders (ordersBulk, one
// business date at a time) and writes one row per server into daily_toast_server_sales. Not part of the
// nightly sync (which only moves forward): run by hand so the table has history on day one:
//
//   npm run db:backfill-toast-server-sales -- [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--delay-ms=300]
//
// Defaults: --until = yesterday (restaurant-local), --since = 89 days before that. The restaurant
// moved to Cambridge St on 2026-06-20 (friends & family Jun 16), so --since=2026-06-16 covers everything
// that matters. Idempotent: each day's rows are replaced wholesale, so an interrupted run can be re-invoked.
//
// Needs migration 0025 (node scripts/migrate.mjs) and the TOAST_* credential's orders:read scope (the
// nightly sync already uses it). The per-order rules are shared with the sync via
// server/utils/toast-server-sales.mjs; the auth below is a small, deliberate duplicate of
// server/utils/toast.ts (same reason as backfill-toast-employee-hours.mjs).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { aggregateServerSales, isChefsCounterOrder } from '../server/utils/toast-server-sales.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')
if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
  process.exit(1)
}

const { TOAST_API_HOSTNAME: HOST, TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID } = process.env
if (!HOST || !TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET || !TOAST_RESTAURANT_GUID) {
  console.error('Missing one of TOAST_API_HOSTNAME / TOAST_CLIENT_ID / TOAST_CLIENT_SECRET / TOAST_RESTAURANT_GUID (run via: npm run db:backfill-toast-server-sales).')
  process.exit(1)
}

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [key, value] = a.replace(/^--/, '').split('=')
  return [key, value ?? true]
}))

const RESTAURANT_TIME_ZONE = 'America/New_York'
function localToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: RESTAURANT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = type => parts.find(p => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const until = args.until || addDays(localToday(), -1)
const since = args.since || addDays(until, -89)
const delayMs = args['delay-ms'] ? Number(args['delay-ms']) : 300
if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || since > until) {
  console.error(`--since/--until must be YYYY-MM-DD with since <= until. Got since=${since} until=${until}`)
  process.exit(1)
}

let cachedToken = null
async function login() {
  const res = await fetch(`${HOST}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: TOAST_CLIENT_ID, clientSecret: TOAST_CLIENT_SECRET, userAccessType: 'TOAST_MACHINE_CLIENT' })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Toast login failed: ${res.status}`)
  cachedToken = body.token.accessToken
  return cachedToken
}

async function toastGet(path, retries = 2) {
  let res
  for (let attempt = 0; ; attempt++) {
    const token = cachedToken ?? await login()
    res = await fetch(`${HOST}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': TOAST_RESTAURANT_GUID } })
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
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function fetchOrders(isoDay) {
  const businessDate = isoDay.replace(/-/g, '')
  const results = []
  for (let page = 1; ; page++) {
    const body = await toastGet(`/orders/v2/ordersBulk?businessDate=${businessDate}&page=${page}&pageSize=100`)
    if (!Array.isArray(body) || body.length === 0) break
    results.push(...body)
    if (body.length < 100) break
  }
  return results
}

// Chef's Counter tables (C<n>, same naming rule as server/utils/toast-table-map.ts) so counter orders are kept apart.
const counterTables = new Map()
try {
  for (const t of await toastGet('/config/v2/tables')) counterTables.set(t.guid, /^C\d+$/i.test((t.name ?? '').trim()) ? 'chefs counter' : null)
  console.log(`Loaded ${counterTables.size} Toast table(s); Chef's Counter orders will be split out.`)
} catch (err) {
  console.warn(`Could not fetch /config/v2/tables (${err.message}) — counter orders are then found by their prix fixe selection only.`)
}

const db = new Database(dbPath)
if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'daily_toast_server_sales'`).get()) {
  console.error('Table daily_toast_server_sales is missing — run: node scripts/migrate.mjs')
  process.exit(1)
}
const deleteDay = db.prepare('DELETE FROM daily_toast_server_sales WHERE date = ?')
const insert = db.prepare(`
  INSERT INTO daily_toast_server_sales (date, employee_guid, is_counter, orders, guests, net_sales, tax, non_cash_tips, void_count, turn_seconds, turn_orders, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const days = []
for (let d = since; d <= until; d = addDays(d, 1)) days.push(d)
console.log(`Backfilling server sales for ${days.length} day(s), ${since} to ${until}...`)

let daysWithOrders = 0
for (const isoDay of days) {
  let orders
  try {
    orders = await fetchOrders(isoDay)
  } catch (err) {
    console.error(`${isoDay}: FAILED — ${err.message}`)
    console.error('Stopping here — re-run with the same --since to resume (each day is replaced wholesale, so re-running is safe).')
    process.exit(1)
  }
  const rows = aggregateServerSales(orders, o => isChefsCounterOrder(o, counterTables))
  const syncedAt = new Date().toISOString()
  db.transaction(() => {
    deleteDay.run(isoDay)
    for (const r of rows) insert.run(isoDay, r.employeeGuid, r.isCounter, r.orders, r.guests, r.netSales, r.tax, r.nonCashTips, r.voidCount, r.turnSeconds, r.turnOrders, syncedAt)
  })()
  if (rows.length) daysWithOrders++
  console.log(`${isoDay}: ${rows.length} server(s), ${rows.reduce((s, r) => s + r.orders, 0)} order(s)`)
  if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
}
console.log(`Done: ${daysWithOrders} of ${days.length} day(s) had orders.`)
db.close()
