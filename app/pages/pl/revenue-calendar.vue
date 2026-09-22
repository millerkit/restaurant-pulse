<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Revenue/Margin Calendar` })

const { data, pending, error, refresh } = await useFetch('/api/pl')
const { data: marginData, pending: marginPending, error: marginError, refresh: refreshMargin } = await useFetch('/api/nightly-margin')

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
function fmtMoney0(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}
function fmtMoneySigned(n: number): string {
  return `${n >= 0 ? '+' : '−'}${fmtMoney0(Math.abs(n))}`
}

// Two tabs, folded onto one page 2026-09-22 (previously two separate pages,
// Revenue Calendar and Nightly Margin) — both are the same "operating day vs.
// a per-day comparison figure" calendar shape, just with a different
// comparison (a weekday revenue goal vs. an estimated fully-loaded cost), so
// they share one Month/Year period toggle, one tooltip instance, and nearly
// all of their layout/CSS. `view` picks which comparison is showing;
// `period` applies to whichever view is active.
type View = 'revenue' | 'margin'
const view = ref<View>('revenue')
const period = ref<Period>('month')

const pageTitle = computed(() => {
  if (view.value === 'revenue') return period.value === 'month' ? 'This Month’s Revenue Calendar' : 'This Year’s Revenue Calendar'
  return period.value === 'month' ? "This Month's Nightly Margin" : "This Year's Nightly Margin"
})
const pageDescription = computed(() => view.value === 'revenue'
  ? "Each operating day vs. that weekday's own revenue goal"
  : "Each operating night's estimated profit after covering variable (hourly) labor, COGS, and its share of fixed labor & benefits")

// ============================== Revenue tab ==============================
// Moved here 2026-08-20 from the old standalone P&L Drill-Downs page, which
// was retired — this was the one genuinely useful piece (a real day-vs-goal
// comparison, not a within-period proration), so it earned its own
// top-level page rather than staying bundled with the Labor/Opex breakdown
// that moved to Budget Pace instead. See CLAUDE.md's "Budget Pace /
// Drill-Downs consolidation" section.
const revenueDaysMap = computed(() => new Map((data.value?.revenue[period.value]?.days ?? []).map(d => [d.date, d])))
type RevDayStatus = 'good' | 'neutral' | 'bad' | 'critical' | 'no-data' | 'future'
// A hover-card row: label/value pair, table-aligned via a 2-col CSS grid.
// `strong` bumps weight+size for the one number worth scanning for; `tone`
// colors the value good/bad the same way the rest of this page's chips do.
type TipRow = { label: string, value: string, strong?: boolean, tone?: 'good' | 'bad' }
type RevDayCell = { date: string, day: number, status: RevDayStatus, deltaPct: number | null, actual: number | null, comparison: number | null, tip: TipRow[] | null }
function buildRevTip(actual: number, comparison: number, deltaPct: number): TipRow[] {
  const shortLabel = revenueComparisonShortLabel.value
  const capShortLabel = shortLabel.charAt(0).toUpperCase() + shortLabel.slice(1)
  return [
    { label: 'Revenue', value: `$${Math.round(actual).toLocaleString()}` },
    { label: capShortLabel, value: `$${Math.round(comparison).toLocaleString()}` },
    { label: `vs. ${shortLabel}`, value: `${deltaPct >= 0 ? '+' : '−'}${Math.abs(deltaPct).toFixed(0)}%`, strong: true, tone: deltaPct >= 0 ? 'good' : 'bad' }
  ]
}
// A day within ±5% of its weekday goal reads as "normal fluctuation," not a
// signal — below that, red; above, green. -18.75% mirrors the same
// "critical" cutoff the old ranked list used, so a truly bad day still
// stands out from a merely-soft one.
function revDayStatus(dateStr: string): RevDayCell {
  const asOf = data.value?.asOfDate
  if (!asOf || dateStr > asOf) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'future', deltaPct: null, actual: null, comparison: null, tip: null }
  const entry = revenueDaysMap.value.get(dateStr)
  // No entry means either no target exists for this day (before the
  // location move, or no weekly_revenue_benchmark configured — see
  // pl.get.ts) or a $0 goal, which can't support a percentage either way.
  // Rendered the same as "no data" — either way there's nothing meaningful
  // to compare.
  if (!entry || entry.comparison === 0) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'no-data', deltaPct: null, actual: null, comparison: null, tip: null }
  const deltaPct = ((entry.actual - entry.comparison) / entry.comparison) * 100
  const status: RevDayStatus = deltaPct <= -18.75 ? 'critical' : deltaPct <= -5 ? 'bad' : deltaPct >= 5 ? 'good' : 'neutral'
  return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status, deltaPct, actual: entry.actual, comparison: entry.comparison, tip: buildRevTip(entry.actual, entry.comparison, deltaPct) }
}
// Year-view mini-cells get a day number only when there's a real result to
// label — good/neutral/bad/critical. no-data and future stay bare (a
// dashed/empty square already says "nothing here" on its own), which as a
// side effect skips every Monday for free: Monday never has a weekday
// target (see weekly-targets.ts), so it's always 'no-data' and never hits
// this list — no separate Monday check needed.
function showMiniDayNum(status: RevDayStatus | MarginDayStatus): boolean {
  return status === 'good' || status === 'neutral' || status === 'bad' || status === 'critical' || status === 'severe'
}
function buildRevMonthGrid(year: number, month1: number) {
  const dim = daysInMonthUTC(year, month1)
  const firstDateStr = `${year}-${pad2(month1)}-01`
  const leadBlanks = weekdayUTC(firstDateStr)
  const cells: (RevDayCell | null)[] = Array.from({ length: leadBlanks }, () => null)
  for (let d = 1; d <= dim; d++) cells.push(revDayStatus(`${year}-${pad2(month1)}-${pad2(d)}`))
  return { year, month: month1, label: MONTH_NAMES[month1 - 1], cells }
}
type RevCalendarView =
  | { kind: 'month', grid: ReturnType<typeof buildRevMonthGrid> }
  | { kind: 'year', months: ReturnType<typeof buildRevMonthGrid>[] }
const revCalendarView = computed<RevCalendarView | null>(() => {
  if (!data.value?.asOfDate) return null
  const p = data.value.periods[period.value]
  if (!p) return null
  if (period.value === 'month') {
    return { kind: 'month', grid: buildRevMonthGrid(data.value.asOfYear, data.value.asOfMonth) }
  }
  return { kind: 'year', months: Array.from({ length: 12 }, (_, i) => buildRevMonthGrid(data.value!.asOfYear, i + 1)) }
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

// ============================== Margin tab ================================
// Same UTC-anchored date handling as the Revenue tab above.
function costFor(d: MarginDayLocal): number {
  return d.comparison + d.estFixedLabor
}
type MarginDayLocal = { date: string, actual: number, comparison: number, laborHours: number, estVariableLabor: number, estFixedLabor: number, estCogs: number }
const marginDaysMap = computed(() => new Map((marginData.value?.margin[period.value]?.days ?? []).map((d: MarginDayLocal) => [d.date, d])))

type MarginDayStatus = 'good' | 'neutral' | 'bad' | 'critical' | 'severe' | 'no-data' | 'future'
type MarginDayCell = { date: string, day: number, status: MarginDayStatus, profit: number | null, marginPct: number | null, detail: MarginDayLocal | null, tip: TipRow[] | null }
// Bands are real profit-margin % of revenue (profit / revenue), not the
// old profit / cost "markup" framing — checked against this restaurant's
// real fully-loaded distribution before picking these (2026-08-21): real
// nights run roughly -46% to +74% (median ~46%, ~25% of nights actually
// negative).
function marginStatus(marginPct: number): MarginDayStatus {
  return marginPct < -10 ? 'critical' : marginPct < 0 ? 'bad' : marginPct < 20 ? 'neutral' : 'good'
}
function buildMarginTip(status: MarginDayStatus, profit: number, marginPct: number, d: MarginDayLocal): TipRow[] {
  const rows: TipRow[] = []
  if (status === 'severe') rows.push({ label: '⚠', value: 'Under variable cost', strong: true, tone: 'bad' })
  rows.push(
    { label: 'Revenue', value: fmtMoney0(d.actual) },
    { label: 'Labor', value: fmtMoney0(d.estVariableLabor) },
    { label: 'COGS', value: fmtMoney0(d.estCogs) },
    { label: 'Fixed', value: fmtMoney0(d.estFixedLabor) },
    { label: 'Profit', value: `${fmtMoneySigned(profit)} (${marginPct.toFixed(0)}%)`, strong: true, tone: profit >= 0 ? 'good' : 'bad' }
  )
  return rows
}
// Judged against each night's full cost — variable (hourly) labor + COGS
// plus its even share of fixed labor & benefits — "is this night pulling
// its weight toward overhead." A separate "Marginal" view (judged against
// variable cost alone — "was tonight worth being open") used to sit behind
// a toggle here, but was removed 2026-09-13: it read green on almost every
// night by design (a restaurant only opens on nights it expects to clear
// that low a bar), which made it useless day-to-day. The one thing it WAS
// good for — flagging the rare night that didn't even cover its own
// variable cost — is kept below as a distinct "severe" status instead of
// losing that signal along with the toggle.
function marginDayStatus(dateStr: string): MarginDayCell {
  const asOf = marginData.value?.asOfDate
  if (!asOf || dateStr > asOf) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'future', profit: null, marginPct: null, detail: null, tip: null }
  const entry = marginDaysMap.value.get(dateStr) as MarginDayLocal | undefined
  if (!entry || entry.actual === 0) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'no-data', profit: null, marginPct: null, detail: null, tip: null }
  const cost = costFor(entry)
  const profit = entry.actual - cost
  const marginPct = (profit / entry.actual) * 100
  // Didn't even cover variable (hourly) labor + COGS — a distinct, rarer,
  // and worse signal than an ordinary fully-loaded loss (which mostly just
  // reflects the normal fixed-cost allocation), so it overrides the usual
  // profit-margin band with its own darkest status.
  const variableShortfall = entry.actual < entry.comparison
  const status = variableShortfall ? 'severe' : marginStatus(marginPct)
  return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status, profit, marginPct, detail: entry, tip: buildMarginTip(status, profit, marginPct, entry) }
}
function buildMarginMonthGrid(year: number, month1: number) {
  const dim = daysInMonthUTC(year, month1)
  const firstDateStr = `${year}-${pad2(month1)}-01`
  const leadBlanks = weekdayUTC(firstDateStr)
  const cells: (MarginDayCell | null)[] = Array.from({ length: leadBlanks }, () => null)
  for (let d = 1; d <= dim; d++) cells.push(marginDayStatus(`${year}-${pad2(month1)}-${pad2(d)}`))
  return { year, month: month1, label: MONTH_NAMES[month1 - 1], cells }
}
type MarginCalendarView =
  | { kind: 'month', grid: ReturnType<typeof buildMarginMonthGrid> }
  | { kind: 'year', months: ReturnType<typeof buildMarginMonthGrid>[] }
const marginCalendarView = computed<MarginCalendarView | null>(() => {
  if (!marginData.value?.asOfDate) return null
  if (period.value === 'month') {
    return { kind: 'month', grid: buildMarginMonthGrid(marginData.value.asOfYear, marginData.value.asOfMonth) }
  }
  return { kind: 'year', months: Array.from({ length: 12 }, (_, i) => buildMarginMonthGrid(marginData.value!.asOfYear, i + 1)) }
})

const COST_LABEL = 'their own variable labor + COGS + fixed labor & benefits share'

const marginDays = computed(() => (marginData.value?.margin[period.value]?.days ?? []) as MarginDayLocal[])
const marginShortfallDays = computed(() => marginDays.value.filter(d => d.actual < costFor(d)))
const marginFlagged = computed(() => marginShortfallDays.value.length > 0)
const marginShortfallTotal = computed(() => marginShortfallDays.value.reduce((sum, d) => sum + (costFor(d) - d.actual), 0))
const marginCallout = computed(() => {
  const total = marginDays.value.length
  const covered = total - marginShortfallDays.value.length
  if (!total || !marginFlagged.value) return ''
  return `${covered} of ${total} night${total === 1 ? '' : 's'} this ${PERIOD_LABEL[period.value]} covered ${COST_LABEL}. The shortfall is concentrated in ${marginShortfallDays.value.length} night${marginShortfallDays.value.length === 1 ? '' : 's'} below — combined, they account for ${fmtMoney0(marginShortfallTotal.value)} of the gap.`
})

// The rare, more alarming case: a night whose revenue didn't even cover
// variable (hourly) labor + COGS, before fixed labor & benefits are even
// considered. This is what the old "Marginal" toggle view was actually
// useful for (see the comment above `costFor`) — kept as its own flagged
// status instead of a whole second view.
const variableShortfallDays = computed(() => marginDays.value.filter(d => d.actual < d.comparison))
const variableShortfallFlagged = computed(() => variableShortfallDays.value.length > 0)
const variableShortfallCallout = computed(() => {
  const n = variableShortfallDays.value.length
  if (!n) return ''
  const dates = variableShortfallDays.value.map(d => formatWeekdayDate(d.date)).join(', ')
  return `${n} night${n === 1 ? '' : 's'} this ${PERIOD_LABEL[period.value]} didn't even cover variable (hourly) labor + COGS — revenue itself fell short of the marginal cost of being open: ${dates}.`
})

