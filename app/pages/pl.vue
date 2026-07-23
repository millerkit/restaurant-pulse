<script setup lang="ts">
import site from '~/config/site.json'
useHead({ title: `${site.restaurantName} — P&L` })

// Shaped like a sync_runs row so this collapses into a real useDb() query
// later without changing the template logic — see schema.sql.
const lastSync = { status: 'success' as 'success' | 'error', finishedAt: 'today, 3:04 AM', dataThroughDate: 'Jul 16' }
const syncFailed = computed(() => lastSync.status === 'error')

// Sample data shaped the way it'll eventually come from useDb() — each row
// carries what it needs to compute its own flagged state, rather than a
// bare hardcoded boolean, so the "nothing unusual" collapse is driven by
// the data instead of asserted separately from it.
const laborRows = [
  { label: 'FOH wages', amount: '$13,400', pctOfLabor: 36.0 },
  { label: 'BOH wages', amount: '$12,100', pctOfLabor: 32.5 },
  { label: 'Management', amount: '$5,600', pctOfLabor: 15.1 },
  { label: 'Overtime', amount: '$3,800', pctOfLabor: 10.2, flagNote: '▲ nearly 2× last month' },
  { label: 'Benefits & payroll tax', amount: '$2,300', pctOfLabor: 6.2 }
]
const laborFlagged = computed(() => laborRows.some(r => r.flagNote))

const revenueDays = [
  { date: 'Mon, Jul 13', vsDate: 'Mon, Jul 6', actual: 6200, comparison: 7900 },
  { date: 'Wed, Jul 8', vsDate: 'Wed, Jul 1', actual: 7100, comparison: 8650 },
  { date: 'Sun, Jul 12', vsDate: 'Sun, Jun 21', vsFootnote: true, actual: 9300, comparison: 10750 }
]
const shortfallDays = computed(() => revenueDays
  .filter(d => d.actual < d.comparison)
  .map(d => {
    const deltaPct = ((d.actual - d.comparison) / d.comparison) * 100
    return { ...d, deltaPct, barWidth: Math.min(100, Math.abs(deltaPct) * 4) }
  }))
const revenueFlagged = computed(() => shortfallDays.value.length > 0)

// Opex gets the same subcategory treatment as labor, but split fixed
// (rent/insurance/loan interest — not controllable month to month, so not
// worth benchmarking) from variable/discretionary (marketing/repairs/
// supplies/admin — the actionable slice, benchmarked as 'opex_variable').
const monthRevenue = 118400
const variableOpexTargetMax = 10 // upper bound of the 8–10% target band
type OpexRow = { label: string, amount: number, group: 'fixed' | 'variable', flagNote?: string }
const opexRows: OpexRow[] = [
  { label: 'Rent', amount: 14000, group: 'fixed' },
  { label: 'Insurance', amount: 3200, group: 'fixed' },
  { label: 'Loan interest', amount: 2100, group: 'fixed' },
  { label: 'Marketing', amount: 4800, group: 'variable' },
  { label: 'Repairs & maintenance', amount: 2900, group: 'variable', flagNote: '▲ vs. $900 same period last month' },
  { label: 'Supplies', amount: 2600, group: 'variable' },
  { label: 'Admin & software', amount: 3100, group: 'variable' }
]
const fixedOpexRows = computed(() => opexRows.filter(r => r.group === 'fixed'))
const variableOpexRows = computed(() => opexRows.filter(r => r.group === 'variable'))
const fixedOpexTotal = computed(() => fixedOpexRows.value.reduce((sum, r) => sum + r.amount, 0))
const variableOpexTotal = computed(() => variableOpexRows.value.reduce((sum, r) => sum + r.amount, 0))
const fixedOpexPct = computed(() => (fixedOpexTotal.value / monthRevenue) * 100)
const variableOpexPct = computed(() => (variableOpexTotal.value / monthRevenue) * 100)
const variableOpexOffTarget = computed(() => variableOpexPct.value > variableOpexTargetMax)
const opexFlagged = computed(() => opexRows.some(r => r.flagNote))
function pctOfOpexGroup(row: OpexRow) {
  const groupTotal = row.group === 'fixed' ? fixedOpexTotal.value : variableOpexTotal.value
  return (row.amount / groupTotal) * 100
}
</script>

