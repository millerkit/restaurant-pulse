// Shared between the Budget Pace and Edit Budget pages (see CLAUDE.md's
// Budget tab section) — types, sample data, and the year-of-budget-targets
// fetch that both pages need independently.

export type Category = 'revenue' | 'cogs' | 'labor' | 'opex' | 'other'
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
export const CATEGORIES: Category[] = ['revenue', 'cogs', 'labor', 'opex', 'other']
export const CATEGORY_LABEL: Record<Category, string> = { revenue: 'Revenue', cogs: 'COGS', labor: 'Labor', opex: 'Operating Expenses', other: 'Other' }
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

// Actuals (the "how much did we actually make/spend" side of every
// comparison) stay sample data for now — QBO sync isn't wired to the UI
// yet, same as the Dashboard and P&L pages. These are the exact same
// figures already used on those two pages, so all three tabs describe one
// consistent sample month/year rather than three disconnected samples.
// Deliberately excludes 'other' (see note on netIncome below).
export const sampleActuals: Record<'month' | 'year', Record<Exclude<Category, 'other'>, number>> = {
  month: { revenue: 118400, cogs: 39200, labor: 37200, opex: 32700 },
  year: { revenue: 1612000, cogs: 480400, labor: 498100, opex: 572300 }
}

export function categoryTotals(monthlyData: MonthData[], monthNumbers: number[]) {
  const totals: Record<Category, number> = { revenue: 0, cogs: 0, labor: 0, opex: 0, other: 0 }
  const monthsBudgeted: Record<Category, number> = { revenue: 0, cogs: 0, labor: 0, opex: 0, other: 0 }
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

// direction: for revenue, running ahead of budget pace is good; for the
// three cost categories, running ahead of budget pace means overspending,
// so the same ratio needs the opposite color interpretation.
export type Direction = 'higher-is-better' | 'higher-is-worse'
export const CATEGORY_DIRECTION: Record<Exclude<Category, 'other'>, Direction> = {
  revenue: 'higher-is-better', cogs: 'higher-is-worse', labor: 'higher-is-worse', opex: 'higher-is-worse'
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

// Net income is never entered directly — no real QBO account represents it
// (see schema.sql) — so it's always derived as revenue - cogs - labor -
// opex. Excludes 'other' (Other Income/Other Expense): those two QBO
// sections collapse into one 'other' category in this app (see
// CLAUDE.md/schema.sql), so there's no reliable sign to net it against
// revenue here yet.
export function netIncome(actuals: Record<Exclude<Category, 'other'>, number>) {
  return actuals.revenue - actuals.cogs - actuals.labor - actuals.opex
}

// Shaped like a sync_runs row so this collapses into a real useDb() query
// later without changing the template logic — see schema.sql.
export function useSyncStatus() {
  const lastSync = { status: 'success' as 'success' | 'error', finishedAt: 'today, 3:04 AM', dataThroughDate: 'Jul 16' }
  const syncFailed = computed(() => lastSync.status === 'error')
  return { lastSync, syncFailed }
}
