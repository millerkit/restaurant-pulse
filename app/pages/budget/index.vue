<script setup lang="ts">
import site from '~/config/site.json'
import { CATEGORY_DIRECTION, CATEGORY_LABEL, MONTH_NAMES, YEAR, type Category, categoryTotals, currentAsOfDay, currentAsOfMonth, daysInMonth, hybridYearExpectedToDate, hybridYearTotals, monthCategoryBudget, monthExpectedOpex, netIncome, paceStatus, useActualsYear, useBudgetYear } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Budget Pace` })

const { monthlyData, loadError, loadYear } = useBudgetYear()
const { monthlyActuals, loadError: actualsLoadError, loadActualsYear } = useActualsYear()

// Real "as of" month/day this page paces against — see currentAsOfMonth/
// currentAsOfDay in useBudgetData.ts for why this must be the real date,
// not a frozen narration date.
const asOfMonth = currentAsOfMonth()
const asOfDay = currentAsOfDay()
const asOfLabel = `${MONTH_NAMES[asOfMonth - 1]} ${asOfDay}`

function categoryTotalsFor(monthNumbers: number[]) {
  return categoryTotals(monthlyData.value, monthNumbers)
}

const monthBudget = computed(() => categoryTotalsFor([asOfMonth]))
// Year total is the hybrid target (budget where set, actual fallback for a
// fully-elapsed unbudgeted month — see hybridYearTotals) rather than a
// plain sum of whatever budget_targets rows exist. Without this, a year
// with only some months budgeted (e.g. this restaurant's Jan-Jun 2026,
// budgeted only from Jul onward after the move) compares a full-year
// actual against a partial-year target, producing a wildly inflated pace
// percentage even though each underlying number is individually correct —
// same bug as the Dashboard's year revenue pace, fixed the same way here
// for all four categories. monthsBudgeted (the literal, non-fallback count
// used by the "X of 12 months budgeted" note below) still comes from the
// plain categoryTotals — that note should only ever point at genuinely
// unbudgeted months, not ones a fallback happens to be covering for.
const yearBudget = computed(() => ({
  totals: hybridYearTotals(getMonthCategoryBudget, monthlyActuals.value, asOfMonth),
  monthsBudgeted: categoryTotalsFor(Array.from({ length: 12 }, (_, i) => i + 1)).monthsBudgeted
}))

// Owner-operator compensation (Executive Chef, Business Manager — see
// schema.sql) carve-out: real cash cost, so it stays in total labor $ and
// net income, but a hired-staff industry benchmark was never built
// assuming the owners are on payroll, so we show labor % both ways rather
// than picking one silently. Only the budget side of this is real — actual
// labor is still a single lump real figure (daily_line_items has real
// per-account data now, but nothing here breaks it out by account yet), so
// there's no way to split actual labor by owner-comp vs. not yet.
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
const monthOwnerComp = computed(() => ownerCompensationTotal([asOfMonth]))
const yearOwnerComp = computed(() => ownerCompensationTotal(Array.from({ length: 12 }, (_, i) => i + 1)))
const periodOwnerComp = computed(() => selectedPeriod.value === 'month' ? monthOwnerComp.value : yearOwnerComp.value)
const ownerCompAccountNames = computed(() => {
  const data = monthlyData.value[asOfMonth - 1]
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
const periodDayFraction = computed(() => asOfDay / daysInMonth(YEAR, asOfMonth))

// Looks up a single month's budgeted total for one category directly from
// the loaded budget_targets data — no draft/unsaved-edit substitution here
// (that's only a concern on the Edit Budget page), so this is just a thin
// wrapper around monthCategoryBudget.
function getMonthCategoryBudget(month: number, cat: Category) {
  return monthCategoryBudget(monthlyData.value[month - 1], cat)
}

// Cumulative target-through-today per category, built from each fully-
// elapsed month's own budget (or, if that month was never budgeted, its own
// real actual — see hybridMonthlyCategoryTargets in useBudgetData.ts) plus
// a pro-rated slice of the current month's budget — not a flat calendar-day
// share of the annual total, which assumes each category's budget accrues
// evenly across all 12 months. Same fix as the Dashboard's year revenue
// pace (see CLAUDE.md's "Year revenue pace now seasonality-aware" section),
// applied here to all four pace-card categories rather than just revenue.
const yearExpectedToDate = computed(() => hybridYearExpectedToDate(getMonthCategoryBudget, monthlyActuals.value, asOfMonth, asOfDay))

// Dollar amount that should have accrued by today for a category's budget
// — seasonality-aware for the year view; for the month view, Opex accounts
// for its known lump-sum accounts (rent, loan interest — see
// monthExpectedOpex/opexLumpSumPostingDays in useBudgetData.ts) rather than
// assuming even daily accrual, and every other category still uses the flat
// within-month fraction (no finer-grained-than-monthly budget exists to do
// better there).
function expectedAmountFor(cat: 'revenue' | 'cogs' | 'labor' | 'opex', budget: number) {
  if (selectedPeriod.value === 'year') return yearExpectedToDate.value[cat]
  if (cat === 'opex') return monthExpectedOpex(monthlyData.value[asOfMonth - 1], asOfDay, daysInMonth(YEAR, asOfMonth))
  return budget * periodDayFraction.value
}
function actualsTotalsFor(monthNumbers: number[]) {
  const totals = { revenue: 0, cogs: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }
  for (const m of monthNumbers) {
    const data = monthlyActuals.value[m - 1]
    if (!data) continue
    totals.revenue += data.totals.revenue
    totals.cogs += data.totals.cogs
    totals.labor += data.totals.labor
    totals.opex += data.totals.opex
    totals.other_income += data.totals.other_income
    totals.other_expense += data.totals.other_expense
  }
  return totals
}
const monthActualsTotals = computed(() => actualsTotalsFor([asOfMonth]))
const yearActualsTotals = computed(() => actualsTotalsFor(Array.from({ length: 12 }, (_, i) => i + 1)))
const periodActuals = computed(() => selectedPeriod.value === 'month' ? monthActualsTotals.value : yearActualsTotals.value)
const periodBudget = computed(() => selectedPeriod.value === 'month' ? monthBudget.value : yearBudget.value)

// Other income/expense (grants, insurance proceeds, depreciation, etc. —
// split from a single 'other' bucket 2026-07-29 so each account's real QBO
// sign is known instead of guessed) is already folded into actualNetIncome/
// budgetNetIncome below via netIncome()'s own other_income/other_expense
// terms. This is just a transparency note — surfaced only when material —
// since neither figure otherwise appears anywhere else on this page (no
// pace card, no overspending row) the way revenue/cogs/labor/opex do.
const periodOtherNet = computed(() => periodActuals.value.other_income - periodActuals.value.other_expense)

// Net income uses the same derivation on all three pages — see netIncome()
// in useBudgetData.ts.
const actualNetIncome = computed(() => netIncome(periodActuals.value))
const budgetNetIncome = computed(() => netIncome(periodBudget.value.totals as any))

// ---- Month-end projection --------------------------------------------
// Straight-line projection of the current in-progress month: actual-to-date
// scaled up by how much of the month has elapsed. Month-only — the Year
// view's "actual" already blends 6+ closed months with the in-progress one,
// so a single straight-line scale-up wouldn't mean the same thing there.
// This is the non-destructive alternative to the Edit Budget page's
// "Update this month from actuals" button actually overwriting budget_targets
// with a partial-month guess — see edit.vue.
const monthDayFraction = computed(() => asOfDay / daysInMonth(YEAR, asOfMonth))
const monthProjected = computed(() => {
  const proj = {} as Record<'revenue' | 'cogs' | 'labor' | 'opex' | 'other_income' | 'other_expense', number>
  for (const cat of ['revenue', 'cogs', 'labor', 'opex', 'other_income', 'other_expense'] as const) {
    proj[cat] = monthActualsTotals.value[cat] / monthDayFraction.value
  }
  return proj
})
const projectedNetIncome = computed(() => netIncome(monthProjected.value))

// How many of this year's already-elapsed months have no budget row for
// this category — distinct from monthsBudgeted's complement, since a
// *future* unbudgeted month doesn't get an actual-fallback (there's no
// actual yet) and shouldn't be described as "using actuals" in the note
// below.
function unbudgetedPastMonths(cat: Category): number {
  let count = 0
  for (let m = 1; m < asOfMonth; m++) {
    if (getMonthCategoryBudget(m, cat) == null) count++
  }
  return count
}

const paceCards = computed(() => (['revenue', 'cogs', 'labor', 'opex'] as const).map(cat => {
  const actual = periodActuals.value[cat]
  const budget = periodBudget.value.totals[cat]
  const monthsBudgeted = periodBudget.value.monthsBudgeted[cat]
  const unbudgetedPast = selectedPeriod.value === 'year' ? unbudgetedPastMonths(cat) : 0
  if (!budget) {
    return { category: cat, label: CATEGORY_LABEL[cat], noBudget: true, actual, budget, monthsBudgeted, unbudgetedPast, projection: null }
  }
  const expectedPct = (expectedAmountFor(cat, budget) / budget) * 100
  const actualPct = (actual / budget) * 100
  const status = paceStatus(actualPct, expectedPct, CATEGORY_DIRECTION[cat])
  // Compares the projected month-end total against 100% of budget (will we
  // land over or under), not against today's expected pace (are we on
  // track right now) — a related but distinct question, so it reuses
  // paceStatus with a different expectedPct rather than the card's own.
  const projection = selectedPeriod.value === 'month'
    ? (() => {
        const projected = monthProjected.value[cat]
        const projectedPct = (projected / budget) * 100
        const projectedStatus = paceStatus(projectedPct, 100, CATEGORY_DIRECTION[cat])
        return { projected, projectedStatus, delta: projected - budget }
      })()
    : null
  return {
    category: cat, label: CATEGORY_LABEL[cat], noBudget: false, actual, budget, monthsBudgeted, unbudgetedPast,
    fillPct: Math.min(100, actualPct), expectedPct, status,
    paceLabel: `${actualPct.toFixed(1)}% of ${selectedPeriod.value === 'month' ? 'month' : 'year'} budget`,
    projection
  }
}))

// Overspending stays at category granularity: per-account actuals don't
// exist yet (daily_line_items is empty until the QBO sync is wired to the
// UI), so a per-account "what's driving it" breakdown here would have to
// be fabricated against this restaurant's *real* chart of accounts, which
// is worse than just not showing it yet. Revenue is excluded — a revenue
// shortfall isn't "overspending," and that drill-down already exists on
// the P&L tab.
const COST_CATEGORIES = ['cogs', 'labor', 'opex'] as const
// Spelled out in the callout below, per the user's own request 2026-08-20
// after "1 of 3 cost categories" left them unsure which 3 — built from
// CATEGORY_LABEL rather than hardcoded so it can't drift if a label ever
// changes. Always exactly 3 categories, so a plain "A, B, and C" join is
// safe here without a general list-formatter.
const costCategoryLabelList = computed(() => {
  const labels = COST_CATEGORIES.map(c => CATEGORY_LABEL[c])
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`
})

