<script setup lang="ts">
import site from '~/config/site.json'
import { YEAR } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Cash Flow` })

type Payment = { loanKey: string, lender: string, date: string, type: 'catch_up' | 'regular', interest: number, principal: number, total: number }
type PeriodFigures = {
  debtService: { principal: number, interest: number, catchUpInterest: number, totalCashOut: number, payments: Payment[] }
  freeCashFlow: { hasData: boolean, netIncome: number, depreciation: number, actualLoanInterest: number, reserveTransfers: number, principal: number, catchUpInterest: number, freeCashFlow: number, totals: Record<string, number> }
}
type ReserveTransfer = { date: string, amount: number, note: string | null }
type CashFlowResponse = {
  year: number
  month: number
  thisMonth: PeriodFigures
  thisYear: PeriodFigures
  reserve: {
    target: number, saved: number, remaining: number, currentWeeklyAmount: number | null, complete: boolean
    catchUpDate: string | null, projectedBalanceAtCatchUp: number | null, onPaceForCatchUp: boolean | null, catchUpShortfall: number | null
    transfers: ReserveTransfer[]
  }
  upcomingPayments: Payment[]
}

const now = new Date()
const asOfMonth = now.getFullYear() === YEAR ? now.getMonth() + 1 : 12

const data = ref<CashFlowResponse | null>(null)
const loadError = ref<string | null>(null)
async function load() {
  loadError.value = null
  try {
    data.value = await $fetch<CashFlowResponse>('/api/cashflow', { query: { year: YEAR, month: asOfMonth } })
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || err?.message || 'Failed to load cash flow data'
  }
}
onMounted(load)

const selectedPeriod = ref<'month' | 'year'>('month')
const period = computed(() => data.value ? (selectedPeriod.value === 'month' ? data.value.thisMonth : data.value.thisYear) : null)

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const periodLabel = computed(() => selectedPeriod.value === 'month' ? `${MONTH_NAMES[asOfMonth - 1]} ${YEAR}` : `${YEAR} year-to-date`)

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
        <h1>{{ site.restaurantName }} — Cash Flow</h1>
        <div class="sub">Are we covering total debt service — principal included, not just interest?</div>
      </div>
    </header>

    <div v-if="loadError" class="drill-card">
      <span class="chip critical">Couldn't load cash flow data</span>
      <span class="quiet-note">{{ loadError }}</span>
    </div>

    <template v-else-if="data && period">
      <section>
        <div class="section-head">
          <div class="section-label">Free Cash Flow</div>
          <div class="period-tabs">
            <span :class="['period-tab', selectedPeriod === 'month' && 'active']" @click="selectedPeriod = 'month'">Month</span>
            <span :class="['period-tab', selectedPeriod === 'year' && 'active']" @click="selectedPeriod = 'year'">Year</span>
          </div>
        </div>

        <div class="hero-row">
          <div class="hero-card anchor">
            <div class="hero-top">
              <span class="period">Free Cash Flow — {{ periodLabel }}</span>
              <span :class="['chip', period.freeCashFlow.freeCashFlow >= 0 ? 'good' : 'critical']">
                {{ period.freeCashFlow.freeCashFlow >= 0 ? 'Positive' : 'Negative' }}
              </span>
            </div>
            <div class="figure">{{ fmt(period.freeCashFlow.freeCashFlow) }}</div>
            <div class="caption">Net Income + Depreciation − Principal − Catch-up interest − Reserve transfers</div>
            <div v-if="!period.freeCashFlow.hasData" class="caption">No synced actuals for this period yet — Net Income is $0 below.</div>
          </div>
        </div>

        <div class="fcf-breakdown">
          <div class="fcf-row"><span>Net Income (from QBO P&amp;L)</span><span>{{ fmt(period.freeCashFlow.netIncome) }}</span></div>
          <div class="fcf-row"><span>+ Depreciation (non-cash add-back)</span><span>{{ fmt(period.freeCashFlow.depreciation) }}</span></div>
          <div class="fcf-row"><span>− Principal payments</span><span>{{ fmt(-period.freeCashFlow.principal) }}</span></div>
          <div class="fcf-row"><span>− Catch-up interest (already accrued, not a new P&amp;L expense)</span><span>{{ fmt(-period.freeCashFlow.catchUpInterest) }}</span></div>
          <div class="fcf-row"><span>− Loan reserve transfers</span><span>{{ fmt(-period.freeCashFlow.reserveTransfers) }}</span></div>
          <div class="fcf-row total"><span>= Free Cash Flow</span><span>{{ fmt(period.freeCashFlow.freeCashFlow) }}</span></div>
        </div>
      </section>

      <!-- P&L view vs Cash Flow view, per the source brief's Section 7 -->
      <section>
        <div class="section-head">
          <div class="section-label">P&amp;L View vs. Cash Flow View</div>
          <div class="section-note">{{ periodLabel }}</div>
        </div>
        <div class="cf-table-card">
          <table class="cf-table">
            <thead>
              <tr><th></th><th>P&amp;L View</th><th>Cash Flow View</th></tr>
            </thead>
            <tbody>
              <tr>
                <th>Loan interest</th>
                <td>{{ fmt(period.freeCashFlow.actualLoanInterest) }} (acct 7020, actual)</td>
                <td>{{ fmt(period.debtService.interest) }} (per amortization schedule)</td>
              </tr>
              <tr>
                <th>Principal</th>
                <td>Not shown (balance sheet)</td>
                <td>{{ fmt(period.debtService.principal) }}</td>
              </tr>
              <tr>
                <th>Catch-up interest</th>
                <td>Not shown (already accrued monthly)</td>
                <td>{{ period.debtService.catchUpInterest > 0 ? fmt(period.debtService.catchUpInterest) + ' (one-time)' : '—' }}</td>
              </tr>
              <tr>
                <th>Reserve transfers</th>
                <td>Not shown</td>
                <td>{{ period.freeCashFlow.reserveTransfers > 0 ? fmt(period.freeCashFlow.reserveTransfers) : '—' }}</td>
              </tr>
              <tr class="total">
                <th>Bottom line</th>
                <td>Net Income: {{ fmt(period.freeCashFlow.netIncome) }}</td>
                <td>Free Cash Flow: {{ fmt(period.freeCashFlow.freeCashFlow) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="section-note">
          Acct 7020's real actual can differ from the amortization schedule's figure — it may include interest from debt outside these 10 loans (e.g. from before this move).
        </div>
      </section>

      <!-- Debt service payment calendar -->
      <section>
        <div class="section-head">
          <div class="section-label">Upcoming Debt Service Payments</div>
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

          <div class="transfer-history">
            <span class="toggle-link" @click="showTransferHistory = !showTransferHistory">
              {{ showTransferHistory ? 'Hide' : 'Show' }} {{ data.reserve.transfers.length }} recorded transfer{{ data.reserve.transfers.length === 1 ? '' : 's' }}
            </span>
            <table v-if="showTransferHistory" class="cf-table transfers">
              <thead><tr><th>Date</th><th>Amount</th><th>Note</th></tr></thead>
              <tbody>
                <tr v-for="(t, i) in data.reserve.transfers" :key="i">
                  <td>{{ fmtDate(t.date) }}</td>
                  <td :class="t.amount < 0 ? 'negative' : ''">{{ fmt(t.amount) }}</td>
                  <td class="note">{{ t.note || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="transfer-form" @submit.prevent="submitTransfer">
            <div class="transfer-form-row">
              <label>Date<input type="date" v-model="transferForm.date" required /></label>
              <label>Amount<input type="number" step="0.01" min="0.01" v-model.number="transferForm.amount" placeholder="4000.00" required /></label>
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
              <label>Planned weekly amount<input type="number" step="0.01" min="0.01" v-model.number="planAmount" placeholder="4000.00" required /></label>
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
.hero-row { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 1rem; }
.hero-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 18px 20px; display: flex; flex-direction: column; gap: 10px;
}
.hero-card.anchor { background: var(--accent-wash); border-color: transparent; }
.hero-card .hero-top { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.hero-card .period { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.hero-card .figure { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; color: var(--ink); }
.hero-card .caption { font-size: 12px; color: var(--ink-3); }

.period-tabs { display: flex; gap: 6px; }
.period-tab {
  font-size: 11px; font-weight: 700; padding: 4px 11px; border-radius: 100px;
  border: 1px solid var(--hair); color: var(--ink-3); cursor: pointer; user-select: none;
}
.period-tab.active { background: var(--accent-wash); color: var(--accent); border-color: transparent; }

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
.cf-table .flag { display: inline-block; margin-left: 8px; font-size: 10px; font-weight: 700; color: var(--serious); background: var(--serious-wash); border-radius: 100px; padding: 2px 7px; }

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
.toggle-link { font-size: 12px; font-weight: 600; color: var(--accent); cursor: pointer; user-select: none; }
.cf-table.transfers { margin-top: 8px; }
.cf-table.transfers th, .cf-table.transfers td { padding: 6px 10px; font-size: 12px; white-space: normal; }
.cf-table.transfers td.negative { color: var(--critical); }
.cf-table.transfers td.note { color: var(--ink-3); }

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
}
</style>
