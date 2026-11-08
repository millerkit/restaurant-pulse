// BOH hours report for the Kitchen Labor tab (added 2026-11-06, for the Sous
// Chef to manage hours): hours worked per kitchen employee for a Mon–Sun week,
// from Toast time entries kept by job in daily_toast_job_hours. Hours, not
// dollars, so unlike the rest of the Kitchen Labor tab it has no payroll lag:
// it runs through the last synced day (normally yesterday).
//
// "BOH" is decided by Toast job title (BOH_JOB_PATTERN) because Toast has no
// kitchen flag on a job. Jobs with hours that don't match are returned
// (notCounted) rather than dropped silently — Bar Prep, for one, isn't counted.
// Salaried jobs (Executive Chef) are included if they clocked hours; most
// don't clock in, so they usually don't appear.
import site from '../../app/config/site.json'

const RESTAURANT_TIME_ZONE = 'America/New_York'
const BOH_JOB_PATTERN = /^(line cook|prep cook|pastry|sous chef|junior sous|executive chef|chef de partie|garde manger|dishwasher|porter|culinary intern)/i
const PORTER_JOB_PATTERN = /^porter/i
// Toast starts overtime after 40 hours in the week; "close" is a heads-up band.
const OVERTIME_LINE_HOURS = 40
const CLOSE_TO_OVERTIME_HOURS = 36
const TRAILING_WEEKS = 4

export interface BohDay { date: string; label: string; isClosedDay: boolean; elapsed: boolean }
export interface BohPerson {
  guid: string
  name: string
  jobs: string[]
  isPorter: boolean
  byDay: Record<string, number>
  total: number
  overtime: number
  status: 'over' | 'close' | 'ok'
  // Shifts Toast clocked out automatically (a forgotten clock-out), which run
  // long. autoDays are the dates they fall on, for the per-day marker.
  autoShifts: number
  autoHours: number
  autoDays: string[]
}
export interface BohHoursReport {
  restaurantName: string
  hasData: boolean
  weekStart: string
  weekEnd: string
  asOf: string | null          // last synced day within this week
  weekComplete: boolean
  days: BohDay[]
  people: BohPerson[]
  autoClockOuts: { people: number; shifts: number }
  totals: { all: number; kitchen: number; porters: number; overtime: number; byDay: Record<string, number> }
  // Same stretch of the prior week (same number of days elapsed), its full
  // total, and the average full week over the 4 weeks before this one.
  comparison: { priorSamePoint: number | null; priorFullWeek: number | null; trailingAvgFullWeek: number | null; trailingWeeks: number }
  includedJobs: string[]
  notCounted: { title: string; hours: number }[]
  prevWeek: string | null
  nextWeek: string | null
  thresholds: { overtime: number; close: number }
  generatedAt: string
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay() // 0=Sun
  return addDays(iso, -((dow + 6) % 7))
}
function localToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: RESTAURANT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const round1 = (n: number) => Math.round(n * 10) / 10

interface JobHourRow { date: string; guid: string; title: string; regular: number; overtime: number; autoShifts: number; autoHours: number }

