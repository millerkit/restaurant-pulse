// Staff Hours report: average hours per week per employee over the trailing
// 90 days, split at the 30 hr/week full-time (benefits-eligible) line. See
// schema.sql's daily_toast_employee_hours for what the hours are.
//
// "Average" counts FULL Mon–Sun weeks only (Kit, 2026-11-19): hours in complete
// weeks divided by the number of those weeks. The week someone started in is
// dropped unless their first shift was Monday or Tuesday (closed Mondays, so
// Tuesday is the first service day), the weeks before they started don't count
// as zeros, and the current unfinished week is left out for everyone. A new hire
// with no full week yet shows 0 and a "no full week yet" note.

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
// Benefits start after this many days since an employee's start date (first
// Toast shift on record). Someone already averaging full-time but still inside
// the wait shows in "Upcoming eligibility" with the date they qualify.
const WAITING_PERIOD_DAYS = 90
// Salaried / grandfathered people and shared station logins now live in the
// staff_overrides table (Settings > Benefits eligibility rules); see
// server/utils/staff-overrides.ts for what each kind means.

type Eligibility = 'hours' | 'grandfathered' | 'salaried'

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function dow(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sunday
}
function mondayOnOrAfter(iso: string): string {
  return addDays(iso, (8 - dow(iso)) % 7)
}
// First Monday of the person's first full week: first shift on Mon/Tue keeps
// that week, a later first shift starts counting the following Monday.
function firstFullWeekStart(firstShift: string): string {
  const d = dow(firstShift)
  return d === 1 || d === 2 ? addDays(firstShift, -(d - 1)) : mondayOnOrAfter(firstShift)
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
  // Counted weeks run Mon–Sun inside the window: from its first Monday to the
  // last Sunday on or before the last synced day.
  const firstMonday = mondayOnOrAfter(effectiveStart)
  const lastSunday = addDays(windowEnd, -dow(windowEnd))

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

  const dailyRows = db.prepare(
    'SELECT employee_guid AS guid, date, hours FROM daily_toast_employee_hours WHERE date BETWEEN ? AND ?'
  ).all(effectiveStart, windowEnd) as { guid: string; date: string; hours: number }[]
  const dailyByGuid = new Map<string, { date: string; hours: number }[]>()
  for (const d of dailyRows) {
    const list = dailyByGuid.get(d.guid)
    if (list) list.push(d)
    else dailyByGuid.set(d.guid, [d])
  }

  // True start date = first shift on record (not just within the window). Only
  // trusted when we saw them start: someone whose first shift is at the very
  // start of our data may have been working long before it.
  const firstEverByGuid = new Map(
    (db.prepare('SELECT employee_guid AS guid, MIN(date) AS firstEver FROM daily_toast_employee_hours GROUP BY employee_guid').all() as
      { guid: string; firstEver: string }[]).map(r => [r.guid, r.firstEver])
  )
  const startObservedAfter = addDays(range.minDate, DATA_GAP_GRACE_DAYS)

  const { salaried: SALARIED_EMPLOYEES, grandfathered: GRANDFATHERED_EMPLOYEES, excluded: NON_PERSON_LOGIN_NAMES } = loadStaffOverrides(db)

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

      const countedFrom = [firstFullWeekStart(r.firstShift), firstMonday].sort().pop() as string
      const fullWeeks = lastSunday >= countedFrom ? (daysBetween(countedFrom, lastSunday) + 1) / 7 : 0
      const countedHours = (dailyByGuid.get(r.guid) ?? [])
        .filter(d => d.date >= countedFrom && d.date <= lastSunday)
        .reduce((sum, d) => sum + d.hours, 0)
      const avgPerWeek = fullWeeks > 0 ? countedHours / fullWeeks : 0
      const partialWindow = daysBetween(effectiveStart, r.firstShift) > PARTIAL_WINDOW_GRACE_DAYS

      const firstEver = firstEverByGuid.get(r.guid) ?? r.firstShift
      const startDate = firstEver > startObservedAfter ? firstEver : null

      return {
        guid: r.guid,
        name,
        nameMissing: !r.hasEmployeeRow,
        eligibility,
        startDate: startDate as string | null,
        eligibleOn: (startDate ? addDays(startDate, WAITING_PERIOD_DAYS) : null) as string | null,
        totalHours: r.totalHours,
        avgPerWeek,
        daysWorked: r.daysWorked,
        firstShift: r.firstShift as string | null,
        lastShift: r.lastShift as string | null,
        partialWindow,
        fullWeeks,
        countedFrom: fullWeeks > 0 ? countedFrom : null,
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
      startDate: null,
      eligibleOn: null,
      totalHours: 0,
      avgPerWeek: 0,
      daysWorked: 0,
      firstShift: null,
      lastShift: null,
      partialWindow: false,
      fullWeeks: 0,
      countedFrom: null,
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
  const qualifiesOnHours = (e: { eligibility: Eligibility; avgPerWeek: number }) =>
    e.eligibility === 'grandfathered' || e.avgPerWeek >= FULL_TIME_THRESHOLD_HOURS
  // Averaging full-time but still inside the waiting period: listed with the
  // date they become eligible, not yet in the eligible/enrollment groups.
  const upcoming = hourly
    .filter(e => e.eligibility === 'hours' && qualifiesOnHours(e) && e.eligibleOn && e.eligibleOn > windowEnd)
    .sort((a, b) => (a.eligibleOn as string).localeCompare(b.eligibleOn as string) || a.name.localeCompare(b.name))
    .map(e => ({ ...e, daysUntilEligible: daysBetween(windowEnd, e.eligibleOn as string) }))
  const fullTimeAll = hourly.filter(e => qualifiesOnHours(e) && !upcoming.some(u => u.guid === e.guid))
  const partTime = hourly.filter(e => !qualifiesOnHours(e))

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
    upcoming,
    waitingPeriodDays: WAITING_PERIOD_DAYS,
    partTime,
    excludedLogins,
    unmatchedSalaried
  }
})
