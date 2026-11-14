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
