<script setup lang="ts">
// Weekly kitchen-labor % of food revenue as a single line, drawn once for total
// labor (the app's --accent) and once for overtime alone (dataviz's slot-2
// orange) on its own chart, because overtime runs at a few percent and would
// be flattened on labor's axis. One series per chart, so no legend box (the
// section title names it). Weeks still awaiting payroll have no value: the line breaks
// there rather than dropping to zero or bridging across. The y-axis is not
// anchored at zero (position, not length, encodes the value on a line chart)
// and is fitted to the data in 5-point steps. Hover shows a crosshair and one
// tooltip; the page's Table view is the accessible alternative.
type Point = {
  weekStart: string
  weekEnd: string
  // 0-1 fraction, or null when the week has no payroll yet
  pct: number | null
  labor: number
  // overtime alone as a 0-1 fraction of food revenue, null with the same weeks as pct
  otPct: number | null
  overtime: number
  revenue: number
}
const props = defineProps<{ points: Point[], label: string, metric?: 'labor' | 'overtime' }>()
const isOt = computed(() => props.metric === 'overtime')
const pickPct = (p: Point) => (isOt.value ? p.otPct : p.pct)

const W = 900, H = 300
const margin = { top: 18, right: 44, bottom: 28, left: 44 }
const plotW = W - margin.left - margin.right
const plotH = H - margin.top - margin.bottom

const n = computed(() => props.points.length)
const values = computed(() => props.points.flatMap(p => (pickPct(p) === null ? [] : [pickPct(p)! * 100])))

// Overtime sits at a few percent, so it gets a finer grid than labor.
const unit = computed(() => (isOt.value ? 2 : 5))
const yMin = computed(() => (values.value.length ? Math.max(0, Math.floor((Math.min(...values.value) - unit.value / 2) / unit.value) * unit.value) : 0))
const yMax = computed(() => (values.value.length ? Math.ceil((Math.max(...values.value) + unit.value / 2) / unit.value) * unit.value : 50))
const yTicks = computed(() => {
  const span = yMax.value - yMin.value
  const step = isOt.value ? (span > 10 ? 4 : 2) : span > 60 ? 20 : span > 30 ? 10 : 5
  const ticks: number[] = []
  for (let v = yMin.value; v <= yMax.value; v += step) ticks.push(v)
  return ticks
})

function yFor(pct: number): number {
  return margin.top + (1 - (pct - yMin.value) / (yMax.value - yMin.value)) * plotH
}
function xFor(i: number): number {
  return margin.left + ((i + 0.5) / Math.max(n.value, 1)) * plotW
}

// One subpath per run of consecutive weeks that have a value.
function pathFor(pick: (p: Point) => number | null): string {
  let d = ''
  let open = false
  props.points.forEach((p, i) => {
    const v = pick(p)
    if (v === null) { open = false; return }
    d += `${open ? 'L' : 'M'}${xFor(i).toFixed(1)},${yFor(v * 100).toFixed(1)} `
    open = true
  })
  return d.trim()
}
const linePath = computed(() => pathFor(pickPct))

