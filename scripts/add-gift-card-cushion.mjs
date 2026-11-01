// One-time migration: adds gift_card_plan.cushion_pct (added 2026-10-30). See schema.sql and
// CLAUDE.md's "Gift card cash timing" section.
//
//   node scripts/add-gift-card-cushion.mjs [path/to/restaurant.sqlite]
//
// Idempotent. Run against production BY HAND (fly ssh console) BEFORE `fly deploy`, or
// /api/cashflow 500s on the missing column. Starts at 25% (nothing held back until entered).
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
const cols = db.prepare("PRAGMA table_info(gift_card_plan)").all()
if (cols.length === 0) {
  console.error('gift_card_plan does not exist; run add-gift-card-plan.mjs first')
  process.exit(1)
}
if (!cols.some(c => c.name === 'cushion_pct')) {
  db.exec('ALTER TABLE gift_card_plan ADD COLUMN cushion_pct REAL NOT NULL DEFAULT 25 CHECK (cushion_pct >= 0 AND cushion_pct <= 100)')
}
console.log('gift_card_plan.cushion_pct ready')