// All 3 cost categories always get a row now, not just the ones running
// over pace — per the user's own request 2026-08-20, after pointing out
// that collapsing to a single "Nothing unusual" line the moment nothing
// was flagged hid which categories were even being checked. Fixed category
// order (matching the pace cards' own Revenue/COGS/Labor/Opex order above,
// minus Revenue) rather than sorted by how over/under pace each one is —
// keeps the three rows in the same place every time you look, instead of
// reshuffling as pace changes.
const costCategoryRows = computed(() => COST_CATEGORIES.map(cat => {
  const actual = periodActuals.value[cat]
  const budget = periodBudget.value.totals[cat]
  if (!budget) return { category: cat, label: CATEGORY_LABEL[cat], noBudget: true as const }
  const expectedAmount = expectedAmountFor(cat, budget)
  const expectedPct = (expectedAmount / budget) * 100
  const actualPct = (actual / budget) * 100
  const overPct = actualPct - expectedPct
  // Labor's budget denominator includes owner compensation (real cash
  // cost, but not what a hired-staff benchmark assumes) — surface that
  // so "Labor is over pace" isn't read as "the team is overstaffed" when
  // some of it is owner salary.
  const ownerCompNote = cat === 'labor' && laborExOwnerComp.value
    ? `Includes $${Math.round(laborExOwnerComp.value.ownerComp).toLocaleString()} owner compensation (${ownerCompAccountNames.value.join(', ')})`
    : null
  return {
    category: cat, label: CATEGORY_LABEL[cat], noBudget: false as const,
    overPace: overPct > 0, overPct, overAmount: actual - expectedAmount, actual, budget, ownerCompNote
  }
}))
// Just for the callout's "led by X" — the visual row order above stays
// fixed regardless of this.
const overCategories = computed(() => costCategoryRows.value
  .filter(r => !r.noBudget && r.overPace)
  .sort((a, b) => (b as any).overAmount - (a as any).overAmount))

