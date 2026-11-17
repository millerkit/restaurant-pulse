// Room-setup rules shared by Settings › Restaurant setup (which edits seats,
// turns and closures) and Planning › Capacity (which uses them to derive fill %
// and projected revenue). Kept in one place so the two pages can't disagree.

// Outdoor has no Nov–Apr season: it stays closed through winter.
export function isOutdoorArea(name: string): boolean {
  return name.trim().toLowerCase() === 'outdoor'
}

// Nightly capacity = seats × max turns per night, rounded. null = closed that season.
export function seasonalCapacity(name: string, seats: number, turns: number, season: 'novApr' | 'mayOct'): number | null {
  if (season === 'novApr' && isOutdoorArea(name)) return null
  return Math.round(seats * turns)
}

// Weekdays an area can be closed on (Monday is the whole restaurant's closure).
export const CLOSABLE_DOWS = [
  { dow: 2, short: 'Tue' }, { dow: 3, short: 'Wed' }, { dow: 4, short: 'Thu' },
  { dow: 5, short: 'Fri' }, { dow: 6, short: 'Sat' }, { dow: 0, short: 'Sun' }
]
export const SERVICE_NIGHTS_PER_WEEK = 6
// Default split of recaptured covers when an area closes one night (Wed/Thu heavy).
export const RECAPTURE_DEFAULTS: Record<number, number> = { 3: 35, 4: 35, 5: 15, 6: 15 }

// Closure uplift (with never-open weekdays) lives in shared/utils/area-hours.ts.

export function parseClosedDows(s: string | null): number[] {
  return (s ?? '').split(',').filter(x => x !== '').map(Number).filter(n => Number.isInteger(n) && n !== 1)
}
export function parseRecaptureWeights(s: string | null): Record<number, string> {
  try {
    const o = s ? JSON.parse(s) as Record<string, number> : {}
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), String(v)]))
  } catch { return {} }
}
