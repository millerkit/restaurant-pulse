// Shared between the Budget Pace and Edit Budget pages (see CLAUDE.md's
// Budget tab section) — types, sample data, and the year-of-budget-targets
// fetch that both pages need independently.

export type Category = 'revenue' | 'cogs' | 'labor' | 'opex' | 'other_income' | 'other_expense'
export type BudgetAccount = {
  accountId: number
  accountNumber: string | null
  parentAccountId: number | null
  name: string
  category: Category
  subcategory: string | null
  costBehavior: 'fixed' | 'variable' | null
  isOwnerCompensation: number // 0/1 — only meaningful for category='labor', see schema.sql
  amount: number | null
}
export type MonthData = { year: number, month: number, accounts: BudgetAccount[] }

// The sample month/day this whole app is narrated against (matches the
// Dashboard/P&L pages' "Thu, Jul 16" as-of date), and the only year this
// restaurant has any budget data for yet.
export const YEAR = 2026
export const AS_OF_MONTH = 7
export const AS_OF_DAY = 16
export const CATEGORIES: Category[] = ['revenue', 'cogs', 'labor', 'opex', 'other_income', 'other_expense']
export const CATEGORY_LABEL: Record<Category, string> = { revenue: 'Revenue', cogs: 'COGS', labor: 'Labor', opex: 'Operating Expenses', other_income: 'Other Income', other_expense: 'Other Expense' }
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

// 1-indexed day-of-year (Jan 1 = 1), UTC-based to match the ISO date strings
// (YYYY-MM-DD) daily_line_items/sync data is keyed by.
export function dayOfYear(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000) + 1
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365
}

export function categoryTotals(monthlyData: MonthData[], monthNumbers: number[]) {
  const totals: Record<Category, number> = { revenue: 0, cogs: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }
  const monthsBudgeted: Record<Category, number> = { revenue: 0, cogs: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }
  for (const m of monthNumbers) {
    const data = monthlyData[m - 1]
    if (!data) continue
    const seenThisMonth = new Set<Category>()
    for (const acc of data.accounts) {
      if (acc.amount === null) continue
      totals[acc.category] += acc.amount
      seenThisMonth.add(acc.category)
    }
    seenThisMonth.forEach(cat => monthsBudgeted[cat]++)
  }
  return { totals, monthsBudgeted }
}

export function useBudgetYear() {
  const monthlyData = ref<MonthData[]>([])
  const loadError = ref<string | null>(null)
  const loading = ref(true)

  async function loadYear() {
    loading.value = true
    loadError.value = null
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => $fetch<MonthData>('/api/budget/targets', { query: { year: YEAR, month: i + 1 } }))
      )
      monthlyData.value = results
    } catch (err: any) {
      loadError.value = err?.data?.statusMessage || err?.message || 'Failed to load budget data'
    } finally {
      loading.value = false
    }
  }
  onMounted(loadYear)

  return { monthlyData, loadError, loading, loadYear }
}

// Real calendar-date closedness for daily_line_items/budget_targets — the
// real synced data these two feed off of, not the app's frozen sample
// "as-of" narration date (AS_OF_MONTH above), which only describes the
// still-sample-data Dashboard/P&L/Month-preview figures. Mirrors the same
// check in server/api/budget/copy-into-month.post.ts.
export function isMonthClosed(year: number, month: number): boolean {
  const now = new Date()
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)
}

// The one month that's neither closed nor entirely in the future — the
// only month where "actuals so far" is a partial, still-growing number
// rather than a final result or nothing at all.
export function isMonthCurrent(year: number, month: number): boolean {
  const now = new Date()
  return year === now.getFullYear() && month === now.getMonth() + 1
}

// How many months of `year` have started as of the real calendar date —
// i.e. could plausibly have actuals synced by now (the current month
// counts, partial as it is). 0 for a year that hasn't started yet, 12 for
// one that's fully in the past.
export function monthsElapsedInYear(year: number): number {
  const now = new Date()
  if (year < now.getFullYear()) return 12
  if (year > now.getFullYear()) return 0
  return now.getMonth() + 1
}

export type MonthActuals = { month: number, hasData: boolean, totals: Record<Category, number> }

