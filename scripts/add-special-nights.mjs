// One-time migration: creates special_nights (added 2026-11-05). See schema.sql.
//
//   node scripts/add-special-nights.mjs [path/to/restaurant.sqlite]
//
// Idempotent. Run against production BY HAND (fly ssh console) BEFORE `fly deploy`,
// or /api/special-nights 500s. The Revenue projection and booking panel fall back to
// "no special nights" if the table is missing, so those don't break.
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
db.exec(`
  CREATE TABLE IF NOT EXISTS special_nights (
    date             TEXT PRIMARY KEY,
    kind             TEXT NOT NULL CHECK (kind IN ('buyout', 'closed', 'offsite', 'event')),
    expected_revenue REAL NOT NULL DEFAULT 0 CHECK (expected_revenue >= 0),
    note             TEXT,
    updated_at       TEXT NOT NULL
  )
`)
console.log('special_nights ready')
