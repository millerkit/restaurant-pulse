// One-time migration: creates gift_card_plan (added 2026-10-28). See schema.sql and
// CLAUDE.md's "Gift card cash timing" section.
//
//   node scripts/add-gift-card-plan.mjs [path/to/restaurant.sqlite]
//
// Idempotent. Run against production BY HAND (fly ssh console) BEFORE `fly deploy`,
// or /api/cashflow 500s on the missing table. Starts at $0 (nothing assumed until entered).
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
  CREATE TABLE IF NOT EXISTS gift_card_plan (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    expected_cash  REAL NOT NULL,
    updated_at     TEXT NOT NULL
  )
`)
console.log('gift_card_plan ready')
