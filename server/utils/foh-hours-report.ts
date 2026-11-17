// FOH hours report for the Team › FOH Hours tab (added 2026-11-17, for the GM and the Floor
// Manager): hours worked per front-of-house employee for a Mon–Sun week, from Toast time entries
// kept by job in daily_toast_job_hours. Same data and layout as the BOH report
// (boh-hours-report.ts), which supplies the date helpers and the downloadable page's styles.
// It is about tracking hours, not cost. The productivity table under the hours (Toast's Employee
// productivity figures, from daily_toast_server_sales) does show sales dollars: Kit's call (2026-11-17)
// is that the GM and the Floor Manager both see them.
//
// "FOH" is decided by Toast job title (FOH_JOB_PATTERN), because Toast has no floor flag on a job.
// Each person is grouped (Floor, Bar, Concierge) by the job they worked the most hours in that
// week. Jobs with hours that are neither FOH nor BOH are returned (notCounted), not dropped
// silently, so a newly created Toast job title gets noticed.
// Shared station logins (staff override "excluded", e.g. "Service Bar") are not people: they are
// left out of the table and listed in excludedLogins instead.
// Managers are left out of every FOH figure (Kit, 2026-11-17: the GM, the Floor Manager and the Wine
// Director): anyone who has ever clocked in on a manager job (MANAGER_JOB_PATTERN) is dropped
// completely, whatever other job they worked, and is not listed as "not counted" either. There is no
// Management section. Same for the productivity table.
import site from '../../app/config/site.json'
import {
  BOH_JOB_PATTERN, RESTAURANT_TIME_ZONE, HOURS_REPORT_CSS, addDays, mondayOf, localToday, round1, esc, fmtH, fmtDate
} from './boh-hours-report'
import { loadStaffOverrides, staffKeys } from './staff-overrides'
import { loadPlannedNights } from './special-nights'

export const FOH_JOB_PATTERN = /^(server|(lead |service )?bartender|bar ?prep|bar ?back|concierge|host|hostess|service captain|captain|cater-waiter|food runner|runner|busser)/i
const BAR_JOB_PATTERN = /^((lead |service )?bartender|bar ?prep|bar ?back)/i
const CONCIERGE_JOB_PATTERN = /^(concierge|host|hostess)/i
export const MANAGER_JOB_PATTERN = /^(general manager|floor manager|assistant manager|manager|wine director|director|sommelier|maitre)/i
// Toast starts overtime after 40 hours in the week; "close" is a heads-up band. Rare in the front of house.
const OVERTIME_LINE_HOURS = 40
const CLOSE_TO_OVERTIME_HOURS = 36
const TRAILING_WEEKS = 4
// Which days count as normal service (Kit, 2026-11-17). Closed Mondays, dated holiday closures, and
// dated buyout / event / off-site nights are not normal service; and a day that should be open but has
// fewer than MIN_ORDERS_FOR_SERVICE_DAY orders is a low-volume day or an anomaly (a stray order on a
// closed day, an unentered private event). Such days are marked and left out of guests per FOH hour and
// the productivity table; their hours are still listed. Ordinary Tue-Sun nights run about 27-75 orders.
// If order counts aren't synced for a day yet, the app-wide 15-covers rule stands in.
export const MIN_ORDERS_FOR_SERVICE_DAY = 20
const MIN_COVERS_FOR_OPEN_DAY = 15

export type FohGroupKey = 'floor' | 'bar' | 'concierge'
const GROUPS: { key: FohGroupKey, label: string }[] = [
  { key: 'floor', label: 'Floor' },
  { key: 'bar', label: 'Bar' },
  { key: 'concierge', label: 'Concierge' }
]
const groupOfJob = (title: string): FohGroupKey => (CONCIERGE_JOB_PATTERN.test(title) ? 'concierge' : BAR_JOB_PATTERN.test(title) ? 'bar' : 'floor')

