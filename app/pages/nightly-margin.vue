<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Nightly Margin` })

const { data, pending, error, refresh } = await useFetch('/api/nightly-margin')

type Period = 'month' | 'year'
const PERIOD_LABEL: Record<Period, string> = { month: 'month', year: 'year' }
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Same UTC-anchored date handling as the Revenue Calendar page — avoids a
// browser west of UTC rolling a date back a day.
function parseIsoDate(s: string) {
  return new Date(`${s}T00:00:00Z`)
}
function formatWeekdayDate(s: string, includeYear = false) {
  const d = parseIsoDate(s)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${weekday}, ${month} ${d.getUTCDate()}${includeYear ? ` ${d.getUTCFullYear()}` : ''}`
}
function daysInMonthUTC(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}
function weekdayUTC(dateStr: string): number {
  return parseIsoDate(dateStr).getUTCDay()
}
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function fmtMoney0(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

const period = ref<Period>('month')
const pageTitle = computed(() => period.value === 'month' ? "This Month's Nightly Margin" : "This Year's Nightly Margin")

type MarginDay = { date: string, actual: number, comparison: number, laborHours: number, estVariableLabor: number, estFixedLabor: number, estCogs: number }
const marginDaysMap = computed(() => new Map((data.value?.margin[period.value]?.days ?? []).map((d: MarginDay) => [d.date, d])))

type DayStatus = 'good' | 'neutral' | 'bad' | 'critical' | 'no-data' | 'future'
type DayCell = { date: string, day: number, status: DayStatus, deltaPct: number | null, revenue: number | null, estCost: number | null, detail: MarginDay | null }
// Same ±5%/±18.75% banding as the Revenue Calendar, applied to
// revenue-vs-estimated-cost instead of revenue-vs-goal: comfortably over
// estimated cost reads good, comfortably under reads bad/critical, close
// to break-even reads neutral.
function dayStatus(dateStr: string): DayCell {
  const asOf = data.value?.asOfDate
  if (!asOf || dateStr > asOf) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'future', deltaPct: null, revenue: null, estCost: null, detail: null }
  const entry = marginDaysMap.value.get(dateStr) as MarginDay | undefined
  if (!entry || entry.comparison === 0) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'no-data', deltaPct: null, revenue: null, estCost: null, detail: null }
  const deltaPct = ((entry.actual - entry.comparison) / entry.comparison) * 100
  const status: DayStatus = deltaPct <= -18.75 ? 'critical' : deltaPct <= -5 ? 'bad' : deltaPct >= 5 ? 'good' : 'neutral'
  return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status, deltaPct, revenue: entry.actual, estCost: entry.comparison, detail: entry }
}
function showMiniDayNum(status: DayStatus): boolean {
  return status === 'good' || status === 'neutral' || status === 'bad' || status === 'critical'
}
function cellTitle(cell: DayCell): string | undefined {
  if (!cell.detail) return undefined
  const d = cell.detail
  const marginAfterFixed = d.actual - d.comparison - d.estFixedLabor
  return `Revenue: ${fmtMoney0(d.actual)}\nEst. variable (hourly) labor: ${fmtMoney0(d.estVariableLabor)} (${d.laborHours.toFixed(1)}h)\nEst. food + beverage COGS: ${fmtMoney0(d.estCogs)}\nEst. marginal cost (judged below): ${fmtMoney0(d.comparison)}\n———\nFor context only, not counted above — paid whether open or not:\nFixed labor & benefits share: ${fmtMoney0(d.estFixedLabor)}\nMargin after fixed labor & benefits: ${marginAfterFixed >= 0 ? '+' : '−'}${fmtMoney0(Math.abs(marginAfterFixed))}`
}
function buildMonthGrid(year: number, month1: number) {
  const dim = daysInMonthUTC(year, month1)
  const firstDateStr = `${year}-${pad2(month1)}-01`
  const leadBlanks = weekdayUTC(firstDateStr)
  const cells: (DayCell | null)[] = Array.from({ length: leadBlanks }, () => null)
  for (let d = 1; d <= dim; d++) cells.push(dayStatus(`${year}-${pad2(month1)}-${pad2(d)}`))
  return { year, month: month1, label: MONTH_NAMES[month1 - 1], cells }
}
type CalendarView =
  | { kind: 'month', grid: ReturnType<typeof buildMonthGrid> }
  | { kind: 'year', months: ReturnType<typeof buildMonthGrid>[] }
const calendarView = computed<CalendarView | null>(() => {
  if (!data.value?.asOfDate) return null
  if (period.value === 'month') {
    return { kind: 'month', grid: buildMonthGrid(data.value.asOfYear, data.value.asOfMonth) }
  }
  return { kind: 'year', months: Array.from({ length: 12 }, (_, i) => buildMonthGrid(data.value!.asOfYear, i + 1)) }
})

