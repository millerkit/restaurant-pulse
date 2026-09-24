<script setup lang="ts">
import site from '~/config/site.json'
import { CATEGORY_LABEL, MONTH_NAMES, YEAR, type BudgetAccount, currentAsOfDay, currentAsOfMonth, daysInMonth, paceStatus, useActualsYear, useBudgetYear } from '~/composables/useBudgetData'

// Mirrors server/utils/core-revenue.ts's CORE_REVENUE_ACCOUNT_NUMBERS — duplicated rather
// than imported since server/utils isn't part of the client bundle (see this file's other
// duplicated-across-the-boundary constants throughout the codebase, e.g. Toast's
// MAX_PLAUSIBLE_GUESTS_PER_ORDER). Deliberately excludes Event Sales (4100s), Catering
// (4200s), Retail (4300s), and Other Service Income (4400) — those land in large, sporadic
// amounts (a booked event or a private buyout) rather than a steady daily trickle, so a
// straight-line actual-to-date extrapolation over- or understates the month wildly depending
// on whether that booking has posted yet (see computedAccountProjected below).
const CORE_REVENUE_ACCOUNT_NUMBERS = ['4000', '4010', '4020', '4022', '4024', '4026', '4028']

useHead({ title: `${site.restaurantName} — Revenue` })

const { monthlyData, loadError, loadYear } = useBudgetYear()
const { monthlyActuals, loadActualsYear } = useActualsYear()

// Revenue projection is forward-looking only — a past/closed month's revenue is already
// final and shown read-only on the Edit Budget page (which still displays every category's
// real actual vs. budget for a closed month, unaffected by this page). Same asOfMonth..Dec
// scope as the Labor tab (app/pages/budget/labor.vue), just rendered as real month tabs per
// the user's explicit ask, rather than Labor's single-view-with-summary-cards approach.
const asOfMonth = currentAsOfMonth()
const asOfDay = currentAsOfDay()
const asOfLabel = `${MONTH_NAMES[asOfMonth - 1]} ${asOfDay}`
const targetMonths = computed(() => Array.from({ length: 12 - asOfMonth + 1 }, (_, i) => asOfMonth + i))

const editMonth = ref(asOfMonth)
const selectedMonthIsCurrent = computed(() => editMonth.value === asOfMonth)

function monthHasBudget(month: number) {
  const data = monthlyData.value[month - 1]
  return !!data && data.accounts.some(a => a.category === 'revenue' && a.amount !== null)
}

const editMonthData = computed(() => monthlyData.value[editMonth.value - 1])
// Every computation below reads from this, never editMonthData.value.accounts directly —
// that array carries every category (the shared /api/budget/targets response), and this
// page must never compute a "changed" figure for a COGS/Labor/Opex account it never
// rendered an input for (see saveRevenue below for why that would be destructive).
const revenueAccounts = computed(() => (editMonthData.value?.accounts || []).filter(a => a.category === 'revenue'))

const editableAccountAmounts = ref<Record<number, string>>({})

