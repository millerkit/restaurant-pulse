// One-time migration: creates reservations + reservation_imports (added 2026-11-04). See schema.sql.
//
//   node scripts/add-reservations-tables.mjs [path/to/restaurant.sqlite]
//
// Idempotent. Run against production BY HAND (fly ssh console) BEFORE `fly deploy`,
// or /api/reservations/* 500s on the missing tables.
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
  CREATE TABLE IF NOT EXISTS reservations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_date        TEXT NOT NULL,
    visit_time        TEXT,
    created_at        TEXT,
    canceled_at       TEXT,
    no_show_at        TEXT,
    seated_at         TEXT,
    size              INTEGER NOT NULL,
    status            TEXT NOT NULL,
    tables            TEXT,
    area_assigned     TEXT,
    area_booked       TEXT,
    source            TEXT,
    online_waitlist   INTEGER NOT NULL DEFAULT 0,
    experience_title  TEXT,
    prepayment_status TEXT,
    imported_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reservations_visit_date ON reservations (visit_date);
  CREATE TABLE IF NOT EXISTS reservation_imports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    imported_at   TEXT NOT NULL,
    rows          INTEGER NOT NULL,
    date_from     TEXT NOT NULL,
    date_to       TEXT NOT NULL,
    replaced_rows INTEGER NOT NULL
  );
`)
console.log('reservations tables ready')
