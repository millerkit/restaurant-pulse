// FOH hours report for the Team › FOH Hours tab (added 2026-11-17, for the GM and the Floor
// Manager): hours worked per front-of-house employee for a Mon–Sun week, from Toast time entries
// kept by job in daily_toast_job_hours. Same data and layout as the BOH report
// (boh-hours-report.ts), which supplies the date helpers and the downloadable page's styles.
// It is about tracking hours, not cost: no dollars anywhere, so the Floor Manager can see it.
//
// "FOH" is decided by Toast job title (FOH_JOB_PATTERN), because Toast has no floor flag on a job.
// Each person is grouped (Floor, Bar, Management) by the job they worked the most hours in that
// week. Jobs with hours that are neither FOH nor BOH are returned (notCounted), not dropped
// silently, so a newly created Toast job title gets noticed.
// Shared station logins (staff override "excluded", e.g. "Service Bar") are not people: they are
// left out of the table and listed in excludedLogins instead.
import site from '../../app/config/site.json'
import {
  BOH_JOB_PATTERN, RESTAURANT_TIME_ZONE, HOURS_REPORT_CSS, addDays, mondayOf, localToday, round1, esc, fmtH, fmtDate
} from './boh-hours-report'
import { loadStaffOverrides, staffKeys } from './staff-overrides'

export const FOH_JOB_PATTERN = /^(server|(lead |service )?bartender|bar ?prep|bar ?back|concierge|host|hostess|floor manager|general manager|wine director|sommelier|service captain|captain|cater-waiter|food runner|runner|busser|maitre)/i
const BAR_JOB_PATTERN = /^((lead |service )?bartender|bar ?prep|bar ?back)/i
const MANAGEMENT_JOB_PATTERN = /^(floor manager|general manager|wine director|sommelier|maitre)/i
// Toast starts overtime after 40 hours in the week; "close" is a heads-up band. Rare in the front of house.
const OVERTIME_LINE_HOURS = 40
const CLOSE_TO_OVERTIME_HOURS = 36
const TRAILING_WEEKS = 4
// A day counts as open at this many covers (same rule as the rest of the app).
const MIN_COVERS_FOR_OPEN_DAY = 15

export type FohGroupKey = 'floor' | 'bar' | 'management'
const GROUPS: { key: FohGroupKey, label: string }[] = [
  { key: 'floor', label: 'Floor' },
  { key: 'bar', label: 'Bar' },
  { key: 'management', label: 'Management' }
]
const groupOfJob = (title: string): FohGroupKey => (MANAGEMENT_JOB_PATTERN.test(title) ? 'management' : BAR_JOB_PATTERN.test(title) ? 'bar' : 'floor')

export interface FohDay { date: string, label: string, isClosedDay: boolean, elapsed: boolean }
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
  thresholds: { overtime: number, close: number }
  generatedAt: string
}

interface JobHourRow { date: string, guid: string, title: string, regular: number, overtime: number, autoShifts: number, autoHours: number }

