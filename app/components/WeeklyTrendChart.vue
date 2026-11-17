<script setup lang="ts">
// One weekly metric as a line with a dashed least-squares trend, same look and behavior as KitchenLaborChart
// (single series so no legend, line breaks at weeks with no value, y-axis fitted to the data rather than anchored
// at zero, hover crosshair and one tooltip; the page's Table view is the accessible alternative). Generic so the
// FOH Hours page can draw guests per hour, sales per hour and turn time with it.
type Point = {
  weekStart: string
  weekEnd: string
  value: number | null
  // Extra tooltip lines, already formatted ("Guests", "1,204").
  rows: { label: string, value: string }[]
}
const props = defineProps<{ points: Point[], label: string, format: 'ratio' | 'dollars' | 'minutes' }>()

const fmt = (v: number) => (props.format === 'dollars' ? `$${Math.round(v).toLocaleString('en-US')}` : props.format === 'minutes' ? `${Math.round(v)}m` : v.toFixed(1))
const fmtTick = (v: number) => (props.format === 'ratio' ? v.toFixed(1) : fmt(v))

const W = 900, H = 300
const margin = { top: 18, right: 52, bottom: 28, left: 52 }
const plotW = W - margin.left - margin.right
const plotH = H - margin.top - margin.bottom

const n = computed(() => props.points.length)
const values = computed(() => props.points.flatMap(p => (p.value === null ? [] : [p.value])))

// A "nice" step so there are about 4-5 gridlines, whatever the metric's scale.
const STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
const step = computed(() => {
  if (!values.value.length) return 1
  const span = Math.max(...values.value) - Math.min(...values.value)
  const raw = Math.max(span, Math.max(...values.value) * 0.1) / 4
  return STEPS.find(s => s >= raw) ?? 1000
})
const yMin = computed(() => (values.value.length ? Math.max(0, Math.floor((Math.min(...values.value) - step.value * 0.4) / step.value) * step.value) : 0))
const yMax = computed(() => (values.value.length ? Math.ceil((Math.max(...values.value) + step.value * 0.4) / step.value) * step.value : step.value * 4))
const yTicks = computed(() => {
  const ticks: number[] = []
  for (let v = yMin.value; v <= yMax.value + 1e-9; v += step.value) ticks.push(Math.round(v * 1000) / 1000)
  return ticks
})

const yFor = (v: number) => margin.top + (1 - (v - yMin.value) / (yMax.value - yMin.value)) * plotH
const xFor = (i: number) => margin.left + ((i + 0.5) / Math.max(n.value, 1)) * plotW

// One subpath per run of consecutive weeks that have a value.
const linePath = computed(() => {
  let d = ''
  let open = false
  props.points.forEach((p, i) => {
    if (p.value === null) { open = false; return }
    d += `${open ? 'L' : 'M'}${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)} `
    open = true
  })
  return d.trim()
})

// Least-squares trend over the weeks that have a value, first to last of them.
const trend = computed(() => {
  const pts: { x: number, y: number }[] = []
  props.points.forEach((p, i) => { if (p.value !== null) pts.push({ x: i, y: p.value }) })
  if (pts.length < 3) return null
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  if (den === 0) return null
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den
  const at = (x: number) => my + slope * (x - mx)
  const x1 = pts[0]!.x, x2 = pts[pts.length - 1]!.x
  const clamp = (y: number) => Math.min(yMax.value, Math.max(yMin.value, y))
  return { x1: xFor(x1), y1: yFor(clamp(at(x1))), x2: xFor(x2), y2: yFor(clamp(at(x2))) }
})

const fmtShort = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
// About 8 labels, counted back from the latest week so the newest is always named.
const xLabelIndexes = computed(() => {
  const stepX = Math.max(1, Math.ceil(n.value / 8))
  return props.points.map((_, i) => i).filter(i => (n.value - 1 - i) % stepX === 0)
})
const lastIndex = computed(() => {
  for (let i = props.points.length - 1; i >= 0; i--) if (props.points[i]!.value !== null) return i
  return -1
})

