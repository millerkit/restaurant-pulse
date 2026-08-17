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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function weekdayOfIso(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay()
}

// Which occurrence of its own weekday a date is within its calendar month
// (1-based) — e.g. Aug 17 2026 is a Monday and the 3rd Monday of August.
// Same-weekday dates in a month are always exactly 7 days apart, so
// bucketing by day-of-month gives the right occurrence regardless of which
// weekday it is.
function weekdayOccurrenceInMonth(dateStr: string): number {
  const day = Number(dateStr.slice(8, 10))
  return Math.floor((day - 1) / 7) + 1
}

// Finds the date in {year}-{month1} with the same weekday and the same
// "Nth occurrence in the month" as dateStr — e.g. "3rd Thursday of July" ->
// "3rd Thursday of June" — the Dashboard's own "same weekday-position, not a
// fixed day-count offset" comparison (see the Design direction section in
// CLAUDE.md), applied here to a whole period instead of a single day.
// Returns null if that occurrence doesn't exist in the target month (a
// 5th-Monday day with no 5th Monday the month/year before).
function sameWeekdayPositionInMonth(dateStr: string, year: number, month1: number): string | null {
  const weekday = weekdayOfIso(dateStr)
  const occurrence = weekdayOccurrenceInMonth(dateStr)
  const firstOfMonthWeekday = weekdayOfIso(`${year}-${pad2(month1)}-01`)
  const firstMatchDay = 1 + ((weekday - firstOfMonthWeekday + 7) % 7)
  const targetDay = firstMatchDay + (occurrence - 1) * 7
  if (targetDay > daysInMonthUTC(year, month1 - 1)) return null
  return `${year}-${pad2(month1)}-${pad2(targetDay)}`
}

// Revenue Calendar's per-day comparison basis, by selected period — Week
// keeps the plain 7-day-back shift (already same-weekday by construction);
// Month/Year use the real Nth-weekday-of-month match above, so a Month view
// compares "3rd Thursday of this month" to "3rd Thursday of last month," not
// to a day some fixed number of days back.
function revenueComparisonDate(period: Period, dateStr: string): string | null {
  if (period === 'week') return addDays(dateStr, -7)
  const year = Number(dateStr.slice(0, 4))
  const month1 = Number(dateStr.slice(5, 7))
  if (period === 'month') {
    const prev = month1 === 1 ? { year: year - 1, month1: 12 } : { year, month1: month1 - 1 }
    return sameWeekdayPositionInMonth(dateStr, prev.year, prev.month1)
  }
  return sameWeekdayPositionInMonth(dateStr, year - 1, month1)
}

// Bulk-fetch range covering every possible comparisonDate for the period, so
// revenueByDayForRange runs once instead of once per day.
function revenueComparisonRangeFor(period: Period, start: string, end: string): { start: string, end: string } {
  if (period === 'week') return { start: addDays(start, -7), end: addDays(end, -7) }
  const startYear = Number(start.slice(0, 4))
  const startMonth1 = Number(start.slice(5, 7))
  if (period === 'month') {
    // periodRange('month') always keeps start/end within the same calendar
    // month, so one target month covers every day's comparison.
    const prev = startMonth1 === 1 ? { year: startYear - 1, month1: 12 } : { year: startYear, month1: startMonth1 - 1 }
    const dim = daysInMonthUTC(prev.year, prev.month1 - 1)
    return { start: `${prev.year}-${pad2(prev.month1)}-01`, end: `${prev.year}-${pad2(prev.month1)}-${pad2(dim)}` }
  }
  return { start: `${startYear - 1}-01-01`, end: `${startYear - 1}-12-31` }
}

