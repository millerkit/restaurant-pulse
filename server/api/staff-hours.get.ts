// Staff Hours report: average hours per week per employee over the trailing
// 90 days, split at the 30 hr/week full-time (benefits-eligible) line. See
// schema.sql's daily_toast_employee_hours for what the hours are.
//
// "Average" is the policy's own reading — total hours in the window divided
// by the window's weeks (90 / 7) — so someone who worked 35 hrs/week for the
// last 4 weeks only averages ~11 and lands in part-time. That's correct
// against a 90-day test but misleading on its own, so a row whose first shift
// falls well inside the window also carries its pace since that first shift.

const WINDOW_DAYS = 90
const FULL_TIME_THRESHOLD_HOURS = 30
// A first shift this far past the window's start (or past where our data
// starts) counts as a partial window. Two weeks absorbs ordinary gaps, like
// a closed Monday or a week off, without flagging long-tenured staff.
const PARTIAL_WINDOW_GRACE_DAYS = 14
// Our data starting this many days after the window's start is a real gap
// (backfill not run), not just closed days at the edge.
const DATA_GAP_GRACE_DAYS = 6
// Auto clock-outs only get flagged when one happened in this many trailing
// days (user's call 2026-10-27): older ones have presumably been corrected in
// payroll already, so flagging them is noise.
const AUTO_CLOCKOUT_FLAG_DAYS = 7
// Toast logins that are a station, not a person (confirmed in local data
// 2026-10-27: "Service Bar" logs ~9 hrs a day across 76 days, 46 of them
// auto clock-outs — several people sharing one login). Counting it would
// put a fake 55 hrs/week employee at the top of the benefits list. Matched
// case-insensitively on the full display name, and always reported back to
// the page so the exclusion is visible rather than silent.
const NON_PERSON_LOGIN_NAMES = new Set(['service bar'])
// Benefits eligibility that doesn't depend on hours, named by the user
// 2026-10-27. Keys are Toast's own "first last" (not the chosen name),
// lowercased — Joshua Sokol is "Josh Sokol" in Toast. Salaried staff are
// always eligible and listed even with no hours at all (Josh doesn't clock
// in, so he has no time entries and would otherwise never appear). Katie
// Janik is a grandfathered special case: eligible regardless of her average.
const SALARIED_EMPLOYEES = new Set(['abigail taylor', 'shane allerheiligen', 'josh sokol'])
const GRANDFATHERED_EMPLOYEES = new Set(['katie janik'])

type Eligibility = 'hours' | 'grandfathered' | 'salaried'

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000)
}

interface HoursRow {
  guid: string
  totalHours: number
  daysWorked: number
  firstShift: string
  lastShift: string
  autoShifts: number
  autoHours: number
  firstName: string | null
  lastName: string | null
  chosenName: string | null
  deleted: number | null
  hasEmployeeRow: number
}

