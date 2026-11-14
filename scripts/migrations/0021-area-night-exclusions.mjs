// Per-area nights that don't count in the Covers & Spend trend (2026-11-14): an area was used for
// something that isn't regular demand while the rest of the restaurant ran normally. Seeds Chef's
// Counter Tue 2026-11-03 (private investor event, no revenue). Matches the area by name (ids differ
// between environments). Safe to re-run.
export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS area_night_exclusions (
      area_id INTEGER NOT NULL REFERENCES capacity_areas(id),
      date    TEXT NOT NULL,
      note    TEXT,
      PRIMARY KEY (area_id, date)
    );
  `)
  const rows = db.prepare("SELECT id FROM capacity_areas WHERE lower(name) LIKE 'chef%'").all()
  if (rows.length !== 1) return log(`table ready; Chef's Counter matches ${rows.length} areas, seed skipped`)
  const r = db.prepare('INSERT OR IGNORE INTO area_night_exclusions (area_id, date, note) VALUES (?, ?, ?)')
    .run(rows[0].id, '2026-11-03', 'Private investor event (no revenue)')
  log(`table ready; seeded ${r.changes} row(s)`)
}
