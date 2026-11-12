// Year-end outlook scenarios for the Cash Flow tab's Year-End Projection (added 2026-11-05,
// simplified 2026-11-12). Pure functions (no Vue/Nuxt imports beyond types) so the math can be
// tested on its own.
//
// Two views of full-year Net Income, both starting from the base the Cash Flow tab already uses:
// real actuals for closed, synced months; budget for the current month and every future month
// (hybridYearTotalsPastActual).
//
//   budget   — that base, unchanged. Since dynamic budgeting (2026-11-11) the budget for months
//              after the current one already follows the live forecast (capacity, special nights,
//              cost %, staffing), so it is itself the forecast for those months.
//   forecast — the same, but the CURRENT month's revenue is replaced by the night-by-night
//              projection (recent weekday averages, special nights, OpenTable bookings; the current
//              month's plan is frozen on the 1st, so this is its only live number). The month's
//              food & drink cost scales with the same revenue difference (it's budgeted as a % of
//              sales). Labor, operating expenses and other income/expense stay at budget.
//
// The old "Recent pace" scenario (revenue = budget × how revenue ran against budget over the last
// closed months) was removed 2026-11-12: later months' budgets now already follow recent actuals,
// so applying a pace ratio on top mostly counted the same run rate twice.
import type { Category } from '~/composables/useBudgetData'

// Same definition as netIncome() in useBudgetData.ts, inlined so this file has no runtime imports and
// can be tested on its own.
function netIncome(t: Record<Category, number>) {
  return t.revenue - t.cogs - t.labor - t.opex + (t.other_income ?? 0) - (t.other_expense ?? 0)
}

export type Scenario = { key: 'budget' | 'forecast', label: string, totals: Record<Category, number>, netIncome: number }
export type YearOutlook = { scenarios: Scenario[] }

export function yearOutlook(args: {
  asOfMonth: number
  monthBudget: (month: number, cat: Category) => number | null
  baselineTotals: Record<Category, number>
  currentMonthRevenueProjection: number | null
}): YearOutlook {
  const { asOfMonth, monthBudget, baselineTotals, currentMonthRevenueProjection } = args
  const scenarios: Scenario[] = [
    { key: 'budget', label: 'Budget for the rest of the year', totals: baselineTotals, netIncome: netIncome(baselineTotals) }
  ]
  const cmRevBudget = monthBudget(asOfMonth, 'revenue') ?? 0
  if (currentMonthRevenueProjection !== null && cmRevBudget > 0) {
    const totals = { ...baselineTotals }
    totals.revenue = baselineTotals.revenue + (currentMonthRevenueProjection - cmRevBudget)
    totals.cogs = baselineTotals.cogs + (monthBudget(asOfMonth, 'cogs') ?? 0) * (currentMonthRevenueProjection / cmRevBudget - 1)
    scenarios.push({ key: 'forecast', label: "Budget, with this month's night-by-night revenue", totals, netIncome: netIncome(totals) })
  }
  return { scenarios }
}
