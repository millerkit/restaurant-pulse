<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES, paceStatus } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Capacity Pace` })

type Assumed = { operatingDays: number, expectedCovers: number, expectedRevenue: number, maxCapacityCovers: number, assumedFillPct: number | null, assumedAvgCheck: number | null }
type Actual = { throughDate: string, covers: number | null, revenue: number | null, toastDaysSynced: number, operatingDays: number, maxCapacityCovers: number, actualFillPct: number | null, actualAvgCheck: number | null } | null
type Period = { start: string, end: string, isFuture: boolean, isCurrent: boolean, assumed: Assumed, actual: Actual }

const { data, pending, error, refresh } = await useFetch('/api/capacity')

function fmtMoney(n: number | null | undefined): string {
  return n == null ? '—' : `$${n.toFixed(2)}`
}
function fmtMoneyRound(n: number | null | undefined): string {
  return n == null ? '—' : `$${Math.round(n).toLocaleString()}`
}
function fmtCovers(n: number | null | undefined): string {
  return n == null ? '—' : Math.round(n).toLocaleString()
}
// Average nightly covers over a range — covers ÷ the same operating-day
// count already used to build the assumed/actual rate figures, so it's
// consistent with everything else on this page (Mondays and holiday
// closures already excluded upstream, not re-derived here).
function fmtAvgCovers(covers: number | null | undefined, operatingDays: number | null | undefined): string {
  if (covers == null || !operatingDays) return '—'
  return Math.round(covers / operatingDays).toLocaleString()
}
function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}
function parseIso(s: string) {
  return new Date(`${s}T00:00:00Z`)
}
function fmtDate(s: string) {
  return parseIso(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function rangeLabel(p: Period) {
  return `${fmtDate(p.start)}–${fmtDate(p.end)}`
}

// Both fill % and per-cover $ are already rate metrics, so "actual vs
// assumed" is judged as a ratio (actual as a % of assumed), same
// good/warning/serious/critical scale every other pace card in the app
// uses — 100% of assumed = good, each 10pts short bumps a level.
function ratioStatus(actual: number | null | undefined, assumed: number | null | undefined) {
  if (actual == null || assumed == null || assumed === 0) return null
  return paceStatus((actual / assumed) * 100, 100, 'higher-is-better')
}
function fillDeltaLabel(p: Period): string {
  const actual = p.actual?.actualFillPct
  const assumed = p.assumed.assumedFillPct
  if (actual == null || assumed == null) return ''
  const pts = (actual - assumed) * 100
  return pts >= 0 ? `+${pts.toFixed(1)}pts` : `${pts.toFixed(1)}pts`
}
function checkDeltaLabel(p: Period): string {
  const actual = p.actual?.actualAvgCheck
  const assumed = p.assumed.assumedAvgCheck
  if (actual == null || assumed == null) return ''
  const delta = actual - assumed
  return delta >= 0 ? `+$${delta.toFixed(2)}` : `−$${Math.abs(delta).toFixed(2)}`
}

const periods = computed(() => data.value?.periods ?? null)

// ---- Month tabs ---------------------------------------------------------
const months = computed(() => data.value?.months ?? [])
const selectedMonth = ref<number | null>(null)
watch(() => data.value?.asOfMonth, (m) => { if (m != null && selectedMonth.value === null) selectedMonth.value = m }, { immediate: true })
const selectedMonthData = computed(() => months.value.find(m => m.month === selectedMonth.value) ?? null)
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading capacity data…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load capacity data</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>
    <div v-else-if="!data?.asOfDate || !periods" class="drill-card">
      <span class="chip warning">No synced data yet</span>
      <span class="quiet-note">Run a QuickBooks/Toast sync before this page has real actuals to compare against.</span>
    </div>

    <template v-else>
      <PageHeader
        page-name="Capacity Pace"
        description="Are we filling the room at the rate we've assumed, and are guests spending what we've assumed per cover?"
        :as-of-label="fmtDate(data.asOfDate)"
        @synced="refresh()"
      />

      <!-- Quick look: the four periods a restaurateur actually checks day to day -->
      <section>
        <div class="section-head">
          <div class="section-label">Are We Meeting Our Assumptions?</div>
          <div class="section-note">Per-cover and fill % are rate metrics — a partial period compares fairly against the assumed rate with no projection needed. See <NuxtLink to="/capacity/edit">Edit assumptions</NuxtLink>.</div>
        </div>

        <div class="quick-row">
          <div v-for="(p, key) in { 'Last Month': periods.lastMonth, 'Last Week': periods.lastWeek, 'This Month': periods.thisMonth, 'This Week': periods.thisWeek }" :key="key" class="assumption-card" :class="{ anchor: p.isCurrent }">
            <div class="card-head">
              <span class="period-name">{{ key }}{{ p.isCurrent ? ' (to date)' : '' }}</span>
              <span class="period-range">{{ rangeLabel(p) }}</span>
            </div>
            <template v-if="p.actual">
              <div class="metric primary">
                <div class="metric-top">
                  <span class="metric-label">Per-Cover</span>
                  <span v-if="ratioStatus(p.actual.actualAvgCheck, p.assumed.assumedAvgCheck)" :class="['chip', ratioStatus(p.actual.actualAvgCheck, p.assumed.assumedAvgCheck)]">
                    {{ checkDeltaLabel(p) }}
                  </span>
                </div>
                <div class="metric-figure">{{ fmtMoney(p.actual.actualAvgCheck) }}</div>
                <div class="metric-sub">vs. {{ fmtMoney(p.assumed.assumedAvgCheck) }} assumed</div>
              </div>
              <div class="metric">
                <div class="metric-top">
                  <span class="metric-label">Fill %</span>
                  <span v-if="ratioStatus(p.actual.actualFillPct, p.assumed.assumedFillPct)" :class="['chip', ratioStatus(p.actual.actualFillPct, p.assumed.assumedFillPct)]">
                    {{ fillDeltaLabel(p) }}
                  </span>
                </div>
                <div class="metric-figure small">{{ fmtPct(p.actual.actualFillPct) }}</div>
                <div class="metric-sub">vs. {{ fmtPct(p.assumed.assumedFillPct) }} assumed</div>
              </div>
              <div class="caption"><strong>{{ fmtAvgCovers(p.actual.covers, p.actual.operatingDays) }} covers/night</strong> avg &middot; {{ fmtCovers(p.actual.covers) }} covers &middot; {{ fmtMoneyRound(p.actual.revenue) }} revenue</div>
            </template>
            <div v-else class="quiet-note">No actual data for this period yet.</div>
          </div>
        </div>
      </section>

      <!-- Month by month, one at a time -->
      <section>
        <div class="section-head">
          <div class="section-label">By Month — {{ data.asOfYear }}</div>
        </div>

        <div class="month-tabs">
          <button
            v-for="(name, i) in MONTH_NAMES" :key="name"
            type="button"
            :class="['month-tab', selectedMonth === i + 1 && 'active']"
            @click="selectedMonth = i + 1"
          >{{ name }}</button>
        </div>

        <div v-if="selectedMonthData" class="assumption-card month-detail">
          <div class="card-head">
            <span class="period-name">{{ MONTH_NAMES[selectedMonthData.month - 1] }} {{ data.asOfYear }}{{ selectedMonthData.isCurrent ? ' (to date)' : '' }}</span>
            <span class="period-range">{{ selectedMonthData.assumed.operatingDays }} operating days<template v-if="selectedMonthData.holidayClosures > 0"> (−{{ selectedMonthData.holidayClosures }} holiday{{ selectedMonthData.holidayClosures === 1 ? '' : 's' }})</template></span>
          </div>
          <template v-if="selectedMonthData.actual">
            <div class="metric-grid">
              <div class="metric primary">
                <div class="metric-top">
                  <span class="metric-label">Per-Cover</span>
                  <span v-if="ratioStatus(selectedMonthData.actual.actualAvgCheck, selectedMonthData.assumed.assumedAvgCheck)" :class="['chip', ratioStatus(selectedMonthData.actual.actualAvgCheck, selectedMonthData.assumed.assumedAvgCheck)]">
                    {{ checkDeltaLabel(selectedMonthData) }}
                  </span>
                </div>
                <div class="metric-figure">{{ fmtMoney(selectedMonthData.actual.actualAvgCheck) }}</div>
                <div class="metric-sub">vs. {{ fmtMoney(selectedMonthData.assumed.assumedAvgCheck) }} assumed</div>
              </div>
              <div class="metric primary">
                <div class="metric-top">
                  <span class="metric-label">Fill %</span>
                  <span v-if="ratioStatus(selectedMonthData.actual.actualFillPct, selectedMonthData.assumed.assumedFillPct)" :class="['chip', ratioStatus(selectedMonthData.actual.actualFillPct, selectedMonthData.assumed.assumedFillPct)]">
                    {{ fillDeltaLabel(selectedMonthData) }}
                  </span>
                </div>
                <div class="metric-figure">{{ fmtPct(selectedMonthData.actual.actualFillPct) }}</div>
                <div class="metric-sub">vs. {{ fmtPct(selectedMonthData.assumed.assumedFillPct) }} assumed</div>
              </div>
            </div>
            <div class="caption">
              <strong>{{ fmtAvgCovers(selectedMonthData.actual.covers, selectedMonthData.actual.operatingDays) }} covers/night</strong> avg
              ({{ fmtAvgCovers(selectedMonthData.assumed.expectedCovers, selectedMonthData.assumed.operatingDays) }} covers/night assumed)
              &middot; {{ fmtCovers(selectedMonthData.actual.covers) }} covers vs. {{ fmtCovers(selectedMonthData.assumed.expectedCovers) }} expected
              &middot; {{ fmtMoneyRound(selectedMonthData.actual.revenue) }} revenue vs. {{ fmtMoneyRound(selectedMonthData.assumed.expectedRevenue) }} expected
              <template v-if="selectedMonthData.isCurrent">(through {{ fmtDate(selectedMonthData.actual.throughDate) }})</template>
            </div>
          </template>
          <div v-else class="quiet-note">
            No actual data yet — assumed target: {{ fmtPct(selectedMonthData.assumed.assumedFillPct) }} fill, {{ fmtMoney(selectedMonthData.assumed.assumedAvgCheck) }}/cover ({{ fmtMoneyRound(selectedMonthData.assumed.expectedRevenue) }} expected revenue).
          </div>
        </div>
      </section>

      <!-- Reference: the underlying per-area assumptions -->
      <section>
        <div class="section-head">
          <div class="section-label">Assumptions</div>
          <div class="section-note"><NuxtLink to="/capacity/edit">Edit capacity, turns, and per-cover revenue →</NuxtLink></div>
        </div>
        <div class="pl-table-card">
          <table class="pl-table cap-table">
            <caption>Per-area capacity and revenue assumptions</caption>
            <thead>
              <tr>
                <th scope="col">Area</th>
                <th scope="col">Seats</th>
                <th scope="col">Max Turns/Night</th>
                <th scope="col">Capacity Nov–Apr</th>
                <th scope="col">Capacity May–Oct</th>
                <th scope="col">Per-Cover Revenue (Food)</th>
                <th scope="col">Per-Cover Revenue (Beverage)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in data.areas" :key="a.id">
                <th scope="row" style="text-transform: capitalize;">{{ a.name }}</th>
                <td>{{ a.seats }}</td>
                <td>{{ a.max_turns_per_night }}</td>
                <td>{{ a.capacity_nov_apr ?? 'closed' }}</td>
                <td>{{ a.capacity_may_oct }}</td>
                <td class="amount">${{ a.per_cover_revenue_food.toFixed(2) }}</td>
                <td class="amount">${{ a.per_cover_revenue_beverage.toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="legend">
        <span class="chip good">Meeting / exceeding assumption</span>
        <span class="chip warning">Watch</span>
        <span class="chip serious">Off assumption</span>
        <span class="chip critical">Well short</span>
      </div>

      <footer>
        <span>Assumed fill %/per-cover: capacity_areas × capacity_seasonality &middot; Actuals: Toast (covers) and QuickBooks (revenue), synced nightly</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }

/* ---------- quick-look cards ---------- */
.quick-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.assumption-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.assumption-card.anchor { background: var(--accent-wash); border-color: transparent; }
.card-head { display: flex; flex-direction: column; gap: 2px; }
.card-head .period-name { font-size: 13px; font-weight: 700; color: var(--ink); }
.card-head .period-range { font-size: 11px; color: var(--ink-3); }
.metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.metric { display: flex; flex-direction: column; gap: 2px; }
.metric-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.metric-label { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); text-transform: uppercase; }
.metric-figure { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; color: var(--ink); }
.metric-figure.small { font-size: 20px; }
.metric.primary .metric-figure { font-size: 30px; }
.metric-sub { font-size: 11px; color: var(--ink-3); }
.caption { font-size: 11.5px; color: var(--ink-3); border-top: 1px dashed var(--hair); padding-top: 8px; }
.caption strong { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }

.month-detail { margin-top: 10px; }

/* ---------- month tabs (copied from budget/edit.vue) ---------- */
.month-tabs { display: flex; gap: 2px; padding: 0 0 0; overflow-x: auto; margin-bottom: 10px; }
.month-tab {
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  padding: 8px 16px;
  border: 1px solid var(--hair);
  border-radius: 10px;
  background: var(--surface-alt);
  color: var(--ink-2);
  cursor: pointer;
  white-space: nowrap;
}
.month-tab.active { background: var(--accent-wash); color: var(--accent); border-color: transparent; }

/* ---------- reference table (copied from pl/index.vue's .pl-table) ---------- */
.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
  margin-bottom: 14px;
}
table.pl-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
.pl-table caption { display: none; }
.pl-table th, .pl-table td { padding: 12px 16px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-table th:first-child, .pl-table td:first-child { text-align: left; white-space: normal; }
.pl-table thead th { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); border-bottom: 1px solid var(--hair); }
.pl-table tbody th { text-align: left; font-weight: 600; font-size: 13px; color: var(--ink); }
.pl-table tbody tr { border-bottom: 1px solid var(--hair); }
.pl-table tbody tr:last-child { border-bottom: none; }
.pl-table .amount { font-weight: 600; }

.drill-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 960px) {
  .quick-row { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .quick-row { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: 1fr; }
}
</style>
