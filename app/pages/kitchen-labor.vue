<script setup lang="ts">
import site from '~/config/site.json'

useHead({ title: `${site.restaurantName} — Kitchen Labor` })

type Revenue = { restaurant: number, events: number, catering: number, retail: number, total: number }
type Week = {
  weekStart: string
  weekEnd: string
  payrollDate: string
  hasPayroll: boolean
  revenue: Revenue
  laborBoh: number
  laborOvertime: number
  laborExecChef: number
}
type KitchenLabor =
  | { hasData: false }
  | {
    hasData: true
    asOf: string
    streams: { key: string, label: string }[]
    offCycleLabor: number
    weeks: Week[]
  }

const { data, pending, error, refresh } = await useFetch<KitchenLabor>('/api/kitchen-labor')

// The Executive Chef is salaried owner compensation; including them moves the
// ratio a lot, so it's a toggle, off by default (user's call 2026-10-27).
// The view (chart or table) defaults to chart. Both are per-viewer
// conveniences only, so localStorage is optional.
const includeExecChef = ref(false)
// Overtime (BOH OT) defaults on, matching how the page counted labor before it
// became a toggle.
const includeOvertime = ref(true)
const view = ref<'chart' | 'table'>('chart')
onMounted(() => {
  try {
    const v = localStorage.getItem('kitchen-labor-include-exec-chef')
    if (v !== null) includeExecChef.value = v === '1'
    const ot = localStorage.getItem('kitchen-labor-include-overtime')
    if (ot !== null) includeOvertime.value = ot === '1'
    const w = localStorage.getItem('kitchen-labor-view')
    if (w === 'chart' || w === 'table') view.value = w
  } catch {}
})
watch(includeExecChef, (v) => {
  try { localStorage.setItem('kitchen-labor-include-exec-chef', v ? '1' : '0') } catch {}
})
watch(includeOvertime, (v) => {
  try { localStorage.setItem('kitchen-labor-include-overtime', v ? '1' : '0') } catch {}
})
watch(view, (v) => {
  try { localStorage.setItem('kitchen-labor-view', v) } catch {}
})

function formatDate(s: string, withYear = false) {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC'
  })
}
const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString()}`
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`

const laborOf = (w: Week) => w.laborBoh + (includeOvertime.value ? w.laborOvertime : 0) + (includeExecChef.value ? w.laborExecChef : 0)

type Row = Week & { labor: number, pct: number | null, otPct: number | null, deltaPts: number | null }

// Newest first. Weeks without payroll (or without revenue) have no percent.
const rows = computed<Row[]>(() => {
  const d = data.value
  if (!d || !d.hasData) return []
  const out: Row[] = d.weeks.map((w) => {
    const labor = laborOf(w)
    const pct = w.hasPayroll && w.revenue.total > 0 ? labor / w.revenue.total : null
    const otPct = w.hasPayroll && w.revenue.total > 0 ? w.laborOvertime / w.revenue.total : null
    return { ...w, labor, pct, otPct, deltaPts: null }
  })
  // Change vs. the prior week, only when both weeks have a percent.
  for (let i = 1; i < out.length; i++) {
    const cur = out[i]!, prev = out[i - 1]!
    if (cur.pct !== null && prev.pct !== null) cur.deltaPts = (cur.pct - prev.pct) * 100
  }
  return out.reverse()
})

// Oldest first, for the chart's left-to-right time axis.
const chartPoints = computed(() => [...rows.value].reverse().map(r => ({
  weekStart: r.weekStart,
  weekEnd: r.weekEnd,
  pct: r.pct,
  labor: r.labor,
  otPct: r.otPct,
  overtime: r.laborOvertime,
  revenue: r.revenue.total
})))

const scored = computed(() => rows.value.filter(r => r.pct !== null))
const latest = computed(() => scored.value[0] ?? null)
const awaiting = computed(() => rows.value.find(r => !r.hasPayroll) ?? null)

// Weighted (total labor ÷ total revenue), not an average of weekly percents,
// so a slow week doesn't count the same as a busy one.
function trailing(n: number) {
  const slice = scored.value.slice(0, n)
  if (slice.length < n) return null
  const labor = slice.reduce((s, r) => s + r.labor, 0)
  const rev = slice.reduce((s, r) => s + r.revenue.total, 0)
  return rev > 0 ? { pct: labor / rev, labor, rev } : null
}
const trailing4 = computed(() => trailing(4))
const trailing13 = computed(() => trailing(13))

