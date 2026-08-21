// Data for the Nightly Margin page (app/pages/nightly-margin.vue): was a
// given operating night, on its own, worth being open for? Same
// calendar-grid pattern as the Revenue Calendar (server/api/pl.get.ts) —
// reuses that page's day-cell shape ({date, actual, comparison}) so the
// client can share the exact same buildMonthGrid/dayStatus logic — but
// "comparison" here is an *estimated marginal cost*, not a revenue goal.
//
// Neither labor $ nor COGS $ actually posts at nightly grain (see
// CLAUDE.md's "Revenue from a given night" discussion) — QBO labor posts
// per pay period, COGS posts from vendor invoices — so this is necessarily
// an estimate built from trailing rates, not a measured nightly figure:
//
//   - Variable (hourly) labor: that night's real Toast hours (labor_hours
//     in daily_toast_metrics, which excludes salaried staff as of the
//     2026-08-21 fix — see toast-metrics-sync.ts) times a blended $/hour
//     rate (trailing BOH+FOH Wages $ / trailing hourly Toast hours).
//   - COGS: that night's real total revenue times a blended trailing
//     Food+Beverage COGS% (Other COGS excluded — per CLAUDE.md's "COGS
//     budgeted as % of revenue" section, Other COGS doesn't scale with
//     revenue the same way and stays manually edited).
//
// Fixed labor & benefits (Management Salaries + Employee Benefits +
// Employer Payroll Taxes, spread evenly across real operating nights in the
// window) is computed too, but deliberately excluded from the day's judged
// `comparison` — raised by the user 2026-08-21: those costs are paid
// whether the restaurant opens that specific night or not, so counting them
// against a single night would answer "is the whole operation profitable"
// (a real question, just not this page's) instead of "was tonight worth
// opening" (the marginal question this page can actually answer). Still
// returned per day so the client can show it as context.
//
// Revenue is TOTAL revenue for the night (not the "core dine-in" slice
// Revenue Calendar/Historical use) — the question here is whether the
// actual dollars that came in that night covered that night's own marginal
// cost, and an event/catering night's revenue is real money that has to
// cover its own labor/COGS too, not something to exclude.
//
// Trailing window is "everything since the location move through asOfDate"
// — same NEW_LOCATION_START choice as weekly-targets.ts/history.get.ts,
// for the same reason (only one continuous, stable-regime stretch of real
// data exists so far; blending in the old, smaller location's wage/COGS
// levels would distort the rates).
type Period = 'month' | 'year'

type MarginDay = {
  date: string
  actual: number // revenue
  comparison: number // estimated total cost
  laborHours: number
  estVariableLabor: number
  estFixedLabor: number
  estCogs: number
}