<template>
  <div>
    <header>
      <div>
        <h1>{{ site.restaurantName }} — P&amp;L</h1>
        <div class="sub">Week, month, and year to date &middot; reporting through last night's close (Thu, Jul 16)</div>
      </div>
      <div class="as-of">
        <span :class="['chip', syncFailed ? 'critical' : 'good']"><span class="dot"></span>{{ syncFailed ? 'Sync failed' : 'Sync healthy' }}</span>
        <div class="sync-line">
          <template v-if="!syncFailed">Last synced from QuickBooks: <strong>{{ lastSync.finishedAt }}</strong></template>
          <template v-else>Sync failed — showing data through <strong>{{ lastSync.dataThroughDate }}</strong></template>
        </div>
        <span class="sample-tag">Sample data — for review</span>
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
              <th scope="col">This Week<span class="range">Jul 13–16 (4 days)</span></th>
              <th scope="col">This Month<span class="range">Jul 1–16 (16 days)</span></th>
              <th scope="col">This Year<span class="range">Jan 1–Jul 16</span></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Revenue</th>
              <td class="amount">$31,800</td>
              <td class="amount">$118,400</td>
              <td class="amount">$1,612,000</td>
            </tr>
            <tr>
              <th scope="row">COGS</th>
              <td><span class="amount">$10,600</span><span class="pct critical">33.3% of rev.</span></td>
              <td><span class="amount">$39,200</span><span class="pct critical">33.1% of rev.</span></td>
              <td><span class="amount">$480,400</span><span class="pct good">29.8% of rev.</span></td>
            </tr>
            <tr>
              <th scope="row">Labor</th>
              <td><span class="amount">$9,950</span><span class="pct good">31.3% of rev.</span></td>
              <td><span class="amount">$37,200</span><span class="pct good">31.4% of rev.</span></td>
              <td><span class="amount">$498,100</span><span class="pct good">30.9% of rev.</span></td>
            </tr>
            <tr class="subtotal">
              <th scope="row">Prime cost <span class="hint">(COGS + labor)</span></th>
              <td><span class="amount">$20,550</span><span class="pct serious">64.6% of rev.</span></td>
              <td><span class="amount">$76,400</span><span class="pct serious">64.5% of rev.</span></td>
              <td><span class="amount">$978,500</span><span class="pct good">60.7% of rev.</span></td>
            </tr>
            <tr>
              <th scope="row">Operating expenses <span class="hint">(see drill-down)</span></th>
              <td class="amount">$4,200</td>
              <td class="amount">$32,700</td>
              <td class="amount">$572,300</td>
            </tr>
            <tr class="total">
              <th scope="row">Net income</th>
              <td><span class="net-figure good">+$7,050</span></td>
              <td><span class="net-figure good">+$9,300</span></td>
              <td><span class="net-figure good">+$61,200</span></td>
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
          <span class="period-tab">Week</span>
          <span class="period-tab active">Month</span>
          <span class="period-tab">Year</span>
        </div>
      </div>

      <div v-if="laborFlagged" class="drill-card">
        <div class="callout">
          Labor is on target overall this month (31.4%), but <strong>overtime is up sharply</strong> —
          $3,800 this month vs. $2,050 over the same 16 days last month, nearly doubling its share
          of total labor spend. Worth a look even though the top-line number is green.
        </div>
        <div class="rank-list">
          <div v-for="row in laborRows" :key="row.label" class="rank-row">
            <div class="label">{{ row.label }}<span v-if="row.flagNote" class="flag serious">{{ row.flagNote }}</span></div>
            <div class="rank-track"><div :class="['rank-fill', row.flagNote ? 'serious' : 'neutral']" :style="{ width: row.pctOfLabor + '%' }"></div></div>
            <div class="rank-value">{{ row.amount }}<span class="sub">{{ row.pctOfLabor.toFixed(1) }}% of labor</span></div>
          </div>
        </div>
      </div>
      <div v-else class="drill-card quiet">
        <span class="chip good"><span class="dot"></span>Nothing unusual</span>
        <span class="quiet-note">Labor is within target this month, and no single cost driver stands out.</span>
      </div>
    </section>

    <!-- Drill-down: what's driving opex -->
    <section>
      <div class="section-head">
        <div class="section-label">Operating Cost Drill-Down — What's Driving the Cost</div>
        <div class="period-tabs">
          <span class="period-tab">Week</span>
          <span class="period-tab active">Month</span>
          <span class="period-tab">Year</span>
        </div>
      </div>

      <div v-if="opexFlagged" class="drill-card">
        <div class="callout">
          Variable/discretionary opex is running above target this month ({{ variableOpexPct.toFixed(1) }}% vs.
          8–10%) — driven mostly by <strong>Repairs &amp; maintenance</strong> ($2,900 vs. $900 same period last
          month), likely the walk-in cooler repair. Fixed costs (rent, insurance, loan interest — ${{ fixedOpexTotal.toLocaleString() }},
          {{ fixedOpexPct.toFixed(1) }}% of revenue) are steady and excluded from this benchmark since they aren't
          controllable month to month.
        </div>
        <div class="rank-list">
          <div class="rank-group-head">
            <span class="rank-group-label">Fixed<span class="rank-group-note">not benchmarked</span></span>
            <span class="rank-group-total">${{ fixedOpexTotal.toLocaleString() }} &middot; {{ fixedOpexPct.toFixed(1) }}% of rev.</span>
          </div>
          <div v-for="row in fixedOpexRows" :key="row.label" class="rank-row">
            <div class="label">{{ row.label }}</div>
            <div class="rank-track"><div class="rank-fill neutral" :style="{ width: pctOfOpexGroup(row) + '%' }"></div></div>
            <div class="rank-value">${{ row.amount.toLocaleString() }}<span class="sub">{{ pctOfOpexGroup(row).toFixed(1) }}% of fixed</span></div>
          </div>

          <div class="rank-group-head">
            <span class="rank-group-label">Variable / discretionary</span>
            <span class="rank-group-total">
              ${{ variableOpexTotal.toLocaleString() }} &middot; {{ variableOpexPct.toFixed(1) }}% of rev.
              <span :class="['chip', variableOpexOffTarget ? 'serious' : 'good']"><span class="dot"></span>{{ variableOpexOffTarget ? 'Off target' : 'On target' }}</span>
            </span>
          </div>
          <div v-for="row in variableOpexRows" :key="row.label" class="rank-row">
            <div class="label">{{ row.label }}<span v-if="row.flagNote" class="flag serious">{{ row.flagNote }}</span></div>
            <div class="rank-track"><div :class="['rank-fill', row.flagNote ? 'serious' : 'neutral']" :style="{ width: pctOfOpexGroup(row) + '%' }"></div></div>
            <div class="rank-value">${{ row.amount.toLocaleString() }}<span class="sub">{{ pctOfOpexGroup(row).toFixed(1) }}% of variable</span></div>
          </div>
        </div>
      </div>
      <div v-else class="drill-card quiet">
        <span class="chip good"><span class="dot"></span>Nothing unusual</span>
        <span class="quiet-note">Variable/discretionary opex is within target this month, and no single cost driver stands out.</span>
      </div>
    </section>

    <!-- Drill-down: where revenue fell short -->
    <section>
      <div class="section-head">
        <div class="section-label">Revenue Drill-Down — Where It Fell Short</div>
        <div class="period-tabs">
          <span class="period-tab">Week</span>
          <span class="period-tab active">Month</span>
          <span class="period-tab">Year</span>
        </div>
      </div>

      <div v-if="revenueFlagged" class="drill-card">
        <div class="callout">
          11 of 16 days this month met or beat their same-weekday comparison. The shortfall is
          <strong>concentrated in {{ shortfallDays.length }} days</strong> below, not spread evenly across the month —
          combined, they account for $4,900 of the gap to budget pace.
        </div>
        <div class="rank-list">
          <div v-for="day in shortfallDays" :key="day.date" class="day-row">
            <div class="date">{{ day.date }}<span class="sub">vs. {{ day.vsDate }}<sup v-if="day.vsFootnote">*</sup></span></div>
            <div class="rank-track"><div :class="['rank-fill', day.barWidth > 75 ? 'critical' : 'serious']" :style="{ width: day.barWidth + '%' }"></div></div>
            <div class="amounts"><strong>${{ day.actual.toLocaleString() }}</strong> vs. ${{ day.comparison.toLocaleString() }}</div>
            <div :class="['chip', day.barWidth > 75 ? 'critical' : 'serious']"><span class="dot"></span>▼ {{ Math.abs(day.deltaPct).toFixed(1) }}%</div>
          </div>
        </div>
        <div v-if="shortfallDays.some(d => d.vsFootnote)" class="section-note">* same weekday-position last month (3rd Sunday), not a fixed day-count offset</div>
      </div>
      <div v-else class="drill-card quiet">
        <span class="chip good"><span class="dot"></span>Nothing unusual</span>
        <span class="quiet-note">All days this month met or beat their same-weekday comparison.</span>
      </div>
    </section>

    <div class="legend">
      <span class="chip good"><span class="dot"></span>Within benchmark</span>
      <span class="chip warning"><span class="dot"></span>Watch</span>
      <span class="chip serious"><span class="dot"></span>Off benchmark</span>
      <span class="chip critical"><span class="dot"></span>Over benchmark</span>
    </div>

    <footer>
      <span>Data source: QuickBooks Online, synced nightly &middot; figures shown are illustrative sample data</span>
      <span>{{ site.restaurantName }} Performance Dashboard — v0 mockup</span>
    </footer>
  </div>
</template>

<style scoped>
/* ---------- period pill selector (drill-down sections) ---------- */
.period-tabs { display: flex; gap: 6px; }
.period-tab {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 11px;
  border-radius: 100px;
  border: 1px solid var(--hair);
  color: var(--ink-3);
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
.rank-fill.neutral { background: var(--ink-3); opacity: 0.5; }
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