export default defineEventHandler(() => {
  const db = useDb()
  const range = db.prepare(
    'SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM daily_toast_employee_hours'
  ).get() as { minDate: string | null; maxDate: string | null }

  const base = { threshold: FULL_TIME_THRESHOLD_HOURS, windowDays: WINDOW_DAYS }
  if (!range.minDate || !range.maxDate) {
    return { ...base, hasData: false as const }
  }

  // Window ends at the last synced day (not today) so a sync that's a day
  // behind doesn't quietly shrink everyone's average by a day of zeros.
  const windowEnd = range.maxDate
  const windowStart = addDays(windowEnd, -(WINDOW_DAYS - 1))
  const dataGap = daysBetween(windowStart, range.minDate) > DATA_GAP_GRACE_DAYS
  // With a gap, average over the days we actually have, and say so.
  const effectiveStart = dataGap ? range.minDate : windowStart
  const coverageDays = daysBetween(effectiveStart, windowEnd) + 1
  const recentStart = addDays(windowEnd, -(AUTO_CLOCKOUT_FLAG_DAYS - 1))
  const weeks = coverageDays / 7

  const rows = db.prepare(`
    SELECT h.employee_guid AS guid,
           SUM(h.hours) AS totalHours,
           COUNT(*) AS daysWorked,
           MIN(h.date) AS firstShift,
           MAX(h.date) AS lastShift,
           SUM(CASE WHEN h.date >= ? THEN h.auto_clocked_out_shifts ELSE 0 END) AS autoShifts,
           SUM(CASE WHEN h.date >= ? THEN h.auto_clocked_out_hours ELSE 0 END) AS autoHours,
           e.first_name AS firstName, e.last_name AS lastName, e.chosen_name AS chosenName,
           e.deleted AS deleted,
           CASE WHEN e.guid IS NULL THEN 0 ELSE 1 END AS hasEmployeeRow
    FROM daily_toast_employee_hours h
    LEFT JOIN toast_employees e ON e.guid = h.employee_guid
    WHERE h.date BETWEEN ? AND ?
    GROUP BY h.employee_guid
  `).all(recentStart, recentStart, effectiveStart, windowEnd) as HoursRow[]

  const nameKey = (first: string | null, last: string | null) =>
    `${(first ?? '').trim()} ${(last ?? '').trim()}`.trim().toLowerCase()

  const allRows = rows
    // Former employees (removed in Toast) are omitted entirely.
    .filter(r => r.deleted !== 1)
    .map((r) => {
      const given = (r.chosenName || r.firstName || '').trim()
      const name = r.hasEmployeeRow
        ? [given, (r.lastName ?? '').trim()].filter(Boolean).join(' ') || 'Unnamed employee'
        : `Unknown employee (${r.guid.slice(0, 8)})`

      const key = nameKey(r.firstName, r.lastName)
      const eligibility: Eligibility = SALARIED_EMPLOYEES.has(key) ? 'salaried'
        : GRANDFATHERED_EMPLOYEES.has(key) ? 'grandfathered' : 'hours'

      const avgPerWeek = r.totalHours / weeks
      const partialWindow = daysBetween(effectiveStart, r.firstShift) > PARTIAL_WINDOW_GRACE_DAYS
      const weeksSinceFirstShift = (daysBetween(r.firstShift, windowEnd) + 1) / 7

      return {
        guid: r.guid,
        name,
        nameMissing: !r.hasEmployeeRow,
        eligibility,
        totalHours: r.totalHours,
        avgPerWeek,
        daysWorked: r.daysWorked,
        firstShift: r.firstShift as string | null,
        lastShift: r.lastShift as string | null,
        partialWindow,
        avgPerWeekSinceFirstShift: partialWindow ? r.totalHours / weeksSinceFirstShift : null,
        recentAutoClockOutShifts: r.autoShifts,
        recentAutoClockOutHours: r.autoHours
      }
    })

  // Salaried people with no time entries in the window still get a row.
  const listed = new Set(allRows.map(e => e.guid))
  const toastPeople = db.prepare(
    'SELECT guid, first_name AS firstName, last_name AS lastName, chosen_name AS chosenName FROM toast_employees WHERE deleted = 0'
  ).all() as { guid: string; firstName: string | null; lastName: string | null; chosenName: string | null }[]
  const foundSalaried = new Set<string>()
  for (const p of toastPeople) {
    const key = nameKey(p.firstName, p.lastName)
    if (!SALARIED_EMPLOYEES.has(key)) continue
    foundSalaried.add(key)
    if (listed.has(p.guid)) continue
    allRows.push({
      guid: p.guid,
      name: [(p.chosenName || p.firstName || '').trim(), (p.lastName ?? '').trim()].filter(Boolean).join(' '),
      nameMissing: false,
      eligibility: 'salaried',
      totalHours: 0,
      avgPerWeek: 0,
      daysWorked: 0,
      firstShift: null,
      lastShift: null,
      partialWindow: false,
      avgPerWeekSinceFirstShift: null,
      recentAutoClockOutShifts: 0,
      recentAutoClockOutHours: 0
    })
  }
  // A configured name nobody in Toast matches is a typo or a rename; say so
  // rather than quietly dropping the person from the report.
  const unmatchedSalaried = [...SALARIED_EMPLOYEES].filter(k => !foundSalaried.has(k))

  allRows.sort((a, b) => b.avgPerWeek - a.avgPerWeek || a.name.localeCompare(b.name))

  const isNonPerson = (e: { name: string }) => NON_PERSON_LOGIN_NAMES.has(e.name.trim().toLowerCase())
  const employees = allRows.filter(e => !isNonPerson(e))
  const excludedLogins = allRows.filter(isNonPerson).map(e => ({ name: e.name, totalHours: e.totalHours }))

  // Salaried staff are eligible regardless of hours, and their Toast clock-ins
  // aren't a dependable measure of the hours they work, so only names go out.
  const salariedAll = employees
    .filter(e => e.eligibility === 'salaried')
    .sort((a, b) => a.name.localeCompare(b.name))
  const hourly = employees.filter(e => e.eligibility !== 'salaried')
  // Grandfathered people sit in the full-time group whatever their average.
  const fullTimeAll = hourly.filter(e => e.eligibility === 'grandfathered' || e.avgPerWeek >= FULL_TIME_THRESHOLD_HOURS)
  const partTime = hourly.filter(e => !fullTimeAll.includes(e))

  // Every eligible person has an enrollment status: no mark means TBD (a new
  // qualifier we haven't resolved), otherwise enrolled / declined / canceled.
  // A mark on someone who isn't currently eligible (part-time) is ignored.
  type Status = 'tbd' | 'enrolled' | 'declined' | 'canceled'
  const marks = new Map(
    (db.prepare('SELECT employee_guid AS guid, status, note FROM benefits_enrollment_status').all() as
      { guid: string; status: Exclude<Status, 'tbd'>; note: string | null }[]).map(m => [m.guid, m])
  )
  const statusOf = (guid: string): Status => marks.get(guid)?.status ?? 'tbd'

  // One shape for everyone eligible. Salaried rows carry no hours (their clock-ins
  // aren't a dependable measure), so those fields are simply absent for them.
  const eligible = [
    ...salariedAll.map(e => ({ guid: e.guid, name: e.name, eligibility: 'salaried' as const, status: statusOf(e.guid), note: marks.get(e.guid)?.note ?? null })),
    ...fullTimeAll.map(e => ({ ...e, status: statusOf(e.guid), note: marks.get(e.guid)?.note ?? null }))
  ]
  const tbd = eligible.filter(e => e.status === 'tbd')
  const enrolled = eligible.filter(e => e.status === 'enrolled')
  const notEnrolled = eligible.filter(e => e.status === 'declined' || e.status === 'canceled')
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    ...base,
    hasData: true as const,
    windowStart: effectiveStart,
    windowEnd,
    coverageDays,
    dataGap,
    tbd,
    enrolled,
    notEnrolled,
    partTime,
    excludedLogins,
    unmatchedSalaried
  }
})