const hovered = ref<number | null>(null)
const hoveredPoint = computed(() => (hovered.value === null ? null : props.points[hovered.value] ?? null))
const tooltipStyle = computed(() => {
  if (hovered.value === null) return {}
  const px = (xFor(hovered.value) / W) * 100
  return { left: `${Math.min(86, Math.max(14, px))}%` }
})
</script>

<template>
  <div class="chart-wrap">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="label">
      <g v-for="t in yTicks" :key="t">
        <line :x1="margin.left" :x2="W - margin.right" :y1="yFor(t)" :y2="yFor(t)" class="gridline" />
        <text :x="margin.left - 8" :y="yFor(t) + 4" class="axis-label y-label">{{ fmtTick(t) }}</text>
      </g>

      <line v-if="hovered !== null" :x1="xFor(hovered)" :x2="xFor(hovered)" :y1="margin.top" :y2="margin.top + plotH" class="crosshair" />

      <line v-if="trend" :x1="trend.x1" :y1="trend.y1" :x2="trend.x2" :y2="trend.y2" class="trend-line" />
      <path v-if="linePath" :d="linePath" class="series-line" />
      <template v-for="(p, i) in points" :key="p.weekStart">
        <circle v-if="p.value !== null" :cx="xFor(i)" :cy="yFor(p.value)" :r="hovered === i ? 5 : 3.5" class="series-dot" />
      </template>

      <text v-if="lastIndex >= 0 && hovered === null" :x="xFor(lastIndex) + 8" :y="yFor(points[lastIndex]!.value!) + 4" class="end-label">{{ fmt(points[lastIndex]!.value!) }}</text>

      <text v-for="i in xLabelIndexes" :key="`x-${i}`" :x="xFor(i)" :y="H - margin.bottom + 16" class="axis-label x-label">{{ fmtShort(points[i]!.weekStart) }}</text>

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
      <template v-if="hoveredPoint.value !== null">
        <div class="tooltip-row"><span class="tooltip-label">{{ label }}</span><span class="tooltip-value">{{ fmt(hoveredPoint.value) }}</span></div>
        <div v-for="r in hoveredPoint.rows" :key="r.label" class="tooltip-row"><span class="tooltip-label">{{ r.label }}</span><span class="tooltip-value">{{ r.value }}</span></div>
      </template>
      <div v-else class="tooltip-row"><span class="tooltip-label">Not enough normal nights</span></div>
    </div>
  </div>
</template>

<style scoped>
.chart-wrap { position: relative; --series: var(--accent); }
svg { width: 100%; height: auto; display: block; }
.gridline { stroke: var(--hair); stroke-width: 1; }
.axis-label { font-size: 10px; fill: var(--ink-3); font-variant-numeric: tabular-nums; }
.y-label { text-anchor: end; }
.x-label { text-anchor: middle; }
.crosshair { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 3 3; }
.series-line { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.trend-line { stroke: var(--ink-3); stroke-width: 1.5; stroke-dasharray: 6 4; stroke-linecap: round; }
.series-dot { fill: var(--series); stroke: var(--surface); stroke-width: 2; }
.end-label { font-size: 11px; font-weight: 700; fill: var(--ink); font-variant-numeric: tabular-nums; }
.tooltip {
  position: absolute; top: 8px; transform: translateX(-50%);
  background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; box-shadow: var(--card-shadow);
  padding: 8px 10px; font-size: 11.5px; pointer-events: none; min-width: 160px; z-index: 2;
}
.tooltip-date { font-weight: 700; color: var(--ink); margin-bottom: 4px; font-size: 11px; }
.tooltip-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 1px 0; }
.tooltip-label { color: var(--ink-3); }
.tooltip-value { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
</style>
