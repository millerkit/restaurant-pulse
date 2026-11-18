<script setup lang="ts">
// Planning › Sales Strategy (owner-only by default deny). Step 1: the Breakeven gap for every open month,
// sorted by what kind of help closes it. Fed by /api/sales-strategy (server/utils/sales-strategy.ts);
// each month links to Breakeven for the full detail.
import site from '~/config/site.json'
import { MONTH_NAMES, useBudgetYearSelection } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Sales Strategy` })

type Kind = 'covered' | 'dine-in' | 'events' | 'no-data'
type StrategyMonth = {
  month: number, kind: Kind, costs: number,
  stillShort: number | null, cashStillShort: number | null,
  expectedCoversPerNight: number | null, coversSource: 'recent' | 'forecast',
  maxCoversPerNight: number | null, headroomPct: number | null, liftPct: number | null,
  coversNeededPerNight: number | null,
  eventSalesNeeded: number, eventsNeeded: number | null, plannedEventsRevenue: number,
  nights: number, laborBudgeted: boolean
}
type Strategy = {
  year: number, today: { year: number, month: number }, firstMonth: number, realisticLiftPct: number,
  avgEventSize: number | null, asOfDate: string | null, months: StrategyMonth[]
}

const { year: selYear } = useBudgetYearSelection()
const query = computed(() => ({ year: selYear.value }))
const { data, pending, error, refresh } = await useFetch<Strategy>('/api/sales-strategy', { query, lazy: true })

const fmtMoney = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`
const fmtCovers = (n: number | null | undefined) => n == null ? '—' : String(Math.round(n))
const pct = (n: number | null | undefined) => n == null ? '—' : `${n < 0 ? '−' : ''}${Math.round(Math.abs(n) * 100)}%`

// The glyph and the label carry the meaning, never color alone.
const KIND: Record<Kind, { cls: string, text: string, help: string }> = {
  'covered': { cls: 'good', text: '✓ Covered', help: 'At expected covers and planned events, the P&L breakeven is met.' },
  'dine-in': { cls: 'warning', text: '▲ More covers', help: 'A realistic lift in covers closes it.' },
  'events': { cls: 'serious', text: '⚠ Needs events', help: 'More covers alone is not realistic; events, catering or buyouts have to close it.' },
  'no-data': { cls: 'quiet', text: '— Not enough data', help: 'Needs recent Toast covers with matching revenue, cost targets, and a labor budget.' }
}

const counts = computed(() => {
  const c: Record<Kind, number> = { 'covered': 0, 'dine-in': 0, 'events': 0, 'no-data': 0 }
  for (const m of data.value?.months ?? []) c[m.kind]++
  return c
})
const totalEventsNeeded = computed(() => (data.value?.months ?? []).reduce((s, m) => s + (m.kind === 'events' ? (m.eventsNeeded ?? 0) : 0), 0))
</script>

