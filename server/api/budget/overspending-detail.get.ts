// Subcategory-level "what's driving it" breakdown behind a flagged COGS,
// Labor, or Opex row on the Budget Pace page's Overspending section —
// moved here 2026-08-20 from the old standalone P&L Drill-Downs page (see
// CLAUDE.md's "Budget Pace / Drill-Downs consolidation" section; COGS
// itself added same day, right after, at the user's request — the old
// Drill-Downs page never had a COGS section, but nothing about COGS
// structurally prevents one: it has real per-account daily_line_items
// actuals and real budget_targets the same way Labor/Opex do, split into
// Food/Beverage/Other via accounts.subcategory — see the Budget tab's
// "COGS budgeted as % of revenue" section in CLAUDE.md). That page's Month-grain
// subcategory pacing turned out to be structurally unreliable for lumpy
// fixed costs (rent posts as one lump on day 1, a utility bill posts once a
// month) — a flat day-fraction proration reads a fully-posted rent payment
// as "63% ahead of pace" and an unposted utility bill as "77% behind pace"
// right up until it lands. Year-grain doesn't have this problem: every
// fully-elapsed month contributes its whole budgeted amount unprorated (see
// budgetSubcategoryTotalsForPeriod below), so month-counting is naturally
// the right unit for a monthly-recurring lump cost — only the current stub
// month carries any proration error at all.
//
// Per the user's explicit 2026-08-20 decision: Fixed opex keeps this same
// per-subcategory pace comparison at NEITHER grain — it's already excluded
// from the opex_variable benchmark because it isn't controllable month to
// month, so pretending precision about whether a fixed cost is "ahead" or
// "behind" pace was never honest, at Month or Year. opexFixed below is
// therefore just each subcategory's real dollar total for the period, no
// expected/flagged/pctChange fields at all. Labor and Variable Opex keep
// the full pace comparison at both grains, per the user's read that they
// don't share Fixed's single-lump-payment problem badly enough to justify
// losing Month-grain detail.
//
// Known limitation, not reconciled here: this file's budget-pace proration
// (flat day-fraction at Month grain) is computed independently from
// useBudgetData.ts's monthExpectedOpex (which special-cases rent/loan
// interest's known lump-sum posting days) — the two can disagree to the
// dollar for opex specifically. Unifying them is a deeper change than this
// pass's page-structure consolidation; flagged in CLAUDE.md's "Not yet done".
type Period = 'month' | 'year'

