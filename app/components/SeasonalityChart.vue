<script setup lang="ts">
// Historical seasonality reference — added 2026-08-10 alongside Edit
// Capacity's "Set by History" button, so the number that button computes
// isn't a black box: this shows the same underlying index that feeds it,
// with the current year plotted against last year's. Generalized
// 2026-08-12 to render either of the Historical page's two indexes (covers,
// or spend-per-cover) via the `metricLabel`/`ariaLabel` props — same
// mechanics either way, only the data and labels differ. See
// server/api/capacity/history.get.ts for how the indexes are derived.
//
// Rebuilt as a monthly grouped bar chart, same day, after two earlier line-
// chart attempts: raw weekly (too noisy — this restaurant's only open
// ~5-6 nights/week, so week-to-week swings are mostly sampling noise, not
// seasonal signal) and a 5-week centered moving average (dropped — it
// masked a real recent trough at the live edge of the series, since a
// centered average has no future data to average against right at "now").
// The user's own read: much of the week-to-week noise may just be
// unavoidable at this sample size, and averaging in *more* years to smooth
// it further "seems like too much effort" for what it'd buy — a monthly
// grain (20+ open days per bar) is steadier by construction, without the
// live-edge bias a moving average has.
//
// Categorical color pair (dataviz slots 1/2), not an ordinal ramp — this
// is "this year vs. last year," two concrete entities, not a multi-year
// recency series. Current year reuses the app's own --accent blue; prior
// year is slot 2's orange, faded to 50% opacity at the user's explicit
// request so it reads as background context rather than competing with
// the current year. Validated via validate_palette.js (categorical, 2
// slots): worst-pair ΔE 24.7/26.8 (CVD), 33.6/31.8 (normal vision) in
// light/dark — comfortably past the >=8 target before the fade is applied.
//
// Bars start at zero (unlike the old line chart's truncated y-axis) — bar
// *length* encodes magnitude, so truncating would misrepresent it the way
// truncating a line chart's position axis doesn't. Per dataviz's mark
// spec: <=24px thick, 4px rounded top corners only (square at the
// baseline), a 2px surface gap between the two bars in a group. Hover is
// per-month-group (the bars are the hit target, not a crosshair — this
// isn't a continuous series), showing both years side by side in one
// tooltip since the whole point of this chart is that comparison.
type MonthPoint = { year: number, month: number, indexPct: number, openDays: number }
const props = defineProps<{
  monthlySeries: MonthPoint[]
  historicalYears: number[]
  currentYear: number | null
  // e.g. "Covers" / "Avg Spend/Cover" — short label used in the table caption
  metricLabel: string
  // full sentence used as the chart's aria-label
  ariaLabel: string
  // Pre-formatted "what 100% actually is" labels (e.g. "62/night",
  // "$118/cover") — added 2026-08-12 so the "Year average (100%)"
  // reference line isn't just an abstract ratio. Framed by location
  // (Mass Ave / Cambridge St), not by calendar year, per the user's own
  // request — see history.get.ts's locationBaselines for why. Null hides
  // the parenthetical entirely (e.g. once this pairing stops applying next
  // year — see that same comment).
  massAveBaselineLabel?: string | null
  cambridgeStBaselineLabel?: string | null
}>()

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const years = computed(() => {
  const ys = [...props.historicalYears]
  if (props.currentYear != null && !ys.includes(props.currentYear)) ys.push(props.currentYear)
  return ys.sort((a, b) => a - b)
})
function colorRoleFor(year: number): 'current' | 'prior' {
  return year === props.currentYear ? 'current' : 'prior'
}

// month (1-12) -> year -> value, for quick lookup while drawing bars.
const byMonth = computed(() => {
  const map = new Map<number, Map<number, MonthPoint>>()
  for (const p of props.monthlySeries) {
    if (!map.has(p.month)) map.set(p.month, new Map())
    map.get(p.month)!.set(p.year, p)
  }
  return map
})

const Y_MIN = 0
const yMax = computed(() => {
  const max = Math.max(0, ...props.monthlySeries.map(p => p.indexPct))
  return Math.max(120, Math.ceil((max + 10) / 20) * 20)
})
const yTickStep = computed(() => (yMax.value <= 120 ? 20 : 40))
const yTicks = computed(() => {
  const ticks: number[] = []
  for (let v = 0; v <= yMax.value; v += yTickStep.value) ticks.push(v)
  return ticks
})

const W = 900, H = 320
const margin = { top: 14, right: 16, bottom: 28, left: 44 }
const plotW = W - margin.left - margin.right
const plotH = H - margin.top - margin.bottom
const bandW = plotW / 12
const BAR_W = Math.min(24, bandW * 0.34)
const BAR_GAP = 3 // surface gap between the two bars in a group