// ---- Overspending "why" detail (Labor/Opex subcategory breakdown) -------
// Moved here 2026-08-20 from the old standalone P&L Drill-Downs page, which
// was retired — see CLAUDE.md's "Budget Pace / Drill-Downs consolidation"
// section. That page's Month-grain subcategory pacing was structurally
// unreliable for lumpy fixed costs (a lump-sum rent/utility payment reads
// as wildly "ahead" or "behind" pace depending on whether it happened to
// post yet), so Fixed opex here shows plain dollar totals only — never a
// pace comparison, at either grain. Labor and Variable opex keep the full
// pace-comparison detail at both Month and Year, per the user's own
// judgment that they don't share Fixed's single-lump-payment problem badly
// enough to lose Month-grain detail. Only shown as an expandable "why"
// under a category already flagged in overspendingCategories above — COGS
// has no subcategory breakdown (same as before this move; per-account
// actuals don't exist yet, see "Not yet done" in CLAUDE.md).
const { data: detailData, refresh: refreshDetail } = await useFetch('/api/budget/overspending-detail')

type Direction = 'up' | 'down' | 'flat'
type DeltaRow = { label: string, amount: number, direction: Direction, deltaText: string }
function fmtSignedDollars(n: number): string {
  return `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString()}`
}
function buildDeltaRow(r: { label: string, amount: number, comparisonAmount: number, hasBudget: boolean, pctChange: number | null }): DeltaRow {
  const deltaAmount = Math.round(r.amount - r.comparisonAmount)
  if (r.pctChange === null) {
    // No meaningful percentage to show either way (dividing by a
    // zero/negative comparison figure can flip sign confusingly — e.g. a
    // real -$590 budget against a -$955 actual computes as "+62%", which
    // reads backwards next to a negative dollar delta). Direction follows
    // the delta's own sign instead of always being red/"up" — a negative
    // delta here (actual came in under the comparison) is a good/green
    // signal, not serious.
    //
    // hasBudget means a real budget_targets row exists and just sums to $0
    // or less (e.g. Marketing & Advertising's real, deliberate OpenTable
    // incentive credit — see CLAUDE.md 2026-08-20), vs. no budget row at
    // all. The two need different wording — a real, if non-positive,
    // budget should say so with the actual number, not a vague "no
    // positive budget" dismissal: caught directly by the user, who pointed
    // out a genuinely complete per-account budget existed on Edit Budget
    // even though this subcategory's group total was negative.
    const direction: Direction = deltaAmount > 0 ? 'up' : deltaAmount < 0 ? 'down' : 'flat'
    const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '●'
    const reason = r.hasBudget ? `vs. $${Math.round(r.comparisonAmount).toLocaleString()} budgeted` : 'not budgeted'
    return { label: r.label, amount: r.amount, direction, deltaText: `${arrow} ${reason} (${fmtSignedDollars(deltaAmount)})` }
  }
  const roundedPct = Math.round(Math.abs(r.pctChange))
  if (roundedPct === 0) {
    const deltaText = deltaAmount === 0 ? 'No change' : `${fmtSignedDollars(deltaAmount)} (<1% change)`
    return { label: r.label, amount: r.amount, direction: 'flat', deltaText: `● ${deltaText}` }
  }
  const direction: Direction = r.pctChange > 0 ? 'up' : 'down'
  const arrow = direction === 'up' ? '▲' : '▼'
  const pctSign = r.pctChange > 0 ? '+' : '−'
  return { label: r.label, amount: r.amount, direction, deltaText: `${arrow} ${pctSign}${roundedPct}% (${fmtSignedDollars(deltaAmount)})` }
}
function sortByDirection(rows: DeltaRow[]): DeltaRow[] {
  const rank: Record<Direction, number> = { up: 0, flat: 1, down: 2 }
  return [...rows].sort((a, b) => rank[a.direction] - rank[b.direction])
}

