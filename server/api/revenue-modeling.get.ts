// Data for the Revenue Modeling page (app/pages/revenue-modeling.vue): a
// what-if tool — given real trailing per-area covers/spend (the same real
// daily_toast_area_metrics data the Edit Capacity page's "Actual" columns
// and "Set from Actuals" button already draw from — see
// server/api/capacity/area-actuals.get.ts), what happens to annual labor %
// of revenue and profit margin if covers and/or per-cover spend change by
// some hypothetical amount, per area?
//
// This route only supplies the real inputs the client-side simulation
// needs — it doesn't do the simulation math itself:
//   - Per-area trailing-3-month covers/revenue (extending area-actuals.
//     get.ts's existing "trailing two month" blend by one more month, at
//     this page's own request for a 3-month window).
//   - The real annual count of operating nights (Tue-Sun minus holiday
//     closures — the same definition capacity.get.ts's dayByDaySum uses,
//     generalized here to a full calendar year rather than an arbitrary
//     date range, since this page needs one annualization multiplier).
//   - The real fixed/variable cost splits for labor and opex, needed to
//     scale each cost correctly as simulated revenue moves.
// The simulation itself (applying the user's typed Covers Δ%/Spend Δ% per
// area, then annualizing) lives client-side in revenue-modeling.vue,
// alongside the existing useBudgetYear()/useActualsYear() composables and
// hybridYearTotalsPastActual() — the same real current-year revenue/COGS/labor/opex
// figures the Labor tab and Budget Pace already treat as canonical (see
// CLAUDE.md's 2026-09-22 Labor tab fix) — rather than this route deriving
// its own separate notion of "this year's revenue."
//
// Buyout events (added 2026-09-24, after the user asked to model buyouts on
// this page too — see CLAUDE.md's "Urban Hearth catering buyout budget
// review" session, which built the Revenue tab's persisted, per-month
// buyout planner this reuses): the same real buyout_rates and weekday
// normal-night targets (server/utils/buyout-rates.ts) that back that
// planner, but consumed here as a per-weekday *annual* count instead of a
// monthly one, since this whole page already thinks in annualized terms.
// Unlike the Revenue tab, this page's buyout counts are never persisted —
// they're scratch what-if state, reset the same way the per-area covers/
// spend deltas already are, not a real plan written to budget_targets.
//
// Fixed vs. variable shares are both computed over the same "since the
// location move" window nightly-margin.get.ts/weekly-targets.ts already use
// (NEW_LOCATION_START through asOfDate) — the only stretch of real data at
// this restaurant's current scale/location, so blending in the old,
// smaller location's cost structure would distort the ratio. That *ratio*
// (not a dollar figure) is applied client-side to the current year's hybrid
// (actual-where-elapsed, budget-otherwise) annual dollar total — the same
// "derive a rate from a trailing window, apply it to an annual baseline"
// pattern the Historical tab's "Set by History"/dataAnnualFillPct already
// established.
//
// Labor's variable share is hourly wages only (BOH/FOH Wages subcategories
// — the same split nightly-margin.get.ts uses for its own hourly-labor-rate
// estimate): Management Salaries/Employee Benefits/Employer Payroll Taxes
// are paid whether covers go up or not, so they're the fixed share here.
// Opex's variable share is accounts.cost_behavior='variable' (the same
// fixed/variable split the Opex Drill-Down/Overspending section already
// use) — Occupancy/Insurance/Interest etc. don't move with revenue, while
// marketing/repairs/supplies/admin roughly do.

