<script setup lang="ts">
// Planning › Breakeven (owner-only by default deny). Fed by /api/breakeven — see that route's header
// for how the cost layers, expected covers and planned events/retail credits are built.
import site from '~/config/site.json'
import { MONTH_NAMES, useBudgetYearSelection } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Breakeven` })

type Lift = { dineInOnly: number | null, withOther: number | null }
type Tier = {
  key: string, label: string, detail: string, monthly: number,
  coversPerNight: number | null, coversPerNightWithOther: number | null,
  stillShort: number | null, eventSalesNeeded: number, liftPct: Lift
}
type Weekday = {
  key: string, label: string, short: string, sampleDays: number,
  avgCovers: number | null, expectedCovers: number | null, avgSpend: number | null,
  coversNeeded: Record<string, number | null>, coversNeededWithOther: Record<string, number | null>
}
type Breakeven = {
  year: number, month: number, isCurrentMonth: boolean, today: { year: number, month: number },
  asOfDate: string | null, windowStart: string | null, sampleOpenDays: number, nights: number,
  laborBudgeted: boolean,
  payroll: { mode: 'average' | 'month', monthPaychecks: number, averagePaychecks: number, paycheckTimingDifference: number },
  avgCoversPerNight: number | null, avgSpend: number | null,
  expectedCoversPerNight: number | null, coversSource: 'recent' | 'forecast',
  cogsPct: number | null, varOpexPct: number | null, contribRate: number | null, fohPerCover: number, contribPerCover: number | null,
  components: { fixedLabor: number, kitchenCrew: number, variableLabor: number, fixedOpex: number, loanPrincipal: number },
  dineInMargin: number | null,
  planned: {
    eventSales: number, buyoutExtra: number, replacedDineIn: number, eventsRevenue: number, eventsMargin: number,
    retailSales: number, retailCostPct: number | null, retailCostBasis: 'actual' | 'budget' | 'target', retailMargin: number,
    avgEventSize: number | null
  },
  tiers: Tier[], weekdays: Weekday[], weekdayWeighting: 'pattern' | 'equal',
  excludedNights: { date: string, covers: number, revenue: number, spend: number }[]
}

const route = useRoute()
const router = useRouter()
// Year: the same 2026/2027 toggle as Budget / Sales Plan / Staffing Plan (shared, remounts the page).
const { year: selYear } = useBudgetYearSelection()
// Month: ?month= in the URL; left out, the API picks the first open month (this month, or January).
const selMonth = ref<number | null>(Number(route.query.month) || null)
// Payroll: an average payroll month by default (wages restated to the year's paychecks ÷ 12), or
// this month's real paychecks (?payroll=month), the cash view the Budget and Cash & Loans use.
const payrollMode = ref<'average' | 'month'>(route.query.payroll === 'month' ? 'month' : 'average')
function setPayrollMode(m: 'average' | 'month') {
  payrollMode.value = m
  const { payroll: _drop, ...rest } = route.query
  router.replace({ query: m === 'month' ? { ...rest, payroll: 'month' } : rest })
}
const query = computed(() => ({ year: selYear.value, ...(selMonth.value ? { month: selMonth.value } : {}), ...(payrollMode.value === 'month' ? { payroll: 'month' } : {}) }))
const { data, pending, error, refresh } = await useFetch<Breakeven>('/api/breakeven', { query, lazy: true })

// Default to the P&L breakeven (lines up with the budget), cash breakeven one click away.
const selectedTier = ref('fixed_opex')
// "With planned events & retail" is the realistic reading; "dine-in only" is the Michelin one.
const mode = ref<'with' | 'dinein'>('with')

// Month tabs, Jan–Dec like the other Planning pages. Months already behind us this year are
// disabled: the breakeven reads recent covers and the budget forward, not a closed month.
function isPastMonth(m: number) {
  const t = data.value?.today
  return !!t && selYear.value === t.year && m < t.month
}
function selectMonth(m: number) {
  if (isPastMonth(m)) return
  selMonth.value = m
  router.replace({ query: { ...route.query, month: m } })
}

const tier = computed(() => data.value?.tiers.find(t => t.key === selectedTier.value) ?? null)
const monthName = computed(() => data.value ? `${MONTH_NAMES[data.value.month - 1]} ${data.value.year}` : '')

const fmtMoney = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`
const fmtCovers = (n: number | null | undefined) => n == null ? '—' : String(Math.round(n))
const pct = (n: number | null | undefined) => n == null ? '—' : `${Math.round(n * 100)}%`