const cogsDetailRows = computed(() => sortByDirection((detailData.value?.detail?.[selectedPeriod.value]?.cogs ?? []).filter(r => r.flagged).map(r => buildDeltaRow(r))))
const laborDetailRows = computed(() => sortByDirection((detailData.value?.detail?.[selectedPeriod.value]?.labor ?? []).filter(r => r.flagged).map(r => buildDeltaRow(r))))
const opexVariableDetailRows = computed(() => sortByDirection((detailData.value?.detail?.[selectedPeriod.value]?.opexVariable ?? []).filter(r => r.flagged).map(r => buildDeltaRow(r))))
const opexFixedDetailRows = computed(() => [...(detailData.value?.detail?.[selectedPeriod.value]?.opexFixed ?? [])].sort((a, b) => b.amount - a.amount))
const opexFixedDetailTotal = computed(() => opexFixedDetailRows.value.reduce((sum, r) => sum + r.amount, 0))
const opexFixedDetailPct = computed(() => periodActuals.value.revenue ? (opexFixedDetailTotal.value / periodActuals.value.revenue) * 100 : 0)

const expandedCategory = ref<Category | null>(null)
function toggleDetail(cat: Category) {
  expandedCategory.value = expandedCategory.value === cat ? null : cat
}
function hasDetail(cat: Category) {
  return cat === 'cogs' || cat === 'labor' || cat === 'opex'
}

