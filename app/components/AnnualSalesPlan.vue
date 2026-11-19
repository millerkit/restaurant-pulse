<script setup lang="ts">
// Sales Strategy › Annual plan (2026-11-19): a full-year scenario for closing the budget gap with extra event sales,
// buyouts, retail and extra covers per area. Baseline and saved inputs from /api/sales-strategy/annual
// (server/utils/annual-sales-plan.ts); the arithmetic runs here so numbers can be tried before saving.
const props = defineProps<{ year: number }>()

type Inputs = {
  eventSales: number, eventMarginPct: number, buyouts: number, buyoutPrice: number,
  retailPerMonth: number, retailMarginPct: number, dineInMarginPct: number, extraCovers: Record<string, number>
}
type Area = { id: number, name: string, nights: number, coversPerNight: number, seatsPerNight: number, spendPerGuest: number }
type Annual = {
  year: number,
  baseline: {
    revenue: number, netIncome: number, principal: number, afterPrincipal: number, eventSalesBudgeted: number,
    nights: number, avgNormalNight: number | null, buyoutRates: { weekday: number, weekend: number }, contribRate: number | null
  },
  areas: Area[], inputs: Inputs, defaults: Inputs, saved: { updatedAt: string, updatedBy: string | null } | null
}

const query = computed(() => ({ year: props.year }))
const { data, error, pending } = await useFetch<Annual>('/api/sales-strategy/annual', { query, lazy: true })

const form = ref<Inputs | null>(null)
const clone = (i: Inputs): Inputs => ({ ...i, extraCovers: { ...i.extraCovers } })
watch(data, (d) => { if (d) form.value = clone(d.inputs) }, { immediate: true })

const fmtMoney = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`
const fmtK = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}$${Math.round(Math.abs(n) / 1000).toLocaleString()}K`
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const calc = computed(() => {
  const d = data.value, f = form.value
  if (!d || !f) return null
  const dineIn = n(f.dineInMarginPct) / 100
  const areas = d.areas.map((a) => {
    const extra = n(f.extraCovers[a.id])
    const after = a.coversPerNight + extra
    const sales = extra * a.spendPerGuest * a.nights
    return { ...a, extra, after, fill: a.seatsPerNight > 0 ? after / a.seatsPerNight : null, sales }
  })
  const coversSales = areas.reduce((s, a) => s + a.sales, 0)
  const extraPerNight = areas.reduce((s, a) => s + a.extra, 0)
  const nowPerNight = areas.reduce((s, a) => s + a.coversPerNight * a.nights, 0) / Math.max(1, d.baseline.nights)
  const avgNight = d.baseline.avgNormalNight ?? 0
  const buyoutAdds = Math.max(0, n(f.buyoutPrice) - avgNight)
  const rows = {
    events: { sales: n(f.eventSales), profit: n(f.eventSales) * n(f.eventMarginPct) / 100 },
    buyouts: { sales: n(f.buyouts) * buyoutAdds, profit: n(f.buyouts) * buyoutAdds * dineIn, gross: n(f.buyouts) * n(f.buyoutPrice) },
    retail: { sales: n(f.retailPerMonth) * 12, profit: n(f.retailPerMonth) * 12 * n(f.retailMarginPct) / 100 },
    covers: { sales: coversSales, profit: coversSales * dineIn }
  }
  const sales = rows.events.sales + rows.buyouts.sales + rows.retail.sales + rows.covers.sales
  const profit = rows.events.profit + rows.buyouts.profit + rows.retail.profit + rows.covers.profit
  const netIncome = d.baseline.netIncome + profit
  const afterPrincipal = netIncome - d.baseline.principal
  return { areas, rows, sales, profit, netIncome, afterPrincipal, buyoutAdds, avgNight, extraPerNight, nowPerNight, revenue: d.baseline.revenue + sales }
})

// The glyph and the label carry the meaning, never color alone.
const verdict = computed(() => {
  const c = calc.value
  if (!c) return null
  if (c.afterPrincipal >= 0) return { cls: 'good', text: '✓ Covers loan principal too' }
  if (c.netIncome >= 0) return { cls: 'warning', text: '▲ Profitable, short of loan principal' }
  return { cls: 'serious', text: '⚠ Still a loss' }
})

const dirty = computed(() => !!data.value && !!form.value && JSON.stringify(form.value) !== JSON.stringify(data.value.inputs))
const status = ref<'idle' | 'saving' | 'error'>('idle')
const message = ref('')
async function save(reset = false) {
  if (!form.value) return
  status.value = 'saving'
  try {
    data.value = await $fetch<Annual>('/api/sales-strategy/annual', { method: 'POST', body: reset ? { year: props.year, reset: true } : { year: props.year, inputs: form.value } })
    status.value = 'idle'
    message.value = ''
  } catch (err: unknown) {
    status.value = 'error'
    message.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Could not save the plan.'
  }
}
const areaLabel = (name: string) => name.replace(/\b\w/g, c => c.toUpperCase()).replace("Chefs", "Chef's")
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
</script>

