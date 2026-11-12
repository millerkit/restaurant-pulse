// Special nights get a second revenue field (2026-11-12): event_revenue = what the event itself
// brings in (tickets, event food/drink, catering), separate from expected_revenue (regular dine-in
// that night). The budget's Event Sales / Catering lines follow it automatically
// (server/utils/budget-forecast.ts). A new kind, 'catering', is allowed too; SQLite can't change a
// CHECK constraint, so the table is rebuilt. Safe to re-run.
export function up(db, log) {
  const cols = db.prepare('PRAGMA table_info(special_nights)').all().map(c => c.name)
  if (cols.length === 0) return log('special_nights missing; nothing to do')
  if (cols.includes('event_revenue')) return log('special_nights already has event_revenue')
  db.exec(`
    CREATE TABLE special_nights_new (
      date             TEXT PRIMARY KEY,
      kind             TEXT NOT NULL CHECK (kind IN ('buyout', 'closed', 'offsite', 'event', 'catering')),
      expected_revenue REAL NOT NULL DEFAULT 0 CHECK (expected_revenue >= 0),
      event_revenue    REAL NOT NULL DEFAULT 0 CHECK (event_revenue >= 0),
      note             TEXT,
      updated_at       TEXT NOT NULL
    );
    INSERT INTO special_nights_new (date, kind, expected_revenue, event_revenue, note, updated_at)
      SELECT date, kind, expected_revenue, 0, note, updated_at FROM special_nights;
    DROP TABLE special_nights;
    ALTER TABLE special_nights_new RENAME TO special_nights;
  `)
  log('special_nights rebuilt with event_revenue and the catering kind')
}