// ---- Materiality threshold form -------------------------------------------
// Editable via drilldown_thresholds (server/api/budget/drilldown-thresholds.post.ts)
// — Month and Year are edited together in one small form, since both are
// always in play (flipping the Month/Year toggle above shouldn't require a
// second trip here to see/edit the other one's value).
const monthThresholdInput = ref<number | null>(null)
const yearThresholdInput = ref<number | null>(null)
watch(() => detailData.value?.thresholds, (t) => {
  if (!t) return
  if (monthThresholdInput.value === null) monthThresholdInput.value = t.month
  if (yearThresholdInput.value === null) yearThresholdInput.value = t.year
}, { immediate: true })

const thresholdSubmitting = ref(false)
const thresholdError = ref('')
const thresholdSaved = ref(false)
async function submitThresholds() {
  if (monthThresholdInput.value == null || yearThresholdInput.value == null) return
  thresholdSubmitting.value = true
  thresholdError.value = ''
  thresholdSaved.value = false
  try {
    await $fetch('/api/budget/drilldown-thresholds', {
      method: 'POST',
      body: { monthThreshold: monthThresholdInput.value, yearThreshold: yearThresholdInput.value }
    })
    thresholdSaved.value = true
    await refreshDetail()
  } catch (err: any) {
    thresholdError.value = err?.data?.statusMessage || err?.message || 'Failed to save thresholds'
  } finally {
    thresholdSubmitting.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      page-name="Budget Pace"
      :description="`Are we going to earn enough to hit budget? · ${YEAR}`"
      :as-of-label="asOfLabel"
      @synced="loadYear(); loadActualsYear(); refreshDetail()"
    />

    <div v-if="loadError || actualsLoadError" class="drill-card">
      <span class="chip critical">Couldn't load budget data</span>
      <span class="quiet-note">{{ loadError || actualsLoadError }}</span>
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
                {{ actualNetIncome >= budgetNetIncome ? 'On/ahead of budget' : 'Behind budget' }}
              </span>
            </div>
            <div class="figure">{{ actualNetIncome >= 0 ? '+' : '' }}${{ actualNetIncome.toLocaleString() }}</div>
            <div class="caption">vs. ${{ budgetNetIncome.toLocaleString() }} budgeted (revenue − COGS − labor − opex)</div>
            <div v-if="periodOtherNet !== 0" class="caption">
              Includes {{ periodOtherNet >= 0 ? 'net' : 'a net cost of' }} ${{ Math.abs(Math.round(periodOtherNet)).toLocaleString() }} in other income/expense (grants, insurance proceeds, depreciation, etc.) — not broken out below
            </div>
            <div v-if="selectedPeriod === 'month'" class="caption projection-line">
              Projected month-end (at this pace): <strong>{{ projectedNetIncome >= 0 ? '+' : '' }}${{ Math.round(projectedNetIncome).toLocaleString() }}</strong>
              <span :class="['chip', projectedNetIncome >= budgetNetIncome ? 'good' : 'serious']">{{ projectedNetIncome >= budgetNetIncome ? '✓ on pace to hit budget' : '▲ projected to miss budget' }}</span>
            </div>
          </div>
        </div>

        <div class="meter-row">
          <div v-for="card in paceCards" :key="card.category" class="runway-card">
            <template v-if="card.noBudget">
              <div class="runway-head"><span class="name">{{ card.label }}</span></div>
              <span class="chip warning">No budget set for this {{ selectedPeriod }}</span>
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
                <span :class="['chip', card.status]">{{ card.paceLabel }}</span>
                <span>${{ card.budget.toLocaleString() }}</span>
              </div>
              <div v-if="card.projection" class="section-note projection-note">
                Projected month-end: <strong>${{ Math.round(card.projection.projected).toLocaleString() }}</strong>
                <span :class="['chip', card.projection.projectedStatus]">{{ card.projection.projectedStatus === 'good' ? '✓' : (card.projection.delta >= 0 ? '▲' : '▼') }} {{ card.projection.delta >= 0 ? '+' : '−' }}${{ Math.abs(Math.round(card.projection.delta)).toLocaleString() }} vs budget</span>
              </div>
              <div v-if="selectedPeriod === 'year' && card.monthsBudgeted < 12" class="section-note">
                Only {{ card.monthsBudgeted }} of 12 months budgeted so far
                <template v-if="card.unbudgetedPast > 0">— {{ card.unbudgetedPast }} already-elapsed month{{ card.unbudgetedPast === 1 ? '' : 's' }} above use{{ card.unbudgetedPast === 1 ? 's' : '' }} actual revenue/spend instead of a budget</template>
                — edit remaining months on the Edit Budget tab
              </div>
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
          <div class="section-note">Category-level, with an expandable subcategory breakdown for COGS/Labor/Opex — per-account detail isn't built yet (see "Not yet done" in CLAUDE.md)</div>
        </div>

        <form class="threshold-form" @submit.prevent="submitThresholds">
          <div class="threshold-form-row">
            <span class="threshold-form-label">
              Materiality Threshold
              <span class="threshold-form-hint">Hides subcategory detail below this $ variance from expected pace</span>
            </span>
            <label>Month<input type="number" step="1" min="0" v-model.number="monthThresholdInput" required /></label>
            <label>Year<input type="number" step="1" min="0" v-model.number="yearThresholdInput" required /></label>
            <button type="submit" :disabled="thresholdSubmitting">{{ thresholdSubmitting ? 'Saving…' : 'Save' }}</button>
            <span v-if="thresholdError" class="chip critical">{{ thresholdError }}</span>
            <span v-else-if="thresholdSaved" class="chip good">Saved</span>
          </div>
        </form>

        <div class="drill-card">
          <div class="callout">
            <template v-if="overCategories.length">
              {{ overCategories.length }} of 3 cost categories ({{ costCategoryLabelList }}) {{ overCategories.length === 1 ? 'is' : 'are' }} running ahead of budget pace this {{ selectedPeriod }},
              led by <strong>{{ overCategories[0].label }}</strong> (${{ Math.round(overCategories[0].overAmount).toLocaleString() }} over expected pace).
            </template>
            <template v-else>
              All 3 cost categories ({{ costCategoryLabelList }}) are on pace or under budget this {{ selectedPeriod }}.
            </template>
          </div>
          <div class="rank-list">
            <div v-for="row in costCategoryRows" :key="row.category" class="rank-item">
              <div v-if="row.noBudget" class="rank-row">
                <div class="label">{{ row.label }}</div>
                <span class="chip warning">No budget set for this {{ selectedPeriod }}</span>
              </div>
              <template v-else>
                <div class="rank-row">
                  <div class="label">
                    {{ row.label }}<span :class="['flag', row.overPace ? 'serious' : 'good']">{{ row.overPace ? `▲ ${row.overPct.toFixed(1)}pts ahead of pace` : `✓ ${Math.abs(row.overPct).toFixed(1)}pts under pace` }}</span>
                    <span v-if="row.ownerCompNote" class="flag neutral">{{ row.ownerCompNote }}</span>
                  </div>
                  <div class="rank-track"><div :class="['rank-fill', row.overPace ? 'serious' : 'good']" :style="{ width: Math.min(100, (row.actual / row.budget) * 100) + '%' }"></div></div>
                  <div class="rank-value">${{ Math.round(Math.abs(row.overAmount)).toLocaleString() }}<span class="sub">{{ row.overPace ? 'over' : 'under' }} expected pace</span></div>
                </div>

                <button v-if="hasDetail(row.category)" type="button" class="detail-toggle" @click="toggleDetail(row.category)">
                  {{ expandedCategory === row.category ? '▾ Hide breakdown' : '▸ What’s driving it?' }}
                </button>

                <div v-if="expandedCategory === row.category && row.category === 'cogs'" class="detail-panel">
                  <div class="anomaly-grid" v-if="cogsDetailRows.length">
                    <div v-for="dr in cogsDetailRows" :key="dr.label" :class="['anomaly-tile', dr.direction]">
                      <div class="label">{{ dr.label }}</div>
                      <span :class="['delta-chip', dr.direction]">{{ dr.deltaText }}</span>
                      <div class="amount-caption">Total this {{ selectedPeriod }}</div>
                      <div class="amount">${{ Math.round(dr.amount).toLocaleString() }}</div>
                    </div>
                  </div>
                  <div v-else class="quiet-note">No single COGS subcategory stands out as the driver — costs are elevated broadly.</div>
                </div>

                <div v-if="expandedCategory === row.category && row.category === 'labor'" class="detail-panel">
                  <div class="anomaly-grid" v-if="laborDetailRows.length">
                    <div v-for="dr in laborDetailRows" :key="dr.label" :class="['anomaly-tile', dr.direction]">
                      <div class="label">{{ dr.label }}</div>
                      <span :class="['delta-chip', dr.direction]">{{ dr.deltaText }}</span>
                      <div class="amount-caption">Total this {{ selectedPeriod }}</div>
                      <div class="amount">${{ Math.round(dr.amount).toLocaleString() }}</div>
                    </div>
                  </div>
                  <div v-else class="quiet-note">No single labor subcategory stands out as the driver — costs are elevated broadly.</div>
                </div>

                <div v-if="expandedCategory === row.category && row.category === 'opex'" class="detail-panel">
                  <div v-if="opexFixedDetailRows.length" class="rank-group-head">
                    <span class="rank-group-label">Fixed<span class="rank-group-note">not controllable month to month — shown as totals only, never vs. pace</span></span>
                    <span class="rank-group-total">${{ Math.round(opexFixedDetailTotal).toLocaleString() }} &middot; {{ opexFixedDetailPct.toFixed(1) }}% of rev.</span>
                  </div>
                  <div class="anomaly-grid" v-if="opexFixedDetailRows.length">
                    <div v-for="fr in opexFixedDetailRows" :key="fr.label" class="anomaly-tile">
                      <div class="label">{{ fr.label }}</div>
                      <div class="amount-caption">Total this {{ selectedPeriod }}</div>
                      <div class="amount">${{ Math.round(fr.amount).toLocaleString() }}</div>
                    </div>
                  </div>

                  <div v-if="opexVariableDetailRows.length" class="rank-group-head">
                    <span class="rank-group-label">Variable / discretionary</span>
                  </div>
                  <div class="anomaly-grid" v-if="opexVariableDetailRows.length">
                    <div v-for="dr in opexVariableDetailRows" :key="dr.label" :class="['anomaly-tile', dr.direction]">
                      <div class="label">{{ dr.label }}</div>
                      <span :class="['delta-chip', dr.direction]">{{ dr.deltaText }}</span>
                      <div class="amount-caption">Total this {{ selectedPeriod }}</div>
                      <div class="amount">${{ Math.round(dr.amount).toLocaleString() }}</div>
                    </div>
                  </div>
                  <div v-if="!opexFixedDetailRows.length && !opexVariableDetailRows.length" class="quiet-note">No opex data synced for this {{ selectedPeriod }} yet.</div>
                  <div v-else-if="!opexVariableDetailRows.length" class="quiet-note">No single variable/discretionary subcategory stands out as the driver — costs are elevated broadly.</div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </section>
    </template>

    <div class="legend">
      <span class="chip good">On / ahead of budget</span>
      <span class="chip warning">Watch</span>
      <span class="chip serious">Off pace</span>
      <span class="chip critical">Over / under budget</span>
    </div>

    <footer>
      <span>Actuals: real data synced nightly from QuickBooks &middot; Budgets: real data imported from QuickBooks' budget export</span>
    </footer>
  </div>
</template>

<style scoped>
/* ---------- hero row (copied from index.vue for visual consistency) ---------- */
.hero-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-bottom: 1rem;
}
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
.hero-card .figure { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--ink); }
.hero-card .caption { font-size: 12px; color: var(--ink-3); }
.hero-card .caption.projection-line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }

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
/* margin-top clears room for .runway-expected::after's "today's target"
   label below, which sits 22px above this track's own top (-4px tick
   position + -18px label offset) — the .runway-card flex gap alone (10px)
   wasn't enough, so the label overlapped .runway-head's actual/budget text
   above. */