const marginDays = computed(() => (data.value?.margin[period.value]?.days ?? []) as MarginDay[])
const shortfallDays = computed(() => marginDays.value.filter(d => d.actual < d.comparison))
const marginFlagged = computed(() => shortfallDays.value.length > 0)
const shortfallTotal = computed(() => shortfallDays.value.reduce((sum, d) => sum + (d.comparison - d.actual), 0))
const marginCallout = computed(() => {
  const total = marginDays.value.length
  const covered = total - shortfallDays.value.length
  if (!total || !marginFlagged.value) return ''
  return `${covered} of ${total} night${total === 1 ? '' : 's'} this ${PERIOD_LABEL[period.value]} covered their own variable (hourly) labor + COGS. The shortfall is concentrated in ${shortfallDays.value.length} night${shortfallDays.value.length === 1 ? '' : 's'} below — combined, they account for ${fmtMoney0(shortfallTotal.value)} of the gap.`
})

const rates = computed(() => data.value?.rates ?? null)
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading nightly margin…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load data</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>
    <div v-else-if="!data?.asOfDate" class="drill-card">
      <span class="chip warning">No synced data yet</span>
      <span class="quiet-note">Run a QuickBooks sync (POST /api/qbo/sync) to pull in P&amp;L data before this page has anything to show.</span>
    </div>

    <template v-else>
      <PageHeader
        :page-name="pageTitle"
        description="Each operating night's revenue vs. an estimate of that night's own variable cost — was it worth being open?"
        :as-of-label="formatWeekdayDate(data.asOfDate)"
        @synced="refresh()"
      />

      <div class="drilldown-toggle-bar">
        <div class="drilldown-toggle-label">Period</div>
        <div class="period-tabs">
          <span :class="['period-tab', period === 'month' && 'active']" @click="period = 'month'">Month</span>
          <span :class="['period-tab', period === 'year' && 'active']" @click="period = 'year'">Year</span>
        </div>
      </div>

      <section v-if="rates && !rates.ratesAvailable">
        <div class="drill-card quiet">
          <span class="chip warning">Not enough data yet</span>
          <span class="quiet-note">Needs both QuickBooks and Toast data synced since the location move (Jun 20, 2026) to estimate a labor rate, COGS%, and fixed-labor allocation.</span>
        </div>
      </section>

      <section v-else>
        <div class="section-head">
          <div class="section-note">
            Estimated, not measured — neither labor nor COGS actually posts at nightly grain. Each night is judged against its <strong>marginal</strong> cost only — variable (hourly) labor (that night's real Toast hours, salaried staff excluded, times a blended hourly rate) plus COGS (that night's revenue times a blended Food+Beverage COGS%) — since that's what answers "was tonight worth being open," not the fully-loaded cost. Management salaries, benefits, and payroll taxes are paid whether the restaurant opens that night or not, so they're shown in each day's hover detail for context but not counted against it. Rates are trailing averages since the location move ({{ formatWeekdayDate(rates!.sinceDate) }}) through {{ formatWeekdayDate(data.asOfDate) }}: ${{ rates!.hourlyLaborRate!.toFixed(2) }}/hour, {{ (rates!.cogsPct! * 100).toFixed(1) }}% COGS, {{ fmtMoney0(rates!.fixedLaborPerNight!) }}/night fixed labor &amp; benefits across {{ rates!.operatingNights }} operating nights. Hover a day for the full breakdown. Days before the location move have no rate basis and are left blank.
          </div>
        </div>

        <div v-if="calendarView" class="drill-card">
          <div v-if="marginFlagged" class="callout">{{ marginCallout }}</div>
          <div v-else class="quiet-inline"><span class="chip good">Nothing unusual</span><span class="quiet-note">All nights this {{ period }} comfortably covered their own variable (hourly) labor + COGS.</span></div>

          <template v-if="calendarView.kind === 'month'">
            <div class="calendar-weekday-header-row">
              <span v-for="wd in WEEKDAY_LABELS" :key="wd">{{ wd }}</span>
            </div>
            <div class="calendar-grid">
              <div v-for="(cell, idx) in calendarView.grid.cells" :key="idx" :class="['calendar-cell', cell ? cell.status : 'blank']" :title="cell ? cellTitle(cell) : undefined">
                <template v-if="cell">
                  <div class="day-num">{{ cell.day }}</div>
                  <template v-if="cell.revenue !== null">
                    <span class="cell-delta">{{ (cell.deltaPct ?? 0) >= 0 ? '▲' : '▼' }} {{ Math.abs(cell.deltaPct ?? 0).toFixed(0) }}%</span>
                    <div class="cell-amount">{{ fmtMoney0(cell.revenue) }}</div>
                  </template>
                </template>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="year-calendar-grid">
              <div v-for="m in calendarView.months" :key="m.month" class="mini-month">
                <div class="mini-month-label">{{ m.label }}</div>
                <div class="calendar-grid mini">
                  <div v-for="(cell, idx) in m.cells" :key="idx" :class="['calendar-cell', 'mini', cell ? cell.status : 'blank']" :title="cell ? cellTitle(cell) : undefined">
                    <span v-if="cell && showMiniDayNum(cell.status)" class="mini-day-num">{{ cell.day }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <div class="calendar-legend">
            <span class="legend-chip good">▲ Worth opening, comfortably</span>
            <span class="legend-chip bad">▼ Fell short of variable cost</span>
            <span class="legend-chip critical">▼ Well short</span>
            <span class="legend-chip neutral">Roughly break-even</span>
            <span class="legend-chip no-data">No data / closed</span>
          </div>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning">No data</span>
          <span class="quiet-note">Not enough history yet for this {{ period }}.</span>
        </div>
      </section>

      <footer>
        <span>Data sources: QuickBooks Online + Toast POS, synced nightly. Estimated cost, not a measured figure — see the note above.</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }

/* ---------- period pill selector ---------- */
.period-tabs { display: flex; gap: 6px; }
.period-tab {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 11px;
  border-radius: 100px;
  border: 1px solid var(--hair);
  color: var(--ink-3);
  cursor: pointer;
  user-select: none;
}
.period-tab.active {
  background: var(--accent-wash);
  color: var(--accent);
  border-color: transparent;
}

.drilldown-toggle-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  background: var(--surface-alt);
  border: 1px solid var(--ink-3);
  border-radius: 14px;
  padding: 12px 16px;
  margin-top: 2rem;
}
.drilldown-toggle-label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
}

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
.quiet-inline { display: flex; align-items: center; gap: 10px; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.drill-card .callout {
  font-size: 12.5px;
  color: var(--ink-2);
  background: var(--surface-alt);
  border-radius: 10px;
  padding: 10px 12px;
  line-height: 1.5;
}
.section-head { margin-bottom: 10px; }
.section-note { font-size: 12px; color: var(--ink-3); line-height: 1.5; }

/* ---------- calendar (shared visual language with the Revenue Calendar) ---------- */
.calendar-weekday-header-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  padding: 0 2px;
}
.calendar-weekday-header-row span {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  text-align: center;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.calendar-cell {
  background: var(--surface-alt);
  border-radius: 10px;
  padding: 7px 8px;
  min-height: 62px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.calendar-cell.blank { background: transparent; }
.calendar-cell.no-data { background: transparent; border: 1px dashed var(--hair); }
.calendar-cell.future { opacity: 0.3; background: transparent; border: 1px dashed var(--hair); }
.calendar-cell .day-num { font-size: 11px; font-weight: 700; color: var(--ink-3); }
.calendar-cell .cell-delta { font-size: 10.5px; font-weight: 800; }
.calendar-cell .cell-amount { font-size: 11px; font-weight: 700; margin-top: auto; font-variant-numeric: tabular-nums; }
.calendar-cell.good { background: color-mix(in srgb, var(--good) 45%, var(--surface-alt)); }
.calendar-cell.bad { background: color-mix(in srgb, var(--shortfall) 45%, var(--surface-alt)); }
.calendar-cell.critical { background: color-mix(in srgb, var(--shortfall-deep) 45%, var(--surface-alt)); }
.calendar-cell.good .cell-delta,
.calendar-cell.good .day-num { color: var(--good); }
.calendar-cell.bad .cell-delta,
.calendar-cell.bad .day-num { color: var(--shortfall); }
.calendar-cell.critical .cell-delta,
.calendar-cell.critical .day-num { color: var(--shortfall-deep); }

.year-calendar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 18px;
}
.mini-month-label { font-size: 11px; font-weight: 700; color: var(--ink-3); margin-bottom: 6px; }
.calendar-grid.mini { gap: 3px; }
.calendar-cell.mini { min-height: 0; padding: 0; aspect-ratio: 1; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.calendar-cell.mini.good { background: var(--good); }
.calendar-cell.mini.bad { background: var(--shortfall); }
.calendar-cell.mini.critical { background: var(--shortfall-deep); }
.mini-day-num { font-size: 9px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: var(--ink); }
.calendar-cell.mini.good .mini-day-num,
.calendar-cell.mini.bad .mini-day-num,
.calendar-cell.mini.critical .mini-day-num { color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55); }

.calendar-legend { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; border-top: 1px solid var(--hair); }
.legend-chip {
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 100px;
  background: var(--surface-alt);
  color: var(--ink-3);
}
.legend-chip.good { color: var(--good); background: color-mix(in srgb, var(--good) 32%, var(--surface-alt)); }
.legend-chip.bad { color: var(--shortfall); background: color-mix(in srgb, var(--shortfall) 32%, var(--surface-alt)); }
.legend-chip.critical { color: var(--shortfall-deep); background: color-mix(in srgb, var(--shortfall-deep) 38%, var(--surface-alt)); }
.legend-chip.no-data { border: 1px dashed var(--hair); background: transparent; }
</style>