function streamBreakdown(r: Week, streams: { key: string, label: string }[]) {
  return streams
    .filter(s => (r.revenue as Record<string, number>)[s.key] !== 0)
    .map(s => `${s.label} ${fmtMoney((r.revenue as Record<string, number>)[s.key]!)}`)
    .join(' · ')
}

function fmtDelta(v: number) {
  return `${v >= 0 ? '▲ +' : '▼ −'}${Math.abs(v).toFixed(1)} pts`
}
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading kitchen labor…</div>
    <div v-else-if="error" class="note-card">
      <span class="chip critical">Couldn't load kitchen labor</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>

    <template v-else-if="data">
      <PageHeader
        page-name="Kitchen Labor"
        description="BOH chefs and cooks as a percent of food revenue, by week"
        :as-of-label="data.hasData ? formatDate(data.asOf) : undefined"
        @synced="refresh()"
      />

      <section v-if="!data.hasData" class="note-card">
        <span class="chip warning">No data synced yet</span>
      </section>

      <template v-else>
        <section class="summary-row">
          <div class="summary-card">
            <div class="summary-label">Latest week</div>
            <template v-if="latest">
              <div class="summary-figure">{{ fmtPct(latest.pct!) }}</div>
              <div class="summary-sub">
                {{ formatDate(latest.weekStart) }} – {{ formatDate(latest.weekEnd) }}
                <span v-if="latest.deltaPts !== null"> · {{ fmtDelta(latest.deltaPts) }} vs. prior week</span>
              </div>
            </template>
            <div v-else class="summary-sub">No week with payroll yet</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Last 4 weeks</div>
            <template v-if="trailing4">
              <div class="summary-figure">{{ fmtPct(trailing4.pct) }}</div>
              <div class="summary-sub">{{ fmtMoney(trailing4.labor) }} on {{ fmtMoney(trailing4.rev) }} food revenue</div>
            </template>
            <div v-else class="summary-sub">Needs 4 weeks of payroll</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Last 13 weeks</div>
            <template v-if="trailing13">
              <div class="summary-figure">{{ fmtPct(trailing13.pct) }}</div>
              <div class="summary-sub">{{ fmtMoney(trailing13.labor) }} on {{ fmtMoney(trailing13.rev) }} food revenue</div>
            </template>
            <div v-else class="summary-sub">Needs 13 weeks of payroll</div>
          </div>
        </section>

        <section v-if="awaiting" class="note-card">
          <span class="chip warning">Awaiting payroll</span>
          <span class="quiet-note">
            {{ formatDate(awaiting.weekStart) }} – {{ formatDate(awaiting.weekEnd) }} labor posts with the {{ formatDate(awaiting.payrollDate) }} payroll and shows here after the next sync.
          </span>
        </section>

        <section>
          <div class="section-head">
            <div class="section-label">Week by week</div>
            <div class="section-note">
              Each week's hours (paid the Friday after) against the same Monday–Sunday week's food revenue.
            </div>
          </div>
          <div class="controls">
            <label class="toggle">
              <input v-model="includeOvertime" type="checkbox">
              Include overtime (BOH OT)
            </label>
            <label class="toggle">
              <input v-model="includeExecChef" type="checkbox">
              Include Executive Chef (salaried, owner compensation)
            </label>
            <div class="view-switch" role="group" aria-label="Chart or table">
              <button type="button" :class="{ active: view === 'chart' }" :aria-pressed="view === 'chart'" @click="view = 'chart'">Chart</button>
              <button type="button" :class="{ active: view === 'table' }" :aria-pressed="view === 'table'" @click="view = 'table'">Table</button>
            </div>
          </div>
          <template v-if="view === 'chart'">
          <div class="table-card chart-card">
            <KitchenLaborChart
              :points="chartPoints"
              label="Line chart of kitchen labor as a percent of food revenue, by week"
            />
          </div>
          <div class="chart-title">Overtime alone (BOH OT), % of food revenue</div>
          <div class="table-card chart-card">
            <KitchenLaborChart
              :points="chartPoints"
              metric="overtime"
              label="Line chart of BOH overtime as a percent of food revenue, by week"
            />
          </div>
          </template>
          <div v-else class="table-card">
            <table class="pl-table">
              <caption>Kitchen labor as a percent of food revenue, by week</caption>
              <thead>
                <tr>
                  <th scope="col">Week (Mon–Sun)</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Food revenue</th>
                  <th scope="col">Kitchen labor</th>
                  <th scope="col">Labor %</th>
                  <th scope="col">Overtime</th>
                  <th scope="col">Overtime %</th>
                  <th scope="col">vs. prior week</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in rows" :key="r.weekStart">
                  <th scope="row">
                    {{ formatDate(r.weekStart) }} – {{ formatDate(r.weekEnd) }}
                    <span class="hint">{{ streamBreakdown(r, data.streams) }}</span>
                  </th>
                  <td>{{ formatDate(r.payrollDate) }}</td>
                  <td>{{ fmtMoney(r.revenue.total) }}</td>
                  <td v-if="r.hasPayroll">{{ fmtMoney(r.labor) }}</td>
                  <td v-else class="muted">Awaiting payroll</td>
                  <td class="amount">{{ r.pct !== null ? fmtPct(r.pct) : '—' }}</td>
                  <td v-if="r.hasPayroll">{{ fmtMoney(r.laborOvertime) }}</td>
                  <td v-else class="muted">—</td>
                  <td class="muted">{{ r.otPct !== null ? fmtPct(r.otPct) : '—' }}</td>
                  <td class="muted">{{ r.deltaPts !== null ? fmtDelta(r.deltaPts) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="footnotes">
          <div class="section-label">What's counted</div>
          <ul>
            <li><strong>Labor:</strong> wages under BOH Wages (cooks, chefs, sous and pastry, service charge distribution{{ includeOvertime ? ', BOH overtime' : '' }}), excluding Porter{{ includeExecChef ? ', plus the Executive Chef' : '' }}. Payroll taxes, benefits and bonuses are not included.</li>
            <li><strong>Food revenue:</strong> restaurant food, event food (on-site and off-site), catering food and retail food. Beverage, service and equipment fees, and retail non-food are left out, and discounts &amp; comps can't be split between food and beverage, so revenue is before them.</li>
            <li v-if="data.offCycleLabor > 0.5"><strong>Off-cycle postings:</strong> {{ fmtMoney(data.offCycleLabor) }} of kitchen labor was posted on days other than a Friday; each is counted with the next Friday's payroll.</li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }
.note-card {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.quiet-note { color: var(--ink-2); font-size: 13px; }

.summary-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.summary-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 20px;
}
.summary-label { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); text-transform: uppercase; }
.summary-figure { font-size: 34px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; margin: 4px 0; }
.summary-sub { font-size: 12px; color: var(--ink-2); }

.chart-title { font-size: 12px; font-weight: 700; color: var(--ink-2); margin: 14px 0 6px; }
.controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin: 0 0 10px; }
.toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); cursor: pointer; }
.view-switch { display: inline-flex; border: 1px solid var(--hair); border-radius: 8px; overflow: hidden; }
.view-switch button {
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  padding: 5px 14px;
  border: none;
  background: var(--surface-alt);
  color: var(--ink-2);
  cursor: pointer;
}
.view-switch button + button { border-left: 1px solid var(--hair); }
.view-switch button.active { background: var(--accent); color: white; }
.chart-card { padding: 16px 12px 8px; }

.table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px;
  overflow-x: auto;
}
table.pl-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 640px; }
.pl-table caption { display: none; }
.pl-table th, .pl-table td { padding: 12px 16px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-table th:first-child { text-align: left; white-space: normal; }
.pl-table thead th { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); border-bottom: 1px solid var(--hair); }
.pl-table tbody th { font-weight: 600; font-size: 13px; color: var(--ink); }
.pl-table tbody tr { border-bottom: 1px solid var(--hair); }
.pl-table tbody tr:last-child { border-bottom: none; }
.pl-table .amount { font-weight: 700; color: var(--ink); }
.pl-table .muted { color: var(--ink-3); }
.pl-table .hint { display: block; margin-top: 2px; font-size: 11px; font-weight: 400; color: var(--ink-3); }

.footnotes { margin-top: 24px; }
.footnotes ul { margin: 8px 0 0; padding-left: 18px; color: var(--ink-2); font-size: 13px; line-height: 1.5; }
.footnotes li + li { margin-top: 6px; }
</style>
