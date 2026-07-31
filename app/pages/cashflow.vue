<script setup lang="ts">
import site from '~/config/site.json'
import { YEAR } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Cash Flow` })

type Payment = { loanKey: string, lender: string, date: string, type: 'catch_up' | 'regular', interest: number, principal: number, total: number }
type PeriodFigures = {
  debtService: { principal: number, interest: number, catchUpInterest: number, totalCashOut: number, payments: Payment[] }
  freeCashFlow: { hasData: boolean, netIncome: number, depreciation: number, actualLoanInterest: number, reserveTransfers: number, principal: number, catchUpInterest: number, freeCashFlow: number, totals: Record<string, number> }
}
type CashFlowResponse = {
  year: number
  month: number
  thisMonth: PeriodFigures
  thisYear: PeriodFigures
  reserve: { weeklyAmount: number, target: number, totalPlanned: number, transfersDone: number, transfersTotal: number, saved: number, nextTransferDate: string | null }
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
          <div class="section-note">Weekly ${{ data.reserve.weeklyAmount.toLocaleString() }} transfers funding the Dec 20, 2026 catch-up</div>
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
            <span>{{ data.reserve.transfersDone }} of {{ data.reserve.transfersTotal }} transfers made</span>
            <span v-if="data.reserve.nextTransferDate">Next transfer: {{ fmtDate(data.reserve.nextTransferDate) }}</span>
            <span v-else class="chip good">All transfers complete</span>
          </div>
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

@media (max-width: 760px) {
  .cf-table th, .cf-table td { padding: 8px 10px; }
}
</style>
