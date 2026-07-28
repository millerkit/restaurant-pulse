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
const EMPTY_TOTALS = { revenue: 0, cogs: 0, labor: 0, opex: 0, other: 0 }

function isoDaysBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
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

  const monthStart = `${asOfYear}-${String(asOfMonth).padStart(2, '0')}-01`
  const yearStart = `${asOfYear}-01-01`
  const lastWeekDate = isoDaysBefore(asOfDate, 7)
  const lastYearDate = isoDaysBefore(asOfDate, 364) // 52 weeks back — same weekday as asOfDate

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
      budget: budgetTotalsForMonths(asOfYear, Array.from({ length: 12 }, (_, i) => i + 1))
    },
    benchmarks
  }
})
