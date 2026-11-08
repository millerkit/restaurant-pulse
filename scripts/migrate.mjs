// Applies pending database migrations (scripts/migrations/NNNN-name.mjs) in order.
//
// Runs automatically before the app starts in production (Dockerfile CMD) and
// before `npm run dev` locally, so a schema change ships with `fly deploy` alone
// instead of a hand-run script that had to come first. Usage:
//   node scripts/migrate.mjs [path/to/restaurant.sqlite]
//
// - Each migration exports up(db, log) and must be safe to re-run (check before
//   adding a column/table): a fresh database built from schema.sql already has
//   everything, and gets every migration recorded as applied with no change.
// - Applied ids are recorded in schema_migrations. Each migration runs in its own
//   transaction, so a failure leaves the database as it was before that migration.
// - Before applying anything, a copy is saved to data/backups/pre-migrate-<time>.sqlite.
//   Only the newest KEEP_BACKUPS are kept: copies include the QuickBooks tokens.
// - On failure it exits 1 but the Dockerfile still starts the app (an app that
//   can't start takes the single machine down; a missing column only breaks the
//   routes that need it). The Settings page lists any migration not yet applied.
// - No database yet (fresh volume before `npm run db:init`): nothing to do.
// Data backfills (Toast/QBO history) are deliberately NOT migrations: they call
// external APIs and can take minutes.
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KEEP_BACKUPS = 3
const scriptsDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(scriptsDir, '..')
const migrationsDir = join(scriptsDir, 'migrations')
const dbPath = process.argv[2] ? resolve(process.argv[2]) : join(rootDir, 'data', 'restaurant.sqlite')

const log = (msg) => console.log(`[migrate] ${msg}`)

async function main() {
  if (!existsSync(dbPath)) {
    log(`no database at ${dbPath}; nothing to migrate`)
    return 0
  }
  const files = readdirSync(migrationsDir).filter(f => /^\d{4}-.+\.mjs$/.test(f)).sort()
  const db = new Database(dbPath)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    )`)
    const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id))
    const pending = files.map(f => f.replace(/\.mjs$/, '')).filter(id => !applied.has(id))
    if (pending.length === 0) {
      log(`up to date (${applied.size} applied)`)
      return 0
    }

    const backupDir = join(dirname(dbPath), 'backups')
    mkdirSync(backupDir, { recursive: true })
    const backupPath = join(backupDir, `pre-migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
    db.prepare('VACUUM INTO ?').run(backupPath)
    log(`backup: ${backupPath}`)
    const old = readdirSync(backupDir).filter(f => /^pre-migrate-.*\.sqlite$/.test(f)).sort()
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) rmSync(join(backupDir, f))

    const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
    for (const id of pending) {
      const mod = await import(pathToFileURL(join(migrationsDir, `${id}.mjs`)).href)
      if (typeof mod.up !== 'function') throw new Error(`${id} has no up(db) export`)
      db.transaction(() => {
        mod.up(db, (m) => log(`  ${id}: ${m}`))
        record.run(id, new Date().toISOString())
      })()
      log(`applied ${id}`)
    }
    return 0
  } catch (err) {
    console.error(`[migrate] FAILED: ${err instanceof Error ? err.stack : err}`)
    return 1
  } finally {
    db.close()
  }
}

process.exit(await main())