const REVENUE_COMPARISON_LABEL: Record<Period, string> = {
  week: 'the same weekday last week',
  month: 'the same weekday last month',
  year: 'the same weekday last year'
}
const REVENUE_COMPARISON_SHORT_LABEL: Record<Period, string> = {
  week: 'last week',
  month: 'last month',
  year: 'last year'
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
  // equivalent period — >=50% change (either direction) and at least the
  // period's own materiality threshold of real dollar movement — AND its
  // current-period amount is itself at least that threshold. That second
  // condition is what actually keeps a tile like "Repairs & maintenance:
  // $18 (-99%)" out of the grid: a steep drop off a much larger
  // prior-period base can clear the delta threshold easily even though the
  // resulting dollar figure is trivial and not worth a reader's attention.
  // A subcategory with nothing in the prior period is flagged as "new" once
  // its own amount clears the same bar — there's no prior amount to compute
  // a meaningful percentage against. Symmetric (not increase-only) since a
  // cost dropping sharply — e.g. an expense that stopped posting — is just
  // as worth surfacing as one rising, as long as both amounts involved are
  // themselves material. The Year threshold is higher than Week/Month's —
  // a year's dollar totals run much larger, so $250 would flag almost every
  // subcategory as noise.
  const MATERIALITY_THRESHOLD_BY_PERIOD: Record<Period, number> = { week: 250, month: 250, year: 1000 }
  function flagRows(rows: { label: string, total: number }[], comparison: Map<string, number>, threshold: number) {
    return rows.map(r => {
      const prev = comparison.get(r.label) ?? 0
      const delta = r.total - prev
      if (prev <= 0) {
        return { label: r.label, amount: r.total, comparisonAmount: prev, flagged: Math.abs(r.total) >= threshold, pctChange: null }
      }
      const pctChange = (delta / prev) * 100
      const flagged = Math.abs(r.total) >= threshold && Math.abs(delta) >= threshold && Math.abs(delta) >= prev * 0.5
      return { label: r.label, amount: r.total, comparisonAmount: prev, flagged, pctChange }
    })
  }

  // Week's Labor drill-down is narrowed to just these three wage
  // subcategories (per the user's request — wages are the only labor
  // figures worth a week-over-week look, unlike Employee Benefits/Payroll
  // Taxes, which don't move week to week in a meaningful way). Always
  // returned as exactly these three, in this order, even when one has no
  // activity that week — the client renders a fixed Total + 3-tile grid
  // rather than an anomaly list, so a missing row would leave a silent gap
  // instead of a $0 tile.
  const WEEKLY_WAGE_SUBCATEGORIES = ['BOH Wages', 'FOH Wages', 'Management Salaries']

  const drilldowns: Record<Period, {
    labor: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    opexFixed: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    opexVariable: { label: string, amount: number, comparisonAmount: number, flagged: boolean, pctChange: number | null }[]
    revenueDays: { date: string, comparisonDate: string, actual: number, comparison: number }[]
    revenueComparisonLabel: string
    revenueComparisonShortLabel: string
  }> = {} as any

  for (const p of PERIODS) {
    const { start, end } = periods[p]
    const cmp = comparisonRange(p, start, end)

    let laborRows = subcategoryTotalsForRange('labor', start, end)
    const laborCmp = new Map(subcategoryTotalsForRange('labor', cmp.start, cmp.end).map(r => [r.label, r.total]))
    if (p === 'week') {
      laborRows = WEEKLY_WAGE_SUBCATEGORIES.map(label => laborRows.find(r => r.label === label) ?? { label, total: 0 })
    }

    const opexFixedRows = subcategoryTotalsForRange('opex', start, end, 'fixed')
    const opexFixedCmp = new Map(subcategoryTotalsForRange('opex', cmp.start, cmp.end, 'fixed').map(r => [r.label, r.total]))
    const opexVariableRows = subcategoryTotalsForRange('opex', start, end, 'variable')
    const opexVariableCmp = new Map(subcategoryTotalsForRange('opex', cmp.start, cmp.end, 'variable').map(r => [r.label, r.total]))

    // Comparison basis matches the selected period — same weekday last week
    // for Week, same weekday-position last month/year for Month/Year (see
    // revenueComparisonDate above) — applied to every day in the period, not
    // just last night.
    const actualByDay = revenueByDayForRange(start, end)
    const cmpRevRange = revenueComparisonRangeFor(p, start, end)
    const comparisonByDay = revenueByDayForRange(cmpRevRange.start, cmpRevRange.end)
    const revenueDays: { date: string, comparisonDate: string, actual: number, comparison: number }[] = []
    for (const [date, actual] of actualByDay) {
      const comparisonDate = revenueComparisonDate(p, date)
      if (comparisonDate === null) continue
      const comparison = comparisonByDay.get(comparisonDate)
      if (comparison !== undefined) revenueDays.push({ date, comparisonDate, actual, comparison })
    }
    revenueDays.sort((a, b) => a.date.localeCompare(b.date))

    const threshold = MATERIALITY_THRESHOLD_BY_PERIOD[p]
    drilldowns[p] = {
      labor: flagRows(laborRows, laborCmp, threshold),
      opexFixed: flagRows(opexFixedRows, opexFixedCmp, threshold),
      opexVariable: flagRows(opexVariableRows, opexVariableCmp, threshold),
      revenueDays,
      revenueComparisonLabel: REVENUE_COMPARISON_LABEL[p],
      revenueComparisonShortLabel: REVENUE_COMPARISON_SHORT_LABEL[p]
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