function isOperatingDow(year: number, month: number, day: number): boolean {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1
}
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function monthRange(year: number, month: number): { start: string, end: string } {
  const mm = String(month).padStart(2, '0')
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}` }
}
function monthsBack(year: number, month: number, n: number): { year: number, month: number } {
  let m = month - n
  let y = year
  while (m < 1) { m += 12; y -= 1 }
  return { year: y, month: m }
}
// Real annual count of operating nights for a calendar year — Tue-Sun (the
// standing Monday closure) minus each month's own holiday_closures count.
// Same definition as capacity.get.ts's dayByDaySum/holidayAdjustment,
// generalized here to the whole year rather than an arbitrary date range,
// since this page needs a single annualization multiplier rather than a
// period-by-period one.
function annualOperatingNights(year: number, holidaysByMonth: Map<number, number>): number {
  let nights = 0
  for (let month = 1; month <= 12; month++) {
    let monthNights = 0
    for (let day = 1; day <= daysInMonth(year, month); day++) {
      if (isOperatingDow(year, month, day)) monthNights++
    }
    nights += Math.max(0, monthNights - (holidaysByMonth.get(month) ?? 0))
  }
  return nights
}

type AreaRow = { id: number, name: string }
type AreaTrailing = {
  areaId: number, areaName: string, covers: number, revenue: number, nights: number,
  coversPerNight: number | null, perCover: number | null
}

const TREND_WEEKS = 12
type AreaTrend = {
  areaId: number, areaName: string, capacity: number | null,
  recent4WeekCoversPerNight: number | null,
  points: { weekStart: string, nights: number, coversPerNight: number | null }[]
}

export default defineEventHandler(() => {
  const db = useDb()

  const areas = db.prepare('SELECT id, name FROM capacity_areas ORDER BY id').all() as AreaRow[]

  // ---- per-area trailing 3-month actuals (this partial month + 2 full months back) ----
  const { date: asOfAreaDate } = db.prepare('SELECT MAX(date) AS date FROM daily_toast_area_metrics').get() as { date: string | null }
  let areaTrailing: AreaTrailing[] = []
  let trailingWindow: { start: string, end: string } | null = null

  if (asOfAreaDate) {
    const [asOfYear, asOfMonthNum] = asOfAreaDate.split('-').map(Number)
    const startMonth = monthsBack(asOfYear, asOfMonthNum, 2)
    trailingWindow = { start: monthRange(startMonth.year, startMonth.month).start, end: asOfAreaDate }
    const rows = db.prepare(`
      SELECT area_id AS areaId, SUM(covers) AS covers, SUM(revenue) AS revenue, COUNT(*) AS nights
      FROM daily_toast_area_metrics
      WHERE date BETWEEN ? AND ?
      GROUP BY area_id
    `).all(trailingWindow.start, trailingWindow.end) as { areaId: number, covers: number, revenue: number, nights: number }[]
    const byArea = new Map(rows.map(r => [r.areaId, r]))
    areaTrailing = areas.map((a) => {
      const r = byArea.get(a.id)
      const covers = r?.covers ?? 0
      const revenue = r?.revenue ?? 0
      const nights = r?.nights ?? 0
      return {
        areaId: a.id,
        areaName: a.name,
        covers,
        revenue,
        nights,
        coversPerNight: nights > 0 ? covers / nights : null,
        perCover: covers > 0 ? revenue / covers : null
      }
    })
  }

  // ---- weekly covers/night trend per area (last TREND_WEEKS Mon-Sun weeks) ----
  // A night counts as open only if the whole restaurant seated at least
  // MIN_COVERS_FOR_OPEN_DAY (same filter as the Historical tab), so closed
  // Mondays and stray-order days don't drag a week's per-night average down.
  // The in-progress week is included, averaged over the nights so far.
  let areaTrends: AreaTrend[] = []
  if (asOfAreaDate) {
    const weekStart = (d: string): string => {
      const dt = new Date(`${d}T00:00:00Z`)
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7))
      return dt.toISOString().slice(0, 10)
    }
    const lastWeek = weekStart(asOfAreaDate)
    const first = new Date(`${lastWeek}T00:00:00Z`)
    first.setUTCDate(first.getUTCDate() - 7 * (TREND_WEEKS - 1))
    const firstWeek = first.toISOString().slice(0, 10)

    const rows = db.prepare(`
      SELECT date, area_id AS areaId, covers
      FROM daily_toast_area_metrics
      WHERE date BETWEEN ? AND ?
    `).all(firstWeek, asOfAreaDate) as { date: string, areaId: number, covers: number }[]
    const totalByDate = new Map<string, number>()
    for (const r of rows) totalByDate.set(r.date, (totalByDate.get(r.date) ?? 0) + r.covers)
    const openDates = new Set([...totalByDate].filter(([, c]) => c >= MIN_COVERS_FOR_OPEN_DAY).map(([d]) => d))

    // Current-season nightly capacity, to express covers as a fill %.
    const asOfMonthNum = Number(asOfAreaDate.slice(5, 7))
    const summer = asOfMonthNum >= 5 && asOfMonthNum <= 10
    const caps = db.prepare('SELECT id, capacity_nov_apr AS novApr, capacity_may_oct AS mayOct FROM capacity_areas').all() as { id: number, novApr: number | null, mayOct: number }[]
    const capByArea = new Map(caps.map(c => [c.id, summer ? c.mayOct : c.novApr]))

    const weeks: string[] = []
    for (let i = 0; i < TREND_WEEKS; i++) {
      const w = new Date(`${firstWeek}T00:00:00Z`)
      w.setUTCDate(w.getUTCDate() + 7 * i)
      weeks.push(w.toISOString().slice(0, 10))
    }
    areaTrends = areas.map((a) => {
      const sums = new Map<string, { covers: number, nights: number }>()
      for (const r of rows) {
        if (r.areaId !== a.id || !openDates.has(r.date)) continue
        const w = weekStart(r.date)
        const s = sums.get(w) ?? { covers: 0, nights: 0 }
        s.covers += r.covers
        s.nights += 1
        sums.set(w, s)
      }
      const points = weeks.map((w) => {
        const s = sums.get(w)
        return { weekStart: w, nights: s?.nights ?? 0, coversPerNight: s && s.nights > 0 ? s.covers / s.nights : null }
      })
      // Last 4 weeks, weighted by nights (not an average of weekly averages).
      const recent = weeks.slice(-4).map(w => sums.get(w)).filter((s): s is { covers: number, nights: number } => !!s)
      const rc = recent.reduce((t, s) => t + s.covers, 0)
      const rn = recent.reduce((t, s) => t + s.nights, 0)
      return {
        areaId: a.id,
        areaName: a.name,
        capacity: capByArea.get(a.id) ?? null,
        recent4WeekCoversPerNight: rn > 0 ? rc / rn : null,
        points
      }
    })
  }

  // ---- annual operating nights (for annualizing the per-night revenue delta) ----
  const holidayRows = db.prepare('SELECT month, holiday_closures AS holidayClosures FROM capacity_seasonality').all() as { month: number, holidayClosures: number }[]
  const holidaysByMonth = new Map(holidayRows.map(r => [r.month, r.holidayClosures]))
  const { date: asOfLineItemDate } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  const modelYear = asOfLineItemDate ? Number(asOfLineItemDate.slice(0, 4)) : (asOfAreaDate ? Number(asOfAreaDate.slice(0, 4)) : new Date().getFullYear())
  const operatingNightsPerYear = annualOperatingNights(modelYear, holidaysByMonth)

  // ---- since-the-move fixed/variable cost shares (real daily_line_items) ----
  let laborVariableShare: number | null = null
  let opexVariableShare: number | null = null
  let sinceDate: string | null = null
  if (asOfLineItemDate) {
    sinceDate = NEW_LOCATION_START > asOfLineItemDate ? asOfLineItemDate : NEW_LOCATION_START
    const laborRow = db.prepare(`
      SELECT
        SUM(CASE WHEN a.subcategory IN ('BOH Wages', 'FOH Wages') THEN dli.amount ELSE 0 END) AS variableLabor,
        SUM(dli.amount) AS totalLabor
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.category = 'labor' AND dli.date BETWEEN ? AND ?
    `).get(sinceDate, asOfLineItemDate) as { variableLabor: number | null, totalLabor: number | null }
    if (laborRow.totalLabor) laborVariableShare = (laborRow.variableLabor ?? 0) / laborRow.totalLabor

    const opexRow = db.prepare(`
      SELECT
        SUM(CASE WHEN a.cost_behavior = 'variable' THEN dli.amount ELSE 0 END) AS variableOpex,
        SUM(dli.amount) AS totalOpex
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.category = 'opex' AND dli.date BETWEEN ? AND ?
    `).get(sinceDate, asOfLineItemDate) as { variableOpex: number | null, totalOpex: number | null }
    if (opexRow.totalOpex) opexVariableShare = (opexRow.variableOpex ?? 0) / opexRow.totalOpex
  }

  // ---- buyout weekday rates/targets (see comment above) ----
  const buyoutRates = loadBuyoutRates(db)
  const buyoutWeekdays = buyoutWeekdaysFor(buyoutRates)

  // Real counts already booked on the Revenue tab (revenue_buyout_plan),
  // summed across every month of modelYear per weekday — these are already
  // reflected in currentAnnual.revenue client-side (the Revenue tab's Apply
  // action writes them into real revenue accounts' budget_targets), so
  // they're shown for context only, never added into the simulation's own
  // revenue delta. The client's buyout count input stays a pure delta on
  // top of this — "how many *more* buyouts than what's already booked."
  const bookedRows = db.prepare('SELECT dow, SUM(count) AS totalCount FROM revenue_buyout_plan WHERE year = ? GROUP BY dow').all(modelYear) as { dow: number, totalCount: number }[]
  const buyoutBookedByDow: Record<number, number> = {}
  for (const r of bookedRows) buyoutBookedByDow[r.dow] = r.totalCount

  // ---- ongoing retail context (4300 Retail Sales' leaf accounts) ----
  // Shown beside the "added monthly retail" lines so the user can see what
  // ongoing retail is already expected to make before typing an increase.
  // Both figures read the children of 4300 (never 4300 itself), which avoids
  // the parent-also-carries-its-own-amount double count noted in CLAUDE.md.
  // budget: that month's saved budget_targets for modelYear. trailing: average
  // of the last 3 *closed* months of real daily_line_items before
  // asOfLineItemDate's month (0 for a month with no postings).
  const retailBudgetByMonth: Record<number, number> = {}
  const retailBudgetRows = db.prepare(`
    SELECT bt.month AS month, SUM(bt.amount) AS amount
    FROM budget_targets bt
    JOIN accounts a ON a.id = bt.account_id
    JOIN accounts p ON p.id = a.parent_account_id
    WHERE bt.year = ? AND p.account_number = '4300'
    GROUP BY bt.month
  `).all(modelYear) as { month: number, amount: number }[]
  for (const r of retailBudgetRows) retailBudgetByMonth[r.month] = r.amount

  let retailTrailingMonthly: number | null = null
  if (asOfLineItemDate) {
    const asOfY = Number(asOfLineItemDate.slice(0, 4))
    const asOfM = Number(asOfLineItemDate.slice(5, 7))
    const first = monthsBack(asOfY, asOfM, 3)
    const last = monthsBack(asOfY, asOfM, 1)
    const row = db.prepare(`
      SELECT SUM(dli.amount) AS total
      FROM daily_line_items dli
      JOIN accounts a ON a.id = dli.account_id
      JOIN accounts p ON p.id = a.parent_account_id
      WHERE p.account_number = '4300' AND dli.date BETWEEN ? AND ?
    `).get(monthRange(first.year, first.month).start, monthRange(last.year, last.month).end) as { total: number | null }
    retailTrailingMonthly = (row.total ?? 0) / 3
  }

  return {
    asOfAreaDate,
    trailingWindow,
    areas: areaTrailing,
    areaTrends,
    modelYear,
    operatingNightsPerYear,
    sinceDate,
    asOfLineItemDate,
    laborVariableShare,
    opexVariableShare,
    buyoutRates,
    buyoutWeekdays,
    buyoutBookedByDow,
    retailBudgetByMonth,
    retailTrailingMonthly
  }
})