export function buildFohHoursReport(requestedWeek?: string | null): FohHoursReport {
  const db = useDb()
  const generatedAt = new Date().toISOString()
  const base = {
    restaurantName: site.restaurantName,
    groups: GROUPS,
    thresholds: { overtime: OVERTIME_LINE_HOURS, close: CLOSE_TO_OVERTIME_HOURS },
    generatedAt
  }
  const range = db.prepare('SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM daily_toast_job_hours').get() as { minDate: string | null, maxDate: string | null }
  const emptyDays = (start: string): FohDay[] => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i)
    return { date, label: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' }), isClosedDay: i === 0, elapsed: false }
  })
  const noGuests = { current: null, lastWeek: null, trailingAvg: null }
  if (!range.minDate || !range.maxDate) {
    const emptyWeek = mondayOf(localToday())
    return {
      ...base, hasData: false, weekStart: emptyWeek, weekEnd: addDays(emptyWeek, 6), asOf: null, weekComplete: false,
      days: emptyDays(emptyWeek), people: [], autoClockOuts: { people: 0, shifts: 0 },
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
  // Station logins out, so every figure below (totals, comparisons) counts people only.
  const fohRowsFor = (from: string, to: string) => rowsFor(from, to).filter(r => isFoh(r.title) && !stationGuids.has(r.guid))

  const rows = rowsFor(weekStart, weekEnd)
  const fohRows = rows.filter(r => isFoh(r.title) && !stationGuids.has(r.guid))

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

  // Guests on open nights, from the Toast covers sync (see CLAUDE.md: a day is open at 15+ covers).
  const coversOn = (from: string, to: string) => {
    const m = new Map<string, number>()
    for (const r of db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date BETWEEN ? AND ?').all(from, to) as { date: string, covers: number }[]) {
      if (r.covers >= MIN_COVERS_FOR_OPEN_DAY) m.set(r.date, r.covers)
    }
    return m
  }
  const coversByDay = Object.fromEntries(coversOn(weekStart, weekEnd))
  const coversTotal = Object.values(coversByDay).reduce((s, v) => s + v, 0)
  // Guests ÷ FOH hours, counting only the open nights that have both.
  const perHour = (from: string, to: string): number | null => {
    const covers = coversOn(from, to)
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
  for (const r of rows) if (!isFoh(r.title) && !BOH_JOB_PATTERN.test(r.title)) notCountedMap.set(r.title, (notCountedMap.get(r.title) ?? 0) + hoursOf(r))
  const stationMap = new Map<string, number>()
  for (const r of rows) if (isFoh(r.title) && stationGuids.has(r.guid)) stationMap.set(names.get(r.guid) ?? 'Unknown login', (stationMap.get(names.get(r.guid) ?? 'Unknown login') ?? 0) + hoursOf(r))

  const jobTitles = (db.prepare('SELECT title FROM toast_jobs WHERE deleted = 0 ORDER BY title').all() as { title: string }[]).map(j => j.title)
  const thisMonday = mondayOf(range.maxDate)

  return {
    ...base,
    hasData: true,
    weekStart,
    weekEnd,
    asOf,
    weekComplete,
    days: emptyDays(weekStart).map((d, i) => ({ ...d, elapsed: i < elapsedDays })),
    people,
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
  const head = r.days.map(d => `<th class="n${d.isClosedDay ? ' closed' : ''}">${esc(d.label)}</th>`).join('')
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
  const dayCovers = r.days.map(d => `<td class="n${d.isClosedDay ? ' closed' : ''}">${fmtH(r.totals.coversByDay[d.date] ?? 0).replace(/\.0$/, '')}</td>`).join('')
  const cmp: string[] = []
  if (r.comparison.priorSamePoint !== null && r.asOf && !r.weekComplete) cmp.push(`${delta(r.totals.all, r.comparison.priorSamePoint)} the same days last week (${r.comparison.priorSamePoint.toFixed(1)})`)
  if (r.comparison.priorFullWeek !== null) cmp.push(`last week's full total: ${r.comparison.priorFullWeek.toFixed(1)}`)
  if (r.comparison.trailingAvgFullWeek !== null) cmp.push(`${r.comparison.trailingWeeks}-week average: ${r.comparison.trailingAvgFullWeek.toFixed(1)}`)
  const stations = r.excludedLogins.length ? `<p class="foot">Shared logins left out of the table: ${r.excludedLogins.map(x => `${esc(x.name)} (${x.hours.toFixed(1)} hrs)`).join(', ')}.</p>` : ''
  const notCounted = r.notCounted.length ? `<p class="foot">Not counted as FOH or BOH: ${r.notCounted.map(x => `${esc(x.title)} (${x.hours.toFixed(1)} hrs)`).join(', ')}.</p>` : ''
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
<p class="foot">Counts hours worked as ${esc(r.includedJobs.join(', ') || 'front-of-house jobs')}. Each person is grouped by the job they worked most. "Near 40" = ${r.thresholds.close}+ hours or overtime logged in Toast. Hours come from Toast clock-ins. ⚠ marks a shift Toast clocked out automatically because nobody did: it usually runs long and is worth correcting in Toast. Generated ${esc(new Date(r.generatedAt).toLocaleString('en-US', { timeZone: RESTAURANT_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }))}.</p>
${stations}${notCounted}
</main></body></html>`
}
