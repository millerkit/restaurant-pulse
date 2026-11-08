// Dated buyouts, closures and event nights (2026-11-05).
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS special_nights (
      date             TEXT PRIMARY KEY,
      kind             TEXT NOT NULL CHECK (kind IN ('buyout', 'closed', 'offsite', 'event')),
      expected_revenue REAL NOT NULL DEFAULT 0 CHECK (expected_revenue >= 0),
      note             TEXT,
      updated_at       TEXT NOT NULL
    )
  `)
}
