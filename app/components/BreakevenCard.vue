<script setup lang="ts">
// Breakeven covers/night — fed by /api/breakeven (see that route's header comment for how the
// four cumulative tiers are built and why FOH hourly is treated as a per-cover variable cost).
import { MONTH_NAMES } from '~/composables/useBudgetData'

type Tier = { key: string, label: string, detail: string, monthly: number, coversPerNight: number | null }
type Weekday = { key: string, label: string, short: string, sampleDays: number, avgCovers: number | null, avgSpend: number | null, coversNeeded: Record<string, number | null> }
type Breakeven = {
  year: number, month: number, asOfDate: string | null, windowStart: string | null, sampleOpenDays: number, nights: number,
  laborBudgeted: boolean, avgCoversPerNight: number | null, avgSpend: number | null,
  cogsPct: number | null, varOpexPct: number | null, contribRate: number | null, fohPerCover: number, contribPerCover: number | null,
  components: { fixedLabor: number, kitchenCrew: number, variableLabor: number, fixedOpex: number, loanPrincipal: number },
  tiers: Tier[], weekdays: Weekday[], excludedNights: { date: string, covers: number, revenue: number, spend: number }[]
}

const data = ref<Breakeven | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const currentMonth = ref<number | null>(null)
const selectedMonth = ref<number | null>(null)
// Default to the P&L breakeven — the number that lines up with the budget — with the cash
// breakeven one click away.
const selectedTier = ref('fixed_opex')

async function load(month?: number) {
  loading.value = true
  loadError.value = null
  try {
    const res = await $fetch<Breakeven>('/api/breakeven', { query: month ? { month } : {} })
    data.value = res
    if (currentMonth.value === null) currentMonth.value = res.month
    selectedMonth.value = res.month
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || err?.message || 'Failed to load breakeven data'
  } finally {
    loading.value = false
  }
}
onMounted(() => load())

const monthOptions = computed(() => currentMonth.value === null ? [] : Array.from({ length: 12 - currentMonth.value + 1 }, (_, i) => currentMonth.value! + i))
function onMonthChange(e: Event) {
  load(Number((e.target as HTMLSelectElement).value))
}

const tier = computed(() => data.value?.tiers.find(t => t.key === selectedTier.value) ?? null)

