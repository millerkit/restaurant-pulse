// Per-area weekly closures (2026-11-02).
export function up(db, log) {
  const cols = new Set(db.prepare('PRAGMA table_info(capacity_areas)').all().map(c => c.name))
  const add = [
    ['closed_dows', 'TEXT'],
    ['closed_from', 'TEXT'],
    ['closure_recapture_pct', 'REAL NOT NULL DEFAULT 0'],
    ['closure_recapture_weights', 'TEXT']
  ]
  for (const [name, ddl] of add) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE capacity_areas ADD COLUMN ${name} ${ddl}`)
      log(`added capacity_areas.${name}`)
    }
  }
}
