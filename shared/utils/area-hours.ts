// Weekdays (0 = Sunday) an area never operates, on top of its configurable weekly closure
// (capacity_areas.closed_dows/closed_from). Chef's Counter never runs Sundays (Kit, 2026-11-14), so
// Sundays never count for it in the forecast (capacity-model.ts), the per-area fill index
// (capacity-history.ts) or the Covers & Spend trend (api/capacity/area-trends.get.ts). Matched by area
// name because ids differ between environments.
const NEVER_OPEN: { match: RegExp, dows: number[] }[] = [{ match: /^chef/i, dows: [0] }]

export function neverOpenDows(areaName: string): Set<number> {
  return new Set(NEVER_OPEN.filter(r => r.match.test(areaName)).flatMap(r => r.dows))
}
export function neverOpenOn(areaName: string, dow: number): boolean {
  return neverOpenDows(areaName).has(dow)
}

// Tue-Sun: the restaurant's regular service nights (Monday is the standing closure).
const SERVICE_NIGHTS = 6
// An area's configurable closed weekdays, minus Monday and its never-open weekdays (those are
// dark anyway and never recaptured).
export function areaClosedDows(areaName: string, closedDows: number[]): number[] {
  const never = neverOpenDows(areaName)
  return [...new Set(closedDows)].filter(n => Number.isInteger(n) && n >= 0 && n <= 6 && n !== 1 && !never.has(n))
}
// How much each open night's covers grow under a weekly closure: with `closed` closed nights,
// weekly covers become base*(open nights + closed*r) over the open nights, where base is the
// area's operating nights (6 minus never-open weekdays). Server (capacity-model.ts) and the
// Capacity/Settings pages both use this so they can't disagree.
export function areaClosureUplift(areaName: string, closedDows: number[], recapturePct: number): number {
  const base = SERVICE_NIGHTS - neverOpenDows(areaName).size
  const closed = areaClosedDows(areaName, closedDows).length
  const open = base - closed
  if (closed === 0 || open <= 0) return 1
  const r = Math.min(1, Math.max(0, (recapturePct || 0) / 100))
  return (base - closed * (1 - r)) / open
}
// Nights a week the area is open under its weekly closure.
export function areaOpenNightsPerWeek(areaName: string, closedDows: number[]): number {
  return SERVICE_NIGHTS - neverOpenDows(areaName).size - areaClosedDows(areaName, closedDows).length
}
