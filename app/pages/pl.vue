<script setup lang="ts">
import site from '~/config/site.json'
import { benchmarkStatus, netIncome, type CategoryBenchmark } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — P&L` })

const { data, pending, error } = await useFetch('/api/pl')

type Period = 'week' | 'month' | 'year'
const PERIOD_LABEL: Record<Period, string> = { week: 'week', month: 'month', year: 'year' }

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

// ---- Labor drill-down -----------------------------------------------------
const laborPeriod = ref<Period>('month')
const laborRows = computed(() => {
  const rows = data.value?.drilldowns[laborPeriod.value]?.labor ?? []
  const total = rows.reduce((sum, r) => sum + r.amount, 0)
  return rows.map(r => ({
    label: r.label,
    amount: r.amount,
    pctOfLabor: total ? (r.amount / total) * 100 : 0,
    flagNote: r.flagged ? `▲ up from $${Math.round(r.comparisonAmount).toLocaleString()} the prior ${PERIOD_LABEL[laborPeriod.value]}` : undefined
  }))
})
const laborFlagged = computed(() => laborRows.value.some(r => r.flagNote))
const laborRow = computed(() => periodRow(laborPeriod.value))
// Off-target and "nothing flagged" are independent signals — a labor % that's
// over benchmark broadly, with no single subcategory spiking, still needs to
// expand the card (and say so honestly), not collapse to "Nothing unusual"
// just because no individual subcategory happened to jump vs. the prior
// period. laborOffTarget is null-safe: no benchmark configured never forces
// an expand on its own.
const laborOffTarget = computed(() => laborRow.value?.laborStatus != null && laborRow.value.laborStatus !== 'good')
const laborCardExpanded = computed(() => laborFlagged.value || laborOffTarget.value)
const laborCallout = computed(() => {
  const row = laborRow.value
  if (!row) return ''
  const flagged = laborRows.value.filter(r => r.flagNote)
  const onTarget = !laborOffTarget.value
  if (!flagged.length) {
    if (onTarget) return ''
    return `Labor is off target this ${PERIOD_LABEL[laborPeriod.value]} (${(row.laborPct * 100).toFixed(1)}%), but no single subcategory stands out as the driver — costs are elevated broadly.`
  }
  const names = flagged.map(r => r.label).join(', ')
  const isAre = flagged.length > 1 ? 'are' : 'is'
  const tail = onTarget ? ' — worth a look even though the top-line number is on target.' : '.'
  return `Labor is ${onTarget ? 'on target' : 'off target'} overall this ${PERIOD_LABEL[laborPeriod.value]} (${(row.laborPct * 100).toFixed(1)}%), but ${names} ${isAre} up sharply vs. the prior ${PERIOD_LABEL[laborPeriod.value]}${tail}`
})

// ---- Opex drill-down --------------------------------------------------
// Fixed (rent/insurance/loan interest — not controllable month to month, so
// not worth benchmarking) vs. variable/discretionary (the actionable slice,
// benchmarked as 'opex_variable') — see accounts.cost_behavior in schema.sql.
const opexPeriod = ref<Period>('month')
function opexRowsFor(kind: 'opexFixed' | 'opexVariable') {
  const rows = data.value?.drilldowns[opexPeriod.value]?.[kind] ?? []
  const total = rows.reduce((sum, r) => sum + r.amount, 0)
  return rows.map(r => ({
    label: r.label,
    amount: r.amount,
    pctOfGroup: total ? (r.amount / total) * 100 : 0,
    flagNote: r.flagged ? `▲ up from $${Math.round(r.comparisonAmount).toLocaleString()} the prior ${PERIOD_LABEL[opexPeriod.value]}` : undefined
  }))
}
const fixedOpexRows = computed(() => opexRowsFor('opexFixed'))
const variableOpexRows = computed(() => opexRowsFor('opexVariable'))
const fixedOpexTotal = computed(() => fixedOpexRows.value.reduce((sum, r) => sum + r.amount, 0))
const variableOpexTotal = computed(() => variableOpexRows.value.reduce((sum, r) => sum + r.amount, 0))
const opexRevenue = computed(() => data.value?.periods[opexPeriod.value]?.totals.revenue ?? 0)
const fixedOpexPct = computed(() => opexRevenue.value ? (fixedOpexTotal.value / opexRevenue.value) * 100 : 0)
const variableOpexPct = computed(() => opexRevenue.value ? (variableOpexTotal.value / opexRevenue.value) * 100 : 0)
const variableOpexBenchmark = computed(() => benchmarkByCategory.value.opex_variable)
const variableOpexStatus = computed(() => benchmarkStatus(variableOpexPct.value / 100, variableOpexBenchmark.value))
const variableOpexOffTarget = computed(() => variableOpexStatus.value !== null && variableOpexStatus.value !== 'good')
const opexFlagged = computed(() => [...fixedOpexRows.value, ...variableOpexRows.value].some(r => r.flagNote))
// Same independence as laborCardExpanded above: off-target variable opex
// with no single subcategory spike still needs to expand and say so, not
// collapse to "Nothing unusual".
const opexCardExpanded = computed(() => opexFlagged.value || variableOpexOffTarget.value)
const opexCallout = computed(() => {
  const flagged = variableOpexRows.value.filter(r => r.flagNote)
  const target = variableOpexBenchmark.value
  const targetLabel = target ? `${(target.targetPct * 100).toFixed(0)}–${(target.warningPct * 100).toFixed(0)}%` : 'target'
  if (!flagged.length) {
    if (!variableOpexOffTarget.value) return ''
    return `Variable/discretionary opex is running above target this ${PERIOD_LABEL[opexPeriod.value]} (${variableOpexPct.value.toFixed(1)}% vs. ${targetLabel}), but no single subcategory stands out as the driver — costs are elevated broadly. Fixed costs ($${Math.round(fixedOpexTotal.value).toLocaleString()}, ${fixedOpexPct.value.toFixed(1)}% of revenue) are excluded from this benchmark since they aren't controllable month to month.`
  }
  const names = flagged.map(r => r.label).join(', ')
  return `Variable/discretionary opex is ${variableOpexOffTarget.value ? 'running above target' : 'within target'} this ${PERIOD_LABEL[opexPeriod.value]} (${variableOpexPct.value.toFixed(1)}% vs. ${targetLabel}) — driven mostly by ${names}. Fixed costs ($${Math.round(fixedOpexTotal.value).toLocaleString()}, ${fixedOpexPct.value.toFixed(1)}% of revenue) are excluded from this benchmark since they aren't controllable month to month.`
})

