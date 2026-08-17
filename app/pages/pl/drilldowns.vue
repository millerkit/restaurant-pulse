<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES, benchmarkStatus, type CategoryBenchmark } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — P&L Drill-Downs` })

const { data, pending, error, refresh } = await useFetch('/api/pl')

type Period = 'week' | 'month' | 'year'
const PERIOD_LABEL: Record<Period, string> = { week: 'week', month: 'month', year: 'year' }
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
function addDaysIso(dateStr: string, n: number): string {
  const d = parseIsoDate(dateStr)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
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

const benchmarkByCategory = computed(() => {
  const map: Record<string, CategoryBenchmark> = {}
  for (const b of (data.value?.benchmarks ?? []) as CategoryBenchmark[]) map[b.category] = b
  return map
})

// Delta chip shown next to a subcategory row — "vs. prior period" is the
// whole point of these drill-downs (spotting anomalies), so the chip states
// that comparison directly rather than a bar encoding an unrelated
// dimension (share-of-group). null comparisonAmount/pctChange means the
// subcategory had nothing in the prior period — shown as "new" since a
// percentage against zero isn't meaningful. The chip states both the
// percentage AND the dollar swing (not just the percentage) — the tile's
// own bold number below is the period's full total, not the change amount,
// and a reader glancing at a colored chip next to a big dollar figure could
// otherwise easily read that figure as the size of the change rather than
// the total it actually is. Deliberately doesn't spell out "vs. prior
// week/month/year" on every chip — that's real width a narrow tile doesn't
// have to spare, and the comparison basis is already established once, by
// the section's own callout sentence or header (e.g. "Wages Drill-Down —
// This Week vs. Last Week").
type Direction = 'up' | 'down' | 'flat'
type DeltaRow = { label: string, amount: number, direction: Direction, deltaText: string }
function fmtSignedDollars(n: number): string {
  return `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString()}`
}
// A change that rounds to 0% at the precision the chip actually displays
// (anything inside ±0.5%) reads as "flat," not colored up/down — tinting a
// tile red or green over a swing the chip itself displays as "0%" is
// misleading (a real case: a salaried subcategory paying the exact same
// amount two weeks running still computes a tiny nonzero float somewhere
// upstream). This mainly matters for the Week Wages view, which shows every
// subcategory regardless of size, unlike Month/Year's flagged-only list —
// that list requires a >=50% swing to appear at all, so it can never land
// in this rounds-to-zero band.
function buildDeltaRow(r: { label: string, amount: number, comparisonAmount: number, pctChange: number | null }, periodLabel: string): DeltaRow {
  const deltaAmount = Math.round(r.amount - r.comparisonAmount)
  if (r.pctChange === null) {
    return { label: r.label, amount: r.amount, direction: 'up', deltaText: `▲ new this ${periodLabel} (${fmtSignedDollars(deltaAmount)})` }
  }
  const roundedPct = Math.round(Math.abs(r.pctChange))
  if (roundedPct === 0) {
    const deltaText = deltaAmount === 0 ? 'No change' : `${fmtSignedDollars(deltaAmount)} (<1% change)`
    return { label: r.label, amount: r.amount, direction: 'flat', deltaText: `● ${deltaText}` }
  }
  const direction: Direction = r.pctChange > 0 ? 'up' : 'down'
  const arrow = direction === 'up' ? '▲' : '▼'
  const pctSign = r.pctChange > 0 ? '+' : '−'
  return { label: r.label, amount: r.amount, direction, deltaText: `${arrow} ${pctSign}${roundedPct}% (${fmtSignedDollars(deltaAmount)})` }
}

// Groups the red (up) tiles together and the green (down) tiles together,
// with flat/neutral tiles in their own middle group — scanning the grid for
// "what's driving this red/green" is easier when the colors form clusters
// instead of alternating. Stable sort keeps each group's existing
// amount-descending order from the server.
function sortByDirection(rows: DeltaRow[]): DeltaRow[] {
  const rank: Record<Direction, number> = { up: 0, flat: 1, down: 2 }
  return [...rows].sort((a, b) => rank[a.direction] - rank[b.direction])
}

// Single shared period toggle for all three drill-down sections (Labor,
// Opex, Revenue) — see the shared control bar in the template.
const drilldownPeriod = ref<Period>('month')

// The page's own on-page heading states the actual comparison being shown
// ("This Month vs. Last Month") rather than a static "Drill-Downs" that
// never changes as the toggle above it does — the nav tab already says
// "Drill-Downs", so the heading is free to be the more useful, specific
// thing instead of repeating that.
const PAGE_TITLE: Record<Period, string> = { week: 'This Week vs. Last Week', month: 'This Month vs. Last Month', year: 'This Year vs. Last Year' }
const pageTitle = computed(() => PAGE_TITLE[drilldownPeriod.value])

// Week gets a purpose-built Wages-vs-last-week view instead of the
// anomaly-flagged Labor Drill-Down, and drops the Opex section entirely —
// per the user's request, wages and income are the only things worth a
// week-over-week look; benefits/payroll taxes and opex don't move
// meaningfully at weekly grain. Revenue Calendar (below) already is the
// income comparison, unchanged for every period including week.
const isWeeklyWagesView = computed(() => drilldownPeriod.value === 'week')

// ---- Labor drill-down -----------------------------------------------------
const laborRowsAll = computed(() => data.value?.drilldowns[drilldownPeriod.value]?.labor ?? [])
// Only subcategories that varied significantly vs. the prior period are
// shown — an exhaustive list of every subcategory (most of them unchanged)
// buries the anomalies this section exists to surface.
const laborRows = computed(() => sortByDirection(laborRowsAll.value.filter(r => r.flagged).map(r => buildDeltaRow(r, PERIOD_LABEL[drilldownPeriod.value]))))
const laborFlagged = computed(() => laborRows.value.length > 0)
const laborPeriodStatus = computed(() => {
  const totals = data.value?.periods[drilldownPeriod.value]?.totals
  if (!totals || !totals.revenue) return { pct: 0, status: null as string | null }
  const pct = totals.labor / totals.revenue
  return { pct, status: benchmarkStatus(pct, benchmarkByCategory.value.labor) }
})
// Off-target and "nothing flagged" are independent signals — a labor % that's
// over benchmark broadly, with no single subcategory spiking, still needs to
// expand the card (and say so honestly), not collapse to "Nothing unusual"
// just because no individual subcategory happened to jump vs. the prior
// period. laborOffTarget is null-safe: no benchmark configured never forces
// an expand on its own.
const laborOffTarget = computed(() => laborPeriodStatus.value.status != null && laborPeriodStatus.value.status !== 'good')
const laborCardExpanded = computed(() => laborFlagged.value || laborOffTarget.value)
const laborCallout = computed(() => {
  const flagged = laborRows.value
  const onTarget = !laborOffTarget.value
  if (!flagged.length) {
    if (onTarget) return ''
    return `Labor is off target this ${PERIOD_LABEL[drilldownPeriod.value]} (${(laborPeriodStatus.value.pct * 100).toFixed(1)}%), but no single subcategory stands out as the driver — costs are elevated broadly.`
  }
  const names = flagged.map(r => r.label).join(', ')
  const isAre = flagged.length > 1 ? 'are' : 'is'
  const tail = onTarget ? ' — worth a look even though the top-line number is on target.' : '.'
  return `Labor is ${onTarget ? 'on target' : 'off target'} overall this ${PERIOD_LABEL[drilldownPeriod.value]} (${(laborPeriodStatus.value.pct * 100).toFixed(1)}%), but ${names} ${isAre} up sharply vs. the prior ${PERIOD_LABEL[drilldownPeriod.value]}${tail}`
})

// ---- Weekly wages view (replaces the Labor Drill-Down for period='week')
// laborRowsAll is already narrowed server-side to exactly BOH/FOH/Management
// Wages, in that fixed order, always all three (see WEEKLY_WAGE_SUBCATEGORIES
// in pl.get.ts) — a direct comparison, not an anomaly list, so every row
// shows regardless of how much it moved, in a stable order week to week.
function sumForTotal(rows: { amount: number, comparisonAmount: number }[], label: string) {
  const amount = rows.reduce((sum, r) => sum + r.amount, 0)
  const comparisonAmount = rows.reduce((sum, r) => sum + r.comparisonAmount, 0)
  const pctChange = comparisonAmount > 0 ? ((amount - comparisonAmount) / comparisonAmount) * 100 : null
  return { label, amount, comparisonAmount, pctChange }
}
const weeklyWagesTotalRow = computed(() => buildDeltaRow(sumForTotal(laborRowsAll.value, 'Total Wages'), 'week'))
const weeklyWageRows = computed(() => laborRowsAll.value.map(r => buildDeltaRow(r, 'week')))
const weeklyWageTiles = computed(() => [weeklyWagesTotalRow.value, ...weeklyWageRows.value])
const weeklyWagesCallout = computed(() => {
  const t = weeklyWagesTotalRow.value
  return `Total wages this week: $${Math.round(t.amount).toLocaleString()} — ${t.deltaText} vs. last week.`
})

// ---- Opex drill-down --------------------------------------------------
// Fixed (rent/insurance/loan interest — not controllable month to month, so
// not worth benchmarking) vs. variable/discretionary (the actionable slice,
// benchmarked as 'opex_variable') — see accounts.cost_behavior in schema.sql.
function opexRowsAllFor(kind: 'opexFixed' | 'opexVariable') {
  return data.value?.drilldowns[drilldownPeriod.value]?.[kind] ?? []
}
const fixedOpexRowsAll = computed(() => opexRowsAllFor('opexFixed'))
const variableOpexRowsAll = computed(() => opexRowsAllFor('opexVariable'))
// Same filter-to-significant-variance-only treatment as labor above.
const fixedOpexRows = computed(() => sortByDirection(fixedOpexRowsAll.value.filter(r => r.flagged).map(r => buildDeltaRow(r, PERIOD_LABEL[drilldownPeriod.value]))))
const variableOpexRows = computed(() => sortByDirection(variableOpexRowsAll.value.filter(r => r.flagged).map(r => buildDeltaRow(r, PERIOD_LABEL[drilldownPeriod.value]))))
const fixedOpexTotal = computed(() => fixedOpexRowsAll.value.reduce((sum, r) => sum + r.amount, 0))
const variableOpexTotal = computed(() => variableOpexRowsAll.value.reduce((sum, r) => sum + r.amount, 0))
const opexRevenue = computed(() => data.value?.periods[drilldownPeriod.value]?.totals.revenue ?? 0)
const fixedOpexPct = computed(() => opexRevenue.value ? (fixedOpexTotal.value / opexRevenue.value) * 100 : 0)
const variableOpexPct = computed(() => opexRevenue.value ? (variableOpexTotal.value / opexRevenue.value) * 100 : 0)
const variableOpexBenchmark = computed(() => benchmarkByCategory.value.opex_variable)
const variableOpexStatus = computed(() => benchmarkStatus(variableOpexPct.value / 100, variableOpexBenchmark.value))
const variableOpexOffTarget = computed(() => variableOpexStatus.value !== null && variableOpexStatus.value !== 'good')
const opexFlagged = computed(() => fixedOpexRows.value.length > 0 || variableOpexRows.value.length > 0)
// Same independence as laborCardExpanded above: off-target variable opex
// with no single subcategory spike still needs to expand and say so, not
// collapse to "Nothing unusual".
const opexCardExpanded = computed(() => opexFlagged.value || variableOpexOffTarget.value)
const opexCallout = computed(() => {
  const flagged = variableOpexRows.value
  const target = variableOpexBenchmark.value
  const targetLabel = target ? `${(target.targetPct * 100).toFixed(0)}–${(target.warningPct * 100).toFixed(0)}%` : 'target'
  if (!flagged.length) {
    if (!variableOpexOffTarget.value) return ''
    return `Variable/discretionary opex is running above target this ${PERIOD_LABEL[drilldownPeriod.value]} (${variableOpexPct.value.toFixed(1)}% vs. ${targetLabel}), but no single subcategory stands out as the driver — costs are elevated broadly. Fixed costs ($${Math.round(fixedOpexTotal.value).toLocaleString()}, ${fixedOpexPct.value.toFixed(1)}% of revenue) are excluded from this benchmark since they aren't controllable month to month.`
  }
  const names = flagged.map(r => r.label).join(', ')
  return `Variable/discretionary opex is ${variableOpexOffTarget.value ? 'running above target' : 'within target'} this ${PERIOD_LABEL[drilldownPeriod.value]} (${variableOpexPct.value.toFixed(1)}% vs. ${targetLabel}) — driven mostly by ${names}. Fixed costs ($${Math.round(fixedOpexTotal.value).toLocaleString()}, ${fixedOpexPct.value.toFixed(1)}% of revenue) are excluded from this benchmark since they aren't controllable month to month.`
})

