import { loadReplacedNights } from '../utils/special-nights'
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
import { CORE_REVENUE_ACCOUNT_NUMBERS } from '../utils/core-revenue'

type AreaRow = {
  id: number, name: string, seats: number, max_turns_per_night: number,
  capacity_nov_apr: number | null, capacity_may_oct: number | null,
  per_cover_revenue_food: number, per_cover_revenue_beverage: number, notes: string | null,
  closed_dows: string | null, closed_from: string | null, closure_recapture_pct: number
}

// Tue-Sun: the restaurant's regular service nights (Monday is the standing closure).
const SERVICE_NIGHTS_PER_WEEK = 6
// Weekly closure of one area (capacity_areas.closed_dows/closed_from — see schema.sql).
// Before closed_from, or with no closure configured, uplift is 1 and nothing changes.
// After it, the area is dark on its closed weekdays and its other nights carry
// recapture% of the closed nights' covers: with `closed` closed nights a week,
// weekly covers become base*(6 - closed*(1-r)), spread over the 6-closed open nights.
function closureOn(area: AreaRow, iso: string, dow: number): { closedToday: boolean, uplift: number } {
  if (!area.closed_from || iso < area.closed_from || !area.closed_dows) return { closedToday: false, uplift: 1 }
  const closed = new Set(area.closed_dows.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6 && n !== 1))
  if (closed.size === 0) return { closedToday: false, uplift: 1 }
  const open = SERVICE_NIGHTS_PER_WEEK - closed.size
  const r = Math.min(1, Math.max(0, (area.closure_recapture_pct ?? 0) / 100))
  return {
    closedToday: closed.has(dow),
    uplift: open > 0 ? (SERVICE_NIGHTS_PER_WEEK - closed.size * (1 - r)) / open : 1
  }
}
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

