// One-time migration for two Labor-tab inputs (added 2026-10-07):
//   - labor_tax_rates.taxable_tips_per_payroll — tips added to the Social Security/Medicare
//     wage base each weekly payroll (REAL, default 0).
//   - labor_position_slots.first_paycheck_date — ISO date (nullable) of a person's first
//     paycheck; payroll Fridays before it are not modeled for that person.
// See schema.sql and CLAUDE.md's "Labor tips and first-paycheck dates" section.
//
//   node scripts/add-labor-tips-and-start-dates.mjs [path/to/restaurant.sqlite]
//
// Idempotent: each ALTER is skipped if the column already exists. Run against
// production BY HAND (fly ssh console) BEFORE `fly deploy`, or /api/budget/labor-settings 500s.
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
const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)

if (!has('labor_tax_rates', 'taxable_tips_per_payroll')) {
  db.exec(`ALTER TABLE labor_tax_rates ADD COLUMN taxable_tips_per_payroll REAL NOT NULL DEFAULT 0`)
  console.log('Added labor_tax_rates.taxable_tips_per_payroll (default 0)')
} else console.log('labor_tax_rates.taxable_tips_per_payroll already exists')

if (!has('labor_position_slots', 'first_paycheck_date')) {
  db.exec(`ALTER TABLE labor_position_slots ADD COLUMN first_paycheck_date TEXT`)
  console.log('Added labor_position_slots.first_paycheck_date')
} else console.log('labor_position_slots.first_paycheck_date already exists')