// ---- Revenue calendar -----------------------------------------------------
// Every day in the period compared against the selected period's own
// comparison basis (same weekday last week / same weekday-position last
// month / same weekday-position last year — see revenueComparisonDate in
// pl.get.ts, matching the Dashboard's "not a fixed day-count offset" design)
// — applies the Dashboard's single-day comparison to every day in the
// selected period, laid out as a real calendar instead of a ranked list, so
// a reader can see spatially whether a shortfall is concentrated (e.g.
// every Monday) or spread evenly across the period — the exact question the
// old ranked-list-of-shortfalls view could only answer by reading dates one
// at a time.
const revenueDaysMap = computed(() => new Map((data.value?.drilldowns[drilldownPeriod.value]?.revenueDays ?? []).map(d => [d.date, d])))
type DayStatus = 'good' | 'neutral' | 'bad' | 'critical' | 'no-data' | 'future'
type DayCell = { date: string, day: number, status: DayStatus, deltaPct: number | null, actual: number | null, comparison: number | null }
// A day within ±5% of its comparison day reads as "normal fluctuation," not
// a signal — below that, red; above, green. -18.75% mirrors the same
// "critical" cutoff the old ranked list used, so a truly bad day still
// stands out from a merely-soft one.
function dayStatus(dateStr: string): DayCell {
  const asOf = data.value?.asOfDate
  if (!asOf || dateStr > asOf) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'future', deltaPct: null, actual: null, comparison: null }
  const entry = revenueDaysMap.value.get(dateStr)
  // A $0 comparison day (e.g. a Monday closure where both this week's and
  // last week's revenue summed to exactly $0) can't support a percentage —
  // dividing by zero produced a literal "NaN%" in the UI before this check.
  // Treated the same as no data at all, matching how most closed days
  // already render (no daily_line_items rows posted, so there's no entry
  // here in the first place) — either way there's nothing meaningful to
  // compare.
  if (!entry || entry.comparison === 0) return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status: 'no-data', deltaPct: null, actual: null, comparison: null }
  const deltaPct = ((entry.actual - entry.comparison) / entry.comparison) * 100
  const status: DayStatus = deltaPct <= -18.75 ? 'critical' : deltaPct <= -5 ? 'bad' : deltaPct >= 5 ? 'good' : 'neutral'
  return { date: dateStr, day: parseIsoDate(dateStr).getUTCDate(), status, deltaPct, actual: entry.actual, comparison: entry.comparison }
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
  | { kind: 'week', cells: DayCell[] }
  | { kind: 'month', grid: ReturnType<typeof buildMonthGrid> }
  | { kind: 'year', months: ReturnType<typeof buildMonthGrid>[] }
