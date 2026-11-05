// Year-end outlook scenarios for the Cash Flow tab's Year-End Projection (added 2026-11-05).
// Pure functions (no Vue/Nuxt imports beyond types) so the math can be tested on its own.
//
// Three views of full-year Net Income, all starting from the same base the Cash Flow tab
// already uses: real actuals for closed, synced months; budget for the current month and every
// future month (hybridYearTotalsPastActual).
//
//   budget       — that base, unchanged.
//   pace         — for the remaining months (current month through December), each of revenue,
//                  COGS, labor and opex = its monthly budget × how that category actually ran
//                  against budget over the last few closed months (sum of actuals ÷ sum of
//                  budgets). Other income/expense stay at budget: they're one-time items, not
//                  something a run-rate describes.
//   paceSpecials — the same, but the current month's revenue is replaced by the Revenue tab's
//                  night-by-night projection (special nights, bookings), with the current
//                  month's COGS scaled by the same revenue difference so cost doesn't stay
//                  fixed while revenue moves.
//
// Closed months before PACE_START_MONTH (the opening months: pantry stock-up, partial
// months) are excluded from the ratios, the same reason the COGS recompute skips them.
import type { Category, MonthActuals } from '~/composables/useBudgetData'

// Same definition as netIncome() in useBudgetData.ts, inlined so this file has no runtime imports and
// can be tested on its own.
function netIncome(t: Record<Category, number>) {
  return t.revenue - t.cogs - t.labor - t.opex + (t.other_income ?? 0) - (t.other_expense ?? 0)
}

export const PACE_CATEGORIES = ['revenue', 'cogs', 'labor', 'opex'] as const
type PaceCategory = typeof PACE_CATEGORIES[number]
export const PACE_START_MONTH = 8
export const PACE_WINDOW_MONTHS = 3

export type Scenario = { key: 'budget' | 'pace' | 'paceSpecials', label: string, totals: Record<Category, number>, netIncome: number }
export type YearOutlook = {
  monthsUsed: number[]
  ratios: Record<PaceCategory, number>
  scenarios: Scenario[]
}

export function yearOutlook(args: {
  asOfMonth: number
  monthBudget: (month: number, cat: Category) => number | null
  monthlyActuals: MonthActuals[]
  baselineTotals: Record<Category, number>
  currentMonthRevenueProjection: number | null
}): YearOutlook | null {
  const { asOfMonth, monthBudget, monthlyActuals, baselineTotals, currentMonthRevenueProjection } = args

  const usable: number[] = []
  for (let m = PACE_START_MONTH; m < asOfMonth; m++) {
    const a = monthlyActuals[m - 1]
    if (a?.hasData && (monthBudget(m, 'revenue') ?? 0) > 0) usable.push(m)
  }
  const monthsUsed = usable.slice(-PACE_WINDOW_MONTHS)
  if (monthsUsed.length === 0) return null

  const ratios = {} as Record<PaceCategory, number>
  for (const cat of PACE_CATEGORIES) {
    const actual = monthsUsed.reduce((s, m) => s + (monthlyActuals[m - 1]?.totals[cat] ?? 0), 0)
    const budget = monthsUsed.reduce((s, m) => s + (monthBudget(m, cat) ?? 0), 0)
    ratios[cat] = budget > 0 ? actual / budget : 1
  }

  const remaining = Array.from({ length: 12 - asOfMonth + 1 }, (_, i) => asOfMonth + i)
  const remainingBudget = (cat: PaceCategory) => remaining.reduce((s, m) => s + (monthBudget(m, cat) ?? 0), 0)

  const paceTotals = { ...baselineTotals }
  for (const cat of PACE_CATEGORIES) paceTotals[cat] = baselineTotals[cat] + remainingBudget(cat) * (ratios[cat] - 1)

  const scenarios: Scenario[] = [
    { key: 'budget', label: 'Budget for the rest of the year', totals: baselineTotals, netIncome: netIncome(baselineTotals) },
    { key: 'pace', label: "At recent pace", totals: paceTotals, netIncome: netIncome(paceTotals) }
  ]

  const cmRevBudget = monthBudget(asOfMonth, 'revenue') ?? 0
  const cmRevPace = cmRevBudget * ratios.revenue
  if (currentMonthRevenueProjection !== null && cmRevPace > 0) {
    const specialsTotals = { ...paceTotals }
    specialsTotals.revenue = paceTotals.revenue + (currentMonthRevenueProjection - cmRevPace)
    const cmCogsPace = (monthBudget(asOfMonth, 'cogs') ?? 0) * ratios.cogs
    specialsTotals.cogs = paceTotals.cogs + cmCogsPace * (currentMonthRevenueProjection / cmRevPace - 1)
    scenarios.push({ key: 'paceSpecials', label: "At recent pace, with this month's night-by-night revenue", totals: specialsTotals, netIncome: netIncome(specialsTotals) })
  }

  return { monthsUsed, ratios, scenarios }
}
