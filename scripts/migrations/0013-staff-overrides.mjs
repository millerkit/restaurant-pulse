// Benefits-eligibility overrides moved out of code (2026-11-09), editable in Settings.
// name_key is Toast's lowercased "first last" for salaried/grandfathered people, and the
// lowercased display name for excluded shared logins (what the page already matched on).
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_overrides (
      name_key    TEXT PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('salaried', 'grandfathered', 'excluded')),
      updated_at  TEXT NOT NULL
    )
  `)
  const now = new Date().toISOString()
  const seed = db.prepare('INSERT OR IGNORE INTO staff_overrides (name_key, kind, updated_at) VALUES (?, ?, ?)')
  for (const k of ['abigail taylor', 'shane allerheiligen', 'josh sokol']) seed.run(k, 'salaried', now)
  seed.run('katie janik', 'grandfathered', now)
  seed.run('service bar', 'excluded', now)
}
