// Per-area opt-in to update per-cover revenue from actuals at month close (2026-10-29).
export function up(db, log) {
  const cols = new Set(db.prepare('PRAGMA table_info(capacity_areas)').all().map(c => c.name))
  if (!cols.has('follow_actuals')) {
    db.exec('ALTER TABLE capacity_areas ADD COLUMN follow_actuals INTEGER NOT NULL DEFAULT 0')
    log('added capacity_areas.follow_actuals')
  }
  if (!cols.has('follow_actuals_through')) {
    db.exec('ALTER TABLE capacity_areas ADD COLUMN follow_actuals_through TEXT')
    log('added capacity_areas.follow_actuals_through')
  }
}
