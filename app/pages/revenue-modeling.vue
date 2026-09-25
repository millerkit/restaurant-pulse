<script setup lang="ts">
import site from '~/config/site.json'
import type { Category } from '~/composables/useBudgetData'
import { hybridYearTotals, monthCategoryBudget, currentAsOfMonth, netIncome, useActualsYear, useBudgetYear } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Revenue Modeling` })

// A what-if tool: start from real trailing per-area covers/spend (the same
// real daily_toast_area_metrics data the Edit Capacity page's "Actual"
// columns already draw from), let the user type a hypothetical covers/
// spend increase per area, and see what that implies for the current
// year's annual labor % of revenue and profit margin. See
// server/api/revenue-modeling.get.ts for the real inputs this route
// supplies and the reasoning behind the fixed/variable cost splits.
type AreaTrailing = {
  areaId: number, areaName: string, covers: number, revenue: number, nights: number,
  coversPerNight: number | null, perCover: number | null
}
type BuyoutWeekday = { dow: number, label: string, short: string, dollarTarget: number | null, rate: number }
type RevenueModelingData = {
  asOfAreaDate: string | null
  trailingWindow: { start: string, end: string } | null
  areas: AreaTrailing[]
  modelYear: number
  operatingNightsPerYear: number
  sinceDate: string | null
  asOfLineItemDate: string | null
  laborVariableShare: number | null
  opexVariableShare: number | null
  buyoutRates: { weekdayRate: number, weekendRate: number, updatedAt: string | null }
  buyoutWeekdays: BuyoutWeekday[]
  buyoutBookedByDow: Record<number, number>
}

const { data, pending, error, refresh } = await useFetch<RevenueModelingData>('/api/revenue-modeling')

// Real current-year revenue/COGS/labor/opex — the same hybrid
// (actual-where-elapsed, budget-otherwise) annual totals the Labor tab and
// Budget Pace already treat as canonical (see CLAUDE.md's 2026-09-22 Labor
// tab fix), not a separate notion of "this year's revenue" invented here.
const { monthlyData: yearBudgetData, loading: budgetLoading, loadYear } = useBudgetYear()
const { monthlyActuals, loadActualsYear } = useActualsYear()
const asOfMonth = currentAsOfMonth()
// useActualsYear() has no loading flag of its own — monthlyActuals starts as
// [] and only becomes a populated 12-entry array once its fetch resolves, so
// emptiness doubles as a loading signal. Without this, the Annual Impact
// section briefly renders its "not enough data" warning on every load (a
// real, if minor, race — the page itself renders as soon as
// /api/revenue-modeling resolves, well before these two composables'
// combined 13 requests do) before flipping to the real cards a moment
// later.
const annualDataLoading = computed(() => budgetLoading.value || monthlyActuals.value.length === 0)
function getMonthCategoryBudgetLive(month: number, cat: Category): number | null {
  return monthCategoryBudget(yearBudgetData.value[month - 1], cat)
}
const currentAnnual = computed(() => hybridYearTotals(getMonthCategoryBudgetLive, monthlyActuals.value, asOfMonth))

// ---- per-area simulation drafts (Covers Δ / Spend Δ, both default 0) ----
// Whole-number deltas — a whole extra cover/night and a whole extra dollar
// of per-cover spend, not a percentage — per the user's own request:
// covers are inherently discrete (no such thing as 45.3 covers/night), and
// typing a direct $ delta is more concrete than a % that gets multiplied
// against a varying per-area baseline. Bound via NumberStepper
// (app/components/NumberStepper.vue, already used the same way on the
// Labor tab) so each delta gets its own up/down bump arrows rather than
// relying on cramped native spin-button arrows or plain typing alone.
type AreaDraft = { areaId: number, areaName: string, coversDelta: number, spendDelta: number }
const areaDrafts = ref<AreaDraft[]>([])
watch(() => data.value?.areas, (areas) => {
  if (!areas) return
  // Preserve any in-progress typed deltas across a refresh (e.g. after a
  // sync) by keying off areaId rather than blindly overwriting the array.
  const prior = new Map(areaDrafts.value.map(d => [d.areaId, d]))
  areaDrafts.value = areas.map(a => prior.get(a.areaId) ?? { areaId: a.areaId, areaName: a.areaName, coversDelta: 0, spendDelta: 0 })
}, { immediate: true })

// ---- buyout events (annual count per weekday, default 0) ----
// A buyout swaps a normal night for a guaranteed minimum — only the
// difference over what that weekday would have made anyway is new revenue
// (buyoutIncrementFor below), the same math the Revenue tab's persisted
// buyout planner uses (server/utils/buyout-rates.ts), just consumed here as
// a per-weekday annual count instead of one month's count. Deliberately
// NOT persisted — this is scratch what-if state, reset the same way the
// per-area covers/spend deltas are, never written to revenue_buyout_plan.
const buyoutCounts = ref<Record<number, number>>({})
watch(() => data.value?.buyoutWeekdays, (weekdays) => {
  if (!weekdays) return
  const prior = buyoutCounts.value
  const next: Record<number, number> = {}
  for (const w of weekdays) next[w.dow] = prior[w.dow] ?? 0
  buyoutCounts.value = next
}, { immediate: true })

function resetSimulation() {
  areaDrafts.value = areaDrafts.value.map(d => ({ ...d, coversDelta: 0, spendDelta: 0 }))
  const resetCounts: Record<number, number> = {}
  for (const dow of Object.keys(buyoutCounts.value)) resetCounts[Number(dow)] = 0
  buyoutCounts.value = resetCounts
}

// Incremental revenue from one buyout on this weekday — null when there's
// not enough real data yet to know what a normal night on this weekday
// makes (same "not enough data" gate the Revenue tab's grid already uses).
function buyoutIncrementFor(w: BuyoutWeekday): number | null {
  return w.dollarTarget != null ? w.rate - w.dollarTarget : null
}
// Real counts already booked on the Revenue tab this year (context only —
// see server/api/revenue-modeling.get.ts's buyoutBookedByDow comment for
// why this is never added into buyoutAnnualRevenueDelta: it's already
// baked into currentAnnual.revenue via the Revenue tab's own Apply action).
function bookedCountFor(dow: number): number {
  return data.value?.buyoutBookedByDow?.[dow] ?? 0
}
function bookedRevenueFor(w: BuyoutWeekday): number {
  const inc = buyoutIncrementFor(w)
  return inc != null ? bookedCountFor(w.dow) * inc : 0
}
// The stepper is always a pure delta on top of what's already booked, per
// the user's own instruction — never pre-filled with the booked count —
// so "Sim." here means "booked + this simulation's additional buyouts."
function simCountFor(w: BuyoutWeekday): number {
  return bookedCountFor(w.dow) + (buyoutCounts.value[w.dow] ?? 0)
}
function simRevenueFor(w: BuyoutWeekday): number {
  const inc = buyoutIncrementFor(w)
  return inc != null ? simCountFor(w) * inc : 0
}
const buyoutAnnualRevenueDelta = computed(() => {
  return (data.value?.buyoutWeekdays ?? []).reduce((sum, w) => {
    const inc = buyoutIncrementFor(w)
    const count = buyoutCounts.value[w.dow] ?? 0
    return sum + (inc != null ? inc * count : 0)
  }, 0)
})
const buyoutBookedRevenueTotal = computed(() => {
  return (data.value?.buyoutWeekdays ?? []).reduce((sum, w) => sum + bookedRevenueFor(w), 0)
})
const buyoutHasAnyCount = computed(() => Object.values(buyoutCounts.value).some(c => c > 0))

// The full dollar-by-dollar breakdown is supplementary detail (the three
// headline cards above already answer "so what") — collapsed by default so
// the page's primary content (headline cards + the per-area sim table)
// fits within a laptop-height viewport without scrolling; expand on demand.
const showBreakdown = ref(false)

function baselineFor(areaId: number): AreaTrailing | null {
  return data.value?.areas.find(a => a.areaId === areaId) ?? null
}
type SimRow = {
  areaId: number, areaName: string,
  baseCoversPerNight: number | null, basePerCover: number | null, baseNightlyRevenue: number | null,
  simCoversPerNight: number | null, simPerCover: number | null, simNightlyRevenue: number | null
}
// Sorted by baseline nightly revenue descending (the user's own request) —
// the table's per-area inputs are bound via draftFor(row.areaId) rather
// than array index below, so re-sorting this never misaligns an input with
// the wrong area.
const simRows = computed<SimRow[]>(() => {
  const rows = areaDrafts.value.map((d) => {
    const b = baselineFor(d.areaId)
    const baseCovers = b?.coversPerNight ?? null
    const basePerCover = b?.perCover ?? null
    const baseRevenue = baseCovers != null && basePerCover != null ? baseCovers * basePerCover : null
    const simCovers = baseCovers != null ? baseCovers + d.coversDelta : null
    const simPerCover = basePerCover != null ? basePerCover + d.spendDelta : null
    const simRevenue = simCovers != null && simPerCover != null ? simCovers * simPerCover : null
    return {
      areaId: d.areaId, areaName: d.areaName,
      baseCoversPerNight: baseCovers, basePerCover, baseNightlyRevenue: baseRevenue,
      simCoversPerNight: simCovers, simPerCover, simNightlyRevenue: simRevenue
    }
  })
  return rows.sort((a, b) => (b.baseNightlyRevenue ?? -Infinity) - (a.baseNightlyRevenue ?? -Infinity))
})
function draftFor(areaId: number): AreaDraft {
  return areaDrafts.value.find(d => d.areaId === areaId)!
}

const totals = computed(() => {
  const rows = simRows.value
  const sum = (f: (r: SimRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0)
  return {
    baseCoversPerNight: sum(r => r.baseCoversPerNight),
    baseNightlyRevenue: sum(r => r.baseNightlyRevenue),
    simCoversPerNight: sum(r => r.simCoversPerNight),
    simNightlyRevenue: sum(r => r.simNightlyRevenue)
  }
})

const hasAreaData = computed(() => (data.value?.areas ?? []).some(a => a.coversPerNight != null))

// ---- annual impact: scale the current year's real revenue/COGS/labor/opex
// by what the per-area simulation implies, using the fixed/variable splits
// this route computed from real trailing data. See
// server/api/revenue-modeling.get.ts's header comment for the full
// reasoning behind each step below. ----
const canModelAnnualImpact = computed(() =>
  hasAreaData.value &&
  totals.value.baseNightlyRevenue > 0 &&
  data.value?.laborVariableShare != null &&
  data.value?.opexVariableShare != null &&
  currentAnnual.value.revenue > 0
)

const annualImpact = computed(() => {
  if (!canModelAnnualImpact.value) return null
  const nights = data.value!.operatingNightsPerYear
  const revenueDeltaPerNight = totals.value.simNightlyRevenue - totals.value.baseNightlyRevenue
  // Buyout revenue is already net of the normal night it displaces (see
  // buyoutIncrementFor above), so it's safely additive on top of the
  // per-area covers/spend delta rather than double-counting that night.
  // It flows through the same COGS%/labor-variable/opex-variable treatment
  // as any other revenue delta below — consistent with how the Revenue
  // tab's buyout planner treats it as plain incremental revenue, with no
  // separate cost model of its own.
  const annualRevenueDelta = revenueDeltaPerNight * nights + buyoutAnnualRevenueDelta.value
  const coversMultiplier = totals.value.baseCoversPerNight > 0 ? totals.value.simCoversPerNight / totals.value.baseCoversPerNight : 1

  const baseRevenue = currentAnnual.value.revenue
  const baseCogs = currentAnnual.value.cogs
  const baseLabor = currentAnnual.value.labor
  const baseOpex = currentAnnual.value.opex
  const otherIncome = currentAnnual.value.other_income
  const otherExpense = currentAnnual.value.other_expense
  const simRevenue = baseRevenue + annualRevenueDelta

  const laborVariableShare = data.value!.laborVariableShare!
  const laborVariable = baseLabor * laborVariableShare
  const laborFixed = baseLabor * (1 - laborVariableShare)
  const simLaborVariable = laborVariable * coversMultiplier
  const simLabor = simLaborVariable + laborFixed

  const cogsPct = baseRevenue > 0 ? baseCogs / baseRevenue : 0
  const simCogs = cogsPct * simRevenue

  const opexVariableShare = data.value!.opexVariableShare!
  const opexVariable = baseOpex * opexVariableShare
  const opexFixed = baseOpex * (1 - opexVariableShare)
  const opexVariablePct = baseRevenue > 0 ? opexVariable / baseRevenue : 0
  const simOpexVariable = opexVariablePct * simRevenue
  const simOpex = simOpexVariable + opexFixed

  // other_income/other_expense aren't modeled by the covers/spend simulation
  // (they're not driven by nightly covers or per-cover spend), so both base
  // and simulated net income carry the same real current-year other total —
  // matching the canonical netIncome() formula used by Edit Budget's Total
  // tab and Budget Pace, rather than silently omitting Other Income/Expense.
  const baseNetIncome = netIncome({ revenue: baseRevenue, cogs: baseCogs, labor: baseLabor, opex: baseOpex, other_income: otherIncome, other_expense: otherExpense })
  const simNetIncome = netIncome({ revenue: simRevenue, cogs: simCogs, labor: simLabor, opex: simOpex, other_income: otherIncome, other_expense: otherExpense })

  return {
    coversMultiplier,
    revenue: { base: baseRevenue, sim: simRevenue },
    cogs: { base: baseCogs, sim: simCogs },
    labor: { base: baseLabor, sim: simLabor, baseFixed: laborFixed, baseVariable: laborVariable, simFixed: laborFixed, simVariable: simLaborVariable },
    opex: { base: baseOpex, sim: simOpex, baseFixed: opexFixed, baseVariable: opexVariable, simFixed: opexFixed, simVariable: simOpexVariable },
    netIncome: { base: baseNetIncome, sim: simNetIncome },
    otherIncome, otherExpense,
    laborPct: { base: baseRevenue > 0 ? baseLabor / baseRevenue : null, sim: simRevenue > 0 ? simLabor / simRevenue : null },
    profitMargin: { base: baseRevenue > 0 ? baseNetIncome / baseRevenue : null, sim: simRevenue > 0 ? simNetIncome / simRevenue : null }
  }
})

async function handleSynced() {
  await Promise.all([refresh(), loadYear(), loadActualsYear()])
}

// ---- formatting ----
function fmtMoney(n: number | null | undefined): string {
  return n == null ? '—' : `$${n.toFixed(2)}`
}
function fmtMoneyFull(n: number | null | undefined): string {
  return n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`
}
function fmtCoversPerNight(n: number | null | undefined): string {
  return n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString()
}
function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}
// Buyout counts can be fractional (see revenue.vue's buyoutCountInputs
// comment — a buyout priced off its weekday's standard rate is entered as
// a fractional multiple, e.g. 1.4645) — round to 2 decimals and trim
// trailing zeros so a whole count still reads as a plain "1", not "1.00".
function fmtBuyoutCount(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return `${rounded} ${rounded === 1 ? 'buyout' : 'buyouts'}`
}
function fmtDeltaMoney(base: number, sim: number): string {
  const d = sim - base
  return d >= 0 ? `+${fmtMoneyFull(d)}` : `−${fmtMoneyFull(Math.abs(d))}`
}
function fmtDeltaPts(base: number | null, sim: number | null): string {
  if (base == null || sim == null) return ''
  const pts = (sim - base) * 100
  return pts >= 0 ? `+${pts.toFixed(1)}pts` : `${pts.toFixed(1)}pts`
}
function parseIso(s: string) {
  return new Date(`${s}T00:00:00Z`)
}
function fmtDate(s: string) {
  return parseIso(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
// Lower labor % is better; higher profit margin is better — same
// good/critical vocabulary the rest of the app pairs with a chip, never
// color alone.
function laborPctChip(base: number | null, sim: number | null): 'good' | 'critical' | null {
  if (base == null || sim == null) return null
  return sim <= base ? 'good' : 'critical'
}
function marginChip(base: number | null, sim: number | null): 'good' | 'critical' | null {
  if (base == null || sim == null) return null
  return sim >= base ? 'good' : 'critical'
}
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading revenue modeling data…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load revenue modeling data</span>
      <span class="quiet-note">{{ error?.message }}</span>
    </div>

    <template v-else>
      <PageHeader
        page-name="Revenue Modeling"
        description="What would a covers or spend change do to this year's labor % of revenue and profit margin?"
        :as-of-label="data?.asOfAreaDate ? fmtDate(data.asOfAreaDate) : undefined"
        @synced="handleSynced()"
      />

      <div v-if="!hasAreaData" class="drill-card">
        <span class="chip warning">No real per-area data yet</span>
        <span class="quiet-note">This page needs real Toast per-area covers/revenue (daily_toast_area_metrics) to build a trailing baseline — see the Capacity tab's Edit page for the same real data.</span>
      </div>

      <template v-else>
        <section v-if="annualDataLoading" class="rm-section">
          <div class="quiet-note">Loading this year's revenue/COGS/labor/opex…</div>
        </section>

        <section v-else-if="!canModelAnnualImpact" class="rm-section">
          <div class="drill-card">
            <span class="chip warning">Not enough data yet for the annual impact</span>
            <span class="quiet-note">
              Needs a real current-year revenue figure (budget or synced actuals) and a real fixed/variable cost split from
              <template v-if="data?.sinceDate">the {{ fmtDate(data.sinceDate) }}–{{ data?.asOfLineItemDate ? fmtDate(data.asOfLineItemDate) : 'today' }} window</template>
              <template v-else>synced QuickBooks data</template> of daily_line_items.
            </span>
          </div>
        </section>

        <section v-else class="rm-section">
          <div class="section-head">
            <div class="section-label">Annual Impact — {{ data!.modelYear }}</div>
            <div class="section-note">
              Scaled by {{ fmtCoversPerNight(totals.simCoversPerNight - totals.baseCoversPerNight) }} covers/night ({{ ((annualImpact!.coversMultiplier - 1) * 100).toFixed(1) }}%) &middot; {{ data!.operatingNightsPerYear }} operating nights/year
              <template v-if="buyoutHasAnyCount"> &middot; {{ fmtDeltaMoney(0, buyoutAnnualRevenueDelta) }} from planned buyouts</template>
            </div>
          </div>

          <div class="quick-row">
            <div class="assumption-card">
              <div class="card-head"><span class="period-name">Annual Revenue</span></div>
              <div class="metric primary">
                <div class="metric-figure">{{ fmtMoneyFull(annualImpact!.revenue.sim) }}</div>
                <div class="metric-sub">vs. {{ fmtMoneyFull(annualImpact!.revenue.base) }} current ({{ fmtDeltaMoney(annualImpact!.revenue.base, annualImpact!.revenue.sim) }})</div>
              </div>
            </div>
            <div class="assumption-card">
              <div class="card-head"><span class="period-name">Labor % of Revenue</span></div>
              <div class="metric primary">
                <div class="metric-top">
                  <div class="metric-figure">{{ fmtPct(annualImpact!.laborPct.sim) }}</div>
                  <span v-if="laborPctChip(annualImpact!.laborPct.base, annualImpact!.laborPct.sim)" :class="['chip', laborPctChip(annualImpact!.laborPct.base, annualImpact!.laborPct.sim)]">{{ fmtDeltaPts(annualImpact!.laborPct.base, annualImpact!.laborPct.sim) }}</span>
                </div>
                <div class="metric-sub">vs. {{ fmtPct(annualImpact!.laborPct.base) }} current</div>
              </div>
            </div>
            <div class="assumption-card">
              <div class="card-head"><span class="period-name">Profit Margin</span></div>
              <div class="metric primary">
                <div class="metric-top">
                  <div class="metric-figure">{{ fmtPct(annualImpact!.profitMargin.sim) }}</div>
                  <span v-if="marginChip(annualImpact!.profitMargin.base, annualImpact!.profitMargin.sim)" :class="['chip', marginChip(annualImpact!.profitMargin.base, annualImpact!.profitMargin.sim)]">{{ fmtDeltaPts(annualImpact!.profitMargin.base, annualImpact!.profitMargin.sim) }}</span>
                </div>
                <div class="metric-sub">vs. {{ fmtPct(annualImpact!.profitMargin.base) }} current &middot; {{ fmtMoneyFull(annualImpact!.netIncome.sim) }} net income</div>
              </div>
            </div>
          </div>

          <button type="button" class="link-btn breakdown-toggle" @click="showBreakdown = !showBreakdown">{{ showBreakdown ? '▾ Hide' : '▸ Show' }} full revenue/COGS/labor/opex breakdown</button>

          <div v-if="showBreakdown" class="pl-table-card">
            <table class="pl-table breakdown-table">
              <caption>Current versus simulated annual dollar totals for revenue, COGS, labor split into fixed and variable, operating expenses split into fixed and variable, and net income</caption>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Current</th>
                  <th scope="col">Simulated</th>
                  <th scope="col">Δ</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Revenue</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.revenue.base) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.revenue.sim) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.revenue.base, annualImpact!.revenue.sim) }}</td>
                </tr>
                <tr>
                  <th scope="row">COGS</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.cogs.base) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.cogs.sim) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.cogs.base, annualImpact!.cogs.sim) }}</td>
                </tr>
                <tr>
                  <th scope="row">Labor — fixed (salaries, benefits, taxes)</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.labor.baseFixed) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.labor.simFixed) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.labor.baseFixed, annualImpact!.labor.simFixed) }}</td>
                </tr>
                <tr>
                  <th scope="row">Labor — variable (hourly BOH/FOH)</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.labor.baseVariable) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.labor.simVariable) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.labor.baseVariable, annualImpact!.labor.simVariable) }}</td>
                </tr>
                <tr class="subtotal-row">
                  <th scope="row">Labor — total</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.labor.base) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.labor.sim) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.labor.base, annualImpact!.labor.sim) }}</td>
                </tr>
                <tr>
                  <th scope="row">Opex — fixed</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.opex.baseFixed) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.opex.simFixed) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.opex.baseFixed, annualImpact!.opex.simFixed) }}</td>
                </tr>
                <tr>
                  <th scope="row">Opex — variable</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.opex.baseVariable) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.opex.simVariable) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.opex.baseVariable, annualImpact!.opex.simVariable) }}</td>
                </tr>
                <tr class="subtotal-row">
                  <th scope="row">Opex — total</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.opex.base) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.opex.sim) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.opex.base, annualImpact!.opex.sim) }}</td>
                </tr>
                <tr>
                  <th scope="row">Other Income (not modeled by the simulation)</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.otherIncome) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.otherIncome) }}</td>
                  <td class="derived">$0</td>
                </tr>
                <tr>
                  <th scope="row">Other Expense (not modeled by the simulation)</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.otherExpense) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.otherExpense) }}</td>
                  <td class="derived">$0</td>
                </tr>
                <tr class="subtotal-row">
                  <th scope="row">Net Income</th>
                  <td class="derived">{{ fmtMoneyFull(annualImpact!.netIncome.base) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(annualImpact!.netIncome.sim) }}</td>
                  <td class="derived">{{ fmtDeltaMoney(annualImpact!.netIncome.base, annualImpact!.netIncome.sim) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="rm-section">
          <div class="section-head">
            <div class="section-label">Trailing 3-Month Averages, By Area</div>
            <div class="section-note">
              <template v-if="data?.trailingWindow">Real Toast covers/revenue, {{ fmtDate(data.trailingWindow.start) }}–{{ fmtDate(data.trailingWindow.end) }}.</template>
              Type a covers or $ delta to simulate a change.
              <button type="button" class="link-btn" @click="resetSimulation">Reset simulation</button>
            </div>
          </div>

          <div class="pl-table-card">
            <table class="pl-table sim-table">
              <caption>Trailing three-month average covers per night and per-cover spend by seating area, with editable simulated covers and spend deltas and the resulting simulated covers, spend, and nightly revenue</caption>
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Covers/Night</th>
                  <th scope="col" class="sim">Sim. Covers/Night</th>
                  <th scope="col">Per-Cover $</th>
                  <th scope="col" class="sim">Sim. Per-Cover $</th>
                  <th scope="col">Nightly Revenue</th>
                  <th scope="col" class="sim">Sim. Nightly Revenue</th>
                  <th scope="col">Covers Δ</th>
                  <th scope="col">Spend Δ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in simRows" :key="row.areaId">
                  <th scope="row" style="text-transform: capitalize;">{{ row.areaName }}</th>
                  <td class="derived">{{ fmtCoversPerNight(row.baseCoversPerNight) }}</td>
                  <td class="derived sim">{{ fmtCoversPerNight(row.simCoversPerNight) }}</td>
                  <td class="derived">{{ fmtMoney(row.basePerCover) }}</td>
                  <td class="derived sim">{{ fmtMoney(row.simPerCover) }}</td>
                  <td class="derived">{{ fmtMoneyFull(row.baseNightlyRevenue) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(row.simNightlyRevenue) }}</td>
                  <td><span class="pct-cell"><NumberStepper v-model="draftFor(row.areaId).coversDelta" :min="null" :step="1" width="50px" /></span></td>
                  <td><span class="pct-cell">$<NumberStepper v-model="draftFor(row.areaId).spendDelta" :min="null" :step="1" width="50px" /></span></td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td class="derived">{{ fmtCoversPerNight(totals.baseCoversPerNight) }}</td>
                  <td class="derived sim">{{ fmtCoversPerNight(totals.simCoversPerNight) }}</td>
                  <td class="derived">—</td>
                  <td class="derived sim">—</td>
                  <td class="derived">{{ fmtMoneyFull(totals.baseNightlyRevenue) }}</td>
                  <td class="derived sim">{{ fmtMoneyFull(totals.simNightlyRevenue) }}</td>
                  <td class="derived">—</td>
                  <td class="derived">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section class="rm-section">
          <div class="section-head">
            <div class="section-label">Buyout Events</div>
            <div class="section-note">
              A buyout swaps a normal night for a guaranteed minimum — only the difference over what that weekday normally makes is new revenue. Annual count per weekday.
              <button type="button" class="link-btn" @click="resetSimulation">Reset simulation</button>
            </div>
          </div>

          <div class="buyout-weekday-grid">
            <div v-for="w in data!.buyoutWeekdays" :key="w.dow" class="buyout-weekday-cell">
              <span class="buyout-weekday-label">{{ w.short }}</span>
              <span class="buyout-weekday-target">
                <template v-if="w.dollarTarget != null">normal ~{{ fmtMoneyFull(w.dollarTarget) }}, rate {{ fmtMoneyFull(w.rate) }}</template>
                <template v-else>not enough data yet</template>
              </span>
              <div class="buyout-compare">
                <div class="buyout-compare-stat">
                  <span class="buyout-compare-label">Booked</span>
                  <span class="derived">{{ fmtMoneyFull(bookedRevenueFor(w)) }}</span>
                  <span class="buyout-compare-count">{{ fmtBuyoutCount(bookedCountFor(w.dow)) }}</span>
                </div>
                <div class="buyout-compare-stat sim">
                  <span class="buyout-compare-label">Sim.</span>
                  <span class="derived sim">{{ fmtMoneyFull(simRevenueFor(w)) }}</span>
                  <span class="buyout-compare-count">{{ fmtBuyoutCount(simCountFor(w)) }}</span>
                </div>
              </div>
              <span class="pct-cell">+<NumberStepper v-model="buyoutCounts[w.dow]" :min="0" :step="1" width="44px" :disabled="w.dollarTarget == null" /></span>
            </div>
          </div>

          <div class="section-note">
            Already booked for {{ data!.modelYear }} (from the <NuxtLink to="/budget/revenue">Revenue tab</NuxtLink>): <strong>{{ fmtMoneyFull(buyoutBookedRevenueTotal) }}</strong>
            <template v-if="buyoutHasAnyCount"> &middot; plus <strong>{{ fmtDeltaMoney(0, buyoutAnnualRevenueDelta) }}</strong> from this simulation</template>
          </div>
        </section>

        <div class="legend rm-legend">
          <span class="chip good">Improves vs. current</span>
          <span class="chip critical">Worsens vs. current</span>
        </div>

        <footer class="rm-footer">
          <span>Baseline: real trailing 3-month Toast per-area covers/revenue, annualized against this year's real budget/actual revenue, COGS, labor, and opex.</span>
        </footer>
      </template>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.link-btn {
  font: inherit;
  font-weight: 600;
  color: var(--accent);
  background: none;
  border: none;
  padding: 0;
  margin-left: 6px;
  cursor: pointer;
  text-decoration: underline;
}
.breakdown-toggle { margin: 2px 0 0; display: inline-block; font-size: 12px; }

/* Overrides main.css's global `section { margin: 2rem 0 }` (a compound
   selector beats a bare element selector regardless of stylesheet order) —
   this page packs a lot into one screen (per the user's explicit request to
   fit a 13" laptop viewport without scrolling), so the generous default
   section rhythm used elsewhere in the app is too tall here. */
section.rm-section { margin: 0.9rem 0; }
.legend.rm-legend { padding-top: 0; margin: 0.4rem 0; }
footer.rm-footer { padding-top: 8px; }

.drill-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
  margin-bottom: 8px;
}
table.pl-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
.pl-table caption { display: none; }
.pl-table th, .pl-table td { padding: 9px 12px; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-table th:first-child, .pl-table td:first-child { text-align: left; white-space: normal; }
.pl-table thead th { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: #ffffff; background: #3e5c76; border-bottom: 1px solid #2c4459; white-space: normal; padding-top: 11px; padding-bottom: 11px; }
.pl-table tbody th { text-align: left; font-weight: 600; font-size: 13px; color: var(--ink); }
.pl-table tbody tr { border-bottom: 1px solid var(--hair); }
.pl-table tbody tr:last-child { border-bottom: none; }
.pl-table tfoot th, .pl-table tfoot td { font-weight: 700; border-top: 2px solid var(--hair); padding-top: 10px; padding-bottom: 10px; }

.derived { font-weight: 600; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.derived.sim { color: var(--accent); }
/* Light gray backing for the three Sim. columns (Covers/Night, Per-Cover $,
   Nightly Revenue) on the per-area table, at the user's request, so they
   read as visually distinct from the current-value columns they sit next
   to. Scoped to .sim-table specifically — the collapsed breakdown table
   below also reuses .derived.sim for its own "Simulated" column, but wasn't
   part of this request. var(--surface-alt) is the app's existing subtle
   light/dark-aware "muted region" token, not a new hardcoded color. The
   header row is a fixed dark navy regardless of theme, so a plain white
   overlay (not the theme token) is what reads as "slightly lighter" there
   in both modes. */
.sim-table .derived.sim { background: var(--surface-alt); }
/* A plain rgba white overlay doesn't work here — background-color fully
   replaces the base rule's `background: #3e5c76` shorthand rather than
   compositing on top of it, so a low-alpha white read as pure white (and
   made the white header text invisible). color-mix against the same navy
   keeps it a real, solid, slightly-lighter navy instead. */
.sim-table thead th.sim { background-color: color-mix(in srgb, #3e5c76 88%, white 12%); }
.subtotal-row th, .subtotal-row td { border-top: 1px dashed var(--hair); font-weight: 700; }
.subtotal-row .derived { color: var(--ink); }
.subtotal-row .derived.sim { color: var(--accent); }

.pct-cell { display: inline-flex; align-items: center; gap: 3px; }

/* ---------- annual impact cards ---------- */
.quick-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 8px; }
.assumption-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 14px;
  box-shadow: var(--card-shadow);
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.card-head { display: flex; flex-direction: column; gap: 2px; }
.card-head .period-name { font-size: 11.5px; font-weight: 700; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.02em; }
.metric { display: flex; flex-direction: column; gap: 2px; }
.metric-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.metric-figure { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; color: var(--ink); }
.metric.primary .metric-figure { font-size: 22px; }
.metric-sub { font-size: 11px; color: var(--ink-3); }

@media (max-width: 900px) {
  .quick-row { grid-template-columns: 1fr; }
}

/* ---------- buyout events ---------- */
.buyout-weekday-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin: 4px 0 10px;
}
.buyout-weekday-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--hair);
  box-shadow: var(--card-shadow);
}
.buyout-weekday-label { font-size: 12px; font-weight: 700; color: var(--ink); }
.buyout-weekday-target { font-size: 10px; color: var(--ink-3); text-align: center; }

/* Booked (real, already on the Revenue tab) vs. Sim. (booked + this page's
   typed delta) — same base/sim visual convention as the per-area table
   above: plain ink for the real figure, the accent color + var(--surface-alt)
   shading for the simulated one (.sim-table .derived.sim, reused verbatim). */
.buyout-compare { display: flex; gap: 4px; width: 100%; }
.buyout-compare-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px 2px;
  border-radius: 6px;
}
.buyout-compare-stat.sim { background: var(--surface-alt); }
.buyout-compare-label { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: var(--ink-3); }
.buyout-compare-stat .derived { font-size: 12px; }
.buyout-compare-count { font-size: 8.5px; color: var(--ink-3); }

@media (max-width: 760px) {
  .buyout-weekday-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
