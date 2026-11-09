// Per-person access roles (2026-11-09), keyed by the email Cloudflare Access verifies.
// See shared/utils/access.ts for what each role can see. The Basic Auth backstop on the
// raw fly.dev hostname is always treated as owner and doesn't use this table.
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_roles (
      email       TEXT PRIMARY KEY,
      role        TEXT NOT NULL CHECK (role IN ('owner', 'gm', 'kitchen')),
      name        TEXT,
      updated_at  TEXT NOT NULL
    )
  `)
  const now = new Date().toISOString()
  const seed = db.prepare('INSERT OR IGNORE INTO user_roles (email, role, name, updated_at) VALUES (?, ?, ?, ?)')
  seed.run('kmillercc@gmail.com', 'owner', 'Kit', now)
  seed.run('ataylor@urbanhearth.net', 'gm', null, now)
  seed.run('rebecca.m.daulton@gmail.com', 'kitchen', 'Rebecca (Sous Chef)', now)
}
