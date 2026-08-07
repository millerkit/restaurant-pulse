// Backs the Capacity Pace page (app/pages/capacity/index.vue): for a set of
// short periods (last week, this week, last month, this month) and for each
// calendar month, are we actually filling the room at the rate we've
// assumed, and are guests spending the per-cover amount we've assumed — the
// two rate assumptions capacity_areas/capacity_area_seasonality encode. See
// CLAUDE.md's Capacity Pace tab section.
//
// Reframed 2026-08-07 from a revenue-projection-vs-actual view (that's
// already covered by the Budget/P&L tabs) to an assumption-testing view:
// fill % and per-cover $ are both already rate metrics (not cumulative
// totals), so a period that's only partially elapsed can be compared
// directly against the assumed rate without any projection/scale-up math —
// actual-to-date ÷ capacity-to-date is already a fair "pace" figure.
//
// Same day: the projection model itself moved from one blended
// expected_pct applied uniformly to every area, to a real per-area,
// per-month expected_covers figure (capacity_area_seasonality) — the user
// pointed out the blended per-cover $ looked low and wanted to see (and
// edit) each area's own assumed nightly covers directly rather than one %
// standing in for every area. See schema.sql's capacity_area_seasonality
// comment.
//
// "As of" mirrors dashboard.get.ts: the latest date actually present in
// daily_line_items, not wall-clock "today."
type AreaRow = {
  id: number, name: string, seats: number, max_turns_per_night: number,
  capacity_nov_apr: number | null, capacity_may_oct: number | null,
  per_cover_revenue: number, notes: string | null
}
type HolidayRow = { month: number, holiday_closures: number }
type AreaMonthRow = { area_id: number, month: number, expected_covers: number }

