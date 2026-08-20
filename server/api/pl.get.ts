// Real data for the P&L page (app/pages/pl.vue): week/month/year rollups by
// category, plus the Labor/Opex/Revenue drill-downs, replacing the static
// sample data that page shipped with. Mirrors dashboard.get.ts's split —
// this route hands back raw numbers, status/color computation stays
// client-side via benchmarkStatus in useBudgetData.ts.
//
// All three periods (and all three drill-downs) are returned in one
// response rather than one fetch per selected tab — the same "load
// everything, let the client switch" shape useBudgetYear() already uses for
// the Budget pages, and cheap here since this is a single restaurant's data.
const EMPTY_TOTALS = { revenue: 0, cogs: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }
type Totals = typeof EMPTY_TOTALS
type Period = 'month' | 'year'

function daysInMonthUTC(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

// Revenue Calendar's comparison basis (added 2026-08-20, replacing the old
// "same weekday last month/year" actual-vs-actual comparison): every day is
// judged against that weekday's own dynamically-calculated revenue goal —
// the exact same server/utils/weekly-targets.ts computation the Dashboard's
// "This Week's Targets" section uses, so a day reads the same way on both
// pages. Any date before NEW_LOCATION_START is left out entirely (no target
// exists for it, and comparing an old-location actual against a target
// built for — and scaled to — the new, larger space would be misleading,
// the same location-move distortion this file already avoids elsewhere,
// e.g. the Historical tab).
const REVENUE_COMPARISON_LABEL = "that weekday's revenue goal"
const REVENUE_COMPARISON_SHORT_LABEL = 'goal'

// Labor/Opex drill-down comparison basis (also switched 2026-08-20, same
// day as the Revenue Calendar above): a subcategory is now flagged against
// its own budget_targets figure for the period, not the immediately
// preceding month/year. Per the user's explicit instruction the same day:
// this restaurant's 2026 budget_targets rows for Jan-Jun aren't real
// forward-looking budgets (this restaurant only started genuinely
// budgeting from Jul 2026 onward, after the location move — the numbers
// stored for those earlier months were filled in from actuals after each
// month closed, so comparing "actual vs. itself" there would never flag
// anything meaningful). Hardcoded to this specific year/month range — like
// this file's other hand-set, first-pass domain constants (e.g.
// useBudgetData.ts's opexLumpSumPostingDays) — rather than inferred from
// whether budget_targets rows technically exist, since they do exist for
// these months, just not meaningfully.
const UNBUDGETED_YEAR = 2026
const UNBUDGETED_MONTHS = new Set([1, 2, 3, 4, 5, 6])
function isUnbudgetedMonth(year: number, month: number): boolean {
  return year === UNBUDGETED_YEAR && UNBUDGETED_MONTHS.has(month)
}

// Prorates the current (still-in-progress) month/year's budget down to an
// "expected so far" figure, instead of comparing actual-to-date against
// each period's full/final budget — added 2026-08-20, same day as the
// switch to budget-based flagging above, after the user asked for the
// comparison to be pace-aware rather than end-of-period-aware. Uses Tue-Sun
// operating days, not plain calendar days — mirrors budget/edit.vue's
// monthExpectedFraction (Urban Hearth is closed Mondays, so a calendar-day
// fraction overstates how far a restaurant's business has actually gotten
// through the month) — not budget/index.vue's Overspending page, which
// still uses a plain calendar-day fraction there, a separate and coarser
// calculation this file deliberately doesn't reuse.
function isOperatingDay(date: Date): boolean {
  return date.getUTCDay() !== 1 // Date#getUTCDay(): 0=Sun...6=Sat, 1=Mon is the closed day
}
function countOperatingDays(start: string, end: string): number {
  let count = 0
  const d = new Date(`${start}T00:00:00Z`)
  const endD = new Date(`${end}T00:00:00Z`)
  while (d <= endD) {
    if (isOperatingDay(d)) count++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return count
}
// Fraction of a given month's operating days that have elapsed through
// throughDay (inclusive) — 0 if the month has no operating days at all
// (shouldn't happen in practice, guarded rather than dividing by zero).
function monthOperatingDayFraction(year: number, month: number, throughDay: number): number {
  const dim = daysInMonthUTC(year, month - 1)
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`
  const totalOperatingDays = countOperatingDays(monthStart, monthEnd)
  if (totalOperatingDays === 0) return 0
  const throughDate = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(throughDay, dim)).padStart(2, '0')}`
  return countOperatingDays(monthStart, throughDate) / totalOperatingDays
}

export default defineEventHandler((event) => {
  const db = useDb()
  const query = getQuery(event)

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  if (!asOfDate) {
    return { asOfDate: null }
  }
  const [asOfYear, asOfMonth, asOfDay] = asOfDate.split('-').map(Number)

  function categoryTotalsForRange(start: string, end: string): Totals {
    const rows = db.prepare(`
      SELECT a.category AS category, SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE dli.date BETWEEN ? AND ?
      GROUP BY a.category
    `).all(start, end) as { category: string, total: number }[]
    const totals = { ...EMPTY_TOTALS }
    for (const r of rows) totals[r.category as keyof Totals] = r.total
    return totals
  }

  // account_number is used to order subcategory rows in a stable, roughly
  // chart-of-accounts order rather than alphabetically or by insertion.
  //
  // Six labor accounts (Additional Pay, BOH Wages, FOH Wages, Management
  // Salaries, Employee Benefits, Employer Payroll Taxes — the group-header
  // accounts one level under "6000 Labor") carry the literal subcategory
  // value 'Labor', a generic default rather than a real subcategory name.
  // A direct posting to one of *those* accounts (not one of their own
  // children — see the "parent account can also carry its own direct
  // postings" note above) would otherwise surface in this drill-down under
  // the bare label "Labor," which reads as nonsense next to the callout's
  // own "Labor is off target... but Labor is up sharply" phrasing. Relabeled
  // to "Other Labor" so it reads as its own real category — every regular
  // wage subcategory already has its own specific label, so this bucket
  // only ever catches these rare unattributed direct postings.
  const LABEL_CASE = `CASE WHEN a.subcategory = 'Labor' THEN 'Other Labor' ELSE COALESCE(a.subcategory, a.name) END`
  function subcategoryTotalsForRange(category: 'labor' | 'opex', start: string, end: string, costBehavior?: 'fixed' | 'variable') {
    const rows = db.prepare(`
      SELECT ${LABEL_CASE} AS label, SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.category = ? AND dli.date BETWEEN ? AND ?
        ${costBehavior ? 'AND a.cost_behavior = ?' : ''}
      GROUP BY ${LABEL_CASE}
      ORDER BY total DESC
    `).all(...(costBehavior ? [category, start, end, costBehavior] : [category, start, end])) as { label: string, total: number }[]
    return rows
  }

  // Core dine-in revenue only (not total revenue) — matches the definition
  // the weekday targets themselves are built from (server/utils/weekly-
  // targets.ts), so the Revenue Calendar's "actual" side is apples-to-apples
  // with its "target" side rather than letting an event/catering swing (which
  // the target deliberately excludes) masquerade as beating or missing goal.
  function revenueByDayForRange(start: string, end: string) {
    const placeholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT dli.date AS date, SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.account_number IN (${placeholders}) AND a.is_active = 1 AND dli.date BETWEEN ? AND ?
      GROUP BY dli.date
    `).all(...CORE_REVENUE_ACCOUNT_NUMBERS, start, end) as { date: string, total: number }[]
    return new Map(rows.map(r => [r.date, r.total]))
  }

  function periodRange(period: Period): { start: string, end: string } {
    if (period === 'month') return { start: `${asOfYear}-${String(asOfMonth).padStart(2, '0')}-01`, end: asOfDate }
    return { start: `${asOfYear}-01-01`, end: asOfDate }
  }

  // Budget comparison for the Labor/Opex anomaly drill-downs (switched
  // 2026-08-20 from "vs. the prior month/year" to "vs. this month's/year's
  // budget target" — see the UNBUDGETED_YEAR/UNBUDGETED_MONTHS comment
  // above). budget_targets is keyed by (year, month, account_id), not a
  // date range, so this aggregates one calendar month at a time rather than
  // reusing subcategoryTotalsForRange's date-range query directly.
  function budgetSubcategoryTotalsForMonth(category: 'labor' | 'opex', year: number, month: number, costBehavior?: 'fixed' | 'variable') {
    const rows = db.prepare(`
      SELECT ${LABEL_CASE} AS label, SUM(bt.amount) AS total
      FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
      WHERE a.category = ? AND bt.year = ? AND bt.month = ?
        ${costBehavior ? 'AND a.cost_behavior = ?' : ''}
      GROUP BY ${LABEL_CASE}
    `).all(...(costBehavior ? [category, year, month, costBehavior] : [category, year, month])) as { label: string, total: number }[]
    return rows
  }

  function mergeAdd(map: Map<string, number>, rows: { label: string, total: number }[]) {
    for (const r of rows) map.set(r.label, (map.get(r.label) ?? 0) + r.total)
  }

  // The budget-comparison total for a period: for Month, just that one
  // month; for Year, every elapsed month Jan-through-asOfMonth summed
  // together. Every month here is always fully elapsed *except* the last
  // one (throughMonth is always asOfMonth — see call sites below), which is
  // the current, still-in-progress month — that one alone gets prorated
  // down to "expected so far" via monthOperatingDayFraction, while every
  // earlier month counts at its full/final value (same as a closed month's
  // 100%-reference treatment on the Edit Budget page). An unbudgeted month
  // (see isUnbudgetedMonth above) contributes that month's real actuals
  // instead of its (not meaningfully budgeted) budget_targets row — for a
  // *past* unbudgeted month that's simply its whole month's actual; for the
  // current month it's actual-to-date, which needs no further proration
  // since it's already partial by construction (there's no data beyond
  // asOfDate to sum in the first place).
  function budgetSubcategoryTotalsForPeriod(category: 'labor' | 'opex', year: number, fromMonth: number, throughMonth: number, costBehavior?: 'fixed' | 'variable') {
    const map = new Map<string, number>()
    for (let m = fromMonth; m <= throughMonth; m++) {
      const isCurrentMonth = m === throughMonth
      if (isUnbudgetedMonth(year, m)) {
        const dim = daysInMonthUTC(year, m - 1)
        const start = `${year}-${String(m).padStart(2, '0')}-01`
        const end = isCurrentMonth ? asOfDate : `${year}-${String(m).padStart(2, '0')}-${String(dim).padStart(2, '0')}`
        mergeAdd(map, subcategoryTotalsForRange(category, start, end, costBehavior))
      } else {
        const rows = budgetSubcategoryTotalsForMonth(category, year, m, costBehavior)
        if (isCurrentMonth) {
          const fraction = monthOperatingDayFraction(year, m, asOfDay)
          mergeAdd(map, rows.map(r => ({ label: r.label, total: r.total * fraction })))
        } else {
          mergeAdd(map, rows)
        }
      }
    }
    return Array.from(map, ([label, total]) => ({ label, total }))
  }

  const PERIODS: Period[] = ['month', 'year']

  const periods: Record<Period, { start: string, end: string, days: number, totals: Totals }> = {} as any
  for (const p of PERIODS) {
    const { start, end } = periodRange(p)
    const days = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000) + 1
    periods[p] = { start, end, days, totals: categoryTotalsForRange(start, end) }
  }

  // A subcategory is flagged when its actual spend varies significantly
  // from its *expected-to-date* budget pace for the period (switched
  // 2026-08-20 from "vs. the prior month/year," then same day switched
  // again from "vs. the full period's budget" to this prorated version —
  // see the UNBUDGETED_YEAR and monthOperatingDayFraction comments above)
  // — >=50% variance (either direction) and at least the period's own
  // materiality threshold of real dollar movement — AND its current-period
  // amount is itself at least that threshold. That second condition is what
  // actually keeps a tile like "Repairs & maintenance: $18 (-99%)" out of
  // the grid: a steep drop off a much larger expected figure can clear the
  // delta threshold easily even though the resulting dollar figure is
  // trivial and not worth a reader's attention. A subcategory with no
  // budget for the period is flagged as "not budgeted" once its own amount
  // clears the same bar — there's no expected figure to compute a
  // meaningful percentage against. Symmetric (not over-budget-only) since a
  // cost coming in well under pace is just as worth surfacing as one
  // running over, as long as
  // both amounts involved are themselves material. The Year threshold is
  // higher than Month's — a year's dollar totals run much larger, so a
  // month-sized threshold would flag almost every subcategory as noise.
  // Both thresholds are user-editable (drilldown_thresholds table, via the
  // page's inline form) — these are just the fallback defaults shown until
  // the user first saves a value of their own.
  const DEFAULT_MATERIALITY_THRESHOLD: Record<Period, number> = { month: 250, year: 1000 }
  const thresholdsRow = db.prepare('SELECT month_threshold AS monthThreshold, year_threshold AS yearThreshold FROM drilldown_thresholds WHERE id = 1')
    .get() as { monthThreshold: number, yearThreshold: number } | undefined
  const MATERIALITY_THRESHOLD_BY_PERIOD: Record<Period, number> = {
    month: thresholdsRow?.monthThreshold ?? DEFAULT_MATERIALITY_THRESHOLD.month,
    year: thresholdsRow?.yearThreshold ?? DEFAULT_MATERIALITY_THRESHOLD.year
  }
  function flagRows(rows: { label: string, total: number }[], expected: Map<string, number>, threshold: number) {
    return rows.map(r => {
      const expectedAmount = expected.get(r.label) ?? 0
      const delta = r.total - expectedAmount
      if (expectedAmount <= 0) {
        return { label: r.label, amount: r.total, comparisonAmount: expectedAmount, flagged: Math.abs(r.total) >= threshold, pctChange: null }
      }
      const pctChange = (delta / expectedAmount) * 100
      const flagged = Math.abs(r.total) >= threshold && Math.abs(delta) >= threshold && Math.abs(delta) >= expectedAmount * 0.5
      return { label: r.label, amount: r.total, comparisonAmount: expectedAmount, flagged, pctChange }
    })
  }

  // Shared with the Dashboard's "This Week's Targets" — see
  // server/utils/weekly-targets.ts. targetByDow gives each weekday's own
  // dollar goal; a null benchmarkAmount (no weekly_revenue_benchmark set
  // yet) means every day simply has no target, same as a day before the
  // location move below.
  const weeklyTargets = computeWeeklyRevenueTargets()

  const drilldowns: Record<Period, {
    labor: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    opexFixed: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    opexVariable: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    revenueDays: { date: string, actual: number, comparison: number }[]
    revenueComparisonLabel: string
    revenueComparisonShortLabel: string
  }> = {} as any

  for (const p of PERIODS) {
    const { start, end } = periods[p]
    // Month: just asOfMonth's own budget, prorated to today. Year: every
    // elapsed month Jan-through-asOfMonth summed (only the last one,
    // asOfMonth, prorated — see budgetSubcategoryTotalsForPeriod) — matches
    // periodRange's own year-to-date actual range above.
    const fromMonth = p === 'month' ? asOfMonth : 1

    const laborRows = subcategoryTotalsForRange('labor', start, end)
    const laborExpected = new Map(budgetSubcategoryTotalsForPeriod('labor', asOfYear, fromMonth, asOfMonth).map(r => [r.label, r.total]))

    const opexFixedRows = subcategoryTotalsForRange('opex', start, end, 'fixed')
    const opexFixedExpected = new Map(budgetSubcategoryTotalsForPeriod('opex', asOfYear, fromMonth, asOfMonth, 'fixed').map(r => [r.label, r.total]))
    const opexVariableRows = subcategoryTotalsForRange('opex', start, end, 'variable')
    const opexVariableExpected = new Map(budgetSubcategoryTotalsForPeriod('opex', asOfYear, fromMonth, asOfMonth, 'variable').map(r => [r.label, r.total]))

    // Every day in the period vs. that weekday's own revenue goal — a day
    // before NEW_LOCATION_START (only possible in the Year view) has no
    // target and is skipped entirely, per the user's explicit instruction
    // to leave those blank rather than judge the old, smaller location
    // against a goal scaled for the new space.
    const actualByDay = revenueByDayForRange(start, end)
    const revenueDays: { date: string, actual: number, comparison: number }[] = []
    for (const [date, actual] of actualByDay) {
      if (date < NEW_LOCATION_START) continue
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
      const target = weeklyTargets.targetByDow.get(dow)?.dollarTarget
      if (target == null) continue
      revenueDays.push({ date, actual, comparison: target })
    }
    revenueDays.sort((a, b) => a.date.localeCompare(b.date))

    const threshold = MATERIALITY_THRESHOLD_BY_PERIOD[p]
    drilldowns[p] = {
      labor: flagRows(laborRows, laborExpected, threshold),
      opexFixed: flagRows(opexFixedRows, opexFixedExpected, threshold),
      opexVariable: flagRows(opexVariableRows, opexVariableExpected, threshold),
      revenueDays,
      revenueComparisonLabel: REVENUE_COMPARISON_LABEL,
      revenueComparisonShortLabel: REVENUE_COMPARISON_SHORT_LABEL
    }
  }

  const benchmarks = db.prepare(`
    SELECT category, target_pct AS targetPct, warning_pct AS warningPct, serious_pct AS seriousPct, critical_pct AS criticalPct
    FROM category_benchmarks
  `).all()

  const lastSyncRow = db.prepare('SELECT status, finished_at AS finishedAt FROM sync_runs ORDER BY id DESC LIMIT 1').get() as { status: string, finishedAt: string | null } | undefined

  return {
    asOfDate,
    asOfYear,
    asOfMonth,
    asOfDay,
    lastSync: lastSyncRow ?? null,
    periods,
    drilldowns,
    benchmarks,
    thresholds: MATERIALITY_THRESHOLD_BY_PERIOD
  }
})