export type FohDayStatus = 'open' | 'closed' | 'buyout' | 'event' | 'offsite' | 'low'
export interface FohDay {
  date: string
  label: string
  isClosedDay: boolean   // greyed out: closed (Monday, holiday) or low orders
  elapsed: boolean
  status: FohDayStatus
  tag: string | null     // short note under the date: "Closed", "Thanksgiving", "Buyout", "Low orders"
  service: boolean       // counts in guests per FOH hour and the productivity table
}
interface DayClass { status: FohDayStatus, tag: string | null, service: boolean }
export interface FohPerson {
  guid: string
  name: string
  jobs: string[]
  group: FohGroupKey
  byDay: Record<string, number>
  total: number
  overtime: number
  status: 'over' | 'close' | 'ok'
  // Shifts Toast clocked out automatically (a forgotten clock-out), which run long.
  autoShifts: number
  autoHours: number
  autoDays: string[]
}
// One row of the productivity table (Toast's Employee productivity figures for the week). Dollars are
// shown to the GM and the Floor Manager (Kit's decision). turnMinutes/tipPct/perHour are null when there is nothing to divide by.
export interface FohProductivityRow {
  guid: string
  name: string
  isStation: boolean            // a shared login (e.g. Service Bar), shown apart from the people
  hours: number | null          // FOH hours clocked that week (the login's own hours for a station)
  orders: number
  guests: number
  netSales: number
  perGuest: number | null
  avgOrder: number | null
  perHour: number | null        // net sales per hour worked
  turnMinutes: number | null    // average order open -> paid
  tipPct: number | null         // non-cash tips as a % of net sales + tax (Toast's definition)
  voids: number
}
export interface FohProductivity {
  available: boolean            // false until the history backfill / nightly sync has filled this week
  rows: FohProductivityRow[]
  total: FohProductivityRow | null
}
export interface FohHoursReport {
  restaurantName: string
  hasData: boolean
  weekStart: string
  weekEnd: string
  asOf: string | null          // last synced day within this week
  weekComplete: boolean
  days: FohDay[]
  groups: { key: FohGroupKey, label: string }[]
  people: FohPerson[]
  productivity: FohProductivity
  autoClockOuts: { people: number, shifts: number }
  // covers/coversByDay: Toast guests on open nights (blank for closed days and nights not synced yet).
  totals: { all: number, overtime: number, byDay: Record<string, number>, covers: number, coversByDay: Record<string, number> }
  // Guests per FOH hour for the days so far this week, last week's full week, and the average of the 4 weeks before.
  guestsPerHour: { current: number | null, lastWeek: number | null, trailingAvg: number | null }
  // Same stretch of the prior week (same number of days elapsed), its full total, and the average
  // full week over the 4 weeks before this one.
  comparison: { priorSamePoint: number | null, priorFullWeek: number | null, trailingAvgFullWeek: number | null, trailingWeeks: number }
  includedJobs: string[]
  notCounted: { title: string, hours: number }[]
  excludedLogins: { name: string, hours: number }[]
  prevWeek: string | null
  nextWeek: string | null
  thresholds: { overtime: number, close: number, minOrders: number }
  generatedAt: string
}

// Everyone who has ever clocked in on a manager job (all synced history, so a manager who covers a
// floor shift is still left out).
function managerGuidsOf(db: ReturnType<typeof useDb>): Set<string> {
  const rows = db.prepare(`
    SELECT DISTINCT h.employee_guid AS guid, j.title AS title FROM daily_toast_job_hours h
    JOIN toast_jobs j ON j.guid = h.job_guid
  `).all() as { guid: string, title: string }[]
  return new Set(rows.filter(r => MANAGER_JOB_PATTERN.test(r.title)).map(r => r.guid))
}

// Classifies every date in [from, to]. `dataThrough` is the last synced day: later days (the rest of a
// week in progress) are not judged on volume.
function classifyDays(db: ReturnType<typeof useDb>, from: string, to: string, dataThrough: string): Map<string, DayClass> {
  const planned = loadPlannedNights(db, from, to)
  const orders = new Map<string, number>()
  try {
    for (const r of db.prepare('SELECT date, SUM(orders) AS n FROM daily_toast_server_sales WHERE date BETWEEN ? AND ? GROUP BY date').all(from, to) as { date: string, n: number }[]) orders.set(r.date, r.n)
  } catch { /* migration 0025 not applied: the covers rule stands in */ }
  const covers = new Map<string, number>()
  for (const r of db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date BETWEEN ? AND ?').all(from, to) as { date: string, covers: number }[]) covers.set(r.date, r.covers)
  const out = new Map<string, DayClass>()
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const n = planned.get(d)
    let c: DayClass
    if (n && (n.kind === 'buyout' || n.kind === 'event' || n.kind === 'offsite')) {
      c = { status: n.kind, tag: n.kind === 'buyout' ? 'Buyout' : n.kind === 'event' ? 'Event' : 'Off-site', service: false }
    } else if (n && n.kind === 'closed') {
      c = { status: 'closed', tag: n.holiday ?? n.note ?? 'Closed', service: false }
    } else if (new Date(`${d}T00:00:00Z`).getUTCDay() === 1) {
      c = { status: 'closed', tag: 'Closed', service: false }
    } else if (d <= dataThrough && (orders.has(d) ? orders.get(d)! < MIN_ORDERS_FOR_SERVICE_DAY : (covers.get(d) ?? 0) < MIN_COVERS_FOR_OPEN_DAY)) {
      c = { status: 'low', tag: 'Low orders', service: false }
    } else {
      c = { status: 'open', tag: null, service: true }
    }
    out.set(d, c)
  }
  return out
}

