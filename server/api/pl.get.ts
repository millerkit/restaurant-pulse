// Real data for the P&L page (app/pages/pl/index.vue) and the Revenue
// Calendar page (app/pages/pl/revenue-calendar.vue): week/month/year rollups
// by category, plus the Revenue Calendar's day-by-day weekday-goal
// comparison. Mirrors dashboard.get.ts's split — this route hands back raw
// numbers, status/color computation stays client-side via benchmarkStatus in
// useBudgetData.ts.
//
// The Labor/Opex subcategory drill-down that used to live here moved to
// server/api/budget/overspending-detail.get.ts on 2026-08-20, when the
// standalone P&L Drill-Downs page was retired — see CLAUDE.md's "Budget
// Pace / Drill-Downs consolidation" section for why (Month-grain proration
// was structurally unreliable for lumpy fixed costs) and where that logic
// now lives (an inline expand under Budget Pace's Overspending section).
//
// Both periods are returned in one response rather than one fetch per
// selected tab — the same "load everything, let the client switch" shape
// useBudgetYear() already uses for the Budget pages, and cheap here since
// this is a single restaurant's data.
const EMPTY_TOTALS = { revenue: 0, cogs: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }
type Totals = typeof EMPTY_TOTALS
type Period = 'month' | 'year'

// Revenue Calendar's comparison basis: every day is judged against that
// weekday's own dynamically-calculated revenue goal — the exact same
// server/utils/weekly-targets.ts computation the Dashboard's "This Week's
// Targets" section uses, so a day reads the same way on both pages. Any
// date before NEW_LOCATION_START is left out entirely (no target exists for
// it, and comparing an old-location actual against a target built for — and
// scaled to — the new, larger space would be misleading, the same
// location-move distortion this file already avoids elsewhere, e.g. the
// Historical tab).
const REVENUE_COMPARISON_LABEL = "that weekday's revenue goal"
const REVENUE_COMPARISON_SHORT_LABEL = 'goal'

export default defineEventHandler((event) => {
  const db = useDb()

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

  const PERIODS: Period[] = ['month', 'year']

  const periods: Record<Period, { start: string, end: string, days: number, totals: Totals }> = {} as any
  for (const p of PERIODS) {
    const { start, end } = periodRange(p)
    const days = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000) + 1
    periods[p] = { start, end, days, totals: categoryTotalsForRange(start, end) }
  }

  // Shared with the Dashboard's "This Week's Targets" — see
  // server/utils/weekly-targets.ts. targetByDow gives each weekday's own
  // dollar goal; a null benchmarkAmount (no weekly_revenue_benchmark set
  // yet) means every day simply has no target, same as a day before the
  // location move below.
  const weeklyTargets = computeWeeklyRevenueTargets()

  const revenue: Record<Period, {
    days: { date: string, actual: number, comparison: number }[]
    comparisonLabel: string
    comparisonShortLabel: string
  }> = {} as any

  for (const p of PERIODS) {
    const { start, end } = periods[p]

    // Every day in the period vs. that weekday's own revenue goal — a day
    // before NEW_LOCATION_START (only possible in the Year view) has no
    // target and is skipped entirely, per the user's explicit instruction
    // to leave those blank rather than judge the old, smaller location
    // against a goal scaled for the new space.
    const actualByDay = revenueByDayForRange(start, end)
    const days: { date: string, actual: number, comparison: number }[] = []
    for (const [date, actual] of actualByDay) {
      if (date < NEW_LOCATION_START) continue
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
      const target = weeklyTargets.targetByDow.get(dow)?.dollarTarget
      if (target == null) continue
      days.push({ date, actual, comparison: target })
    }
    days.sort((a, b) => a.date.localeCompare(b.date))

    revenue[p] = { days, comparisonLabel: REVENUE_COMPARISON_LABEL, comparisonShortLabel: REVENUE_COMPARISON_SHORT_LABEL }
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
    revenue,
    benchmarks
  }
})
