<script setup lang="ts">
import site from '~/config/site.json'
import { YEAR, useBudgetYear, useActualsYear, hybridYearTotalsPastActual, monthCategoryBudget, netIncome, currentAsOfMonth } from '~/composables/useBudgetData'
import { yearOutlook } from '~/utils/yearOutlook'
import { projectMonthRevenue, type NightlyProjectionSummary } from '~/utils/revenueProjection'

useHead({ title: `${site.restaurantName} — Cash Flow` })

type Payment = { loanKey: string, lender: string, date: string, type: 'catch_up' | 'regular', interest: number, principal: number, total: number }
type PeriodFigures = {
  debtService: { principal: number, interest: number, catchUpInterest: number, totalCashOut: number, payments: Payment[] }
  freeCashFlow: { hasData: boolean, netIncome: number, depreciation: number, actualLoanInterest: number, preOpeningNonCashAddBack: number, nonCashAdjustments: { label: string, amount: number }[], reserveTransfers: number, principal: number, catchUpInterest: number, reserveFundedPrincipal: number, reserveFundedCatchUpInterest: number, freeCashFlow: number, totals: Record<string, number> }
}
type ReserveTransfer = { id: number, date: string, amount: number, note: string | null }
type ReserveSustainability = {
  sustainYear: number
  totalDraws: number
  breakEvenWeeklyRate: number
  recommendedWeeklyRate: number
  bufferNeededForRecommendedRate: number
  projectedYearEndBalance: number | null
  surplusVsNeeded: number | null
  onTrack: boolean | null
  suggestedRemainderOfYearRate: number | null
  operatingCashFreedPerWeek: number | null
  operatingCashFreedTotal: number | null
}
type YearProjection = { principal: number, catchUpInterest: number, reserveFundedPrincipal: number, reserveFundedCatchUpInterest: number, depreciation: number, reserveTransfers: number, preOpeningNonCashAddBack: number, loanCashNeeded: number, remainingLoanCashNeeded: number, remainingSbaPrincipal: number, remainingTransfers: number, remainingTransferCount: number, minimumWeeklyTransfer: number | null, minimumDepositsBeforeCatchUp: number | null, yearEndBufferNeeded: number | null, weeksBeforeCatchUp: number | null, plannedRemainingTransfers: number, weeklyTransferAmount: number, breakevenNetIncome: number, giftCardCash: number, giftCardExpected: number, giftCardCushionPct: number, giftCardCushion: number }
type Covenant = {
  minimumRatio: number
  testYear: number
  debtScopeAssumption: string
  annualDebtService: { principal: number, interest: number, catchUpInterest: number, total: number }
  fullYearProjectionInputs: { loanInterestExpenseForYear: number, budgetedDepreciationForYear: number }
}
type CashFlowResponse = {
  year: number
  thisYear: PeriodFigures
  yearProjection: YearProjection
  covenant: Covenant
  covenantScoped: Covenant
  reserve: {
    target: number, saved: number, remaining: number, currentWeeklyAmount: number | null, complete: boolean
    catchUpDate: string | null, projectedBalanceAtCatchUp: number | null, onPaceForCatchUp: boolean | null, catchUpShortfall: number | null
    transfers: ReserveTransfer[]
    sustainability: ReserveSustainability | null
  }
  upcomingPayments: Payment[]
  catchUpDayPayments: Payment[]
}

const data = ref<CashFlowResponse | null>(null)
const loadError = ref<string | null>(null)
async function load() {
  loadError.value = null
  try {
    data.value = await $fetch<CashFlowResponse>('/api/cashflow', { query: { year: YEAR } })
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || err?.message || 'Failed to load cash flow data'
  }
}
onMounted(load)

// Projected full-year Net Income — real actuals for any already-closed,
// already-synced month, this month's and every future month's budget
// (hybridYearTotalsPastActual). Matches Edit Budget's Total tab exactly
// (app/pages/budget/edit.vue's yearDisplayNetIncome uses the same
// function), so a past month's stale/inaccurate budget doesn't get carried
// into "will we cover the loans this year" once the real number is known —
// same reasoning, and same user request (2026-09-24), as that page's Total
// tab. Deliberately NOT hybridYearTotals (the budget-first version Budget
// Pace's year view and this page's own debt-service targets still use) —
// this is a "what will actually happen" projection, not a pacing target.
const { monthlyData: budgetMonthlyData } = useBudgetYear()
const { monthlyActuals } = useActualsYear()
const baselineYearTotals = computed(() => {
  if (!budgetMonthlyData.value.length) return null
  return hybridYearTotalsPastActual(
    (m, cat) => monthCategoryBudget(budgetMonthlyData.value[m - 1], cat),
    monthlyActuals.value,
    currentAsOfMonth()
  )
})
const projectedNetIncomeForYear = computed<number | null>(() => baselineYearTotals.value ? netIncome(baselineYearTotals.value) : null)