interface JobHourRow { date: string, guid: string, title: string, regular: number, overtime: number, autoShifts: number, autoHours: number }

interface ServerSalesRow { guid: string, orders: number, guests: number, net: number, tax: number, tips: number, voids: number, turnSeconds: number, turnOrders: number }

function buildProductivity(
  db: ReturnType<typeof useDb>, from: string, to: string, names: Map<string, string>,
  stationGuids: Set<string>, managerGuids: Set<string>, hoursByGuid: Map<string, number>, serviceDates: string[]
): FohProductivity {
  let sales: ServerSalesRow[]
  try {
    const any = db.prepare('SELECT COUNT(*) AS n FROM daily_toast_server_sales WHERE date BETWEEN ? AND ?').get(from, to) as { n: number }
    if (!any.n) return { available: false, rows: [], total: null } // not synced for this week yet
    // Normal-service nights only (not closed, buyout, event, off-site or low-order days).
    const marks = serviceDates.map(() => '?').join(',')
    sales = serviceDates.length ? db.prepare(`
      SELECT employee_guid AS guid, SUM(orders) AS orders, SUM(guests) AS guests, SUM(net_sales) AS net, SUM(tax) AS tax,
             SUM(non_cash_tips) AS tips, SUM(void_count) AS voids, SUM(turn_seconds) AS turnSeconds, SUM(turn_orders) AS turnOrders
      FROM daily_toast_server_sales WHERE date IN (${marks}) GROUP BY employee_guid
    `).all(...serviceDates) as ServerSalesRow[] : []
  } catch {
    return { available: false, rows: [], total: null } // migration 0025 not applied yet
  }
  if (!sales.length) return { available: true, rows: [], total: null }
  const r1 = (n: number) => Math.round(n * 10) / 10
  const r2 = (n: number) => Math.round(n * 100) / 100
  const make = (guid: string, name: string, isStation: boolean, hours: number | null, s: Omit<ServerSalesRow, 'guid'>): FohProductivityRow => ({
    guid, name, isStation,
    hours: hours === null ? null : r1(hours),
    orders: s.orders, guests: s.guests, netSales: r2(s.net),
    perGuest: s.guests > 0 ? r2(s.net / s.guests) : null,
    avgOrder: s.orders > 0 ? r2(s.net / s.orders) : null,
    perHour: hours && hours > 0 ? r2(s.net / hours) : null,
    turnMinutes: s.turnOrders > 0 ? r1(s.turnSeconds / s.turnOrders / 60) : null,
    tipPct: s.net + s.tax > 0 ? r1(100 * s.tips / (s.net + s.tax)) : null,
    voids: s.voids
  })
  // Only people (and the shared bar login) who clocked FOH hours that week and rang something: the
  // online-ordering pseudo-user and managers have no FOH hours, so they drop out.
  const kept = sales.filter(s => s.orders > 0 && names.has(s.guid) && hoursByGuid.has(s.guid) && !managerGuids.has(s.guid))
  const rows = kept
    .map(s => make(s.guid, names.get(s.guid)!, stationGuids.has(s.guid), hoursByGuid.get(s.guid) ?? null, s))
    .sort((a, b) => Number(a.isStation) - Number(b.isStation) || b.netSales - a.netSales || a.name.localeCompare(b.name))
  const sum = (k: keyof Omit<ServerSalesRow, 'guid'>) => kept.reduce((t, s) => t + s[k], 0)
  const totalHours = kept.reduce((t, s) => t + (hoursByGuid.get(s.guid) ?? 0), 0)
  const total = rows.length
    ? make('total', 'Team total', false, totalHours, { orders: sum('orders'), guests: sum('guests'), net: sum('net'), tax: sum('tax'), tips: sum('tips'), voids: sum('voids'), turnSeconds: sum('turnSeconds'), turnOrders: sum('turnOrders') })
    : null
  return { available: true, rows, total }
}

