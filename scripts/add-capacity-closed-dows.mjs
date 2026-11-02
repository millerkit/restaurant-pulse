// One-time migration: adds capacity_areas.closed_dows, closed_from and
// closure_recapture_pct and closure_recapture_weights (added 2026-11-02). See schema.sql and CLAUDE.md's
// "Per-area weekly closures" section.
//
//   node scripts/add-capacity-closed-dows.mjs [path/to/restaurant.sqlite]
//
// Idempotent. Run against production BY HAND (fly ssh console) BEFORE
// `fly deploy`, or /api/capacity and /api/capacity/settings fail on the
// missing columns. Every area starts with no closure configured.
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
if (!cols.has('closed_dows')) {
  db.exec('ALTER TABLE capacity_areas ADD COLUMN closed_dows TEXT')
  console.log('added closed_dows')
}
if (!cols.has('closed_from')) {
  db.exec('ALTER TABLE capacity_areas ADD COLUMN closed_from TEXT')
  console.log('added closed_from')
}
if (!cols.has('closure_recapture_pct')) {
  db.exec('ALTER TABLE capacity_areas ADD COLUMN closure_recapture_pct REAL NOT NULL DEFAULT 0')
  console.log('added closure_recapture_pct')
}
if (!cols.has('closure_recapture_weights')) {
  db.exec('ALTER TABLE capacity_areas ADD COLUMN closure_recapture_weights TEXT')
  console.log('added closure_recapture_weights')
}
console.log('capacity_areas closure columns ready')
