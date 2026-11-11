// Automatic capacity forecast with pins (2026-11-11). See server/utils/capacity-forecast.ts.
//
// First run only (when the columns are new): every area follows actuals for its
// spend per guest, and every covers row is automatic, except Chef's Counter,
// which keeps its current figures as pins (a deliberate price and a marketing
// goal). The covers as they stood are copied to capacity_area_seasonality_pre_auto
// so they can be compared or restored.
export function up(db, log) {
  const seasonCols = new Set(db.prepare('PRAGMA table_info(capacity_area_seasonality)').all().map(c => c.name))
  if (!seasonCols.has('pinned')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS capacity_area_seasonality_pre_auto AS
        SELECT area_id, month, expected_covers FROM capacity_area_seasonality
    `)
    db.exec('ALTER TABLE capacity_area_seasonality ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE capacity_area_seasonality ADD COLUMN auto_covers REAL')
    db.exec('ALTER TABLE capacity_area_seasonality ADD COLUMN auto_basis TEXT')
    db.exec('ALTER TABLE capacity_area_seasonality ADD COLUMN auto_updated_at TEXT')
    const pinned = db.prepare(`
      UPDATE capacity_area_seasonality SET pinned = 1
      WHERE area_id IN (SELECT id FROM capacity_areas WHERE lower(name) LIKE '%chef%')
    `).run().changes
    log(`added automatic/pinned covers (${pinned} Chef's Counter rows pinned; previous covers saved to capacity_area_seasonality_pre_auto)`)
  }

  const areaCols = new Set(db.prepare('PRAGMA table_info(capacity_areas)').all().map(c => c.name))
  if (!areaCols.has('auto_per_cover_food')) {
    db.exec('ALTER TABLE capacity_areas ADD COLUMN auto_per_cover_food REAL')
    db.exec('ALTER TABLE capacity_areas ADD COLUMN auto_per_cover_beverage REAL')
    db.exec(`UPDATE capacity_areas SET follow_actuals = CASE WHEN lower(name) LIKE '%chef%' THEN 0 ELSE 1 END`)
    log('added automatic spend per guest (every area automatic except Chef\'s Counter)')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS capacity_forecast_refresh (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      refreshed_on   TEXT NOT NULL,
      toast_through  TEXT NOT NULL
    )
  `)
}
