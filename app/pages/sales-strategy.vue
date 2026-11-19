<script setup lang="ts">
// Planning › Sales Strategy (owner-only by default deny). Step 1: the Breakeven gap for every open month,
// sorted by what kind of help closes it. Fed by /api/sales-strategy (server/utils/sales-strategy.ts);
// each month links to Breakeven for the full detail.
import site from '~/config/site.json'
import { MONTH_NAMES, useBudgetYearSelection } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Sales Strategy` })

type Kind = 'covered' | 'dine-in' | 'event' | 'buyouts' | 'gap' | 'no-data'
type StrategyMonth = {
  month: number, kind: Kind, costs: number,
  stillShort: number | null, cashStillShort: number | null,
  expectedCoversPerNight: number | null, coversSource: 'recent' | 'forecast',
  maxCoversPerNight: number | null, headroomPct: number | null, liftPct: number | null,
  coversNeededPerNight: number | null,
  eventSalesNeeded: number, plannedEventsRevenue: number,
  plan: {
    event: { sales: number, profit: number } | null,
    covers: { liftPct: number, profit: number } | null,
    buyouts: { count: number, nights: { weekday: string, extraSales: number }[], profit: number } | null,
    stillToFind: number, stillToFindSales: number | null, eventSlotUsed: boolean, buyoutSlotsLeft: number
  },
  nights: number, laborBudgeted: boolean,
  bookedEvents: number, bookedSpecialEvents: number, bookedBuyouts: number, bookedEventRevenue: number,
  focus: { weekday: string, area: string, nights: number, spareCoversPerNight: number, monthlyProfit: number }[],
  buyoutNights: { weekday: string, normalNightSales: number }[],
  actBy: { promote: string | null, events: string | null, eventsBasis: 'booked-events' | 'large-parties' | 'all-bookings' | null }
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
  avgEventSize: number | null, typicalEventCount: number, maxEventsPerMonth: number, maxBuyoutsPerMonth: number,
  buyoutRates: { weekday: number, weekend: number }, asOfDate: string | null, todayIso: string, realisticFillPct: number,
  leadTimes: LeadTimes, eventLeadTimes: LeadStat & { withoutDate: number }, months: StrategyMonth[]
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
  'event': { cls: 'warning', text: '▲ Event + covers', help: 'One special event plus a realistic lift in covers closes it.' },
  'buyouts': { cls: 'warning', text: '▲ Needs buyouts', help: 'Even with one event and a realistic lift in covers, it also takes buyouts (within the monthly limit).' },
  'gap': { cls: 'serious', text: '⚠ Still short', help: 'One event, a realistic lift in covers and the buyout limit together don\'t close it: catering, retail or a bigger lift has to.' },
  'no-data': { cls: 'quiet', text: '— Not enough data', help: 'Needs recent Toast covers with matching revenue, cost targets, and a labor budget.' }
}

const counts = computed(() => {
  const c: Record<Kind, number> = { 'covered': 0, 'dine-in': 0, 'event': 0, 'buyouts': 0, 'gap': 0, 'no-data': 0 }
  for (const m of data.value?.months ?? []) c[m.kind]++
  return c
})
// Dates read "Dec 8"; one already behind us means the window to reach that month has opened.
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const actByView = (iso: string | null) => iso == null ? null : iso < (data.value?.todayIso ?? '') ? { cls: 'serious', text: `⚠ Start now (was ${fmtDate(iso)})` } : { cls: '', text: `by ${fmtDate(iso)}` }
const actionMonths = computed(() => (data.value?.months ?? []).filter(m => m.kind !== 'covered'))
const dayWord = (n: number | null) => n == null ? '—' : `${n} day${n === 1 ? '' : 's'}`
// ---- Campaigns (step 3) ----
type Lift = { perNight: number, pct: number } | null
type CampaignResult = {
  status: 'upcoming' | 'running' | 'done', nights: number, beforeNights: number,
  avgActual: number | null, avgBefore: number | null, avgPlan: number | null, vsBefore: Lift, vsPlan: Lift,
  addedCovers: number | null, profitPerCover: number | null, addedProfit: number | null, net: number | null,
  read: 'ahead' | 'flat' | 'behind' | 'mixed' | 'too-early'
}
type Campaign = {
  id: number, name: string, channel: string, startDate: string, endDate: string,
  targetDows: number[] | null, targetArea: string | null, cost: number, note: string | null, results: CampaignResult
}
type Campaigns = { campaigns: Campaign[], areas: string[], channels: string[], todayIso: string, minNights: number, flatBand: number }
const { data: camp, refresh: refreshCampaigns } = await useFetch<Campaigns>('/api/campaigns', { lazy: true })

const DOW_CHOICES = [{ dow: 2, label: 'Tue' }, { dow: 3, label: 'Wed' }, { dow: 4, label: 'Thu' }, { dow: 5, label: 'Fri' }, { dow: 6, label: 'Sat' }, { dow: 0, label: 'Sun' }]
const blankCampaign = () => ({ name: '', channel: 'email', startDate: '', endDate: '', dows: [] as number[], area: '', cost: '', note: '' })
const newCampaign = ref(blankCampaign())
const campaignStatus = ref<'idle' | 'saving' | 'error'>('idle')
const campaignMessage = ref('')
async function addCampaign() {
  const c = newCampaign.value
  campaignStatus.value = 'saving'
  try {
    await $fetch('/api/campaigns', {
      method: 'POST',
      body: { name: c.name, channel: c.channel, startDate: c.startDate, endDate: c.endDate, targetDows: c.dows.length ? c.dows : null, targetArea: c.area || null, cost: Math.max(0, Number(String(c.cost).replace(/[$,\s]/g, '')) || 0), note: c.note }
    })
    newCampaign.value = blankCampaign()
    campaignStatus.value = 'idle'
    campaignMessage.value = ''
    await refreshCampaigns()
  } catch (err: unknown) {
    campaignStatus.value = 'error'
    campaignMessage.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Could not save that campaign.'
  }
}
async function removeCampaign(c: Campaign) {
  if (!window.confirm(`Remove "${c.name}"?`)) return
  await $fetch('/api/campaigns', { method: 'DELETE', query: { id: c.id } })
  await refreshCampaigns()
}
const READ: Record<CampaignResult['read'], { cls: string, text: string }> = {
  'ahead': { cls: 'good', text: '✓ Ahead' },
  'flat': { cls: 'warning', text: '▲ Flat' },
  'mixed': { cls: 'warning', text: '▲ Mixed' },
  'behind': { cls: 'serious', text: '⚠ Behind' },
  'too-early': { cls: 'quiet', text: '— Too early' }
}
const liftText = (l: Lift) => l == null ? '—' : `${l.pct >= 0 ? '+' : '−'}${Math.round(Math.abs(l.pct) * 100)}%`
const targetText = (c: Campaign) => {
  const days = c.targetDows ? DOW_CHOICES.filter(d => c.targetDows!.includes(d.dow)).map(d => d.label).join(', ') : 'every night'
  return `${days} · ${c.targetArea ?? 'whole restaurant'}`
}
const totals = computed(() => {
  const ms = data.value?.months ?? []
  return {
    events: ms.reduce((s, m) => s + (m.plan.event ? 1 : 0), 0),
    buyouts: ms.reduce((s, m) => s + (m.plan.buyouts?.count ?? 0), 0),
    stillToFind: ms.reduce((s, m) => s + m.plan.stillToFind, 0),
    stillToFindSales: ms.reduce((s, m) => s + (m.plan.stillToFindSales ?? 0), 0)
  }
})
const buyoutText = (b: NonNullable<StrategyMonth['plan']['buyouts']>) => `${b.count} on ${b.nights[0]?.weekday ?? ''}${b.count > 1 ? 's' : ''}`
</script>

<template>
  <div>
    <PageHeader
      page-name="Sales Strategy"
      description="Which months fall short of breakeven, and how one event a month, more covers and buyouts can close each gap."
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
          <span v-if="counts.event" class="chip warning">▲ {{ counts.event }} need an event + covers</span>
          <span v-if="counts.buyouts" class="chip warning">▲ {{ counts.buyouts }} need buyouts too</span>
          <span v-if="counts.gap" class="chip serious">⚠ {{ counts.gap }} still short</span>
          <span v-if="counts['no-data']" class="chip quiet">— {{ counts['no-data'] }} not enough data</span>
        </div>
        <div v-if="totals.events || totals.buyouts" class="ss-basis">
          The plan below adds <strong>{{ totals.events }} special event{{ totals.events === 1 ? '' : 's' }}</strong> (at most {{ data.maxEventsPerMonth }} a month<template v-if="data.avgEventSize">, your typical {{ fmtMoney(data.avgEventSize) }}</template>)
          and <strong>{{ totals.buyouts }} buyout{{ totals.buyouts === 1 ? '' : 's' }}</strong> (at most {{ data.maxBuyoutsPerMonth }} a month), beyond what's already dated.
          <template v-if="totals.stillToFind > 0"> That still leaves <strong>{{ fmtMoney(totals.stillToFind) }}</strong> of profit to find (about {{ fmtMoney(totals.stillToFindSales) }} in catering or retail sales, or a bigger lift in covers).</template>
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
                <td class="num">lift needed<span class="ss-sub">covers alone</span></td>
                <td>closes it</td>
                <td class="num">1 event<span class="ss-sub">profit</span></td>
                <td class="num">covers lift<span class="ss-sub">up to {{ pct(data.realisticLiftPct) }}</span></td>
                <td class="num">buyouts<span class="ss-sub">up to {{ data.maxBuyoutsPerMonth }}</span></td>
                <td class="num">still to find<span class="ss-sub">catering, retail…</span></td>
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
                <td class="num">
                  <template v-if="m.plan.event">{{ fmtMoney(m.plan.event.profit) }}</template>
                  <template v-else-if="m.plan.eventSlotUsed && m.kind !== 'covered'">booked<span class="ss-sub">already dated</span></template>
                  <template v-else>—</template>
                </td>
                <td class="num">{{ m.plan.covers ? pct(m.plan.covers.liftPct) : '—' }}<span v-if="m.plan.covers" class="ss-sub">{{ fmtMoney(m.plan.covers.profit) }}</span></td>
                <td class="num">
                  <template v-if="m.plan.buyouts">{{ buyoutText(m.plan.buyouts) }}<span class="ss-sub">{{ fmtMoney(m.plan.buyouts.profit) }}</span></template>
                  <template v-else-if="m.plan.buyoutSlotsLeft === 0 && m.kind !== 'covered'">{{ m.bookedBuyouts }} booked</template>
                  <template v-else>—</template>
                </td>
                <td class="num">
                  <template v-if="m.plan.stillToFind > 0">{{ fmtMoney(m.plan.stillToFind) }}<span v-if="m.plan.stillToFindSales != null" class="ss-sub">{{ fmtMoney(m.plan.stillToFindSales) }} in sales</span></template>
                  <template v-else-if="m.kind !== 'no-data'">✓</template>
                  <template v-else>—</template>
                </td>
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
                <td class="num">booked<span class="ss-sub">events · buyouts</span></td>
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
                  {{ m.bookedEvents }} · {{ m.bookedBuyouts }}
                </td>
                <td><span v-if="actByView(m.actBy.promote)" :class="['chip', actByView(m.actBy.promote)!.cls]">{{ actByView(m.actBy.promote)!.text }}</span><span v-else>—</span></td>
                <td>
                  <span v-if="actByView(m.actBy.events)" :class="['chip', actByView(m.actBy.events)!.cls]">{{ actByView(m.actBy.events)!.text }}{{ m.actBy.eventsBasis === 'all-bookings' && (m.actBy.events ?? '') >= data.todayIso ? ' or earlier' : '' }}</span><span v-else>—</span>
                  <span v-if="m.actBy.eventsBasis === 'all-bookings'" class="ss-sub">at least; events book earlier</span>
                  <span v-else-if="m.actBy.eventsBasis === 'large-parties'" class="ss-sub">from large-party bookings</span>
                  <span v-else-if="m.actBy.eventsBasis === 'booked-events'" class="ss-sub">from your booked events</span>
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
            <span v-if="data.eventLeadTimes.p80Days != null" class="chip">Events and buyouts: 8 in 10 booked {{ dayWord(data.eventLeadTimes.p80Days) }} ahead ({{ data.eventLeadTimes.n }} booked)</span>
            <span v-else class="chip quiet">Events and buyouts: {{ data.eventLeadTimes.n }} with a booked-on date, need 5 (add it on the Sales Plan)</span>
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
            "Promote dining by" is the month's first night minus the days within which 8 in 10 bookings are made. Event outreach uses the "booked on" dates entered for dated events and buyouts once there are 5;
            until then, parties of {{ data.leadTimes.largePartyMinSize }}+ when there are enough, otherwise all bookings as a floor.
          </div>
        </template>
        <div v-else class="ss-basis">{{ data.leadTimes.reason }}</div>
      </section>

      <section class="ss-card">
        <div class="ss-title">Campaigns — what each push did</div>
        <div v-if="camp && camp.campaigns.length === 0" class="ss-basis">No campaigns logged yet. Log one before it starts, and its result fills in as the nights go by.</div>
        <div v-if="camp && camp.campaigns.length" class="ss-scroll">
          <table class="ss-table">
            <thead>
              <tr>
                <td>campaign</td>
                <td class="num">nights<span class="ss-sub">measured</span></td>
                <td class="num">covers/night<span class="ss-sub">during</span></td>
                <td class="num">vs before<span class="ss-sub">same weekdays, prior 4 weeks</span></td>
                <td class="num">vs plan<span class="ss-sub">frozen month plan</span></td>
                <td class="num">extra profit<span class="ss-sub">estimate</span></td>
                <td class="num">cost</td>
                <td class="num">net</td>
                <td>read</td>
                <td><span class="visually-hidden">Remove</span></td>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in camp.campaigns" :key="c.id">
                <td>
                  <strong>{{ c.name }}</strong>
                  <span class="ss-sub">{{ c.channel }} · {{ fmtDate(c.startDate) }}–{{ fmtDate(c.endDate) }} · {{ targetText(c) }}</span>
                  <span v-if="c.note" class="ss-sub">{{ c.note }}</span>
                </td>
                <td class="num">{{ c.results.nights }}<span v-if="c.results.status !== 'done'" class="ss-sub">{{ c.results.status === 'upcoming' ? 'not started' : 'still running' }}</span></td>
                <td class="num">{{ fmtCovers(c.results.avgActual) }}</td>
                <td class="num">{{ liftText(c.results.vsBefore) }}<span v-if="c.results.avgBefore != null" class="ss-sub">was {{ fmtCovers(c.results.avgBefore) }}</span></td>
                <td class="num">{{ liftText(c.results.vsPlan) }}<span v-if="c.results.avgPlan != null" class="ss-sub">planned {{ fmtCovers(c.results.avgPlan) }}</span></td>
                <td class="num">{{ c.results.addedProfit != null ? fmtMoney(c.results.addedProfit) : '—' }}<span v-if="c.results.addedCovers != null" class="ss-sub">{{ c.results.addedCovers >= 0 ? '+' : '−' }}{{ fmtCovers(Math.abs(c.results.addedCovers)) }} covers</span></td>
                <td class="num">{{ fmtMoney(c.cost) }}</td>
                <td class="num">{{ c.results.net != null ? fmtMoney(c.results.net) : '—' }}</td>
                <td><span :class="['chip', READ[c.results.read].cls]">{{ READ[c.results.read].text }}</span></td>
                <td><button type="button" class="mini-btn" @click="removeCampaign(c)">Remove</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <form v-if="camp" class="ss-form" @submit.prevent="addCampaign">
          <input v-model="newCampaign.name" type="text" class="ss-input wide" placeholder="Campaign name" maxlength="80" aria-label="Campaign name" required />
          <select v-model="newCampaign.channel" class="ss-input" aria-label="Channel">
            <option v-for="ch in camp.channels" :key="ch" :value="ch">{{ ch }}</option>
          </select>
          <label class="ss-field">From <input v-model="newCampaign.startDate" type="date" class="ss-input" required /></label>
          <label class="ss-field">to <input v-model="newCampaign.endDate" type="date" class="ss-input" :min="newCampaign.startDate || undefined" required /></label>
          <span class="ss-field" role="group" aria-label="Target nights">
            <label v-for="d in DOW_CHOICES" :key="d.dow" class="ss-check"><input v-model="newCampaign.dows" type="checkbox" :value="d.dow" /> {{ d.label }}</label>
          </span>
          <select v-model="newCampaign.area" class="ss-input" aria-label="Target area">
            <option value="">Whole restaurant</option>
            <option v-for="a in camp.areas" :key="a" :value="a">{{ a }}</option>
          </select>
          <label class="ss-field">Cost $ <input v-model="newCampaign.cost" type="text" inputmode="numeric" class="ss-input narrow" placeholder="0" /></label>
          <input v-model="newCampaign.note" type="text" class="ss-input wide" placeholder="Note (optional)" maxlength="200" aria-label="Note" />
          <button type="submit" class="mini-btn" :disabled="campaignStatus === 'saving'">Add campaign</button>
          <span v-if="campaignStatus === 'error'" class="chip warning">{{ campaignMessage }}</span>
        </form>
        <div class="ss-basis">
          Tick the nights the push aims at (none = every service night) and pick an area if it targets one. Each result compares the targeted nights' real covers with the same weekdays in the
          four weeks before it started and, for whole-restaurant campaigns, with the month's frozen plan. "Extra profit" is the extra covers (against "before", or the plan if there's no "before")
          at profit per cover, so it ignores anything else that moved. It needs {{ camp?.minNights ?? 3 }} nights to read; ✓ and ⚠ need every comparison to clear ±{{ pct(camp?.flatBand ?? 0.05) }}.
          Seasonality, weather, holidays and events also move covers, so treat a single campaign as a hint and several as a pattern.
        </div>
      </section>

      <div class="ss-foot">
        Each month is the Breakeven page's gap at the P&L line (fixed labor, kitchen crew and fixed opex, with labor at an average payroll month),
        using the Capacity forecast for covers and the saved budget for costs, events and retail. Each gap is closed in order: one special event
        (on-site or off-site, at most {{ data.maxEventsPerMonth }} a month, skipped if one is already dated; catering doesn't count toward it), then more covers up to {{ pct(data.realisticLiftPct) }}
        every night (a judgment call, not a measurement) and within the seats, then up to {{ data.maxBuyoutsPerMonth }} buyouts on the night where one adds most
        (your {{ fmtMoney(data.buyoutRates.weekday) }} weekday / {{ fmtMoney(data.buyoutRates.weekend) }} weekend rate minus that night's forecast sales). Whatever is left is "still to find".
        The event is the typical size of {{ data.typicalEventCount }} dated on-site and off-site events; profit is sales at the dine-in contribution rate.
        Cash short adds scheduled loan principal.
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
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ss-focus { white-space: nowrap; }
.ss-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ss-input { font: inherit; font-size: 12.5px; padding: 4px 8px; border: 1px solid var(--hair); border-radius: 8px; background: var(--surface); color: var(--ink); }
.ss-input.wide { width: 200px; }
.ss-input.narrow { width: 80px; }
.ss-field { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--ink-2); flex-wrap: wrap; }
.ss-check { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; }
.mini-btn { font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--hair); border-radius: 8px; background: var(--surface-alt); color: var(--ink); cursor: pointer; }
.mini-btn:disabled { opacity: 0.5; cursor: default; }
.ss-sub.inline { display: inline; margin-left: 4px; }
.ss-foot { font-size: 11px; color: var(--ink-3); margin-bottom: 24px; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
@media (max-width: 640px) {
  .ss-table { font-size: 12px; }
  .ss-table thead td, .ss-table tbody td { padding-left: 4px; padding-right: 4px; }
}
</style>