export default defineEventHandler((event) => {
  const db = useDb()

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  if (!asOfDate) {
    return { asOfDate: null }
  }
  const [asOfYear, asOfMonth, asOfDay] = asOfDate.split('-').map(Number)
  const sinceDate = NEW_LOCATION_START > asOfDate ? asOfDate : NEW_LOCATION_START

  // ---- trailing rates, computed once over the whole since-move window ----
  const revenueTotalRow = db.prepare(`
    SELECT SUM(dli.amount) AS total
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = 'revenue' AND dli.date BETWEEN ? AND ?
  `).get(sinceDate, asOfDate) as { total: number | null }
  const totalRevenueSinceMove = revenueTotalRow.total ?? 0

  const foodBevCogsRow = db.prepare(`
    SELECT SUM(dli.amount) AS total
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = 'cogs' AND a.subcategory IN ('Food', 'Beverage') AND dli.date BETWEEN ? AND ?
  `).get(sinceDate, asOfDate) as { total: number | null }
  const foodBevCogsSinceMove = foodBevCogsRow.total ?? 0

  const hourlyWagesRow = db.prepare(`
    SELECT SUM(dli.amount) AS total
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = 'labor' AND a.subcategory IN ('BOH Wages', 'FOH Wages') AND dli.date BETWEEN ? AND ?
  `).get(sinceDate, asOfDate) as { total: number | null }
  const hourlyWagesSinceMove = hourlyWagesRow.total ?? 0

  const fixedLaborRow = db.prepare(`
    SELECT SUM(dli.amount) AS total
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = 'labor' AND a.subcategory IN ('Management Salaries', 'Employee Benefits', 'Employer Payroll Taxes') AND dli.date BETWEEN ? AND ?
  `).get(sinceDate, asOfDate) as { total: number | null }
  const fixedLaborSinceMove = fixedLaborRow.total ?? 0

  const toastRows = db.prepare(`
    SELECT date, covers, labor_hours AS laborHours FROM daily_toast_metrics WHERE date BETWEEN ? AND ?
  `).all(sinceDate, asOfDate) as { date: string, covers: number, laborHours: number }[]
  const toastByDate = new Map(toastRows.map(r => [r.date, r]))

  const trailingHourlyHours = toastRows.reduce((sum, r) => sum + r.laborHours, 0)
  const operatingNights = toastRows.filter(r => r.covers >= MIN_COVERS_FOR_OPEN_DAY).length

  const hourlyLaborRate = trailingHourlyHours > 0 ? hourlyWagesSinceMove / trailingHourlyHours : null
  const cogsPct = totalRevenueSinceMove > 0 ? foodBevCogsSinceMove / totalRevenueSinceMove : null
  const fixedLaborPerNight = operatingNights > 0 ? fixedLaborSinceMove / operatingNights : null

  const ratesAvailable = hourlyLaborRate != null && cogsPct != null && fixedLaborPerNight != null

  // ---- per-day revenue (total, not core-only — see header comment) ----
  const revenueByDayRows = db.prepare(`
    SELECT dli.date AS date, SUM(dli.amount) AS total
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = 'revenue' AND dli.date BETWEEN ? AND ?
    GROUP BY dli.date
  `).all(`${asOfYear}-01-01`, asOfDate) as { date: string, total: number }[]
  const revenueByDate = new Map(revenueByDayRows.map(r => [r.date, r.total]))

  function periodRange(period: Period): { start: string, end: string } {
    if (period === 'month') return { start: `${asOfYear}-${String(asOfMonth).padStart(2, '0')}-01`, end: asOfDate }
    return { start: `${asOfYear}-01-01`, end: asOfDate }
  }

  const PERIODS: Period[] = ['month', 'year']
  const margin: Record<Period, { days: MarginDay[] }> = {} as any

  for (const p of PERIODS) {
    const { start, end } = periodRange(p)
    const days: MarginDay[] = []
    if (ratesAvailable) {
      for (const [date, revenue] of revenueByDate) {
        if (date < start || date > end) continue
        if (date < NEW_LOCATION_START) continue // no reliable rate basis before the move — see header comment
        if (!revenue || revenue <= 0) continue // not a real open night
        const toastRow = toastByDate.get(date)
        if (!toastRow) continue // no synced Toast data for this date yet — can't estimate labor
        const estVariableLabor = toastRow.laborHours * hourlyLaborRate!
        const estFixedLabor = fixedLaborPerNight!
        const estCogs = revenue * cogsPct!
        days.push({
          date,
          actual: revenue,
          // Deliberately variable cost only (hourly labor + COGS) — not
          // + estFixedLabor. Management Salaries/Employee Benefits/Employer
          // Payroll Taxes are paid whether the restaurant is open that
          // night or not, so folding them in here would answer "is the
          // whole operation profitable" (a real question, but not this
          // page's) rather than "was tonight, specifically, worth opening"
          // (the marginal question a per-night view can actually answer —
          // raised by the user 2026-08-21). estFixedLabor is still returned
          // below so the client can show it as context, just not counted
          // against any single night.
          comparison: estVariableLabor + estCogs,
          laborHours: toastRow.laborHours,
          estVariableLabor,
          estFixedLabor,
          estCogs
        })
      }
    }
    days.sort((a, b) => a.date.localeCompare(b.date))
    margin[p] = { days }
  }

  const lastSyncRow = db.prepare('SELECT status, finished_at AS finishedAt FROM sync_runs ORDER BY id DESC LIMIT 1').get() as { status: string, finishedAt: string | null } | undefined

  return {
    asOfDate,
    asOfYear,
    asOfMonth,
    asOfDay,
    lastSync: lastSyncRow ?? null,
    margin,
    rates: {
      sinceDate,
      ratesAvailable,
      hourlyLaborRate,
      cogsPct,
      fixedLaborPerNight,
      operatingNights,
      trailingHourlyHours,
      totalRevenueSinceMove,
      foodBevCogsSinceMove,
      hourlyWagesSinceMove,
      fixedLaborSinceMove
    }
  }
})