// Real per-month actuals from daily_line_items, independent of
// budget_targets — see actuals.get.ts. Empty (hasData: false for every
// month) until a real QBO backfill/sync has populated this year's data.
export function useActualsYear() {
  const monthlyActuals = ref<MonthActuals[]>([])
  const loadError = ref<string | null>(null)

  async function loadActualsYear() {
    loadError.value = null
    try {
      const result = await $fetch<{ year: number, months: MonthActuals[] }>('/api/budget/actuals', { query: { year: YEAR } })
      monthlyActuals.value = result.months
    } catch (err: any) {
      loadError.value = err?.data?.statusMessage || err?.message || 'Failed to load actuals'
    }
  }
  onMounted(loadActualsYear)

  return { monthlyActuals, loadError, loadActualsYear }
}

// direction: for revenue and other income, running ahead of budget pace is
// good; for the cost categories (cogs/labor/opex/other expense), running
// ahead of budget pace means overspending, so the same ratio needs the
// opposite color interpretation. Every category has a real direction now
// that the single 'other' bucket has been split (2026-07-29) into
// other_income/other_expense by actual QBO sign, rather than 'other'
// needing a neutral carve-out.
export type Direction = 'higher-is-better' | 'higher-is-worse'
export const CATEGORY_DIRECTION: Record<Category, Direction> = {
  revenue: 'higher-is-better', cogs: 'higher-is-worse', labor: 'higher-is-worse', opex: 'higher-is-worse',
  other_income: 'higher-is-better', other_expense: 'higher-is-worse'
}

// Same fraction of the year elapsed as the Dashboard's "197 of 365 days
// elapsed" sample figure — shared here so every page computing a year-pace
// expectation (Budget Pace's Year toggle, Edit Budget's year live preview)
// uses the identical number instead of each hardcoding its own copy.
export const YEAR_DAY_FRACTION = 197 / 365

export function paceStatus(actualPct: number, expectedPct: number, direction: Direction) {
  const diff = direction === 'higher-is-better' ? expectedPct - actualPct : actualPct - expectedPct
  if (diff <= 0) return 'good'
  if (diff <= 10) return 'warning'
  if (diff <= 25) return 'serious'
  return 'critical'
}

export type CategoryBenchmark = { category: string, targetPct: number, warningPct: number, seriousPct: number, criticalPct: number }

// Cost-ratio status (COGS/labor/prime-cost % of revenue) against
// category_benchmarks — a different shape from paceStatus above (which
// compares a period's *elapsed-time* pace against a dollar budget).
// targetPct/warningPct/seriousPct are ascending absolute pct-of-revenue
// ceilings: at/below target is 'good', and each successive ceiling crossed
// bumps the status up one level. criticalPct is stored for reference but
// unused here — anything past seriousPct is already 'critical'.
export function benchmarkStatus(actualPct: number, benchmark: CategoryBenchmark | undefined): 'good' | 'warning' | 'serious' | 'critical' | null {
  if (!benchmark) return null
  if (actualPct <= benchmark.targetPct) return 'good'
  if (actualPct <= benchmark.warningPct) return 'warning'
  if (actualPct <= benchmark.seriousPct) return 'serious'
  return 'critical'
}

// Net income is never entered directly — no real QBO account represents it
// (see schema.sql) — so it's always derived as revenue - cogs - labor -
// opex + other_income - other_expense. other_income/other_expense are
// optional here (default 0) so callers still on sample data (Dashboard/P&L
// pages) that don't have those figures at all don't need to pass zeros
// explicitly.
export function netIncome(actuals: Record<'revenue' | 'cogs' | 'labor' | 'opex', number> & Partial<Record<'other_income' | 'other_expense', number>>) {
  return actuals.revenue - actuals.cogs - actuals.labor - actuals.opex + (actuals.other_income ?? 0) - (actuals.other_expense ?? 0)
}

// Shaped like a sync_runs row so this collapses into a real useDb() query
// later without changing the template logic — see schema.sql.
export function useSyncStatus() {
  const lastSync = { status: 'success' as 'success' | 'error', finishedAt: 'today, 3:04 AM', dataThroughDate: 'Jul 16' }
  const syncFailed = computed(() => lastSync.status === 'error')
  return { lastSync, syncFailed }
}