// Status of expected vs. needed: glyph carries the meaning (never color alone):
// ✓ covered, ▲ short (amber within 10%, red beyond).
function status(actual: number | null, needed: number | null): { cls: string, text: string } | null {
  if (actual == null || needed == null) return null
  const diff = Math.round(actual) - Math.round(needed)
  if (diff >= 0) return { cls: 'good', text: `✓ ${diff === 0 ? 'at breakeven' : `+${diff} above`}` }
  return { cls: actual >= needed * 0.9 ? 'warning' : 'serious', text: `▲ ${-diff} short` }
}

const eventsCount = computed(() => {
  const t = tier.value, d = data.value
  if (!t || !d?.planned.avgEventSize || t.eventSalesNeeded <= 0) return null
  return Math.ceil(t.eventSalesNeeded / d.planned.avgEventSize)
})

const neededFor = (w: Weekday) => (mode.value === 'with' ? w.coversNeededWithOther : w.coversNeeded)[selectedTier.value] ?? null
const weekTotals = computed(() => {
  const d = data.value
  if (!d) return null
  const withCovers = d.weekdays.filter(w => w.expectedCovers != null)
  if (withCovers.length === 0) return null
  const covers = withCovers.reduce((s, w) => s + w.expectedCovers!, 0)
  const revenue = withCovers.reduce((s, w) => s + w.expectedCovers! * (w.avgSpend ?? 0), 0)
  const needs = d.weekdays.map(neededFor)
  const needed = needs.every(n => n != null) ? needs.reduce((s, n) => s + n!, 0) : null
  return { covers, spend: covers > 0 ? revenue / covers : null, needed }
})

const liftText = computed(() => {
  const p = tier.value?.liftPct[mode.value === 'with' ? 'withOther' : 'dineInOnly']
  if (p == null) return null
  const n = Math.round(Math.abs(p) * 100)
  if (n === 0) return 'Expected covers are right at breakeven for this layer.'
  return p > 0
    ? `Every night needs about ${n}% more covers than expected.`
    : `Every night could run about ${n}% below expected and still cover this layer.`
})
const paychecks = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} paycheck${n === 1 ? '' : 's'}`
// One line on paycheck timing, only when the month's paychecks differ from an average month's.
const payrollNote = computed(() => {
  const d = data.value
  if (!d) return null
  const diff = d.payroll.paycheckTimingDifference
  if (Math.abs(diff) < 1) return null
  const month = MONTH_NAMES[d.month - 1]
  const more = diff > 0 ? 'more' : 'less'
  return d.payroll.mode === 'average'
    ? `Labor is shown for an average payroll month (${paychecks(d.payroll.averagePaychecks)} in ${d.year}). ${month} actually pays ${paychecks(d.payroll.monthPaychecks)}: ${fmtMoney(Math.abs(diff))} ${more} in cash, which evens out over the year.`
    : `Labor is ${month}'s real ${paychecks(d.payroll.monthPaychecks)}: ${fmtMoney(Math.abs(diff))} ${more} than an average payroll month (${paychecks(d.payroll.averagePaychecks)} in ${d.year}).`
})
const expectedLabel = computed(() => data.value?.coversSource === 'forecast' ? 'forecast covers' : 'recent avg covers')
</script>