export function buildFohHoursReport(requestedWeek?: string | null): FohHoursReport {
  const db = useDb()
  const generatedAt = new Date().toISOString()
  const base = {
    restaurantName: site.restaurantName,
    groups: GROUPS,
    thresholds: { overtime: OVERTIME_LINE_HOURS, close: CLOSE_TO_OVERTIME_HOURS, minOrders: MIN_ORDERS_FOR_SERVICE_DAY },
    generatedAt
  }
  const range = db.prepare('SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM daily_toast_job_hours').get() as { minDate: string | null, maxDate: string | null }
  const emptyDays = (start: string): FohDay[] => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i)
    return { date, label: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' }), isClosedDay: i === 0, elapsed: false, status: i === 0 ? 'closed' : 'open', tag: i === 0 ? 'Closed' : null, service: i !== 0 }
  })
  const noGuests = { current: null, lastWeek: null, trailingAvg: null }
  if (!range.minDate || !range.maxDate) {
    const emptyWeek = mondayOf(localToday())
    return {
      ...base, hasData: false, weekStart: emptyWeek, weekEnd: addDays(emptyWeek, 6), asOf: null, weekComplete: false,
      days: emptyDays(emptyWeek), people: [], productivity: { available: false, rows: [], total: null }, autoClockOuts: { people: 0, shifts: 0 },
      totals: { all: 0, overtime: 0, byDay: {}, covers: 0, coversByDay: {} }, guestsPerHour: noGuests,
      comparison: { priorSamePoint: null, priorFullWeek: null, trailingAvgFullWeek: null, trailingWeeks: 0 },
      includedJobs: [], notCounted: [], excludedLogins: [], prevWeek: null, nextWeek: null
    }
  }

  // Default: the week containing the latest synced day.
  const wanted = requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) ? mondayOf(requestedWeek) : mondayOf(range.maxDate)
  const weekStart = wanted > mondayOf(range.maxDate) ? mondayOf(range.maxDate) : wanted
  const weekEnd = addDays(weekStart, 6)
  const asOf = range.maxDate >= weekEnd ? weekEnd : (range.maxDate >= weekStart ? range.maxDate : null)
  const weekComplete = range.maxDate >= weekEnd
  const elapsedDays = asOf ? Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000) + 1 : 0

  const rowsFor = (from: string, to: string) => db.prepare(`
    SELECT h.date AS date, h.employee_guid AS guid, COALESCE(j.title, '(unknown job)') AS title,
           h.regular_hours AS regular, h.overtime_hours AS overtime,
           h.auto_clocked_out_shifts AS autoShifts, h.auto_clocked_out_hours AS autoHours
    FROM daily_toast_job_hours h
    LEFT JOIN toast_jobs j ON j.guid = h.job_guid
    WHERE h.date BETWEEN ? AND ?
  `).all(from, to) as JobHourRow[]
  const isFoh = (title: string) => FOH_JOB_PATTERN.test(title)
  const hoursOf = (r: JobHourRow) => r.regular + r.overtime
  const sum = (rows: JobHourRow[]) => rows.reduce((s, r) => s + hoursOf(r), 0)

  // Names, and which Toast logins are shared stations rather than people.
  const overrides = loadStaffOverrides(db)
  const names = new Map<string, string>()
  const stationGuids = new Set<string>()
  for (const e of db.prepare('SELECT guid, first_name, last_name, chosen_name FROM toast_employees').all() as { guid: string, first_name: string | null, last_name: string | null, chosen_name: string | null }[]) {
    const first = e.chosen_name || e.first_name || ''
    names.set(e.guid, `${first} ${e.last_name ?? ''}`.trim() || 'Unknown employee')
    if (overrides.excluded.has(staffKeys(e.first_name, e.last_name, e.chosen_name).displayKey)) stationGuids.add(e.guid)
  }
  const gmGuids = managerGuidsOf(db)
  // Station logins and managers out, so every figure below (totals, comparisons) counts the floor team only.
  const leftOut = (guid: string) => stationGuids.has(guid) || gmGuids.has(guid)
  const fohRowsFor = (from: string, to: string) => rowsFor(from, to).filter(r => isFoh(r.title) && !leftOut(r.guid))

  const rows = rowsFor(weekStart, weekEnd)
  const fohRows = rows.filter(r => isFoh(r.title) && !leftOut(r.guid))

  const byPerson = new Map<string, FohPerson & { jobHours: Map<string, number> }>()
  for (const r of fohRows) {
    const p = byPerson.get(r.guid) ?? { guid: r.guid, name: names.get(r.guid) ?? 'Unknown employee', jobs: [], group: 'floor' as FohGroupKey, byDay: {}, total: 0, overtime: 0, status: 'ok' as const, autoShifts: 0, autoHours: 0, autoDays: [] as string[], jobHours: new Map<string, number>() }
    if (!p.jobs.includes(r.title)) p.jobs.push(r.title)
    p.jobHours.set(r.title, (p.jobHours.get(r.title) ?? 0) + hoursOf(r))
    p.byDay[r.date] = round1((p.byDay[r.date] ?? 0) + hoursOf(r))
    p.total += hoursOf(r)
    p.overtime += r.overtime
    if (r.autoShifts > 0) {
      p.autoShifts += r.autoShifts
      p.autoHours += r.autoHours
      if (!p.autoDays.includes(r.date)) p.autoDays.push(r.date)
    }
    byPerson.set(r.guid, p)
  }
  const groupOrder = (k: FohGroupKey) => GROUPS.findIndex(g => g.key === k)
  const people: FohPerson[] = [...byPerson.values()].map(({ jobHours, ...p }) => {
    const total = round1(p.total)
    // The group of the job they worked most that week; the jobs list leads with that job.
    const main = [...jobHours.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    const jobs = [main, ...p.jobs.filter(j => j !== main)]
    return { ...p, jobs, group: groupOfJob(main), total, overtime: round1(p.overtime), autoHours: round1(p.autoHours), status: (total >= OVERTIME_LINE_HOURS || p.overtime > 0 ? 'over' : total >= CLOSE_TO_OVERTIME_HOURS ? 'close' : 'ok') as FohPerson['status'] }
  }).sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || b.total - a.total || a.name.localeCompare(b.name))

  const byDay: Record<string, number> = {}
  for (const r of fohRows) byDay[r.date] = round1((byDay[r.date] ?? 0) + hoursOf(r))

  // Guests on normal-service nights only (see classifyDays), from the Toast covers sync.
  const dataThrough: string = range.maxDate
  const dayClass = classifyDays(db, weekStart, weekEnd, dataThrough)
  const coversOn = (from: string, to: string, dayInfo: Map<string, DayClass>) => {
    const m = new Map<string, number>()
    for (const r of db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date BETWEEN ? AND ?').all(from, to) as { date: string, covers: number }[]) {
      if (dayInfo.get(r.date)?.service && r.covers > 0) m.set(r.date, r.covers)
    }
    return m
  }
  const coversByDay = Object.fromEntries(coversOn(weekStart, weekEnd, dayClass))
  const coversTotal = Object.values(coversByDay).reduce((s, v) => s + v, 0)
  // Guests ÷ FOH hours, counting only the normal-service nights that have both.
  const perHour = (from: string, to: string): number | null => {
    const covers = coversOn(from, to, from === weekStart ? dayClass : classifyDays(db, from, to, dataThrough))
    const hours = fohRowsFor(from, to).filter(r => covers.has(r.date))
    const h = sum(hours)
    if (!covers.size || h <= 0) return null
    let g = 0
    for (const [d, c] of covers) if (hours.some(r => r.date === d)) g += c
    return round1(g / h)
  }

  // Comparison: prior week up to the same weekday, and its full total.
  const priorStart = addDays(weekStart, -7)
  const priorRows = fohRowsFor(priorStart, addDays(priorStart, 6))
  const hasPrior = range.minDate <= addDays(priorStart, 6)
  const priorSamePointEnd = addDays(priorStart, Math.max(elapsedDays, 1) - 1)
  const priorSamePoint = hasPrior && elapsedDays > 0 ? round1(sum(priorRows.filter(r => r.date <= priorSamePointEnd))) : null
  const priorFullWeek = hasPrior ? round1(sum(priorRows)) : null
  const trailing: number[] = []
  const trailingPerHour: number[] = []
  for (let i = 1; i <= TRAILING_WEEKS; i++) {
    const s = addDays(weekStart, -7 * i)
    if (range.minDate > s) break // week not fully in the synced range
    trailing.push(sum(fohRowsFor(s, addDays(s, 6))))
    const ph = perHour(s, addDays(s, 6))
    if (ph !== null) trailingPerHour.push(ph)
  }

  // Jobs that are neither FOH nor BOH (a new Toast title); shared station logins by name.
  const notCountedMap = new Map<string, number>()
  for (const r of rows) if (!isFoh(r.title) && !BOH_JOB_PATTERN.test(r.title) && !gmGuids.has(r.guid)) notCountedMap.set(r.title, (notCountedMap.get(r.title) ?? 0) + hoursOf(r))
  const stationMap = new Map<string, number>()
  for (const r of rows) if (isFoh(r.title) && stationGuids.has(r.guid)) stationMap.set(names.get(r.guid) ?? 'Unknown login', (stationMap.get(names.get(r.guid) ?? 'Unknown login') ?? 0) + hoursOf(r))

  // Productivity: Toast's Employee productivity figures for the week, one row per server who rang orders.
  // Hours here are normal-service nights only, so sales per hour compares like with like.
  const serviceDates = [...dayClass].filter(([, c]) => c.service).map(([d]) => d)
  const hoursByGuid = new Map<string, number>()
  for (const r of rows) if (isFoh(r.title) && dayClass.get(r.date)?.service) hoursByGuid.set(r.guid, (hoursByGuid.get(r.guid) ?? 0) + hoursOf(r))
  const productivity = buildProductivity(db, weekStart, weekEnd, names, stationGuids, gmGuids, hoursByGuid, serviceDates)

  const jobTitles = (db.prepare('SELECT title FROM toast_jobs WHERE deleted = 0 ORDER BY title').all() as { title: string }[]).map(j => j.title)
  const thisMonday = mondayOf(range.maxDate)

  return {
    ...base,
    hasData: true,
    weekStart,
    weekEnd,
    asOf,
    weekComplete,
    days: emptyDays(weekStart).map((d, i) => {
      const c = dayClass.get(d.date)!
      return { ...d, elapsed: i < elapsedDays, status: c.status, tag: c.tag, service: c.service, isClosedDay: c.status === 'closed' || c.status === 'low' }
    }),
    people,
    productivity,
    autoClockOuts: { people: people.filter(p => p.autoShifts > 0).length, shifts: people.reduce((s, p) => s + p.autoShifts, 0) },
    // Summed from raw rows, not the rounded per-person totals, so rounding can't drift the headline.
    totals: { all: round1(sum(fohRows)), overtime: round1(fohRows.reduce((s, r) => s + r.overtime, 0)), byDay, covers: coversTotal, coversByDay },
    guestsPerHour: {
      current: asOf ? perHour(weekStart, weekEnd) : null,
      lastWeek: hasPrior ? perHour(priorStart, addDays(priorStart, 6)) : null,
      trailingAvg: trailingPerHour.length ? round1(trailingPerHour.reduce((s, v) => s + v, 0) / trailingPerHour.length) : null
    },
    comparison: {
      priorSamePoint,
      priorFullWeek,
      trailingAvgFullWeek: trailing.length ? round1(trailing.reduce((s, v) => s + v, 0) / trailing.length) : null,
      trailingWeeks: trailing.length
    },
    includedJobs: [...new Set(jobTitles.filter(isFoh))],
    notCounted: [...notCountedMap].map(([title, hours]) => ({ title, hours: round1(hours) })).filter(x => x.hours > 0).sort((a, b) => b.hours - a.hours),
    excludedLogins: [...stationMap].map(([name, hours]) => ({ name, hours: round1(hours) })).filter(x => x.hours > 0),
    prevWeek: range.minDate <= addDays(weekStart, -1) ? priorStart : null,
    nextWeek: weekStart < thisMonday ? addDays(weekStart, 7) : null
  }
}

