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
  nights: number, laborBudgeted: boolean,
  bookedEvents: number, bookedBuyouts: number, bookedEventRevenue: number,
  focus: { weekday: string, area: string, nights: number, spareCoversPerNight: number, monthlyProfit: number }[],
  buyoutNights: { weekday: string, normalNightSales: number }[],
  actBy: { promote: string | null, events: string | null, eventsBasis: 'large-parties' | 'all-bookings' | null }
}
type LeadStat = { n: number, medianDays: number | null, p80Days: number | null }
type LeadTimes =
  | { available: false, reason: string }
  | {
    available: true, uploadDate: string, from: string, to: string, all: LeadStat, small: LeadStat, large: LeadStat,
    largePartyMinSize: number, sources: { source: string, n: number, share: number, avgSize: number, medianLeadDays: number | null }[]
  }
type Strategy = {
  year: number, today: { year: number, month: number }, firstMonth: number, realisticLiftPct: number,
  avgEventSize: number | null, asOfDate: string | null, todayIso: string, realisticFillPct: number,
  leadTimes: LeadTimes, months: StrategyMonth[]
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
// Dates read "Dec 8"; one already behind us means the window to reach that month has opened.
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const actByView = (iso: string | null) => iso == null ? null : iso < (data.value?.todayIso ?? '') ? { cls: 'serious', text: `⚠ Start now (was ${fmtDate(iso)})` } : { cls: '', text: `by ${fmtDate(iso)}` }
const actionMonths = computed(() => (data.value?.months ?? []).filter(m => m.kind !== 'covered'))
const dayWord = (n: number | null) => n == null ? '—' : `${n} day${n === 1 ? '' : 's'}`
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

      <section class="ss-card">
        <div class="ss-title">Action plan — months that aren't covered</div>
        <div v-if="actionMonths.length === 0" class="ss-basis">Every open month is covered at expected covers and planned events.</div>
        <div v-else class="ss-scroll">
          <table class="ss-table">
            <thead>
              <tr>
                <td>month</td>
                <td class="num">events<span class="ss-sub">booked → still needed</span></td>
                <td>promote dining by<span class="ss-sub">to reach the month's bookers</span></td>
                <td>event outreach by<span class="ss-sub">see note below</span></td>
                <td>where the room is<span class="ss-sub">weekday · area · spare covers/night</span></td>
                <td>best nights for a buyout<span class="ss-sub">quietest normal nights</span></td>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in actionMonths" :key="m.month">
                <td><strong>{{ MONTH_NAMES[m.month - 1] }}</strong></td>
                <td class="num">
                  {{ m.bookedEvents }} <template v-if="m.bookedBuyouts">+ {{ m.bookedBuyouts }} buyout{{ m.bookedBuyouts === 1 ? '' : 's' }}</template>
                  → <strong>{{ m.eventsNeeded != null ? m.eventsNeeded : '—' }}</strong>
                </td>
                <td><span v-if="actByView(m.actBy.promote)" :class="['chip', actByView(m.actBy.promote)!.cls]">{{ actByView(m.actBy.promote)!.text }}</span><span v-else>—</span></td>
                <td>
                  <span v-if="actByView(m.actBy.events)" :class="['chip', actByView(m.actBy.events)!.cls]">{{ actByView(m.actBy.events)!.text }}{{ m.actBy.eventsBasis === 'all-bookings' && (m.actBy.events ?? '') >= data.todayIso ? ' or earlier' : '' }}</span><span v-else>—</span>
                  <span v-if="m.actBy.eventsBasis === 'all-bookings'" class="ss-sub">at least; events book earlier</span>
                </td>
                <td>
                  <div v-for="f in m.focus" :key="f.weekday + f.area" class="ss-focus">
                    <strong>{{ f.weekday }}</strong> · {{ f.area }} · {{ fmtCovers(f.spareCoversPerNight) }}
                    <span class="ss-sub inline">about {{ fmtMoney(f.monthlyProfit) }} a month if filled</span>
                  </div>
                  <span v-if="m.focus.length === 0">—</span>
                </td>
                <td>
                  <span v-for="(b, i) in m.buyoutNights" :key="b.weekday">{{ b.weekday }}{{ i < m.buyoutNights.length - 1 ? ', ' : '' }}</span>
                  <span v-if="m.buyoutNights.length === 0">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="ss-basis">
          "Where the room is" is seats the forecast leaves empty, up to {{ pct(data.realisticFillPct) }} of a night's seats, by weekday (using each area's real weekday pattern since the move),
          valued at profit per cover after food & drink cost, variable expenses and front-of-house hours. It is a ceiling for marketing to aim at, not a prediction of what a campaign delivers.
        </div>
      </section>

      <section class="ss-card">
        <div class="ss-title">How far ahead guests book</div>
        <template v-if="data.leadTimes.available">
          <div class="ss-summary">
            <span class="chip">Half book within {{ dayWord(data.leadTimes.all.medianDays) }}</span>
            <span class="chip">8 in 10 within {{ dayWord(data.leadTimes.all.p80Days) }}</span>
            <span v-if="data.leadTimes.large.p80Days != null" class="chip">Parties of {{ data.leadTimes.largePartyMinSize }}+: 8 in 10 within {{ dayWord(data.leadTimes.large.p80Days) }}</span>
            <span v-else class="chip quiet">Parties of {{ data.leadTimes.largePartyMinSize }}+: only {{ data.leadTimes.large.n }} so far, not enough to say</span>
          </div>
          <table class="ss-table">
            <thead><tr><td>how they book</td><td class="num">share</td><td class="num">average party</td><td class="num">typical lead</td></tr></thead>
            <tbody>
              <tr v-for="src in data.leadTimes.sources" :key="src.source">
                <td><strong>{{ src.source }}</strong></td>
                <td class="num">{{ pct(src.share) }}</td>
                <td class="num">{{ src.avgSize.toFixed(1) }}</td>
                <td class="num">{{ dayWord(src.medianLeadDays) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="ss-basis">
            From {{ data.leadTimes.all.n.toLocaleString() }} OpenTable reservations for visits {{ fmtDate(data.leadTimes.from) }} to {{ fmtDate(data.leadTimes.to) }} (walk-ins and cancellations left out; upload of {{ fmtDate(data.leadTimes.uploadDate) }}).
            "Promote dining by" is the month's first night minus the days within which 8 in 10 bookings are made. Nothing records how far ahead an event or buyout is booked,
            so event outreach uses parties of {{ data.leadTimes.largePartyMinSize }}+ when there are enough, otherwise all bookings as a floor.
          </div>
        </template>
        <div v-else class="ss-basis">{{ data.leadTimes.reason }}</div>
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
.ss-focus { white-space: nowrap; }
.ss-sub.inline { display: inline; margin-left: 4px; }
.ss-foot { font-size: 11px; color: var(--ink-3); margin-bottom: 24px; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
@media (max-width: 640px) {
  .ss-table { font-size: 12px; }
  .ss-table thead td, .ss-table tbody td { padding-left: 4px; padding-right: 4px; }
}
</style>
