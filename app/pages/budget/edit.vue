<script setup lang="ts">
import site from '~/config/site.json'
import { CATEGORIES, CATEGORY_DIRECTION, CATEGORY_LABEL, MONTH_NAMES, YEAR, type BudgetAccount, type Category, type MonthData, currentAsOfDay, currentAsOfMonth, daysInMonth, hybridYearExpectedToDate, hybridYearTotals, isMonthClosed, isMonthCurrent, monthCategoryBudget, monthsElapsedInYear, netIncome, paceStatus, useActualsYear, useBudgetYear } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Edit Budget` })

const { monthlyData, loadError, loadYear } = useBudgetYear()
const { monthlyActuals, loadActualsYear } = useActualsYear()

// Real "as of" month/day the Live Preview card paces against — see
// currentAsOfMonth/currentAsOfDay in useBudgetData.ts for why this must be
// the real date, not a frozen narration date.
const asOfMonth = currentAsOfMonth()
const asOfDay = currentAsOfDay()
const asOfLabel = `${MONTH_NAMES[asOfMonth - 1]} ${asOfDay}`

function monthHasBudget(month: number) {
  const data = monthlyData.value[month - 1]
  return !!data && data.accounts.some(a => a.amount !== null)
}

// ---- Edit Monthly Budget ------------------------------------------------
const editMonth = ref(asOfMonth)
const viewingAnnualTotal = ref(false)

// Synthesizes a MonthData-shaped object summing each account's budget
// across all 12 months, so it can stand in for a real month's data and let
// every existing piece of account-tree machinery below (directChildren,
// accountDepth, accountsForCategory, categoryComputedTotal, the $0-row
// filter...) work on the annual total for free, unchanged — none of that
// logic actually cares which month it's looking at, only at `.accounts`
// and each account's `.amount`. An account stays `amount: null` only if
// every month was null (never budgeted at all); otherwise null months
// contribute $0 to the sum, same as categoryTotals()/yearCategoryTotal()
// elsewhere already treat them.
const annualMonthData = computed<MonthData | null>(() => {
  const first = monthlyData.value.find(m => m)
  if (!first || monthlyData.value.some(m => !m)) return null
  const totals = new Map<number, number>()
  const everBudgeted = new Set<number>()
  for (const data of monthlyData.value) {
    if (!data) continue
    for (const acc of data.accounts) {
      if (acc.amount === null) continue
      everBudgeted.add(acc.accountId)
      totals.set(acc.accountId, (totals.get(acc.accountId) ?? 0) + acc.amount)
    }
  }
  return {
    year: YEAR,
    month: 0,
    accounts: first.accounts.map(acc => ({ ...acc, amount: everBudgeted.has(acc.accountId) ? (totals.get(acc.accountId) ?? 0) : null }))
  }
})

const editMonthData = computed(() => viewingAnnualTotal.value ? annualMonthData.value : monthlyData.value[editMonth.value - 1])
// A Set rather than a single Category, so expanding COGS doesn't collapse
// Revenue — each category expands/collapses independently.
const expandedCategories = ref<Set<Category>>(new Set())
function toggleCategoryExpanded(cat: Category) {
  if (expandedCategories.value.has(cat)) expandedCategories.value.delete(cat)
  else expandedCategories.value.add(cat)
}
const editableAccountAmounts = ref<Record<number, string>>({})

// Whole-dollar, comma-formatted display — native <input type="number">
// can't render thousands separators at all (not a styling limit, the HTML
// spec only allows plain digits/decimal/minus in a number input's value),
// so these are text inputs with their own parse/format handling instead.
function parseEditableAmount(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
function formatWholeDollars(n: number): string {
  return Math.round(n).toLocaleString()
}

watch(editMonthData, (data) => {
  if (!data) return
  editableAccountAmounts.value = {}
  for (const acc of data.accounts) {
    // Rounded to the nearest whole dollar for display only — cents aren't
    // meaningful for a budget entered this way, but this must NOT snap to
    // the nearest $10 the way an actual edit does (see onAmountBlur below):
    // doing that here would make saveBudgets() see every untouched account
    // as "changed" the moment the page loads, silently rounding the whole
    // month on the next Save click.
    if (acc.amount !== null) editableAccountAmounts.value[acc.accountId] = formatWholeDollars(acc.amount)
  }
}, { immediate: true })

// Snaps to the nearest $10 once you finish editing a field (not while
// still typing, so digits don't jump around under your cursor) — the
// user's explicit ask, on top of the whole-dollar display above. Leaves an
// intentionally-cleared field empty rather than forcing it to "0".
function onAmountBlur(accountId: number) {
  const raw = editableAccountAmounts.value[accountId]
  if (raw === undefined || raw.trim() === '') {
    editableAccountAmounts.value[accountId] = ''
    return
  }
  editableAccountAmounts.value[accountId] = formatWholeDollars(Math.round(parseEditableAmount(raw) / 10) * 10)
}

// Real per-account actuals for whichever month is selected, fetched lazily
// (not eagerly for all 12 months like budget_targets above) — only a closed
// or current month ever renders this, so there's nothing to fetch for the
// common case of browsing a future month. For the current (in-progress)
// month this comes back as a partial, to-date total — actuals-by-account's
// own date range is just "the whole month," but daily_line_items itself
// only ever has rows through whatever the sync has actually reached, so no
// separate "to-date" query is needed; the same fetch naturally returns
// less for a month that isn't over yet. Empty accounts list means the
// month hasn't synced yet, not that everything was $0 — see
// actuals-by-account.get.ts.
const selectedMonthAccountActuals = ref<Record<number, number>>({})
const selectedMonthHasActuals = ref(false)
watch(editMonth, async (month) => {
  if (!isMonthClosed(YEAR, month) && !isMonthCurrent(YEAR, month)) {
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

// Chart-of-accounts order: account numbers are assigned so that sorting
// numerically already puts every account directly after its parent and
// before its siblings' children (verified against the real xlsx import —
// see CLAUDE.md's Budget tab section), so no separate tree-building pass
// is needed to get the QBO ordering shown in its own budget UI/export.
// Accounts without a number (QBO system accounts like "Uncategorized
// Income") sort to the end.
function accountsForCategory(cat: Category) {
  const all = (editMonthData.value?.accounts || []).filter(a => a.category === cat)
  // The $0-row filter (leafVisible/accountVisible above) is meant to
  // declutter, not to hide an entire category — but a category whose
  // previous month has no stored amounts anywhere (e.g. Labor/Opex/Other
  // budgets got cleared or never entered) can filter every single one of
  // its accounts out, leaving the expanded category looking empty/broken
  // instead of showing an editable tree. Same escape hatch as the
  // whole-month one at previousMonthAccountsById.value.size === 0 above,
  // just scoped to "would this category end up with nothing," not "is the
  // whole previous month missing."
  const visible = all.filter(accountVisible)
  return (visible.length > 0 ? visible : all).sort((a, b) => {
    const an = a.accountNumber !== null ? Number(a.accountNumber) : Infinity
    const bn = b.accountNumber !== null ? Number(b.accountNumber) : Infinity
    return an !== bn ? an - bn : a.name.localeCompare(b.name)
  })
}

const editMonthAccountsById = computed(() => {
  const map = new Map<number, BudgetAccount>()
  for (const acc of editMonthData.value?.accounts || []) map.set(acc.accountId, acc)
  return map
})

// Indentation depth for the hierarchical display below — walks the
// parent_account_id chain (same data QBO's own budget UI uses to render
// its indented tree) rather than any depth stored on the account itself.
function accountDepth(acc: BudgetAccount): number {
  let depth = 0
  let current: BudgetAccount | undefined = acc
  const seen = new Set<number>()
  while (current?.parentAccountId != null && !seen.has(current.parentAccountId)) {
    seen.add(current.parentAccountId)
    current = editMonthAccountsById.value.get(current.parentAccountId)
    if (!current) break
    depth++
  }
  return depth
}

// Only leaf accounts (no children) are directly editable. Every account
// that has children — including the category row itself, treated as the
// implicit parent of that category's root accounts — is read-only and
// always shows the sum of its *direct* children, recursively: a mid-tree
// subtotal is itself just its own children's sum, so the number at any
// level is never independently entered or capable of disagreeing with
// what's below it (matching how QBO's own budget UI displays it — see
// CLAUDE.md's Budget tab section).
function directChildren(accountId: number): BudgetAccount[] {
  return (editMonthData.value?.accounts || []).filter(a => a.parentAccountId === accountId)
}

function isLeafAccount(acc: BudgetAccount): boolean {
  return directChildren(acc.accountId).length === 0
}

function computedAccountAmount(acc: BudgetAccount): number {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return parseEditableAmount(editableAccountAmounts.value[acc.accountId])
  return children.reduce((sum, c) => sum + computedAccountAmount(c), 0)
}

function categoryComputedTotal(cat: Category): number {
  const roots = (editMonthData.value?.accounts || []).filter(a => a.category === cat && a.parentAccountId === null)
  return roots.reduce((sum, a) => sum + computedAccountAmount(a), 0)
}

// Actual-side mirror of computedAccountAmount/categoryComputedTotal above —
// same recursive parent-sums-its-children shape, but reading from
// selectedMonthAccountActuals (real daily_line_items) instead of the
// editable budget draft. A leaf account absent from that map is a real $0,
// not unknown — selectedMonthHasActuals is what distinguishes "this month
// hasn't synced" from "this account had no activity."
function computedAccountActual(acc: BudgetAccount): number {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return selectedMonthAccountActuals.value[acc.accountId] || 0
  return children.reduce((sum, c) => sum + computedAccountActual(c), 0)
}

function categoryActualTotal(cat: Category): number {
  const roots = (editMonthData.value?.accounts || []).filter(a => a.category === cat && a.parentAccountId === null)
  return roots.reduce((sum, a) => sum + computedAccountActual(a), 0)
}

// Straight-line projection of the current month's final total: actual so
// far, scaled up by how much of the month (by Tue-Sun operating days, see
// monthExpectedFraction below) has elapsed. A simple scalar multiply, so
// projecting a parent's already-summed actual gives the same result as
// summing each child's own projection — no separate recursive walk needed.
function projectFromActual(actual: number): number {
  if (monthExpectedFraction.value <= 0) return actual
  return actual / monthExpectedFraction.value
}
function categoryProjectedTotal(cat: Category): number {
  return projectFromActual(categoryActualTotal(cat))
}
function computedAccountProjected(acc: BudgetAccount): number {
  return projectFromActual(computedAccountActual(acc))
}

// Shared budget-vs-actual comparison used by both the per-line-item table
// and the summary card below, for any category (leaf account rows reuse
// their own account's category for the good/bad direction). Every category
// has a real declared direction now (see CATEGORY_DIRECTION) — other_income/
// other_expense (split from a single, directionless 'other' 2026-07-29) get
// a real good/bad judgment like everything else instead of a neutral
// carve-out.
//
// `reference` defaults to `budget` (so referencePct is always 100%) — used
// as-is for a closed month's real final actual, and for the current
// month's *projected* total (see categoryProjectedTotal/
// computedAccountProjected above), which stands in for "the final number"
// the same way a closed month's actual does.
function budgetActualVariance(category: Category, budget: number, actual: number, reference: number = budget) {
  if (!budget) return { kind: 'no-budget' as const, budget, actual }
  const actualPct = (actual / budget) * 100
  const referencePct = (reference / budget) * 100
  const status = paceStatus(actualPct, referencePct, CATEGORY_DIRECTION[category])
  return { kind: 'value' as const, budget, actual, delta: actual - reference, status }
}

// Renders variance as a colored dollar-figure directly on the Actual/
// Projected number itself (e.g. "$52,976" / "▲ (+$12,596)") rather than a
// separate Variance column — per the design rule that status color must
// always pair with an icon, never stand alone (see the P&L page's ✓/▲
// treatment). The icon sits next to the delta, not the absolute total —
// putting it on the total read as "▼ $184,210" meaning "down to $184,210,"
// when the icon is actually describing the delta below it, not the total
// itself. Delta stays a dollar figure, not a percentage: a $24 miss on a
// $100 budget line is a huge percentage but immaterial, while dollar deltas
// make materiality visible at a glance regardless of the line's size.
type Variance = ReturnType<typeof budgetActualVariance> | { kind: 'no-actuals' }
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

// Tue-Sun operating-day fraction of the current month elapsed so far. A
// plain calendar-day fraction (e.g. "16 of 31 days") overstates how far
// through the month a restaurant's business actually is, since Urban
// Hearth is closed Mondays (confirmed by the user, not assumed) — every
// closed day counts toward elapsed calendar time but contributes zero
// expected revenue or spend. Counts operating days only, for both the
// numerator (today inclusive) and the denominator (the whole month).
// Approximates "hours" as equal-weighted operating days rather than actual
// per-day hours, since this app has no real operating-hours data to weight
// by — worth revisiting if that ever becomes available.
function isOperatingDay(date: Date): boolean {
  return date.getDay() !== 1 // Date#getDay(): 0=Sun...6=Sat, 1=Mon is the closed day
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

// ---- Row filter: hide $0 rows ---------------------------------------------
// A single adaptive toggle rather than two independent ones (simplified
// 2026-07-28 — two side-by-side toggles read as confusing about which one
// to use when). What "$0" means depends on the month being viewed, since a
// fresh unbudgeted month's own values are all null and filtering by them
// would hide nearly everything:
//   - closed month: filters by that month's own stored budget amount — the
//     month is final, so its own $0 rows meaningfully mean "not used."
//   - future month: filters by the *previous* month's amount instead,
//     since the future month has nothing of its own yet; the previous
//     month is the best available signal of which accounts typically get
//     budgeted.
//   - current (in-progress) month: treated like a future month (filter by
//     previous month) for its first two weeks, since its own budget may
//     still be mid-setup and an entered $0 isn't yet a reliable signal;
//     after that it's treated like a closed month (filter by its own
//     value). "Two weeks" is real calendar days elapsed, not synced
//     actuals — simpler, and sync lag is normally hours, not days.
// Pure declutter — never affects what's summed into a total
// (categoryComputedTotal/computedAccountAmount always include every
// account regardless of visibility) or what's saved. Compares against
// *stored* amounts, not live unsaved edits, so a row never vanishes
// mid-edit just because you cleared it to retype a number.
const hideZeroRows = ref(true)
const filterMode = computed<'own' | 'previous'>(() => {
  // The annual total has no "previous" period to fall back to — it's
  // always judged against its own value, exactly like a closed month.
  if (viewingAnnualTotal.value) return 'own'
  if (selectedMonthClosed.value) return 'own'
  if (selectedMonthIsCurrent.value) return new Date().getDate() >= 14 ? 'own' : 'previous'
  return 'previous'
})
const previousMonthLabel = computed(() => editMonth.value > 1 ? MONTH_NAMES[editMonth.value - 2] : null)
const previousMonthAccountsById = computed(() => {
  const map = new Map<number, BudgetAccount>()
  const prevData = editMonth.value > 1 ? monthlyData.value[editMonth.value - 2] : null
  if (!prevData) return map
  for (const acc of prevData.accounts) map.set(acc.accountId, acc)
  return map
})

function hasNoStoredAmount(amount: number | null): boolean {
  return amount === null || amount === 0
}

function leafVisible(acc: BudgetAccount): boolean {
  if (!hideZeroRows.value) return true
  if (filterMode.value === 'previous') {
    if (previousMonthAccountsById.value.size === 0) return true
    return !hasNoStoredAmount(previousMonthAccountsById.value.get(acc.accountId)?.amount ?? null)
  }
  return !hasNoStoredAmount(acc.amount)
}

// A parent account stays visible as long as at least one descendant leaf
// is still visible — otherwise its own bold subtotal would be showing a
// tree with nothing left under it.
function accountVisible(acc: BudgetAccount): boolean {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return leafVisible(acc)
  return children.some(accountVisible)
}

// ---- Live pace preview ---------------------------------------------------
// The Budget Pace tab's Month/Year toggle only ever answers "how's *now*
// pacing" — there's no actuals to pace a future month against, so a full
// live sync between this page and that one would mostly show meaningless
// numbers. But when you're editing the current as-of month specifically,
// showing the effect of an in-progress (unsaved) edit is genuinely useful,
// so this recomputes a compact version of that page's pace cards straight
// from the draft values above, gated to only the one month where it means
// anything.
const showLivePace = computed(() => !viewingAnnualTotal.value && editMonth.value === asOfMonth)
const livePaceExpectedPct = computed(() => (asOfDay / daysInMonth(YEAR, asOfMonth)) * 100)
// Real actual-to-date from daily_line_items (selectedMonthAccountActuals),
// matching the per-line-item table below and the Year live preview card,
// both wired off real data too. noActuals mirrors
// monthActualVsBudgetCards' own selectedMonthHasActuals gate below, so a
// not-yet-synced month reads as "no data" rather than a misleading $0.
const livePaceCards = computed(() => (['revenue', 'cogs', 'labor', 'opex'] as const).map(cat => {
  const budget = categoryComputedTotal(cat)
  if (!selectedMonthHasActuals.value) return { category: cat, label: CATEGORY_LABEL[cat], noActuals: true as const, noBudget: false as const, actual: 0, budget }
  const actual = categoryActualTotal(cat)
  if (!budget) return { category: cat, label: CATEGORY_LABEL[cat], noActuals: false as const, noBudget: true as const, actual, budget }
  const actualPct = (actual / budget) * 100
  const status = paceStatus(actualPct, livePaceExpectedPct.value, CATEGORY_DIRECTION[cat])
  return { category: cat, label: CATEGORY_LABEL[cat], noActuals: false as const, noBudget: false as const, actual, budget, actualPct, status }
}))
const liveDraftNetIncome = computed(() => netIncome({
  revenue: categoryComputedTotal('revenue'),
  cogs: categoryComputedTotal('cogs'),
  labor: categoryComputedTotal('labor'),
  opex: categoryComputedTotal('opex'),
  other_income: categoryComputedTotal('other_income'),
  other_expense: categoryComputedTotal('other_expense')
}))

// ---- Actual vs Budget (closed months) -------------------------------------
// The Month live-pace preview above only ever applies to the current
// in-progress month — a closed month has no "pace" left to track, just a
// final result. For those, show what actually happened (real
// daily_line_items) against the budget shown below — both category-level,
// in a summary card, and per line item, in the table itself (see the
// accountVarianceById/categoryVarianceByCat maps below). Answers the
// question of whether a past month should show its budget or its actuals:
// both, plus the delta, at every level of the tree. Both sides are
// read-only for a closed month — there's nothing left to plan for a month
// that's already over.
// All four of these read editMonth.value directly, so they'd otherwise
// stay stubbornly true/false based on whatever month was selected *before*
// switching to the Annual Total tab (e.g. "Jun" left selected underneath),
// wrongly labeling the annual aggregate as that specific month's card.
// viewingAnnualTotal always wins.
const selectedMonthClosed = computed(() => !viewingAnnualTotal.value && isMonthClosed(YEAR, editMonth.value))
const selectedMonthIsCurrent = computed(() => !viewingAnnualTotal.value && isMonthCurrent(YEAR, editMonth.value))

const monthActualVsBudgetCards = computed(() => {
  if (!selectedMonthClosed.value) return null
  return (['revenue', 'cogs', 'labor', 'opex'] as const).map(cat => {
    const budget = categoryComputedTotal(cat)
    if (!selectedMonthHasActuals.value) return { category: cat, label: CATEGORY_LABEL[cat], noActuals: true as const, noBudget: false as const, budget }
    const actual = categoryActualTotal(cat)
    if (!budget) return { category: cat, label: CATEGORY_LABEL[cat], noActuals: false as const, noBudget: true as const, actual, budget }
    const actualPct = (actual / budget) * 100
    const status = paceStatus(actualPct, 100, CATEGORY_DIRECTION[cat])
    return { category: cat, label: CATEGORY_LABEL[cat], noActuals: false as const, noBudget: false as const, actual, budget, delta: actual - budget, status }
  })
})
const monthActualNetIncome = computed(() => {
  if (!selectedMonthClosed.value || !selectedMonthHasActuals.value) return null
  return netIncome({
    revenue: categoryActualTotal('revenue'),
    cogs: categoryActualTotal('cogs'),
    labor: categoryActualTotal('labor'),
    opex: categoryActualTotal('opex'),
    other_income: categoryActualTotal('other_income'),
    other_expense: categoryActualTotal('other_expense')
  })
})

// ---- Net Income row (bottom of the table, every scope) --------------------
// A derived rollup, not its own account/category, so it's computed here
// rather than folded into CATEGORIES — always Budgeted, plus Actual (or,
// for the in-progress current month, Actual-to-date and Projected) wherever
// actuals exist. Never shown for a future month's actual side, since
// there's nothing to sync yet — the template gates that off
// selectedMonthHasActuals/selectedMonthIsCurrent, same as every other
// actual-side figure on this page.
const currentMonthActualNetIncome = computed(() => {
  if (!selectedMonthIsCurrent.value || !selectedMonthHasActuals.value) return null
  return netIncome({
    revenue: categoryActualTotal('revenue'),
    cogs: categoryActualTotal('cogs'),
    labor: categoryActualTotal('labor'),
    opex: categoryActualTotal('opex'),
    other_income: categoryActualTotal('other_income'),
    other_expense: categoryActualTotal('other_expense')
  })
})
const currentMonthProjectedNetIncome = computed(() => {
  if (!selectedMonthIsCurrent.value || !selectedMonthHasActuals.value) return null
  return netIncome({
    revenue: categoryProjectedTotal('revenue'),
    cogs: categoryProjectedTotal('cogs'),
    labor: categoryProjectedTotal('labor'),
    opex: categoryProjectedTotal('opex'),
    other_income: categoryProjectedTotal('other_income'),
    other_expense: categoryProjectedTotal('other_expense')
  })
})
// Actual side of the Annual Total tab's net income row — mirrors
// yearLiveNetIncome's budgeted counterpart, but built from
// realYearCategoryTotal (real daily_line_items summed through the last
// elapsed month) rather than yearCategoryTotal (budget figures), and null
// until at least one month has actually synced.
const yearActualNetIncome = computed(() => {
  if (yearActualsMonthsWithData.value === 0) return null
  return netIncome({
    revenue: realYearCategoryTotal('revenue'),
    cogs: realYearCategoryTotal('cogs'),
    labor: realYearCategoryTotal('labor'),
    opex: realYearCategoryTotal('opex'),
    other_income: realYearCategoryTotal('other_income'),
    other_expense: realYearCategoryTotal('other_expense')
  })
})

function netIncomeClass(value: number | null): string {
  if (value === null) return ''
  return value >= 0 ? 'ni-good' : 'ni-critical'
}
function formatNetIncome(value: number): string {
  return `${value >= 0 ? '+' : '−'}$${Math.abs(Math.round(value)).toLocaleString()}`
}

// Per-row variance for the read-only table below — one lookup per category
// (all 6) and one per account, built once per render
// rather than recomputed per template call. 'no-actuals' short-circuits
// before touching budgetActualVariance so every row in a not-yet-synced
// closed month shows the same "no data" state instead of a misleading
// $0-actual comparison.
const categoryVarianceByCat = computed(() => {
  const map = new Map<Category, ReturnType<typeof budgetActualVariance> | { kind: 'no-actuals' }>()
  if (!selectedMonthClosed.value) return map
  for (const cat of CATEGORIES) {
    map.set(cat, selectedMonthHasActuals.value
      ? budgetActualVariance(cat, categoryComputedTotal(cat), categoryActualTotal(cat))
      : { kind: 'no-actuals' })
  }
  return map
})
const accountVarianceById = computed(() => {
  const map = new Map<number, ReturnType<typeof budgetActualVariance> | { kind: 'no-actuals' }>()
  if (!selectedMonthClosed.value) return map
  for (const acc of editMonthData.value?.accounts || []) {
    map.set(acc.accountId, selectedMonthHasActuals.value
      ? budgetActualVariance(acc.category, computedAccountAmount(acc), computedAccountActual(acc))
      : { kind: 'no-actuals' })
  }
  return map
})

// Same idea for the current (in-progress) month, but judged against the
// *projected* month-end total (see categoryProjectedTotal/
// computedAccountProjected above) rather than actual-to-date against an
// expected-to-date figure — this answers "at this pace, will we land over
// or under budget by month's end," which is what the Projected column is
// showing right next to it. reference defaults to budget (100%), same as
// the closed-month case, since projected already stands in for "the final
// number" the way a closed month's real actual does.
const categoryProjectedVarianceByCat = computed(() => {
  const map = new Map<Category, ReturnType<typeof budgetActualVariance> | { kind: 'no-actuals' }>()
  if (!selectedMonthIsCurrent.value) return map
  for (const cat of CATEGORIES) {
    const budget = categoryComputedTotal(cat)
    map.set(cat, selectedMonthHasActuals.value
      ? budgetActualVariance(cat, budget, categoryProjectedTotal(cat))
      : { kind: 'no-actuals' })
  }
  return map
})
const accountProjectedVarianceById = computed(() => {
  const map = new Map<number, ReturnType<typeof budgetActualVariance> | { kind: 'no-actuals' }>()
  if (!selectedMonthIsCurrent.value) return map
  for (const acc of editMonthData.value?.accounts || []) {
    const budget = computedAccountAmount(acc)
    map.set(acc.accountId, selectedMonthHasActuals.value
      ? budgetActualVariance(acc.category, budget, computedAccountProjected(acc))
      : { kind: 'no-actuals' })
  }
  return map
})

// ---- Live pace preview — Year ---------------------------------------------
// The month preview above only means anything for the current as-of month
// (only July has actuals to pace against). The year total, though, is a sum
// across all 12 months' budgets — so a draft edit to *any* month changes it,
// not just July. This mirrors the Budget Pace page's Year view, but swaps in
// this tab's in-progress (unsaved) draft for whichever month is currently
// open and falls back to each other month's last-saved amount for the rest.
//
// Unlike the Month preview above, the *actual* side here uses real
// daily_line_items (via useActualsYear) — this card specifically compares
// real closed-month results against the draft
// budget, and using a fake canned year figure next to real Jan-June numbers
// would be actively misleading rather than just illustrative. It'll show a
// "no actual data synced" state until a real backfill/sync populates this
// year's daily_line_items — see CLAUDE.md's QBO Account + P&L sync section.
const monthsElapsed = computed(() => monthsElapsedInYear(YEAR))
const yearActualsMonthsWithData = computed(() => monthlyActuals.value.filter(m => m.month <= monthsElapsed.value && m.hasData).length)

function realYearCategoryTotal(cat: Category): number {
  let total = 0
  for (const m of monthlyActuals.value) {
    if (m.month <= monthsElapsed.value) total += m.totals[cat] || 0
  }
  return total
}

// Budgeted total for one month/category, substituting this tab's
// in-progress (unsaved) draft for whichever month is currently open — while
// viewing the Annual Total tab, editMonthData/categoryComputedTotal already
// point at the annual aggregate, not a single month's draft, so
// substituting it into one month's slot here would double-count that
// month's total into the whole year; there's also no "unsaved draft" to
// fold in during annual view (nothing renders an input), so every month
// just reads its own stored value via monthCategoryBudget in that case.
function getMonthCategoryBudgetLive(month: number, cat: Category): number | null {
  if (!viewingAnnualTotal.value && month === editMonth.value) return categoryComputedTotal(cat)
  return monthCategoryBudget(monthlyData.value[month - 1], cat)
}

function yearMonthsBudgeted(cat: Category): number {
  let count = 0
  for (let m = 1; m <= 12; m++) {
    if (!viewingAnnualTotal.value && m === editMonth.value) {
      if (categoryComputedTotal(cat) !== 0) count++
      continue
    }
    const data = monthlyData.value[m - 1]
    if (data && data.accounts.some(a => a.category === cat && a.amount !== null)) count++
  }
  return count
}

// Year total is the hybrid target (budget where set, actual fallback for a
// fully-elapsed unbudgeted month) rather than a plain sum of whatever
// budget_targets rows exist — same fix, and same reasoning, as the Budget
// Pace page's yearBudget (app/pages/budget/index.vue) and the Dashboard's
// year revenue pace. Without it, this card compared a full-year actual
// (realYearCategoryTotal, all elapsed months) against a partial-year
// budget (whatever months happened to have budget_targets rows), producing
// a wildly inflated or deflated pace percentage.
const yearHybridTotals = computed(() => hybridYearTotals(getMonthCategoryBudgetLive, monthlyActuals.value, asOfMonth))
// Cumulative target-through-today, seasonality-aware (see
// hybridYearExpectedToDate) — replaces the flat currentYearDayFraction()
// this card used previously, bringing it in line with the Budget Pace
// page's own year view and the Dashboard.
const yearHybridExpectedToDate = computed(() => hybridYearExpectedToDate(getMonthCategoryBudgetLive, monthlyActuals.value, asOfMonth, asOfDay))

const yearLivePaceCards = computed(() => (['revenue', 'cogs', 'labor', 'opex'] as const).map(cat => {
  const actual = realYearCategoryTotal(cat)
  const budget = yearHybridTotals.value[cat]
  const monthsBudgeted = yearMonthsBudgeted(cat)
  if (!budget) return { category: cat, label: CATEGORY_LABEL[cat], noBudget: true as const, noActuals: false as const, actual, budget, monthsBudgeted }
  if (yearActualsMonthsWithData.value === 0) {
    return { category: cat, label: CATEGORY_LABEL[cat], noBudget: false as const, noActuals: true as const, actual, budget, monthsBudgeted }
  }
  const actualPct = (actual / budget) * 100
  const expectedPct = (yearHybridExpectedToDate.value[cat] / budget) * 100
  const status = paceStatus(actualPct, expectedPct, CATEGORY_DIRECTION[cat])
  return { category: cat, label: CATEGORY_LABEL[cat], noBudget: false as const, noActuals: false as const, actual, budget, monthsBudgeted, actualPct, status }
}))
const yearLiveNetIncome = computed(() => netIncome(yearHybridTotals.value))

// ---- COGS % of revenue (Food/Beverage trailing average) ----------------
// COGS is fundamentally a variable cost — it scales with revenue, the
// menu, and month-to-month inventory timing, unlike rent or a salary — so
// a fixed dollar guess for a future month is closer to a coin flip than a
// real budget (raised by the user, not an assumption baked in unasked).
// Instead: track Food and Beverage COGS as a % of revenue (matching
// accounts.subcategory — see schema.sql — and matching how MarginEdge
// already budgets this, per product-strategy-notes.md), based on a
// trailing average of *past* months rather than any single month, so one
// lumpy ingredient delivery doesn't single-handedly reset the target.
// Deliberately excludes 'Other' COGS (packaging, catering equipment,
// retail) — those don't scale with revenue the same way and stay
// manually edited via the category/account rows above.
//
// Each group's % is against its OWN matching revenue (Food COGS ÷ Food
// revenue, Beverage COGS ÷ Beverage revenue) — the standard restaurant
// "food cost %" / "beverage cost %" definition — not against total
// revenue (changed 2026-07-28 after the user caught the two producing
// materially different numbers; total-revenue was the original,
// non-standard version). Revenue accounts got a matching Food/Beverage
// accounts.subcategory tag for exactly this (4010 Restaurant Food; 4020
// Restaurant Beverage and its 4022/4024/4026/4028 children) — scoped to
// core restaurant sales only, mirroring the COGS side's primary 5010/5100
// grouping; catering's own Food/Beverage-ish revenue and COGS accounts are
// deliberately left untagged for now (catering COGS only tags "Food" on
// one account today, and every catering figure in this budget is $0, so
// there's nothing to lose by leaving that edge case for later).
//
// This uses real budget_targets figures for past months, not the sample
// actuals figure used elsewhere on this page — this restaurant has been
// updating its QBO "budget" with real numbers as each month closed (see
// CLAUDE.md), so those rows are the closest thing to real actuals this
// app has for a past month.
const COGS_TRAILING_WINDOW = 3

function trailingMonthsWithData(targetMonth: number, count = COGS_TRAILING_WINDOW): number[] {
  const months: number[] = []
  for (let m = targetMonth - 1; m >= 1 && months.length < count; m--) {
    const data = monthlyData.value[m - 1]
    if (data && data.accounts.some(a => a.category === 'revenue' && a.amount !== null)) months.push(m)
  }
  return months.reverse()
}

function cogsGroupPctOverMonths(monthNumbers: number[], group: 'Food' | 'Beverage'): number | null {
  let groupCogsTotal = 0
  let groupRevenueTotal = 0
  for (const m of monthNumbers) {
    const data = monthlyData.value[m - 1]
    if (!data) continue
    for (const acc of data.accounts) {
      if (acc.amount === null) continue
      if (acc.category === 'revenue' && acc.subcategory === group) groupRevenueTotal += acc.amount
      if (acc.category === 'cogs' && acc.subcategory === group) groupCogsTotal += acc.amount
    }
  }
  return groupRevenueTotal > 0 ? groupCogsTotal / groupRevenueTotal : null
}

function groupRevenueBudget(data: MonthData, group: 'Food' | 'Beverage'): number {
  return data.accounts
    .filter(a => a.category === 'revenue' && a.subcategory === group && a.amount !== null)
    .reduce((sum, a) => sum + (a.amount || 0), 0)
}

const cogsTrailingMonths = computed(() => trailingMonthsWithData(editMonth.value))
const cogsTrailingLabel = computed(() => cogsTrailingMonths.value.map(m => MONTH_NAMES[m - 1]).join('–'))
const cogsTrailingFoodPct = computed(() => cogsGroupPctOverMonths(cogsTrailingMonths.value, 'Food'))
const cogsTrailingBeveragePct = computed(() => cogsGroupPctOverMonths(cogsTrailingMonths.value, 'Beverage'))

// Current group % actually budgeted for the month being edited, so it can be
// compared against the trailing average below — this is derived from the
// already-saved budget_targets figures (same source the recompute action
// itself reads via groupRevenueBudget), not the in-progress unsaved inputs,
// so switching a leaf account's textbox doesn't flip the button's visibility
// on every keystroke.
function currentGroupPct(data: MonthData, group: 'Food' | 'Beverage'): number | null {
  const revenue = groupRevenueBudget(data, group)
  if (revenue <= 0) return null
  const cogs = data.accounts
    .filter(a => a.category === 'cogs' && a.subcategory === group && a.amount !== null)
    .reduce((sum, a) => sum + (a.amount || 0), 0)
  return cogs / revenue
}

// The button only makes sense to show when it would actually change
// something — i.e. the month's currently budgeted Food/Beverage COGS % has
// drifted from the trailing average, or there's a revenue budget but no
// COGS budget at all yet. A tenth-of-a-point difference isn't worth
// surfacing (rounding in the recompute's own per-account weighting means an
// exact match is rare), so this only flags a real divergence.
const COGS_RECOMPUTE_THRESHOLD = 0.01
function cogsComparisons() {
  const data = editMonthData.value
  if (!data || viewingAnnualTotal.value) return []
  const out: { trailingPct: number, currentPct: number | null }[] = []
  for (const group of ['Food', 'Beverage'] as const) {
    const trailingPct = group === 'Food' ? cogsTrailingFoodPct.value : cogsTrailingBeveragePct.value
    if (trailingPct === null) continue
    out.push({ trailingPct, currentPct: currentGroupPct(data, group) })
  }
  return out
}
// Whether there's even a trailing average to compare against yet (e.g. Jan
// has no prior months), separate from whether it already matches — the
// template uses this to avoid claiming a month is "already on pace" when
// there's really just nothing to compare.
const cogsHasComparableData = computed(() => cogsComparisons().length > 0)
const cogsNeedsRecompute = computed(() =>
  cogsComparisons().some(c => c.currentPct !== null && Math.abs(c.currentPct - c.trailingPct) > COGS_RECOMPUTE_THRESHOLD)
)

const cogsRecomputeStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const cogsRecomputeMessage = ref('')

async function recomputeCogsFromTrailingAverage() {
  cogsRecomputeStatus.value = 'running'
  try {
    const data = editMonthData.value
    if (!data) throw new Error('Budget data not loaded yet')
    const revenueBudget = data.accounts
      .filter(a => a.category === 'revenue' && a.amount !== null)
      .reduce((sum, a) => sum + (a.amount || 0), 0)
    if (!revenueBudget) throw new Error(`Set a Revenue budget for ${MONTH_NAMES[editMonth.value - 1]} first`)

    const months = cogsTrailingMonths.value
    if (months.length === 0) throw new Error('No prior months with revenue and COGS data to average from')

    const targets: { year: number, month: number, accountId: number, amount: number }[] = []
    const summary: string[] = []
    for (const group of ['Food', 'Beverage'] as const) {
      const pct = group === 'Food' ? cogsTrailingFoodPct.value : cogsTrailingBeveragePct.value
      if (pct === null) continue
      // Group-specific revenue budget, not the whole month's revenue — see
      // the comment above cogsGroupPctOverMonths for why.
      const groupBudget = pct * groupRevenueBudget(data, group)
      const accounts = data.accounts.filter(a => a.category === 'cogs' && a.subcategory === group)
      if (accounts.length === 0) continue
      const oldTotal = accounts.reduce((sum, a) => sum + (a.amount || 0), 0)
      for (const a of accounts) {
        const weight = oldTotal > 0 ? (a.amount || 0) / oldTotal : 1 / accounts.length
        targets.push({ year: YEAR, month: editMonth.value, accountId: a.accountId, amount: Math.round(groupBudget * weight * 100) / 100 })
      }
      summary.push(`${group} ${(pct * 100).toFixed(1)}% → $${Math.round(groupBudget).toLocaleString()}`)
    }
    if (targets.length === 0) throw new Error('No Food/Beverage COGS accounts found to recompute')

    await $fetch('/api/budget/targets', { method: 'POST', body: { targets } })
    await loadYear()
    cogsRecomputeMessage.value = `Recomputed ${MONTH_NAMES[editMonth.value - 1]} COGS from trailing average (${cogsTrailingLabel.value}): ${summary.join(', ')}.`
    cogsRecomputeStatus.value = 'done'
  } catch (err: any) {
    cogsRecomputeStatus.value = 'error'
    cogsRecomputeMessage.value = err?.data?.statusMessage || err?.message || 'Recompute failed'
  }
}

const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveMessage = ref('')

// Shared by saveBudgets and the unsaved-changes guards below — only leaf
// accounts have anything to save (every parent account's number is
// derived, see computedAccountAmount above), and comparison is at
// whole-dollar precision (not the old 0.005 cent-level epsilon) since the
// displayed value is already whole dollars — an untouched account whose
// real stored amount has cents (e.g. Jan-May's exact-cent actuals) must
// not register as "changed" just because its display dropped the cents.
function changedTargets(data: MonthData) {
  const targets: { year: number, month: number, accountId: number, amount: number }[] = []
  for (const acc of data.accounts) {
    if (!isLeafAccount(acc)) continue
    const newAmount = parseEditableAmount(editableAccountAmounts.value[acc.accountId])
    if (Math.round(newAmount) !== Math.round(acc.amount ?? 0)) {
      targets.push({ year: YEAR, month: editMonth.value, accountId: acc.accountId, amount: newAmount })
    }
  }
  return targets
}

// Drives the unsaved-changes warning below. Only editable months can have
// anything to lose — a closed month's cells are read-only and the annual
// total is a derived read-only rollup, so both are excluded rather than
// running the comparison against data that was never editable in the
// first place.
const hasUnsavedChanges = computed(() => {
  if (viewingAnnualTotal.value || selectedMonthClosed.value) return false
  const data = editMonthData.value
  if (!data) return false
  return changedTargets(data).length > 0
})

const UNSAVED_CHANGES_MESSAGE = 'You have unsaved budget edits for this month. Discard them and continue?'

// Every way of leaving the currently-edited month with unsaved changes still
// in the input boxes: switching to another month tab, jumping to the Total
// tab, closing/refreshing the browser tab, or navigating to a different page
// via the shared nav. All four confirm with the user first rather than
// silently discarding, since editableAccountAmounts (see the watch above)
// gets wiped and re-seeded from the last-saved data the moment editMonthData
// changes.
function selectMonth(month: number) {
  if (hasUnsavedChanges.value && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return
  editMonth.value = month
  viewingAnnualTotal.value = false
}
function selectAnnualTotal() {
  if (hasUnsavedChanges.value && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return
  viewingAnnualTotal.value = true
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

async function saveBudgets() {
  saveStatus.value = 'saving'
  try {
    const data = editMonthData.value
    if (!data) throw new Error('Budget data not loaded yet')
    const targets = changedTargets(data)

    if (targets.length === 0) {
      saveStatus.value = 'idle'
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

// ---- Fill missing accounts from last month --------------------------------
// Copies last month's per-account figure (actuals if that month has closed,
// otherwise its own budget — see copy-into-month.post.ts) into every account
// that has NO budget_targets row yet for the month being edited, rounded to
// the nearest $10. Accounts that already have a value — e.g. a revenue
// projection you've already typed in and saved — are left alone; this is a
// gap-filler, not a whole-month overwrite, so it can't clobber numbers
// you've deliberately set. There's no "same month last year" variant anymore
// (dropped 2026-07-29, per the user: not useful in practice) and no "update
// from its own actuals" action for the same reason as before — that would
// overwrite a month's budget with its own result, destroying the ability to
// compare "what we planned" against "what happened." Closed months show that
// comparison read-only instead.
const actionStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const actionMessage = ref('')

// Every action-result chip (Fill missing, Recompute COGS, Save) is the
// outcome of an action taken against whichever month was selected at the
// time — without this they're plain refs with no month of their own, so
// switching tabs left a stale "done"/"error" chip from the previous month
// showing under the newly-selected one (e.g. recomputing September's COGS
// and then clicking over to October would still show September's green
// confirmation banner there).
watch(editMonth, () => {
  cogsRecomputeStatus.value = 'idle'
  cogsRecomputeMessage.value = ''
  actionStatus.value = 'idle'
  actionMessage.value = ''
  saveStatus.value = 'idle'
  saveMessage.value = ''
})

function describeSource(sourceLabel: string, source: 'actuals' | 'budget', sourceClosed: boolean) {
  if (source === 'actuals') return `${sourceLabel} actuals`
  return sourceClosed ? `${sourceLabel}'s budget (no actuals synced for ${sourceLabel} yet)` : `${sourceLabel}'s budget (${sourceLabel} hasn't closed yet, so its actuals aren't a full month)`
}

async function fillMissingFromLastMonth() {
  if (!previousMonthLabel.value) return
  const sourceMonth = editMonth.value - 1
  const sourceClosed = isMonthClosed(YEAR, sourceMonth)
  actionStatus.value = 'running'
  try {
    const result = await $fetch('/api/budget/copy-into-month', {
      method: 'POST',
      body: {
        sourceYear: YEAR, sourceMonth,
        targetMonths: [{ year: YEAR, month: editMonth.value }],
        allowBudgetFallback: true, onlyMissing: true, roundTo: 10
      }
    })
    actionMessage.value = result.updated > 0
      ? `Filled in ${result.updated} account(s) with no existing budget for ${MONTH_NAMES[editMonth.value - 1]}, from ${describeSource(previousMonthLabel.value, result.source, sourceClosed)}.`
      : `Every account already has a budget for ${MONTH_NAMES[editMonth.value - 1]} — nothing to fill in.`
    actionStatus.value = 'done'
    await loadYear()
  } catch (err: any) {
    actionStatus.value = 'error'
    actionMessage.value = err?.data?.statusMessage || err?.message || 'No actuals or budget available yet'
  }
}

function exportForQuickBooks() {
  window.open(`/api/budget/export?year=${YEAR}`, '_blank')
}
</script>

<template>
  <div>
    <PageHeader
      page-name="Edit Budget"
      :description="`Edit any month's budget, update from actuals, or export for QuickBooks · ${YEAR}`"
      :as-of-label="asOfLabel"
      @synced="loadYear(); loadActualsYear()"
    />

    <div v-if="loadError" class="drill-card">
      <span class="chip critical">Couldn't load budget data</span>
      <span class="quiet-note">{{ loadError }}</span>
    </div>

    <template v-else>
      <section>
        <div v-if="showLivePace" class="live-pace-card">
          <div class="live-pace-head">
            <span class="chip accent">Live Preview</span>
            <span class="quiet-note">How {{ MONTH_NAMES[editMonth - 1] }}'s actual-to-date paces against the budget below, including any edits you haven't saved yet.</span>
          </div>
          <div class="live-pace-grid">
            <div v-for="card in livePaceCards" :key="card.category" class="live-pace-item">
              <span class="name">{{ card.label }}</span>
              <span v-if="card.noActuals" class="chip warning">No actual data synced</span>
              <span v-else-if="card.noBudget" class="chip warning">No budget</span>
              <span v-else :class="['chip', card.status]">{{ card.actualPct.toFixed(1) }}% of budget</span>
            </div>
          </div>
          <div class="live-pace-net">
            Net income (draft): <strong :class="liveDraftNetIncome >= 0 ? 'good' : 'critical'">{{ liveDraftNetIncome >= 0 ? '+' : '' }}${{ Math.round(liveDraftNetIncome).toLocaleString() }}</strong>
          </div>
        </div>

        <div v-else-if="monthActualVsBudgetCards" class="live-pace-card">
          <div class="live-pace-head">
            <span class="chip accent">Actual vs Budget — {{ MONTH_NAMES[editMonth - 1] }}</span>
            <span class="quiet-note">How {{ MONTH_NAMES[editMonth - 1] }} actually finished against the budget shown below.</span>
          </div>
          <div class="live-pace-grid">
            <div v-for="card in monthActualVsBudgetCards" :key="card.category" class="live-pace-item">
              <span class="name">{{ card.label }}</span>
              <span v-if="card.noActuals" class="chip warning">No actual data synced</span>
              <span v-else-if="card.noBudget" class="chip warning">No budget</span>
              <span v-else :class="['chip', card.status]">{{ card.status === 'good' ? '✓' : (card.delta >= 0 ? '▲' : '▼') }} {{ card.delta >= 0 ? '+' : '−' }}${{ Math.abs(Math.round(card.delta)).toLocaleString() }} vs budget</span>
            </div>
          </div>
          <div v-if="monthActualNetIncome !== null" class="live-pace-net">
            Net income (actual): <strong :class="monthActualNetIncome >= 0 ? 'good' : 'critical'">{{ monthActualNetIncome >= 0 ? '+' : '' }}${{ Math.round(monthActualNetIncome).toLocaleString() }}</strong>
            vs. budgeted <strong>${{ Math.round(liveDraftNetIncome).toLocaleString() }}</strong>
          </div>
        </div>

        <div v-if="viewingAnnualTotal" class="live-pace-card">
          <div class="live-pace-head">
            <span class="chip accent">Live Preview</span>
            <span class="quiet-note">How the full year paces against every month's last-saved budget. Actuals are real (daily_line_items), not sample data.</span>
          </div>
          <div class="live-pace-grid">
            <div v-for="card in yearLivePaceCards" :key="card.category" class="live-pace-item">
              <span class="name">{{ card.label }}</span>
              <span v-if="card.noBudget" class="chip warning">No budget</span>
              <span v-else-if="card.noActuals" class="chip warning">No actual data synced yet</span>
              <template v-else>
                <span :class="['chip', card.status]">{{ card.actualPct.toFixed(1) }}% of budget</span>
                <span v-if="card.monthsBudgeted < 12" class="mini-note">{{ card.monthsBudgeted }}/12 mo budgeted</span>
                <span v-if="yearActualsMonthsWithData < monthsElapsed" class="mini-note">{{ yearActualsMonthsWithData }}/{{ monthsElapsed }} mo of actuals synced</span>
              </template>
            </div>
          </div>
          <div class="live-pace-net">
            Net income (draft): <strong :class="yearLiveNetIncome >= 0 ? 'good' : 'critical'">{{ yearLiveNetIncome >= 0 ? '+' : '' }}${{ Math.round(yearLiveNetIncome).toLocaleString() }}</strong>
          </div>
        </div>

        <div class="legend">
          <span class="chip good">On / ahead of budget</span>
          <span class="chip warning">Watch</span>
          <span class="chip serious">Off pace</span>
          <span class="chip critical">Over / under budget</span>
        </div>

        <div class="pl-table-card">
          <div class="section-head table-head">
            <div class="section-label">Edit Monthly Budget</div>
            <button
              type="button" class="filter-tab" :class="{ active: hideZeroRows }"
              :disabled="filterMode === 'previous' && !previousMonthLabel"
              :title="filterMode === 'previous' && !previousMonthLabel ? 'No prior month to compare' : undefined"
              @click="hideZeroRows = !hideZeroRows"
            >{{ hideZeroRows ? 'Show' : 'Hide' }} {{ filterMode === 'previous' ? `rows with $0 in ${previousMonthLabel || '—'}` : '$0 rows' }}</button>
          </div>
          <div class="month-tabs">
            <button
              v-for="(name, i) in MONTH_NAMES" :key="name"
              type="button"
              :class="['month-tab', (editMonth === i + 1 && !viewingAnnualTotal) && 'active', !monthHasBudget(i + 1) && 'unbudgeted']"
              @click="selectMonth(i + 1)"
            >{{ name }}</button>
            <button
              type="button"
              :class="['month-tab', 'annual-total-tab', viewingAnnualTotal && 'active']"
              @click="selectAnnualTotal"
            >Total</button>
          </div>
          <table class="pl-table edit-table">
            <thead v-if="viewingAnnualTotal">
              <tr class="col-head-row">
                <th scope="col"></th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <thead v-else-if="selectedMonthClosed">
              <tr class="col-head-row">
                <th scope="col"></th>
                <th scope="col">Budget</th>
                <th scope="col">Actual</th>
              </tr>
            </thead>
            <thead v-else-if="selectedMonthIsCurrent">
              <tr class="col-head-row">
                <th scope="col"></th>
                <th scope="col">Budget</th>
                <th scope="col">Actual (to date)</th>
                <th scope="col">Projected</th>
              </tr>
            </thead>
            <!-- Annual total: a straight sum across all 12 months per line
                 item, read-only (there's nothing to edit or compare against
                 for an aggregate) — no Actual/Variance columns, no
                 COGS-recompute banner (that's for planning one month, not
                 reviewing a year). -->
            <tbody v-if="viewingAnnualTotal">
              <template v-for="cat in CATEGORIES" :key="cat">
                <tr>
                  <th scope="row">
                    <button class="expand-toggle" @click="toggleCategoryExpanded(cat)">
                      {{ expandedCategories.has(cat) ? '▾' : '▸' }} {{ CATEGORY_LABEL[cat] }}
                    </button>
                  </th>
                  <td><span class="amount-input readonly">${{ Math.round(categoryComputedTotal(cat)).toLocaleString() }}</span></td>
                </tr>
                <template v-if="expandedCategories.has(cat)">
                  <tr v-for="acc in accountsForCategory(cat)" :key="acc.accountId" class="account-row" :class="{ 'group-header': !isLeafAccount(acc) }">
                    <th scope="row" :style="{ paddingLeft: (28 + accountDepth(acc) * 16) + 'px' }">
                      <span class="account-label">{{ acc.accountNumber ? `${acc.accountNumber} ` : '' }}{{ acc.name }}</span>
                    </th>
                    <td><span class="amount-input readonly">${{ Math.round(computedAccountAmount(acc)).toLocaleString() }}</span></td>
                  </tr>
                </template>
              </template>
              <tr class="net-income-row">
                <th scope="row">Net Income (Budgeted)</th>
                <td><span class="amount-input readonly"><strong :class="netIncomeClass(liveDraftNetIncome)">{{ formatNetIncome(liveDraftNetIncome) }}</strong></span></td>
              </tr>
              <tr v-if="yearActualNetIncome !== null" class="net-income-row">
                <th scope="row">Net Income (Actual through {{ MONTH_NAMES[monthsElapsed - 1] }})</th>
                <td><span class="amount-input readonly"><strong :class="netIncomeClass(yearActualNetIncome)">{{ formatNetIncome(yearActualNetIncome) }}</strong></span></td>
              </tr>
            </tbody>
            <tbody v-else-if="!selectedMonthClosed">
              <template v-for="cat in CATEGORIES" :key="cat">
                <tr>
                  <th scope="row">
                    <button class="expand-toggle" @click="toggleCategoryExpanded(cat)">
                      {{ expandedCategories.has(cat) ? '▾' : '▸' }} {{ CATEGORY_LABEL[cat] }}
                    </button>
                  </th>
                  <td><span class="amount-input readonly">${{ Math.round(categoryComputedTotal(cat)).toLocaleString() }}</span></td>
                  <td v-if="selectedMonthIsCurrent">
                    <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                    <span v-else class="amount-input readonly">${{ Math.round(categoryActualTotal(cat)).toLocaleString() }}</span>
                  </td>
                  <td v-if="selectedMonthIsCurrent">
                    <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                    <span v-else :class="['amount-input', 'readonly', 'variance-text', varianceClass(categoryProjectedVarianceByCat.get(cat))]">
                      <span class="variance-main">${{ Math.round(categoryProjectedTotal(cat)).toLocaleString() }}</span>
                      <span v-if="varianceDeltaLabel(categoryProjectedVarianceByCat.get(cat))" class="variance-delta">
                        <span v-if="varianceIcon(categoryProjectedVarianceByCat.get(cat))" class="variance-icon">{{ varianceIcon(categoryProjectedVarianceByCat.get(cat)) }}</span>
                        {{ varianceDeltaLabel(categoryProjectedVarianceByCat.get(cat)) }}
                      </span>
                      <span v-if="categoryProjectedVarianceByCat.get(cat)?.kind === 'no-budget'" class="chip warning">No budget</span>
                    </span>
                  </td>
                </tr>
                <template v-if="expandedCategories.has(cat)">
                  <tr v-for="acc in accountsForCategory(cat)" :key="acc.accountId" class="account-row" :class="{ 'group-header': !isLeafAccount(acc) }">
                    <th scope="row" :style="{ paddingLeft: (28 + accountDepth(acc) * 16) + 'px' }">
                      <span class="account-label">{{ acc.accountNumber ? `${acc.accountNumber} ` : '' }}{{ acc.name }}</span>
                    </th>
                    <td>
                      <input
                        v-if="isLeafAccount(acc)" type="text" inputmode="numeric" class="amount-input"
                        v-model="editableAccountAmounts[acc.accountId]" @blur="onAmountBlur(acc.accountId)" placeholder="0"
                      />
                      <span v-else class="amount-input readonly">${{ Math.round(computedAccountAmount(acc)).toLocaleString() }}</span>
                    </td>
                    <td v-if="selectedMonthIsCurrent">
                      <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                      <span v-else class="amount-input readonly">${{ Math.round(computedAccountActual(acc)).toLocaleString() }}</span>
                    </td>
                    <td v-if="selectedMonthIsCurrent">
                      <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                      <span v-else :class="['amount-input', 'readonly', 'variance-text', varianceClass(accountProjectedVarianceById.get(acc.accountId))]">
                        <span class="variance-main">${{ Math.round(computedAccountProjected(acc)).toLocaleString() }}</span>
                        <span v-if="varianceDeltaLabel(accountProjectedVarianceById.get(acc.accountId))" class="variance-delta">
                          <span v-if="varianceIcon(accountProjectedVarianceById.get(acc.accountId))" class="variance-icon">{{ varianceIcon(accountProjectedVarianceById.get(acc.accountId)) }}</span>
                          {{ varianceDeltaLabel(accountProjectedVarianceById.get(acc.accountId)) }}
                        </span>
                        <span v-if="accountProjectedVarianceById.get(acc.accountId)?.kind === 'no-budget'" class="chip warning">No budget</span>
                      </span>
                    </td>
                  </tr>
                </template>
                <tr v-if="cat === 'cogs'" class="cogs-avg-row">
                  <td :colspan="selectedMonthIsCurrent ? 4 : 2">
                    <div class="section-note">
                      COGS is variable — it scales with revenue, not a fixed dollar guess. Trailing
                      {{ cogsTrailingMonths.length || 0 }}-mo avg<template v-if="cogsTrailingLabel"> ({{ cogsTrailingLabel }})</template>:
                      Food <strong>{{ cogsTrailingFoodPct !== null ? (cogsTrailingFoodPct * 100).toFixed(1) + '%' : 'n/a' }}</strong> of Food revenue,
                      Beverage <strong>{{ cogsTrailingBeveragePct !== null ? (cogsTrailingBeveragePct * 100).toFixed(1) + '%' : 'n/a' }}</strong> of Beverage revenue.
                      <button v-if="cogsNeedsRecompute" class="mini-btn" :disabled="cogsRecomputeStatus === 'running'" @click="recomputeCogsFromTrailingAverage">
                        Recompute {{ MONTH_NAMES[editMonth - 1] }} COGS from this average
                      </button>
                      <span v-else-if="cogsRecomputeStatus !== 'done' && cogsHasComparableData" class="chip neutral">Already tracking the trailing average</span>
                      <span v-if="cogsRecomputeStatus === 'done'" class="chip good">{{ cogsRecomputeMessage }}</span>
                      <span v-if="cogsRecomputeStatus === 'error'" class="chip warning">{{ cogsRecomputeMessage }}</span>
                    </div>
                  </td>
                </tr>
              </template>
              <tr class="net-income-row">
                <th scope="row">Net Income</th>
                <td><span class="amount-input readonly"><strong :class="netIncomeClass(liveDraftNetIncome)">{{ formatNetIncome(liveDraftNetIncome) }}</strong></span></td>
                <td v-if="selectedMonthIsCurrent">
                  <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                  <span v-else class="amount-input readonly"><strong :class="netIncomeClass(currentMonthActualNetIncome)">{{ formatNetIncome(currentMonthActualNetIncome) }}</strong></span>
                </td>
                <td v-if="selectedMonthIsCurrent">
                  <span v-if="!selectedMonthHasActuals" class="amount-input readonly muted">—</span>
                  <span v-else class="amount-input readonly"><strong :class="netIncomeClass(currentMonthProjectedNetIncome)">{{ formatNetIncome(currentMonthProjectedNetIncome) }}</strong></span>
                </td>
              </tr>
            </tbody>
            <!-- Closed month: budget and actual are both final, so this is a
                 read-only comparison, not an editor — no input boxes, and no
                 COGS-recompute banner (that tool is for planning ahead, not
                 reviewing what already happened). -->
            <tbody v-else>
              <template v-for="cat in CATEGORIES" :key="cat">
                <tr>
                  <th scope="row">
                    <button class="expand-toggle" @click="toggleCategoryExpanded(cat)">
                      {{ expandedCategories.has(cat) ? '▾' : '▸' }} {{ CATEGORY_LABEL[cat] }}
                    </button>
                  </th>
                  <td><span class="amount-input readonly">${{ Math.round(categoryComputedTotal(cat)).toLocaleString() }}</span></td>
                  <td>
                    <span v-if="categoryVarianceByCat.get(cat)?.kind === 'no-actuals'" class="amount-input readonly muted">—</span>
                    <span v-else :class="['amount-input', 'readonly', 'variance-text', varianceClass(categoryVarianceByCat.get(cat))]">
                      <span class="variance-main">${{ Math.round(categoryActualTotal(cat)).toLocaleString() }}</span>
                      <span v-if="varianceDeltaLabel(categoryVarianceByCat.get(cat))" class="variance-delta">
                        <span v-if="varianceIcon(categoryVarianceByCat.get(cat))" class="variance-icon">{{ varianceIcon(categoryVarianceByCat.get(cat)) }}</span>
                        {{ varianceDeltaLabel(categoryVarianceByCat.get(cat)) }}
                      </span>
                      <span v-if="categoryVarianceByCat.get(cat)?.kind === 'no-budget'" class="chip warning">No budget</span>
                    </span>
                  </td>
                </tr>
                <template v-if="expandedCategories.has(cat)">
                  <tr v-for="acc in accountsForCategory(cat)" :key="acc.accountId" class="account-row" :class="{ 'group-header': !isLeafAccount(acc) }">
                    <th scope="row" :style="{ paddingLeft: (28 + accountDepth(acc) * 16) + 'px' }">
                      <span class="account-label">{{ acc.accountNumber ? `${acc.accountNumber} ` : '' }}{{ acc.name }}</span>
                    </th>
                    <td><span class="amount-input readonly">${{ Math.round(computedAccountAmount(acc)).toLocaleString() }}</span></td>
                    <td>
                      <span v-if="accountVarianceById.get(acc.accountId)?.kind === 'no-actuals'" class="amount-input readonly muted">—</span>
                      <span v-else :class="['amount-input', 'readonly', 'variance-text', varianceClass(accountVarianceById.get(acc.accountId))]">
                        <span class="variance-main">${{ Math.round(computedAccountActual(acc)).toLocaleString() }}</span>
                        <span v-if="varianceDeltaLabel(accountVarianceById.get(acc.accountId))" class="variance-delta">
                          <span v-if="varianceIcon(accountVarianceById.get(acc.accountId))" class="variance-icon">{{ varianceIcon(accountVarianceById.get(acc.accountId)) }}</span>
                          {{ varianceDeltaLabel(accountVarianceById.get(acc.accountId)) }}
                        </span>
                        <span v-if="accountVarianceById.get(acc.accountId)?.kind === 'no-budget'" class="chip warning">No budget</span>
                      </span>
                    </td>
                  </tr>
                </template>
              </template>
              <tr class="net-income-row">
                <th scope="row">Net Income</th>
                <td><span class="amount-input readonly"><strong :class="netIncomeClass(liveDraftNetIncome)">{{ formatNetIncome(liveDraftNetIncome) }}</strong></span></td>
                <td>
                  <span v-if="monthActualNetIncome === null" class="amount-input readonly muted">—</span>
                  <span v-else class="amount-input readonly"><strong :class="netIncomeClass(monthActualNetIncome)">{{ formatNetIncome(monthActualNetIncome) }}</strong></span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!selectedMonthClosed && !viewingAnnualTotal" class="action-row">
          <button
            class="action-btn" :disabled="actionStatus === 'running' || !previousMonthLabel"
            :title="previousMonthLabel ? `Fills in only accounts with no budget yet, from ${previousMonthLabel}'s actuals if synced (otherwise its budget), rounded to the nearest $10` : 'No prior month in this year'"
            @click="fillMissingFromLastMonth"
          >Fill in missing accounts from {{ previousMonthLabel || '—' }}</button>
          <button class="action-btn" @click="exportForQuickBooks">Export for QuickBooks</button>
          <span v-if="hasUnsavedChanges" class="chip warning">Unsaved changes</span>
          <button class="action-btn primary" :disabled="saveStatus === 'saving'" @click="saveBudgets">Save budget</button>
        </div>
        <div v-else class="action-row">
          <button class="action-btn" @click="exportForQuickBooks">Export for QuickBooks</button>
        </div>
        <div v-if="saveStatus === 'saved'" class="chip good">Saved</div>
        <div v-if="saveStatus === 'error'" class="chip critical">{{ saveMessage }}</div>
        <div v-if="actionStatus === 'done'" class="chip good">{{ actionMessage }}</div>
        <div v-if="actionStatus === 'error'" class="chip warning">{{ actionMessage }}</div>
      </section>
    </template>

    <footer>
      <span>Actuals: real data synced from QuickBooks (daily_line_items) &middot; Budgets: real data imported from QuickBooks' budget export</span>
    </footer>
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
  gap: 14px;
}
.quiet-note { font-size: 12.5px; color: var(--ink-2); }