function daysInMonthUTC(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

// This restaurant only started genuinely budgeting from Jul 2026 onward
// (after the location move) — Jan-Jun 2026's budget_targets rows were
// filled in from actuals after each month closed, not real forward-looking
// budgets, so comparing "actual vs. itself" there would never flag
// anything. Same hardcoded constant as pl.get.ts used before this move —
// see that file's history in CLAUDE.md.
const UNBUDGETED_YEAR = 2026
const UNBUDGETED_MONTHS = new Set([1, 2, 3, 4, 5, 6])
function isUnbudgetedMonth(year: number, month: number): boolean {
  return year === UNBUDGETED_YEAR && UNBUDGETED_MONTHS.has(month)
}

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
function monthOperatingDayFraction(year: number, month: number, throughDay: number): number {
  const dim = daysInMonthUTC(year, month - 1)
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`
  const totalOperatingDays = countOperatingDays(monthStart, monthEnd)
  if (totalOperatingDays === 0) return 0
  const throughDate = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(throughDay, dim)).padStart(2, '0')}`
  return countOperatingDays(monthStart, throughDate) / totalOperatingDays
}

// "As of" here must be the real wall-clock date (matching
// useBudgetData.ts's currentAsOfMonth/currentAsOfDay, which this data now
// sits underneath on the Budget Pace page), not the max date actually
// synced into daily_line_items — those two can genuinely differ by weeks
// (e.g. local dev's sync lags real "today" by however long since the last
// backfill). Using the synced-data max here would silently paint a stale
// month as "today," disagreeing with the Overspending row it's expanding
// underneath. IANA-zone-aware for the same reason qbo-sync-runner.ts's own
// localToday is — the server's clock is UTC, and plain UTC arithmetic can
// land on the wrong local calendar day. Kept as a small local duplicate
// rather than a shared import, same call qbo-sync-runner.ts already made
// for its own copy.
const RESTAURANT_TIME_ZONE = 'America/New_York'
function localToday(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export default defineEventHandler((event) => {
  const db = useDb()

  // Guards "no synced data at all yet" — distinct from asOfDate below,
  // which is real today regardless of how stale the actual data is.
  const { date: latestSyncedDate } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  if (!latestSyncedDate) {
    return { asOfDate: null }
  }
  const asOfDate = localToday(RESTAURANT_TIME_ZONE)
  const [asOfYear, asOfMonth, asOfDay] = asOfDate.split('-').map(Number)

  const LABEL_CASE = `CASE WHEN a.subcategory = 'Labor' THEN 'Other Labor' ELSE COALESCE(a.subcategory, a.name) END`
  function subcategoryTotalsForRange(category: 'cogs' | 'labor' | 'opex', start: string, end: string, costBehavior?: 'fixed' | 'variable') {
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

  function budgetSubcategoryTotalsForMonth(category: 'cogs' | 'labor' | 'opex', year: number, month: number, costBehavior?: 'fixed' | 'variable') {
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

  // For Month: just asOfMonth's own budget, prorated to today. For Year:
  // every elapsed month Jan-through-asOfMonth summed — every month here
  // contributes its whole budgeted amount unprorated *except* the current,
  // still-in-progress one, which alone gets prorated down to "expected so
  // far." That's why Year-grain pacing is structurally more trustworthy for
  // a monthly-recurring lump cost than Month-grain: at Year grain only one
  // month out of the period carries any proration uncertainty at all.
  function budgetSubcategoryTotalsForPeriod(category: 'cogs' | 'labor' | 'opex', year: number, fromMonth: number, throughMonth: number, costBehavior?: 'fixed' | 'variable') {
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

  function periodRange(period: Period): { start: string, end: string } {
    if (period === 'month') return { start: `${asOfYear}-${String(asOfMonth).padStart(2, '0')}-01`, end: asOfDate }
    return { start: `${asOfYear}-01-01`, end: asOfDate }
  }

  const DEFAULT_MATERIALITY_THRESHOLD: Record<Period, number> = { month: 250, year: 1000 }
  const thresholdsRow = db.prepare('SELECT month_threshold AS monthThreshold, year_threshold AS yearThreshold FROM drilldown_thresholds WHERE id = 1')
    .get() as { monthThreshold: number, yearThreshold: number } | undefined
  const MATERIALITY_THRESHOLD_BY_PERIOD: Record<Period, number> = {
    month: thresholdsRow?.monthThreshold ?? DEFAULT_MATERIALITY_THRESHOLD.month,
    year: thresholdsRow?.yearThreshold ?? DEFAULT_MATERIALITY_THRESHOLD.year
  }
  // hasBudget distinguishes "no budget_targets row exists at all for this
  // subcategory" from "a real budget_targets row exists but sums to $0 or
  // negative" (a genuine expected-credit month, or a $0 placeholder) — both
  // used to collapse into expectedAmount defaulting to 0 via `?? 0`, which
  // mislabeled the latter as "not budgeted" even though a real comparison
  // figure existed. Either way, a percentage-vs-expected still isn't
  // meaningful (dividing by a non-positive number produces a swing that can
  // flip sign in a confusing way), so pctChange stays null for both — only
  // the client-facing label text differs, driven by this flag.
  function flagRows(rows: { label: string, total: number }[], expected: Map<string, number>, threshold: number) {
    return rows.map(r => {
      const hasBudget = expected.has(r.label)
      const expectedAmount = expected.get(r.label) ?? 0
      const delta = r.total - expectedAmount
      if (expectedAmount <= 0) {
        return { label: r.label, amount: r.total, comparisonAmount: expectedAmount, hasBudget, flagged: Math.abs(r.total) >= threshold, pctChange: null }
      }
      const pctChange = (delta / expectedAmount) * 100
      const flagged = Math.abs(r.total) >= threshold && Math.abs(delta) >= threshold && Math.abs(delta) >= expectedAmount * 0.5
      return { label: r.label, amount: r.total, comparisonAmount: expectedAmount, hasBudget, flagged, pctChange }
    })
  }

  const PERIODS: Period[] = ['month', 'year']
  const detail: Record<Period, {
    cogs: { label: string, amount: number, comparisonAmount: number, hasBudget: boolean, flagged: boolean, pctChange: number | null }[]
    labor: { label: string, amount: number, comparisonAmount: number, hasBudget: boolean, flagged: boolean, pctChange: number | null }[]
    opexFixed: { label: string, amount: number }[]
    opexVariable: { label: string, amount: number, comparisonAmount: number, hasBudget: boolean, flagged: boolean, pctChange: number | null }[]
  }> = {} as any

  for (const p of PERIODS) {
    const { start, end } = periodRange(p)
    const fromMonth = p === 'month' ? asOfMonth : 1
    const threshold = MATERIALITY_THRESHOLD_BY_PERIOD[p]

    // COGS subcategories (Food/Beverage/Other, via accounts.subcategory —
    // see this file's header comment) get the same full pace comparison as
    // Labor/Variable Opex, not the Fixed-opex plain-totals treatment: food
    // and beverage costs accrue continuously as vendor invoices/inventory
    // move, not as a single monthly lump the way rent does, so they don't
    // share Fixed opex's proration problem.
    const cogsRows = subcategoryTotalsForRange('cogs', start, end)
    const cogsExpected = new Map(budgetSubcategoryTotalsForPeriod('cogs', asOfYear, fromMonth, asOfMonth).map(r => [r.label, r.total]))

    const laborRows = subcategoryTotalsForRange('labor', start, end)
    const laborExpected = new Map(budgetSubcategoryTotalsForPeriod('labor', asOfYear, fromMonth, asOfMonth).map(r => [r.label, r.total]))

    const opexVariableRows = subcategoryTotalsForRange('opex', start, end, 'variable')
    const opexVariableExpected = new Map(budgetSubcategoryTotalsForPeriod('opex', asOfYear, fromMonth, asOfMonth, 'variable').map(r => [r.label, r.total]))

    // Fixed opex: plain totals only, no expected/flagged — see this file's
    // header comment for why a pace comparison is never shown for it.
    const opexFixedRows = subcategoryTotalsForRange('opex', start, end, 'fixed')

    detail[p] = {
      cogs: flagRows(cogsRows, cogsExpected, threshold),
      labor: flagRows(laborRows, laborExpected, threshold),
      opexFixed: opexFixedRows.map(r => ({ label: r.label, amount: r.total })),
      opexVariable: flagRows(opexVariableRows, opexVariableExpected, threshold)
    }
  }

  return { asOfDate, asOfYear, asOfMonth, asOfDay, detail, thresholds: MATERIALITY_THRESHOLD_BY_PERIOD }
})
