// One-time backfill for the Staff Hours report: pulls Toast's Labor API
// (timeEntries, one business date at a time) and writes per-employee hours
// into daily_toast_employee_hours, plus every employee's name into
// toast_employees. Not part of the nightly sync (which only moves forward) —
// run by hand once so the report has its 90-day window on day one:
//
//   npm run db:backfill-toast-employee-hours -- [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--delay-ms=300]
//
// Defaults: --until = yesterday (restaurant-local), --since = 89 days before
// that (a 90-day window, matching /api/staff-hours). Idempotent: each day's
// rows are replaced wholesale, so an interrupted run can be re-invoked with
// the same flags.
//
// Needs the tables from scripts/add-toast-employee-hours-tables.mjs, and the
// TOAST_* credential's labor:read + labor.employees:read scopes.
//
// Auth is a small, deliberate duplicate of server/utils/toast.ts, and the
// hours rule a duplicate of writeEmployeeHoursForDate in
// server/utils/toast-employee-hours.ts, for the same Node-22-can't-reliably-
// strip-TypeScript reason as backfill-toast-metrics.mjs. Keep them in sync by
// hand.
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

const { TOAST_API_HOSTNAME: HOST, TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID } = process.env
if (!HOST || !TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET || !TOAST_RESTAURANT_GUID) {
  console.error('Missing one of TOAST_API_HOSTNAME / TOAST_CLIENT_ID / TOAST_CLIENT_SECRET / TOAST_RESTAURANT_GUID (run via: npm run db:backfill-toast-employee-hours).')
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

async function fetchTimeEntries(isoDay) {
  const businessDate = isoDay.replace(/-/g, '')
  const results = []
  for (let page = 1; ; page++) {
    const body = await toastGet(`/labor/v1/timeEntries?businessDate=${businessDate}&page=${page}&pageSize=100`)
    if (!Array.isArray(body) || body.length === 0) break
    results.push(...body)
    if (body.length < 100) break
  }
  return results
}

const db = new Database(dbPath)
for (const table of ['daily_toast_employee_hours', 'toast_employees']) {
  if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)) {
    console.error(`Table ${table} is missing — run: node scripts/add-toast-employee-hours-tables.mjs`)
    process.exit(1)
  }
}

// Names first, so a scope problem fails fast before 90 days of calls.
let employees
try {
  employees = await toastGet('/labor/v1/employees')
} catch (err) {
  console.error(`Could not fetch /labor/v1/employees (${err.message}) — does the credential have the labor.employees:read scope?`)
  process.exit(1)
}
const syncedAtEmployees = new Date().toISOString()
const upsertEmployee = db.prepare(`
  INSERT INTO toast_employees (guid, first_name, last_name, chosen_name, deleted, synced_at)
  VALUES (@guid, @firstName, @lastName, @chosenName, @deleted, @syncedAt)
  ON CONFLICT (guid) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
    chosen_name = excluded.chosen_name, deleted = excluded.deleted, synced_at = excluded.synced_at
`)
db.transaction(() => {
  for (const e of employees) {
    upsertEmployee.run({ guid: e.guid, firstName: e.firstName ?? null, lastName: e.lastName ?? null, chosenName: e.chosenName ?? null, deleted: e.deleted ? 1 : 0, syncedAt: syncedAtEmployees })
  }
})()
console.log(`Wrote ${employees.length} employee(s) (${employees.filter(e => e.deleted).length} deleted/former).`)

const deleteDay = db.prepare('DELETE FROM daily_toast_employee_hours WHERE date = ?')
const insertHours = db.prepare('INSERT INTO daily_toast_employee_hours (date, employee_guid, hours, auto_clocked_out_shifts, auto_clocked_out_hours, synced_at) VALUES (?, ?, ?, ?, ?, ?)')

const days = []
for (let d = since; d <= until; d = addDays(d, 1)) days.push(d)
console.log(`Backfilling employee hours for ${days.length} day(s), ${since} to ${until}...`)

let daysWithHours = 0
let autoClockedOutEntries = 0
for (const isoDay of days) {
  let entries
  try {
    entries = await fetchTimeEntries(isoDay)
  } catch (err) {
    console.error(`${isoDay}: FAILED — ${err.message}`)
    console.error('Stopping here — re-run with the same --since to resume (each day is replaced wholesale, so re-running is safe).')
    process.exit(1)
  }

  const hoursByEmployee = new Map()
  for (const te of entries) {
    const guid = te.employeeReference?.guid
    if (!guid || te.deleted) continue
    const hours = (te.regularHours ?? 0) + (te.overtimeHours ?? 0)
    if (hours <= 0) continue
    const entry = hoursByEmployee.get(guid) ?? { hours: 0, autoShifts: 0, autoHours: 0 }
    entry.hours += hours
    if (te.autoClockedOut) {
      entry.autoShifts += 1
      entry.autoHours += hours
      autoClockedOutEntries++
    }
    hoursByEmployee.set(guid, entry)
  }

  const syncedAt = new Date().toISOString()
  db.transaction(() => {
    deleteDay.run(isoDay)
    for (const [guid, e] of hoursByEmployee) insertHours.run(isoDay, guid, e.hours, e.autoShifts, e.autoHours, syncedAt)
  })()
  if (hoursByEmployee.size > 0) daysWithHours++
  console.log(`${isoDay}: ${hoursByEmployee.size} employee(s)`)
  await new Promise(r => setTimeout(r, delayMs))
}

console.log(`Done. ${days.length} day(s) processed, ${daysWithHours} with hours. ${autoClockedOutEntries} entr${autoClockedOutEntries === 1 ? 'y was' : 'ies were'} auto-clocked-out by Toast (a forgotten clock-out can inflate that shift's hours).`)
db.close()
