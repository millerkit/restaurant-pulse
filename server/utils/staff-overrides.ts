// Benefits-eligibility overrides (table staff_overrides, edited in Settings):
//  - salaried: always eligible and listed even with no hours (e.g. someone who never clocks in).
//    Their Toast clock-ins aren't a dependable measure of hours, so only names are shown.
//  - grandfathered: eligible whatever their average.
//  - excluded: a Toast login that is a station, not a person (e.g. a shared bar login), which
//    would otherwise appear as a fake full-timer. Always reported back on the page.
// Keys: Toast's lowercased "first last" (not the chosen name) for salaried/grandfathered; the
// lowercased display name for excluded.
import type Database from 'better-sqlite3'

export type StaffKind = 'salaried' | 'grandfathered' | 'excluded'

export function staffKeys(first: string | null, last: string | null, chosen: string | null) {
  const f = (first ?? '').trim()
  const l = (last ?? '').trim()
  const given = (chosen || first || '').trim()
  return {
    nameKey: `${f} ${l}`.trim().toLowerCase(),
    displayKey: [given, l].filter(Boolean).join(' ').toLowerCase()
  }
}

export function loadStaffOverrides(db: Database.Database) {
  const out = { salaried: new Set<string>(), grandfathered: new Set<string>(), excluded: new Set<string>() }
  try {
    const rows = db.prepare('SELECT name_key AS k, kind FROM staff_overrides').all() as { k: string, kind: StaffKind }[]
    for (const r of rows) out[r.kind].add(r.k)
  } catch {
    // Table not migrated yet: behave as if nothing is overridden.
  }
  return out
}
