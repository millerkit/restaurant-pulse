// Forecast snapshots (dynamic budgeting step 3, 2026-11-11). See server/utils/forecast-snapshots.ts.
// The forecast overwrites itself nightly, so the app saves month-level copies as it goes
// (weekly, plus a frozen month_start record) to measure forecast accuracy later.
export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forecast_snapshots (
      snapshot_date TEXT NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN ('weekly', 'month_start')),
      year          INTEGER NOT NULL,
      month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      source        TEXT NOT NULL CHECK (source IN ('plan', 'live')),
      metric        TEXT NOT NULL,
      value         REAL NOT NULL,
      created_at    TEXT NOT NULL,
      PRIMARY KEY (snapshot_date, kind, year, month, source, metric)
    )
  `)
  log('forecast_snapshots table ready')
}