<template>
  <div>
    <PageHeader
      page-name="Sales Strategy"
      description="Which months fall short of breakeven, and whether more covers or more events is the realistic way to close each gap."
      @synced="refresh()"
    />

    <div v-if="error" class="drill-card"><span class="chip critical">Couldn't load sales strategy</span> <span class="quiet-note">{{ error.message }}</span></div>
    <div v-else-if="pending && !data" class="state-note">Loading…</div>
    <template v-else-if="data">
      <BudgetYearToggle />

      <section class="ss-card">
        <div class="ss-title">At a glance — {{ data.year }}</div>
        <div class="ss-summary">
          <span class="chip good">✓ {{ counts.covered }} covered</span>
          <span class="chip warning">▲ {{ counts['dine-in'] }} need more covers</span>
          <span class="chip serious">⚠ {{ counts.events }} need events</span>
          <span v-if="counts['no-data']" class="chip quiet">— {{ counts['no-data'] }} not enough data</span>
        </div>
        <div v-if="totalEventsNeeded > 0" class="ss-basis">
          About <strong>{{ totalEventsNeeded }} more events</strong> across the months that need them<template v-if="data.avgEventSize"> at your typical {{ fmtMoney(data.avgEventSize) }}</template>, beyond what's already planned.
        </div>
      </section>

      <section class="ss-card">
        <div class="ss-title">Month by month — P&L breakeven</div>
        <div class="ss-scroll">
          <table class="ss-table">
            <thead>
              <tr>
                <td>month</td>
                <td class="num">covers/night<span class="ss-sub">expected</span></td>
                <td class="num">room to grow<span class="ss-sub">to full seats</span></td>
                <td class="num">still short<span class="ss-sub">after planned events</span></td>
                <td class="num">lift needed<span class="ss-sub">every night</span></td>
                <td>closes it</td>
                <td class="num">events needed<span class="ss-sub">more than planned</span></td>
                <td class="num">cash short<span class="ss-sub">with loan principal</span></td>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in data.months" :key="m.month">
                <td>
                  <NuxtLink :to="`/breakeven?month=${m.month}`"><strong>{{ MONTH_NAMES[m.month - 1] }}</strong></NuxtLink>
                  <span class="ss-sub">{{ m.nights }} nights<template v-if="m.coversSource === 'recent'"> · recent covers</template></span>
                </td>
                <td class="num">{{ fmtCovers(m.expectedCoversPerNight) }}</td>
                <td class="num">{{ m.headroomPct != null ? pct(m.headroomPct) : '—' }}<span v-if="m.maxCoversPerNight != null" class="ss-sub">{{ fmtCovers(m.maxCoversPerNight) }} max</span></td>
                <td class="num">
                  <template v-if="m.stillShort != null">{{ m.stillShort > 0 ? fmtMoney(m.stillShort) : `${fmtMoney(-m.stillShort)} spare` }}</template>
                  <template v-else>—</template>
                </td>
                <td class="num">{{ m.kind === 'covered' || m.liftPct == null ? '—' : pct(m.liftPct) }}</td>
                <td><span :class="['chip', KIND[m.kind].cls]" :title="KIND[m.kind].help">{{ KIND[m.kind].text }}</span></td>
                <td class="num">{{ m.eventsNeeded != null ? m.eventsNeeded : '—' }}<span v-if="m.eventsNeeded != null && m.eventSalesNeeded > 0" class="ss-sub">{{ fmtMoney(m.eventSalesNeeded) }} in sales</span></td>
                <td class="num">{{ m.cashStillShort != null ? (m.cashStillShort > 0 ? fmtMoney(m.cashStillShort) : '✓') : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="ss-basis"><NuxtLink to="/budget/revenue">Add events and buyouts on the Sales Plan →</NuxtLink></div>
      </section>

      <div class="ss-foot">
        Each month is the Breakeven page's gap at the P&L line (fixed labor, kitchen crew and fixed opex, with labor at an average payroll month),
        using the Capacity forecast for covers and the saved budget for costs, events and retail. "Needs events" means the lift every night would need
        is more than {{ pct(data.realisticLiftPct) }} (a judgment call, not a measurement) or more than the seats allow.
        Cash short adds scheduled loan principal. Event counts use the typical size of dated event nights.
        Months with no labor budget saved yet, or without recent covers, read as "not enough data".
        Click a month for the full Breakeven detail.
      </div>
    </template>
  </div>
</template>

<style scoped>
.ss-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px;
  margin: 0 0 18px;
}
.ss-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.ss-summary { display: flex; flex-wrap: wrap; gap: 8px; }
.ss-basis { font-size: 12px; color: var(--ink-2); }
.ss-scroll { overflow-x: auto; }
.ss-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ss-table thead td { font-size: 11px; color: var(--ink-3); padding: 4px 8px; vertical-align: bottom; }
.ss-table tbody td { padding: 7px 8px; border-top: 1px solid var(--hair); vertical-align: middle; }
.ss-table .num { text-align: right; white-space: nowrap; }
.ss-sub { display: block; font-size: 10.5px; color: var(--ink-3); font-weight: 400; margin-top: 1px; }
.ss-foot { font-size: 11px; color: var(--ink-3); margin-bottom: 24px; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
@media (max-width: 640px) {
  .ss-table { font-size: 12px; }
  .ss-table thead td, .ss-table tbody td { padding-left: 4px; padding-right: 4px; }
}
</style>
