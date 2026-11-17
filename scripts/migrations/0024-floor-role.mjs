// Adds the 'floor' (Floor Manager) role to user_roles (2026-11-17). SQLite can't change a CHECK
// constraint in place, so the table is rebuilt with the same columns and every row copied over.
// Safe to re-run: skipped once the table's definition already allows 'floor'. A fresh database
// built from schema.sql already has it.
export function up(db, log) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_roles'").get()
  if (!row) return log('user_roles does not exist; nothing to do')
  if (row.sql.includes("'floor'")) return log("user_roles already allows 'floor'")
  db.exec(`
    CREATE TABLE user_roles_new (
      email       TEXT PRIMARY KEY,
      role        TEXT NOT NULL CHECK (role IN ('owner', 'gm', 'kitchen', 'floor')),
      name        TEXT,
      updated_at  TEXT NOT NULL
    );
    INSERT INTO user_roles_new (email, role, name, updated_at) SELECT email, role, name, updated_at FROM user_roles;
    DROP TABLE user_roles;
    ALTER TABLE user_roles_new RENAME TO user_roles;
  `)
  log("user_roles rebuilt to allow 'floor'")
}
