// How far ahead guests book (Sales Strategy step 2, 2026-11-18), from the OpenTable upload
// (`reservations`): days between when a reservation was made and the visit. Walk-ins (booked on the
// spot) and canceled reservations are left out. Only visits up to the latest upload date count:
// upcoming visits only hold bookings made so far, which skews toward early bookers, so including them
// would overstate lead times. Overall and by party size, plus how guests book (source).
//
// Event and buyout lead time is NOT recorded anywhere (special_nights has no booked-on date), so the
// large-party figure is the closest stand-in; the page says so.
import type Database from 'better-sqlite3'

// Fewer reservations than this and a percentile is noise: the figure is withheld, not guessed.
export const MIN_LEAD_SAMPLE = 25
export const LARGE_PARTY_MIN_SIZE = 8

type Res = { visitDate: string, size: number, createdAt: string, source: string | null }
export type LeadStat = { n: number, medianDays: number | null, p80Days: number | null }
export type SourceStat = { source: string, n: number, share: number, avgSize: number, medianLeadDays: number | null }

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  const a = sorted[lo]!, b = sorted[hi]!
  return a + (b - a) * (i - lo)
}
function stat(leads: number[]): LeadStat {
  if (leads.length < MIN_LEAD_SAMPLE) return { n: leads.length, medianDays: null, p80Days: null }
  const s = [...leads].sort((a, b) => a - b)
  return { n: s.length, medianDays: Math.round(percentile(s, 0.5)), p80Days: Math.round(percentile(s, 0.8)) }
}

export function computeBookingLeadTimes(db: Database.Database) {
  let rows: Res[]
  let uploadDate: string | null = null
  try {
    const latest = db.prepare('SELECT imported_at AS importedAt FROM reservation_imports ORDER BY id DESC LIMIT 1').get() as { importedAt: string } | undefined
    uploadDate = latest ? latest.importedAt.slice(0, 10) : null
    if (!uploadDate) return { available: false as const, reason: 'No OpenTable export has been uploaded yet.' }
    rows = db.prepare(`
      SELECT visit_date AS visitDate, size, substr(created_at, 1, 10) AS createdAt, source
      FROM reservations
      WHERE COALESCE(source, '') <> 'Walk-in' AND canceled_at IS NULL AND created_at IS NOT NULL AND visit_date < ?
    `).all(uploadDate) as Res[]
  } catch {
    return { available: false as const, reason: 'Reservation tables are missing on this database.' }
  }
  const usable = rows.map(r => ({ ...r, lead: daysBetween(r.createdAt, r.visitDate) })).filter(r => r.lead >= 0)
  if (usable.length === 0) return { available: false as const, reason: 'No usable reservations yet.' }

  const bySource = new Map<string, typeof usable>()
  for (const r of usable) {
    const k = r.source || 'Other'
    bySource.set(k, [...(bySource.get(k) ?? []), r])
  }
  const sources: SourceStat[] = [...bySource.entries()].map(([source, rs]) => ({
    source, n: rs.length, share: rs.length / usable.length,
    avgSize: rs.reduce((s, r) => s + r.size, 0) / rs.length,
    medianLeadDays: stat(rs.map(r => r.lead)).medianDays
  })).sort((a, b) => b.n - a.n)

  return {
    available: true as const,
    uploadDate,
    from: usable.reduce((m, r) => (r.visitDate < m ? r.visitDate : m), usable[0]!.visitDate),
    to: usable.reduce((m, r) => (r.visitDate > m ? r.visitDate : m), usable[0]!.visitDate),
    all: stat(usable.map(r => r.lead)),
    small: stat(usable.filter(r => r.size < LARGE_PARTY_MIN_SIZE).map(r => r.lead)),
    large: stat(usable.filter(r => r.size >= LARGE_PARTY_MIN_SIZE).map(r => r.lead)),
    largePartyMinSize: LARGE_PARTY_MIN_SIZE,
    sources
  }
}