// ---- Revenue drill-down ---------------------------------------------------
// Every day in the period compared to the same weekday one week earlier —
// applies the Dashboard's single-day "last night vs. last week" comparison
// to every day in the selected period instead of just last night.
const revenuePeriod = ref<Period>('month')
const revenueDays = computed(() => data.value?.drilldowns[revenuePeriod.value]?.revenueDays ?? [])
const shortfallDays = computed(() => revenueDays.value
  .filter(d => d.actual < d.comparison)
  .map(d => {
    const deltaPct = ((d.actual - d.comparison) / d.comparison) * 100
    return { ...d, deltaPct, barWidth: Math.min(100, Math.abs(deltaPct) * 4) }
  })
  .sort((a, b) => a.deltaPct - b.deltaPct))
const revenueFlagged = computed(() => shortfallDays.value.length > 0)
const revenueGapTotal = computed(() => shortfallDays.value.reduce((sum, d) => sum + (d.comparison - d.actual), 0))
const revenueCallout = computed(() => {
  const total = revenueDays.value.length
  const met = total - shortfallDays.value.length
  if (!total) return ''
  return `${met} of ${total} days this ${PERIOD_LABEL[revenuePeriod.value]} met or beat their same-weekday-last-week comparison. The shortfall is concentrated in ${shortfallDays.value.length} day${shortfallDays.value.length === 1 ? '' : 's'} below — combined, they account for $${Math.round(revenueGapTotal.value).toLocaleString()} of the gap.`
})
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
          <div class="section-note">COGS%, labor%, and prime cost colored against configurable benchmarks — see legend below</div>
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

      <!-- Drill-down: what's driving labor cost -->
      <section>
        <div class="section-head">
          <div class="section-label">Labor Drill-Down — What's Driving the Cost</div>
          <div class="period-tabs">
            <span :class="['period-tab', laborPeriod === 'week' && 'active']" @click="laborPeriod = 'week'">Week</span>
            <span :class="['period-tab', laborPeriod === 'month' && 'active']" @click="laborPeriod = 'month'">Month</span>
            <span :class="['period-tab', laborPeriod === 'year' && 'active']" @click="laborPeriod = 'year'">Year</span>
          </div>
        </div>

        <div v-if="laborCardExpanded" class="drill-card">
          <div class="callout">{{ laborCallout }}</div>
          <div class="rank-list">
            <div v-for="row in laborRows" :key="row.label" class="rank-row">
              <div class="label">{{ row.label }}<span v-if="row.flagNote" class="flag serious">{{ row.flagNote }}</span></div>
              <div class="rank-track"><div :class="['rank-fill', row.flagNote ? 'serious' : 'neutral']" :style="{ width: row.pctOfLabor + '%' }"></div></div>
              <div class="rank-value">${{ Math.round(row.amount).toLocaleString() }}<span class="sub">{{ row.pctOfLabor.toFixed(1) }}% of labor</span></div>
            </div>
          </div>
        </div>
        <div v-else-if="laborRows.length" class="drill-card quiet">
          <span class="chip good">Nothing unusual</span>
          <span class="quiet-note">Labor is within target this {{ laborPeriod }}, and no single cost driver stands out.</span>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning">No data</span>
          <span class="quiet-note">No labor data synced for this {{ laborPeriod }} yet.</span>
        </div>
      </section>

      <!-- Drill-down: what's driving opex -->
      <section>
        <div class="section-head">
          <div class="section-label">Operating Cost Drill-Down — What's Driving the Cost</div>
          <div class="period-tabs">
            <span :class="['period-tab', opexPeriod === 'week' && 'active']" @click="opexPeriod = 'week'">Week</span>
            <span :class="['period-tab', opexPeriod === 'month' && 'active']" @click="opexPeriod = 'month'">Month</span>
            <span :class="['period-tab', opexPeriod === 'year' && 'active']" @click="opexPeriod = 'year'">Year</span>
          </div>
        </div>

        <div v-if="opexCardExpanded && (fixedOpexRows.length || variableOpexRows.length)" class="drill-card">
          <div class="callout">{{ opexCallout }}</div>
          <div class="rank-list">
            <div class="rank-group-head">
              <span class="rank-group-label">Fixed<span class="rank-group-note">not benchmarked</span></span>
              <span class="rank-group-total">${{ Math.round(fixedOpexTotal).toLocaleString() }} &middot; {{ fixedOpexPct.toFixed(1) }}% of rev.</span>
            </div>
            <div v-for="row in fixedOpexRows" :key="row.label" class="rank-row">
              <div class="label">{{ row.label }}<span v-if="row.flagNote" class="flag serious">{{ row.flagNote }}</span></div>
              <div class="rank-track"><div :class="['rank-fill', row.flagNote ? 'serious' : 'neutral']" :style="{ width: row.pctOfGroup + '%' }"></div></div>
              <div class="rank-value">${{ Math.round(row.amount).toLocaleString() }}<span class="sub">{{ row.pctOfGroup.toFixed(1) }}% of fixed</span></div>
            </div>

            <div class="rank-group-head">
              <span class="rank-group-label">Variable / discretionary</span>
              <span class="rank-group-total">
                ${{ Math.round(variableOpexTotal).toLocaleString() }} &middot; {{ variableOpexPct.toFixed(1) }}% of rev.
                <span v-if="variableOpexStatus" :class="['chip', variableOpexOffTarget ? 'serious' : 'good']">{{ variableOpexOffTarget ? 'Off target' : 'On target' }}</span>
              </span>
            </div>
            <div v-for="row in variableOpexRows" :key="row.label" class="rank-row">
              <div class="label">{{ row.label }}<span v-if="row.flagNote" class="flag serious">{{ row.flagNote }}</span></div>
              <div class="rank-track"><div :class="['rank-fill', row.flagNote ? 'serious' : 'neutral']" :style="{ width: row.pctOfGroup + '%' }"></div></div>
              <div class="rank-value">${{ Math.round(row.amount).toLocaleString() }}<span class="sub">{{ row.pctOfGroup.toFixed(1) }}% of variable</span></div>
            </div>
          </div>
        </div>
        <div v-else-if="fixedOpexRows.length || variableOpexRows.length" class="drill-card quiet">
          <span class="chip good">Nothing unusual</span>
          <span class="quiet-note">Variable/discretionary opex is within target this {{ opexPeriod }}, and no single cost driver stands out.</span>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning">No data</span>
          <span class="quiet-note">No operating expense data synced for this {{ opexPeriod }} yet.</span>
        </div>
      </section>

      <!-- Drill-down: where revenue fell short -->
      <section>
        <div class="section-head">
          <div class="section-label">Revenue Drill-Down — Where It Fell Short</div>
          <div class="period-tabs">
            <span :class="['period-tab', revenuePeriod === 'week' && 'active']" @click="revenuePeriod = 'week'">Week</span>
            <span :class="['period-tab', revenuePeriod === 'month' && 'active']" @click="revenuePeriod = 'month'">Month</span>
            <span :class="['period-tab', revenuePeriod === 'year' && 'active']" @click="revenuePeriod = 'year'">Year</span>
          </div>
        </div>

        <div v-if="revenueFlagged" class="drill-card">
          <div class="callout">{{ revenueCallout }}</div>
          <div class="rank-list">
            <div v-for="day in shortfallDays" :key="day.date" class="day-row">
              <div class="date">{{ formatWeekdayDate(day.date) }}<span class="sub">vs. {{ formatWeekdayDate(day.comparisonDate) }}</span></div>
              <div class="rank-track"><div :class="['rank-fill', day.barWidth > 75 ? 'critical' : 'serious']" :style="{ width: day.barWidth + '%' }"></div></div>
              <div class="amounts"><strong>${{ Math.round(day.actual).toLocaleString() }}</strong> vs. ${{ Math.round(day.comparison).toLocaleString() }}</div>
              <div :class="['chip', day.barWidth > 75 ? 'critical' : 'serious']">▼ {{ Math.abs(day.deltaPct).toFixed(1) }}%</div>
            </div>
          </div>
        </div>
        <div v-else-if="revenueDays.length" class="drill-card quiet">
          <span class="chip good">Nothing unusual</span>
          <span class="quiet-note">All days this {{ revenuePeriod }} met or beat their same-weekday-last-week comparison.</span>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning">No data</span>
          <span class="quiet-note">Not enough history yet to compare this {{ revenuePeriod }} against the same weekday last week.</span>
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

