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
type Period = 'week' | 'month' | 'year'

function daysInMonthUTC(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

// Shifts an ISO date by whole months (positive or negative), clamping the
// day into the target month (e.g. Jul 31 - 1 month -> Jun 30, not Jul 1).
function addMonthsClamped(dateStr: string, deltaMonths: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const totalMonths = d.getUTCFullYear() * 12 + d.getUTCMonth() + deltaMonths
  const ny = Math.floor(totalMonths / 12)
  const nm = ((totalMonths % 12) + 12) % 12
  const clampedDay = Math.min(d.getUTCDate(), daysInMonthUTC(ny, nm))
  return new Date(Date.UTC(ny, nm, clampedDay)).toISOString().slice(0, 10)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Monday of the week containing dateStr (ISO week start), so "This Week"
// matches the mockup's Mon-based range rather than a rolling 7-day window.
function mondayOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  return addDays(dateStr, -daysSinceMonday)
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
  function subcategoryTotalsForRange(category: 'labor' | 'opex', start: string, end: string, costBehavior?: 'fixed' | 'variable') {
    const rows = db.prepare(`
      SELECT COALESCE(a.subcategory, a.name) AS label, SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.category = ? AND dli.date BETWEEN ? AND ?
        ${costBehavior ? 'AND a.cost_behavior = ?' : ''}
      GROUP BY COALESCE(a.subcategory, a.name)
      ORDER BY total DESC
    `).all(...(costBehavior ? [category, start, end, costBehavior] : [category, start, end])) as { label: string, total: number }[]
    return rows
  }

  function revenueByDayForRange(start: string, end: string) {
    const rows = db.prepare(`
      SELECT dli.date AS date, SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.category = 'revenue' AND dli.date BETWEEN ? AND ?
      GROUP BY dli.date
    `).all(start, end) as { date: string, total: number }[]
    return new Map(rows.map(r => [r.date, r.total]))
  }

  function periodRange(period: Period): { start: string, end: string } {
    if (period === 'week') return { start: mondayOfWeek(asOfDate), end: asOfDate }
    if (period === 'month') return { start: `${asOfYear}-${String(asOfMonth).padStart(2, '0')}-01`, end: asOfDate }
    return { start: `${asOfYear}-01-01`, end: asOfDate }
  }

  // The immediately-preceding period of the same length, used as the
  // comparison for "is this subcategory up sharply" flags — same weekday
  // range 7 days back for week, same day-count range last month for month,
  // same month/day range last year for year.
  function comparisonRange(period: Period, start: string, end: string): { start: string, end: string } {
    if (period === 'week') return { start: addDays(start, -7), end: addDays(end, -7) }
    if (period === 'month') return { start: addMonthsClamped(start, -1), end: addMonthsClamped(end, -1) }
    return { start: addMonthsClamped(start, -12), end: addMonthsClamped(end, -12) }
  }

  const PERIODS: Period[] = ['week', 'month', 'year']

  const periods: Record<Period, { start: string, end: string, days: number, totals: Totals }> = {} as any
  for (const p of PERIODS) {
    const { start, end } = periodRange(p)
    const days = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000) + 1
    periods[p] = { start, end, days, totals: categoryTotalsForRange(start, end) }
  }

  // A subcategory is flagged when it varied significantly vs. the prior
  // equivalent period — >=50% change (either direction) and at least $200 of
  // real dollar movement, so a tiny account (e.g. $40 -> $70) doesn't get
  // flagged for statistical noise. A subcategory with nothing in the prior
  // period is flagged as "new" once it clears the same $200 materiality bar
  // — there's no prior amount to compute a meaningful percentage against.
  // Symmetric (not increase-only) since a cost dropping sharply — e.g. an
  // expense that stopped posting — is just as worth surfacing as one rising.
  function flagRows(rows: { label: string, total: number }[], comparison: Map<string, number>) {
    return rows.map(r => {
      const prev = comparison.get(r.label) ?? 0
      const delta = r.total - prev
      if (prev <= 0) {
        return { label: r.label, amount: r.total, comparisonAmount: prev, flagged: r.total >= 200, pctChange: null }
      }
      const pctChange = (delta / prev) * 100
      const flagged = Math.abs(delta) >= 200 && Math.abs(delta) >= prev * 0.5
      return { label: r.label, amount: r.total, comparisonAmount: prev, flagged, pctChange }
    })
  }

  const drilldowns: Record<Period, {
    labor: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    opexFixed: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    opexVariable: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    revenueDays: { date: string, comparisonDate: string, actual: number, comparison: number }[]
  }> = {} as any

  for (const p of PERIODS) {
    const { start, end } = periods[p]
    const cmp = comparisonRange(p, start, end)

    const laborRows = subcategoryTotalsForRange('labor', start, end)
    const laborCmp = new Map(subcategoryTotalsForRange('labor', cmp.start, cmp.end).map(r => [r.label, r.total]))

    const opexFixedRows = subcategoryTotalsForRange('opex', start, end, 'fixed')
    const opexFixedCmp = new Map(subcategoryTotalsForRange('opex', cmp.start, cmp.end, 'fixed').map(r => [r.label, r.total]))
    const opexVariableRows = subcategoryTotalsForRange('opex', start, end, 'variable')
    const opexVariableCmp = new Map(subcategoryTotalsForRange('opex', cmp.start, cmp.end, 'variable').map(r => [r.label, r.total]))

    // Same-weekday-last-week comparison, applied to every day in the period
    // (not just last night) — the schema.sql comment for this drill-down
    // describes reusing the Dashboard's single-day comparison this way.
    const actualByDay = revenueByDayForRange(start, end)
    const comparisonByDay = revenueByDayForRange(addDays(start, -7), addDays(end, -7))
    const revenueDays: { date: string, comparisonDate: string, actual: number, comparison: number }[] = []
    for (const [date, actual] of actualByDay) {
      const comparisonDate = addDays(date, -7)
      const comparison = comparisonByDay.get(comparisonDate)
      if (comparison !== undefined) revenueDays.push({ date, comparisonDate, actual, comparison })
    }
    revenueDays.sort((a, b) => a.date.localeCompare(b.date))

    drilldowns[p] = {
      labor: flagRows(laborRows, laborCmp),
      opexFixed: flagRows(opexFixedRows, opexFixedCmp),
      opexVariable: flagRows(opexVariableRows, opexVariableCmp),
      revenueDays
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
    benchmarks
  }
})
