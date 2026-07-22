<script setup lang="ts">
import site from '~/config/site.json'
useHead({ title: `${site.restaurantName} — Budget` })

// Shaped like a sync_runs row so this collapses into a real useDb() query
// later without changing the template logic — see schema.sql.
const lastSync = { status: 'success' as 'success' | 'error', finishedAt: 'today, 3:04 AM', dataThroughDate: 'Jul 16' }
const syncFailed = computed(() => lastSync.status === 'error')

type Category = 'revenue' | 'cogs' | 'labor' | 'opex' | 'other'
type BudgetAccount = {
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
type MonthData = { year: number, month: number, accounts: BudgetAccount[] }

// The sample month/day this whole app is narrated against (matches the
// Dashboard/P&L pages' "Thu, Jul 16" as-of date), and the only year this
// restaurant has any budget data for yet.
const YEAR = 2026
const AS_OF_MONTH = 7
const AS_OF_DAY = 16
const CATEGORIES: Category[] = ['revenue', 'cogs', 'labor', 'opex', 'other']
const CATEGORY_LABEL: Record<Category, string> = { revenue: 'Revenue', cogs: 'COGS', labor: 'Labor', opex: 'Opex', other: 'Other' }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

// Actuals (the "how much did we actually make/spend" side of every
// comparison) stay sample data for now — QBO sync isn't wired to the UI
// yet, same as the Dashboard and P&L pages. These are the exact same
// figures already used on those two pages, so all three tabs describe one
// consistent sample month/year rather than three disconnected samples.
// Deliberately excludes 'other' (see note on netIncome below).
const sampleActuals: Record<'month' | 'year', Record<Exclude<Category, 'other'>, number>> = {
  month: { revenue: 118400, cogs: 39200, labor: 37200, opex: 32700 },
  year: { revenue: 1612000, cogs: 480400, labor: 498100, opex: 572300 }
}

const monthlyData = ref<MonthData[]>([]) // index 0..11 for months 1..12
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

function categoryTotals(monthNumbers: number[]) {
  const totals: Record<Category, number> = { revenue: 0, cogs: 0, labor: 0, opex: 0, other: 0 }
  const monthsBudgeted: Record<Category, number> = { revenue: 0, cogs: 0, labor: 0, opex: 0, other: 0 }
  for (const m of monthNumbers) {
    const data = monthlyData.value[m - 1]
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

const monthBudget = computed(() => categoryTotals([AS_OF_MONTH]))
const yearBudget = computed(() => categoryTotals(Array.from({ length: 12 }, (_, i) => i + 1)))

// Owner-operator compensation (Executive Chef, Business Manager — see
// schema.sql) carve-out: real cash cost, so it stays in total labor $ and
// net income, but a hired-staff industry benchmark was never built
// assuming the owners are on payroll, so we show labor % both ways rather
// than picking one silently. Only the budget side of this is real — actual
// stays a single lump sample figure until per-account actuals exist
// (daily_line_items is empty until the QBO sync is wired to the UI), so
// there's no way to split actual labor by account yet.
function ownerCompensationTotal(monthNumbers: number[]) {
  let total = 0
  for (const m of monthNumbers) {
    const data = monthlyData.value[m - 1]
    if (!data) continue
    for (const acc of data.accounts) {
      if (acc.category === 'labor' && acc.isOwnerCompensation && acc.amount !== null) total += acc.amount
    }
  }
  return total
}
const monthOwnerComp = computed(() => ownerCompensationTotal([AS_OF_MONTH]))
const yearOwnerComp = computed(() => ownerCompensationTotal(Array.from({ length: 12 }, (_, i) => i + 1)))
const periodOwnerComp = computed(() => selectedPeriod.value === 'month' ? monthOwnerComp.value : yearOwnerComp.value)
const ownerCompAccountNames = computed(() => {
  const data = monthlyData.value[AS_OF_MONTH - 1]
  if (!data) return []
  return data.accounts.filter(a => a.category === 'labor' && a.isOwnerCompensation).map(a => a.name)
})
const laborExOwnerComp = computed(() => {
  const budget = periodBudget.value.totals.labor
  const ownerComp = periodOwnerComp.value
  if (!budget || ownerComp <= 0) return null
  const budgetExOwnerComp = budget - ownerComp
  const actualPctExOwnerComp = budgetExOwnerComp > 0 ? (periodActuals.value.labor / budgetExOwnerComp) * 100 : null
  return { ownerComp, budgetExOwnerComp, actualPctExOwnerComp }
})

const selectedPeriod = ref<'month' | 'year'>('month')
const periodDayFraction = computed(() => selectedPeriod.value === 'month'
  ? AS_OF_DAY / daysInMonth(YEAR, AS_OF_MONTH)
  : 197 / 365) // matches the Dashboard's "197 of 365 days elapsed" sample figure
const periodActuals = computed(() => sampleActuals[selectedPeriod.value])
const periodBudget = computed(() => selectedPeriod.value === 'month' ? monthBudget.value : yearBudget.value)

// Net income is never entered directly — no real QBO account represents it
// (see schema.sql) — so both the budgeted and actual figures are always
// derived as revenue - cogs - labor - opex, the same formula the sample
// data on the other two pages already satisfies exactly. This excludes
// 'other' (Other Income/Other Expense): those two QBO sections collapse
// into one 'other' category in this app (see CLAUDE.md/schema.sql), so
// there's no reliable sign to net it against revenue here yet.
function netIncome(actuals: Record<Exclude<Category, 'other'>, number>) {
  return actuals.revenue - actuals.cogs - actuals.labor - actuals.opex
}
const actualNetIncome = computed(() => netIncome(periodActuals.value))
const budgetNetIncome = computed(() => netIncome(periodBudget.value.totals as any))

// direction: for revenue, running ahead of budget pace is good; for the
// three cost categories, running ahead of budget pace means overspending,
// so the same ratio needs the opposite color interpretation.
type Direction = 'higher-is-better' | 'higher-is-worse'
const CATEGORY_DIRECTION: Record<Exclude<Category, 'other'>, Direction> = {
  revenue: 'higher-is-better', cogs: 'higher-is-worse', labor: 'higher-is-worse', opex: 'higher-is-worse'
}

function paceStatus(actualPct: number, expectedPct: number, direction: Direction) {
  const diff = direction === 'higher-is-better' ? expectedPct - actualPct : actualPct - expectedPct
  if (diff <= 0) return 'good'
  if (diff <= 10) return 'warning'
  if (diff <= 25) return 'serious'
  return 'critical'
}

const paceCards = computed(() => (['revenue', 'cogs', 'labor', 'opex'] as const).map(cat => {
  const actual = periodActuals.value[cat]
  const budget = periodBudget.value.totals[cat]
  const monthsBudgeted = periodBudget.value.monthsBudgeted[cat]
  const expectedPct = periodDayFraction.value * 100
  if (!budget) {
    return { category: cat, label: CATEGORY_LABEL[cat], noBudget: true, actual, budget, monthsBudgeted }
  }
  const actualPct = (actual / budget) * 100
  const status = paceStatus(actualPct, expectedPct, CATEGORY_DIRECTION[cat])
  return {
    category: cat, label: CATEGORY_LABEL[cat], noBudget: false, actual, budget, monthsBudgeted,
    fillPct: Math.min(100, actualPct), expectedPct, status,
    paceLabel: `${actualPct.toFixed(1)}% of ${selectedPeriod.value === 'month' ? 'month' : 'year'} budget`
  }
}))

// Overspending stays at category granularity: per-account actuals don't
// exist yet (daily_line_items is empty until the QBO sync is wired to the
// UI), so a per-account "what's driving it" breakdown here would have to
// be fabricated against this restaurant's *real* chart of accounts, which
// is worse than just not showing it yet. Revenue is excluded — a revenue
// shortfall isn't "overspending," and that drill-down already exists on
// the P&L tab.
const overspendingCategories = computed(() => (['cogs', 'labor', 'opex'] as const)
  .map(cat => {
    const actual = periodActuals.value[cat]
    const budget = periodBudget.value.totals[cat]
    if (!budget) return null
    const expectedPct = periodDayFraction.value * 100
    const actualPct = (actual / budget) * 100
    const overPct = actualPct - expectedPct
    if (overPct <= 0) return null
    const expectedAmount = budget * (periodDayFraction.value)
    // Labor's budget denominator includes owner compensation (real cash
    // cost, but not what a hired-staff benchmark assumes) — surface that
    // so "Labor is over pace" isn't read as "the team is overstaffed" when
    // some of it is owner salary.
    const ownerCompNote = cat === 'labor' && laborExOwnerComp.value
      ? `Includes $${Math.round(laborExOwnerComp.value.ownerComp).toLocaleString()} owner compensation (${ownerCompAccountNames.value.join(', ')})`
      : null
    return { category: cat, label: CATEGORY_LABEL[cat], overPct, overAmount: actual - expectedAmount, actual, budget, ownerCompNote }
  })
  .filter((x): x is NonNullable<typeof x> => x !== null)
  .sort((a, b) => b.overAmount - a.overAmount))
const budgetFlagged = computed(() => overspendingCategories.value.length > 0)

// ---- Edit Monthly Budget ------------------------------------------------
const editMonth = ref(AS_OF_MONTH)
const editMonthData = computed(() => monthlyData.value[editMonth.value - 1])
const editableTotals = ref<Record<Category, string>>({ revenue: '', cogs: '', labor: '', opex: '', other: '' })
const expandedCategory = ref<Category | null>(null)
const editableAccountAmounts = ref<Record<number, string>>({})

watch(editMonthData, (data) => {
  if (!data) return
  const totals = categoryTotals([editMonth.value]).totals
  for (const cat of CATEGORIES) editableTotals.value[cat] = totals[cat] ? totals[cat].toFixed(2) : ''
  editableAccountAmounts.value = {}
  for (const acc of data.accounts) {
    if (acc.amount !== null) editableAccountAmounts.value[acc.accountId] = acc.amount.toFixed(2)
  }
}, { immediate: true })

function accountsForCategory(cat: Category) {
  return (editMonthData.value?.accounts || []).filter(a => a.category === cat).sort((a, b) => (b.amount || 0) - (a.amount || 0))
}

// While a category is expanded, its macro total isn't independently
// editable — it's just a live sum of the account rows below, so there's
// never a moment where "the total" and "the accounts" disagree about what
// the user is trying to do. Collapse it to edit the macro number instead
// (and have that redistribute across the accounts on save); expand it to
// edit specific accounts directly. Never both at once.
function categoryDisplayTotal(cat: Category): number {
  if (expandedCategory.value === cat) {
    return accountsForCategory(cat).reduce((sum, a) => sum + Number(editableAccountAmounts.value[a.accountId] || 0), 0)
  }
  return Number(editableTotals.value[cat] || 0)
}

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
  let groupTotal = 0
  let revenueTotal = 0
  for (const m of monthNumbers) {
    const data = monthlyData.value[m - 1]
    if (!data) continue
    for (const acc of data.accounts) {
      if (acc.amount === null) continue
      if (acc.category === 'revenue') revenueTotal += acc.amount
      if (acc.category === 'cogs' && acc.subcategory === group) groupTotal += acc.amount
    }
  }
  return revenueTotal > 0 ? groupTotal / revenueTotal : null
}

const cogsTrailingMonths = computed(() => trailingMonthsWithData(editMonth.value))
const cogsTrailingLabel = computed(() => cogsTrailingMonths.value.map(m => MONTH_NAMES[m - 1]).join('–'))
const cogsTrailingFoodPct = computed(() => cogsGroupPctOverMonths(cogsTrailingMonths.value, 'Food'))
const cogsTrailingBeveragePct = computed(() => cogsGroupPctOverMonths(cogsTrailingMonths.value, 'Beverage'))

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
      const groupBudget = pct * revenueBudget
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

async function saveBudgets() {
  saveStatus.value = 'saving'
  try {
    const data = editMonthData.value
    if (!data) throw new Error('Budget data not loaded yet')
    const targets: { year: number, month: number, accountId: number, amount: number }[] = []

    for (const cat of CATEGORIES) {
      const accounts = accountsForCategory(cat)
      if (accounts.length === 0) continue

      if (expandedCategory.value === cat) {
        // Account-level edit: save each changed account directly, no
        // redistribution — the category total already reflects their sum.
        for (const a of accounts) {
          const raw = editableAccountAmounts.value[a.accountId]
          const newAmount = raw === undefined || raw === '' ? 0 : Number(raw)
          if (Math.abs(newAmount - (a.amount ?? 0)) >= 0.005) {
            targets.push({ year: YEAR, month: editMonth.value, accountId: a.accountId, amount: newAmount })
          }
        }
      } else {
        // Macro edit: redistribute the delta across this category's
        // accounts proportionally by existing share, or evenly if none
        // had a budget yet this month.
        const oldTotal = accounts.reduce((sum, a) => sum + (a.amount || 0), 0)
        const newTotal = Number(editableTotals.value[cat] || 0)
        const delta = newTotal - oldTotal
        if (Math.abs(delta) < 0.005) continue
        for (const a of accounts) {
          const weight = oldTotal > 0 ? (a.amount || 0) / oldTotal : 1 / accounts.length
          const newAmount = Math.round(((a.amount || 0) + delta * weight) * 100) / 100
          targets.push({ year: YEAR, month: editMonth.value, accountId: a.accountId, amount: newAmount })
        }
      }
    }

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

// ---- Update/project from actuals ---------------------------------------
const actionStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const actionMessage = ref('')

async function updateThisMonthFromActuals() {
  actionStatus.value = 'running'
  try {
    const result = await $fetch('/api/budget/copy-actuals', {
      method: 'POST',
      body: { sourceYear: YEAR, sourceMonth: editMonth.value, targetMonths: [{ year: YEAR, month: editMonth.value }] }
    })
    actionMessage.value = `Updated ${result.accountsCopied} accounts for ${MONTH_NAMES[editMonth.value - 1]} from actuals.`
    actionStatus.value = 'done'
    await loadYear()
  } catch (err: any) {
    actionStatus.value = 'error'
    actionMessage.value = err?.data?.statusMessage || err?.message || 'No actuals available yet'
  }
}

async function projectRemainingMonths() {
  actionStatus.value = 'running'
  try {
    const targetMonths = Array.from({ length: 12 - AS_OF_MONTH }, (_, i) => ({ year: YEAR, month: AS_OF_MONTH + 1 + i }))
    const result = await $fetch('/api/budget/copy-actuals', {
      method: 'POST',
      body: { sourceYear: YEAR, sourceMonth: AS_OF_MONTH, targetMonths }
    })
    actionMessage.value = `Projected ${result.accountsCopied} accounts across ${targetMonths.length} remaining months from ${MONTH_NAMES[AS_OF_MONTH - 1]} actuals.`
    actionStatus.value = 'done'
    await loadYear()
  } catch (err: any) {
    actionStatus.value = 'error'
    actionMessage.value = err?.data?.statusMessage || err?.message || 'No actuals available yet'
  }
}

function exportForQuickBooks() {
  window.open(`/api/budget/export?year=${YEAR}`, '_blank')
}
</script>

<template>
  <div>
    <header>
      <div>
        <h1>{{ site.restaurantName }} — Budget</h1>
        <div class="sub">Budget vs. revenue, overspending, and easy monthly edits &middot; {{ YEAR }}</div>
      </div>
      <div class="as-of">
        <span :class="['chip', syncFailed ? 'critical' : 'good']"><span class="dot"></span>{{ syncFailed ? 'Sync failed' : 'Sync healthy' }}</span>
        <div class="sync-line">
          <template v-if="!syncFailed">Last synced from QuickBooks: <strong>{{ lastSync.finishedAt }}</strong></template>
          <template v-else>Sync failed — showing data through <strong>{{ lastSync.dataThroughDate }}</strong></template>
        </div>
        <span class="sample-tag">Actuals are sample data — budgets are real</span>
      </div>
    </header>

    <div v-if="loadError" class="drill-card">
      <span class="chip critical"><span class="dot"></span>Couldn't load budget data</span>
      <span class="quiet-note">{{ loadError }}</span>
    </div>

    <template v-else>
      <!-- Are we going to earn enough to hit budget? -->
      <section>
        <div class="section-head">
          <div class="section-label">Budget Pace</div>
          <div class="period-tabs">
            <span :class="['period-tab', selectedPeriod === 'month' && 'active']" @click="selectedPeriod = 'month'">Month</span>
            <span :class="['period-tab', selectedPeriod === 'year' && 'active']" @click="selectedPeriod = 'year'">Year</span>
          </div>
        </div>

        <div class="hero-row">
          <div class="hero-card anchor">
            <div class="hero-top">
              <span class="period">Net Income — {{ selectedPeriod === 'month' ? 'This Month' : 'This Year' }}</span>
              <span :class="['chip', actualNetIncome >= budgetNetIncome ? 'good' : 'serious']">
                <span class="dot"></span>{{ actualNetIncome >= budgetNetIncome ? 'On/ahead of budget' : 'Behind budget' }}
              </span>
            </div>
            <div :class="['figure', actualNetIncome >= 0 ? 'good' : 'critical']">{{ actualNetIncome >= 0 ? '+' : '' }}${{ actualNetIncome.toLocaleString() }}</div>
            <div class="caption">vs. ${{ budgetNetIncome.toLocaleString() }} budgeted (revenue − COGS − labor − opex, derived, not entered directly)</div>
          </div>
        </div>

        <div class="meter-row">
          <div v-for="card in paceCards" :key="card.category" class="runway-card">
            <template v-if="card.noBudget">
              <div class="runway-head"><span class="name">{{ card.label }}</span></div>
              <span class="chip warning"><span class="dot"></span>No budget set for this {{ selectedPeriod }}</span>
            </template>
            <template v-else>
              <div class="runway-head">
                <span class="name">{{ card.label }}</span>
                <span class="nums">${{ card.actual.toLocaleString() }} actual &middot; ${{ card.budget.toLocaleString() }} budget</span>
              </div>
              <div class="runway-track">
                <div :class="['runway-fill', card.status]" :style="{ width: card.fillPct + '%' }"></div>
                <div class="runway-expected" :style="{ left: card.expectedPct + '%' }"></div>
              </div>
              <div class="runway-foot">
                <span>$0</span>
                <span :class="['chip', card.status]"><span class="dot"></span>{{ card.paceLabel }}</span>
                <span>${{ card.budget.toLocaleString() }}</span>
              </div>
              <div v-if="selectedPeriod === 'year' && card.monthsBudgeted < 12" class="section-note">Only {{ card.monthsBudgeted }} of 12 months budgeted so far — see "Project remaining months" below</div>
              <div v-if="card.category === 'labor' && laborExOwnerComp" class="section-note">
                Includes ${{ Math.round(laborExOwnerComp.ownerComp).toLocaleString() }} owner compensation ({{ ownerCompAccountNames.join(', ') }}).
                Excluding it: ${{ Math.round(laborExOwnerComp.budgetExOwnerComp).toLocaleString() }} budget<template v-if="laborExOwnerComp.actualPctExOwnerComp !== null">, {{ laborExOwnerComp.actualPctExOwnerComp.toFixed(1) }}% of that pace</template>.
                Actual can't be split by account yet — see "Not yet done" in CLAUDE.md.
              </div>
            </template>
          </div>
        </div>
      </section>

      <!-- Are any categories running over budget faster than the month/year calls for? -->
      <section>
        <div class="section-head">
          <div class="section-label">Overspending</div>
          <div class="section-note">Category-level for now — per-account detail needs real actuals from QuickBooks, not yet wired to this UI</div>
        </div>

        <div v-if="budgetFlagged" class="drill-card">
          <div class="callout">
            {{ overspendingCategories.length }} of 3 cost categories are running ahead of budget pace this {{ selectedPeriod }},
            led by <strong>{{ overspendingCategories[0].label }}</strong> (${{ Math.round(overspendingCategories[0].overAmount).toLocaleString() }} over expected pace).
          </div>
          <div class="rank-list">
            <div v-for="row in overspendingCategories" :key="row.category" class="rank-row">
              <div class="label">
                {{ row.label }}<span class="flag serious">▲ {{ row.overPct.toFixed(1) }}pts ahead of pace</span>
                <span v-if="row.ownerCompNote" class="flag neutral">{{ row.ownerCompNote }}</span>
              </div>
              <div class="rank-track"><div class="rank-fill serious" :style="{ width: Math.min(100, (row.actual / row.budget) * 100) + '%' }"></div></div>
              <div class="rank-value">${{ Math.round(row.overAmount).toLocaleString() }}<span class="sub">over expected pace</span></div>
            </div>
          </div>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip good"><span class="dot"></span>Nothing unusual</span>
          <span class="quiet-note">No cost category is running ahead of budget pace this {{ selectedPeriod }}.</span>
        </div>
      </section>

      <!-- Edit budgets, update from actuals, export for QuickBooks -->
      <section>
        <div class="section-head">
          <div class="section-label">Edit Monthly Budget</div>
          <select class="month-select" v-model.number="editMonth">
            <option v-for="(name, i) in MONTH_NAMES" :key="name" :value="i + 1">{{ name }} {{ YEAR }}</option>
          </select>
        </div>

        <div class="pl-table-card">
          <table class="pl-table edit-table">
            <tbody>
              <template v-for="cat in CATEGORIES" :key="cat">
                <tr>
                  <th scope="row">
                    <button class="expand-toggle" @click="expandedCategory = expandedCategory === cat ? null : cat">
                      {{ expandedCategory === cat ? '▾' : '▸' }} {{ CATEGORY_LABEL[cat] }}
                    </button>
                  </th>
                  <td>
                    <input v-if="expandedCategory !== cat" type="number" step="0.01" class="amount-input" v-model="editableTotals[cat]" />
                    <span v-else class="amount-input readonly">{{ categoryDisplayTotal(cat).toFixed(2) }}</span>
                  </td>
                </tr>
                <template v-if="expandedCategory === cat">
                  <tr v-for="acc in accountsForCategory(cat)" :key="acc.accountId" class="account-row">
                    <th scope="row"><span class="account-label">{{ acc.name }}</span></th>
                    <td><input type="number" step="0.01" class="amount-input" v-model="editableAccountAmounts[acc.accountId]" placeholder="0.00" /></td>
                  </tr>
                </template>
                <tr v-if="cat === 'cogs'" class="cogs-avg-row">
                  <td colspan="2">
                    <div class="section-note">
                      COGS is variable — it scales with revenue, not a fixed dollar guess. Trailing
                      {{ cogsTrailingMonths.length || 0 }}-mo avg<template v-if="cogsTrailingLabel"> ({{ cogsTrailingLabel }})</template>:
                      Food <strong>{{ cogsTrailingFoodPct !== null ? (cogsTrailingFoodPct * 100).toFixed(1) + '%' : 'n/a' }}</strong>,
                      Beverage <strong>{{ cogsTrailingBeveragePct !== null ? (cogsTrailingBeveragePct * 100).toFixed(1) + '%' : 'n/a' }}</strong>
                      of revenue.
                      <button class="mini-btn" :disabled="cogsRecomputeStatus === 'running'" @click="recomputeCogsFromTrailingAverage">
                        Recompute {{ MONTH_NAMES[editMonth - 1] }} COGS from this average
                      </button>
                      <span v-if="cogsRecomputeStatus === 'done'" class="chip good"><span class="dot"></span>{{ cogsRecomputeMessage }}</span>
                      <span v-if="cogsRecomputeStatus === 'error'" class="chip warning"><span class="dot"></span>{{ cogsRecomputeMessage }}</span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div class="action-row">
          <button class="action-btn primary" :disabled="saveStatus === 'saving'" @click="saveBudgets">Save budget</button>
          <button class="action-btn" :disabled="actionStatus === 'running'" @click="updateThisMonthFromActuals">Update this month from actuals</button>
          <button class="action-btn" :disabled="actionStatus === 'running'" @click="projectRemainingMonths">Project remaining months from {{ MONTH_NAMES[AS_OF_MONTH - 1] }} actuals</button>
          <button class="action-btn" @click="exportForQuickBooks">Export for QuickBooks</button>
        </div>
        <div v-if="saveStatus === 'saved'" class="chip good"><span class="dot"></span>Saved</div>
        <div v-if="saveStatus === 'error'" class="chip critical"><span class="dot"></span>{{ saveMessage }}</div>
        <div v-if="actionStatus === 'done'" class="chip good"><span class="dot"></span>{{ actionMessage }}</div>
        <div v-if="actionStatus === 'error'" class="chip warning"><span class="dot"></span>{{ actionMessage }}</div>
      </section>
    </template>

    <div class="legend">
      <span class="chip good"><span class="dot"></span>On / ahead of budget</span>
      <span class="chip warning"><span class="dot"></span>Watch</span>
      <span class="chip serious"><span class="dot"></span>Off pace</span>
      <span class="chip critical"><span class="dot"></span>Over / under budget</span>
    </div>

    <footer>
      <span>Actuals: illustrative sample data &middot; Budgets: real data imported from QuickBooks' budget export</span>
      <span>{{ site.restaurantName }} Performance Dashboard — v0 mockup</span>
    </footer>
  </div>
</template>

<style scoped>
/* ---------- hero row (copied from index.vue for visual consistency) ---------- */
.hero-row { display: grid; grid-template-columns: 1fr; gap: 14px; }
.hero-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hero-card.anchor { background: var(--accent-wash); border-color: transparent; }
.hero-card .hero-top { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.hero-card .period { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.hero-card .figure { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.hero-card .figure.good { color: var(--good); }
.hero-card .figure.critical { color: var(--critical); }
.hero-card .caption { font-size: 12px; color: var(--ink-3); }

/* ---------- period pill selector (copied from pl.vue) ---------- */
.period-tabs { display: flex; gap: 6px; }
.period-tab {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 11px;
  border-radius: 100px;
  border: 1px solid var(--hair);
  color: var(--ink-3);
  cursor: pointer;
  user-select: none;
}
.period-tab.active { background: var(--accent-wash); color: var(--accent); border-color: transparent; }

/* ---------- pace meters / budget runway bars (copied from index.vue) ---------- */
.meter-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
.runway-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.runway-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; }
.runway-head .name { font-size: 14px; font-weight: 700; }
.runway-head .nums { font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.runway-track { position: relative; height: 22px; border-radius: 8px; background: var(--surface-alt); overflow: visible; }
.runway-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 8px; }
.runway-fill.good { background: var(--good); }
.runway-fill.warning { background: var(--warning); }
.runway-fill.serious { background: var(--serious); }
.runway-fill.critical { background: var(--critical); }
.runway-expected { position: absolute; top: -4px; width: 2px; height: 30px; background: var(--ink); opacity: 0.55; }
.runway-expected::after {
  content: "today's pace"; position: absolute; top: -18px; left: 50%; transform: translateX(-50%);
  font-size: 9px; white-space: nowrap; color: var(--ink-3); font-weight: 600;
}
.runway-foot { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); }

/* ---------- ranked drill-down list (copied from pl.vue) ---------- */
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
.drill-card.quiet { flex-direction: row; align-items: center; gap: 10px; padding: 12px 16px; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.drill-card .callout { font-size: 12.5px; color: var(--ink-2); background: var(--surface-alt); border-radius: 10px; padding: 10px 12px; line-height: 1.5; }
.rank-list { display: flex; flex-direction: column; gap: 12px; }
.rank-row { display: grid; grid-template-columns: 150px 1fr 130px; align-items: center; gap: 12px; }
.rank-row .label { font-size: 13px; font-weight: 600; }
.rank-row .label .flag { display: block; font-size: 11px; font-weight: 700; margin-top: 2px; }
.rank-row .label .flag.serious { color: var(--serious); }
.rank-row .label .flag.neutral { color: var(--ink-3); font-weight: 500; }
.rank-track { position: relative; height: 9px; border-radius: 5px; background: var(--surface-alt); }
.rank-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 5px; }
.rank-fill.serious { background: var(--serious); }
.rank-value { font-size: 13px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.rank-value .sub { display: block; font-size: 11px; font-weight: 500; color: var(--ink-3); }

/* ---------- edit table ---------- */
.month-select {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink);
}
.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
}
table.edit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.edit-table th, .edit-table td { padding: 10px 16px; text-align: right; }
.edit-table th:first-child, .edit-table td:first-child { text-align: left; }
.edit-table tbody tr { border-bottom: 1px solid var(--hair); }
.edit-table tbody tr:last-child { border-bottom: none; }
.edit-table tr.account-row { background: var(--surface-alt); }
.edit-table tr.account-row th { font-weight: 500; padding-left: 28px; }
.account-label { font-size: 12.5px; color: var(--ink-2); }
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

.action-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
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
  .meter-row { grid-template-columns: 1fr; }
  .rank-row { grid-template-columns: 100px 1fr 100px; }
}
</style>