export function buildBohHoursReport(requestedWeek?: string | null): BohHoursReport {
  const db = useDb()
  const generatedAt = new Date().toISOString()
  const base = {
    restaurantName: site.restaurantName,
    thresholds: { overtime: OVERTIME_LINE_HOURS, close: CLOSE_TO_OVERTIME_HOURS },
    generatedAt
  }
  const range = db.prepare('SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM daily_toast_job_hours').get() as { minDate: string | null; maxDate: string | null }
  const emptyWeek = mondayOf(localToday())
  const emptyDays = (start: string): BohDay[] => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i)
    return { date, label: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' }), isClosedDay: i === 0, elapsed: false }
  })
  if (!range.minDate || !range.maxDate) {
    return {
      ...base, hasData: false, weekStart: emptyWeek, weekEnd: addDays(emptyWeek, 6), asOf: null, weekComplete: false,
      days: emptyDays(emptyWeek), people: [], autoClockOuts: { people: 0, shifts: 0 }, totals: { all: 0, kitchen: 0, porters: 0, overtime: 0, byDay: {} },
      comparison: { priorSamePoint: null, priorFullWeek: null, trailingAvgFullWeek: null, trailingWeeks: 0 },
      includedJobs: [], notCounted: [], prevWeek: null, nextWeek: null
    }
  }

  // Default: the week containing the latest synced day (on a Monday that is
  // still last week, until Monday's own data arrives).
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
  const isBoh = (title: string) => BOH_JOB_PATTERN.test(title)
  const sum = (rows: JobHourRow[]) => rows.reduce((s, r) => s + r.regular + r.overtime, 0)

  const rows = rowsFor(weekStart, weekEnd)
  const bohRows = rows.filter(r => isBoh(r.title))

  const names = new Map<string, string>()
  for (const e of db.prepare('SELECT guid, first_name, last_name, chosen_name FROM toast_employees').all() as { guid: string; first_name: string | null; last_name: string | null; chosen_name: string | null }[]) {
    const first = e.chosen_name || e.first_name || ''
    names.set(e.guid, `${first} ${e.last_name ?? ''}`.trim() || 'Unknown employee')
  }

  const byPerson = new Map<string, BohPerson>()
  for (const r of bohRows) {
    const p = byPerson.get(r.guid) ?? { guid: r.guid, name: names.get(r.guid) ?? 'Unknown employee', jobs: [], isPorter: true, byDay: {}, total: 0, overtime: 0, status: 'ok' as const, autoShifts: 0, autoHours: 0, autoDays: [] as string[] }
    if (!p.jobs.includes(r.title)) p.jobs.push(r.title)
    if (!PORTER_JOB_PATTERN.test(r.title)) p.isPorter = false
    const h = r.regular + r.overtime
    p.byDay[r.date] = round1((p.byDay[r.date] ?? 0) + h)
    p.total += h
    p.overtime += r.overtime
    if (r.autoShifts > 0) {
      p.autoShifts += r.autoShifts
      p.autoHours += r.autoHours
      if (!p.autoDays.includes(r.date)) p.autoDays.push(r.date)
    }
    byPerson.set(r.guid, p)
  }
  const people = [...byPerson.values()].map((p) => {
    const total = round1(p.total)
    return { ...p, total, overtime: round1(p.overtime), autoHours: round1(p.autoHours), status: (total >= OVERTIME_LINE_HOURS || p.overtime > 0 ? 'over' : total >= CLOSE_TO_OVERTIME_HOURS ? 'close' : 'ok') as BohPerson['status'] }
  }).sort((a, b) => Number(a.isPorter) - Number(b.isPorter) || b.total - a.total || a.name.localeCompare(b.name))

  const byDay: Record<string, number> = {}
  for (const r of bohRows) byDay[r.date] = round1((byDay[r.date] ?? 0) + r.regular + r.overtime)
  // Summed from raw rows, not from the rounded per-person totals, so rounding
  // can't drift the headline numbers.
  const porterGuids = new Set(people.filter(p => p.isPorter).map(p => p.guid))
  const kitchen = sum(bohRows.filter(r => !porterGuids.has(r.guid)))
  const porters = sum(bohRows.filter(r => porterGuids.has(r.guid)))

  // Comparison: prior week up to the same weekday, and its full total.
  const priorStart = addDays(weekStart, -7)
  const priorRows = rowsFor(priorStart, addDays(priorStart, 6)).filter(r => isBoh(r.title))
  const hasPrior = range.minDate <= addDays(priorStart, 6)
  const priorSamePointEnd = addDays(priorStart, Math.max(elapsedDays, 1) - 1)
  const priorSamePoint = hasPrior && elapsedDays > 0 ? round1(sum(priorRows.filter(r => r.date <= priorSamePointEnd))) : null
  const priorFullWeek = hasPrior ? round1(sum(priorRows)) : null
  const trailing: number[] = []
  for (let i = 1; i <= TRAILING_WEEKS; i++) {
    const s = addDays(weekStart, -7 * i)
    if (range.minDate > s) break // week not fully in the synced range
    trailing.push(sum(rowsFor(s, addDays(s, 6)).filter(r => isBoh(r.title))))
  }

  const notCountedMap = new Map<string, number>()
  for (const r of rows) if (!isBoh(r.title)) notCountedMap.set(r.title, (notCountedMap.get(r.title) ?? 0) + r.regular + r.overtime)

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
    totals: { all: round1(kitchen + porters), kitchen: round1(kitchen), porters: round1(porters), overtime: round1(bohRows.reduce((s, r) => s + r.overtime, 0)), byDay },
    comparison: {
      priorSamePoint,
      priorFullWeek,
      trailingAvgFullWeek: trailing.length ? round1(trailing.reduce((s, v) => s + v, 0) / trailing.length) : null,
      trailingWeeks: trailing.length
    },
    includedJobs: [...new Set(jobTitles.filter(isBoh))],
    notCounted: [...notCountedMap].map(([title, hours]) => ({ title, hours: round1(hours) })).filter(x => x.hours > 0).sort((a, b) => b.hours - a.hours),
    prevWeek: range.minDate <= addDays(weekStart, -1) ? priorStart : null,
    nextWeek: weekStart < thisMonday ? addDays(weekStart, 7) : null
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmtH = (n: number) => (n === 0 ? '–' : n.toFixed(1))
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// Standalone page for sending (Slack etc.): inline CSS, no scripts, no app
// chrome, readable on a phone, light and dark.
export function renderBohHoursHtml(r: BohHoursReport): string {
  const title = `${r.restaurantName} — BOH hours, week of ${fmtDate(r.weekStart)}`
  const through = r.asOf ? (r.weekComplete ? 'final' : `through ${fmtDate(r.asOf)}`) : 'no hours yet'
  const delta = (cur: number, prior: number | null) => {
    if (prior === null) return ''
    const d = round1(cur - prior)
    return d === 0 ? 'same as' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} ${d > 0 ? 'more' : 'fewer'} than`
  }
  const head = r.days.map(d => `<th class="n${d.isClosedDay ? ' closed' : ''}">${esc(d.label)}</th>`).join('')
  const rowHtml = (p: BohPerson) => {
    const chip = p.status === 'over' ? '<span class="chip over">▲ In overtime</span>' : p.status === 'close' ? '<span class="chip close">◆ Near 40</span>' : ''
    const autoChip = p.autoShifts > 0 ? `<span class="chip auto">⚠ Auto clock-out${p.autoShifts > 1 ? ` ×${p.autoShifts}` : ''}</span>` : ''
    const cells = r.days.map(d => `<td class="n${d.isClosedDay ? ' closed' : ''}">${fmtH(p.byDay[d.date] ?? 0)}${p.autoDays.includes(d.date) ? '<span class="aw" title="Auto clock-out">⚠</span>' : ''}</td>`).join('')
    return `<tr><th scope="row">${esc(p.name)}<span class="job">${esc(p.jobs.join(', '))}</span>${chip}${autoChip}</th><td class="n total">${p.total.toFixed(1)}</td>${cells}</tr>`
  }
  const kitchenRows = r.people.filter(p => !p.isPorter).map(rowHtml).join('')
  const porterRows = r.people.filter(p => p.isPorter).map(rowHtml).join('')
  const dayTotals = r.days.map(d => `<td class="n${d.isClosedDay ? ' closed' : ''}">${fmtH(r.totals.byDay[d.date] ?? 0)}</td>`).join('')
  const cmp: string[] = []
  if (r.comparison.priorSamePoint !== null && r.asOf && !r.weekComplete) cmp.push(`${delta(r.totals.all, r.comparison.priorSamePoint)} the same days last week (${r.comparison.priorSamePoint.toFixed(1)})`)
  if (r.comparison.priorFullWeek !== null) cmp.push(`last week's full total: ${r.comparison.priorFullWeek.toFixed(1)}`)
  if (r.comparison.trailingAvgFullWeek !== null) cmp.push(`${r.comparison.trailingWeeks}-week average: ${r.comparison.trailingAvgFullWeek.toFixed(1)}`)
  const notCounted = r.notCounted.length ? `<p class="foot">Not counted as BOH: ${r.notCounted.map(x => `${esc(x.title)} (${x.hours.toFixed(1)} hrs)`).join(', ')}.</p>` : ''

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f6f5f2;--surface:#fff;--ink:#1d1d1b;--ink2:#4a4a46;--ink3:#7a7a74;--hair:#e4e2dc;--warn:#9a5b00;--warnbg:#fdf0d5;--crit:#a62a2a;--critbg:#fbe3e3}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--surface:#202020;--ink:#f0efea;--ink2:#c3c2bb;--ink3:#8d8c85;--hair:#34342f;--warn:#f1c066;--warnbg:#3a2e12;--crit:#ff9b9b;--critbg:#431b1b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:22px;margin:0 0 2px}.sub{color:var(--ink3);font-size:13px;margin:0 0 16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.card{background:var(--surface);border:1px solid var(--hair);border-radius:14px;padding:12px 14px}
.card .l{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3)}.card .v{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}.card .s{font-size:12px;color:var(--ink2)}
.tbl{background:var(--surface);border:1px solid var(--hair);border-radius:14px;overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:640px;font-size:14px}
th,td{padding:9px 10px;border-bottom:1px solid var(--hair);text-align:left;white-space:nowrap}
thead th{font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.03em}
.n{text-align:right;font-variant-numeric:tabular-nums}.closed{color:var(--ink3)}.total{font-weight:700}
.job{display:block;font-weight:400;font-size:12px;color:var(--ink3)}
tbody th{font-weight:600}tr.sec th{font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.03em;background:var(--bg)}
tfoot td,tfoot th{font-weight:700;border-bottom:none}
.chip{display:inline-block;margin-top:3px;font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px}
.chip.auto{background:var(--warnbg);color:var(--warn);display:block;width:fit-content}.aw{color:var(--warn);margin-left:3px;font-size:12px}
.chip.over{background:var(--critbg);color:var(--crit)}.chip.close{background:var(--warnbg);color:var(--warn)}
.foot{color:var(--ink2);font-size:12px;margin:10px 2px 0}
</style></head><body><main>
<h1>BOH hours — week of ${esc(fmtDate(r.weekStart))}</h1>
<p class="sub">${esc(r.restaurantName)} · Mon ${esc(fmtDate(r.weekStart))} – Sun ${esc(fmtDate(r.weekEnd))} · ${esc(through)} · from Toast time entries</p>
<div class="cards">
<div class="card"><div class="l">BOH hours</div><div class="v">${r.totals.all.toFixed(1)}</div><div class="s">${r.totals.kitchen.toFixed(1)} kitchen + ${r.totals.porters.toFixed(1)} porters</div></div>
<div class="card"><div class="l">Overtime hours</div><div class="v">${r.totals.overtime.toFixed(1)}</div><div class="s">${r.people.filter(p => p.status === 'over').length} in overtime · ${r.people.filter(p => p.status === 'close').length} near 40</div></div>
${r.autoClockOuts.shifts ? `<div class="card"><div class="l">Auto clock-outs</div><div class="v">${r.autoClockOuts.shifts}</div><div class="s">${r.autoClockOuts.people} ${r.autoClockOuts.people === 1 ? 'person' : 'people'} · check in Toast</div></div>` : ''}
<div class="card"><div class="l">Compared</div><div class="s" style="font-size:13px">${cmp.length ? cmp.map(esc).join('<br>') : 'Not enough history yet'}</div></div>
</div>
<div class="tbl"><table>
<thead><tr><th>Employee</th><th class="n">Total</th>${head}</tr></thead>
<tbody>${kitchenRows || `<tr><td colspan="${r.days.length + 2}" class="closed">No kitchen hours recorded yet.</td></tr>`}${porterRows ? `<tr class="sec"><th colspan="${r.days.length + 2}">Porters</th></tr>${porterRows}` : ''}</tbody>
<tfoot><tr><th scope="row">All BOH</th><td class="n total">${r.totals.all.toFixed(1)}</td>${dayTotals}</tr></tfoot>
</table></div>
<p class="foot">Counts hours worked as ${esc(r.includedJobs.join(', ') || 'kitchen jobs')}. "In overtime" = Toast logged overtime or 40+ hours; "Near 40" = ${r.thresholds.close}+ hours. Hours come from Toast clock-ins. ⚠ marks a shift Toast clocked out automatically because nobody did: it usually runs long and is worth correcting in Toast, since it can push someone into overtime. Generated ${esc(new Date(r.generatedAt).toLocaleString('en-US', { timeZone: RESTAURANT_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }))}.</p>
${notCounted}
</main></body></html>`
}