function parseEditableAmount(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[,$\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function formatWholeDollars(n: number): string {
  return Math.round(n).toLocaleString()
}

watch(revenueAccounts, (accounts) => {
  editableAccountAmounts.value = {}
  for (const acc of accounts) {
    if (acc.amount !== null) editableAccountAmounts.value[acc.accountId] = formatWholeDollars(acc.amount)
  }
}, { immediate: true })

function onAmountBlur(accountId: number) {
  const raw = editableAccountAmounts.value[accountId]
  if (raw === undefined || raw.trim() === '') {
    editableAccountAmounts.value[accountId] = ''
    return
  }
  editableAccountAmounts.value[accountId] = formatWholeDollars(Math.round(parseEditableAmount(raw) / 10) * 10)
}

// Real per-account actuals — only ever fetched for the current month (a future month has
// nothing synced yet, by definition). Mirrors Edit Budget's own selectedMonthAccountActuals.
const selectedMonthAccountActuals = ref<Record<number, number>>({})
const selectedMonthHasActuals = ref(false)
watch(editMonth, async (month) => {
  if (month !== asOfMonth) {
    selectedMonthAccountActuals.value = {}
    selectedMonthHasActuals.value = false
    return
  }
  try {
    const result = await $fetch<{ accounts: { accountId: number, amount: number }[] }>('/api/budget/actuals-by-account', { query: { year: YEAR, month } })
    const map: Record<number, number> = {}
    for (const a of result.accounts) map[a.accountId] = a.amount
    selectedMonthAccountActuals.value = map
    selectedMonthHasActuals.value = result.accounts.length > 0
  } catch {
    selectedMonthAccountActuals.value = {}
    selectedMonthHasActuals.value = false
  }
}, { immediate: true })

// Same chart-of-accounts-number ordering as Edit Budget's accountsForCategory.
const sortedRevenueAccounts = computed(() => {
  const visible = revenueAccounts.value.filter(accountVisible)
  const all = revenueAccounts.value
  return (visible.length > 0 ? visible : all).sort((a, b) => {
    const an = a.accountNumber !== null ? Number(a.accountNumber) : Infinity
    const bn = b.accountNumber !== null ? Number(b.accountNumber) : Infinity
    return an !== bn ? an - bn : a.name.localeCompare(b.name)
  })
})

const revenueAccountsById = computed(() => {
  const map = new Map<number, BudgetAccount>()
  for (const acc of revenueAccounts.value) map.set(acc.accountId, acc)
  return map
})

function accountDepth(acc: BudgetAccount): number {
  let depth = 0
  let current: BudgetAccount | undefined = acc
  const seen = new Set<number>()
  while (current?.parentAccountId != null && !seen.has(current.parentAccountId)) {
    seen.add(current.parentAccountId)
    current = revenueAccountsById.value.get(current.parentAccountId)
    if (!current) break
    depth++
  }
  return depth
}

function directChildren(accountId: number): BudgetAccount[] {
  return revenueAccounts.value.filter(a => a.parentAccountId === accountId)
}
function isLeafAccount(acc: BudgetAccount): boolean {
  return directChildren(acc.accountId).length === 0
}
function computedAccountAmount(acc: BudgetAccount): number {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return parseEditableAmount(editableAccountAmounts.value[acc.accountId])
  return children.reduce((sum, c) => sum + computedAccountAmount(c), 0)
}
const totalRevenueBudget = computed(() => {
  const roots = revenueAccounts.value.filter(a => a.parentAccountId === null)
  return roots.reduce((sum, a) => sum + computedAccountAmount(a), 0)
})

function computedAccountActual(acc: BudgetAccount): number {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return selectedMonthAccountActuals.value[acc.accountId] || 0
  return children.reduce((sum, c) => sum + computedAccountActual(c), 0)
}
const totalRevenueActual = computed(() => {
  const roots = revenueAccounts.value.filter(a => a.parentAccountId === null)
  return roots.reduce((sum, a) => sum + computedAccountActual(a), 0)
})

// Tue-Sun operating-day fraction of the current month elapsed so far — same definition as
// Edit Budget's monthExpectedFraction (Urban Hearth is closed Mondays). Revenue has no
// lump-sum-posting exception the way rent/loan interest do on the opex side, so a plain
// operating-day fraction is the right proration here, unlike labor's payroll-cycle one.
function isOperatingDay(date: Date): boolean {
  return date.getDay() !== 1
}
function countOperatingDays(start: Date, end: Date): number {
  let count = 0
  const d = new Date(start)
  while (d <= end) {
    if (isOperatingDay(d)) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}
const monthExpectedFraction = computed(() => {
  const monthStart = new Date(YEAR, editMonth.value - 1, 1)
  const monthEnd = new Date(YEAR, editMonth.value, 0)
  const today = new Date()
  const totalOperatingDays = countOperatingDays(monthStart, monthEnd)
  if (totalOperatingDays === 0) return 0
  return countOperatingDays(monthStart, today) / totalOperatingDays
})
function projectFromActual(actual: number): number {
  const fraction = monthExpectedFraction.value
  if (fraction <= 0) return actual
  return actual / fraction
}
function isCoreRevenueAccount(acc: BudgetAccount): boolean {
  return acc.accountNumber !== null && CORE_REVENUE_ACCOUNT_NUMBERS.includes(acc.accountNumber)
}
// The "floor at actual-to-date" fallback below (used for Event/Catering/Retail-style
// accounts) has to be sign-aware: most revenue accounts are budgeted positive, where "actual
// already exceeds budget" should win via Math.max. But a contra-revenue account (e.g. 4900
// Contra-Income/4910 Discounts & Comps) is budgeted *negative*, where Math.max(0, -2200)
// would wrongly resolve to $0 — silently dropping the expected discount from the projected
// total — instead of the intended $-2,200. Math.min is the correct floor once budget is
// negative (bigger real discount than planned should still win over the budgeted estimate).
function budgetFloor(actual: number, budget: number): number {
  return budget >= 0 ? Math.max(actual, budget) : Math.min(actual, budget)
}
// Leaf accounts decide their own projection method (core dine-in gets the day-fraction
// extrapolation; Event/Catering/Retail-style accounts fall back to their own budget — the
// best available estimate of what's actually booked this month — floored at actual-to-date
// so a bigger-than-planned event already received isn't hidden); a parent/group/total figure
// is always the sum of its children's own projected figures, same rollup pattern as
// computedAccountAmount/computedAccountActual above, never a second independent calculation
// over the aggregate (that would let one child's overage get masked by another child's
// shortfall — see this function's own history for why that was rejected).
function computedAccountProjected(acc: BudgetAccount): number {
  const children = directChildren(acc.accountId)
  if (children.length === 0) {
    const actual = computedAccountActual(acc)
    if (isCoreRevenueAccount(acc)) return projectFromActual(actual)
    return budgetFloor(actual, computedAccountAmount(acc))
  }
  return children.reduce((sum, c) => sum + computedAccountProjected(c), 0)
}
const totalRevenueProjected = computed(() => {
  const roots = revenueAccounts.value.filter(a => a.parentAccountId === null)
  return roots.reduce((sum, a) => sum + computedAccountProjected(a), 0)
})

// Revenue is always "higher is better" — no direction table needed for a single-category page.
function varianceFor(budget: number, actual: number): { kind: 'no-budget' } | { kind: 'value', delta: number, status: ReturnType<typeof paceStatus> } {
  if (!budget) return { kind: 'no-budget' }
  const actualPct = (actual / budget) * 100
  const status = paceStatus(actualPct, 100, 'higher-is-better')
  return { kind: 'value', delta: actual - budget, status }
}
type Variance = ReturnType<typeof varianceFor> | { kind: 'no-actuals' }
function varianceIcon(v?: Variance): string {
  if (!v || v.kind !== 'value') return ''
  return v.status === 'good' ? '✓' : (v.delta >= 0 ? '▲' : '▼')
}
function varianceClass(v?: Variance): string {
  if (!v || v.kind !== 'value') return ''
  return `v-${v.status}`
}
function varianceDeltaLabel(v?: Variance): string {
  if (!v || v.kind !== 'value') return ''
  const sign = v.delta >= 0 ? '+' : '−'
  return `(${sign}$${Math.abs(Math.round(v.delta)).toLocaleString()})`
}
const totalRevenueProjectedVariance = computed<Variance>(() => {
  if (!selectedMonthIsCurrent.value) return { kind: 'no-actuals' }
  if (!selectedMonthHasActuals.value) return { kind: 'no-actuals' }
  return varianceFor(totalRevenueBudget.value, totalRevenueProjected.value)
})
const accountProjectedVarianceById = computed(() => {
  const map = new Map<number, Variance>()
  if (!selectedMonthIsCurrent.value) return map
  for (const acc of revenueAccounts.value) {
    map.set(acc.accountId, selectedMonthHasActuals.value
      ? varianceFor(computedAccountAmount(acc), computedAccountProjected(acc))
      : { kind: 'no-actuals' })
  }
  return map
})

// ---- Row filter: hide $0 rows ---------------------------------------------
const hideZeroRows = ref(true)
function hasNoStoredAmount(amount: number | null): boolean {
  return amount === null || amount === 0
}
function leafVisible(acc: BudgetAccount): boolean {
  if (!hideZeroRows.value) return true
  return !hasNoStoredAmount(acc.amount)
}
function accountVisible(acc: BudgetAccount): boolean {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return leafVisible(acc)
  return children.some(accountVisible)
}

// ---- Year Total (read-only) ------------------------------------------------
// Combines real YTD actuals (Jan..asOfMonth-1, from daily_line_items) with the current
// month's actual-to-date extrapolated to a full month (same projection this page's own
// current-month "Projected" column already uses) and every future month's own budgeted
// figure — one read-only "where does this account end the year" total per the user's own
// request. Fetched once on mount, independent of which month tab is selected — unlike
// selectedMonthAccountActuals above, which is scoped to whichever month is being edited and
// clears when you switch away from it.
const yearActualsByMonth = ref<Record<number, Record<number, number>>>({})
const yearActualsHasData = ref<Record<number, boolean>>({})
const yearActualsLoaded = ref(false)

async function loadYearActuals() {
  const months = Array.from({ length: asOfMonth }, (_, i) => i + 1)
  const results = await Promise.all(months.map(month =>
    $fetch<{ accounts: { accountId: number, amount: number }[] }>('/api/budget/actuals-by-account', { query: { year: YEAR, month } })
      .catch(() => ({ accounts: [] }))
  ))
  const byMonth: Record<number, Record<number, number>> = {}
  const hasData: Record<number, boolean> = {}
  months.forEach((month, i) => {
    const map: Record<number, number> = {}
    for (const a of results[i].accounts) map[a.accountId] = a.amount
    byMonth[month] = map
    hasData[month] = results[i].accounts.length > 0
  })
  yearActualsByMonth.value = byMonth
  yearActualsHasData.value = hasData
  yearActualsLoaded.value = true
}
onMounted(loadYearActuals)

// Same Tue-Sun operating-day fraction as monthExpectedFraction below, but always for
// asOfMonth specifically — monthExpectedFraction tracks whichever month tab is selected,
// which this year-round-up must not depend on.
const asOfMonthExpectedFraction = computed(() => {
  const monthStart = new Date(YEAR, asOfMonth - 1, 1)
  const monthEnd = new Date(YEAR, asOfMonth, 0)
  const today = new Date()
  const totalOperatingDays = countOperatingDays(monthStart, monthEnd)
  if (totalOperatingDays === 0) return 0
  return countOperatingDays(monthStart, today) / totalOperatingDays
})

function accountBudgetForMonth(month: number, accountId: number): number {
  return monthlyData.value[month - 1]?.accounts.find(a => a.accountId === accountId)?.amount ?? 0
}

// Per-leaf-account hybrid year total: real actual for every closed month that's actually
// synced (falling back to that month's budget if a closed month hasn't synced yet), the
// current month's actual-to-date extrapolated to a full month, and every future month's
// budget — substituting this page's own in-progress (unsaved) draft for whichever single
// month is currently open in the editor, so an edit you haven't saved yet is reflected here
// immediately, same as the Live Preview card's own live-draft substitution.
function yearAccountTotal(accountId: number): number {
  let total = 0
  for (let m = 1; m < asOfMonth; m++) {
    total += yearActualsHasData.value[m] ? (yearActualsByMonth.value[m]?.[accountId] ?? 0) : accountBudgetForMonth(m, accountId)
  }
  if (yearActualsHasData.value[asOfMonth]) {
    const actualToDate = yearActualsByMonth.value[asOfMonth]?.[accountId] ?? 0
    const acc = revenueAccountsById.value.get(accountId)
    if (acc && isCoreRevenueAccount(acc)) {
      const fraction = asOfMonthExpectedFraction.value
      total += fraction > 0 ? actualToDate / fraction : actualToDate
    } else {
      // Same budget-floor fallback as computedAccountProjected above, for the same reason
      // (Event/Catering/Retail-style accounts don't trickle in steadily) — uses the live
      // unsaved draft when asOfMonth is the month currently open in the editor, matching the
      // else-branch below's own draft-vs-stored-budget distinction.
      const monthBudget = editMonth.value === asOfMonth ? parseEditableAmount(editableAccountAmounts.value[accountId]) : accountBudgetForMonth(asOfMonth, accountId)
      total += budgetFloor(actualToDate, monthBudget)
    }
  } else {
    total += editMonth.value === asOfMonth ? parseEditableAmount(editableAccountAmounts.value[accountId]) : accountBudgetForMonth(asOfMonth, accountId)
  }
  for (let m = asOfMonth + 1; m <= 12; m++) {
    total += editMonth.value === m ? parseEditableAmount(editableAccountAmounts.value[accountId]) : accountBudgetForMonth(m, accountId)
  }
  return total
}
// Parent-sums-its-children version of yearAccountTotal, mirroring computedAccountAmount —
// directChildren/isLeafAccount are safe to reuse here even though they're built off
// revenueAccounts.value (whichever month is currently selected): the account tree's
// parent/child shape is identical across every month, only the per-month amounts differ.
function yearComputedAccountAmount(acc: BudgetAccount): number {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return yearAccountTotal(acc.accountId)
  return children.reduce((sum, c) => sum + yearComputedAccountAmount(c), 0)
}
const yearTotalRevenue = computed(() => {
  const roots = revenueAccounts.value.filter(a => a.parentAccountId === null)
  return roots.reduce((sum, a) => sum + yearComputedAccountAmount(a), 0)
})
function yearLeafVisible(acc: BudgetAccount): boolean {
  if (!hideZeroRows.value) return true
  return yearAccountTotal(acc.accountId) !== 0
}
function yearAccountVisible(acc: BudgetAccount): boolean {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return yearLeafVisible(acc)
  return children.some(yearAccountVisible)
}
const sortedYearRevenueAccounts = computed(() => {
  const visible = revenueAccounts.value.filter(yearAccountVisible)
  const all = revenueAccounts.value
  return (visible.length > 0 ? visible : all).sort((a, b) => {
    const an = a.accountNumber !== null ? Number(a.accountNumber) : Infinity
    const bn = b.accountNumber !== null ? Number(b.accountNumber) : Infinity
    return an !== bn ? an - bn : a.name.localeCompare(b.name)
  })
})

const viewingYearTotal = ref(false)
function selectYearTotal() {
  viewingYearTotal.value = true
}

// ---- Live pace preview (current month only) --------------------------------
const livePaceExpectedPct = computed(() => (asOfDay / daysInMonth(YEAR, asOfMonth)) * 100)
const livePaceCard = computed(() => {
  if (!selectedMonthHasActuals.value) return { noActuals: true as const, noBudget: false as const }
  const budget = totalRevenueBudget.value
  if (!budget) return { noActuals: false as const, noBudget: true as const }
  const actualPct = (totalRevenueActual.value / budget) * 100
  const status = paceStatus(actualPct, livePaceExpectedPct.value, 'higher-is-better')
  return { noActuals: false as const, noBudget: false as const, actualPct, status }
})

// ---- Previous-month gap-filler ---------------------------------------------
const previousMonthLabel = computed(() => editMonth.value > 1 ? MONTH_NAMES[editMonth.value - 2] : null)
const actionStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const actionMessage = ref('')

async function fillMissingFromLastMonth() {
  if (!previousMonthLabel.value) return
  actionStatus.value = 'running'
  try {
    const result = await $fetch<{ updated: number, source: 'actuals' | 'budget' }>('/api/budget/copy-into-month', {
      method: 'POST',
      body: {
        sourceYear: YEAR, sourceMonth: editMonth.value - 1,
        targetMonths: [{ year: YEAR, month: editMonth.value }],
        // Scoped to this page's own revenue accounts only — this action must never touch
        // COGS/Labor/Opex/Other budget_targets rows it never rendered an input for.
        accountIds: revenueAccounts.value.map(a => a.accountId),
        allowBudgetFallback: true, onlyMissing: true, roundTo: 10
      }
    })
    actionMessage.value = result.updated > 0
      ? `Filled in ${result.updated} revenue account(s) with no existing budget for ${MONTH_NAMES[editMonth.value - 1]}, from ${previousMonthLabel.value}'s ${result.source === 'actuals' ? 'actuals' : 'budget'}.`
      : `Every revenue account already has a budget for ${MONTH_NAMES[editMonth.value - 1]} — nothing to fill in.`
    actionStatus.value = 'done'
    await loadYear()
  } catch (err: any) {
    actionStatus.value = 'error'
    actionMessage.value = err?.data?.statusMessage || err?.message || 'No actuals or budget available yet'
  }
}

// ---- Revenue from Capacity assumptions -----------------------------------
// The Capacity tab's Edit Capacity view (app/pages/capacity/edit.vue) already models a real
// bottom-up revenue projection — per-area expected covers x per-cover Food/Beverage revenue
// (see schema.sql's capacity_areas comment and server/api/capacity.get.ts) — so rather than
// duplicating a per-area covers editor here (a design question resolved directly with the
// user: keep the existing one-click sync, don't fork capacity_area_seasonality editing
// across two pages), this pulls that same month's Capacity-projected Food/Beverage revenue
// and offers to write it into the real Food (4010)/Beverage (4022/4024/4026/4028) revenue
// accounts. Moved here verbatim from Edit Budget's own former Revenue section.
type CapacityAssumedMonth = { expectedRevenueFood: number, expectedRevenueBeverage: number }
type CapacityMonth = { month: number, assumed: CapacityAssumedMonth }
const capacityMonths = ref<CapacityMonth[] | null>(null)
async function loadCapacityMonths() {
  try {
    const result = await $fetch<{ months: CapacityMonth[] }>('/api/capacity')
    capacityMonths.value = result.months?.length ? result.months : null
  } catch {
    capacityMonths.value = null
  }
}
onMounted(loadCapacityMonths)

function capacityTargetForMonth(month: number): CapacityAssumedMonth | null {
  return capacityMonths.value?.find(m => m.month === month)?.assumed ?? null
}

function leafRevenueAccountsForGroup(group: 'Food' | 'Beverage'): BudgetAccount[] {
  return revenueAccounts.value.filter(a => a.subcategory === group && isLeafAccount(a))
}
function currentGroupRevenueBudget(group: 'Food' | 'Beverage'): number {
  return leafRevenueAccountsForGroup(group).reduce((sum, a) => sum + (a.amount || 0), 0)
}

type BeverageMixAccount = { accountId: number, accountNumber: string | null, name: string, pct: number | null }
const beverageRevenueMix = ref<BeverageMixAccount[] | null>(null)
async function loadBeverageRevenueMix() {
  try {
    const result = await $fetch<{ hasData: boolean, accounts: BeverageMixAccount[] }>('/api/budget/beverage-revenue-mix')
    beverageRevenueMix.value = result.hasData ? result.accounts : null
  } catch {
    beverageRevenueMix.value = null
  }
}
onMounted(loadBeverageRevenueMix)

const beverageMixLabel = computed(() => {
  const mix = beverageRevenueMix.value
  if (!mix) return null
  return mix.map(m => `${m.name.replace(/^Restaurant /, '')} ${Math.round((m.pct ?? 0) * 100)}%`).join(', ')
})

const REVENUE_RECOMPUTE_THRESHOLD = 1
function revenueComparisons() {
  const target = capacityTargetForMonth(editMonth.value)
  if (!target) return []
  return (['Food', 'Beverage'] as const).map(group => ({
    group,
    targetAmount: group === 'Food' ? target.expectedRevenueFood : target.expectedRevenueBeverage,
    currentAmount: currentGroupRevenueBudget(group)
  }))
}
const revenueHasCapacityData = computed(() => capacityTargetForMonth(editMonth.value) !== null)
const revenueNeedsRecompute = computed(() =>
  revenueComparisons().some(c => Math.abs(c.currentAmount - c.targetAmount) > REVENUE_RECOMPUTE_THRESHOLD)
)

const revenueRecomputeStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const revenueRecomputeMessage = ref('')

async function recomputeRevenueFromCapacity() {
  revenueRecomputeStatus.value = 'running'
  try {
    const target = capacityTargetForMonth(editMonth.value)
    if (!target) throw new Error(`No Capacity assumptions found for ${MONTH_NAMES[editMonth.value - 1]} — check the Edit Capacity page`)

    const targets: { year: number, month: number, accountId: number, amount: number }[] = []
    const summary: string[] = []
    for (const group of ['Food', 'Beverage'] as const) {
      const groupTarget = group === 'Food' ? target.expectedRevenueFood : target.expectedRevenueBeverage
      const accounts = leafRevenueAccountsForGroup(group)
      if (accounts.length === 0) continue
      const mixByAccountId = group === 'Beverage'
        ? new Map((beverageRevenueMix.value ?? []).map(m => [m.accountId, m.pct]))
        : null
      const usingRealMix = !!mixByAccountId && accounts.every(a => mixByAccountId.get(a.accountId) != null)
      const oldTotal = accounts.reduce((sum, a) => sum + (a.amount || 0), 0)
      for (const a of accounts) {
        const weight = usingRealMix
          ? (mixByAccountId!.get(a.accountId) ?? 0)
          : (oldTotal > 0 ? (a.amount || 0) / oldTotal : 1 / accounts.length)
        targets.push({ year: YEAR, month: editMonth.value, accountId: a.accountId, amount: Math.round(groupTarget * weight * 100) / 100 })
      }
      summary.push(`${group} $${Math.round(groupTarget).toLocaleString()}${group === 'Beverage' ? (usingRealMix ? ' (real Beer/Liquor/Wine/N-A mix)' : ' (no sales mix data yet — used existing budget weight)') : ''}`)
    }
    if (targets.length === 0) throw new Error('No Food/Beverage revenue accounts found to recompute')

    await $fetch('/api/budget/targets', { method: 'POST', body: { targets } })
    await loadYear()
    revenueRecomputeMessage.value = `Recomputed ${MONTH_NAMES[editMonth.value - 1]} Revenue from Capacity assumptions: ${summary.join(', ')}.`
    revenueRecomputeStatus.value = 'done'
  } catch (err: any) {
    revenueRecomputeStatus.value = 'error'
    revenueRecomputeMessage.value = err?.data?.statusMessage || err?.message || 'Recompute failed'
  }
}

// ---- Buyout revenue planning -------------------------------------------
// A buyout doesn't add its full guaranteed minimum to the month — it swaps
// out whatever that night would have made anyway, so the real incremental
// revenue is (buyout rate − that weekday's normal-night target). Reuses the
// same real per-weekday targets the Dashboard's This Week's Targets section
// already computes (server/utils/weekly-targets.ts), so "a normal Thursday"
// means the same thing here as it does there.
type BuyoutWeekday = { dow: number, label: string, short: string, dollarTarget: number | null, rate: number }
const buyoutRates = ref<{ weekdayRate: number, weekendRate: number } | null>(null)
const buyoutWeekdays = ref<BuyoutWeekday[]>([])
const buyoutAppliedByAccountId = ref<Record<number, number>>({})
const buyoutFoodBeverageMix = ref<{ foodPct: number | null, beveragePct: number | null, hasData: boolean }>({ foodPct: null, beveragePct: null, hasData: false })
const buyoutCountInputs = ref<Record<number, string>>({})

async function loadBuyoutPlan() {
  try {
    const result = await $fetch<{
      rates: { weekdayRate: number, weekendRate: number }
      weekdays: BuyoutWeekday[]
      countByDow: Record<string, number>
      appliedByAccountId: Record<string, number>
      foodBeverageMix: { foodPct: number | null, beveragePct: number | null, hasData: boolean }
    }>('/api/budget/buyout-plan', { query: { year: YEAR, month: editMonth.value } })
    buyoutRates.value = result.rates
    buyoutWeekdays.value = result.weekdays
    buyoutAppliedByAccountId.value = result.appliedByAccountId
    buyoutFoodBeverageMix.value = result.foodBeverageMix
    const inputs: Record<number, string> = {}
    for (const w of result.weekdays) inputs[w.dow] = String(result.countByDow[w.dow] ?? 0)
    buyoutCountInputs.value = inputs
  } catch {
    buyoutRates.value = null
    buyoutWeekdays.value = []
    buyoutAppliedByAccountId.value = {}
    buyoutCountInputs.value = {}
  }
}
onMounted(loadBuyoutPlan)
watch(editMonth, loadBuyoutPlan)

// Decimal counts are intentional, not just tolerated — a buyout priced
// above/below the standard rate for its weekday (e.g. a negotiated $11,000
// Thursday instead of the usual $10,000) is genuinely "1 buyout," so it's
// represented as a fractional multiple of the standard rate (here, 1.4645)
// rather than forcing the manual Food/Beverage adjustment this replaced.
// Rounded to 4 decimal places purely to avoid float noise accumulating
// across repeated edits — not a meaningful precision limit for a dollar
// figure this size.
function parseCount(raw: string | undefined): number {
  const n = Number((raw ?? '').replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 10000) / 10000
}

// Rate editor — a separate, deliberately global save (not per-month): the
// $10K/$12K tiers are the restaurant's current pricing, not a monthly
// assumption, so editing them here updates every month's preview at once.
const weekdayRateInput = ref('')
const weekendRateInput = ref('')
watch(buyoutRates, (rates) => {
  if (!rates) return
  weekdayRateInput.value = String(rates.weekdayRate)
  weekendRateInput.value = String(rates.weekendRate)
}, { immediate: true })
const rateSaveStatus = ref<'idle' | 'saving' | 'done' | 'error'>('idle')
async function saveBuyoutRates() {
  rateSaveStatus.value = 'saving'
  try {
    const weekdayRate = Number(weekdayRateInput.value.replace(/[,$\s]/g, ''))
    const weekendRate = Number(weekendRateInput.value.replace(/[,$\s]/g, ''))
    if (!Number.isFinite(weekdayRate) || weekdayRate <= 0 || !Number.isFinite(weekendRate) || weekendRate <= 0) {
      throw new Error('Both rates must be positive numbers')
    }
    await $fetch('/api/budget/buyout-rates', { method: 'POST', body: { weekdayRate, weekendRate } })
    await loadBuyoutPlan()
    rateSaveStatus.value = 'done'
  } catch (err: any) {
    rateSaveStatus.value = 'error'
    // eslint-disable-next-line no-console
    console.error(err)
  }
}

// The planned incremental revenue for the selected month — sum across every
// weekday of count x (rate − normal-night target). A weekday with no target
// yet (not enough real history) contributes nothing rather than guessing.
const buyoutIncrementTotal = computed(() => {
  return buyoutWeekdays.value.reduce((sum, w) => {
    const count = parseCount(buyoutCountInputs.value[w.dow])
    if (count === 0 || w.dollarTarget == null) return sum
    return sum + count * (w.rate - w.dollarTarget)
  }, 0)
})
const FOOD_PCT_FALLBACK = 0.65 // matches import-capacity-projections.mjs's own fallback for the same split, before any real revenue data exists
const buyoutIncrementFood = computed(() => buyoutIncrementTotal.value * (buyoutFoodBeverageMix.value.foodPct ?? FOOD_PCT_FALLBACK))
const buyoutIncrementBeverage = computed(() => buyoutIncrementTotal.value * (buyoutFoodBeverageMix.value.beveragePct ?? (1 - FOOD_PCT_FALLBACK)))

const buyoutHasAnyCount = computed(() => buyoutWeekdays.value.some(w => parseCount(buyoutCountInputs.value[w.dow]) > 0))
// Disabled once a fresh Apply would be a no-op — same "nothing changed"
// disable pattern as the Capacity recompute button.
const buyoutNeedsApply = computed(() => {
  const totalApplied = Object.values(buyoutAppliedByAccountId.value).reduce((s, v) => s + v, 0)
  return Math.abs(buyoutIncrementTotal.value - totalApplied) > 1
})

const buyoutApplyStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const buyoutApplyMessage = ref('')

async function applyBuyoutRevenue() {
  buyoutApplyStatus.value = 'running'
  try {
    const foodAccount = revenueAccounts.value.find(a => a.accountNumber === '4010')
    const beverageAccounts = leafRevenueAccountsForGroup('Beverage')
    if (!foodAccount || beverageAccounts.length === 0) throw new Error('Could not find Food/Beverage accounts to apply to')

    const mixByAccountId = new Map((beverageRevenueMix.value ?? []).map(m => [m.accountId, m.pct]))
    const usingRealMix = beverageAccounts.every(a => mixByAccountId.get(a.accountId) != null)
    const oldBeverageTotal = beverageAccounts.reduce((sum, a) => sum + (a.amount || 0), 0)

    const targets: { year: number, month: number, accountId: number, amount: number }[] = []
    const applied: { accountId: number, amount: number }[] = []

    const foodPreviouslyApplied = buyoutAppliedByAccountId.value[foodAccount.accountId] ?? 0
    const foodIncrement = Math.round(buyoutIncrementFood.value * 100) / 100
    const newFoodAmount = (foodAccount.amount || 0) - foodPreviouslyApplied + foodIncrement
    targets.push({ year: YEAR, month: editMonth.value, accountId: foodAccount.accountId, amount: Math.round(newFoodAmount * 100) / 100 })
    applied.push({ accountId: foodAccount.accountId, amount: foodIncrement })

    for (const a of beverageAccounts) {
      const weight = usingRealMix
        ? (mixByAccountId.get(a.accountId) ?? 0)
        : (oldBeverageTotal > 0 ? (a.amount || 0) / oldBeverageTotal : 1 / beverageAccounts.length)
      const leafIncrement = Math.round(buyoutIncrementBeverage.value * weight * 100) / 100
      const previouslyApplied = buyoutAppliedByAccountId.value[a.accountId] ?? 0
      const newAmount = (a.amount || 0) - previouslyApplied + leafIncrement
      targets.push({ year: YEAR, month: editMonth.value, accountId: a.accountId, amount: Math.round(newAmount * 100) / 100 })
      applied.push({ accountId: a.accountId, amount: leafIncrement })
    }

    const counts: Record<number, number> = {}
    for (const w of buyoutWeekdays.value) counts[w.dow] = parseCount(buyoutCountInputs.value[w.dow])

    await $fetch('/api/budget/targets', { method: 'POST', body: { targets } })
    await $fetch('/api/budget/buyout-plan', { method: 'POST', body: { year: YEAR, month: editMonth.value, counts, applied } })
    await Promise.all([loadYear(), loadBuyoutPlan()])

    buyoutApplyMessage.value = `Applied ${MONTH_NAMES[editMonth.value - 1]}'s planned buyout revenue: +$${Math.round(buyoutIncrementFood.value + buyoutIncrementBeverage.value).toLocaleString()} (Food $${Math.round(buyoutIncrementFood.value).toLocaleString()} / Beverage $${Math.round(buyoutIncrementBeverage.value).toLocaleString()}).`
    buyoutApplyStatus.value = 'done'
  } catch (err: any) {
    buyoutApplyStatus.value = 'error'
    buyoutApplyMessage.value = err?.data?.statusMessage || err?.message || 'Apply failed'
  }
}

watch(editMonth, () => {
  revenueRecomputeStatus.value = 'idle'
  revenueRecomputeMessage.value = ''
  actionStatus.value = 'idle'
  actionMessage.value = ''
  saveStatus.value = 'idle'
  saveMessage.value = ''
  buyoutApplyStatus.value = 'idle'
  buyoutApplyMessage.value = ''
})

// ---- Save / unsaved-changes guard -------------------------------------------
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'nochange' | 'error'>('idle')
const saveMessage = ref('')

function changedTargets(): { year: number, month: number, accountId: number, amount: number }[] {
  const targets: { year: number, month: number, accountId: number, amount: number }[] = []
  for (const acc of revenueAccounts.value) {
    if (!isLeafAccount(acc)) continue
    const newAmount = parseEditableAmount(editableAccountAmounts.value[acc.accountId])
    if (Math.round(newAmount) !== Math.round(acc.amount ?? 0)) {
      targets.push({ year: YEAR, month: editMonth.value, accountId: acc.accountId, amount: newAmount })
    }
  }
  return targets
}

const hasUnsavedChanges = computed(() => changedTargets().length > 0)

const UNSAVED_CHANGES_MESSAGE = 'You have unsaved revenue edits for this month. Discard them and continue?'
function selectMonth(month: number) {
  if (hasUnsavedChanges.value && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return
  editMonth.value = month
  viewingYearTotal.value = false
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', handleBeforeUnload))

onBeforeRouteLeave(() => {
  if (hasUnsavedChanges.value && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return false
})

async function saveRevenue() {
  saveStatus.value = 'saving'
  try {
    const targets = changedTargets()
    if (targets.length === 0) {
      // Real, reachable state — clicking Save after "Recompute from Capacity" or "Fill in
      // missing" already persisted everything (both save directly, then reload), or just
      // clicking Save twice in a row. Previously this silently reset to 'idle' with no
      // visible change at all, which read as "the button doesn't do anything" (reported
      // directly by the user against a real screenshot) — it was working, just mute.
      saveStatus.value = 'nochange'
      return
    }
    await $fetch('/api/budget/targets', { method: 'POST', body: { targets } })
    await loadYear()
    saveStatus.value = 'saved'
  } catch (err: any) {
    saveStatus.value = 'error'
    saveMessage.value = err?.data?.statusMessage || err?.message || 'Save failed'
  }
}
</script>

<template>
  <div>
    <PageHeader
      page-name="Revenue"
      :description="`Project revenue by account for ${MONTH_NAMES[asOfMonth - 1]}–Dec, fed from Capacity's covers-by-area assumptions · ${YEAR}`"
      :as-of-label="asOfLabel"
      @synced="loadYear(); loadActualsYear()"
    />

    <div v-if="loadError" class="drill-card">
      <span class="chip critical">Couldn't load budget data</span>
      <span class="quiet-note">{{ loadError }}</span>
    </div>

    <template v-else>
      <section>
        <div v-if="selectedMonthIsCurrent && !viewingYearTotal" class="live-pace-card">
          <div class="live-pace-head">
            <span class="chip accent">Live Preview</span>
            <span class="quiet-note">How {{ MONTH_NAMES[editMonth - 1] }}'s actual-to-date revenue paces against the budget below, including any edits you haven't saved yet.</span>
          </div>
          <div class="live-pace-grid">
            <div class="live-pace-item">
              <span class="name">{{ CATEGORY_LABEL.revenue }}</span>
              <span v-if="livePaceCard.noActuals" class="chip warning">No actual data synced</span>
              <span v-else-if="livePaceCard.noBudget" class="chip warning">No budget</span>
              <span v-else :class="['chip', livePaceCard.status]">{{ livePaceCard.actualPct!.toFixed(1) }}% of budget</span>
            </div>
          </div>
        </div>

        <div class="legend">
          <span class="chip good">On / ahead of budget</span>
          <span class="chip warning">Watch</span>
          <span class="chip serious">Off pace</span>
          <span class="chip critical">Under budget</span>
        </div>

        <div v-if="!viewingYearTotal" class="drill-card capacity-panel">
          <div class="live-pace-head">
            <span class="chip accent">Fed from Capacity</span>
            <span class="quiet-note">The Capacity tab's per-area expected-covers assumptions already project Food/Beverage revenue for this month — pull that projection in instead of typing a figure in twice.</span>
          </div>
          <div v-if="revenueHasCapacityData" class="section-note">
            From the <NuxtLink to="/capacity?tab=edit">Capacity tab's</NuxtLink> projection for {{ MONTH_NAMES[editMonth - 1] }}:
            Food <strong>${{ Math.round(capacityTargetForMonth(editMonth)?.expectedRevenueFood ?? 0).toLocaleString() }}</strong>,
            Beverage <strong>${{ Math.round(capacityTargetForMonth(editMonth)?.expectedRevenueBeverage ?? 0).toLocaleString() }}</strong>
            <template v-if="beverageMixLabel">(split {{ beverageMixLabel }}, from real sales since the location move)</template>
            <template v-else>(no real Beer/Liquor/Wine/Non-Alcoholic sales mix yet — will split by whatever's already budgeted)</template>.
            <button
              class="mini-btn" :disabled="revenueRecomputeStatus === 'running' || (!revenueNeedsRecompute && revenueRecomputeStatus !== 'done')"
              :title="!revenueNeedsRecompute && revenueRecomputeStatus !== 'done' ? 'Already matches the Capacity projection — nothing to change' : ''"
              @click="recomputeRevenueFromCapacity"
            >
              Recompute {{ MONTH_NAMES[editMonth - 1] }} Revenue from Capacity
            </button>
            <span v-if="revenueRecomputeStatus === 'done'" class="chip good">{{ revenueRecomputeMessage }}</span>
            <span v-if="revenueRecomputeStatus === 'error'" class="chip warning">{{ revenueRecomputeMessage }}</span>
          </div>
          <div v-else class="quiet-note small">No Capacity assumptions found for {{ MONTH_NAMES[editMonth - 1] }} yet — set expected covers by area on the <NuxtLink to="/capacity?tab=edit">Edit Capacity page</NuxtLink>.</div>
        </div>

        <div v-if="!viewingYearTotal" class="drill-card capacity-panel">
          <div class="live-pace-head">
            <span class="chip accent">Buyout Revenue</span>
            <span class="quiet-note">A buyout swaps a normal night for a guaranteed minimum — only the difference over what that weekday normally makes is new revenue.</span>
          </div>

          <div class="section-note buyout-rates-row">
            <span>Guaranteed minimum: Tue–Thu $</span>
            <input type="text" inputmode="numeric" class="rate-input" v-model="weekdayRateInput" />
            <span>· Fri–Sun $</span>
            <input type="text" inputmode="numeric" class="rate-input" v-model="weekendRateInput" />
            <button class="mini-btn" :disabled="rateSaveStatus === 'saving'" @click="saveBuyoutRates">Update rates</button>
            <span v-if="rateSaveStatus === 'error'" class="chip warning">Couldn't save rates</span>
          </div>

          <div class="buyout-weekday-grid">
            <div v-for="w in buyoutWeekdays" :key="w.dow" class="buyout-weekday-cell">
              <span class="buyout-weekday-label">{{ w.short }}</span>
              <span class="buyout-weekday-target">{{ w.dollarTarget != null ? `normal night ~$${Math.round(w.dollarTarget).toLocaleString()}` : 'not enough data yet' }}</span>
              <input
                type="text" inputmode="decimal" class="buyout-count-input"
                v-model="buyoutCountInputs[w.dow]" :disabled="w.dollarTarget == null" placeholder="0"
                title="Decimals are fine — a buyout priced above/below this weekday's standard rate is a fractional count (e.g. 1.4645 for a $11,000 Thursday against a $10,000 standard rate)"
              />
            </div>
          </div>

          <div class="section-note">
            <template v-if="buyoutHasAnyCount">
              Planned buyout revenue for {{ MONTH_NAMES[editMonth - 1] }}:
              <strong>+${{ Math.round(buyoutIncrementTotal).toLocaleString() }}</strong>
              (Food ${{ Math.round(buyoutIncrementFood).toLocaleString() }} / Beverage ${{ Math.round(buyoutIncrementBeverage).toLocaleString() }}<template v-if="!buyoutFoodBeverageMix.hasData"> — no real sales data yet, used a 65/35 fallback split</template>).
            </template>
            <template v-else>No buyouts planned for {{ MONTH_NAMES[editMonth - 1] }} yet.</template>
            <button
              class="mini-btn" :disabled="buyoutApplyStatus === 'running' || !buyoutNeedsApply"
              :title="!buyoutNeedsApply ? 'Already matches the current plan — nothing to change' : ''"
              @click="applyBuyoutRevenue"
            >Apply to {{ MONTH_NAMES[editMonth - 1] }}'s budget</button>
            <span v-if="buyoutApplyStatus === 'done'" class="chip good">{{ buyoutApplyMessage }}</span>
            <span v-if="buyoutApplyStatus === 'error'" class="chip warning">{{ buyoutApplyMessage }}</span>
          </div>
        </div>

        <div v-if="!viewingYearTotal" class="action-row">
          <button
            class="action-btn" :disabled="actionStatus === 'running' || !previousMonthLabel"
            :title="previousMonthLabel ? `Fills in only accounts with no budget yet, from ${previousMonthLabel}'s actuals if synced (otherwise its budget), rounded to the nearest $10` : 'No prior month available'"
            @click="fillMissingFromLastMonth"
          >Fill in missing accounts from {{ previousMonthLabel || '—' }}</button>
          <span v-if="hasUnsavedChanges" class="chip warning">Unsaved changes</span>
          <button class="action-btn primary" :disabled="saveStatus === 'saving'" @click="saveRevenue">Save revenue</button>
        </div>
        <div v-if="saveStatus === 'saved'" class="chip good">Saved</div>
        <div v-if="saveStatus === 'nochange'" class="chip neutral">Nothing to save — already up to date</div>
        <div v-if="saveStatus === 'error'" class="chip critical">{{ saveMessage }}</div>
        <div v-if="actionStatus === 'done'" class="chip good">{{ actionMessage }}</div>
        <div v-if="actionStatus === 'error'" class="chip warning">{{ actionMessage }}</div>

        <div class="pl-table-card">
          <div class="section-head table-head">
            <div class="section-label">{{ viewingYearTotal ? 'Year Total (read-only)' : 'Edit Revenue' }}</div>
            <button
              type="button" class="filter-tab" :class="{ active: hideZeroRows }"
              @click="hideZeroRows = !hideZeroRows"
            >{{ hideZeroRows ? 'Show' : 'Hide' }} $0 rows</button>
          </div>
          <div v-if="!viewingYearTotal && selectedMonthIsCurrent" class="quiet-note projected-note">
            Projected for Event Sales, Catering, Retail, and Other Service Income uses that account's own budget (floored at actual-to-date) instead of a straight-line extrapolation — those land in large, sporadic amounts rather than a steady daily trickle.
          </div>
          <div class="month-tabs">
            <button
              v-for="month in targetMonths" :key="month"
              type="button"
              :class="['month-tab', (editMonth === month && !viewingYearTotal) && 'active', !monthHasBudget(month) && 'unbudgeted']"
              @click="selectMonth(month)"
            >{{ MONTH_NAMES[month - 1] }}</button>
            <button
              type="button"
              :class="['month-tab', 'annual-total-tab', viewingYearTotal && 'active']"
              @click="selectYearTotal"
            >Total</button>
          </div>
          <table class="pl-table edit-table">
            <thead v-if="viewingYearTotal">
              <tr class="col-head-row">
                <th scope="col"></th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <thead v-else-if="selectedMonthIsCurrent">
              <tr class="col-head-row">
                <th scope="col"></th>
                <th scope="col">Actual (to date)</th>
                <th scope="col">Budget</th>
                <th scope="col">Projected</th>
              </tr>
            </thead>
            <thead v-else>
              <tr class="col-head-row">
                <th scope="col"></th>
                <th scope="col">Budget</th>
              </tr>
            </thead>
            <!-- Year Total: a single read-only column combining real YTD actuals, the
                 current month's actual-to-date extrapolated to a full month, and every
                 future month's own budget — see yearAccountTotal/yearComputedAccountAmount
                 above. Never editable — there's no single month here to save an edit into. -->
            <tbody v-if="viewingYearTotal">
              <tr v-if="!yearActualsLoaded">
                <td colspan="2" class="loading-cell">Loading year totals…</td>
              </tr>
              <template v-else>
                <tr v-for="acc in sortedYearRevenueAccounts" :key="acc.accountId" class="account-row" :class="{ 'group-header': !isLeafAccount(acc) }">
                  <th scope="row" :style="{ paddingLeft: (16 + accountDepth(acc) * 16) + 'px' }">
                    <span class="account-label">{{ acc.accountNumber ? `${acc.accountNumber} ` : '' }}{{ acc.name }}</span>
                  </th>
                  <td><span class="amount-cell"><span class="amount-input readonly">${{ Math.round(yearComputedAccountAmount(acc)).toLocaleString() }}</span></span></td>
                </tr>
                <tr class="net-income-row">
                  <th scope="row">Total Revenue</th>
                  <td><span class="amount-cell"><span class="amount-input readonly"><strong>${{ Math.round(yearTotalRevenue).toLocaleString() }}</strong></span></span></td>
                </tr>
              </template>
            </tbody>
            <tbody v-else>
              <tr v-for="acc in sortedRevenueAccounts" :key="acc.accountId" class="account-row" :class="{ 'group-header': !isLeafAccount(acc) }">
                <th scope="row" :style="{ paddingLeft: (16 + accountDepth(acc) * 16) + 'px' }">
                  <span class="account-label">{{ acc.accountNumber ? `${acc.accountNumber} ` : '' }}{{ acc.name }}</span>
                </th>
                <td v-if="selectedMonthIsCurrent">
                  <span class="amount-cell">
                    <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                    <span v-else class="amount-input readonly">${{ Math.round(computedAccountActual(acc)).toLocaleString() }}</span>
                  </span>
                </td>
                <td>
                  <span class="amount-cell">
                    <input
                      v-if="isLeafAccount(acc)" type="text" inputmode="numeric" class="amount-input"
                      v-model="editableAccountAmounts[acc.accountId]" @blur="onAmountBlur(acc.accountId)" placeholder="0"
                    />
                    <span v-else class="amount-input readonly">${{ Math.round(computedAccountAmount(acc)).toLocaleString() }}</span>
                  </span>
                </td>
                <td v-if="selectedMonthIsCurrent">
                  <span class="amount-cell">
                    <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                    <span v-else :class="['amount-input', 'readonly', 'variance-text', varianceClass(accountProjectedVarianceById.get(acc.accountId))]">
                      <span class="variance-main">${{ Math.round(computedAccountProjected(acc)).toLocaleString() }}</span>
                      <span v-if="varianceDeltaLabel(accountProjectedVarianceById.get(acc.accountId))" class="variance-delta">
                        <span v-if="varianceIcon(accountProjectedVarianceById.get(acc.accountId))" class="variance-icon">{{ varianceIcon(accountProjectedVarianceById.get(acc.accountId)) }}</span>
                        {{ varianceDeltaLabel(accountProjectedVarianceById.get(acc.accountId)) }}
                      </span>
                      <span v-if="accountProjectedVarianceById.get(acc.accountId)?.kind === 'no-budget'" class="chip warning">No budget</span>
                    </span>
                  </span>
                </td>
              </tr>
              <tr class="net-income-row">
                <th scope="row">Total Revenue</th>
                <td v-if="selectedMonthIsCurrent">
                  <span class="amount-cell">
                    <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                    <span v-else class="amount-input readonly"><strong>${{ Math.round(totalRevenueActual).toLocaleString() }}</strong></span>
                  </span>
                </td>
                <td><span class="amount-cell"><span class="amount-input readonly"><strong>${{ Math.round(totalRevenueBudget).toLocaleString() }}</strong></span></span></td>
                <td v-if="selectedMonthIsCurrent">
                  <span class="amount-cell">
                  <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                  <span v-else :class="['amount-input', 'readonly', 'variance-text', varianceClass(totalRevenueProjectedVariance)]">
                    <strong class="variance-main">${{ Math.round(totalRevenueProjected).toLocaleString() }}</strong>
                    <span v-if="varianceDeltaLabel(totalRevenueProjectedVariance)" class="variance-delta">
                      <span v-if="varianceIcon(totalRevenueProjectedVariance)" class="variance-icon">{{ varianceIcon(totalRevenueProjectedVariance) }}</span>
                      {{ varianceDeltaLabel(totalRevenueProjectedVariance) }}
                    </span>
                  </span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!viewingYearTotal" class="action-row">
          <button
            class="action-btn" :disabled="actionStatus === 'running' || !previousMonthLabel"
            :title="previousMonthLabel ? `Fills in only accounts with no budget yet, from ${previousMonthLabel}'s actuals if synced (otherwise its budget), rounded to the nearest $10` : 'No prior month available'"
            @click="fillMissingFromLastMonth"
          >Fill in missing accounts from {{ previousMonthLabel || '—' }}</button>
          <span v-if="hasUnsavedChanges" class="chip warning">Unsaved changes</span>
          <button class="action-btn primary" :disabled="saveStatus === 'saving'" @click="saveRevenue">Save revenue</button>
        </div>
        <div v-if="saveStatus === 'saved'" class="chip good">Saved</div>
        <div v-if="saveStatus === 'nochange'" class="chip neutral">Nothing to save — already up to date</div>
        <div v-if="saveStatus === 'error'" class="chip critical">{{ saveMessage }}</div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.drill-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.quiet-note.small { font-size: 11px; color: var(--ink-3); }

.capacity-panel .section-note {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px; text-align: left; font-size: 12.5px; color: var(--ink-2);
}

/* ---------- row filter toggles ---------- */
.pl-table-card .table-head { padding: 12px 14px 8px; display: flex; align-items: center; justify-content: space-between; }
.projected-note { padding: 0 14px 8px; }
.section-label { font-size: 12px; font-weight: 700; color: var(--ink-2); }
.filter-tab {
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  padding: 4px 11px;
  border-radius: 100px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink-3);
  cursor: pointer;
}
.filter-tab.active { background: var(--accent-wash); color: var(--accent); border-color: transparent; }

/* ---------- live pace preview ---------- */
.live-pace-card {
  background: var(--accent-wash);
  border-radius: 16px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.live-pace-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 12px; }
.chip.accent { background: var(--surface); color: var(--accent); }
.chip.neutral { color: var(--ink-2); background: var(--surface-alt); }
.live-pace-grid { display: flex; flex-wrap: wrap; gap: 10px 22px; }
.live-pace-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; }

.legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }

/* ---------- edit table ---------- */
.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
  margin-bottom: 16px;
}
.month-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 8px 0;
  border-bottom: 1px solid var(--hair);
}
.month-tab {
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  padding: 7px 20px;
  border: 1px solid var(--hair);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: var(--surface-alt);
  color: var(--ink-2);
  cursor: pointer;
  position: relative;
  top: 1px;
}
.month-tab.unbudgeted { color: var(--ink-2); opacity: 0.55; }
.month-tab.annual-total-tab { margin-left: 8px; }
.month-tab.active {
  background: var(--surface);
  color: var(--ink);
  border-color: var(--hair);
  border-bottom: 1px solid var(--surface);
  opacity: 1;
}
.loading-cell { text-align: left; color: var(--ink-3); font-size: 12.5px; padding: 16px; }
table.edit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.edit-table th, .edit-table td { padding: 10px 16px; text-align: right; }
.edit-table th:first-child, .edit-table td:first-child { text-align: left; }
.edit-table tbody tr { border-bottom: 1px solid var(--hair); }
.edit-table tbody tr:last-child { border-bottom: none; }
.edit-table tr.account-row { background: var(--surface-alt); }
.edit-table tr.account-row th { font-weight: 500; }
.account-label { font-size: 12.5px; color: var(--ink-2); }
.edit-table tr.account-row.group-header .account-label { font-weight: 700; color: var(--ink); }
.edit-table tr.account-row.group-header .amount-input.readonly { color: var(--ink); }
/* A future month's table has only one data column ("Budget"), which under
   table auto-layout renders far wider than the 120px amount-input box — and
   the plain `<input>` didn't reliably honor the parent td's text-align:right
   at that width the way a `.readonly` span did (visible as editable inputs
   sitting flush left of a wide empty column while the read-only parent
   totals sat flush right — reported directly from a screenshot). Wrapping
   each cell's content in its own flex container that fills the td and
   justifies to the end fixes this regardless of the input-vs-span quirk —
   same fix pattern as the Edit Capacity page's two adjacent money-cell
   columns (see CLAUDE.md), applied to a *span* wrapper rather than the
   `<td>` itself so multiple adjacent amount columns (Budget/Actual/
   Projected) never fold into one anonymous cell the way two adjacent
   flex-`<td>`s did there. */
.amount-cell { display: flex; justify-content: flex-end; }
.amount-input {
  width: 120px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  text-align: right;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink);
}
.amount-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.amount-input.readonly {
  display: inline-block;
  border-color: transparent;
  background: transparent;
  color: var(--ink-2);
  font-weight: 700;
}
.amount-input.readonly.muted { color: var(--ink-3); font-weight: 500; }

.amount-input.readonly.variance-text.v-good { color: var(--good); }
.amount-input.readonly.variance-text.v-warning { color: var(--warning); }
.amount-input.readonly.variance-text.v-serious { color: var(--serious); }
.amount-input.readonly.variance-text.v-critical { color: var(--critical); }
.amount-input.readonly.variance-text {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  width: auto;
}
.variance-main { white-space: nowrap; }
.variance-icon { display: inline-block; }
.variance-delta { display: block; font-weight: 500; opacity: 0.8; white-space: nowrap; }

.col-head-row th {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
  padding: 8px 16px 6px;
  border-bottom: 1px solid var(--hair);
}

.edit-table tr.net-income-row th, .edit-table tr.net-income-row td {
  border-top: 2px solid var(--ink);
  padding-top: 12px;
  padding-bottom: 12px;
}
.edit-table tr.net-income-row th { font-weight: 700; color: var(--ink); }
.edit-table tr.net-income-row .amount-input.readonly { font-weight: 700; }

.buyout-rates-row { align-items: center; margin-bottom: 4px; }
.rate-input {
  width: 70px;
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink);
}
.buyout-weekday-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin: 4px 0 10px;
}
.buyout-weekday-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 6px;
  border-radius: 10px;
  background: var(--surface-alt);
}
.buyout-weekday-label { font-size: 12px; font-weight: 700; color: var(--ink); }
.buyout-weekday-target { font-size: 10.5px; color: var(--ink-3); text-align: center; }
.buyout-count-input {
  width: 56px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink);
}
.buyout-count-input:disabled { opacity: 0.5; }

@media (max-width: 760px) {
  .buyout-weekday-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

.mini-btn {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--accent);
  cursor: pointer;
}
.mini-btn:disabled { opacity: 0.5; cursor: default; }

.action-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 4px; margin-bottom: 10px; }
.action-btn {
  font-size: 12.5px;
  font-weight: 700;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.action-btn.primary { background: var(--accent); color: white; border-color: transparent; }
.action-btn:disabled { opacity: 0.5; cursor: default; }

@media (max-width: 760px) {
  .month-tabs { overflow-x: auto; }
  .month-tab { padding: 7px 11px; }
}
</style>