const rates = computed(() => marginData.value?.rates ?? null)

// ============================== Shared =====================================
const tooltip = useHoverTooltip<TipRow[]>()
function setTooltipEl(el: unknown) {
  tooltip.tipRef.value = el as HTMLElement | null
}
function refreshBoth() {
  refresh()
  refreshMargin()
}
</script>

<template>
  <div>
    <div v-if="pending || marginPending" class="state-note">Loading revenue/margin calendar…</div>
    <div v-else-if="error || marginError" class="drill-card">
      <span class="chip critical">Couldn't load data</span>
      <span class="quiet-note">{{ (error || marginError)?.message }}</span>
    </div>
    <div v-else-if="!data?.asOfDate" class="drill-card">
      <span class="chip warning">No synced data yet</span>
      <span class="quiet-note">Run a QuickBooks sync (POST /api/qbo/sync) to pull in P&amp;L data before this page has anything to show.</span>
    </div>

    <template v-else>
      <PageHeader
        :page-name="pageTitle"
        :description="pageDescription"
        :as-of-label="formatWeekdayDate(data.asOfDate)"
        @synced="refreshBoth()"
      />

      <div class="drilldown-toggle-bar">
        <div class="drilldown-toggle-label">View</div>
        <div class="period-tabs">
          <span :class="['period-tab', view === 'revenue' && 'active']" @click="view = 'revenue'">Revenue</span>
          <span :class="['period-tab', view === 'margin' && 'active']" @click="view = 'margin'">Margin</span>
        </div>
      </div>

      <div class="drilldown-toggle-bar">
        <div class="drilldown-toggle-label">Period</div>
        <div class="period-tabs">
          <span :class="['period-tab', period === 'month' && 'active']" @click="period = 'month'">Month</span>
          <span :class="['period-tab', period === 'year' && 'active']" @click="period = 'year'">Year</span>
        </div>
      </div>

      <!-- ============================== Revenue tab ============================== -->
      <section v-if="view === 'revenue'">
        <div class="section-head">
          <div class="section-note">Percentage is the change vs. {{ revenueComparisonLabel }} (see the Dashboard's Weekly Performance section); the dollar figure below it is that day's actual revenue, not the size of the change. Days before the location move (Jun 20, 2026) have no goal to compare against and are left blank.</div>
        </div>

        <div v-if="revCalendarView" class="drill-card">
          <div v-if="revenueFlagged" class="callout">{{ revenueCallout }}</div>
          <div v-else class="quiet-inline"><span class="chip good">Nothing unusual</span><span class="quiet-note">All days this {{ period }} met or beat {{ revenueComparisonLabel }}.</span></div>

          <template v-if="revCalendarView.kind === 'month'">
            <div class="calendar-weekday-header-row">
              <span v-for="wd in WEEKDAY_LABELS" :key="wd">{{ wd }}</span>
            </div>
            <div class="calendar-grid">
              <div
                v-for="(cell, idx) in revCalendarView.grid.cells"
                :key="idx"
                :class="['calendar-cell', cell ? cell.status : 'blank']"
                @mouseenter="tooltip.show($event, cell?.tip)"
                @mouseleave="tooltip.hide()"
              >
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
              <div v-for="m in revCalendarView.months" :key="m.month" class="mini-month">
                <div class="mini-month-label">{{ m.label }}</div>
                <div class="calendar-grid mini">
                  <div
                    v-for="(cell, idx) in m.cells"
                    :key="idx"
                    :class="['calendar-cell', 'mini', cell ? cell.status : 'blank']"
                    @mouseenter="tooltip.show($event, cell?.tip)"
                    @mouseleave="tooltip.hide()"
                  >
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

      <!-- ============================== Margin tab ============================== -->
      <template v-else>
        <section v-if="rates && !rates.ratesAvailable">
          <div class="drill-card quiet">
            <span class="chip warning">Not enough data yet</span>
            <span class="quiet-note">Needs both QuickBooks and Toast data synced since the location move (Jun 20, 2026) to estimate a labor rate, COGS%, and fixed-labor allocation.</span>
          </div>
        </section>

        <section v-else>
          <div class="section-head">
            <div class="section-note">
              Estimated from trailing rates, not exact nightly costs. Counts each night's variable (hourly) labor, food &amp; beverage COGS, and its even share of fixed labor &amp; benefits. Big number = profit; percent = margin. Current rates: ${{ rates!.hourlyLaborRate!.toFixed(2) }}/hr, {{ (rates!.cogsPct! * 100).toFixed(1) }}% COGS, {{ fmtMoney0(rates!.fixedLaborPerNight!) }}/night fixed labor, {{ rates!.operatingNights }} nights.
            </div>
          </div>

          <div v-if="marginCalendarView" class="drill-card">
            <div v-if="variableShortfallFlagged" class="callout callout-severe">⚠ {{ variableShortfallCallout }}</div>
            <div v-if="marginFlagged" class="callout">{{ marginCallout }}</div>
            <div v-else class="quiet-inline"><span class="chip good">Nothing unusual</span><span class="quiet-note">All nights this {{ period }} comfortably covered {{ COST_LABEL }}.</span></div>

            <template v-if="marginCalendarView.kind === 'month'">
              <div class="calendar-weekday-header-row">
                <span v-for="wd in WEEKDAY_LABELS" :key="wd">{{ wd }}</span>
              </div>
              <div class="calendar-grid">
                <div
                  v-for="(cell, idx) in marginCalendarView.grid.cells"
                  :key="idx"
                  :class="['calendar-cell', cell ? cell.status : 'blank']"
                  @mouseenter="tooltip.show($event, cell?.tip)"
                  @mouseleave="tooltip.hide()"
                >
                  <template v-if="cell">
                    <div class="day-num">{{ cell.day }}</div>
                    <template v-if="cell.profit !== null">
                      <span class="cell-delta">{{ cell.status === 'severe' ? '⚠ ' : '' }}{{ fmtMoneySigned(cell.profit) }}</span>
                      <div class="cell-amount">{{ (cell.marginPct ?? 0).toFixed(0) }}% margin</div>
                    </template>
                  </template>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="year-calendar-grid">
                <div v-for="m in marginCalendarView.months" :key="m.month" class="mini-month">
                  <div class="mini-month-label">{{ m.label }}</div>
                  <div class="calendar-grid mini">
                    <div
                      v-for="(cell, idx) in m.cells"
                      :key="idx"
                      :class="['calendar-cell', 'mini', cell ? cell.status : 'blank']"
                      @mouseenter="tooltip.show($event, cell?.tip)"
                      @mouseleave="tooltip.hide()"
                    >
                      <span v-if="cell && showMiniDayNum(cell.status)" class="mini-day-num">{{ cell.status === 'severe' ? '⚠' : cell.day }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <div class="calendar-legend">
              <span class="legend-chip good">20%+ margin</span>
              <span class="legend-chip neutral">0–20% margin</span>
              <span class="legend-chip bad">Loss, under 10% of revenue</span>
              <span class="legend-chip critical">Loss, 10%+ of revenue</span>
              <span class="legend-chip severe">⚠ Didn't cover variable labor + COGS</span>
              <span class="legend-chip no-data">No data / closed</span>
            </div>
          </div>
          <div v-else class="drill-card quiet">
            <span class="chip warning">No data</span>
            <span class="quiet-note">Not enough history yet for this {{ period }}.</span>
          </div>
        </section>
      </template>

      <footer>
        <span v-if="view === 'revenue'">Data source: QuickBooks Online, synced nightly</span>
        <span v-else>Data sources: QuickBooks Online + Toast POS, synced nightly. Estimated cost, not a measured figure — see the note above.</span>
      </footer>
    </template>

    <Teleport to="body">
      <div v-if="tooltip.rows.value" :ref="setTooltipEl" class="hover-tip" :style="tooltip.style.value">
        <template v-for="(row, i) in tooltip.rows.value" :key="i">
          <span :class="['tip-label', row.strong && 'strong']">{{ row.label }}</span>
          <span :class="['tip-value', row.strong && 'strong', row.tone]">{{ row.value }}</span>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }

/* ---------- pill selectors (View, Period) ---------- */
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
.drilldown-toggle-bar + .drilldown-toggle-bar { margin-top: 10px; }
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
.drill-card .callout.callout-severe {
  color: var(--shortfall-deep);
  background: color-mix(in srgb, var(--shortfall-deep) 16%, var(--surface-alt));
  font-weight: 700;
}
.section-head { margin-bottom: 10px; }
.section-note { font-size: 12px; color: var(--ink-3); line-height: 1.5; }

/* ---------- calendar (shared between the Revenue and Margin tabs) ---------- */
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
.calendar-cell.severe { background: color-mix(in srgb, var(--shortfall-deep) 80%, black); }
.calendar-cell.good .cell-delta,
.calendar-cell.good .day-num { color: var(--good); }
.calendar-cell.bad .cell-delta,
.calendar-cell.bad .day-num { color: var(--shortfall); }
.calendar-cell.critical .cell-delta,
.calendar-cell.critical .day-num { color: var(--shortfall-deep); }
.calendar-cell.severe .cell-delta,
.calendar-cell.severe .day-num { color: #fff; }

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
.calendar-cell.mini.severe { background: color-mix(in srgb, var(--shortfall-deep) 80%, black); }
.mini-day-num { font-size: 9px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: var(--ink); }
.calendar-cell.mini.good .mini-day-num,
.calendar-cell.mini.bad .mini-day-num,
.calendar-cell.mini.critical .mini-day-num,
.calendar-cell.mini.severe .mini-day-num { color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55); }

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
.legend-chip.severe { color: #fff; background: color-mix(in srgb, var(--shortfall-deep) 80%, black); }
.legend-chip.no-data { border: 1px dashed var(--hair); background: transparent; }

/* ---------- hover-card tooltip: a single instance, teleported to <body>
   and positioned via useHoverTooltip's clamped getBoundingClientRect math,
   so it can never clip off-screen the way a per-cell `position: absolute`
   tooltip did for cells in the rightmost column. ---------- */
.hover-tip {
  position: fixed;
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
  padding: 6px 10px;
  display: grid;
  grid-template-columns: auto auto;
  column-gap: 12px;
  row-gap: 3px;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1000;
}
.hover-tip .tip-label { color: var(--ink-3); font-weight: 600; text-align: left; }
.hover-tip .tip-value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink); }
.hover-tip .tip-label.strong,
.hover-tip .tip-value.strong { font-weight: 800; font-size: 12px; }
.hover-tip .tip-value.good { color: var(--good); }
.hover-tip .tip-value.bad { color: var(--shortfall); }
</style>