function isMayThroughOct(month: number): boolean {
  return month >= 5 && month <= 10
}
// Urban Hearth is closed Mondays (see CLAUDE.md) — UTC-based so this is
// deterministic regardless of the server's own timezone.
function isOperatingDow(year: number, month: number, day: number): boolean {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// Monday on/before isoDate — the start of the calendar week containing it.
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  return addDaysIso(iso, dow === 0 ? -6 : 1 - dow)
}
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function monthRange(year: number, month: number): { start: string, end: string } {
  const mm = String(month).padStart(2, '0')
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}` }
}

export default defineEventHandler(() => {
  const db = useDb()
  const areas = db.prepare('SELECT * FROM capacity_areas ORDER BY id').all() as AreaRow[]
  const holidayRows = db.prepare('SELECT * FROM capacity_seasonality ORDER BY month').all() as HolidayRow[]
  const holidaysByMonth = new Map(holidayRows.map(r => [r.month, r.holiday_closures]))
  const areaMonthRows = db.prepare('SELECT * FROM capacity_area_seasonality').all() as AreaMonthRow[]
  const areaMonth = new Map(areaMonthRows.map(r => [`${r.area_id}:${r.month}`, r.expected_covers]))

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  if (!asOfDate) {
    return { asOfDate: null, asOfYear: null, asOfMonth: null, asOfDay: null, areas, periods: null, months: [] }
  }
  const [asOfYear, asOfMonth] = asOfDate.split('-').map(Number)

  function areaCapacity(area: AreaRow, month: number): number {
    const cap = isMayThroughOct(month) ? area.capacity_may_oct : area.capacity_nov_apr
    return cap ?? 0
  }
  // Expected covers/revenue for a month, summed across every area's own
  // expected_covers (the real editable projection input) — plus the raw
  // max capacity (every seat, every turn) used as the fill % denominator.
  function nightlyExpectedForMonth(month: number) {
    let covers = 0, revenue = 0, maxCovers = 0
    for (const area of areas) {
      const c = areaMonth.get(`${area.id}:${month}`) ?? 0
      covers += c
      revenue += c * area.per_cover_revenue
      maxCovers += areaCapacity(area, month)
    }
    return { covers, revenue, maxCovers }
  }

  // Day-by-day sum over [startIso, endIso] — handles a range spanning a
  // month boundary (different area assumptions on each side) correctly,
  // since each day's own month determines its rate. Does NOT account for
  // holiday_closures (a flat monthly count, not tied to a specific date —
  // see schema.sql) — see holidayAdjustment below for the one case (an
  // exact full calendar month) where that count can be applied precisely.
  function dayByDaySum(startIso: string, endIso: string) {
    let expectedCovers = 0, expectedRevenue = 0, maxCovers = 0, operatingDays = 0
    let d = new Date(`${startIso}T00:00:00Z`)
    const end = new Date(`${endIso}T00:00:00Z`)
    while (d <= end) {
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate()
      if (isOperatingDow(y, m, day)) {
        const nightly = nightlyExpectedForMonth(m)
        expectedCovers += nightly.covers
        expectedRevenue += nightly.revenue
        maxCovers += nightly.maxCovers
        operatingDays++
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }
    return { expectedCovers, expectedRevenue, maxCovers, operatingDays }
  }

  // Only applies when [startIso, endIso] is exactly one full calendar
  // month — the one case where a flat monthly holiday_closures count can
  // be applied precisely, by subtracting that many nights' worth of that
  // month's own rate from the day-by-day sum above.
  function holidayAdjustment(startIso: string, endIso: string) {
    const [y1, m1, d1] = startIso.split('-').map(Number)
    const [y2, m2, d2] = endIso.split('-').map(Number)
    if (y1 !== y2 || m1 !== m2 || d1 !== 1 || d2 !== daysInMonth(y1, m1)) return null
    const holidayClosures = holidaysByMonth.get(m1) ?? 0
    if (holidayClosures === 0) return null
    const nightly = nightlyExpectedForMonth(m1)
    return {
      covers: nightly.covers * holidayClosures,
      revenue: nightly.revenue * holidayClosures,
      maxCovers: nightly.maxCovers * holidayClosures,
      days: holidayClosures
    }
  }

  // The assumed/target side for a date range: expected covers/revenue, raw
  // max capacity (the "every seat every turn" denominator), and the two
  // rate assumptions themselves (assumedFillPct, assumedAvgCheck) — a
  // weighted blend across the range's own days, so this stays correct even
  // for a range spanning a month boundary.
  function assumedForRange(startIso: string, endIso: string) {
    const sum = dayByDaySum(startIso, endIso)
    const adj = holidayAdjustment(startIso, endIso)
    const expectedCovers = sum.expectedCovers - (adj?.covers ?? 0)
    const expectedRevenue = sum.expectedRevenue - (adj?.revenue ?? 0)
    const maxCapacityCovers = sum.maxCovers - (adj?.maxCovers ?? 0)
    const operatingDays = sum.operatingDays - (adj?.days ?? 0)
    return {
      operatingDays,
      expectedCovers,
      expectedRevenue,
      maxCapacityCovers,
      assumedFillPct: maxCapacityCovers > 0 ? expectedCovers / maxCapacityCovers : null,
      assumedAvgCheck: expectedCovers > 0 ? expectedRevenue / expectedCovers : null
    }
  }

  function actualCoversRevenue(startIso: string, endIso: string) {
    const coversRow = db.prepare(
      'SELECT SUM(covers) AS covers, COUNT(*) AS days FROM daily_toast_metrics WHERE date BETWEEN ? AND ?'
    ).get(startIso, endIso) as { covers: number | null, days: number }
    const revenueRow = db.prepare(`
      SELECT SUM(dli.amount) AS revenue FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.category = 'revenue' AND dli.date BETWEEN ? AND ?
    `).get(startIso, endIso) as { revenue: number | null }
    return { covers: coversRow.covers, revenue: revenueRow.revenue, toastDaysSynced: coversRow.days }
  }

  // The actual side, capped at asOfDate so a still-in-progress period
  // compares actual-to-date against capacity-to-date — both sides use the
  // same shortened range, so the resulting rate is already fair to compare
  // against the (date-range-independent) assumed rate, no scale-up needed.
  // Returns null if the range hasn't started yet at all (a future month).
  function actualForRange(startIso: string, endIso: string) {
    if (startIso > asOfDate) return null
    const cappedEnd = endIso > asOfDate ? asOfDate : endIso
    const actual = actualCoversRevenue(startIso, cappedEnd)
    const cap = assumedForRange(startIso, cappedEnd)
    return {
      throughDate: cappedEnd,
      covers: actual.covers,
      revenue: actual.revenue,
      toastDaysSynced: actual.toastDaysSynced,
      maxCapacityCovers: cap.maxCapacityCovers,
      actualFillPct: actual.covers != null && cap.maxCapacityCovers > 0 ? actual.covers / cap.maxCapacityCovers : null,
      actualAvgCheck: actual.covers ? (actual.revenue ?? 0) / actual.covers : null
    }
  }

  function periodFor(startIso: string, endIso: string) {
    return {
      start: startIso,
      end: endIso,
      isFuture: startIso > asOfDate,
      isCurrent: startIso <= asOfDate && asOfDate < endIso,
      assumed: assumedForRange(startIso, endIso),
      actual: actualForRange(startIso, endIso)
    }
  }

  // ---- The four quick-look periods -----------------------------------
  const thisWeekStart = mondayOf(asOfDate)
  const thisWeekEnd = addDaysIso(thisWeekStart, 6)
  const lastWeekStart = addDaysIso(thisWeekStart, -7)
  const lastWeekEnd = addDaysIso(thisWeekStart, -1)
  const thisMonthRange = monthRange(asOfYear, asOfMonth)
  const lastMonthYear = asOfMonth === 1 ? asOfYear - 1 : asOfYear
  const lastMonthNum = asOfMonth === 1 ? 12 : asOfMonth - 1
  const lastMonthRange = monthRange(lastMonthYear, lastMonthNum)

  const periods = {
    lastWeek: { ...periodFor(lastWeekStart, lastWeekEnd), label: `${lastWeekStart} – ${lastWeekEnd}` },
    thisWeek: { ...periodFor(thisWeekStart, thisWeekEnd), label: `${thisWeekStart} – ${thisWeekEnd}` },
    lastMonth: { ...periodFor(lastMonthRange.start, lastMonthRange.end), month: lastMonthNum, year: lastMonthYear },
    thisMonth: { ...periodFor(thisMonthRange.start, thisMonthRange.end), month: asOfMonth, year: asOfYear }
  }

  // ---- Full year, month by month (for the month-tab detail view) ------
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const { start, end } = monthRange(asOfYear, month)
    return {
      month,
      holidayClosures: holidaysByMonth.get(month) ?? 0,
      ...periodFor(start, end)
    }
  })

  return { asOfDate, asOfYear, asOfMonth, areas, periods, months }
})
