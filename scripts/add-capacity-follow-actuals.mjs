// One-time migration: adds capacity_areas.follow_actuals and
// follow_actuals_through (added 2026-10-29). See schema.sql and CLAUDE.md's
// "Per-area per-cover revenue can follow actuals" section.
//
//   node scripts/add-capacity-follow-actuals.mjs [path/to/restaurant.sqlite]
//
// Idempotent. Run against production BY HAND (fly ssh console) BEFORE
// `fly deploy`, or /api/capacity/settings and the nightly sync fail on the
// missing columns. Every area starts with follow_actuals = 0 (manual).
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(rootDir, 'data', 'restaurant.sqlite')
if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`)
  process.exit(1)
}
const db = new Database(dbPath)
const cols = new Set(db.prepare('PRAGMA table_info(capacity_areas)').all().map(c => c.name))
if (!cols.has('follow_actuals')) {
  db.exec('ALTER TABLE capacity_areas ADD COLUMN follow_actuals INTEGER NOT NULL DEFAULT 0')
  console.log('added follow_actuals')
}
if (!cols.has('follow_actuals_through')) {
  db.exec('ALTER TABLE capacity_areas ADD COLUMN follow_actuals_through TEXT')
  console.log('added follow_actuals_through')
}
console.log('capacity_areas follow_actuals columns ready')
