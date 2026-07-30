<script setup lang="ts">
import site from '~/config/site.json'
import { benchmarkStatus, netIncome, type CategoryBenchmark } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — P&L` })

const { data, pending, error } = await useFetch('/api/pl')

type Period = 'week' | 'month' | 'year'

// ---- date formatting (daily_line_items dates are UTC-anchored ISO
// strings, parsed/formatted in UTC throughout — same convention as
// index.vue) --------------------------------------------------------------
function parseIsoDate(s: string) {
  return new Date(`${s}T00:00:00Z`)
}
function formatWeekdayDate(s: string, includeYear = false) {
  const d = parseIsoDate(s)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${weekday}, ${month} ${d.getUTCDate()}${includeYear ? ` ${d.getUTCFullYear()}` : ''}`
}
function formatMonthDay(s: string) {
  const d = parseIsoDate(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
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
const lastSyncLabel = computed(() => formatSyncTime(data.value?.lastSync?.finishedAt ?? null))

function rangeLabel(period: Period) {
  const p = data.value?.periods[period]
  if (!p) return ''
  return `${formatMonthDay(p.start)}${p.start === p.end ? '' : `–${formatMonthDay(p.end)}`} (${p.days} day${p.days === 1 ? '' : 's'})`
}

// ---- P&L summary table: week/month/year totals + benchmark status -------
const benchmarkByCategory = computed(() => {
  const map: Record<string, CategoryBenchmark> = {}
  for (const b of (data.value?.benchmarks ?? []) as CategoryBenchmark[]) map[b.category] = b
  return map
})
function periodRow(period: Period) {
  const totals = data.value?.periods[period]?.totals
  if (!totals) return null
  const revenue = totals.revenue
  const cogsPct = revenue ? totals.cogs / revenue : 0
  const laborPct = revenue ? totals.labor / revenue : 0
  const primePct = revenue ? (totals.cogs + totals.labor) / revenue : 0
  return {
    revenue,
    cogs: totals.cogs,
    cogsPct,
    cogsStatus: benchmarkStatus(cogsPct, benchmarkByCategory.value.cogs),
    labor: totals.labor,
    laborPct,
    laborStatus: benchmarkStatus(laborPct, benchmarkByCategory.value.labor),
    prime: totals.cogs + totals.labor,
    primePct,
    primeStatus: benchmarkStatus(primePct, benchmarkByCategory.value.prime_cost),
    opex: totals.opex,
    netIncome: netIncome(totals)
  }
}
const weekRow = computed(() => periodRow('week'))
const monthRow = computed(() => periodRow('month'))
const yearRow = computed(() => periodRow('year'))
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading P&amp;L…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load P&amp;L data</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>
    <div v-else-if="!data?.asOfDate" class="drill-card">
      <span class="chip warning">No synced data yet</span>
      <span class="quiet-note">Run a QuickBooks sync (POST /api/qbo/sync) to pull in P&amp;L data before this page has anything to show.</span>
    </div>

    <template v-else>
      <header>
        <div>
          <h1>{{ site.restaurantName }} — P&amp;L</h1>
          <div class="sub">Week, month, and year to date &middot; reporting through last night's close ({{ formatWeekdayDate(data.asOfDate) }})</div>
        </div>
        <div class="as-of">
          <span :class="['chip', syncFailed ? 'critical' : 'good']">{{ syncFailed ? 'Sync failed' : 'Sync healthy' }}</span>
          <div class="sync-line">
            <template v-if="syncFailed">Sync failed — showing data through <strong>{{ formatWeekdayDate(data.asOfDate) }}</strong></template>
            <template v-else-if="lastSyncLabel">Last synced from QuickBooks: <strong>{{ lastSyncLabel }}</strong></template>
            <template v-else>Data through <strong>{{ formatWeekdayDate(data.asOfDate) }}</strong></template>
          </div>
        </div>
      </header>

      <!-- High-level P&L, three periods side by side -->
      <section>
        <div class="section-head">
          <div class="section-label">Profit &amp; Loss</div>
          <div class="section-note">COGS%, labor%, and prime cost colored against configurable benchmarks — see legend below. For what's driving these numbers, see <NuxtLink to="/pl/drilldowns">Drill-Downs</NuxtLink>.</div>
        </div>

        <div class="pl-table-card">
          <table class="pl-table">
            <caption>Profit and loss summary for this week, this month, and this year to date</caption>
            <thead>
              <tr>
                <th scope="col">Line item</th>
                <th scope="col">This Week<span class="range">{{ rangeLabel('week') }}</span></th>
                <th scope="col">This Month<span class="range">{{ rangeLabel('month') }}</span></th>
                <th scope="col">This Year<span class="range">{{ rangeLabel('year') }}</span></th>
              </tr>
            </thead>
            <tbody v-if="weekRow && monthRow && yearRow">
              <tr>
                <th scope="row">Revenue</th>
                <td class="amount">${{ Math.round(weekRow.revenue).toLocaleString() }}</td>
                <td class="amount">${{ Math.round(monthRow.revenue).toLocaleString() }}</td>
                <td class="amount">${{ Math.round(yearRow.revenue).toLocaleString() }}</td>
              </tr>
              <tr>
                <th scope="row">COGS</th>
                <td><span :class="['amount', weekRow.cogsStatus]">${{ Math.round(weekRow.cogs).toLocaleString() }}</span><span :class="['pct', weekRow.cogsStatus]">{{ (weekRow.cogsPct * 100).toFixed(1) }}% of rev.</span></td>
                <td><span :class="['amount', monthRow.cogsStatus]">${{ Math.round(monthRow.cogs).toLocaleString() }}</span><span :class="['pct', monthRow.cogsStatus]">{{ (monthRow.cogsPct * 100).toFixed(1) }}% of rev.</span></td>
                <td><span :class="['amount', yearRow.cogsStatus]">${{ Math.round(yearRow.cogs).toLocaleString() }}</span><span :class="['pct', yearRow.cogsStatus]">{{ (yearRow.cogsPct * 100).toFixed(1) }}% of rev.</span></td>
              </tr>
              <tr>
                <th scope="row">Labor</th>
                <td><span :class="['amount', weekRow.laborStatus]">${{ Math.round(weekRow.labor).toLocaleString() }}</span><span :class="['pct', weekRow.laborStatus]">{{ (weekRow.laborPct * 100).toFixed(1) }}% of rev.</span></td>
                <td><span :class="['amount', monthRow.laborStatus]">${{ Math.round(monthRow.labor).toLocaleString() }}</span><span :class="['pct', monthRow.laborStatus]">{{ (monthRow.laborPct * 100).toFixed(1) }}% of rev.</span></td>
                <td><span :class="['amount', yearRow.laborStatus]">${{ Math.round(yearRow.labor).toLocaleString() }}</span><span :class="['pct', yearRow.laborStatus]">{{ (yearRow.laborPct * 100).toFixed(1) }}% of rev.</span></td>
              </tr>
              <tr class="subtotal">
                <th scope="row">Prime cost <span class="hint">(COGS + labor)</span></th>
                <td><span :class="['amount', weekRow.primeStatus]">${{ Math.round(weekRow.prime).toLocaleString() }}</span><span :class="['pct', weekRow.primeStatus]">{{ (weekRow.primePct * 100).toFixed(1) }}% of rev.</span></td>
                <td><span :class="['amount', monthRow.primeStatus]">${{ Math.round(monthRow.prime).toLocaleString() }}</span><span :class="['pct', monthRow.primeStatus]">{{ (monthRow.primePct * 100).toFixed(1) }}% of rev.</span></td>
                <td><span :class="['amount', yearRow.primeStatus]">${{ Math.round(yearRow.prime).toLocaleString() }}</span><span :class="['pct', yearRow.primeStatus]">{{ (yearRow.primePct * 100).toFixed(1) }}% of rev.</span></td>
              </tr>
              <tr>
                <th scope="row">Operating expenses <span class="hint">(see drill-down)</span></th>
                <td class="amount">${{ Math.round(weekRow.opex).toLocaleString() }}</td>
                <td class="amount">${{ Math.round(monthRow.opex).toLocaleString() }}</td>
                <td class="amount">${{ Math.round(yearRow.opex).toLocaleString() }}</td>
              </tr>
              <tr class="total">
                <th scope="row">Net income</th>
                <td><span :class="['net-figure', weekRow.netIncome >= 0 ? 'good' : 'critical']">{{ weekRow.netIncome >= 0 ? '+' : '' }}${{ Math.round(weekRow.netIncome).toLocaleString() }}</span></td>
                <td><span :class="['net-figure', monthRow.netIncome >= 0 ? 'good' : 'critical']">{{ monthRow.netIncome >= 0 ? '+' : '' }}${{ Math.round(monthRow.netIncome).toLocaleString() }}</span></td>
                <td><span :class="['net-figure', yearRow.netIncome >= 0 ? 'good' : 'critical']">{{ yearRow.netIncome >= 0 ? '+' : '' }}${{ Math.round(yearRow.netIncome).toLocaleString() }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="legend">
        <span class="chip good">Within benchmark</span>
        <span class="chip warning">Watch</span>
        <span class="chip serious">Off benchmark</span>
        <span class="chip critical">Over benchmark</span>
      </div>

      <footer>
        <span>Data source: QuickBooks Online, synced nightly</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }

/* ---------- P&L statement table ---------- */
.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
}
table.pl-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 620px;
}
.pl-table caption { display: none; }
.pl-table th, .pl-table td {
  padding: 12px 16px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pl-table th:first-child, .pl-table td:first-child {
  text-align: left;
  white-space: normal;
}
.pl-table thead th {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-3);
  border-bottom: 1px solid var(--hair);
}
.pl-table thead th .range {
  display: block;
  font-weight: 500;
  color: var(--ink-3);
  font-size: 10px;
  margin-top: 2px;
  text-transform: none;
  letter-spacing: 0;
}
.pl-table tbody th {
  text-align: left;
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
}
.pl-table tbody th .hint {
  font-weight: 500;
  color: var(--ink-3);
  font-size: 11px;
}
.pl-table tbody tr { border-bottom: 1px solid var(--hair); }
.pl-table tbody tr:last-child { border-bottom: none; }
.pl-table tbody tr.subtotal th,
.pl-table tbody tr.subtotal td { background: var(--surface-alt); }
.pl-table tbody tr.total th,
.pl-table tbody tr.total td { border-top: 1px solid var(--hair); padding-top: 14px; }
.pl-table .amount { font-weight: 600; }
/* The dollar figure itself picks up the same good/serious/critical color as
   the benchmark % beneath it (matching the Edit Budget page's colored
   variance figures) — never color-alone since the icon on .pct right below
   already satisfies that rule for this row. */
.pl-table .amount.good { color: var(--good); }
.pl-table .amount.warning { color: var(--warning); }
.pl-table .amount.serious { color: var(--serious); }
.pl-table .amount.critical { color: var(--critical); }
.pl-table .pct { display: block; font-size: 11px; font-weight: 700; margin-top: 2px; }
/* Never color-alone: a checkmark marks "within benchmark", a triangle marks
   any degree of "above benchmark" — the good/not-good shape distinction
   survives grayscale and colorblindness; color is reinforcement, not the
   only signal. */
.pl-table .pct.good::before { content: "✓ "; }
.pl-table .pct.warning::before,
.pl-table .pct.serious::before,
.pl-table .pct.critical::before { content: "▲ "; }
.pl-table .pct.good { color: var(--good); }
.pl-table .pct.warning { color: var(--warning); }
.pl-table .pct.serious { color: var(--serious); }
.pl-table .pct.critical { color: var(--critical); }
.pl-table .net-figure.good { color: var(--good); }
.pl-table .net-figure.critical { color: var(--critical); }
.pl-table .net-figure { font-weight: 700; font-size: 14px; }

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
</style>
