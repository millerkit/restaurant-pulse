// One-time migration for the Kitchen Labor tab's BOH hours report (added
// 2026-11-06): creates daily_toast_job_hours and toast_jobs. See schema.sql.
//
//   node scripts/add-toast-job-hours-tables.mjs [path/to/restaurant.sqlite]
//
// Idempotent (CREATE TABLE IF NOT EXISTS, plus ADD COLUMN for the auto clock-out columns). Run against production BY HAND
// (fly ssh console) BEFORE `fly deploy`; the report route 500s on the missing
// tables. The nightly sync only warns if they're missing. After deploying,
// fill history with:
//   fly ssh console -C "node scripts/backfill-toast-employee-hours.mjs --since=YYYY-MM-DD"
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
for (const table of ['daily_toast_job_hours', 'toast_jobs']) {
  const exists = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
  console.log(exists ? `${table} already exists` : `Creating ${table}`)
}
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_toast_job_hours (
    date            TEXT NOT NULL,
    employee_guid   TEXT NOT NULL,
    job_guid        TEXT NOT NULL,
    regular_hours   REAL NOT NULL,
    overtime_hours  REAL NOT NULL,
    auto_clocked_out_shifts  INTEGER NOT NULL DEFAULT 0,
    auto_clocked_out_hours   REAL NOT NULL DEFAULT 0,
    synced_at       TEXT NOT NULL,
    PRIMARY KEY (date, employee_guid, job_guid)
  );
  CREATE TABLE IF NOT EXISTS toast_jobs (
    guid            TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    wage_frequency  TEXT,
    deleted         INTEGER NOT NULL DEFAULT 0,
    synced_at       TEXT NOT NULL
  );
`)
// Tables created before 2026-11-06 lack the auto clock-out columns.
const cols = db.prepare(`PRAGMA table_info(daily_toast_job_hours)`).all().map(c => c.name)
for (const [name, ddl] of [['auto_clocked_out_shifts', 'INTEGER NOT NULL DEFAULT 0'], ['auto_clocked_out_hours', 'REAL NOT NULL DEFAULT 0']]) {
  if (!cols.includes(name)) {
    console.log(`Adding daily_toast_job_hours.${name}`)
    db.exec(`ALTER TABLE daily_toast_job_hours ADD COLUMN ${name} ${ddl}`)
  }
}
db.close()
