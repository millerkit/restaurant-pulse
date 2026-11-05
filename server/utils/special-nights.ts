// Dated buyouts / closures / off-site and event nights (schema.sql's special_nights).
// Readers tolerate a missing table (before the migration runs) by returning none, so
// the Revenue projection and Dashboard panel degrade to "no special nights" instead
// of failing.
import type Database from 'better-sqlite3'

export const SPECIAL_NIGHT_KINDS = ['buyout', 'closed', 'offsite', 'event'] as const
export type SpecialNightKind = typeof SPECIAL_NIGHT_KINDS[number]
export type SpecialNight = { date: string, kind: SpecialNightKind, expectedRevenue: number, note: string | null }

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