const calendarView = computed<CalendarView | null>(() => {
  if (!data.value?.asOfDate) return null
  const period = drilldownPeriod.value
  const p = data.value.periods[period]
  if (!p) return null
  if (period === 'week') {
    const cells: DayCell[] = []
    for (let cur = p.start; cur <= p.end; cur = addDaysIso(cur, 1)) cells.push(dayStatus(cur))
    return { kind: 'week', cells }
  }
  if (period === 'month') {
    return { kind: 'month', grid: buildMonthGrid(data.value.asOfYear, data.value.asOfMonth) }
  }
  return { kind: 'year', months: Array.from({ length: 12 }, (_, i) => buildMonthGrid(data.value!.asOfYear, i + 1)) }
})

const revenueDays = computed(() => data.value?.drilldowns[drilldownPeriod.value]?.revenueDays ?? [])
const shortfallDays = computed(() => revenueDays.value.filter(d => d.actual < d.comparison))
const revenueFlagged = computed(() => shortfallDays.value.length > 0)
const revenueGapTotal = computed(() => shortfallDays.value.reduce((sum, d) => sum + (d.comparison - d.actual), 0))
// Comparison basis matches the selected period (Week -> same weekday last
// week, Month/Year -> same weekday-position last month/year) — see
// revenueComparisonDate/REVENUE_COMPARISON_LABEL in pl.get.ts, the single
// source of truth for both the calculation and this wording so they can't
// drift apart.
const revenueComparisonLabel = computed(() => data.value?.drilldowns[drilldownPeriod.value]?.revenueComparisonLabel ?? 'the same weekday last week')
const revenueComparisonShortLabel = computed(() => data.value?.drilldowns[drilldownPeriod.value]?.revenueComparisonShortLabel ?? 'last week')
const revenueCallout = computed(() => {
  const total = revenueDays.value.length
  const met = total - shortfallDays.value.length
  if (!total || !revenueFlagged.value) return ''
  return `${met} of ${total} days this ${PERIOD_LABEL[drilldownPeriod.value]} met or beat their comparison to ${revenueComparisonLabel.value}. The shortfall is concentrated in ${shortfallDays.value.length} day${shortfallDays.value.length === 1 ? '' : 's'} below — combined, they account for $${Math.round(revenueGapTotal.value).toLocaleString()} of the gap.`
})
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading drill-downs…</div>
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
        :description="`What's driving Labor, Operating Cost, and Revenue · reporting through last night's close (${formatWeekdayDate(data.asOfDate)})`"
        :as-of-label="formatWeekdayDate(data.asOfDate)"
        @synced="refresh()"
      />

      <!-- Shared period toggle for all three drill-down sections below —
           one control, not three, so it reads as "change the period for
           these drill-downs" rather than three independently-scoped
           toggles that happen to look identical. -->
      <div class="drilldown-toggle-bar">
        <div class="drilldown-toggle-label">
          Drill-Down Period
          <span class="drilldown-toggle-hint">Applies to Labor, Operating Cost, and Revenue below</span>
        </div>
        <div class="period-tabs">
          <span :class="['period-tab', drilldownPeriod === 'week' && 'active']" @click="drilldownPeriod = 'week'">Week</span>
          <span :class="['period-tab', drilldownPeriod === 'month' && 'active']" @click="drilldownPeriod = 'month'">Month</span>
          <span :class="['period-tab', drilldownPeriod === 'year' && 'active']" @click="drilldownPeriod = 'year'">Year</span>
        </div>
      </div>

      <div class="drilldown-group">
        <!-- Drill-down: what's driving labor cost (month/year), or a direct
             wages-vs-last-week comparison (week) -->
        <section>
          <div class="section-head">
            <div class="section-label">{{ isWeeklyWagesView ? 'Wages Drill-Down — This Week vs. Last Week' : "Labor Drill-Down — What's Driving the Cost" }}</div>
          </div>

          <template v-if="isWeeklyWagesView">
            <div class="drill-card">
              <div class="callout">{{ weeklyWagesCallout }}</div>
              <div class="anomaly-grid">
                <div v-for="row in weeklyWageTiles" :key="row.label" :class="['anomaly-tile', row.direction]">
                  <div class="label">{{ row.label }}</div>
                  <span :class="['delta-chip', row.direction]">{{ row.deltaText }}</span>
                  <div class="amount-caption">Total this {{ drilldownPeriod }}</div>
                  <div class="amount">${{ Math.round(row.amount).toLocaleString() }}</div>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <div v-if="laborCardExpanded" class="drill-card">
              <div class="callout">{{ laborCallout }}</div>
              <div class="anomaly-grid">
                <div v-for="row in laborRows" :key="row.label" :class="['anomaly-tile', row.direction]">
                  <div class="label">{{ row.label }}</div>
                  <span :class="['delta-chip', row.direction]">{{ row.deltaText }}</span>
                  <div class="amount-caption">Total this {{ drilldownPeriod }}</div>
                  <div class="amount">${{ Math.round(row.amount).toLocaleString() }}</div>
                </div>
              </div>
            </div>
            <div v-else-if="laborRowsAll.length" class="drill-card quiet">
              <span class="chip good">Nothing unusual</span>
              <span class="quiet-note">Labor is within target this {{ drilldownPeriod }}, and no single cost driver stands out.</span>
            </div>
            <div v-else class="drill-card quiet">
              <span class="chip warning">No data</span>
              <span class="quiet-note">No labor data synced for this {{ drilldownPeriod }} yet.</span>
            </div>
          </template>
        </section>

        <!-- Drill-down: what's driving opex (hidden for week — see
             isWeeklyWagesView above) -->
        <section v-if="!isWeeklyWagesView">
          <div class="section-head">
            <div class="section-label">Operating Cost Drill-Down — What's Driving the Cost</div>
          </div>

          <div v-if="opexCardExpanded && (fixedOpexRowsAll.length || variableOpexRowsAll.length)" class="drill-card">
            <div class="callout">{{ opexCallout }}</div>
            <div class="rank-list">
              <template v-if="fixedOpexRows.length">
                <div class="rank-group-head">
                  <span class="rank-group-label">Fixed<span class="rank-group-note">not benchmarked</span></span>
                  <span class="rank-group-total">${{ Math.round(fixedOpexTotal).toLocaleString() }} &middot; {{ fixedOpexPct.toFixed(1) }}% of rev.</span>
                </div>
                <div class="anomaly-grid">
                  <div v-for="row in fixedOpexRows" :key="row.label" :class="['anomaly-tile', row.direction]">
                    <div class="label">{{ row.label }}</div>
                    <span :class="['delta-chip', row.direction]">{{ row.deltaText }}</span>
                    <div class="amount-caption">Total this {{ drilldownPeriod }}</div>
                    <div class="amount">${{ Math.round(row.amount).toLocaleString() }}</div>
                  </div>
                </div>
              </template>

              <template v-if="variableOpexRows.length">
                <div class="rank-group-head">
                  <span class="rank-group-label">Variable / discretionary</span>
                  <span class="rank-group-total">
                    ${{ Math.round(variableOpexTotal).toLocaleString() }} &middot; {{ variableOpexPct.toFixed(1) }}% of rev.
                    <span v-if="variableOpexStatus" :class="['chip', variableOpexOffTarget ? 'serious' : 'good']">{{ variableOpexOffTarget ? 'Off target' : 'On target' }}</span>
                  </span>
                </div>
                <div class="anomaly-grid">
                  <div v-for="row in variableOpexRows" :key="row.label" :class="['anomaly-tile', row.direction]">
                    <div class="label">{{ row.label }}</div>
                    <span :class="['delta-chip', row.direction]">{{ row.deltaText }}</span>
                    <div class="amount-caption">Total this {{ drilldownPeriod }}</div>
                    <div class="amount">${{ Math.round(row.amount).toLocaleString() }}</div>
                  </div>
                </div>
              </template>
            </div>
          </div>
          <div v-else-if="fixedOpexRowsAll.length || variableOpexRowsAll.length" class="drill-card quiet">
            <span class="chip good">Nothing unusual</span>
            <span class="quiet-note">Variable/discretionary opex is within target this {{ drilldownPeriod }}, and no single cost driver stands out.</span>
          </div>
          <div v-else class="drill-card quiet">
            <span class="chip warning">No data</span>
            <span class="quiet-note">No operating expense data synced for this {{ drilldownPeriod }} yet.</span>
          </div>
        </section>

        <!-- Drill-down: revenue calendar -->
        <section>
          <div class="section-head">
            <div class="section-label">Revenue Calendar — Where It Fell Short</div>
            <div class="section-note">Percentage is the change vs. {{ revenueComparisonLabel }}; the dollar figure below it is that day's actual revenue, not the size of the change.</div>
          </div>

          <div v-if="calendarView" class="drill-card">
            <div v-if="revenueFlagged" class="callout">{{ revenueCallout }}</div>
            <div v-else class="quiet-inline"><span class="chip good">Nothing unusual</span><span class="quiet-note">All days this {{ drilldownPeriod }} met or beat their comparison to {{ revenueComparisonLabel }}.</span></div>

            <template v-if="calendarView.kind === 'week'">
              <div class="calendar-grid week">
                <div v-for="cell in calendarView.cells" :key="cell.date" :class="['calendar-cell', cell.status]">
                  <div class="day-num">{{ formatWeekdayDate(cell.date) }}</div>
                  <template v-if="cell.actual !== null">
                    <span class="cell-delta">{{ (cell.deltaPct ?? 0) >= 0 ? '▲' : '▼' }} {{ Math.abs(cell.deltaPct ?? 0).toFixed(0) }}%</span>
                    <div class="cell-amount">${{ Math.round(cell.actual).toLocaleString() }}</div>
                  </template>
                  <div v-else class="cell-empty-note">{{ cell.status === 'future' ? 'Upcoming' : 'No data' }}</div>
                </div>
              </div>
            </template>

            <template v-else-if="calendarView.kind === 'month'">
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
                    <div v-for="(cell, idx) in m.cells" :key="idx" :class="['calendar-cell', 'mini', cell ? cell.status : 'blank']"></div>
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
            <span class="quiet-note">Not enough history yet to compare this {{ drilldownPeriod }} against {{ revenueComparisonLabel }}.</span>
          </div>
        </section>
      </div>

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