function yFor(pct: number): number {
  return margin.top + (1 - pct / yMax.value) * plotH
}
function groupCenterX(month: number): number {
  return margin.left + (month - 1) * bandW + bandW / 2
}
function barX(month: number, role: 'prior' | 'current'): number {
  const center = groupCenterX(month)
  return role === 'prior' ? center - BAR_GAP / 2 - BAR_W : center + BAR_GAP / 2
}
// Rounded-top, square-bottom bar as an explicit path (a plain rx/ry rect
// would round the baseline corners too, which reads as floating rather
// than grounded).
const BAR_RADIUS = 4
function barPath(x: number, month: number, value: number): string {
  const yTop = yFor(value)
  const yBase = yFor(0)
  const r = Math.min(BAR_RADIUS, (yBase - yTop) / 2, BAR_W / 2)
  if (r <= 0.5) return `M${x},${yBase} L${x},${yTop} L${x + BAR_W},${yTop} L${x + BAR_W},${yBase} Z`
  return [
    `M${x},${yBase}`,
    `L${x},${yTop + r}`,
    `Q${x},${yTop} ${x + r},${yTop}`,
    `L${x + BAR_W - r},${yTop}`,
    `Q${x + BAR_W},${yTop} ${x + BAR_W},${yTop + r}`,
    `L${x + BAR_W},${yBase}`,
    'Z'
  ].join(' ')
}

// ---- Hover ---------------------------------------------------------------
const hoveredMonth = ref<number | null>(null)
const tooltipStyle = computed(() => {
  if (hoveredMonth.value == null) return { left: '0%' }
  const px = ((groupCenterX(hoveredMonth.value) / W) * 100)
  return { left: `${Math.min(88, Math.max(2, px))}%` }
})
const hoverRows = computed(() => {
  if (hoveredMonth.value == null) return []
  const rows: { year: number, point: MonthPoint | null }[] = []
  for (const y of years.value) {
    rows.push({ year: y, point: byMonth.value.get(hoveredMonth.value)?.get(y) ?? null })
  }
  return rows.filter(r => r.point != null).reverse() // most recent year first
})

const showTable = ref(false)
</script>

