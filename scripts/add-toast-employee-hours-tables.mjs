// One-time migration for the Staff Hours report (added 2026-10-27): creates
// daily_toast_employee_hours, toast_employees and benefits_enrollment_status. See schema.sql for what
// each holds and why.
//
//   node scripts/add-toast-employee-hours-tables.mjs [path/to/restaurant.sqlite]
//
// Idempotent (CREATE TABLE IF NOT EXISTS), and rebuilds an old-shape
// benefits_enrollment_status (CHECK allowed only declined/canceled, no row meant
// enrolled) so it also accepts 'enrolled' — no row now means TBD. Existing
// rows are kept as they are. Run against production BY HAND
// (fly ssh console) BEFORE `fly deploy`, or the nightly sync's employee-hours
// write and /api/staff-hours fail on the missing tables.
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
const exists = (table) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)

for (const table of ['daily_toast_employee_hours', 'toast_employees', 'benefits_enrollment_status']) {
  console.log(exists(table) ? `${table} already exists` : `Creating ${table}`)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_toast_employee_hours (
    date           TEXT NOT NULL,
    employee_guid  TEXT NOT NULL,
    hours          REAL NOT NULL,
    auto_clocked_out_shifts  INTEGER NOT NULL DEFAULT 0,
    auto_clocked_out_hours   REAL NOT NULL DEFAULT 0,
    synced_at      TEXT NOT NULL,
    PRIMARY KEY (date, employee_guid)
  );
  CREATE TABLE IF NOT EXISTS toast_employees (
    guid         TEXT PRIMARY KEY,
    first_name   TEXT,
    last_name    TEXT,
    chosen_name  TEXT,
    deleted      INTEGER NOT NULL DEFAULT 0,
    synced_at    TEXT NOT NULL
  );
`)

const ENROLLMENT_DDL = (name) => `
  CREATE TABLE ${name} (
    employee_guid  TEXT PRIMARY KEY,
    status         TEXT NOT NULL CHECK (status IN ('enrolled', 'declined', 'canceled')),
    note           TEXT,
    updated_at     TEXT NOT NULL
  )`

const current = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'benefits_enrollment_status'`).get()
if (!current) {
  db.exec(ENROLLMENT_DDL('benefits_enrollment_status'))
} else if (!current.sql.includes("'enrolled'")) {
  console.log('Rebuilding benefits_enrollment_status to allow status = enrolled (existing rows kept)')
  db.transaction(() => {
    db.exec('ALTER TABLE benefits_enrollment_status RENAME TO benefits_enrollment_status_old')
    db.exec(ENROLLMENT_DDL('benefits_enrollment_status'))
    db.exec('INSERT INTO benefits_enrollment_status SELECT employee_guid, status, note, updated_at FROM benefits_enrollment_status_old')
    db.exec('DROP TABLE benefits_enrollment_status_old')
  })()
}
db.close()
