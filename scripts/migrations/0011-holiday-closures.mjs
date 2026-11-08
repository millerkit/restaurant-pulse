// Named, dated whole-restaurant holiday closures (2026-11-08), replacing the
// per-month counts in capacity_seasonality.holiday_closures (kept, no longer read
// by the app; Settings shows any nonzero ones so they can be replaced with dates).
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS holiday_closures (
      date        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `)
}