/* ---------- row filter toggles ---------- */
.pl-table-card .table-head { padding: 12px 14px 8px; }
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
.filter-tab:disabled { opacity: 0.4; cursor: default; }

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
.live-pace-grid { display: flex; flex-wrap: wrap; gap: 10px 22px; }
.live-pace-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; }
.live-pace-item .mini-note { font-size: 10.5px; font-weight: 500; color: var(--ink-3); }
.live-pace-net { font-size: 12.5px; color: var(--ink-2); }
.live-pace-net strong.good { color: var(--good); }
.live-pace-net strong.critical { color: var(--critical); }

/* ---------- edit table ---------- */
.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
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
.expand-toggle {
  background: none; border: none; padding: 0; font: inherit; font-weight: 600; color: var(--ink); cursor: pointer;
}
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

/* Variance is shown directly on the Actual/Projected figure (color + a ✓/▲/▼
   icon, per the "color must pair with an icon" rule, plus the dollar delta
   in parens) rather than a separate column — see varianceIcon/varianceClass/
   varianceDeltaLabel above. Specificity matches .amount-input.readonly.muted
   above so these colors actually win over the base readonly color. */
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
/* icon + amount never split across lines; the delta always drops to its own
   line below, instead of wrapping wherever happens to fit (which could
   split mid-parenthesis, e.g. "(−" / "$10,686)"). */
.variance-main { white-space: nowrap; }
.variance-icon { display: inline-block; }
.variance-delta { display: block; font-weight: 500; opacity: 0.8; white-space: nowrap; }

/* ---------- closed-month read-only Budget/Actual/Variance columns ---------- */
.col-head-row th {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
  padding: 8px 16px 6px;
  border-bottom: 1px solid var(--hair);
}
.chip.neutral { color: var(--ink-2); background: var(--surface-alt); }

.edit-table tr.cogs-avg-row td { padding: 10px 16px 14px; }
.edit-table tr.cogs-avg-row .section-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  text-align: left;
  padding-left: 0;
  margin-top: 0;
}
.edit-table tr.net-income-row th, .edit-table tr.net-income-row td {
  border-top: 2px solid var(--ink);
  padding-top: 12px;
  padding-bottom: 12px;
}
.edit-table tr.net-income-row th { font-weight: 700; color: var(--ink); }
.edit-table tr.net-income-row .amount-input.readonly { font-weight: 700; }
.ni-good { color: var(--good); }
.ni-critical { color: var(--critical); }
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

.action-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 4px; }
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
