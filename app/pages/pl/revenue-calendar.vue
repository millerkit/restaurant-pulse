<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Revenue Calendar` })

const { data, pending, error, refresh } = await useFetch('/api/pl')

type Period = 'month' | 'year'
const PERIOD_LABEL: Record<Period, string> = { month: 'month', year: 'year' }
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---- date formatting (daily_line_items dates are UTC-anchored ISO
// strings, parsed/formatted in UTC throughout, same convention as the P&L
// summary page — avoids a browser west of UTC rolling a date back a day) --
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

// Moved here 2026-08-20 from the old standalone P&L Drill-Downs page, which
// was retired — this was the one genuinely useful piece (a real day-vs-goal
// comparison, not a within-period proration), so it earned its own
// top-level page rather than staying bundled with the Labor/Opex breakdown
// that moved to Budget Pace instead. See CLAUDE.md's "Budget Pace /
// Drill-Downs consolidation" section.
const period = ref<Period>('month')

const pageTitle = computed(() => period.value === 'month' ? 'This Month’s Revenue Calendar' : 'This Year’s Revenue Calendar')

const revenueDaysMap = computed(() => new Map((data.value?.revenue[period.value]?.days ?? []).map(d => [d.date, d])))
type DayStatus = 'good' | 'neutral' | 'bad' | 'critical' | 'no-data' | 'future'
type DayCell = { date: string, day: number, status: DayStatus, deltaPct: number | null, actual: number | null, comparison: number | null }
// A day within ±5% of its weekday goal reads as "normal fluctuation," not a
// signal — below that, red; above, green. -18.75% mirrors the same
// "critical" cutoff the old ranked list used, so a truly bad day still
// stands out from a merely-soft one.
function dayStatus(dateStr: string): DayCell {
  const asOf = data.value?.asOfDate
  if (!asOf || dateStr > asOf) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'future', deltaPct: null, actual: null, comparison: null }
  const entry = revenueDaysMap.value.get(dateStr)
  // No entry means either no target exists for this day (before the
  // location move, or no weekly_revenue_benchmark configured — see
  // pl.get.ts) or a $0 goal, which can't support a percentage either way.
  // Rendered the same as "no data" — either way there's nothing meaningful
  // to compare.
  if (!entry || entry.comparison === 0) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'no-data', deltaPct: null, actual: null, comparison: null }
  const deltaPct = ((entry.actual - entry.comparison) / entry.comparison) * 100
  const status: DayStatus = deltaPct <= -18.75 ? 'critical' : deltaPct <= -5 ? 'bad' : deltaPct >= 5 ? 'good' : 'neutral'
  return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status, deltaPct, actual: entry.actual, comparison: entry.comparison }
}
// Year-view mini-cells get a day number only when there's a real result to
// label — good/neutral/bad/critical. no-data and future stay bare (a
// dashed/empty square already says "nothing here" on its own), which as a
// side effect skips every Monday for free: Monday never has a weekday
// target (see weekly-targets.ts), so it's always 'no-data' and never hits
// this list — no separate Monday check needed.
function showMiniDayNum(status: DayStatus): boolean {
  return status === 'good' || status === 'neutral' || status === 'bad' || status === 'critical'
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
  const p = data.value.periods[period.value]
  if (!p) return null
  if (period.value === 'month') {
    return { kind: 'month', grid: buildMonthGrid(data.value.asOfYear, data.value.asOfMonth) }
  }
  return { kind: 'year', months: Array.from({ length: 12 }, (_, i) => buildMonthGrid(data.value!.asOfYear, i + 1)) }
})

const revenueDays = computed(() => data.value?.revenue[period.value]?.days ?? [])
const shortfallDays = computed(() => revenueDays.value.filter(d => d.actual < d.comparison))
const revenueFlagged = computed(() => shortfallDays.value.length > 0)
const revenueGapTotal = computed(() => shortfallDays.value.reduce((sum, d) => sum + (d.comparison - d.actual), 0))
// Every day is judged against that weekday's own dynamically-calculated
// revenue goal — see pl.get.ts's REVENUE_COMPARISON_LABEL, the single
// source of truth for this wording (server/utils/weekly-targets.ts is the
// single source of truth for the underlying number, shared with the
// Dashboard's This Week's Targets section) so neither can drift from the
// other.
const revenueComparisonLabel = computed(() => data.value?.revenue[period.value]?.comparisonLabel ?? "that weekday's revenue goal")
const revenueComparisonShortLabel = computed(() => data.value?.revenue[period.value]?.comparisonShortLabel ?? 'goal')
const revenueCallout = computed(() => {
  const total = revenueDays.value.length
  const met = total - shortfallDays.value.length
  if (!total || !revenueFlagged.value) return ''
  return `${met} of ${total} days this ${PERIOD_LABEL[period.value]} met or beat ${revenueComparisonLabel.value}. The shortfall is concentrated in ${shortfallDays.value.length} day${shortfallDays.value.length === 1 ? '' : 's'} below — combined, they account for $${Math.round(revenueGapTotal.value).toLocaleString()} of the gap.`
})
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading revenue calendar…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load P&amp;L data</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>
    <div v-else-if="!data?.asOfDate" class="drill-card">
      <span class="chip warning">No synced data yet</span>
      <span class="quiet-note">Run a QuickBooks sync (POST /api/qbo/sync) to pull in P&amp;L data before this page has anything to show.</span>
    </div>

    <template v-else>
      <PageHeader
        :page-name="pageTitle"
        description="Each operating day vs. that weekday's own revenue goal"
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

      <section>
        <div class="section-head">
          <div class="section-note">Percentage is the change vs. {{ revenueComparisonLabel }} (see the Dashboard's Weekly Performance section); the dollar figure below it is that day's actual revenue, not the size of the change. Days before the location move (Jun 20, 2026) have no goal to compare against and are left blank.</div>
        </div>

        <div v-if="calendarView" class="drill-card">
          <div v-if="revenueFlagged" class="callout">{{ revenueCallout }}</div>
          <div v-else class="quiet-inline"><span class="chip good">Nothing unusual</span><span class="quiet-note">All days this {{ period }} met or beat {{ revenueComparisonLabel }}.</span></div>

          <template v-if="calendarView.kind === 'month'">
            <div class="calendar-weekday-header-row">
              <span v-for="wd in WEEKDAY_LABELS" :key="wd">{{ wd }}</span>
            </div>
            <div class="calendar-grid">
              <div v-for="(cell, idx) in calendarView.grid.cells" :key="idx" :class="['calendar-cell', cell ? cell.status : 'blank']">
                <template v-if="cell">
                  <div class="day-num">{{ cell.day }}</div>
                  <template v-if="cell.actual !== null">
                    <span class="cell-delta">{{ (cell.deltaPct ?? 0) >= 0 ? '▲' : '▼' }} {{ Math.abs(cell.deltaPct ?? 0).toFixed(0) }}%</span>
                    <div class="cell-amount">${{ Math.round(cell.actual).toLocaleString() }}</div>
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
                  <div v-for="(cell, idx) in m.cells" :key="idx" :class="['calendar-cell', 'mini', cell ? cell.status : 'blank']">
                    <span v-if="cell && showMiniDayNum(cell.status)" class="mini-day-num">{{ cell.day }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <div class="calendar-legend">
            <span class="legend-chip good">▲ Beat {{ revenueComparisonShortLabel }}</span>
            <span class="legend-chip bad">▼ Below {{ revenueComparisonShortLabel }}</span>
            <span class="legend-chip critical">▼ Well below {{ revenueComparisonShortLabel }}</span>
            <span class="legend-chip neutral">Within normal range</span>
            <span class="legend-chip no-data">No data / closed</span>
          </div>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning">No data</span>
          <span class="quiet-note">Not enough history yet to compare this {{ period }} against {{ revenueComparisonLabel }}.</span>
        </div>
      </section>

      <footer>
        <span>Data source: QuickBooks Online, synced nightly</span>
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

/* ---------- revenue calendar ---------- */
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
.calendar-cell .cell-empty-note { font-size: 10px; color: var(--ink-3); margin-top: auto; }
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