<template>
  <div class="seasonality-chart">
    <div class="chart-legend">
      <span v-for="y in years" :key="y" class="legend-item">
        <span class="legend-swatch" :class="colorRoleFor(y)"></span>
        {{ y }}{{ y === currentYear ? ' (to date)' : '' }}<template v-if="colorRoleFor(y) === 'prior' && massAveBaselineLabel"> — Mass Ave avg {{ massAveBaselineLabel }}</template><template v-if="colorRoleFor(y) === 'current' && cambridgeStBaselineLabel"> — Cambridge St avg {{ cambridgeStBaselineLabel }}</template>
      </span>
      <span class="legend-item ref-line"><span class="legend-swatch ref"></span>Year average (100%)</span>
      <button type="button" class="table-toggle" @click="showTable = !showTable">{{ showTable ? 'Show chart' : 'Show as table' }}</button>
    </div>

    <div v-if="!showTable" class="chart-wrap">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        :aria-label="ariaLabel"
      >
        <!-- gridlines + y-axis labels -->
        <g v-for="t in yTicks" :key="t">
          <line :x1="margin.left" :x2="W - margin.right" :y1="yFor(t)" :y2="yFor(t)" class="gridline" />
          <text :x="margin.left - 8" :y="yFor(t) + 4" class="axis-label y-label">{{ t }}%</text>
        </g>
        <!-- 100% reference line -->
        <line :x1="margin.left" :x2="W - margin.right" :y1="yFor(100)" :y2="yFor(100)" class="ref-line-mark" />

        <!-- bars + hover hit-areas, one group per month -->
        <g v-for="month in 12" :key="month">
          <path
            v-if="byMonth.get(month)?.get(historicalYears[0])"
            :d="barPath(barX(month, 'prior'), month, byMonth.get(month)!.get(historicalYears[0])!.indexPct)"
            class="bar prior"
            :class="{ hovered: hoveredMonth === month }"
          />
          <path
            v-if="currentYear != null && byMonth.get(month)?.get(currentYear)"
            :d="barPath(barX(month, 'current'), month, byMonth.get(month)!.get(currentYear)!.indexPct)"
            class="bar current"
            :class="{ hovered: hoveredMonth === month }"
          />
          <!-- invisible hit area spanning the whole month band -->
          <rect
            :x="margin.left + (month - 1) * bandW"
            :y="margin.top"
            :width="bandW"
            :height="plotH"
            fill="transparent"
            @mouseenter="hoveredMonth = month"
            @mouseleave="hoveredMonth = null"
          />
        </g>

        <!-- month axis labels -->
        <g v-for="month in 12" :key="`label-${month}`">
          <text :x="groupCenterX(month)" :y="H - margin.bottom + 16" class="axis-label x-label">{{ MONTH_ABBR[month - 1] }}</text>
        </g>
      </svg>

      <div v-if="hoverRows.length > 0" class="tooltip" :style="tooltipStyle">
        <div class="tooltip-date">{{ MONTH_FULL[(hoveredMonth as number) - 1] }}</div>
        <div v-for="row in hoverRows" :key="row.year" class="tooltip-row">
          <span class="tooltip-key" :class="colorRoleFor(row.year)"></span>
          <span class="tooltip-year">{{ row.year }}</span>
          <span class="tooltip-value">{{ row.point?.indexPct.toFixed(0) }}%</span>
        </div>
      </div>
    </div>

    <div v-else class="pl-table-card table-view">
      <table class="pl-table">
        <caption>Monthly {{ metricLabel }} index by year</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th v-for="y in years" :key="y" scope="col">{{ y }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="month in 12" :key="month">
            <th scope="row">{{ MONTH_ABBR[month - 1] }}</th>
            <td v-for="y in years" :key="y">
              {{ byMonth.get(month)?.get(y)?.indexPct.toFixed(0) ?? '—' }}<template v-if="byMonth.get(month)?.get(y)">%</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* Categorical pair — see header comment for validation numbers. "current"
   reuses the app's own --accent; "prior" is dataviz's slot-2 orange,
   faded to recede into the background per the user's request. */
.seasonality-chart {
  --yr-current: var(--accent);
  --yr-prior: #eb6834;
}
@media (prefers-color-scheme: dark) {
  .seasonality-chart {
    --yr-prior: #d95926;
  }
}
.seasonality-chart { display: flex; flex-direction: column; gap: 10px; }
.chart-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; font-size: 12px; color: var(--ink-2); }
.legend-item { display: flex; align-items: center; gap: 5px; }
.legend-swatch { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
.legend-swatch.current { background: var(--yr-current); }
.legend-swatch.prior { background: var(--yr-prior); opacity: 0.5; }
.legend-swatch.ref { background: none; border-top: 2px dashed var(--ink-3); }
.table-toggle {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--hair);
  background: var(--surface-alt);
  color: var(--ink-2);
  cursor: pointer;
}
.table-toggle:hover { background: var(--accent); color: white; border-color: var(--accent); }

.chart-wrap { position: relative; }
svg { width: 100%; height: auto; display: block; }
.gridline { stroke: var(--hair); stroke-width: 1; }
.ref-line-mark { stroke: var(--ink-3); stroke-width: 1.5; stroke-dasharray: 4 3; }
.axis-label { font-size: 10px; fill: var(--ink-3); font-variant-numeric: tabular-nums; }
.y-label { text-anchor: end; }
.x-label { text-anchor: middle; }

.bar { transition: opacity 0.1s; }
.bar.current { fill: var(--yr-current); }
.bar.prior { fill: var(--yr-prior); opacity: 0.5; }
.bar.hovered { opacity: 0.8; }
.bar.prior.hovered { opacity: 0.7; }

.tooltip {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 10px;
  box-shadow: var(--card-shadow);
  padding: 8px 10px;
  font-size: 11.5px;
  pointer-events: none;
  min-width: 110px;
  z-index: 2;
}
.tooltip-date { font-weight: 700; color: var(--ink); margin-bottom: 4px; font-size: 11px; }
.tooltip-row { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
.tooltip-key { width: 10px; height: 2px; border-radius: 2px; display: inline-block; }
.tooltip-key.current { background: var(--yr-current); }
.tooltip-key.prior { background: var(--yr-prior); }
.tooltip-year { color: var(--ink-3); flex: 1; }
.tooltip-value { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }

.table-view { max-height: 360px; overflow-y: auto; }
.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
}
table.pl-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 400px; }
.pl-table caption { display: none; }
.pl-table th, .pl-table td { padding: 6px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-table th:first-child, .pl-table td:first-child { text-align: left; }
.pl-table thead th { font-size: 11px; font-weight: 700; color: var(--ink-3); border-bottom: 1px solid var(--hair); position: sticky; top: 0; background: var(--surface); }
.pl-table tbody th { text-align: left; font-weight: 600; color: var(--ink); }
.pl-table tbody tr { border-bottom: 1px solid var(--hair); }
</style>