function fmtShort(s: string) {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
// About 8 labels, counted back from the latest week so the newest is always named.
const xLabelIndexes = computed(() => {
  const step = Math.max(1, Math.ceil(n.value / 8))
  return props.points.map((_, i) => i).filter(i => (n.value - 1 - i) % step === 0)
})

const lastIndex = computed(() => {
  for (let i = props.points.length - 1; i >= 0; i--) if (pickPct(props.points[i]!) !== null) return i
  return -1
})

const hovered = ref<number | null>(null)
const hoveredPoint = computed(() => (hovered.value === null ? null : props.points[hovered.value] ?? null))
const tooltipStyle = computed(() => {
  if (hovered.value === null) return {}
  const px = (xFor(hovered.value) / W) * 100
  return { left: `${Math.min(86, Math.max(14, px))}%` }
})
const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString()}`
</script>

<template>
  <div class="chart-wrap" :class="{ 'is-ot': isOt }">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="label">
      <g v-for="t in yTicks" :key="t">
        <line :x1="margin.left" :x2="W - margin.right" :y1="yFor(t)" :y2="yFor(t)" class="gridline" />
        <text :x="margin.left - 8" :y="yFor(t) + 4" class="axis-label y-label">{{ t }}%</text>
      </g>

      <line
        v-if="hovered !== null"
        :x1="xFor(hovered)" :x2="xFor(hovered)" :y1="margin.top" :y2="margin.top + plotH"
        class="crosshair"
      />

      <path v-if="linePath" :d="linePath" class="series-line" />
      <template v-for="(p, i) in points" :key="p.weekStart">
        <circle
          v-if="pickPct(p) !== null"
          :cx="xFor(i)" :cy="yFor(pickPct(p)! * 100)" :r="hovered === i ? 5 : 3.5"
          class="series-dot"
        />
      </template>

      <!-- label the latest value directly -->
      <text
        v-if="lastIndex >= 0 && hovered === null"
        :x="xFor(lastIndex) + 8" :y="yFor(pickPct(points[lastIndex]!)! * 100) + 4"
        class="end-label"
      >{{ (pickPct(points[lastIndex]!)! * 100).toFixed(1) }}%</text>

      <text v-for="i in xLabelIndexes" :key="`x-${i}`" :x="xFor(i)" :y="H - margin.bottom + 16" class="axis-label x-label">
        {{ fmtShort(points[i]!.weekStart) }}
      </text>

      <!-- hit areas, one per week, wider than the markers -->
      <rect
        v-for="(p, i) in points" :key="`hit-${p.weekStart}`"
        :x="margin.left + (i / Math.max(n, 1)) * plotW" :y="margin.top"
        :width="plotW / Math.max(n, 1)" :height="plotH"
        fill="transparent"
        @mouseenter="hovered = i" @mouseleave="hovered = null"
      />
    </svg>

    <div v-if="hoveredPoint" class="tooltip" :style="tooltipStyle">
      <div class="tooltip-date">{{ fmtShort(hoveredPoint.weekStart) }} – {{ fmtShort(hoveredPoint.weekEnd) }}</div>
      <template v-if="hoveredPoint.pct !== null">
        <div class="tooltip-row"><span class="tooltip-label">Labor %</span><span class="tooltip-value">{{ (hoveredPoint.pct * 100).toFixed(1) }}%</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Kitchen labor</span><span class="tooltip-value">{{ fmtMoney(hoveredPoint.labor) }}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Overtime %</span><span class="tooltip-value">{{ (hoveredPoint.otPct! * 100).toFixed(1) }}%</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Overtime</span><span class="tooltip-value">{{ fmtMoney(hoveredPoint.overtime) }}</span></div>
      </template>
      <div v-else class="tooltip-row"><span class="tooltip-label">Awaiting payroll</span></div>
      <div class="tooltip-row"><span class="tooltip-label">Food revenue</span><span class="tooltip-value">{{ fmtMoney(hoveredPoint.revenue) }}</span></div>
    </div>
  </div>
</template>

<style scoped>
.chart-wrap { position: relative; --series: var(--accent); }
.chart-wrap.is-ot { --series: #eb6834; }
@media (prefers-color-scheme: dark) { .chart-wrap.is-ot { --series: #d95926; } }
svg { width: 100%; height: auto; display: block; }
.gridline { stroke: var(--hair); stroke-width: 1; }
.axis-label { font-size: 10px; fill: var(--ink-3); font-variant-numeric: tabular-nums; }
.y-label { text-anchor: end; }
.x-label { text-anchor: middle; }
.crosshair { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 3 3; }
.series-line { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.series-dot { fill: var(--series); stroke: var(--surface); stroke-width: 2; }
.end-label { font-size: 11px; font-weight: 700; fill: var(--ink); font-variant-numeric: tabular-nums; }

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
  min-width: 160px;
  z-index: 2;
}
.tooltip-date { font-weight: 700; color: var(--ink); margin-bottom: 4px; font-size: 11px; }
.tooltip-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 1px 0; }
.tooltip-label { color: var(--ink-3); }
.tooltip-value { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
</style>
