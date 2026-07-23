<script setup lang="ts">
import site from '~/config/site.json'
import { AS_OF_DAY, AS_OF_MONTH, CATEGORY_DIRECTION, CATEGORY_LABEL, YEAR, YEAR_DAY_FRACTION, categoryTotals, daysInMonth, netIncome, paceStatus, sampleActuals, useBudgetYear, useSyncStatus } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Budget Pace` })

const { lastSync, syncFailed } = useSyncStatus()
const { monthlyData, loadError } = useBudgetYear()

function categoryTotalsFor(monthNumbers: number[]) {
  return categoryTotals(monthlyData.value, monthNumbers)
}

const monthBudget = computed(() => categoryTotalsFor([AS_OF_MONTH]))
const yearBudget = computed(() => categoryTotalsFor(Array.from({ length: 12 }, (_, i) => i + 1)))

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
  : YEAR_DAY_FRACTION)
const periodActuals = computed(() => sampleActuals[selectedPeriod.value])
const periodBudget = computed(() => selectedPeriod.value === 'month' ? monthBudget.value : yearBudget.value)

// Net income the same formula the sample data on the other two pages
// already satisfies exactly — see netIncome() in useBudgetData.ts.
const actualNetIncome = computed(() => netIncome(periodActuals.value))
const budgetNetIncome = computed(() => netIncome(periodBudget.value.totals as any))

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
</script>

<template>
  <div>
    <header>
      <div>
        <h1>{{ site.restaurantName }} — Budget Pace</h1>
        <div class="sub">Are we going to earn enough to hit budget? &middot; {{ YEAR }}</div>
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
              <div v-if="selectedPeriod === 'year' && card.monthsBudgeted < 12" class="section-note">Only {{ card.monthsBudgeted }} of 12 months budgeted so far — edit them on the Edit Budget tab</div>
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

@media (max-width: 760px) {
  .meter-row { grid-template-columns: 1fr; }
  .rank-row { grid-template-columns: 100px 1fr 100px; }
}
</style>
