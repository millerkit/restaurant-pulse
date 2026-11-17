<script setup lang="ts">
// Server productivity (Toast's Employee productivity figures; sortable, default sales per hour) on top, then FOH
// hours for a Mon–Sun week from Toast time entries: hours per person per day, grouped Floor / Bar / Concierge
// (managers are left out).
// For the GM and the Floor Manager; both see the sales dollars (Kit's call, 2026-11-17).
// "Download report" gives a standalone HTML file to send. Data: server/utils/foh-hours-report.ts.
// Same layout as the BOH report on Kitchen Hours (app/components/BohHoursReport.vue).
import site from '~/config/site.json'
import type { FohHoursReport, FohProductivityRow } from '../../server/utils/foh-hours-report'

useHead({ title: `${site.restaurantName} — FOH Hours` })

const week = ref<string | null>(null)
const query = computed(() => (week.value ? { week: week.value } : {}))
const { data, pending, error, refresh } = await useFetch<FohHoursReport>('/api/foh-hours', { query, lazy: true })

const fmtH = (n: number) => (n === 0 ? '–' : n.toFixed(1))
const fmtMoney = (n: number | null) => (n === null ? '–' : `$${Math.round(n).toLocaleString('en-US')}`)
const fmtTurn = (m: number | null) => (m === null || m <= 0 ? '–' : m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m` : `${Math.round(m)}m`)
const fmtPct = (n: number | null) => (n === null ? '–' : `${n.toFixed(1)}%`)
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// Sortable productivity columns: click a header; first click sorts high to low (A to Z for names).
type SortKey = 'name' | 'hours' | 'guests' | 'orders' | 'netSales' | 'perGuest' | 'avgOrder' | 'perHour' | 'turnMinutes' | 'tipPct' | 'voids'
const prodCols: { key: SortKey, label: string }[] = [
  { key: 'name', label: 'Employee' }, { key: 'hours', label: 'Hours' }, { key: 'guests', label: 'Guests' }, { key: 'orders', label: 'Orders' },
  { key: 'netSales', label: 'Net sales' }, { key: 'perGuest', label: 'Per guest' }, { key: 'avgOrder', label: 'Avg order' },
  { key: 'perHour', label: 'Sales / hr' }, { key: 'turnMinutes', label: 'Avg turn' }, { key: 'tipPct', label: 'Non-cash tips' }, { key: 'voids', label: 'Voids' }
]
const sortKey = ref<SortKey>('perHour')
const sortDir = ref<'asc' | 'desc'>('desc')
function setSort(k: SortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else { sortKey.value = k; sortDir.value = k === 'name' ? 'asc' : 'desc' }
}
// The shared bar login is pinned last and empty values sort last, whichever way it is sorted.
function sortRows(rows: FohProductivityRow[]) {
  const dir = sortDir.value === 'asc' ? 1 : -1
  const k = sortKey.value
  return [...rows].sort((a, b) => {
    if (a.isStation !== b.isStation) return Number(a.isStation) - Number(b.isStation)
    const av = a[k], bv = b[k]
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1
    if (bv === null || bv === undefined) return -1
    return (typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv)) * dir
  })
}
const mainRows = computed(() => sortRows(data.value?.productivity.rows ?? []))
const counterRows = computed(() => sortRows(data.value?.productivity.counterRows ?? []))
function cell(r: FohProductivityRow, k: SortKey): string {
  switch (k) {
    case 'hours': return r.hours !== null ? r.hours.toFixed(1) : '–'
    case 'guests': return String(r.guests)
    case 'orders': return String(r.orders)
    case 'netSales': return fmtMoney(r.netSales)
    case 'perGuest': return fmtMoney(r.perGuest)
    case 'avgOrder': return fmtMoney(r.avgOrder)
    case 'perHour': return fmtMoney(r.perHour)
    case 'turnMinutes': return fmtTurn(r.turnMinutes)
    case 'tipPct': return fmtPct(r.tipPct)
    case 'voids': return r.voids ? String(r.voids) : '–'
    default: return r.name
  }
}
const ariaSort = (k: SortKey) => (sortKey.value === k ? (sortDir.value === 'asc' ? 'ascending' : 'descending') : 'none')

const groupsWithPeople = computed(() => (data.value?.groups ?? [])
  .map(g => ({ ...g, people: data.value!.people.filter(p => p.group === g.key) }))
  .filter(g => g.people.length > 0))
const overCount = computed(() => data.value?.people.filter(p => p.status === 'over').length ?? 0)
const closeCount = computed(() => data.value?.people.filter(p => p.status === 'close').length ?? 0)

const vsPrior = computed(() => {
  const d = data.value
  if (!d || d.weekComplete || d.comparison.priorSamePoint === null || !d.asOf) return null
  const diff = Math.round((d.totals.all - d.comparison.priorSamePoint) * 10) / 10
  return { diff, prior: d.comparison.priorSamePoint }
})
const downloadHref = computed(() => `/api/foh-hours/report${data.value ? `?week=${data.value.weekStart}` : ''}`)
</script>

<template>
  <div>
    <PageHeader
      page-name="FOH Hours"
      description="Front-of-house hours worked per person, by week"
      :as-of-label="data?.asOf ? fmtDate(data.asOf) : undefined"
      @synced="refresh()"
    />

    <div v-if="pending && !data" class="state-note">Loading hours…</div>
    <div v-else-if="error" class="note-card">
      <span class="chip critical">Couldn't load FOH hours</span>
      <span class="quiet">{{ error.message }}</span>
    </div>
    <div v-else-if="data && !data.hasData" class="note-card">
      <span class="chip warning">No hours synced yet</span>
      <span class="quiet">Run the Toast hours backfill (see CLAUDE.md, BOH hours report).</span>
    </div>

    <section v-else-if="data" class="foh">
      <div class="bar">
        <div class="week-nav" role="group" aria-label="Choose week">
          <button type="button" :disabled="!data.prevWeek" aria-label="Previous week" @click="week = data.prevWeek">‹</button>
          <span class="week-label">{{ fmtDate(data.weekStart) }} – {{ fmtDate(data.weekEnd) }}</span>
          <button type="button" :disabled="!data.nextWeek" aria-label="Next week" @click="week = data.nextWeek">›</button>
        </div>
        <span class="quiet">
          {{ data.asOf ? (data.weekComplete ? 'Final' : `Through ${fmtDate(data.asOf)}`) : 'No hours yet this week' }}
        </span>
        <a class="download" :href="downloadHref" download>Download report (HTML)</a>
      </div>

      <div class="section-head">
        <div class="section-label">Server productivity</div>
        <div class="section-note">Toast's Employee productivity figures for the week. Click a column to sort.</div>
      </div>
      <div v-if="!data.productivity.available" class="note-card">
        <span class="chip warning">Not synced for this week</span>
        <span class="quiet">Sales per server fill in nightly; earlier weeks need the history backfill (see CLAUDE.md, FOH Hours).</span>
      </div>
      <template v-else>
        <div class="table-card">
          <table class="hours-table prod-table">
            <caption>Server productivity for the week</caption>
            <thead>
              <tr>
                <th v-for="c in prodCols" :key="c.key" scope="col" :aria-sort="ariaSort(c.key)">
                  <button type="button" class="sort-btn" :class="{ active: sortKey === c.key }" @click="setSort(c.key)">
                    {{ c.label }}<span class="arrow" aria-hidden="true">{{ sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!mainRows.length"><td :colspan="prodCols.length" class="muted">No server or bartender sales on normal-service nights this week.</td></tr>
              <tr v-for="r in mainRows" :key="r.guid">
                <th scope="row">
                  {{ r.name }}
                  <span v-if="r.isStation" class="job">Shared login</span>
                </th>
                <td v-for="c in prodCols.slice(1)" :key="c.key" :class="{ total: c.key === 'perHour' }">{{ cell(r, c.key) }}</td>
              </tr>
            </tbody>
            <tfoot v-if="data.productivity.total">
              <tr>
                <th scope="row">{{ data.productivity.total.name }}</th>
                <td v-for="c in prodCols.slice(1)" :key="c.key" :class="{ total: c.key === 'perHour' }">{{ cell(data.productivity.total, c.key) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div v-if="counterRows.length" class="counter-block">
          <div class="chart-title">Chef's Counter</div>
          <div class="table-card">
            <table class="hours-table prod-table">
              <caption>Chef's Counter sales by server</caption>
              <thead>
                <tr>
                  <th v-for="c in prodCols" :key="c.key" scope="col" :aria-sort="ariaSort(c.key)">
                    <button type="button" class="sort-btn" :class="{ active: sortKey === c.key }" @click="setSort(c.key)">
                      {{ c.label }}<span class="arrow" aria-hidden="true">{{ sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in counterRows" :key="r.guid">
                  <th scope="row">{{ r.name }}</th>
                  <td v-for="c in prodCols.slice(1)" :key="c.key" :class="{ total: c.key === 'perHour' }">{{ cell(r, c.key) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p class="foot">
          Servers and bartenders only (Server, Bartender, Lead Bartender) with at least {{ data.thresholds.minServerOrders }} orders in the week; the team total covers the rows shown. Net sales are after discounts, before tax and tip, for the orders the person rang,
          <strong>leaving out Chef's Counter orders</strong>, which are listed apart: the prix fixe includes the gratuity (so tips are left blank there) and one counter night would swamp everyone's
          sales. Hours are clocked on those jobs (Chef's Counter hours come from the Chef's Counter job, so they show once clock-ins use it).
          Per guest = net sales ÷ guests; Sales / hr = net sales ÷ those hours. Avg turn is order opened to paid, leaving out any order open over 8 hours.
          Non-cash tips are card tips as a percent of net sales plus tax. Voids are voided items. Bartenders mostly ring under the shared bar login, so the bar's sales are its own row, not theirs.
        </p>
      </template>

      <div class="section-head hours-head">
        <div class="section-label">FOH hours worked</div>
        <div class="section-note">
          Hours clocked in Toast, Monday–Sunday. Runs through the last synced day, so it has no payroll lag.
        </div>
      </div>

      <div class="cards">
        <div class="card">
          <div class="l">FOH hours</div>
          <div class="v">{{ data.totals.all.toFixed(1) }}</div>
          <div class="s">{{ data.people.length }} {{ data.people.length === 1 ? 'person' : 'people' }} clocked in</div>
        </div>
        <div class="card">
          <div class="l">Near {{ data.thresholds.overtime }} hours</div>
          <div class="v">{{ overCount + closeCount }}</div>
          <div class="s">{{ overCount }} in overtime · {{ closeCount }} at {{ data.thresholds.close }}+</div>
        </div>
        <div v-if="data.autoClockOuts.shifts" class="card">
          <div class="l">Auto clock-outs</div>
          <div class="v">{{ data.autoClockOuts.shifts }}</div>
          <div class="s">{{ data.autoClockOuts.people }} {{ data.autoClockOuts.people === 1 ? 'person' : 'people' }} · check in Toast</div>
        </div>
        <div class="card">
          <div class="l">Guests per FOH hour</div>
          <div class="v">{{ data.guestsPerHour.current !== null ? data.guestsPerHour.current.toFixed(1) : '–' }}</div>
          <div class="s">
            <template v-if="data.guestsPerHour.lastWeek !== null">Last week: {{ data.guestsPerHour.lastWeek.toFixed(1) }}</template>
            <template v-if="data.guestsPerHour.trailingAvg !== null"><template v-if="data.guestsPerHour.lastWeek !== null"> · </template>4-wk avg: {{ data.guestsPerHour.trailingAvg.toFixed(1) }}</template>
            <template v-if="data.guestsPerHour.lastWeek === null && data.guestsPerHour.trailingAvg === null">Open nights only</template>
          </div>
        </div>
        <div class="card">
          <div class="l">Compared</div>
          <div v-if="vsPrior" class="s">
            {{ vsPrior.diff === 0 ? 'Same as' : `${vsPrior.diff > 0 ? '▲' : '▼'} ${Math.abs(vsPrior.diff).toFixed(1)} ${vsPrior.diff > 0 ? 'more' : 'fewer'} than` }}
            the same days last week ({{ vsPrior.prior.toFixed(1) }})
          </div>
          <div v-if="data.comparison.priorFullWeek !== null" class="s">Last week's full total: {{ data.comparison.priorFullWeek.toFixed(1) }}</div>
          <div v-if="data.comparison.trailingAvgFullWeek !== null" class="s">{{ data.comparison.trailingWeeks }}-week average: {{ data.comparison.trailingAvgFullWeek.toFixed(1) }}</div>
          <div v-if="!vsPrior && data.comparison.priorFullWeek === null && data.comparison.trailingAvgFullWeek === null" class="s">Not enough history yet</div>
        </div>
      </div>

      <div class="table-card">
        <table class="hours-table">
          <caption>FOH hours worked per employee, by day</caption>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Total</th>
              <th v-for="d in data.days" :key="d.date" scope="col" :class="{ closed: d.isClosedDay }">
                {{ d.label }}
                <span v-if="d.tag" class="daytag" :class="{ special: d.status === 'buyout' || d.status === 'event' || d.status === 'offsite' }">{{ d.tag }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!data.people.length">
              <td :colspan="data.days.length + 2" class="muted">No front-of-house hours recorded yet.</td>
            </tr>
            <template v-for="g in groupsWithPeople" :key="g.key">
              <tr class="section-row"><th :colspan="data.days.length + 2" scope="colgroup">{{ g.label }}</th></tr>
              <tr v-for="p in g.people" :key="p.guid">
                <th scope="row">
                  {{ p.name }}
                  <span class="job">{{ p.jobs.join(', ') }}</span>
                  <span v-if="p.status === 'over'" class="chip critical">▲ In overtime</span>
                  <span v-else-if="p.status === 'close'" class="chip warning">◆ Near 40</span>
                  <span v-if="p.autoShifts" class="chip warning" :title="`${p.autoHours.toFixed(1)} hrs came from auto clock-outs`">⚠ Auto clock-out<template v-if="p.autoShifts > 1"> ×{{ p.autoShifts }}</template></span>
                </th>
                <td class="total">{{ p.total.toFixed(1) }}</td>
                <td v-for="d in data.days" :key="d.date" :class="{ closed: d.isClosedDay }">{{ fmtH(p.byDay[d.date] ?? 0) }}<span v-if="p.autoDays.includes(d.date)" class="aw" title="Auto clock-out">⚠</span></td>
              </tr>
            </template>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All FOH</th>
              <td class="total">{{ data.totals.all.toFixed(1) }}</td>
              <td v-for="d in data.days" :key="d.date" :class="{ closed: d.isClosedDay }">{{ fmtH(data.totals.byDay[d.date] ?? 0) }}</td>
            </tr>
            <tr class="guests-row">
              <th scope="row">Guests</th>
              <td class="total">{{ data.totals.covers || '–' }}</td>
              <td v-for="d in data.days" :key="d.date" :class="{ closed: d.isClosedDay }">{{ data.totals.coversByDay[d.date] ?? '–' }}</td>
            </tr>
            <tr class="guests-row">
              <th scope="row">Guests per FOH hour</th>
              <td class="total">{{ data.guestsPerHour.current !== null ? data.guestsPerHour.current.toFixed(1) : '–' }}</td>
              <td v-for="d in data.days" :key="d.date" :class="{ closed: d.isClosedDay }">{{ data.totals.guestsPerHourByDay[d.date]?.toFixed(1) ?? '–' }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="foot">
        Counts hours worked as {{ data.includedJobs.join(', ') }}. Each person is grouped by the job they worked most that week. Managers (General Manager, Floor Manager, Wine Director) are not included.
        "Near 40" = {{ data.thresholds.close }}+ hours or overtime logged in Toast.
        Closed days (Mondays, holidays), buyout, event and off-site nights, and nights with under {{ data.thresholds.minOrders }} orders (a low-volume day or an anomaly)
        are marked under the date. Their hours are listed, but they are left out of Guests, guests per FOH hour and the productivity table, so those compare normal nights only.
        ⚠ marks a shift Toast clocked out automatically because nobody did: it usually runs long and is worth correcting in Toast. An unfinished shift can look off too.
        <template v-if="data.excludedLogins.length">
          Shared logins left out of the table: {{ data.excludedLogins.map(x => `${x.name} (${x.hours.toFixed(1)} hrs)`).join(', ') }}.
        </template>
        <template v-if="data.notCounted.length">
          Not counted as FOH or BOH: {{ data.notCounted.map(x => `${x.title} (${x.hours.toFixed(1)} hrs)`).join(', ') }}.
        </template>
      </p>
    </section>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }
.quiet { color: var(--ink-2); font-size: 13px; }
.note-card { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; background: var(--surface); border: 1px solid var(--hair); border-radius: 14px; padding: 12px 16px; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 12px; }
.week-nav { display: inline-flex; align-items: center; border: 1px solid var(--hair); border-radius: 8px; overflow: hidden; background: var(--surface-alt); }
.week-nav button { font: inherit; font-size: 16px; padding: 4px 12px; border: none; background: none; color: var(--ink-2); cursor: pointer; }
.week-nav button:disabled { opacity: 0.3; cursor: default; }
.week-label { font-size: 13px; font-weight: 700; color: var(--ink); padding: 0 10px; }
.download { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--accent); text-decoration: none; }
.download:hover { text-decoration: underline; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 14px; }
.card { background: var(--surface); border: 1px solid var(--hair); border-radius: 18px; box-shadow: var(--card-shadow); padding: 14px 18px; }
.card .l { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); text-transform: uppercase; }
.card .v { font-size: 30px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; margin: 2px 0; }
.card .s { font-size: 12px; color: var(--ink-2); margin-top: 2px; }
.table-card { background: var(--surface); border: 1px solid var(--hair); border-radius: 18px; box-shadow: var(--card-shadow); padding: 4px; overflow-x: auto; }
.hours-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 680px; }
.hours-table caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.hours-table th, .hours-table td { padding: 10px 12px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.hours-table th:first-child { text-align: left; }
.hours-table thead th { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); border-bottom: 1px solid var(--hair); }
.hours-table tbody tr { border-bottom: 1px solid var(--hair); }
.hours-table tbody th { font-weight: 600; color: var(--ink); }
.hours-table .chip { margin-top: 3px; }
.hours-table th .chip { display: block; width: fit-content; }
.hours-table .aw { color: var(--ink-2); margin-left: 3px; font-size: 11px; }
.hours-table .job { display: block; font-size: 11px; font-weight: 400; color: var(--ink-3); }
.hours-table .closed { color: var(--ink-3); }
.hours-table .total { font-weight: 700; color: var(--ink); }
.hours-table .muted { color: var(--ink-3); text-align: left; }
.hours-table .section-row th { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: var(--ink-3); text-align: left; background: var(--surface-alt); }
.hours-table tfoot th, .hours-table tfoot td { font-weight: 700; color: var(--ink); border-top: 1px solid var(--hair); }
.hours-table tfoot .guests-row th, .hours-table tfoot .guests-row td { font-weight: 500; color: var(--ink-2); border-top: none; }
.daytag { display: block; margin-top: 2px; font-size: 10px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--ink-3); }
.daytag.special { color: var(--accent); }
.hours-head { margin-top: 28px; }
.counter-block { margin-top: 16px; }
.chart-title { font-size: 12px; font-weight: 700; color: var(--ink-2); margin: 0 0 6px; }
.sort-btn { font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit; background: none; border: none; padding: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.sort-btn:hover, .sort-btn.active { color: var(--ink); }
.sort-btn .arrow { font-size: 9px; min-width: 9px; }
.hours-table.prod-table { min-width: 860px; }
.foot { margin: 10px 2px 0; color: var(--ink-2); font-size: 12px; line-height: 1.5; }
</style>