.runway-track { position: relative; height: 22px; margin-top: 14px; border-radius: 8px; background: var(--surface-alt); overflow: visible; }
.runway-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 8px; }
.runway-fill.good { background: var(--good); }
.runway-fill.warning { background: var(--warning); }
.runway-fill.serious { background: var(--serious); }
.runway-fill.critical { background: var(--critical); }
.runway-expected { position: absolute; top: -4px; width: 2px; height: 30px; background: var(--ink); opacity: 0.55; }
.runway-expected::after {
  content: "today's target"; position: absolute; top: -18px; left: 50%; transform: translateX(-50%);
  font-size: 9px; white-space: nowrap; color: var(--ink-3); font-weight: 600;
}
.runway-foot { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); }
.runway-card .section-note.projection-note { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; padding-top: 2px; border-top: 1px dashed var(--hair); }

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
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.drill-card .callout { font-size: 12.5px; color: var(--ink-2); background: var(--surface-alt); border-radius: 10px; padding: 10px 12px; line-height: 1.5; }
.rank-list { display: flex; flex-direction: column; gap: 12px; }
.rank-row { display: grid; grid-template-columns: 150px 1fr 130px; align-items: center; gap: 12px; }
.rank-row .label { font-size: 13px; font-weight: 600; }
.rank-row .label .flag { display: block; font-size: 11px; font-weight: 700; margin-top: 2px; }
.rank-row .label .flag.serious { color: var(--serious); }
.rank-row .label .flag.good { color: var(--good); }
.rank-row .label .flag.neutral { color: var(--ink-3); font-weight: 500; }
.rank-track { position: relative; height: 9px; border-radius: 5px; background: var(--surface-alt); }
.rank-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 5px; }
.rank-fill.serious { background: var(--serious); }
.rank-fill.good { background: var(--good); }
.rank-value { font-size: 13px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.rank-value .sub { display: block; font-size: 11px; font-weight: 500; color: var(--ink-3); }

/* ---------- materiality threshold form (moved from the old Drill-Downs page) ---------- */
.threshold-form {
  background: var(--surface-alt);
  border: 1px solid var(--ink-3);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.threshold-form-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
.threshold-form-label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.threshold-form-hint { display: block; font-size: 11px; font-weight: 500; color: var(--ink-3); margin-top: 2px; }
.threshold-form label {
  display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 600; color: var(--ink-3);
}
.threshold-form input[type="number"] {
  font-size: 13px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--hair);
  background: var(--surface); color: var(--ink); width: 110px;
}
.threshold-form button {
  font-size: 12px; font-weight: 700; padding: 7px 14px; border-radius: 100px; border: none;
  background: var(--accent); color: white; cursor: pointer;
}
.threshold-form button:disabled { opacity: 0.6; cursor: default; }

/* ---------- expandable "why" detail under a flagged Overspending row (moved from the old Drill-Downs page) ---------- */
.rank-item { display: flex; flex-direction: column; gap: 8px; }
.detail-toggle {
  align-self: flex-start;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--accent);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.detail-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--surface-alt); border-radius: 12px; }
