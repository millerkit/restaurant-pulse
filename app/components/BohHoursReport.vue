<script setup lang="ts">
// BOH hours for a Mon–Sun week, from Toast time entries. Built for the Sous
// Chef to manage hours; "Download report" gives a standalone HTML file to send.
// Data: server/utils/boh-hours-report.ts.
import type { BohHoursReport } from '../../server/utils/boh-hours-report'

const week = ref<string | null>(null)
const query = computed(() => (week.value ? { week: week.value } : {}))
const { data, pending, error } = await useFetch<BohHoursReport>('/api/kitchen-labor/hours', { query })

const fmtH = (n: number) => (n === 0 ? '–' : n.toFixed(1))
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const kitchen = computed(() => data.value?.people.filter(p => !p.isPorter) ?? [])
const porters = computed(() => data.value?.people.filter(p => p.isPorter) ?? [])
const overCount = computed(() => data.value?.people.filter(p => p.status === 'over').length ?? 0)
const closeCount = computed(() => data.value?.people.filter(p => p.status === 'close').length ?? 0)

const vsPrior = computed(() => {
  const d = data.value
  if (!d || d.weekComplete || d.comparison.priorSamePoint === null || !d.asOf) return null
  const diff = Math.round((d.totals.all - d.comparison.priorSamePoint) * 10) / 10
  return { diff, prior: d.comparison.priorSamePoint }
})
const downloadHref = computed(() => `/api/kitchen-labor/hours-report${data.value ? `?week=${data.value.weekStart}` : ''}`)
</script>

<template>
  <section class="boh">
    <div class="section-head">
      <div class="section-label">BOH hours worked</div>
      <div class="section-note">
        Hours clocked in Toast, Monday–Sunday. Runs through the last synced day, so it has no payroll lag.
      </div>
    </div>

    <div v-if="pending && !data" class="quiet">Loading hours…</div>
    <div v-else-if="error" class="note-card">
      <span class="chip critical">Couldn't load BOH hours</span>
      <span class="quiet">{{ error.message }}</span>
    </div>
    <div v-else-if="data && !data.hasData" class="note-card">
      <span class="chip warning">No hours synced yet</span>
      <span class="quiet">Run the Toast hours backfill (see CLAUDE.md, BOH hours report).</span>
    </div>

    <template v-else-if="data">
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

      <div class="cards">
        <div class="card">
          <div class="l">BOH hours</div>
          <div class="v">{{ data.totals.all.toFixed(1) }}</div>
          <div class="s">{{ data.totals.kitchen.toFixed(1) }} kitchen + {{ data.totals.porters.toFixed(1) }} porters</div>
        </div>
        <div class="card">
          <div class="l">Overtime hours</div>
          <div class="v">{{ data.totals.overtime.toFixed(1) }}</div>
          <div class="s">{{ overCount }} in overtime · {{ closeCount }} near {{ data.thresholds.close }}+</div>
        </div>
        <div v-if="data.autoClockOuts.shifts" class="card">
          <div class="l">Auto clock-outs</div>
          <div class="v">{{ data.autoClockOuts.shifts }}</div>
          <div class="s">{{ data.autoClockOuts.people }} {{ data.autoClockOuts.people === 1 ? 'person' : 'people' }} · check in Toast</div>
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
          <caption>BOH hours worked per employee, by day</caption>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Total</th>
              <th v-for="d in data.days" :key="d.date" scope="col" :class="{ closed: d.isClosedDay }">{{ d.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!kitchen.length">
              <td :colspan="data.days.length + 2" class="muted">No kitchen hours recorded yet.</td>
            </tr>
            <template v-for="(group, gi) in [kitchen, porters]" :key="gi">
              <tr v-if="gi === 1 && porters.length" class="section-row"><th :colspan="data.days.length + 2" scope="colgroup">Porters</th></tr>
              <tr v-for="p in group" :key="p.guid">
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
              <th scope="row">All BOH</th>
              <td class="total">{{ data.totals.all.toFixed(1) }}</td>
              <td v-for="d in data.days" :key="d.date" :class="{ closed: d.isClosedDay }">{{ fmtH(data.totals.byDay[d.date] ?? 0) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="foot">
        Counts hours worked as {{ data.includedJobs.join(', ') }}. "In overtime" = Toast logged overtime or {{ data.thresholds.overtime }}+ hours.
        ⚠ marks a shift Toast clocked out automatically because nobody did: it usually runs long and is worth correcting in Toast, since it can push someone into overtime. An unfinished shift can look off too.
        <template v-if="data.notCounted.length">
          Not counted as BOH: {{ data.notCounted.map(x => `${x.title} (${x.hours.toFixed(1)} hrs)`).join(', ') }}.
        </template>
      </p>
    </template>
  </section>
</template>

<style scoped>
.boh { margin-bottom: 28px; }
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
.hours-table caption, .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
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
.foot { margin: 10px 2px 0; color: var(--ink-2); font-size: 12px; line-height: 1.5; }
</style>