/* ---------- period pill selector (drill-down sections) ---------- */
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
.period-tab.active {
  background: var(--accent-wash);
  color: var(--accent);
  border-color: transparent;
}

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

/* ---------- ranked drill-down list ---------- */
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
.drill-card.quiet {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
}
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.drill-card .callout {
  font-size: 12.5px;
  color: var(--ink-2);
  background: var(--surface-alt);
  border-radius: 10px;
  padding: 10px 12px;
  line-height: 1.5;
}
.rank-list { display: flex; flex-direction: column; gap: 12px; }
.rank-group-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding-top: 6px;
  border-top: 1px solid var(--hair);
}
.rank-group-head:first-child { padding-top: 0; border-top: none; }
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
.rank-row {
  display: grid;
  grid-template-columns: 150px 1fr 100px;
  align-items: center;
  gap: 12px;
}
.rank-row .label { font-size: 13px; font-weight: 600; }
.rank-row .label .flag {
  display: block;
  font-size: 11px;
  font-weight: 700;
  margin-top: 2px;
}
.rank-row .label .flag.serious { color: var(--serious); }
.rank-track {
  position: relative;
  height: 9px;
  border-radius: 5px;
  background: var(--surface-alt);
}
.rank-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 5px; }
/* These bars show share-of-group (% of labor / fixed / variable), not a
   good/bad judgment, so they deliberately don't use the reserved status
   palette (good/warning/serious/critical) — using --accent (the app's
   existing neutral-emphasis color, e.g. the active period tab) instead of
   flat gray keeps them legible without implying a benchmark verdict. */
.rank-fill.neutral { background: var(--accent); opacity: 0.55; }
.rank-fill.serious { background: var(--serious); }
.rank-fill.critical { background: var(--critical); }
.rank-value { font-size: 13px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.rank-value .sub { display: block; font-size: 11px; font-weight: 500; color: var(--ink-3); }

.day-row {
  display: grid;
  grid-template-columns: 130px 1fr 110px 80px;
  align-items: center;
  gap: 12px;
}
.day-row .date { font-size: 13px; font-weight: 600; }
.day-row .date .sub { display: block; font-size: 11px; color: var(--ink-3); font-weight: 500; }
.day-row .amounts { font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.day-row .amounts strong { color: var(--ink); font-weight: 700; }

@media (max-width: 760px) {
  .rank-row { grid-template-columns: 100px 1fr 84px; }
  .day-row { grid-template-columns: 1fr; row-gap: 4px; }
  .day-row .amounts { order: 3; }
}
</style>