.rank-group-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.rank-group-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}
.rank-group-label .rank-group-note {
  display: block;
  font-size: 10px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  margin-top: 2px;
}
.rank-group-total {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.anomaly-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}
.anomaly-tile {
  background: var(--surface);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
}
.anomaly-tile.up, .anomaly-tile.serious { background: color-mix(in srgb, var(--serious) 32%, var(--surface)); }
.anomaly-tile.down, .anomaly-tile.good { background: color-mix(in srgb, var(--good) 32%, var(--surface)); }
.anomaly-tile.critical { background: color-mix(in srgb, var(--critical) 38%, var(--surface)); }
.anomaly-tile .label { font-size: 11.5px; font-weight: 600; line-height: 1.3; color: var(--ink-2); }
.delta-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 800;
  padding: 3px 10px;
  border-radius: 100px;
  white-space: nowrap;
  background: var(--surface);
}
.anomaly-tile .amount-caption { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-3); margin-top: 2px; margin-bottom: -3px; }
.anomaly-tile .amount { font-size: 12px; font-weight: 600; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.delta-chip.up, .delta-chip.serious { color: var(--serious); background: var(--serious-wash); }
.delta-chip.down, .delta-chip.good { color: var(--good); background: var(--good-wash); }
.delta-chip.critical { color: var(--critical); background: var(--critical-wash); }

@media (max-width: 760px) {
  .meter-row { grid-template-columns: 1fr; }
  .rank-row { grid-template-columns: 100px 1fr 100px; }
}
</style>
