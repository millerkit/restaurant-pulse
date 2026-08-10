<script setup lang="ts">
// Weekly historical seasonality overlay — added 2026-08-10 alongside Edit
// Capacity's "Set by History" button, so the number that button computes
// isn't a black box: this shows the same underlying weekly index (per-
// open-day core dine-in revenue, indexed to each year's own average) that
// feeds it, with the current year plotted against last year's shape. See
// server/api/capacity/history.get.ts for how the index itself is derived.
//
// Simplified back to a single raw weekly line, same day, after two other
// attempts: a monthly-grain view (dropped — user wasn't sold on it) and a
// 5-week centered moving average (dropped — the user caught a real,
// structural problem with it: at the live edge of a still-accumulating
// series there's no future data to center against, so the smoothed value
// silently becomes a backward-only average biased toward whatever came
// *before* a real recent move — exactly the worst moment for a dashboard
// to be quietly optimistic. Raw weekly reads honestly at "right now," even
// if it's noisier elsewhere, which is what actually matters here.
//
// Two follow-up legibility fixes, same day: (1) curved (Catmull-Rom)
// line interpolation instead of straight segments between points — purely
// a rendering choice, the data itself is untouched, each real point still
// sits at its exact position; and (2) a fixed y-domain (65-145%) instead
// of one auto-padded around whatever the current data's own min/max
// happens to be, at the user's request, matching the real data's own
// range almost exactly (verified against production: 62.7-145.3%).
//
// Categorical (not ordinal) color pair now that this is just "this year vs
// last year," not a multi-year recency ramp — current year gets the app's
// own --accent blue (dataviz categorical slot 1), the prior year gets slot
// 2's orange, both validated via dataviz's validate_palette.js
// (categorical, 2 slots): worst-pair ΔE 24.7/26.8 (CVD) and 33.6/31.8
// (normal vision) in light/dark respectively — comfortably past the >=8
// target, not just the floor.
type WeekPoint = { year: number, isoWeek: number, start: string, end: string, indexPct: number, openDays: number }
const props = defineProps<{ weeklySeries: WeekPoint[], historicalYears: number[], currentYear: number | null }>()