// ---- Year-end outlook (2026-11-05) -----------------------------------------
// Three scenarios for full-year Net Income (budget / recent pace / recent pace with this
// month's night-by-night revenue). The math is in app/utils/yearOutlook.ts. The current
// month's revenue comes from the same projection the Revenue tab uses.
const outlookNightly = ref<NightlyProjectionSummary | null>(null)
const outlookMonthActuals = ref<Record<number, number>>({})
async function loadOutlookInputs() {
  try {
    const month = currentAsOfMonth()
    const [nightly, actuals] = await Promise.all([
      $fetch<NightlyProjectionSummary>('/api/revenue-projection', { query: { year: YEAR, month } }),
      $fetch<{ accounts: { accountId: number, amount: number }[] }>('/api/budget/actuals-by-account', { query: { year: YEAR, month } })
    ])
    const map: Record<number, number> = {}
    for (const a of actuals.accounts) map[a.accountId] = a.amount
    outlookNightly.value = nightly
    outlookMonthActuals.value = map
  } catch {
    outlookNightly.value = null
    outlookMonthActuals.value = {}
  }
}
onMounted(loadOutlookInputs)
const outlook = computed(() => {
  const baseline = baselineYearTotals.value
  if (!baseline) return null
  const asOfMonth = currentAsOfMonth()
  const currentMonthRevenueProjection = projectMonthRevenue(
    budgetMonthlyData.value[asOfMonth - 1]?.accounts ?? [],
    id => outlookMonthActuals.value[id] ?? 0,
    outlookNightly.value
  )
  return yearOutlook({
    asOfMonth,
    monthBudget: (m, cat) => monthCategoryBudget(budgetMonthlyData.value[m - 1], cat),
    monthlyActuals: monthlyActuals.value,
    baselineTotals: baseline,
    currentMonthRevenueProjection
  })
})
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const outlookMonthsLabel = computed(() => {
  const used = outlook.value?.monthsUsed ?? []
  return used.length ? used.map(m => MONTH_ABBR[m - 1]).join(', ') : ''
})
function pctOfBudget(ratio: number) {
  return `${Math.round(ratio * 100)}%`
}
const projectedFreeCashFlowForYear = computed<number | null>(() => {
  if (projectedNetIncomeForYear.value === null || !data.value) return null
  return projectedNetIncomeForYear.value - data.value.yearProjection.breakevenNetIncome
})

// Gift card cash is cash in without revenue (a liability until redeemed),
// so it counts toward covering the loans but never toward Net Income.
// Net Income needed once expected gift card cash is counted as a source of
// cash: drives the "Profit needed" card and the pace chip.
const breakevenNetIncomeAfterGiftCards = computed<number | null>(() => {
  if (!data.value) return null
  return data.value.yearProjection.breakevenNetIncome - data.value.yearProjection.giftCardCash
})
const projectedFreeCashFlowWithGiftCards = computed<number | null>(() => {
  if (projectedFreeCashFlowForYear.value === null || !data.value) return null
  return projectedFreeCashFlowForYear.value + data.value.yearProjection.giftCardCash
})

// ---- Eastern Bank DSCR covenant (informational only) -------------------
// EBITDA = projected full-year Net Income (the same actual-for-elapsed-
// months + budget-for-the-rest projection used above) + the year's loan
// interest expense on the P&L (account 7020, projected the same way) +
// budgeted Depreciation for the year — a standard EBITDA. See
// server/api/cashflow.get.ts's loanInterestExpenseForYear.
// Deliberately NOT adjusted for the pre-opening reclass entries (see the
// Free Cash Flow breakdown above) — the user's own call 2026-09-28, since
// EBITDA's own definition (Interest/Depreciation/Amortization only)
// doesn't add those back automatically and Eastern Bank hasn't agreed to
// treat them as non-recurring, so a reclass-adjusted ratio isn't relevant
// to what the bank will actually see.
const projectedEbitdaScoped = computed<number | null>(() => {
  if (projectedNetIncomeForYear.value === null || !data.value) return null
  const { loanInterestExpenseForYear, budgetedDepreciationForYear } = data.value.covenantScoped.fullYearProjectionInputs
  return projectedNetIncomeForYear.value + loanInterestExpenseForYear + budgetedDepreciationForYear
})
const dscrScoped = computed<number | null>(() => {
  if (projectedEbitdaScoped.value === null || !data.value) return null
  const denom = data.value.covenantScoped.annualDebtService.total
  return denom > 0 ? projectedEbitdaScoped.value / denom : null
})
function fmtRatio(n: number) {
  return `${n.toFixed(2)}x`
}