// Standalone page for sending (Slack etc.): inline CSS, no scripts, no app chrome, readable on a
// phone, light and dark. Same look as the BOH report.
export function renderFohHoursHtml(r: FohHoursReport): string {
  const title = `${r.restaurantName} — FOH hours, week of ${fmtDate(r.weekStart)}`
  const through = r.asOf ? (r.weekComplete ? 'final' : `through ${fmtDate(r.asOf)}`) : 'no hours yet'
  const delta = (cur: number, prior: number | null) => {
    if (prior === null) return ''
    const d = round1(cur - prior)
    return d === 0 ? 'same as' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} ${d > 0 ? 'more' : 'fewer'} than`
  }
  const cols = r.days.length + 2
  const head = r.days.map(d => `<th class="n${d.isClosedDay ? ' closed' : ''}">${esc(d.label)}${d.tag ? `<span class="job">${esc(d.tag)}</span>` : ''}</th>`).join('')
  const rowHtml = (p: FohPerson) => {
    const chip = p.status === 'over' ? '<span class="chip over">▲ In overtime</span>' : p.status === 'close' ? '<span class="chip close">◆ Near 40</span>' : ''
    const autoChip = p.autoShifts > 0 ? `<span class="chip auto">⚠ Auto clock-out${p.autoShifts > 1 ? ` ×${p.autoShifts}` : ''}</span>` : ''
    const cells = r.days.map(d => `<td class="n${d.isClosedDay ? ' closed' : ''}">${fmtH(p.byDay[d.date] ?? 0)}${p.autoDays.includes(d.date) ? '<span class="aw" title="Auto clock-out">⚠</span>' : ''}</td>`).join('')
    return `<tr><th scope="row">${esc(p.name)}<span class="job">${esc(p.jobs.join(', '))}</span>${chip}${autoChip}</th><td class="n total">${p.total.toFixed(1)}</td>${cells}</tr>`
  }
  const body = r.groups.map((g) => {
    const rows = r.people.filter(p => p.group === g.key).map(rowHtml).join('')
    return rows ? `<tr class="sec"><th colspan="${cols}">${esc(g.label)}</th></tr>${rows}` : ''
  }).join('')
  const dayTotals = r.days.map(d => `<td class="n${d.isClosedDay ? ' closed' : ''}">${fmtH(r.totals.byDay[d.date] ?? 0)}</td>`).join('')
  const dayCovers = r.days.map(d => `<td class="n${d.isClosedDay ? ' closed' : ''}">${r.totals.coversByDay[d.date] ?? '–'}</td>`).join('')
  const cmp: string[] = []
  if (r.comparison.priorSamePoint !== null && r.asOf && !r.weekComplete) cmp.push(`${delta(r.totals.all, r.comparison.priorSamePoint)} the same days last week (${r.comparison.priorSamePoint.toFixed(1)})`)
  if (r.comparison.priorFullWeek !== null) cmp.push(`last week's full total: ${r.comparison.priorFullWeek.toFixed(1)}`)
  if (r.comparison.trailingAvgFullWeek !== null) cmp.push(`${r.comparison.trailingWeeks}-week average: ${r.comparison.trailingAvgFullWeek.toFixed(1)}`)
  const stations = r.excludedLogins.length ? `<p class="foot">Shared logins left out of the table: ${r.excludedLogins.map(x => `${esc(x.name)} (${x.hours.toFixed(1)} hrs)`).join(', ')}.</p>` : ''
  const notCounted = r.notCounted.length ? `<p class="foot">Not counted as FOH or BOH: ${r.notCounted.map(x => `${esc(x.title)} (${x.hours.toFixed(1)} hrs)`).join(', ')}.</p>` : ''
  const money = (n: number | null) => (n === null ? '–' : `$${Math.round(n).toLocaleString('en-US')}`)
  const turn = (m: number | null) => (m === null || m <= 0 ? '–' : m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m` : `${Math.round(m)}m`)
  const prodRow = (x: FohProductivityRow, label: string) => `<tr><th scope="row">${esc(label)}${x.isStation ? '<span class="job">Shared login</span>' : ''}</th><td class="n">${x.hours !== null ? x.hours.toFixed(1) : '–'}</td><td class="n">${x.guests}</td><td class="n">${x.orders}</td><td class="n total">${money(x.netSales)}</td><td class="n">${money(x.perGuest)}</td><td class="n">${money(x.avgOrder)}</td><td class="n">${money(x.perHour)}</td><td class="n">${turn(x.turnMinutes)}</td><td class="n">${x.tipPct !== null ? `${x.tipPct.toFixed(1)}%` : '–'}</td><td class="n">${x.voids || '–'}</td></tr>`
  const productivity = r.productivity.available
    ? `<h2 style="font-size:16px;margin:22px 0 8px">Server productivity</h2>
<div class="tbl"><table>
<thead><tr><th>Employee</th><th class="n">Hours</th><th class="n">Guests</th><th class="n">Orders</th><th class="n">Net sales</th><th class="n">Per guest</th><th class="n">Avg order</th><th class="n">Sales / hr</th><th class="n">Avg turn</th><th class="n">Non-cash tips</th><th class="n">Voids</th></tr></thead>
<tbody>${r.productivity.rows.map(x => prodRow(x, x.name)).join('')}</tbody>
${r.productivity.total ? `<tfoot>${prodRow(r.productivity.total, r.productivity.total.name)}</tfoot>` : ''}
</table></div>
<p class="foot">Net sales are after discounts, before tax and tip, for every order the person rang (Toast's Employee productivity figures). Per guest = net sales ÷ guests; Sales / hr = net sales ÷ FOH hours clocked. Avg turn is order opened to paid, leaving out any order open over 8 hours. Non-cash tips are card tips as a percent of net sales plus tax. Voids are voided items. A shared login's sales are the bar's, not one person's.</p>`
    : ''
  const nearCount = r.people.filter(p => p.status === 'close').length
  const overCount = r.people.filter(p => p.status === 'over').length

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${HOURS_REPORT_CSS}
</style></head><body><main>
<h1>FOH hours — week of ${esc(fmtDate(r.weekStart))}</h1>
<p class="sub">${esc(r.restaurantName)} · Mon ${esc(fmtDate(r.weekStart))} – Sun ${esc(fmtDate(r.weekEnd))} · ${esc(through)} · from Toast time entries</p>
<div class="cards">
<div class="card"><div class="l">FOH hours</div><div class="v">${r.totals.all.toFixed(1)}</div><div class="s">${r.people.length} ${r.people.length === 1 ? 'person' : 'people'} clocked in</div></div>
<div class="card"><div class="l">Near 40 hours</div><div class="v">${nearCount + overCount}</div><div class="s">${overCount} in overtime</div></div>
${r.autoClockOuts.shifts ? `<div class="card"><div class="l">Auto clock-outs</div><div class="v">${r.autoClockOuts.shifts}</div><div class="s">${r.autoClockOuts.people} ${r.autoClockOuts.people === 1 ? 'person' : 'people'} · check in Toast</div></div>` : ''}
<div class="card"><div class="l">Guests per FOH hour</div><div class="v">${r.guestsPerHour.current !== null ? r.guestsPerHour.current.toFixed(1) : '–'}</div><div class="s">${r.guestsPerHour.lastWeek !== null ? `Last week: ${r.guestsPerHour.lastWeek.toFixed(1)}` : 'Open nights only'}</div></div>
<div class="card"><div class="l">Compared</div><div class="s" style="font-size:13px">${cmp.length ? cmp.map(esc).join('<br>') : 'Not enough history yet'}</div></div>
</div>
<div class="tbl"><table>
<thead><tr><th>Employee</th><th class="n">Total</th>${head}</tr></thead>
<tbody>${body || `<tr><td colspan="${cols}" class="closed">No front-of-house hours recorded yet.</td></tr>`}</tbody>
<tfoot><tr><th scope="row">All FOH</th><td class="n total">${r.totals.all.toFixed(1)}</td>${dayTotals}</tr><tr><th scope="row">Guests</th><td class="n total">${r.totals.covers || '–'}</td>${dayCovers}</tr></tfoot>
</table></div>
<p class="foot">Counts hours worked as ${esc(r.includedJobs.join(', ') || 'front-of-house jobs')}. Each person is grouped by the job they worked most. Managers (General Manager, Floor Manager, Wine Director) are not included. "Near 40" = ${r.thresholds.close}+ hours or overtime logged in Toast. Hours come from Toast clock-ins. Closed days (Mondays, holidays), buyout, event and off-site nights, and nights with under ${r.thresholds.minOrders} orders are marked under the date; their hours are listed but they are left out of Guests, guests per FOH hour and the productivity table. ⚠ marks a shift Toast clocked out automatically because nobody did: it usually runs long and is worth correcting in Toast. Generated ${esc(new Date(r.generatedAt).toLocaleString('en-US', { timeZone: RESTAURANT_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }))}.</p>
${productivity}
${stations}${notCounted}
</main></body></html>`
}