<template>
  <div>
    <PageHeader
      page-name="Breakeven"
      description="What each layer of fixed cost needs from dine-in covers, planned events and retail — and what's still short."
      @synced="refresh()"
    />

    <div v-if="error" class="drill-card"><span class="chip critical">Couldn't load breakeven</span> <span class="quiet-note">{{ error.message }}</span></div>
    <div v-else-if="pending && !data" class="state-note">Loading…</div>
    <template v-else-if="data">
      <BudgetYearToggle />
      <div class="month-tabs" role="tablist" aria-label="Month">
        <button
          v-for="(name, i) in MONTH_NAMES" :key="name"
          type="button" role="tab"
          :aria-selected="data.month === i + 1"
          :disabled="isPastMonth(i + 1)"
          :title="isPastMonth(i + 1) ? 'Past month — breakeven looks forward from this month' : undefined"
          :class="['month-tab', data.month === i + 1 && 'active']"
          @click="selectMonth(i + 1)"
        >{{ name }}</button>
        <span v-if="pending" class="quiet-note updating">Updating…</span>
      </div>

      <div v-if="data.avgSpend === null || data.contribRate === null" class="drill-card">
        <span class="chip warning">Not enough data yet</span>
        <span class="quiet-note">Needs recent Toast covers with matching core revenue, and food & drink cost and variable-expense targets.</span>
      </div>
      <template v-else>
        <div v-if="!data.laborBudgeted" class="drill-card"><span class="chip warning">⚠ No labor budget</span> <span class="quiet-note">No labor budget is saved for {{ monthName }} yet — save the Staffing Plan, or the labor layers read $0.</span></div>

        <!-- ============ The gap ============ -->
        <section class="be-card">
          <div class="be-head">
            <div class="be-title">Closing the gap — {{ monthName }}</div>
            <div class="seg" role="group" aria-label="Payroll">
              <button type="button" :class="{ on: payrollMode === 'average' }" :aria-pressed="payrollMode === 'average'" @click="setPayrollMode('average')">Average payroll month</button>
              <button type="button" :class="{ on: payrollMode === 'month' }" :aria-pressed="payrollMode === 'month'" @click="setPayrollMode('month')">This month's {{ paychecks(data.payroll.monthPaychecks) }}</button>
            </div>
          </div>
          <table v-if="tier" class="be-table gap">
            <tbody>
              <tr>
                <td>Costs to carry<span class="be-sub">{{ tier.label.replace(/^\+ /, 'through ') }} — pick a layer below</span></td>
                <td class="num"><strong>{{ fmtMoney(tier.monthly) }}</strong></td>
              </tr>
              <tr>
                <td>− Dine-in margin at expected covers
                  <span class="be-sub">{{ fmtCovers(data.expectedCoversPerNight) }} covers/night ({{ data.coversSource === 'forecast' ? 'Capacity forecast' : 'recent average' }}) × {{ data.nights }} nights × about {{ fmtMoney(data.contribPerCover ?? 0) }} a cover</span>
                </td>
                <td class="num">{{ data.dineInMargin != null ? fmtMoney(-data.dineInMargin) : '—' }}</td>
              </tr>
              <tr>
                <td>− Planned events, buyouts & catering
                  <span class="be-sub">{{ fmtMoney(data.planned.eventsRevenue) }} in sales<template v-if="data.planned.buyoutExtra || data.planned.replacedDineIn"> ({{ fmtMoney(data.planned.eventSales) }} event & catering budget<template v-if="data.planned.buyoutExtra">, {{ fmtMoney(data.planned.buyoutExtra) }} buyouts above a normal night</template><template v-if="data.planned.replacedDineIn">, {{ fmtMoney(data.planned.replacedDineIn) }} diners on event nights</template>)</template> × {{ pct(data.contribRate) }} margin</span>
                </td>
                <td class="num">{{ fmtMoney(-data.planned.eventsMargin) }}</td>
              </tr>
              <tr>
                <td>− Planned retail
                  <span class="be-sub">{{ fmtMoney(data.planned.retailSales) }} in sales, {{ pct(data.planned.retailCostPct) }} cost ({{ data.planned.retailCostBasis === 'actual' ? 'actual since the move' : data.planned.retailCostBasis === 'budget' ? 'budgeted' : 'food & drink cost target — not enough retail history yet' }})</span>
                </td>
                <td class="num">{{ fmtMoney(-data.planned.retailMargin) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <strong v-if="tier.stillShort != null && tier.stillShort > 0">▲ Still short</strong>
                  <strong v-else>✓ Covered</strong>
                  <span v-if="tier.stillShort != null && tier.stillShort > 0" class="be-sub">
                    ≈ <strong>{{ fmtMoney(tier.eventSalesNeeded) }}</strong> more event, catering or retail sales a month
                    <template v-if="eventsCount"> — about {{ eventsCount }} more event{{ eventsCount === 1 ? '' : 's' }} at your typical {{ fmtMoney(data.planned.avgEventSize!) }}</template>
                  </span>
                  <span v-else-if="tier.stillShort != null" class="be-sub">{{ fmtMoney(-tier.stillShort) }} to spare at expected covers and planned events & retail</span>
                </td>
                <td class="num">
                  <span v-if="tier.stillShort != null" :class="['chip', tier.stillShort > 0 ? 'serious' : 'good']">{{ tier.stillShort > 0 ? `▲ ${fmtMoney(tier.stillShort)}` : `✓ ${fmtMoney(-tier.stillShort)}` }}</span>
                  <span v-else>—</span>
                </td>
              </tr>
            </tfoot>
          </table>
          <div v-if="payrollNote" class="be-basis">{{ payrollNote }}</div>
          <div class="be-basis"><NuxtLink to="/budget/revenue">Add events and buyouts on the Sales Plan →</NuxtLink></div>
        </section>

        <!-- ============ Layers ============ -->
        <section class="be-card">
          <div class="be-title">Cost layers</div>
          <table class="be-table">
            <thead>
              <tr>
                <td>layer (cumulative)</td><td class="num">costs / month</td>
                <td class="num">covers/night<span class="be-sub">dine-in only</span></td>
                <td class="num">covers/night<span class="be-sub">with planned events & retail</span></td>
                <td class="num">still short</td>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in data.tiers" :key="t.key" :class="{ selected: t.key === selectedTier }" @click="selectedTier = t.key">
                <td>
                  <label class="tier-pick">
                    <input v-model="selectedTier" type="radio" name="be-tier" :value="t.key" />
                    <span><strong>{{ t.label }}</strong><span class="be-sub">{{ t.detail }}</span></span>
                  </label>
                </td>
                <td class="num">{{ fmtMoney(t.monthly) }}</td>
                <td class="num">{{ fmtCovers(t.coversPerNight) }}</td>
                <td class="num"><strong>{{ fmtCovers(t.coversPerNightWithOther) }}</strong></td>
                <td class="num">
                  <span v-if="t.stillShort != null" :class="['chip', t.stillShort > 0 ? 'serious' : 'good']">{{ t.stillShort > 0 ? `▲ ${fmtMoney(t.stillShort)}` : '✓ covered' }}</span>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="be-basis">
            Expected: <strong>{{ fmtCovers(data.expectedCoversPerNight) }} covers/night</strong> ({{ data.coversSource === 'forecast' ? 'Capacity forecast' : 'recent average' }})
            at <strong>{{ fmtMoney(data.avgSpend) }}</strong>/cover. Each cover contributes about <strong>{{ fmtMoney(data.contribPerCover ?? 0) }}</strong>
            after food & drink cost ({{ pct(data.cogsPct) }}), variable expenses ({{ pct(data.varOpexPct) }}) and front-of-house hourly (about {{ fmtMoney(data.fohPerCover) }}/cover).
          </div>
        </section>

        <!-- ============ By weekday ============ -->
        <section class="be-card">
          <div class="be-head">
            <div class="be-title">By weekday — {{ tier?.label.replace(/^\+ /, '') }}</div>
            <div class="seg" role="group" aria-label="Count planned events and retail">
              <button type="button" :class="{ on: mode === 'with' }" @click="mode = 'with'">With planned events & retail</button>
              <button type="button" :class="{ on: mode === 'dinein' }" @click="mode = 'dinein'">Dine-in only</button>
            </div>
          </div>
          <div class="be-basis">
            <template v-if="data.weekdayWeighting === 'pattern'">Every night grows by the same share, so busy nights carry more than quiet ones. </template>
            <template v-else>Each night carries an equal share (not every weekday has recent data yet). </template>
            <strong v-if="liftText">{{ liftText }}</strong>
          </div>
          <table class="be-table">
            <thead>
              <tr><td>night</td><td class="num">{{ expectedLabel }}</td><td class="num">avg spend</td><td class="num">covers needed</td><td class="num">vs. needed</td></tr>
            </thead>
            <tbody>
              <tr v-for="w in data.weekdays" :key="w.key">
                <td><strong>{{ w.label }}</strong><span class="be-sub">{{ w.sampleDays }} recent nights<template v-if="data.coversSource === 'forecast' && w.avgCovers != null"> · {{ fmtCovers(w.avgCovers) }} recently</template></span></td>
                <td class="num">{{ fmtCovers(w.expectedCovers) }}</td>
                <td class="num">{{ w.avgSpend != null ? fmtMoney(w.avgSpend) : '—' }}</td>
                <td class="num"><strong>{{ fmtCovers(neededFor(w)) }}</strong></td>
                <td class="num">
                  <span v-if="status(w.expectedCovers, neededFor(w))" :class="['chip', status(w.expectedCovers, neededFor(w))!.cls]">{{ status(w.expectedCovers, neededFor(w))!.text }}</span>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
            <tfoot v-if="weekTotals">
              <tr>
                <td><strong>Per week</strong><span class="be-sub">total across operating nights</span></td>
                <td class="num"><strong>{{ fmtCovers(weekTotals.covers) }}</strong></td>
                <td class="num"><strong>{{ weekTotals.spend != null ? fmtMoney(weekTotals.spend) : '—' }}</strong></td>
                <td class="num"><strong>{{ fmtCovers(weekTotals.needed) }}</strong></td>
                <td class="num">
                  <span v-if="status(weekTotals.covers, weekTotals.needed)" :class="['chip', status(weekTotals.covers, weekTotals.needed)!.cls]">{{ status(weekTotals.covers, weekTotals.needed)!.text }}</span>
                  <span v-else>—</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <div class="be-foot">
          Window: last {{ data.sampleOpenDays }} open nights ({{ data.windowStart }} to {{ data.asOfDate }}) for spend per cover and the weekday pattern.
          Costs, event, catering and retail sales come from the saved {{ monthName }} budget; buyouts and event-night diners from the Sales Plan's dated special nights.
          <template v-if="data.excludedNights.length > 0">
            Left out as unrepresentative (spend per cover far from typical — likely an event or buyout):
            <span v-for="(n, i) in data.excludedNights" :key="n.date">{{ n.date }} ({{ fmtMoney(n.spend) }}/cover, {{ n.covers }} covers){{ i < data.excludedNights.length - 1 ? '; ' : '. ' }}</span>
          </template>
          Events use the same food & drink cost and variable-expense rates as dine-in (their costs post to the same accounts); event-only staffing isn't counted, so event margin may read high.
          Fixed labor and kitchen crew are modeled as fixed; FOH hourly flexes with covers.
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.month-tabs { display: flex; align-items: flex-end; gap: 2px; margin: 4px 0 16px; border-bottom: 1px solid var(--hair); overflow-x: auto; }
.month-tab {
  font-size: 12px; font-weight: 700; font-family: inherit; padding: 7px 16px;
  border: 1px solid var(--hair); border-bottom: none; border-radius: 8px 8px 0 0;
  background: var(--surface-alt); color: var(--ink-2); cursor: pointer; position: relative; top: 1px;
}
.month-tab.active { background: var(--surface); color: var(--ink); border-bottom: 1px solid var(--surface); }
.month-tab:disabled { opacity: 0.45; cursor: default; }
.updating { margin-left: 10px; align-self: center; }
.be-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px;
  margin: 0 0 18px;
}
.be-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.be-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.be-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.be-table thead td { font-size: 11px; color: var(--ink-3); padding: 4px 8px; vertical-align: bottom; }
.be-table tbody td { padding: 7px 8px; border-top: 1px solid var(--hair); vertical-align: middle; }
.be-table .num { text-align: right; white-space: nowrap; }
.be-table tfoot td { padding: 9px 8px 7px; border-top: 2px solid var(--hair); vertical-align: middle; }
.be-table.gap td:first-child { white-space: normal; }
.be-table tbody tr.selected td { background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.be-table tbody tr:has(.tier-pick) { cursor: pointer; }
.tier-pick { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.tier-pick input { margin-top: 3px; }
.be-sub { display: block; font-size: 10.5px; color: var(--ink-3); font-weight: 400; margin-top: 1px; }
.be-basis { font-size: 12px; color: var(--ink-2); }
.be-foot { font-size: 11px; color: var(--ink-3); margin-bottom: 24px; }
.seg { display: inline-flex; border: 1px solid var(--hair); border-radius: 8px; overflow: hidden; }
.seg button { font-size: 11.5px; padding: 4px 10px; background: var(--surface); color: var(--ink-2); border: 0; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--hair); }
.seg button.on { background: color-mix(in srgb, var(--accent) 14%, var(--surface)); color: var(--ink); font-weight: 600; }
@media (max-width: 640px) {
  .month-tab { padding: 7px 11px; }
  .be-table { font-size: 12px; }
  .be-table thead td, .be-table tbody td, .be-table tfoot td { padding-left: 4px; padding-right: 4px; }
}
</style>