export default defineEventHandler((event) => {
  const db = useDb()
  // Optional ?year= — only changes which calendar year the 12-month `months` array covers
  // (operating days and the assumed Food/Beverage revenue depend on that year's calendar), so
  // the Revenue tab can plan next year from the same Capacity assumptions. Actuals, the
  // quick-look periods and everything else stay on the as-of year.
  const requestedYear = Number(getQuery(event).year)
  const areas = db.prepare('SELECT * FROM capacity_areas ORDER BY id').all() as AreaRow[]
  const areaMonthRows = db.prepare('SELECT * FROM capacity_area_seasonality').all() as AreaMonthRow[]
  const areaMonth = new Map(areaMonthRows.map(r => [`${r.area_id}:${r.month}`, r.expected_covers]))

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  if (!asOfDate) {
    return { asOfDate: null, asOfYear: null, asOfMonth: null, asOfDay: null, areas, periods: null, months: [], trailing28: null }
  }
  const [asOfYear, asOfMonth] = asOfDate.split('-').map(Number)
  const monthsYear = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100 ? requestedYear : asOfYear
  // Holidays and special nights that replace normal dinner service (2026-11-08):
  // such a night has no regular covers and is worth its own expected dine-in
  // revenue ($0 for a holiday, closure or off-site night). Buyouts stay normal
  // nights here; the Sales Plan's buyout panel adds the price above a normal
  // night. Replaces the old flat per-month holiday count.
  const replaced = loadReplacedNights(db, `${Math.min(asOfYear, monthsYear) - 1}-01-01`, `${Math.max(asOfYear, monthsYear) + 1}-12-31`)

  function areaCapacity(area: AreaRow, month: number): number {
    const cap = isMayThroughOct(month) ? area.capacity_may_oct : area.capacity_nov_apr
    return cap ?? 0
  }
  // Expected covers/revenue for a month, summed across every area's own
  // expected_covers (the real editable projection input) — plus the raw
  // max capacity (every seat, every turn) used as the fill % denominator.
  // revenue is split Food/Beverage (per_cover_revenue_food/
  // per_cover_revenue_beverage — see schema.sql's capacity_areas comment)
  // so the Edit Budget page's "Recompute Revenue from Capacity" action (see
  // CLAUDE.md) has a real target for each of the Food (4010) and Beverage
  // (4022/4024/4026/4028) revenue account groups, not just a blended total.
  // revenue is always revenueFood + revenueBeverage.
  // One area's expected covers / capacity on a specific date, or null if the
  // area is dark that day (weekly closure — see closureOn). The stored
  // expected_covers is the pre-closure per-Tue-Sun-night baseline; the
  // closure uplift is applied here, capped at the area's nightly capacity.
  function areaExpectedOn(area: AreaRow, iso: string) {
    const [y, m, day] = iso.split('-').map(Number)
    const closure = closureOn(area, iso, new Date(Date.UTC(y, m - 1, day)).getUTCDay())
    if (closure.closedToday) return null
    const cap = areaCapacity(area, m)
    let covers = areaMonth.get(`${area.id}:${m}`) ?? 0
    if (closure.uplift !== 1) covers = Math.min(covers * closure.uplift, cap)
    return { covers, maxCovers: cap }
  }
  function nightlyExpectedOn(iso: string) {
    let covers = 0, revenueFood = 0, revenueBeverage = 0, maxCovers = 0
    for (const area of areas) {
      const e = areaExpectedOn(area, iso)
      if (!e) continue
      covers += e.covers
      revenueFood += e.covers * area.per_cover_revenue_food
      revenueBeverage += e.covers * area.per_cover_revenue_beverage
      maxCovers += e.maxCovers
    }
    return { covers, revenue: revenueFood + revenueBeverage, revenueFood, revenueBeverage, maxCovers }
  }
  // Average nightly figures across a full calendar month's service nights —
  // what a flat "holiday closure" night is worth, now that nights differ by weekday.
  function dayByDaySum(startIso: string, endIso: string) {
    let expectedCovers = 0, expectedRevenue = 0, expectedRevenueFood = 0, expectedRevenueBeverage = 0, maxCovers = 0, operatingDays = 0, replacedNights = 0
    let d = new Date(`${startIso}T00:00:00Z`)
    const end = new Date(`${endIso}T00:00:00Z`)
    while (d <= end) {
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate()
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const planned = isOperatingDow(y, m, day) ? replaced.get(iso) : undefined
      if (planned) {
        // Replaced night: its expected dine-in revenue, split food/beverage
        // like a normal night that date.
        const normal = nightlyExpectedOn(iso)
        const foodShare = normal.revenue > 0 ? normal.revenueFood / normal.revenue : 0.5
        expectedRevenue += planned.expectedRevenue
        expectedRevenueFood += planned.expectedRevenue * foodShare
        expectedRevenueBeverage += planned.expectedRevenue * (1 - foodShare)
        replacedNights++
      } else if (isOperatingDow(y, m, day)) {
        const nightly = nightlyExpectedOn(iso)
        expectedCovers += nightly.covers
        expectedRevenue += nightly.revenue
        expectedRevenueFood += nightly.revenueFood
        expectedRevenueBeverage += nightly.revenueBeverage
        maxCovers += nightly.maxCovers
        operatingDays++
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }
    return { expectedCovers, expectedRevenue, expectedRevenueFood, expectedRevenueBeverage, maxCovers, operatingDays, replacedNights }
  }

  // Only applies when [startIso, endIso] is exactly one full calendar
  // month — the one case where a flat monthly holiday_closures count can
  // be applied precisely, by subtracting that many nights' worth of that
  // month's own rate from the day-by-day sum above.
  function assumedForRange(startIso: string, endIso: string) {
    const sum = dayByDaySum(startIso, endIso)
    const { expectedCovers, expectedRevenue, expectedRevenueFood, expectedRevenueBeverage, operatingDays, replacedNights } = sum
    const maxCapacityCovers = sum.maxCovers
    return {
      operatingDays,
      replacedNights,
      expectedCovers,
      expectedRevenue,
      // Food/Beverage split of expectedRevenue — see nightlyExpectedOn
      // above — consumed by the Edit Budget page's "Recompute Revenue from
      // Capacity" action, which only ever calls this for a full calendar
      // month (see CLAUDE.md).
      expectedRevenueFood,
      expectedRevenueBeverage,
      maxCapacityCovers,
      assumedFillPct: maxCapacityCovers > 0 ? expectedCovers / maxCapacityCovers : null,
      assumedAvgCheck: expectedCovers > 0 ? expectedRevenue / expectedCovers : null
    }
  }

  // Revenue is core dine-in food/beverage only (CORE_REVENUE_ACCOUNT_NUMBERS)
  // — deliberately NOT all category='revenue' rows. Event Sales, Catering,
  // Retail, and Other Service Income land as large uneven lumps (a single
  // catering booking can be $20-25K/week) with few or no matching Toast
  // covers, which massively inflates the per-cover figure this page exists
  // to sanity-check. Same "core dine-in" definition the Dashboard and the
  // Historical tab already use — see server/utils/core-revenue.ts.
  function actualCoversRevenue(startIso: string, endIso: string) {
    const coversRow = db.prepare(
      'SELECT SUM(covers) AS covers, COUNT(*) AS days FROM daily_toast_metrics WHERE date BETWEEN ? AND ?'
    ).get(startIso, endIso) as { covers: number | null, days: number }
    const placeholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
    const revenueRow = db.prepare(`
      SELECT SUM(dli.amount) AS revenue FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.account_number IN (${placeholders}) AND a.is_active = 1 AND dli.date BETWEEN ? AND ?
    `).get(...CORE_REVENUE_ACCOUNT_NUMBERS, startIso, endIso) as { revenue: number | null }
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
      operatingDays: cap.operatingDays,
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

  // Per-area breakdown for a single calendar month — backs the Capacity
  // Pace page's "By Area" cards, which replaced the old static reference
  // table of raw capacity/turns/per-cover assumptions (moved to a plain
  // link to the Edit Capacity page instead). Assumed covers/night and
  // per-cover $ are already nightly/per-cover rate figures (see
  // capacity_area_seasonality's own comment in schema.sql), so no
  // operating-day math is needed on that side. The actual side divides by
  // the count of dates daily_toast_area_metrics actually has a row for
  // that area (the sync only ever writes a row when that area saw real
  // covers that night — see toast-metrics-sync.ts) rather than the
  // whole-restaurant operating-day count, so a closed season (e.g.
  // Outdoor in winter) naturally divides by however many real nights it
  // was actually open, not every operating night in the month.
  function actualAreaForMonth(startIso: string, endIso: string) {
    if (startIso > asOfDate) return null
    const cappedEnd = endIso > asOfDate ? asOfDate : endIso
    const rows = db.prepare(`
      SELECT area_id AS areaId, SUM(covers) AS covers, SUM(revenue) AS revenue, COUNT(*) AS nights
      FROM daily_toast_area_metrics
      WHERE date BETWEEN ? AND ?
      GROUP BY area_id
    `).all(startIso, cappedEnd) as { areaId: number, covers: number, revenue: number, nights: number }[]
    return new Map(rows.map(r => [r.areaId, r]))
  }
  // Per-area, per-weekday covers/nights (0 = Sunday ... 6 = Saturday), so the
  // client can weight a short window by the target month's weekday mix.
  function weekdayCoversForRange(startIso: string, endIso: string) {
    const cappedEnd = endIso > asOfDate ? asOfDate : endIso
    const out = new Map<number, Record<number, { covers: number, nights: number }>>()
    if (startIso > cappedEnd) return out
    const rows = db.prepare(`
      SELECT area_id AS areaId, CAST(strftime('%w', date) AS INTEGER) AS dow, SUM(covers) AS covers, COUNT(*) AS nights
      FROM daily_toast_area_metrics
      WHERE date BETWEEN ? AND ?
      GROUP BY area_id, dow
    `).all(startIso, cappedEnd) as { areaId: number, dow: number, covers: number, nights: number }[]
    for (const r of rows) {
      if (!out.has(r.areaId)) out.set(r.areaId, {})
      out.get(r.areaId)![r.dow] = { covers: r.covers, nights: r.nights }
    }
    return out
  }
  function areaBreakdownForMonth(month: number, startIso: string, endIso: string) {
    const actualByArea = actualAreaForMonth(startIso, endIso)
    const byWeekday = weekdayCoversForRange(startIso, endIso)
    // Assumed covers/night per night the AREA is open in the range (a weekly
    // closure shortens its week, and lifts its other nights), the same unit as
    // actualCoversPerNight below, which divides by nights with data.
    const assumedPerOpenNight = (a: AreaRow): number => {
      let sum = 0, nights = 0
      for (let d = new Date(`${startIso}T00:00:00Z`); d <= new Date(`${endIso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        if (d.getUTCDay() === 1) continue
        const e = areaExpectedOn(a, d.toISOString().slice(0, 10))
        if (!e) continue
        sum += e.covers
        nights++
      }
      return nights > 0 ? sum / nights : (areaMonth.get(`${a.id}:${month}`) ?? 0)
    }
    return areas.map((a) => {
      const act = actualByArea?.get(a.id)
      const actualCovers = act?.covers ?? null
      const actualNights = act?.nights ?? 0
      return {
        areaId: a.id,
        areaName: a.name,
        assumedCoversPerNight: assumedPerOpenNight(a),
        assumedPerCover: a.per_cover_revenue_food + a.per_cover_revenue_beverage,
        actualCoversPerNight: actualByArea && actualNights > 0 ? (actualCovers ?? 0) / actualNights : null,
        actualNights,
        byWeekday: byWeekday.get(a.id) ?? {},
        actualPerCover: actualByArea && actualCovers ? (act!.revenue ?? 0) / actualCovers : null
      }
    })
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
    const { start, end } = monthRange(monthsYear, month)
    return {
      month,
      // Holidays + special nights other than buyouts (named in replacedNightList)
      holidayClosures: [...replaced.values()].filter(n => n.date.startsWith(`${monthsYear}-${String(month).padStart(2, '0')}`)).length,
      replacedNightList: [...replaced.values()].filter(n => n.date.startsWith(`${monthsYear}-${String(month).padStart(2, '0')}`)).map(n => ({ date: n.date, kind: n.kind, expectedRevenue: n.expectedRevenue, name: n.holiday ?? n.note })),
      ...periodFor(start, end),
      areaBreakdown: areaBreakdownForMonth(month, start, end)
    }
  })

  // Trailing 28 days (ending at asOfDate), regardless of month boundary: lets
  // "Set by Actuals" use a meaningful sample in the first days of a month,
  // when the month-to-date figure is one or two nights (and one weekday).
  const trailing28Start = addDaysIso(asOfDate, -27)
  const trailing28 = areaBreakdownForMonth(asOfMonth, trailing28Start, asOfDate)
  const trailing28Nights = Math.max(0, ...trailing28.map(a => a.actualNights))

  return { asOfDate, asOfYear, asOfMonth, monthsYear, areas, periods, months, trailing28: { start: trailing28Start, nights: trailing28Nights, areaBreakdown: trailing28 } }
})
