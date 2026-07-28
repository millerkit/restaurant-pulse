<script setup lang="ts">
import site from '~/config/site.json'
import { CATEGORY_DIRECTION, MONTH_NAMES, benchmarkStatus, daysInMonth, daysInYear, dayOfYear, netIncome, paceStatus } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Daily Performance` })

const { data, pending, error } = await useFetch('/api/dashboard')

// ---- date/time formatting (all daily_line_items dates are UTC-anchored
// ISO strings, e.g. '2026-07-27' — parsed/formatted in UTC throughout so a
// browser west of UTC doesn't roll the displayed date back a day) --------
function parseIsoDate(s: string) {
  return new Date(`${s}T00:00:00Z`)
}
function formatLongDate(s: string) {
  return parseIsoDate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
function formatWeekdayDate(s: string, includeYear = false) {
  const d = parseIsoDate(s)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${weekday}, ${month} ${d.getUTCDate()}${includeYear ? ` ${d.getUTCFullYear()}` : ''}`
}
function formatSyncTime(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `today, ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `yesterday, ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

const syncFailed = computed(() => data.value?.lastSync?.status === 'error')
const neverSynced = computed(() => !data.value?.lastSync)
const lastSyncLabel = computed(() => formatSyncTime(data.value?.lastSync?.finishedAt ?? null))
const asOfMonthDayLabel = computed(() => data.value ? `${MONTH_NAMES[data.value.asOfMonth - 1]} ${data.value.asOfDay}` : '')

// ---- month / year net income + revenue pace -----------------------------
// Pace/status math deliberately mirrors the Budget Pace page (paceStatus,
// netIncome, CATEGORY_DIRECTION from useBudgetData.ts) rather than
// reinventing it — the API route only hands back raw actuals/budget
// totals, same split as /api/budget/actuals + /api/budget/targets.
const monthDayFraction = computed(() => data.value ? data.value.asOfDay / daysInMonth(data.value.asOfYear, data.value.asOfMonth) : 0)
const yearDayFraction = computed(() => data.value ? dayOfYear(data.value.asOfYear, data.value.asOfMonth, data.value.asOfDay) / daysInYear(data.value.asOfYear) : 0)

function buildPeriod(period: 'month' | 'year') {
  if (!data.value) return null
  const p = period === 'month' ? data.value.month : data.value.yearToDate
  const dayFraction = period === 'month' ? monthDayFraction.value : yearDayFraction.value
  const actualNet = netIncome(p.actuals as any)
  if (!p.budget || !p.budget.revenue) {
    return { actualNet, hasBudget: false as const, dayFraction }
  }
  const budgetNet = netIncome(p.budget as any)
  const actualPct = (p.actuals.revenue / p.budget.revenue) * 100
  const expectedPct = dayFraction * 100
  const status = paceStatus(actualPct, expectedPct, CATEGORY_DIRECTION.revenue)
  return {
    actualNet, budgetNet, hasBudget: true as const, dayFraction,
    revenue: {
      actual: p.actuals.revenue,
      target: p.budget.revenue,
      fillPct: Math.min(100, actualPct),
      expectedPct,
      status,
      paceOfExpectedPct: expectedPct > 0 ? (actualPct / expectedPct) * 100 : null
    }
  }
}
const monthView = computed(() => buildPeriod('month'))
const yearView = computed(() => buildPeriod('year'))
const paceLabel = (status: string) => status === 'good' ? 'Ahead of pace' : 'Behind pace'

// ---- last night vs. last week / last year --------------------------------
const lastNightRevenue = computed(() => data.value?.lastNight.revenue ?? 0)
function pctChange(current: number, previous: number | null | undefined) {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}
const vsLastWeek = computed(() => ({
  pct: pctChange(lastNightRevenue.value, data.value?.lastNight.lastWeek.revenue),
  revenue: data.value?.lastNight.lastWeek.revenue ?? null,
  date: data.value?.lastNight.lastWeek.date
}))
const vsLastYear = computed(() => ({
  pct: pctChange(lastNightRevenue.value, data.value?.lastNight.lastYear.revenue),
  revenue: data.value?.lastNight.lastYear.revenue ?? null,
  date: data.value?.lastNight.lastYear.date
}))

// Toast POS isn't integrated into this app yet (see scripts/toast-scope-check.mjs
// — a one-off credential check, not a real sync) — covers/avg check/sales-per-
// labor-hour have no real data source, so these stay sample figures,
// explicitly labeled as such below, until that integration exists.
const lastNightCovers = 178
const lastNightLaborHours = 58.0
const avgCheck = computed(() => lastNightRevenue.value / lastNightCovers)
const salesPerLaborHour = computed(() => lastNightRevenue.value / lastNightLaborHours)

// ---- cost pace meters (COGS / labor / prime cost, month-to-date) --------
const benchmarkByCategory = computed(() => Object.fromEntries((data.value?.benchmarks ?? []).map((b: any) => [b.category, b])))
const COST_METERS = [
  { key: 'cogs', label: 'COGS', benchmarkKey: 'cogs', scaleMax: 40 },
  { key: 'labor', label: 'Labor', benchmarkKey: 'labor', scaleMax: 40 },
  { key: 'prime', label: 'Prime Cost', hint: 'COGS + labor', benchmarkKey: 'prime_cost', scaleMax: 80 }
] as const
const costPaceMeters = computed(() => {
  const revenue = data.value?.month.actuals.revenue
  if (!data.value || !revenue) return []
  const { cogs, labor } = data.value.month.actuals
  const pctByKey: Record<string, number> = {
    cogs: (cogs / revenue) * 100,
    labor: (labor / revenue) * 100,
    prime: ((cogs + labor) / revenue) * 100
  }
  return COST_METERS.map((m) => {
    const pct = pctByKey[m.key]
    const benchmark = benchmarkByCategory.value[m.benchmarkKey]
    const status = benchmark ? benchmarkStatus(pct / 100, benchmark) : null
    return { ...m, pct, benchmark, status }
  })
})
function meterStatusLabel(status: string | null) {
  if (status === 'good') return 'On target'
  if (status === 'warning') return 'Watch'
  if (status === 'serious') return 'Off target'
  if (status === 'critical') return 'Over target'
  return 'No benchmark set'
}
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading dashboard…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical"><span class="dot"></span>Couldn't load dashboard data</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>
    <div v-else-if="!data?.asOfDate" class="drill-card">
      <span class="chip warning"><span class="dot"></span>No synced data yet</span>
      <span class="quiet-note">Run a QuickBooks sync (POST /api/qbo/sync) to pull in P&amp;L data before this page has anything to show.</span>
    </div>

    <template v-else>
      <header>
        <div>
          <h1>{{ site.restaurantName }} — Daily Performance</h1>
          <div class="sub">{{ formatLongDate(data.asOfDate) }} &middot; reporting through last night's close</div>
        </div>
        <div class="as-of">
          <span :class="['chip', syncFailed ? 'critical' : 'good']"><span class="dot"></span>{{ syncFailed ? 'Sync failed' : neverSynced ? 'Never synced' : 'Sync healthy' }}</span>
          <div class="sync-line">
            <template v-if="syncFailed">Sync failed — showing data through <strong>{{ formatWeekdayDate(data.asOfDate) }}</strong></template>
            <template v-else-if="lastSyncLabel">Last synced from QuickBooks: <strong>{{ lastSyncLabel }}</strong></template>
            <template v-else>Data through <strong>{{ formatWeekdayDate(data.asOfDate) }}</strong></template>
          </div>
        </div>
      </header>

      <!-- Are we in the red or black, and are we on pace? -->
      <section>
        <div class="section-label">Net Income</div>
        <div class="hero-row">
          <div class="hero-card anchor">
            <div class="hero-top">
              <span class="period">This Month ({{ MONTH_NAMES[data.asOfMonth - 1] }} 1–{{ data.asOfDay }})</span>
              <span v-if="monthView?.hasBudget" :class="['chip', monthView.revenue!.status]"><span class="dot"></span>{{ paceLabel(monthView.revenue!.status) }}</span>
              <span v-else class="chip warning"><span class="dot"></span>No budget set</span>
            </div>
            <div :class="['figure', (monthView?.actualNet ?? 0) >= 0 ? 'good' : 'critical']">{{ (monthView?.actualNet ?? 0) >= 0 ? '+' : '' }}${{ Math.round(monthView?.actualNet ?? 0).toLocaleString() }}</div>
            <div class="caption">
              Net income, month-to-date
              <template v-if="monthView?.hasBudget">— vs ${{ Math.round(monthView.budgetNet!).toLocaleString() }} budgeted, {{ monthView.revenue!.status === 'good' ? 'running ahead of' : 'running behind' }} the monthly budget pace (see below)</template>
              <template v-else>— no budget entered for this month yet (Edit Budget tab)</template>
            </div>
          </div>
          <div class="hero-card">
            <div class="hero-top">
              <span class="period">This Year (Jan 1–{{ asOfMonthDayLabel }})</span>
              <span v-if="yearView?.hasBudget" :class="['chip', yearView.revenue!.status]"><span class="dot"></span>{{ paceLabel(yearView.revenue!.status) }}</span>
              <span v-else class="chip warning"><span class="dot"></span>No budget set</span>
            </div>
            <div :class="['figure', (yearView?.actualNet ?? 0) >= 0 ? 'good' : 'critical']">{{ (yearView?.actualNet ?? 0) >= 0 ? '+' : '' }}${{ Math.round(yearView?.actualNet ?? 0).toLocaleString() }}</div>
            <div class="caption">
              Net income, year-to-date
              <template v-if="yearView?.hasBudget">— vs ${{ Math.round(yearView.budgetNet!).toLocaleString() }} budgeted, {{ yearView.revenue!.status === 'good' ? 'running ahead of' : 'running behind' }} the annual budget pace</template>
              <template v-else>— no budget entered for this year yet (Edit Budget tab)</template>
            </div>
          </div>
        </div>
      </section>

      <!-- How did we do last night? -->
      <section>
        <div class="section-label">Last Night</div>
        <div class="compare-row">
          <div class="compare-card anchor">
            <div class="date-label">{{ formatWeekdayDate(data.asOfDate) }} (last night)</div>
            <div class="amount">${{ lastNightRevenue.toLocaleString() }}</div>
            <div class="vs-label">Total revenue</div>
          </div>
          <div class="compare-card">
            <div class="date-label">vs. {{ formatWeekdayDate(vsLastWeek.date!) }}</div>
            <template v-if="vsLastWeek.revenue === null">
              <div class="vs-label">No data synced for this date</div>
            </template>
            <template v-else-if="vsLastWeek.pct !== null">
              <div :class="['delta', vsLastWeek.pct >= 0 ? 'up' : 'down']">{{ vsLastWeek.pct >= 0 ? '▲' : '▼' }} {{ Math.abs(vsLastWeek.pct).toFixed(1) }}%</div>
              <div class="vs-label">Last week &middot; ${{ vsLastWeek.revenue.toLocaleString() }}</div>
            </template>
            <div v-else class="vs-label">Last week &middot; ${{ vsLastWeek.revenue.toLocaleString() }} (closed that night?)</div>
          </div>
          <div class="compare-card">
            <div class="date-label">vs. {{ formatWeekdayDate(vsLastYear.date!, true) }}</div>
            <template v-if="vsLastYear.revenue === null">
              <div class="vs-label">No data synced for this date</div>
            </template>
            <template v-else-if="vsLastYear.pct !== null">
              <div :class="['delta', vsLastYear.pct >= 0 ? 'up' : 'down']">{{ vsLastYear.pct >= 0 ? '▲' : '▼' }} {{ Math.abs(vsLastYear.pct).toFixed(1) }}%</div>
              <div class="vs-label">Last year, same position &middot; ${{ vsLastYear.revenue.toLocaleString() }}</div>
            </template>
            <div v-else class="vs-label">Last year, same position &middot; ${{ vsLastYear.revenue.toLocaleString() }} (closed that night?)</div>
          </div>
        </div>
        <div class="stat-row">
          <div class="compare-card">
            <div class="date-label">Covers</div>
            <div class="amount">{{ lastNightCovers }}</div>
            <div class="vs-label">Guests served, {{ formatWeekdayDate(data.asOfDate) }}</div>
          </div>
          <div class="compare-card">
            <div class="date-label">Average Check</div>
            <div class="amount">${{ avgCheck.toFixed(2) }}</div>
            <div class="vs-label">${{ lastNightRevenue.toLocaleString() }} &middot; {{ lastNightCovers }} covers</div>
          </div>
          <div class="compare-card anchor">
            <div class="date-label">Sales / Labor Hour</div>
            <div class="amount">${{ salesPerLaborHour.toFixed(2) }}</div>
            <div class="vs-label">{{ lastNightLaborHours.toFixed(1) }} labor hours worked</div>
          </div>
        </div>
        <div class="toast-note">Toast POS isn't connected yet — covers, average check, and sales/labor-hour above are sample figures, not live data.</div>
      </section>

      <!-- COGS / labor vs revenue -->
      <section>
        <div class="section-label">Cost Pace — Month to Date</div>
        <div v-if="costPaceMeters.length" class="meter-row">
          <div v-for="m in costPaceMeters" :key="m.key" :class="['meter-card', m.key === 'prime' && 'anchor']">
            <div class="meter-head">
              <span class="name">{{ m.label }}<span v-if="m.hint" class="hint"> {{ m.hint }}</span></span>
              <span class="value" :style="{ color: `var(--${m.status ?? 'ink-3'})` }">{{ m.pct.toFixed(1) }}%</span>
            </div>
            <div class="meter-track">
              <div class="meter-marker" :style="{ left: Math.min(100, (m.pct / m.scaleMax) * 100) + '%', background: `var(--${m.status ?? 'ink-3'})` }"></div>
            </div>
            <div class="meter-scale"><span>0%</span><span>{{ m.scaleMax / 2 }}%</span><span>{{ m.scaleMax }}%</span></div>
            <div class="meter-foot">
              <span v-if="m.benchmark">Target: &le;{{ (m.benchmark.targetPct * 100).toFixed(0) }}% of revenue</span>
              <span v-else>No benchmark set</span>
              <span :class="['chip', m.status ?? 'warning']"><span class="dot"></span>{{ meterStatusLabel(m.status) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="quiet-note">No revenue recorded this month yet.</div>
      </section>

      <!-- Are we on target to meet budget? -->
      <section>
        <div class="section-label">Budget Runway — Actual vs. Expected Pace</div>

        <div class="runway-card" v-if="monthView?.hasBudget">
          <div class="runway-head">
            <span class="name">Month revenue</span>
            <span class="nums">${{ Math.round(monthView.revenue!.actual).toLocaleString() }} actual &middot; ${{ Math.round(monthView.revenue!.target).toLocaleString() }} month target</span>
          </div>
          <div class="runway-track">
            <div :class="['runway-fill', monthView.revenue!.status]" :style="{ width: monthView.revenue!.fillPct + '%' }"></div>
            <div class="runway-expected" :style="{ left: monthView.revenue!.expectedPct + '%' }"></div>
          </div>
          <div class="runway-foot">
            <span>$0</span>
            <span :class="['chip', monthView.revenue!.status]"><span class="dot"></span>{{ monthView.revenue!.paceOfExpectedPct !== null ? `${monthView.revenue!.paceOfExpectedPct.toFixed(1)}% of expected pace` : '—' }}</span>
            <span>${{ Math.round(monthView.revenue!.target).toLocaleString() }}</span>
          </div>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning"><span class="dot"></span>No budget set</span>
          <span class="quiet-note">Enter a revenue target for this month on the Edit Budget tab to see runway here.</span>
        </div>

        <div class="runway-card" v-if="yearView?.hasBudget">
          <div class="runway-head">
            <span class="name">{{ data.asOfYear }} revenue</span>
            <span class="nums">${{ Math.round(yearView.revenue!.actual).toLocaleString() }} actual &middot; ${{ Math.round(yearView.revenue!.target).toLocaleString() }} annual target</span>
          </div>
          <div class="runway-track">
            <div :class="['runway-fill', yearView.revenue!.status]" :style="{ width: yearView.revenue!.fillPct + '%' }"></div>
            <div class="runway-expected" :style="{ left: yearView.revenue!.expectedPct + '%' }"></div>
          </div>
          <div class="runway-foot">
            <span>$0</span>
            <span :class="['chip', yearView.revenue!.status]"><span class="dot"></span>{{ yearView.revenue!.paceOfExpectedPct !== null ? `${yearView.revenue!.paceOfExpectedPct.toFixed(1)}% of expected pace` : '—' }}</span>
            <span>${{ Math.round(yearView.revenue!.target).toLocaleString() }}</span>
          </div>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning"><span class="dot"></span>No budget set</span>
          <span class="quiet-note">Enter revenue targets for {{ data.asOfYear }} on the Edit Budget tab to see runway here.</span>
        </div>
      </section>

      <div class="legend">
        <span class="chip good"><span class="dot"></span>On / ahead of target</span>
        <span class="chip warning"><span class="dot"></span>Watch</span>
        <span class="chip serious"><span class="dot"></span>Off pace</span>
        <span class="chip critical"><span class="dot"></span>Over / under target</span>
      </div>

      <footer>
        <span>Data source: QuickBooks Online, synced nightly &middot; guest-economics figures are sample data (Toast not yet connected)</span>
        <span>{{ site.restaurantName }} Performance Dashboard</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }
.drill-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px;
}
.drill-card.quiet { flex-direction: row; align-items: center; gap: 10px; padding: 12px 16px; margin-top: 10px; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.toast-note { margin-top: 8px; font-size: 11.5px; color: var(--ink-3); font-style: italic; }

/* ---------- hero row: month / year status ---------- */
.hero-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
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
.hero-card .hero-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}
.hero-card .period { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.hero-card .figure {
  font-size: 34px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.hero-card .figure.good { color: var(--good); }
.hero-card .figure.critical { color: var(--critical); }
.hero-card .caption { font-size: 12px; color: var(--ink-3); }

/* ---------- comparison strip ---------- */
.compare-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 12px;
}
.compare-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.compare-card.anchor { background: var(--accent-wash); border-color: transparent; }
.compare-card .date-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.compare-card.anchor .date-label { color: var(--accent); }
.compare-card .amount {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.delta.up { color: var(--good); }
.delta.down { color: var(--critical); }
.compare-card .vs-label { font-size: 12px; color: var(--ink-3); }

/* ---------- guest-economics row (covers / avg check / sales per labor hour) ---------- */
.stat-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin-top: 8px;
}

/* ---------- pace meters (COGS / labor / prime cost) ---------- */
.meter-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
.meter-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
}
.meter-card.anchor { background: var(--accent-wash); border-color: transparent; }
.meter-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.meter-head .name { font-size: 14px; font-weight: 700; }
.meter-head .name .hint { font-size: 11px; font-weight: 500; color: var(--ink-3); }
.meter-head .value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.meter-track {
  position: relative;
  height: 10px;
  border-radius: 6px;
  background: var(--surface-alt);
  margin: 6px 0 8px;
}
.meter-marker {
  position: absolute;
  top: -3px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--ink);
}
.meter-scale {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.meter-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-2);
}

/* ---------- budget runway bars ---------- */
.runway-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}
.runway-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.runway-head .name { font-size: 14px; font-weight: 700; }
.runway-head .nums {
  font-size: 12px;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.runway-track {
  position: relative;
  height: 22px;
  border-radius: 8px;
  background: var(--surface-alt);
  overflow: visible;
}
.runway-fill {
  position: absolute;
  top: 0; bottom: 0; left: 0;
  border-radius: 8px;
}
.runway-fill.good { background: var(--good); }
.runway-fill.warning { background: var(--warning); }
.runway-fill.serious { background: var(--serious); }
.runway-fill.critical { background: var(--critical); }
.runway-expected {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 30px;
  background: var(--ink);
  opacity: 0.55;
}
.runway-expected::after {
  content: "today's pace";
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  white-space: nowrap;
  color: var(--ink-3);
  font-weight: 600;
}
.runway-foot {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ink-3);
}

@media (max-width: 760px) {
  .hero-row, .meter-row { grid-template-columns: 1fr; }
  .compare-row, .stat-row { grid-template-columns: 1fr 1fr; }
}
</style>