// Weekly totals row for the weekday table: covers sum across the operating nights, spend is the
// cover-weighted average (total revenue / total covers), and the delta reuses the same status chip.
const weekTotals = computed(() => {
  const d = data.value
  if (!d) return null
  const withCovers = d.weekdays.filter(w => w.avgCovers != null)
  if (withCovers.length === 0) return null
  const covers = withCovers.reduce((s, w) => s + w.avgCovers!, 0)
  const revenue = withCovers.reduce((s, w) => s + w.avgCovers! * (w.avgSpend ?? 0), 0)
  const needs = d.weekdays.map(w => w.coversNeeded[selectedTier.value] ?? null)
  const needed = needs.every(n => n != null) ? needs.reduce((s, n) => s + n!, 0) : null
  return { covers, spend: covers > 0 ? revenue / covers : null, needed }
})
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`
const fmtCovers = (n: number | null) => n == null ? '—' : String(Math.round(n))

// Status of the recent average vs. a needed figure. The glyph carries the meaning (not just
// the color), per the app's "never color alone" rule: ✓ covered, ~ within 10%, ▲ short.
function status(actual: number | null, needed: number | null): { cls: string, text: string } | null {
  if (actual == null || needed == null) return null
  const diff = Math.round(actual) - Math.round(needed)
  if (diff >= 0) return { cls: 'good', text: `✓ ${diff === 0 ? 'at breakeven' : `+${diff} above`}` }
  return { cls: actual >= needed * 0.9 ? 'warning' : 'serious', text: `▲ ${-diff} short` }
}

// Sensitivity for the selected tier, from the same primitives the server used (so it can't
// drift from the table): covers/night = monthly / nights / (spend * rate - FOH per cover).
const sensitivity = computed(() => {
  const d = data.value, t = tier.value
  if (!d || !t || d.avgSpend == null || d.contribRate == null || d.nights <= 0) return null
  const need = (monthly: number, spend: number) => {
    const c = spend * d.contribRate! - d.fohPerCover
    return c > 0 ? monthly / d.nights / c : null
  }
  const base = need(t.monthly, d.avgSpend)
  const withSpend = need(t.monthly, d.avgSpend + 5)
  const withFixed = need(t.monthly + 10000, d.avgSpend)
  if (base == null || withSpend == null || withFixed == null) return null
  return { spendSaves: base - withSpend, fixedCosts: withFixed - base }
})
</script>

<template>
  <section class="be-card">
    <div class="be-head">
      <div class="be-title">Breakeven Covers / Night</div>
      <label v-if="monthOptions.length > 1" class="be-month">
        Month
        <select :value="selectedMonth" @change="onMonthChange">
          <option v-for="m in monthOptions" :key="m" :value="m">{{ MONTH_NAMES[m - 1] }}</option>
        </select>
      </label>
    </div>

    <div v-if="loadError" class="quiet-note">Couldn't load breakeven: {{ loadError }}</div>
    <div v-else-if="loading && !data" class="quiet-note">Loading…</div>
    <template v-else-if="data">
      <div v-if="data.avgSpend === null || data.contribRate === null" class="quiet-note">
        Not enough data yet — needs recent Toast covers with matching core revenue, and COGS / variable-opex benchmarks.
      </div>
      <template v-else>
        <div class="be-lead">
          Covers a night that core dine-in sales need to carry each layer of cost that doesn't flex with volume.
          Recent average: <strong>{{ fmtCovers(data.avgCoversPerNight) }} covers/night</strong> at
          <strong>{{ fmtMoney(data.avgSpend) }}</strong>/cover.
        </div>

        <table class="be-table">
          <thead>
            <tr><td>layer (cumulative)</td><td class="num">$ / mo</td><td class="num">covers / night</td><td class="num">vs. recent avg</td></tr>
          </thead>
          <tbody>
            <tr v-for="t in data.tiers" :key="t.key" :class="{ selected: t.key === selectedTier }" @click="selectedTier = t.key">
              <td>
                <label class="tier-pick">
                  <input type="radio" name="be-tier" :value="t.key" v-model="selectedTier" />
                  <span><strong>{{ t.label }}</strong><span class="be-sub">{{ t.detail }}</span></span>
                </label>
              </td>
              <td class="num">{{ fmtMoney(t.monthly) }}</td>
              <td class="num"><strong>{{ fmtCovers(t.coversPerNight) }}</strong></td>
              <td class="num">
                <span v-if="status(data.avgCoversPerNight, t.coversPerNight)" :class="['chip', status(data.avgCoversPerNight, t.coversPerNight)!.cls]">{{ status(data.avgCoversPerNight, t.coversPerNight)!.text }}</span>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="be-basis">
          Each cover contributes about <strong>{{ fmtMoney(data.contribPerCover ?? 0) }}</strong> after COGS ({{ Math.round((data.cogsPct ?? 0) * 100) }}%),
          variable opex ({{ Math.round((data.varOpexPct ?? 0) * 100) }}%) and front-of-house hourly (about {{ fmtMoney(data.fohPerCover) }}/cover).
          {{ data.nights }} operating nights in {{ MONTH_NAMES[data.month - 1] }}.
        </div>
        <div v-if="sensitivity" class="be-basis">
          For the selected layer: <strong>+$5 spend per cover</strong> lowers the target by about {{ sensitivity.spendSaves.toFixed(1) }} covers/night;
          <strong>each extra $10K/month of fixed cost</strong> raises it by about {{ sensitivity.fixedCosts.toFixed(1) }}.
        </div>
        <div v-if="!data.laborBudgeted" class="be-basis warn">No labor budget is saved for {{ MONTH_NAMES[data.month - 1] }} yet — save the Labor tab, or the labor layers read $0.</div>

        <div class="be-weekday-head">By weekday <span class="be-sub inline">— covers each night needs to carry an equal share of the selected layer</span></div>
        <table class="be-table">
          <thead>
            <tr><td>night</td><td class="num">avg covers</td><td class="num">avg spend</td><td class="num">covers needed</td><td class="num">vs. needed</td></tr>
          </thead>
          <tbody>
            <tr v-for="w in data.weekdays" :key="w.key">
              <td><strong>{{ w.label }}</strong><span class="be-sub">{{ w.sampleDays }} recent nights</span></td>
              <td class="num">{{ fmtCovers(w.avgCovers) }}</td>
              <td class="num">{{ w.avgSpend != null ? fmtMoney(w.avgSpend) : '—' }}</td>
              <td class="num"><strong>{{ fmtCovers(w.coversNeeded[selectedTier] ?? null) }}</strong></td>
              <td class="num">
                <span v-if="status(w.avgCovers, w.coversNeeded[selectedTier] ?? null)" :class="['chip', status(w.avgCovers, w.coversNeeded[selectedTier] ?? null)!.cls]">{{ status(w.avgCovers, w.coversNeeded[selectedTier] ?? null)!.text }}</span>
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

        <div class="be-foot">
          Window: last {{ data.sampleOpenDays }} open nights ({{ data.windowStart }} to {{ data.asOfDate }}). Costs come from the saved {{ MONTH_NAMES[data.month - 1] }} budget.
          <template v-if="data.excludedNights.length > 0">
            Left out as unrepresentative (spend per cover far from typical — likely an event or buyout):
            <span v-for="(n, i) in data.excludedNights" :key="n.date">{{ n.date }} ({{ fmtMoney(n.spend) }}/cover, {{ n.covers }} covers){{ i < data.excludedNights.length - 1 ? '; ' : '. ' }}</span>
          </template>
          Core dine-in only &mdash; events, catering and retail margin lower the covers needed further. Fixed labor and kitchen crew are modeled as fixed; FOH hourly flexes with covers.
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.be-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px;
  margin: 8px 0 26px;
}
.be-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.be-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.be-month { font-size: 12px; color: var(--ink-3); display: flex; align-items: center; gap: 6px; }
.be-month select { font-size: 12px; padding: 2px 4px; border: 1px solid var(--hair); border-radius: 5px; background: var(--surface); color: var(--ink-2); }
.be-lead { font-size: 13px; color: var(--ink-2); }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.be-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.be-table thead td { font-size: 11px; color: var(--ink-3); padding: 4px 8px; }
.be-table tbody td { padding: 7px 8px; border-top: 1px solid var(--hair); vertical-align: middle; }
.be-table .num { text-align: right; white-space: nowrap; }
.be-table tfoot td { padding: 8px 8px 7px; border-top: 2px solid var(--hair); vertical-align: middle; }
.be-table tbody tr.selected td { background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.be-table tbody tr { cursor: default; }
.be-table tbody tr:has(.tier-pick) { cursor: pointer; }
.tier-pick { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.tier-pick input { margin-top: 3px; }
.be-sub { display: block; font-size: 10.5px; color: var(--ink-3); font-weight: 400; margin-top: 1px; }
.be-sub.inline { display: inline; margin: 0; font-size: 11px; }
.be-basis { font-size: 12px; color: var(--ink-2); }
.be-basis.warn { color: var(--serious); }
.be-weekday-head { font-size: 12px; font-weight: 700; color: var(--ink-2); margin-top: 6px; }
.be-foot { font-size: 11px; color: var(--ink-3); }
</style>