function fmtShort(s: string): string {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const years = computed(() => {
  const ys = [...props.historicalYears]
  if (props.currentYear != null && !ys.includes(props.currentYear)) ys.push(props.currentYear)
  return ys.sort((a, b) => a - b)
})
function colorRoleFor(year: number): 'current' | 'prior' {
  return year === props.currentYear ? 'current' : 'prior'
}

type NormPoint = { year: number, x: number, indexPct: number, label: string, openDays: number }
const points = computed<NormPoint[]>(() =>
  props.weeklySeries.map(p => ({ year: p.year, x: p.isoWeek, indexPct: p.indexPct, label: `${fmtShort(p.start)}–${fmtShort(p.end)}`, openDays: p.openDays }))
)
const seriesByYear = computed(() => {
  const map = new Map<number, NormPoint[]>()
  for (const y of years.value) {
    map.set(y, points.value.filter(p => p.year === y).sort((a, b) => a.x - b.x))
  }
  return map
})

const xDomainMax = computed(() => Math.max(52, ...props.weeklySeries.map(w => w.isoWeek)))
// Fixed, not auto-padded around whatever the current data's own min/max
// happens to be — see header comment. Points outside this range (rare,
// not seen in real data so far) still plot, just clipped visually rather
// than expanding the axis and re-compressing everything else.
const Y_MIN = 65, Y_MAX = 145

const W = 900, H = 320
const margin = { top: 14, right: 16, bottom: 28, left: 44 }
const plotW = W - margin.left - margin.right
const plotH = H - margin.top - margin.bottom

function xFor(x: number): number {
  return margin.left + ((x - 1) / (xDomainMax.value - 1)) * plotW
}
function yFor(pct: number): number {
  return margin.top + (1 - (pct - Y_MIN) / (Y_MAX - Y_MIN)) * plotH
}
// Catmull-Rom-to-cubic-Bezier conversion (uniform, tension 1/6) — smooths
// the line into a curve through the real data points (each point's exact
// x/y is unchanged; only how the line travels *between* points changes)
// rather than straight jagged segments. Points are first split into
// contiguous runs wherever a week is missing (a real gap — e.g. 2026's
// location-move closure) so a run never curves across data that doesn't
// exist; each run gets its own 'M' (a fresh subpath), same visual break
// as before.
function curvedPath(pts: { x: number, y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}
function pathFor(pts: NormPoint[]): string {
  const runs: NormPoint[][] = []
  let current: NormPoint[] = []
  pts.forEach((p, i) => {
    const prev = pts[i - 1]
    if (i === 0 || p.x - prev.x > 1) {
      if (current.length) runs.push(current)
      current = [p]
    } else {
      current.push(p)
    }
  })
  if (current.length) runs.push(current)
  return runs.map(run => curvedPath(run.map(p => ({ x: xFor(p.x), y: yFor(p.indexPct) })))).join(' ')
}
const yTicks = computed(() => {
  const ticks: number[] = []
  for (let v = Math.ceil(Y_MIN / 20) * 20; v <= Y_MAX; v += 20) ticks.push(v)
  return ticks
})
// Approximate month-start tick positions by ISO week — a reference chart,
// not a precise calendar axis, so "week ~5 is roughly February" is close
// enough for orientation.
const monthTicks = [
  { label: 'Jan', week: 1 }, { label: 'Feb', week: 5 }, { label: 'Mar', week: 9 },
  { label: 'Apr', week: 14 }, { label: 'May', week: 18 }, { label: 'Jun', week: 22 },
  { label: 'Jul', week: 27 }, { label: 'Aug', week: 31 }, { label: 'Sep', week: 35 },
  { label: 'Oct', week: 40 }, { label: 'Nov', week: 44 }, { label: 'Dec', week: 48 }
]

// ---- Hover / crosshair --------------------------------------------------
const svgEl = ref<SVGSVGElement | null>(null)
const hoverWeek = ref<number | null>(null)
const tooltipStyle = ref({ left: '0px', top: '0px' })

function onMove(e: MouseEvent) {
  const svg = svgEl.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const svgX = ((e.clientX - rect.left) / rect.width) * W
  const week = Math.round(1 + ((svgX - margin.left) / plotW) * (xDomainMax.value - 1))
  hoverWeek.value = Math.min(xDomainMax.value, Math.max(1, week))
  const px = ((e.clientX - rect.left) / rect.width) * 100
  tooltipStyle.value = {
    left: `${Math.min(88, Math.max(2, px))}%`,
    top: '8px'
  }
}
function onLeave() { hoverWeek.value = null }

const hoverRows = computed(() => {
  if (hoverWeek.value == null) return []
  const rows: { year: number, point: NormPoint | null }[] = []
  for (const y of years.value) {
    const point = (seriesByYear.value.get(y) ?? []).find(p => p.x === hoverWeek.value) ?? null
    rows.push({ year: y, point })
  }
  return rows.filter(r => r.point != null).reverse() // most recent year first
})
const hoverHeading = computed(() => hoverRows.value[0]?.point?.label ?? '')

const showTable = ref(false)
</script>

<template>
  <div class="seasonality-chart">
    <div class="chart-legend">
      <span v-for="y in years" :key="y" class="legend-item">
        <span class="legend-swatch" :class="colorRoleFor(y)"></span>
        {{ y }}{{ y === currentYear ? ' (to date)' : '' }}
      </span>
      <span class="legend-item ref-line"><span class="legend-swatch ref"></span>Year average (100%)</span>
      <button type="button" class="table-toggle" @click="showTable = !showTable">{{ showTable ? 'Show chart' : 'Show as table' }}</button>
    </div>

    <div v-if="!showTable" class="chart-wrap">
      <svg
        ref="svgEl"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Weekly per-open-day core revenue, indexed to each year's own average, by year"
        @mousemove="onMove"
        @mouseleave="onLeave"
      >
        <!-- gridlines + y-axis labels -->
        <g v-for="t in yTicks" :key="t">
          <line :x1="margin.left" :x2="W - margin.right" :y1="yFor(t)" :y2="yFor(t)" class="gridline" />
          <text :x="margin.left - 8" :y="yFor(t) + 4" class="axis-label y-label">{{ t }}%</text>
        </g>
        <!-- 100% reference line -->
        <line :x1="margin.left" :x2="W - margin.right" :y1="yFor(100)" :y2="yFor(100)" class="ref-line-mark" />

        <!-- month ticks -->
        <g v-for="m in monthTicks" :key="m.label">
          <text :x="xFor(m.week)" :y="H - margin.bottom + 16" class="axis-label x-label">{{ m.label }}</text>
        </g>

        <!-- crosshair -->
        <line v-if="hoverWeek" :x1="xFor(hoverWeek)" :x2="xFor(hoverWeek)" :y1="margin.top" :y2="H - margin.bottom" class="crosshair" />

        <!-- lines -->
        <path
          v-for="y in years" :key="y"
          :d="pathFor(seriesByYear.get(y) ?? [])"
          fill="none"
          class="series-line"
          :class="[colorRoleFor(y), { current: y === currentYear }]"
        />

        <!-- hover dots -->
        <template v-for="row in hoverRows" :key="row.year">
          <circle v-if="row.point" :cx="xFor(row.point.x)" :cy="yFor(row.point.indexPct)" r="4" class="hover-dot" :class="colorRoleFor(row.year)" />
        </template>
      </svg>

      <div v-if="hoverRows.length > 0" class="tooltip" :style="tooltipStyle">
        <div class="tooltip-date">{{ hoverHeading }}</div>
        <div v-for="row in hoverRows" :key="row.year" class="tooltip-row">
          <span class="tooltip-key" :class="colorRoleFor(row.year)"></span>
          <span class="tooltip-year">{{ row.year }}</span>
          <span class="tooltip-value">{{ row.point?.indexPct.toFixed(0) }}%</span>
        </div>
      </div>
    </div>

    <div v-else class="pl-table-card table-view">
      <table class="pl-table">
        <caption>Weekly per-open-day core revenue index by year</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th v-for="y in years" :key="y" scope="col">{{ y }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="wk in xDomainMax" :key="wk">
            <th scope="row">Wk {{ wk }}</th>
            <td v-for="y in years" :key="y">
              {{ (seriesByYear.get(y) ?? []).find(p => p.x === wk)?.indexPct.toFixed(0) ?? '—' }}<template v-if="(seriesByYear.get(y) ?? []).find(p => p.x === wk)">%</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* Categorical pair (dataviz slots 1/2) — see header comment for
   validation numbers. "current" reuses the app's own --accent so this
   chart's focal line matches the rest of the app's accent color; "prior"
   is dataviz's slot-2 orange, chosen for maximum contrast against it
   rather than a subtler recency-ramp shade. */
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
.legend-swatch.prior { background: var(--yr-prior); }
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
.crosshair { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 3 3; }
.series-line { stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.series-line.current { stroke: var(--yr-current); stroke-width: 2.75; }
.series-line.prior { stroke: var(--yr-prior); }
.hover-dot { stroke: var(--surface); stroke-width: 2; }
.hover-dot.current { fill: var(--yr-current); }
.hover-dot.prior { fill: var(--yr-prior); }

.tooltip {
  position: absolute;
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
