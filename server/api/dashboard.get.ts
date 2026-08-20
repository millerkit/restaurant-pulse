// Real data for the Dashboard page (app/pages/index.vue): last-night/
// last-week/last-year revenue, month-to-date and year-to-date actuals by
// category, the matching full-period budget targets (null if none set —
// budget_targets is empty until someone fills it in via the Budget/Edit
// Budget tabs), and category_benchmarks rows for the cost-pace meters.
//
// Deliberately returns raw numbers only — pace/status/color computation
// stays client-side via paceStatus/netIncome/benchmarkStatus in
// useBudgetData.ts, the same split the Budget Pace and Edit Budget pages
// already use.
//
// "As of" is the latest date actually present in daily_line_items, not
// "yesterday" — keeps this correct if a nightly sync is ever missed, rather
// than pointing at a day with no data.
const EMPTY_TOTALS = { revenue: 0, cogs: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }

function isoDaysBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// Monday on/before isoDate — start of the calendar week containing it. Same
// definition as server/api/capacity.get.ts's mondayOf (duplicated, small
// enough that sharing it isn't worth a new util).
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  return addDaysIso(iso, dow === 0 ? -6 : 1 - dow)
}
// Urban Hearth is closed Mondays (see CLAUDE.md) — same definition as
// server/api/capacity.get.ts's isOperatingDow, duplicated for the same
// small-helper reason as mondayOf above.
function isOperatingDow(year: number, month: number, day: number): boolean {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1
}
function daysInMonthLocal(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function operatingDaysInMonth(year: number, month: number): number {
  const total = daysInMonthLocal(year, month)
  let count = 0
  for (let d = 1; d <= total; d++) if (isOperatingDow(year, month, d)) count++
  return count
}

export default defineEventHandler((event) => {
  const db = useDb()

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  if (!asOfDate) {
    return { asOfDate: null }
  }
  const [asOfYear, asOfMonth, asOfDay] = asOfDate.split('-').map(Number)

  function revenueOn(date: string): number | null {
    const row = db.prepare(`
      SELECT SUM(dli.amount) AS total FROM daily_line_items dli
      JOIN accounts a ON a.id = dli.account_id
      WHERE a.category = 'revenue' AND dli.date = ?
    `).get(date) as { total: number | null }
    return row.total
  }

  function categoryTotalsForRange(start: string, end: string) {
    const rows = db.prepare(`
      SELECT a.category AS category, SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE dli.date BETWEEN ? AND ?
      GROUP BY a.category
    `).all(start, end) as { category: string, total: number }[]
    const totals = { ...EMPTY_TOTALS }
    for (const r of rows) totals[r.category as keyof typeof EMPTY_TOTALS] = r.total
    return totals
  }

  // Full-period budget (whole month, or every month of the year that has
  // one) — proration against elapsed time happens client-side, matching
  // how the Budget Pace page already treats budget_targets.
  function budgetTotalsForMonths(year: number, months: number[]) {
    const placeholders = months.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT a.category AS category, SUM(bt.amount) AS total
      FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
      WHERE bt.year = ? AND bt.month IN (${placeholders})
      GROUP BY a.category
    `).all(year, ...months) as { category: string, total: number }[]
    if (rows.length === 0) return null
    const totals = { ...EMPTY_TOTALS }
    for (const r of rows) totals[r.category as keyof typeof EMPTY_TOTALS] = r.total
    return totals
  }

  // Per-category, per-month budget and actual figures for the year, used to
  // build a hybrid annual target: budgeted months use their budget, but a
  // month with no budget row at all (e.g. this restaurant's Jan-Jun 2026,
  // never budgeted in this app — the old, smaller location) falls back to
  // that month's own real actual once the month is fully elapsed, rather
  // than fabricating a number that was never actually planned. A future or
  // in-progress unbudgeted month still contributes nothing — there's no
  // actual yet to fall back to, same as before this fix.
  function monthlyCategoryFigures(year: number, source: 'budget_targets' | 'daily_line_items') {
    const rows = source === 'budget_targets'
      ? db.prepare(`
          SELECT a.category AS category, bt.month AS month, SUM(bt.amount) AS total
          FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
          WHERE bt.year = ?
          GROUP BY a.category, bt.month
        `).all(year) as { category: string, month: number, total: number }[]
      : db.prepare(`
          SELECT a.category AS category, CAST(strftime('%m', dli.date) AS INTEGER) AS month, SUM(dli.amount) AS total
          FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
          WHERE strftime('%Y', dli.date) = ?
          GROUP BY a.category, month
        `).all(String(year)) as { category: string, month: number, total: number }[]
    const result = {} as Record<keyof typeof EMPTY_TOTALS, (number | null)[]>
    for (const cat of Object.keys(EMPTY_TOTALS) as (keyof typeof EMPTY_TOTALS)[]) {
      result[cat] = Array.from({ length: 12 }, () => null)
    }
    for (const r of rows) {
      const cat = r.category as keyof typeof EMPTY_TOTALS
      if (result[cat]) result[cat][r.month - 1] = r.total
    }
    return result
  }

  function hybridAnnualTarget(
    budgets: Record<keyof typeof EMPTY_TOTALS, (number | null)[]>,
    actuals: Record<keyof typeof EMPTY_TOTALS, (number | null)[]>,
    asOfMonth: number
  ) {
    const totals = { ...EMPTY_TOTALS }
    for (const cat of Object.keys(EMPTY_TOTALS) as (keyof typeof EMPTY_TOTALS)[]) {
      let sum = 0
      for (let m = 1; m <= 12; m++) {
        const budget = budgets[cat][m - 1]
        if (budget != null) { sum += budget; continue }
        if (m < asOfMonth) sum += actuals[cat][m - 1] ?? 0
      }
      totals[cat] = sum
    }
    return totals
  }

  // Per-category target by month, for the year view's "expected pace" line
  // — same hybrid logic as hybridAnnualTarget (budget where set, actual
  // fallback for a fully-elapsed unbudgeted month, null/0 otherwise). The
  // flat calendar-day fraction used elsewhere (dayOfYear/daysInYear) is
  // still wrong for the reason documented previously: it assumes a category
  // accrues evenly across all 12 months, which misjudges pace whenever a
  // month's budgeted amount is seasonally uneven — the client combines this
  // with the elapsed-days fraction of the current month to build a true
  // cumulative-target-through-today figure instead. Originally revenue-only
  // (monthlyRevenueTarget); generalized to every category so the client can
  // build an expected *net income* to date, not just expected revenue — see
  // CLAUDE.md's "Net income pace chip was actually tracking revenue pace"
  // section.
  function monthlyCategoryTargets(
    budgets: Record<keyof typeof EMPTY_TOTALS, (number | null)[]>,
    actuals: Record<keyof typeof EMPTY_TOTALS, (number | null)[]>,
    asOfMonth: number
  ): Record<keyof typeof EMPTY_TOTALS, (number | null)[]> {
    const result = {} as Record<keyof typeof EMPTY_TOTALS, (number | null)[]>
    for (const cat of Object.keys(EMPTY_TOTALS) as (keyof typeof EMPTY_TOTALS)[]) {
      result[cat] = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1
        if (budgets[cat][i] != null) return budgets[cat][i]
        if (m < asOfMonth) return actuals[cat][i] ?? 0
        return null
      })
    }
    return result
  }

  const monthlyBudgetsByCategory = monthlyCategoryFigures(asOfYear, 'budget_targets')
  const monthlyActualsByCategory = monthlyCategoryFigures(asOfYear, 'daily_line_items')

  const monthStart = `${asOfYear}-${String(asOfMonth).padStart(2, '0')}-01`
  const yearStart = `${asOfYear}-01-01`
  const lastWeekDate = isoDaysBefore(asOfDate, 7)
  const lastYearDate = isoDaysBefore(asOfDate, 364) // 52 weeks back — same weekday as asOfDate

  const benchmarks = db.prepare(`
    SELECT category, target_pct AS targetPct, warning_pct AS warningPct, serious_pct AS seriousPct, critical_pct AS criticalPct
    FROM category_benchmarks
  `).all()

  const lastSyncRow = db.prepare('SELECT status, finished_at AS finishedAt FROM sync_runs ORDER BY id DESC LIMIT 1').get() as { status: string, finishedAt: string | null } | undefined

  // ---- Weekly Performance: real weekday pattern + spend/cover -----------
  // The weekday-share/benchmark math itself lives in
  // server/utils/weekly-targets.ts, shared with the P&L Drill-Downs page's
  // Revenue Calendar (server/api/pl.get.ts) — both pages judge a day
  // against the exact same target rather than two independently-derived
  // ones. Only the "this week" actual-vs-target roll-up and the suggested-
  // weekly-goal breakeven calc below are Dashboard-specific.
  const weekly = computeWeeklyRevenueTargets()
  const { benchmarkAmount: weeklyBenchmarkAmount, avgSpendPerCover, sampleOpenDays, days: dayTargets } = weekly

  // Need per-date core revenue/covers lookups for "this week"'s actuals —
  // not returned by computeWeeklyRevenueTargets (it only needs weekday
  // aggregates), so queried again here, same filter/window.
  const corePlaceholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
  const coreRevenueRows = db.prepare(`
    SELECT dli.date AS date, SUM(dli.amount) AS revenue
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number IN (${corePlaceholders}) AND a.is_active = 1 AND dli.date >= ?
    GROUP BY dli.date
  `).all(...CORE_REVENUE_ACCOUNT_NUMBERS, NEW_LOCATION_START) as { date: string, revenue: number }[]
  const coreRevenueByDate = new Map(coreRevenueRows.map(r => [r.date, r.revenue]))

  const coversSinceMoveRows = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date >= ?').all(NEW_LOCATION_START) as { date: string, covers: number }[]
  const coversByDate = new Map(coversSinceMoveRows.map(r => [r.date, r.covers]))

  // This week's Tue-Sun, actual (core revenue, same definition the target
  // itself is built from — total revenue would double-count event/catering
  // swings the target deliberately excludes) vs. target, capped at asOfDate
  // so a day that hasn't happened yet just shows its target with no actual —
  // same "actual/target both cut off at the same as-of point" fairness
  // pattern as capacity.get.ts's actualForRange.
  const thisWeekMonday = mondayOf(asOfDate)
  const thisWeekDays = dayTargets.map((target, i) => {
    const date = addDaysIso(thisWeekMonday, i + 1) // Tue = Monday+1 .. Sun = Monday+6
    const hasHappened = date <= asOfDate
    return {
      ...target,
      date,
      hasHappened,
      actualRevenue: hasHappened ? (coreRevenueByDate.get(date) ?? null) : null,
      actualCovers: hasHappened ? (coversByDate.get(date) ?? null) : null
    }
  })
  const elapsedThisWeek = thisWeekDays.filter(d => d.hasHappened)
  const weekToDate = {
    actualRevenue: elapsedThisWeek.reduce((s, d) => s + (d.actualRevenue ?? 0), 0),
    targetRevenue: elapsedThisWeek.reduce((s, d) => s + (d.dollarTarget ?? 0), 0),
    actualCovers: elapsedThisWeek.reduce((s, d) => s + (d.actualCovers ?? 0), 0),
    targetCovers: elapsedThisWeek.reduce((s, d) => s + (d.coversTarget ?? 0), 0)
  }
  const fullWeekTarget = thisWeekDays.reduce((s, d) => s + (d.dollarTarget ?? 0), 0)

  // ---- Suggested weekly goal: what's needed to cover Labor + Opex + real
  // loan principal (QBO's P&L has no principal line — see CLAUDE.md's Debt
  // Service / Cash Flow tab section — so this is the only place principal
  // is accounted for outside the Cash Flow tab itself). A straight
  // breakeven-revenue formula: Revenue * (1 - cogsPct) = Labor + Opex +
  // Principal, since COGS scales with revenue rather than being a flat
  // monthly cost the way Labor/Opex roughly are over a short window.
  //
  // Labor/Opex run-rate: this month's own budget if one is set, else the
  // most recent past month's real actual — the same hybrid fallback
  // already established by monthlyCategoryTargets above, just reused one
  // more month back for a month with no budget at all yet.
  function runRateForCategory(cat: keyof typeof EMPTY_TOTALS): number | null {
    const budget = monthlyBudgetsByCategory[cat][asOfMonth - 1]
    if (budget != null) return budget
    for (let m = asOfMonth - 1; m >= 1; m--) {
      const actual = monthlyActualsByCategory[cat][m - 1]
      if (actual != null) return actual
    }
    return null
  }
  const laborMonthEstimate = runRateForCategory('labor')
  const opexMonthEstimate = runRateForCategory('opex')

  // COGS %: prefer the configured category_benchmarks target (the number
  // already used everywhere else in the app to judge COGS pace), falling
  // back to a trailing actual ratio (cogs / revenue across every fully
  // elapsed month this year) only if no benchmark has been set.
  const cogsBenchmark = (benchmarks as { category: string, targetPct: number }[]).find(b => b.category === 'cogs')
  let cogsPct: number | null = cogsBenchmark?.targetPct ?? null
  let cogsPctSource: 'benchmark' | 'trailing' | 'none' = cogsBenchmark ? 'benchmark' : 'none'
  if (cogsPct == null) {
    let cogsSum = 0, revSum = 0
    for (let m = 1; m < asOfMonth; m++) {
      cogsSum += monthlyActualsByCategory.cogs[m - 1] ?? 0
      revSum += monthlyActualsByCategory.revenue[m - 1] ?? 0
    }
    if (revSum > 0) { cogsPct = cogsSum / revSum; cogsPctSource = 'trailing' }
  }

  const monthEnd = `${asOfYear}-${String(asOfMonth).padStart(2, '0')}-${String(daysInMonthLocal(asOfYear, asOfMonth)).padStart(2, '0')}`
  const principalRow = db.prepare('SELECT SUM(principal) AS total FROM loan_schedule WHERE payment_date BETWEEN ? AND ?')
    .get(monthStart, monthEnd) as { total: number | null }
  const principalDueThisMonth = principalRow.total ?? 0

  const operatingWeeksThisMonth = operatingDaysInMonth(asOfYear, asOfMonth) / 6
  let suggestedWeeklyGoal: number | null = null
  if (laborMonthEstimate != null && opexMonthEstimate != null && cogsPct != null && cogsPct < 1 && operatingWeeksThisMonth > 0) {
    const weeklyFixedCosts = (laborMonthEstimate + opexMonthEstimate + principalDueThisMonth) / operatingWeeksThisMonth
    suggestedWeeklyGoal = weeklyFixedCosts / (1 - cogsPct)
  }

  // Toast POS metrics (covers, labor hours) for last night — see
  // daily_toast_metrics in schema.sql. Null if Toast hasn't synced this
  // date yet (not connected, or the sync ran before Toast credentials
  // were configured) — the client falls back to its own "not available"
  // state rather than a fabricated number.
  const toastRow = db.prepare('SELECT covers, labor_hours AS laborHours FROM daily_toast_metrics WHERE date = ?').get(asOfDate) as { covers: number, laborHours: number } | undefined

  return {
    asOfDate,
    asOfYear,
    asOfMonth,
    asOfDay,
    lastSync: lastSyncRow ?? null,
    lastNight: {
      date: asOfDate,
      revenue: revenueOn(asOfDate),
      lastWeek: { date: lastWeekDate, revenue: revenueOn(lastWeekDate) },
      lastYear: { date: lastYearDate, revenue: revenueOn(lastYearDate) }
    },
    month: {
      actuals: categoryTotalsForRange(monthStart, asOfDate),
      budget: budgetTotalsForMonths(asOfYear, [asOfMonth])
    },
    yearToDate: {
      actuals: categoryTotalsForRange(yearStart, asOfDate),
      budget: hybridAnnualTarget(monthlyBudgetsByCategory, monthlyActualsByCategory, asOfMonth),
      monthlyCategoryBudget: monthlyCategoryTargets(monthlyBudgetsByCategory, monthlyActualsByCategory, asOfMonth),
      unbudgetedPastMonthCount: Array.from({ length: asOfMonth - 1 }, (_, i) => i + 1)
        .filter(m => monthlyBudgetsByCategory.revenue[m - 1] == null).length
    },
    benchmarks,
    toast: toastRow ?? null,
    weeklyTargets: {
      benchmarkAmount: weeklyBenchmarkAmount,
      benchmarkUpdatedAt: weekly.benchmarkUpdatedAt,
      avgSpendPerCover,
      sinceDate: NEW_LOCATION_START,
      sampleOpenDays,
      days: dayTargets,
      thisWeek: {
        mondayOf: thisWeekMonday,
        days: thisWeekDays,
        toDate: weekToDate,
        fullWeekTarget
      },
      suggestedWeeklyGoal: {
        amount: suggestedWeeklyGoal,
        laborMonthEstimate,
        opexMonthEstimate,
        principalDueThisMonth,
        operatingWeeksThisMonth,
        cogsPct,
        cogsPctSource
      }
    }
  }
})