function fmt(n: number) {
  return `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

const reservePct = computed(() => data.value ? Math.min(100, (data.value.reserve.saved / data.value.reserve.target) * 100) : 0)

// ---- Record a transfer -------------------------------------------------
function todayIso() { return new Date().toISOString().slice(0, 10) }
const transferForm = ref({ date: todayIso(), amount: null as number | null, note: '', isReversal: false })
const transferSubmitting = ref(false)
const transferError = ref<string | null>(null)
const showTransferHistory = ref(false)

async function submitTransfer() {
  transferError.value = null
  const rawAmount = transferForm.value.amount
  if (rawAmount === null || !Number.isFinite(rawAmount) || rawAmount === 0) {
    transferError.value = 'Enter a non-zero amount'
    return
  }
  const amount = transferForm.value.isReversal ? -Math.abs(rawAmount) : Math.abs(rawAmount)
  transferSubmitting.value = true
  try {
    await $fetch('/api/cashflow/reserve-transfer', {
      method: 'POST',
      body: { date: transferForm.value.date, amount, note: transferForm.value.note || undefined }
    })
    transferForm.value = { date: todayIso(), amount: null, note: '', isReversal: false }
    await load()
  } catch (err: any) {
    transferError.value = err?.data?.statusMessage || err?.message || 'Failed to record transfer'
  } finally {
    transferSubmitting.value = false
  }
}

async function deleteTransfer(t: ReserveTransfer) {
  if (!confirm(`Delete the ${fmtDate(t.date)} transfer of ${fmt(t.amount)}?`)) return
  transferError.value = null
  try {
    await $fetch('/api/cashflow/reserve-transfer', { method: 'DELETE', query: { id: t.id } })
    await load()
  } catch (err: any) {
    transferError.value = err?.data?.statusMessage || err?.message || 'Failed to delete transfer'
  }
}

const catchUpDayTotals = computed(() => {
  const rows = data.value?.catchUpDayPayments ?? []
  return {
    interest: rows.reduce((t, p) => t + p.interest, 0),
    principal: rows.reduce((t, p) => t + p.principal, 0),
    total: rows.reduce((t, p) => t + p.total, 0)
  }
})

// ---- Gift card cash expected before year end ----------------------------
const giftCardAmount = ref<number | null>(null)
const giftCardCushionPct = ref<number | null>(null)
watch(() => data.value?.yearProjection.giftCardExpected ?? null, (v) => { if (giftCardAmount.value === null) giftCardAmount.value = v }, { immediate: true })
watch(() => data.value?.yearProjection.giftCardCushionPct ?? null, (v) => { if (giftCardCushionPct.value === null) giftCardCushionPct.value = v }, { immediate: true })
const giftCardSubmitting = ref(false)
const giftCardError = ref<string | null>(null)
const giftCardSaved = ref(false)

async function submitGiftCard() {
  giftCardError.value = null
  giftCardSaved.value = false
  if (giftCardAmount.value === null || !Number.isFinite(giftCardAmount.value) || giftCardAmount.value < 0) {
    giftCardError.value = 'Enter an amount of 0 or more'
    return
  }
  if (giftCardCushionPct.value === null || !Number.isFinite(giftCardCushionPct.value) || giftCardCushionPct.value < 0 || giftCardCushionPct.value > 100) {
    giftCardError.value = 'Enter a cushion from 0 to 100%'
    return
  }
  giftCardSubmitting.value = true
  try {
    await $fetch('/api/cashflow/gift-card-plan', { method: 'POST', body: { expectedCash: giftCardAmount.value, cushionPct: giftCardCushionPct.value } })
    giftCardSaved.value = true
    await load()
  } catch (err: any) {
    giftCardError.value = err?.data?.statusMessage || err?.message || 'Failed to save'
  } finally {
    giftCardSubmitting.value = false
  }
}

// ---- Set planned weekly amount -----------------------------------------
const planAmount = ref<number | null>(null)
watch(() => data.value?.reserve.currentWeeklyAmount ?? null, (v) => { if (planAmount.value === null) planAmount.value = v }, { immediate: true })
const planSubmitting = ref(false)
const planError = ref<string | null>(null)
const planSaved = ref(false)

async function submitPlan() {
  planError.value = null
  planSaved.value = false
  if (planAmount.value === null || !Number.isFinite(planAmount.value) || planAmount.value <= 0) {
    planError.value = 'Enter a positive weekly amount'
    return
  }
  planSubmitting.value = true
  try {
    await $fetch('/api/cashflow/reserve-plan', { method: 'POST', body: { weeklyAmount: planAmount.value } })
    planSaved.value = true
    await load()
  } catch (err: any) {
    planError.value = err?.data?.statusMessage || err?.message || 'Failed to save plan'
  } finally {
    planSubmitting.value = false
  }
}
</script>

<template>
  <div>
    <header>
      <div>
        <h1>Cash Flow</h1>
        <div class="sub">Are we covering total debt service — principal included, not just interest?</div>
      </div>
    </header>

    <div v-if="loadError" class="drill-card">
      <span class="chip critical">Couldn't load cash flow data</span>
      <span class="quiet-note">{{ loadError }}</span>
    </div>

    <template v-else-if="data">
      <section>
        <div class="section-head">
          <div class="section-label">Free Cash Flow</div>
        </div>

        <div class="hero-row">
          <div class="hero-card anchor">
            <div class="hero-top">
              <span class="period">{{ YEAR }} year-to-date</span>
              <span :class="['chip', data.thisYear.freeCashFlow.freeCashFlow >= 0 ? 'good' : 'critical']">
                {{ data.thisYear.freeCashFlow.freeCashFlow >= 0 ? 'Positive' : 'Negative' }}
              </span>
            </div>
            <div class="figure">{{ fmt(data.thisYear.freeCashFlow.freeCashFlow) }}</div>
            <div class="caption">Net Income + Depreciation − direct SBA principal − Reserve transfers</div>
            <div v-if="!data.thisYear.freeCashFlow.hasData" class="caption">No synced actuals for this period yet — Net Income is $0 below.</div>
          </div>
        </div>

        <div class="fcf-breakdown">
          <div class="fcf-row"><span>Net Income (from QBO P&amp;L)</span><span>{{ fmt(data.thisYear.freeCashFlow.netIncome) }}</span></div>
          <div class="fcf-row"><span>+ Depreciation (non-cash add-back)</span><span>{{ fmt(data.thisYear.freeCashFlow.depreciation) }}</span></div>
          <div v-for="adj in data.thisYear.freeCashFlow.nonCashAdjustments.filter(a => a.amount !== 0)" :key="adj.label" class="fcf-row"><span>+ {{ adj.label }} (non-cash add-back)</span><span>{{ fmt(adj.amount) }}</span></div>
          <div class="fcf-row"><span>− SBA principal paid directly from operating cash (through Oct 12; from Nov it runs through the reserve)</span><span>{{ fmt(-data.thisYear.freeCashFlow.principal) }}</span></div>
          <div class="fcf-row"><span>− Loan reserve transfers</span><span>{{ fmt(-data.thisYear.freeCashFlow.reserveTransfers) }}</span></div>
          <div class="fcf-row total"><span>= Free Cash Flow</span><span>{{ fmt(data.thisYear.freeCashFlow.freeCashFlow) }}</span></div>
        </div>
        <div class="section-note">
          The other 9 loans' principal ({{ fmt(data.thisYear.freeCashFlow.reserveFundedPrincipal) }}) and catch-up interest ({{ fmt(data.thisYear.freeCashFlow.reserveFundedCatchUpInterest) }}) are paid out of the loan reserve account, not directly from operating cash — as are the SBA payments from Nov 12 on — already covered by the reserve transfers above, so they aren't subtracted a second time.
        </div>
        <div v-if="data.thisYear.freeCashFlow.preOpeningNonCashAddBack !== 0" class="section-note">
          Includes a total {{ fmt(data.thisYear.freeCashFlow.preOpeningNonCashAddBack) }} add-back for pre-opening reclassification/catch-up entries booked well after the fact ({{ data.thisYear.freeCashFlow.nonCashAdjustments.filter(a => a.amount !== 0).map(a => `${a.label}: ${fmt(a.amount)}`).join('; ') }}) — real P&amp;L expenses, but not current-period cash: that spending was already paid out of loan proceeds before the restaurant opened at its current location, well before this reserve-tracking period began, so it's excluded here to avoid counting the same cash outflow twice.
        </div>
      </section>

      <!-- Year-end projection — how much profit is needed to actually
           service the loans (not just interest, which is already inside Net
           Income) vs. how much profit the year is on track for: real
           actuals for already-elapsed months, budget for the rest. -->
      <section v-if="data.yearProjection">
        <div class="section-head">
          <div class="section-label">Year-End Projection</div>
          <div class="section-note">{{ YEAR }} full year</div>
        </div>
        <div class="hero-row three-up">
          <div class="hero-card">
            <div class="hero-top">
              <span class="period">Cash still needed for the loans</span>
            </div>
            <div class="figure">{{ fmt(data.yearProjection.remainingLoanCashNeeded) }}</div>
            <div class="caption">Going forward only, through Dec 31: the least the loan reserve still needs ({{ fmt(data.yearProjection.remainingTransfers) }}<template v-if="data.yearProjection.minimumDepositsBeforeCatchUp !== null">: {{ fmt(data.yearProjection.minimumDepositsBeforeCatchUp) }} to cover every payment through Dec 20<template v-if="data.yearProjection.minimumWeeklyTransfer !== null"> (about {{ fmt(data.yearProjection.minimumWeeklyTransfer) }}/week over the {{ data.yearProjection.weeksBeforeCatchUp }} Mondays before it)</template>, plus {{ fmt(data.yearProjection.yearEndBufferNeeded ?? 0) }} to start {{ YEAR + 1 }} with a safe buffer</template>) <template v-if="data.yearProjection.remainingSbaPrincipal > 0">plus SBA principal still paid directly ({{ fmt(data.yearProjection.remainingSbaPrincipal) }}, the Oct 12 payment). </template>This includes the SBA payments from Nov 12 on, which now run through the reserve. Falls as you transfer ahead of schedule. Your {{ fmt(data.yearProjection.weeklyTransferAmount) }}/week plan would move {{ fmt(data.yearProjection.plannedRemainingTransfers) }}. Cash already paid this year isn't counted. Interest is already inside Net Income.</div>
          </div>
          <div class="hero-card">
            <div class="hero-top">
              <span class="period">Profit needed to cover the loans</span>
            </div>
            <div class="figure">{{ fmt(breakevenNetIncomeAfterGiftCards ?? data.yearProjection.breakevenNetIncome) }}</div>
            <div class="caption">Net Income needed for full-year Free Cash Flow to hit $0: the full year's loan cash outside the P&amp;L ({{ fmt(data.yearProjection.loanCashNeeded) }}, already paid plus still to come), less the non-cash expenses already inside Net Income ({{ fmt(data.yearProjection.preOpeningNonCashAddBack + data.yearProjection.depreciation) }} of pre-opening reclass entries and depreciation)<template v-if="data.yearProjection.giftCardCash > 0">, and less {{ fmt(data.yearProjection.giftCardCash) }} of expected gift card cash (cash in without revenue<template v-if="data.yearProjection.giftCardCushion > 0">, after holding back {{ data.yearProjection.giftCardCushionPct }}% as a cushion</template>)</template>.</div>
          </div>
          <div class="hero-card">
            <div class="hero-top">
              <span class="period">Profit projected this year</span>
              <span v-if="projectedNetIncomeForYear !== null" :class="['chip', projectedNetIncomeForYear >= (breakevenNetIncomeAfterGiftCards ?? data.yearProjection.breakevenNetIncome) ? 'good' : 'critical']">
                {{ projectedNetIncomeForYear >= (breakevenNetIncomeAfterGiftCards ?? data.yearProjection.breakevenNetIncome) ? 'On pace to cover it' : 'Short of covering it' }}
              </span>
            </div>
            <div class="figure">{{ projectedNetIncomeForYear !== null ? fmt(projectedNetIncomeForYear) : '—' }}</div>
            <div class="caption">Real actuals for already-elapsed, already-synced months; this month's and every future month's budget.</div>
          </div>
        </div>
        <div v-if="projectedFreeCashFlowForYear !== null" class="section-note">
          Projected year-end Free Cash Flow: <strong>{{ fmt(projectedFreeCashFlowForYear) }}</strong>
          <template v-if="data.yearProjection.giftCardCash > 0 && projectedFreeCashFlowWithGiftCards !== null">
            — <strong>{{ fmt(projectedFreeCashFlowWithGiftCards) }}</strong> including {{ fmt(data.yearProjection.giftCardCash) }} of gift card cash<template v-if="data.yearProjection.giftCardCushion > 0"> ({{ fmt(data.yearProjection.giftCardCushion) }} held back as a {{ YEAR + 1 }} cushion)</template>
          </template>
        </div>
        <div v-if="outlook" class="outlook">
          <div class="outlook-head">
            <span class="chip accent">Year-end outlook</span>
            <span class="quiet-note">Where the year could land if the rest of it runs like the last few months did against budget. The budget scenario above is the plan; these two show how much it moves.</span>
          </div>
          <div class="pl-table-card">
            <table class="pl-table outlook-table">
              <caption>Year-end revenue and Net Income by scenario</caption>
              <thead>
                <tr>
                  <th scope="col" class="text-cell">Scenario</th>
                  <th scope="col">Revenue</th>
                  <th scope="col">Net Income</th>
                  <th scope="col">vs. profit needed</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sc in outlook.scenarios" :key="sc.key">
                  <th scope="row" class="text-cell">{{ sc.label }}</th>
                  <td class="amount">{{ fmt(sc.totals.revenue) }}</td>
                  <td class="amount">{{ fmt(sc.netIncome) }}</td>
                  <td class="amount">
                    <template v-if="breakevenNetIncomeAfterGiftCards !== null">
                      <span :class="['chip', sc.netIncome >= breakevenNetIncomeAfterGiftCards ? 'good' : 'critical']">
                        {{ sc.netIncome >= breakevenNetIncomeAfterGiftCards ? '✓ ' : '▲ short ' }}{{ fmt(Math.abs(sc.netIncome - breakevenNetIncomeAfterGiftCards)) }}{{ sc.netIncome >= breakevenNetIncomeAfterGiftCards ? ' above' : '' }}
                      </span>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="quiet-note small">
            Pace is based on {{ outlookMonthsLabel }} (closed months since the Cambridge St opening settled; earlier months are left out). Against budget those months ran
            revenue {{ pctOfBudget(outlook.ratios.revenue) }}, COGS {{ pctOfBudget(outlook.ratios.cogs) }}, labor {{ pctOfBudget(outlook.ratios.labor) }}, operating expenses {{ pctOfBudget(outlook.ratios.opex) }}.
            Those ratios are applied to the current month and December. Other income and other expense (one-time items) stay at budget in every scenario, and so does everything already closed (real actuals).
            <template v-if="!outlook.scenarios.some(s => s.key === 'paceSpecials')">The night-by-night row needs the current month's revenue projection, which isn't available yet.</template>
            Three months is a thin sample, so treat the pace row as a rough guide, not a forecast.
          </div>
        </div>

        <form class="transfer-form plan-form" @submit.prevent="submitGiftCard">
          <div class="transfer-form-row">
            <label>Gift card cash still expected before Dec 31<input type="number" step="0.01" min="0" v-model.number="giftCardAmount" required /></label>
            <label>Hold back as {{ YEAR + 1 }} cushion (%)<input type="number" step="1" min="0" max="100" v-model.number="giftCardCushionPct" required /></label>
            <button type="submit" :disabled="giftCardSubmitting">{{ giftCardSubmitting ? 'Saving…' : 'Update' }}</button>
            <span v-if="giftCardError" class="chip critical">{{ giftCardError }}</span>
            <span v-else-if="giftCardSaved" class="chip good">Saved</span>
          </div>
          <div class="section-note">Gift card sales are cash in the bank but not revenue, so they don't touch Net Income or the covenant. This is a timing benefit: when the cards are redeemed (mostly {{ YEAR + 1 }}), that revenue arrives with no new cash, so don't count on it for the {{ YEAR + 1 }} reserve plan. The cushion % is the share set aside for that: only the rest counts toward covering this year's loans<template v-if="giftCardAmount && giftCardCushionPct !== null"> ({{ fmt(giftCardAmount * (1 - giftCardCushionPct / 100)) }} counted, {{ fmt(giftCardAmount * giftCardCushionPct / 100) }} held back at the values above)</template>.</div>
        </form>
      </section>

      <!-- Eastern Bank's Debt Service Coverage Ratio covenant (Loan
           Agreement §5.24) — informational tracking only, not a live
           covenant test. First tested at FY{{ data.covenantScoped.testYear }}
           year-end, not quarterly, despite Eastern Bank's periodic
           financial requests. Scoped to the SBA + 5 original investor
           loans only (the all-10-loans version was removed 2026-10-26). -->
      <section v-if="data.covenantScoped">
        <div class="section-head">
          <div class="section-label">Debt Service Coverage Ratio (SBA + 5 investor loans)</div>
          <div class="section-note">{{ data.covenantScoped.minimumRatio.toFixed(2) }}x minimum, first tested at FY{{ data.covenantScoped.testYear }} year-end</div>
        </div>
        <div class="hero-row">
          <div class="hero-card">
            <div class="hero-top">
              <span class="period">Projected FY{{ data.covenantScoped.testYear }} DSCR</span>
              <span v-if="dscrScoped !== null" :class="['chip', dscrScoped >= data.covenantScoped.minimumRatio ? 'good' : 'critical']">
                {{ dscrScoped >= data.covenantScoped.minimumRatio ? 'Meets covenant' : 'Below covenant' }}
              </span>
            </div>
            <div class="figure">{{ dscrScoped !== null ? fmtRatio(dscrScoped) : '—' }}</div>
            <div class="caption">EBITDA ÷ annual principal + interest on the SBA, Chen, Savage, Schaefer, Gilreath, and Mis loans only.</div>
          </div>
        </div>
        <div class="fcf-breakdown">
          <div class="fcf-row"><span>Net Income (projected, full year)</span><span>{{ projectedNetIncomeForYear !== null ? fmt(projectedNetIncomeForYear) : '—' }}</span></div>
          <div class="fcf-row"><span>+ Loan interest expense (account 7020, full year)</span><span>{{ fmt(data.covenantScoped.fullYearProjectionInputs.loanInterestExpenseForYear) }}</span></div>
          <div class="fcf-row"><span>+ Depreciation (budgeted, full year)</span><span>{{ fmt(data.covenantScoped.fullYearProjectionInputs.budgetedDepreciationForYear) }}</span></div>
          <div class="fcf-row total"><span>= EBITDA</span><span>{{ projectedEbitdaScoped !== null ? fmt(projectedEbitdaScoped) : '—' }}</span></div>
          <div class="fcf-row"><span>Annual debt service (principal + interest + catch-up)</span><span>{{ fmt(data.covenantScoped.annualDebtService.total) }}</span></div>
        </div>
        <div class="section-note">
          {{ data.covenantScoped.debtScopeAssumption }}
        </div>
      </section>

      <!-- P&L view vs Cash Flow view, per the source brief's Section 7 -->
      <section>
        <div class="section-head">
          <div class="section-label">P&amp;L View vs. Cash Paid to Date</div>
          <div class="section-note">{{ YEAR }} year-to-date</div>
        </div>
        <div class="cf-table-card">
          <table class="cf-table">
            <thead>
              <tr><th></th><th>P&amp;L View</th><th>Cash Paid to Date</th></tr>
            </thead>
            <tbody>
              <tr>
                <th>Loan interest</th>
                <td>{{ fmt(data.thisYear.freeCashFlow.actualLoanInterest) }} (acct 7020, actual)</td>
                <td>{{ fmt(data.thisYear.debtService.interest) }} (per amortization schedule)</td>
              </tr>
              <tr>
                <th>Principal</th>
                <td>—</td>
                <td>{{ fmt(data.thisYear.debtService.principal) }}</td>
              </tr>
              <tr>
                <th>Catch-up interest</th>
                <td>—</td>
                <td>{{ data.thisYear.debtService.catchUpInterest > 0 ? fmt(data.thisYear.debtService.catchUpInterest) + ' (one-time)' : '—' }}</td>
              </tr>
              <tr>
                <th>Reserve transfers</th>
                <td>—</td>
                <td>{{ data.thisYear.freeCashFlow.reserveTransfers > 0 ? fmt(data.thisYear.freeCashFlow.reserveTransfers) : '—' }}</td>
              </tr>
              <tr class="total">
                <th>Bottom line</th>
                <td>Net Income: {{ fmt(data.thisYear.freeCashFlow.netIncome) }}</td>
                <td>Free Cash Flow: {{ fmt(data.thisYear.freeCashFlow.freeCashFlow) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="section-note">
          Only loan interest ever shows up on the P&amp;L — principal, the one-time catch-up interest, and reserve transfers don't, since none of those are P&amp;L expenses. Acct 7020's own actual can also differ from the amortization schedule's interest figure shown here — it may include interest from debt outside these 10 loans (e.g. from before this move). Principal and catch-up interest above are totals across all 10 loans; the Bottom line only subtracts SBA's share directly — the other 9 loans' share is paid from the reserve account and already covered by the reserve transfers row.
        </div>
      </section>

      <!-- Debt service payment calendar -->
      <section>
        <div class="section-head">
          <div class="section-label">Upcoming Debt Service Payments</div>
          <div class="section-note">Next 45 days</div>
        </div>
        <div class="cf-table-card">
          <table class="cf-table upcoming">
            <thead>
              <tr><th>Date</th><th>Payee</th><th>Interest</th><th>Principal</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in data.upcomingPayments" :key="p.loanKey + p.date + p.type">
                <td>{{ fmtDate(p.date) }}</td>
                <td>{{ p.lender }}<span v-if="p.type === 'catch_up'" class="flag serious">catch-up</span></td>
                <td>{{ fmt(p.interest) }}</td>
                <td>{{ fmt(p.principal) }}</td>
                <td>{{ fmt(p.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Everything due on the catch-up date -->
      <section v-if="data.catchUpDayPayments.length">
        <div class="section-head">
          <div class="section-label">All Payments Due {{ fmtDate(data.catchUpDayPayments[0]!.date) }}</div>
        </div>
        <div class="cf-table-card">
          <table class="cf-table upcoming">
            <thead>
              <tr><th>Date</th><th>Payee</th><th>Interest</th><th>Principal</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in data.catchUpDayPayments" :key="p.loanKey + p.date + p.type">
                <td>{{ fmtDate(p.date) }}</td>
                <td>{{ p.lender }}<span v-if="p.type === 'catch_up'" class="flag serious">catch-up</span></td>
                <td>{{ fmt(p.interest) }}</td>
                <td>{{ fmt(p.principal) }}</td>
                <td>{{ fmt(p.total) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2"><strong>Grand total</strong></td>
                <td><strong>{{ fmt(catchUpDayTotals.interest) }}</strong></td>
                <td><strong>{{ fmt(catchUpDayTotals.principal) }}</strong></td>
                <td><strong>{{ fmt(catchUpDayTotals.total) }}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- Loan reserve savings plan -->
      <section>
        <div class="section-head">
          <div class="section-label">Loan Reserve Savings Plan</div>
          <div class="section-note">Real transfers only — no bank feed, so this is only as current as what's recorded below</div>
        </div>
        <div class="drill-card">
          <div class="runway-head">
            <span class="name">Reserve (QBO: 1005 Loan Payment Reserve)</span>
            <span class="nums">{{ fmt(data.reserve.saved) }} saved of {{ fmt(data.reserve.target) }} target</span>
          </div>
          <div class="runway-track">
            <div :class="['runway-fill', reservePct >= 100 ? 'good' : 'warning']" :style="{ width: reservePct + '%' }"></div>
          </div>
          <div class="runway-foot">
            <span v-if="data.reserve.complete" class="chip good">Target reached</span>
            <span v-else>{{ fmt(data.reserve.remaining) }} remaining</span>
            <span v-if="data.reserve.currentWeeklyAmount">Current pace: {{ fmt(data.reserve.currentWeeklyAmount) }}/week</span>
          </div>

          <div v-if="data.reserve.catchUpDate && data.reserve.projectedBalanceAtCatchUp !== null" class="catchup-projection">
            <div class="runway-head">
              <span class="name">Projected balance on {{ fmtDate(data.reserve.catchUpDate) }}</span>
              <span :class="['chip', data.reserve.onPaceForCatchUp ? 'good' : 'critical']">
                {{ data.reserve.onPaceForCatchUp ? 'On pace' : 'Behind pace' }}
              </span>
            </div>
            <div class="section-note">
              Simulated from real transfers + the current planned weekly amount, minus Jones &amp; Miller's catch-up and every monthly payment due from this account before then.
              Projected: <strong>{{ fmt(data.reserve.projectedBalanceAtCatchUp) }}</strong> vs. the {{ fmt(data.reserve.target) }} needed.
              <template v-if="!data.reserve.onPaceForCatchUp && data.reserve.catchUpShortfall">
                Short by <strong>{{ fmt(data.reserve.catchUpShortfall) }}</strong> at the current pace.
              </template>
            </div>
          </div>

          <div v-if="data.reserve.sustainability" class="catchup-projection">
            <div class="runway-head">
              <span class="name">Sustaining {{ data.reserve.sustainability.sustainYear }}'s ongoing payments</span>
              <span v-if="data.reserve.sustainability.onTrack !== null" :class="['chip', data.reserve.sustainability.onTrack ? 'good' : 'critical']">
                {{ data.reserve.sustainability.onTrack ? 'On track' : 'Behind' }}
              </span>
            </div>
            <div class="section-note">
              Once the {{ fmtDate(data.reserve.catchUpDate!) }} catch-up clears, every reserve-funded loan is in ordinary
              monthly-payment mode — {{ fmt(data.reserve.sustainability.totalDraws) }} scheduled to draw from this account
              across {{ data.reserve.sustainability.sustainYear }}. Break-even is {{ fmt(data.reserve.sustainability.breakEvenWeeklyRate) }}/week;
              a safer, rounder pace is <strong>{{ fmt(data.reserve.sustainability.recommendedWeeklyRate) }}/week</strong>,
              which needs about {{ fmt(data.reserve.sustainability.bufferNeededForRecommendedRate) }} already banked by
              Jan 1 to never dip negative.
              <template v-if="data.reserve.sustainability.projectedYearEndBalance !== null">
                At the current pace, you're on track to carry <strong>{{ fmt(data.reserve.sustainability.projectedYearEndBalance) }}</strong>
                into {{ data.reserve.sustainability.sustainYear }}<template v-if="data.reserve.sustainability.surplusVsNeeded !== null && data.reserve.sustainability.surplusVsNeeded >= 0"> — {{ fmt(data.reserve.sustainability.surplusVsNeeded) }} more than that needs.</template><template v-else-if="data.reserve.sustainability.surplusVsNeeded !== null"> — {{ fmt(Math.abs(data.reserve.sustainability.surplusVsNeeded)) }} short of what that needs.</template>
              </template>
              <template v-if="data.reserve.sustainability.suggestedRemainderOfYearRate !== null && data.reserve.currentWeeklyAmount">
                <template v-if="data.reserve.sustainability.operatingCashFreedPerWeek !== null && data.reserve.sustainability.operatingCashFreedPerWeek > 0">
                  The current {{ fmt(data.reserve.currentWeeklyAmount) }}/week is overshooting what {{ data.reserve.sustainability.sustainYear }} needs —
                  as little as <strong>{{ fmt(data.reserve.sustainability.suggestedRemainderOfYearRate) }}/week</strong> for the
                  rest of {{ data.reserve.catchUpDate!.slice(0, 4) }} would still get there safely, freeing roughly
                  <strong>{{ fmt(data.reserve.sustainability.operatingCashFreedTotal!) }}</strong> of operating cash between now and year end.
                </template>
                <template v-else-if="data.reserve.sustainability.operatingCashFreedPerWeek !== null && Math.round(data.reserve.currentWeeklyAmount) >= Math.round(data.reserve.sustainability.suggestedRemainderOfYearRate)">
                  The current {{ fmt(data.reserve.currentWeeklyAmount) }}/week is enough — it's right at the
                  <strong>{{ fmt(data.reserve.sustainability.suggestedRemainderOfYearRate) }}/week</strong> needed for the rest of
                  {{ data.reserve.catchUpDate!.slice(0, 4) }} to be {{ data.reserve.sustainability.sustainYear }}-ready.
                </template>
                <template v-else-if="data.reserve.sustainability.operatingCashFreedPerWeek !== null">
                  The current {{ fmt(data.reserve.currentWeeklyAmount) }}/week isn't quite enough — at least
                  <strong>{{ fmt(data.reserve.sustainability.suggestedRemainderOfYearRate) }}/week</strong> for the rest of
                  {{ data.reserve.catchUpDate!.slice(0, 4) }} is needed to be {{ data.reserve.sustainability.sustainYear }}-ready.
                </template>
              </template>
            </div>
          </div>

          <div class="transfer-history">
            <span class="toggle-link" @click="showTransferHistory = !showTransferHistory">
              {{ showTransferHistory ? 'Hide' : 'Show' }} {{ data.reserve.transfers.length }} recorded transfer{{ data.reserve.transfers.length === 1 ? '' : 's' }}
            </span>
            <table v-if="showTransferHistory" class="cf-table transfers">
              <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(t, i) in data.reserve.transfers" :key="i">
                  <td>{{ fmtDate(t.date) }}</td>
                  <td :class="t.amount < 0 ? 'negative' : ''">{{ fmt(t.amount) }}</td>
                  <td class="note">{{ t.note || '—' }}</td>
                  <td class="delete-cell">
                    <button v-if="i === data.reserve.transfers.length - 1" type="button" class="delete-link" @click="deleteTransfer(t)">Delete</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="transfer-form" @submit.prevent="submitTransfer">
            <div class="transfer-form-row">
              <label>Date<input type="date" v-model="transferForm.date" required /></label>
              <label>Amount<input type="number" step="0.01" min="0.01" v-model.number="transferForm.amount" :placeholder="(data.reserve.currentWeeklyAmount ?? 0).toFixed(2)" required /></label>
              <label class="reversal"><input type="checkbox" v-model="transferForm.isReversal" /> Reversal / withdrawal</label>
            </div>
            <input type="text" v-model="transferForm.note" placeholder="Note (optional)" class="transfer-note" />
            <div class="transfer-form-row">
              <button type="submit" :disabled="transferSubmitting">{{ transferSubmitting ? 'Recording…' : 'Record transfer' }}</button>
              <span v-if="transferError" class="chip critical">{{ transferError }}</span>
            </div>
          </form>

          <form class="transfer-form plan-form" @submit.prevent="submitPlan">
            <div class="transfer-form-row">
              <label>Planned weekly amount<input type="number" step="0.01" min="0.01" v-model.number="planAmount" required /></label>
              <button type="submit" :disabled="planSubmitting">{{ planSubmitting ? 'Saving…' : 'Update plan' }}</button>
              <span v-if="planError" class="chip critical">{{ planError }}</span>
              <span v-else-if="planSaved" class="chip good">Plan updated</span>
            </div>
            <div class="section-note">Used for the projection above — independent of what's actually been transferred so far.</div>
          </form>
        </div>
      </section>
    </template>

    <div class="legend">
      <span class="chip good">Positive / on track</span>
      <span class="chip warning">In progress</span>
      <span class="chip critical">Negative</span>
    </div>

    <footer>
      <span>Debt service: real amortization schedule imported from Urban Hearth's loan documents &middot; Net Income/Depreciation: real data synced nightly from QuickBooks</span>
    </footer>
  </div>
</template>

<style scoped>
.outlook { margin: 14px 0 4px; }
.outlook-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 8px; }
.outlook-table .text-cell, .outlook-table th.text-cell { text-align: left; white-space: normal; }
.hero-row { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 1rem; }
.hero-row.two-up { grid-template-columns: 1fr 1fr; }
.hero-row.three-up { grid-template-columns: 1fr 1fr 1fr; }
.hero-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 18px 20px; display: flex; flex-direction: column; gap: 10px;
}
.hero-card.anchor { background: var(--accent-wash); border-color: transparent; }
.hero-card .hero-top { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.hero-card .period { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.hero-card .figure { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--ink); }
.hero-card .caption { font-size: 12px; color: var(--ink-3); }

.fcf-breakdown {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 14px 18px;
}
.fcf-row {
  display: flex; justify-content: space-between; gap: 12px; padding: 7px 0;
  font-size: 13px; border-bottom: 1px solid var(--hair); font-variant-numeric: tabular-nums;
}
.fcf-row:last-child { border-bottom: none; }
.fcf-row.total { font-weight: 700; padding-top: 10px; border-top: 1px solid var(--hair); }

.cf-table-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 6px 4px; overflow-x: auto;
}
table.cf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cf-table th, .cf-table td { text-align: left; padding: 10px 14px; white-space: nowrap; }
.cf-table thead th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-3); }
.cf-table tbody th { font-weight: 600; }
.cf-table tbody tr { border-bottom: 1px solid var(--hair); }
.cf-table tbody tr:last-child { border-bottom: none; }
.cf-table tbody tr.total th, .cf-table tbody tr.total td { border-top: 1px solid var(--hair); font-weight: 700; }
.cf-table.upcoming td, .cf-table.upcoming th { font-variant-numeric: tabular-nums; }
.cf-table .flag { display: inline-block; margin-left: 8px; font-size: 10px; font-weight: 700; color: var(--serious-text); background: var(--serious-wash); border-radius: 100px; padding: 2px 7px; }

.drill-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px;
}
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.runway-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; }
.runway-head .name { font-size: 14px; font-weight: 700; }
.runway-head .nums { font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.runway-track { position: relative; height: 22px; margin-top: 4px; border-radius: 8px; background: var(--surface-alt); overflow: hidden; }
.runway-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 8px; }
.runway-fill.good { background: var(--good); }
.runway-fill.warning { background: var(--warning); }
.runway-foot { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); }

.catchup-projection { border-top: 1px solid var(--hair); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.catchup-projection .section-note { line-height: 1.5; }
.transfer-history { border-top: 1px dashed var(--hair); padding-top: 8px; }
.toggle-link { font-size: 12px; font-weight: 600; color: var(--accent-text); cursor: pointer; user-select: none; }
.cf-table.transfers { margin-top: 8px; }
.cf-table.transfers th, .cf-table.transfers td { padding: 6px 10px; font-size: 12px; white-space: normal; }
.cf-table.transfers td.negative { color: var(--critical-text); }
.cf-table.transfers td.note { color: var(--ink-3); }
.cf-table.transfers .delete-link { background: none; border: 0; padding: 0; font-size: 12px; font-weight: 600; color: var(--critical-text); cursor: pointer; }

.transfer-form {
  display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--hair); padding-top: 12px;
}
.transfer-form-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
.transfer-form label {
  display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 600; color: var(--ink-3);
}
.transfer-form label.reversal { flex-direction: row; align-items: center; gap: 6px; font-weight: 500; }
.transfer-form input[type="date"], .transfer-form input[type="number"] {
  font-size: 13px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--hair);
  background: var(--surface); color: var(--ink); width: 150px;
}
.transfer-form input.transfer-note {
  font-size: 13px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--hair);
  background: var(--surface); color: var(--ink); width: 100%;
}
.transfer-form button {
  font-size: 12px; font-weight: 700; padding: 7px 14px; border-radius: 100px; border: none;
  background: var(--accent); color: white; cursor: pointer;
}
.transfer-form button:disabled { opacity: 0.6; cursor: default; }

@media (max-width: 760px) {
  .cf-table th, .cf-table td { padding: 8px 10px; }
  .hero-row.two-up, .hero-row.three-up { grid-template-columns: 1fr; }
}
</style>
