import type Database from 'better-sqlite3'

export const SPECIAL_NIGHT_KINDS = ['buyout', 'closed', 'offsite', 'event'] as const
export type SpecialNightKind = typeof SPECIAL_NIGHT_KINDS[number]
export type SpecialNight = { date: string, kind: SpecialNightKind, expectedRevenue: number, note: string | null, holiday?: string }

// Dated one-off nights entered on the Sales Plan (special_nights). Raw table only.
export function loadSpecialNights(db: Database.Database, from: string, to: string): Map<string, SpecialNight> {
  try {
    const rows = db.prepare(`
      SELECT date, kind, expected_revenue AS expectedRevenue, note
      FROM special_nights WHERE date >= ? AND date <= ? ORDER BY date
    `).all(from, to) as SpecialNight[]
    return new Map(rows.map(r => [r.date, r]))
  } catch {
    return new Map()
  }
}

// Named whole-restaurant holiday closures (holiday_closures, Settings › Restaurant Setup, 2026-11-08).
export function loadHolidayClosures(db: Database.Database, from: string, to: string): Map<string, { date: string, name: string }> {
  try {
    const rows = db.prepare('SELECT date, name FROM holiday_closures WHERE date >= ? AND date <= ? ORDER BY date').all(from, to) as { date: string, name: string }[]
    return new Map(rows.map(r => [r.date, r]))
  } catch {
    return new Map()
  }
}

// Special nights plus holidays, as one map: a holiday is a 'closed' night with $0
// expected and its name in `holiday`. A special night entered for the same date
// wins (it's more specific). Used wherever a night's plan matters: the capacity
// budget, the current-month projection, and Next 7 Nights.
export function loadPlannedNights(db: Database.Database, from: string, to: string): Map<string, SpecialNight> {
  const out = new Map<string, SpecialNight>()
  for (const h of loadHolidayClosures(db, from, to).values()) {
    out.set(h.date, { date: h.date, kind: 'closed', expectedRevenue: 0, note: h.name, holiday: h.name })
  }
  for (const s of loadSpecialNights(db, from, to).values()) out.set(s.date, s)
  return out
}

// Nights that replace normal dinner service, i.e. everything but buyouts. A buyout
// stays a normal night in the capacity budget; the Sales Plan's buyout panel adds
// the price above a normal night on top. Mondays are dropped (already closed).
export function loadReplacedNights(db: Database.Database, from: string, to: string): Map<string, SpecialNight> {
  const out = new Map<string, SpecialNight>()
  for (const n of loadPlannedNights(db, from, to).values()) {
    if (n.kind === 'buyout') continue
    if (new Date(`${n.date}T00:00:00Z`).getUTCDay() === 1) continue
    out.set(n.date, n)
  }
  return out
}

// Count of replaced (non-normal) service nights per month of a year.
export function replacedNightsByMonth(db: Database.Database, year: number): Map<number, number> {
  const counts = new Map<number, number>()
  for (const n of loadReplacedNights(db, `${year}-01-01`, `${year}-12-31`).values()) {
    const m = Number(n.date.slice(5, 7))
    counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  return counts
}