<template>
  <section class="ss-card">
    <div class="ss-title">Annual plan — {{ year }}</div>
    <div v-if="error" class="ss-basis"><span class="chip critical">Couldn't load the annual plan</span> {{ error.message }}</div>
    <div v-else-if="pending && !data" class="ss-basis">Loading…</div>
    <template v-else-if="data && form && calc">
      <div class="ap-headline">
        <span v-if="verdict" :class="['chip', verdict.cls]">{{ verdict.text }}</span>
        <span>Net income <strong>{{ fmtMoney(data.baseline.netIncome) }}</strong> in the budget → <strong>{{ fmtMoney(calc.netIncome) }}</strong> with this plan,
          <strong>{{ fmtMoney(calc.afterPrincipal) }}</strong> after {{ fmtMoney(data.baseline.principal) }} of loan principal.</span>
      </div>
      <div class="ss-scroll">
        <table class="ss-table ap-table">
          <thead>
            <tr>
              <td>source</td>
              <td>plan</td>
              <td class="num">added sales</td>
              <td class="num">kept as profit</td>
              <td class="num">profit</td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Special events & catering</strong><span class="ss-sub">beyond the {{ fmtMoney(data.baseline.eventSalesBudgeted) }} budgeted</span></td>
              <td><label class="ap-field">$ <input v-model.number="form.eventSales" type="number" min="0" step="10000" class="ss-input ap-money" aria-label="Extra event sales a year" /> a year</label></td>
              <td class="num">{{ fmtMoney(calc.rows.events.sales) }}</td>
              <td class="num"><input v-model.number="form.eventMarginPct" type="number" min="0" max="100" class="ss-input ap-pct" aria-label="Event profit share" /> %</td>
              <td class="num">{{ fmtMoney(calc.rows.events.profit) }}</td>
            </tr>
            <tr>
              <td>
                <strong>Buyouts</strong>
                <span class="ss-sub">each adds {{ fmtMoney(calc.buyoutAdds) }} over the average forecast night ({{ fmtMoney(calc.avgNight) }})</span>
              </td>
              <td>
                <label class="ap-field"><input v-model.number="form.buyouts" type="number" min="0" step="1" class="ss-input ap-count" aria-label="Buyouts a year" /> a year at $</label>
                <input v-model.number="form.buyoutPrice" type="number" min="0" step="500" class="ss-input ap-money" aria-label="Average buyout price" />
                <span class="ss-sub">{{ (form.buyouts / 12).toFixed(1) }} a month · {{ fmtMoney(calc.rows.buyouts.gross) }} booked in all</span>
              </td>
              <td class="num">{{ fmtMoney(calc.rows.buyouts.sales) }}</td>
              <td class="num">{{ form.dineInMarginPct }} %<span class="ss-sub">same as dine-in</span></td>
              <td class="num">{{ fmtMoney(calc.rows.buyouts.profit) }}</td>
            </tr>
            <tr>
              <td><strong>Retail</strong></td>
              <td><label class="ap-field">$ <input v-model.number="form.retailPerMonth" type="number" min="0" step="500" class="ss-input ap-money" aria-label="Retail sales a month" /> a month</label></td>
              <td class="num">{{ fmtMoney(calc.rows.retail.sales) }}</td>
              <td class="num"><input v-model.number="form.retailMarginPct" type="number" min="0" max="100" class="ss-input ap-pct" aria-label="Retail profit share" /> %</td>
              <td class="num">{{ fmtMoney(calc.rows.retail.profit) }}</td>
            </tr>
            <tr>
              <td>
                <strong>More guests</strong>
                <span class="ss-sub">+{{ calc.extraPerNight.toFixed(1).replace(/\.0$/, '') }} a night on about {{ Math.round(calc.nowPerNight) }} expected ({{ calc.nowPerNight > 0 ? Math.round(calc.extraPerNight / calc.nowPerNight * 100) : 0 }}%)</span>
              </td>
              <td />
              <td class="num">{{ fmtMoney(calc.rows.covers.sales) }}</td>
              <td class="num"><input v-model.number="form.dineInMarginPct" type="number" min="0" max="100" class="ss-input ap-pct" aria-label="Dine-in profit share" /> %</td>
              <td class="num">{{ fmtMoney(calc.rows.covers.profit) }}</td>
            </tr>
            <tr v-for="a in calc.areas" :key="a.id" class="ap-sub-row">
              <td>
                {{ areaLabel(a.name) }}
                <span class="ss-sub">{{ Math.round(a.coversPerNight) }} of {{ Math.round(a.seatsPerNight) }} seats expected · {{ fmtMoney(a.spendPerGuest) }} a guest · {{ a.nights }} nights</span>
              </td>
              <td>
                <label class="ap-field">+ <input v-model.number="form.extraCovers[a.id]" type="number" step="0.5" class="ss-input ap-count" :aria-label="`Extra guests a night, ${a.name}`" /> a night</label>
                <span v-if="a.fill != null && a.fill > 1" class="chip serious ap-chip">⚠ over the seats</span>
                <span v-else-if="a.fill != null && a.fill > 0.85" class="chip warning ap-chip">▲ {{ Math.round(a.fill * 100) }}% full</span>
              </td>
              <td class="num">{{ a.sales ? fmtMoney(a.sales) : '—' }}</td>
              <td />
              <td class="num">{{ a.sales ? fmtMoney(a.sales * form.dineInMarginPct / 100) : '—' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Extra profit</strong></td>
              <td />
              <td class="num"><strong>{{ fmtMoney(calc.sales) }}</strong></td>
              <td />
              <td class="num"><strong>{{ fmtMoney(calc.profit) }}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="ap-outcome">
        <div><span class="ss-sub">Total sales</span>{{ fmtMoney(data.baseline.revenue) }} → <strong>{{ fmtMoney(calc.revenue) }}</strong></div>
        <div><span class="ss-sub">Net income</span>{{ fmtMoney(data.baseline.netIncome) }} → <strong>{{ fmtMoney(calc.netIncome) }}</strong> <span class="ap-delta">{{ fmtK(calc.profit) }}</span></div>
        <div><span class="ss-sub">After loan principal</span>{{ fmtMoney(data.baseline.afterPrincipal) }} → <strong>{{ fmtMoney(calc.afterPrincipal) }}</strong></div>
        <div v-if="calc.afterPrincipal < 0"><span class="ss-sub">Still needed to cover principal</span><strong>{{ fmtMoney(-calc.afterPrincipal) }}</strong> of profit</div>
      </div>

      <div class="ap-actions">
        <button type="button" class="mini-btn" :disabled="!dirty || status === 'saving'" @click="save()">Save plan</button>
        <button type="button" class="mini-btn" :disabled="!dirty" @click="form = clone(data.inputs)">Undo changes</button>
        <button v-if="data.saved" type="button" class="mini-btn" :disabled="status === 'saving'" @click="save(true)">Back to defaults</button>
        <span v-if="status === 'error'" class="chip warning">{{ message }}</span>
        <span v-else-if="data.saved" class="ss-sub inline">Saved {{ fmtDate(data.saved.updatedAt) }}<template v-if="data.saved.updatedBy"> by {{ data.saved.updatedBy }}</template></span>
        <span v-else class="ss-sub inline">Showing the starting numbers; nothing saved yet.</span>
      </div>

      <div class="ss-basis">
        Starts from the saved {{ year }} budget and adds each source on top. Buyouts can land on any night, so each one adds its price minus an average forecast night
        (your rates: {{ fmtMoney(data.baseline.buyoutRates.weekday) }} Tue–Thu, {{ fmtMoney(data.baseline.buyoutRates.weekend) }} Fri–Sun). More guests use each area's spend per guest and open nights
        from the Capacity forecast; the % kept for dine-in starts at the Breakeven contribution rate (after food & drink cost and variable expenses). Events keep less for event staffing and rentals,
        which can't be measured separately yet; retail is a guess until it has history. Labor, rent and everything else stay as budgeted.
      </div>
    </template>
  </section>
</template>

<style scoped>
.ss-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px;
  margin: 0 0 18px;
}
.ss-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.ss-basis { font-size: 12px; color: var(--ink-2); }
.ss-scroll { overflow-x: auto; }
.ss-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ss-table thead td { font-size: 11px; color: var(--ink-3); padding: 4px 8px; vertical-align: bottom; }
.ss-table tbody td, .ss-table tfoot td { padding: 7px 8px; border-top: 1px solid var(--hair); vertical-align: middle; }
.ss-table tfoot td { border-top: 2px solid var(--ink-3); }
.ss-table .num { text-align: right; white-space: nowrap; }
.ss-sub { display: block; font-size: 10.5px; color: var(--ink-3); font-weight: 400; margin-top: 1px; }
.ss-sub.inline { display: inline; margin-left: 4px; }
.ss-input { font: inherit; font-size: 12.5px; padding: 3px 6px; border: 1px solid var(--hair); border-radius: 8px; background: var(--surface); color: var(--ink); }
.ap-money { width: 92px; }
.ap-count { width: 58px; }
.ap-pct { width: 52px; text-align: right; }
.ap-field { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; color: var(--ink-2); }
.ap-sub-row td:first-child { padding-left: 22px; }
.ap-chip { margin-left: 6px; }
.ap-headline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13.5px; }
.ap-outcome { display: flex; flex-wrap: wrap; gap: 8px 28px; font-size: 13px; }
.ap-delta { font-size: 11.5px; color: var(--ink-2); }
.ap-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.mini-btn { font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--hair); border-radius: 8px; background: var(--surface-alt); color: var(--ink); cursor: pointer; }
.mini-btn:disabled { opacity: 0.5; cursor: default; }
@media (max-width: 640px) {
  .ss-table { font-size: 12px; }
  .ss-table thead td, .ss-table tbody td, .ss-table tfoot td { padding-left: 4px; padding-right: 4px; }
}
</style>