/* One shared toggle bar controlling all three drill-down sections below —
   the explicit "applies to" hint (plus matching the callout boxes' neutral
   gray, rather than the accent blue) makes the scope unambiguous without
   implying this is an interactive-highlight/accent element. */
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
.drilldown-toggle-hint {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-3);
  margin-top: 2px;
}
.drilldown-group section:first-child { margin-top: 0.75rem; }

/* ---------- ranked drill-down list ---------- */
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
.rank-list { display: flex; flex-direction: column; gap: 12px; }
.rank-group-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding-top: 6px;
  border-top: 1px solid var(--hair);
}
.rank-group-head:first-child { padding-top: 0; border-top: none; }
.rank-group-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}
.rank-group-label .rank-group-note {
  display: block;
  font-size: 10px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  margin-top: 2px;
}
.rank-group-total {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
/* Labor/opex drill-down anomalies: no bar. These lists are pre-filtered to
   only the subcategories that varied significantly, so there are usually
   just a handful of items — rendering each as its own compact tile in a
   wrapping grid lets 2-6 short items fill the available width side by side
   instead of stretching skinny full-width rows. */
.anomaly-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}
.anomaly-tile {
  background: var(--surface-alt);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
}
/* Full-tile tint — brighter than the app's standard "wash" tokens (~16%
   alpha) — per direct user feedback the full-color card reads better than
   a subtler wash or a left-edge stripe for their color vision. Still
   paired with the chip's own ▲/▼ icon — color is reinforcement, not the
   only signal. */
