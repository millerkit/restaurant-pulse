// marketing_campaigns (2026-11-18, Sales Strategy step 3): a log of each marketing push (dates, target
// weekdays/area, channel, cost) so results can be read against the frozen plan and the nights before.
// Owner-entered on Planning > Sales Strategy. Safe to re-run.
export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      channel      TEXT NOT NULL,
      start_date   TEXT NOT NULL,
      end_date     TEXT NOT NULL,
      target_dows  TEXT,
      target_area  TEXT,
      cost         REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
      note         TEXT,
      created_at   TEXT NOT NULL
    );
  `)
  log('marketing_campaigns ready')
}