.anomaly-tile.up, .anomaly-tile.serious { background: color-mix(in srgb, var(--serious) 32%, var(--surface-alt)); }
.anomaly-tile.down, .anomaly-tile.good { background: color-mix(in srgb, var(--good) 32%, var(--surface-alt)); }
.anomaly-tile.critical { background: color-mix(in srgb, var(--critical) 38%, var(--surface-alt)); }
.anomaly-tile .label { font-size: 11.5px; font-weight: 600; line-height: 1.3; color: var(--ink-2); }
.delta-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 100px;
  white-space: nowrap;
}
/* The variation is the whole point of a drill-down tile — direct user
   feedback that it should read as more prominent than the period's total
   spend below it, not the other way around. Sized up well past the label
   and total so it's the first thing the eye lands on; the total keeps its
   own small caption (see amount-caption below) so it's still unambiguous,
   just no longer competing for attention. */
.anomaly-tile .delta-chip { font-size: 15px; font-weight: 800; padding: 4px 12px; }
/* Distinguishes the now-secondary total below from the delta chip above
   it — without this, a reader can plausibly misread the dollar figure as
   the size of the change the chip describes, rather than the period's
   full total. */
.anomaly-tile .amount-caption { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-3); margin-top: 2px; margin-bottom: -3px; }
.anomaly-tile .amount { font-size: 12px; font-weight: 600; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.delta-chip.up, .delta-chip.serious { color: var(--serious); background: var(--serious-wash); }
.delta-chip.down, .delta-chip.good { color: var(--good); background: var(--good-wash); }
.delta-chip.critical { color: var(--critical); background: var(--critical-wash); }
/* Once the tile itself is tinted, a same-hue pill nearly disappears into it
   — give the chip a solid neutral pill so it stays a distinct, legible
   badge on top of the more saturated tile background. */
.anomaly-tile .delta-chip { background: var(--surface); }

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
.calendar-grid.week { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
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
.calendar-cell.no-data { opacity: 0.45; }
.calendar-cell.future { opacity: 0.3; background: transparent; border: 1px dashed var(--hair); }
.calendar-cell .day-num { font-size: 11px; font-weight: 700; color: var(--ink-3); }
.calendar-cell .cell-delta { font-size: 10.5px; font-weight: 800; }
.calendar-cell .cell-amount { font-size: 11px; font-weight: 700; margin-top: auto; font-variant-numeric: tabular-nums; }
.calendar-cell .cell-empty-note { font-size: 10px; color: var(--ink-3); margin-top: auto; }
/* Same full-tile-tint language as the anomaly tiles above — good/bad/critical
   colors reinforce the ▲/▼ + % already in the cell, neutral days (within
   ±5% of last week) stay the plain surface color rather than getting a
   third arbitrary hue, since "normal fluctuation" isn't a signal to chase. */
.calendar-cell.good { background: color-mix(in srgb, var(--good) 32%, var(--surface-alt)); }
.calendar-cell.bad { background: color-mix(in srgb, var(--serious) 32%, var(--surface-alt)); }
.calendar-cell.critical { background: color-mix(in srgb, var(--critical) 38%, var(--surface-alt)); }
.calendar-cell.good .cell-delta,
.calendar-cell.good .day-num { color: var(--good); }
.calendar-cell.bad .cell-delta,
.calendar-cell.bad .day-num { color: var(--serious); }
.calendar-cell.critical .cell-delta,
.calendar-cell.critical .day-num { color: var(--critical); }

.year-calendar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 18px;
}
.mini-month-label { font-size: 11px; font-weight: 700; color: var(--ink-3); margin-bottom: 6px; }
.calendar-grid.mini { gap: 3px; }
.calendar-cell.mini { min-height: 0; padding: 0; aspect-ratio: 1; border-radius: 4px; }

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
.legend-chip.bad { color: var(--serious); background: color-mix(in srgb, var(--serious) 32%, var(--surface-alt)); }
.legend-chip.critical { color: var(--critical); background: color-mix(in srgb, var(--critical) 38%, var(--surface-alt)); }
</style>
