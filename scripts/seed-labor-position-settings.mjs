// One-time seed for the Labor tab (see CLAUDE.md's Labor tab section): creates a
// labor_position_settings row (plus one blank labor_position_slots row for hourly/salary
// accounts) for every labor leaf account the Labor tab manages, classified by a
// first-pass pay_type rule from the account name/parent — editable afterward on the
// Labor tab itself, same "classify now, revise later" posture as
// accounts.cost_behavior/is_owner_compensation. Matches accounts by account_number, never
// raw id, per this repo's standing cross-environment discipline (see CLAUDE.md).
//
// Does NOT touch budget_targets — existing budgeted figures for these accounts are left
// completely untouched until the user fills in real numbers on the Labor tab and saves.
//
// Idempotent: skips any account that already has a labor_position_settings row.
//
//   node scripts/seed-labor-position-settings.mjs [path/to/restaurant.sqlite]
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(rootDir, 'data', 'restaurant.sqlite')

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`)
  process.exit(1)
}

const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS labor_position_settings (
    account_id               INTEGER PRIMARY KEY REFERENCES accounts(id),
    pay_type                 TEXT NOT NULL CHECK (pay_type IN ('hourly', 'salary', 'overtime', 'flat', 'tax')),
    scales_with_seasonality  INTEGER NOT NULL DEFAULT 1,
    ot_hours                 REAL NOT NULL DEFAULT 0,
    ot_base_group            TEXT CHECK (ot_base_group IN ('boh', 'foh')),
    flat_amount              REAL NOT NULL DEFAULT 0,
    tax_key                  TEXT CHECK (tax_key IN ('medicare', 'social_security', 'futa', 'suta_ma', 'pfml_ma')),
    updated_at                TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS labor_position_slots (
    id             INTEGER PRIMARY KEY,
    account_id     INTEGER NOT NULL REFERENCES accounts(id),
    slot_index     INTEGER NOT NULL,
    employee_name  TEXT,
    hourly_rate    REAL NOT NULL DEFAULT 0,
    weekly_hours   REAL NOT NULL DEFAULT 0,
    weekly_salary  REAL NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL,
    UNIQUE (account_id, slot_index)
  );
  CREATE TABLE IF NOT EXISTS labor_tax_rates (
    id                    INTEGER PRIMARY KEY CHECK (id = 1),
    medicare_rate         REAL NOT NULL,
    social_security_rate  REAL NOT NULL,
    futa_rate             REAL NOT NULL,
    suta_ma_rate          REAL NOT NULL,
    pfml_ma_rate          REAL NOT NULL,
    updated_at            TEXT NOT NULL
  );
`)

// account_number -> classification. 6082 Employer FICA Tax is deliberately absent
// (unused/legacy, excluded per the user).
const HOURLY = ['6012', '6016', '6018', '6019', '6021', '6023', '6025', '6031', '6032', '6033', '6035', '6037', '6038', '6039', '6040', '6044']
const SALARY = ['6051', '6054', '6055', '6056', '6057', '6058']
const FLAT = ['6003', '6006', '6015', '6061', '6062', '6063', '6065', '6066']
const OVERTIME = { 6026: 'boh', 6036: 'foh' }
const TAX = { 6083: 'futa', 6084: 'medicare', 6085: 'pfml_ma', 6086: 'social_security', 6087: 'suta_ma' }

const now = new Date().toISOString()
const accountByNumber = new Map(
  db.prepare(`SELECT id, account_number FROM accounts WHERE is_active = 1 AND account_number IS NOT NULL`).all()
    .map(r => [r.account_number, r.id])
)

const insertSettings = db.prepare(`
  INSERT INTO labor_position_settings (account_id, pay_type, scales_with_seasonality, ot_hours, ot_base_group, flat_amount, tax_key, updated_at)
  VALUES (@accountId, @payType, @scalesWithSeasonality, @otHours, @otBaseGroup, @flatAmount, @taxKey, @updatedAt)
`)
const insertSlot = db.prepare(`
  INSERT INTO labor_position_slots (account_id, slot_index, employee_name, hourly_rate, weekly_hours, weekly_salary, updated_at)
  VALUES (@accountId, 1, NULL, 0, 0, 0, @updatedAt)
`)
const alreadySeeded = db.prepare(`SELECT 1 FROM labor_position_settings WHERE account_id = ?`)

let inserted = 0
let skippedExisting = 0
let missingAccounts = []

const seedOne = db.transaction((accountId, payType, extra = {}) => {
  if (alreadySeeded.get(accountId)) { skippedExisting++; return }
  insertSettings.run({
    accountId, payType,
    scalesWithSeasonality: extra.scalesWithSeasonality ?? 1,
    otHours: extra.otHours ?? 0,
    otBaseGroup: extra.otBaseGroup ?? null,
    flatAmount: extra.flatAmount ?? 0,
    taxKey: extra.taxKey ?? null,
    updatedAt: now
  })
  if (payType === 'hourly' || payType === 'salary') {
    insertSlot.run({ accountId, updatedAt: now })
  }
  inserted++
})

function resolve(accountNumber) {
  const id = accountByNumber.get(accountNumber)
  if (!id) missingAccounts.push(accountNumber)
  return id
}

for (const num of HOURLY) {
  const id = resolve(num)
  if (id) seedOne(id, 'hourly')
}
for (const num of SALARY) {
  const id = resolve(num)
  if (id) seedOne(id, 'salary')
}
for (const num of FLAT) {
  const id = resolve(num)
  if (id) seedOne(id, 'flat')
}
for (const [num, group] of Object.entries(OVERTIME)) {
  const id = resolve(num)
  if (id) seedOne(id, 'overtime', { otBaseGroup: group })
}
for (const [num, taxKey] of Object.entries(TAX)) {
  const id = resolve(num)
  if (id) seedOne(id, 'tax', { taxKey })
}

if (missingAccounts.length > 0) {
  console.warn(`Warning: no active account found for account_number(s): ${missingAccounts.join(', ')}`)
}
console.log(`Inserted ${inserted} labor_position_settings row(s); skipped ${skippedExisting} already-seeded account(s).`)

// Seed labor_tax_rates with a starting suggestion, if not already set. Medicare/Social
// Security use the stable federal statutory rates (don't vary by employer or state).
// FUTA/SUTA MA/PFML MA are backed out from real trailing actuals when available
// (SUM(real tax $) / SUM(real wage-subject $) over the last few closed months with
// data) — an imprecise but real-data-grounded starting point, editable on the Labor
// tab. Falls back to 0 (clearly "unset," not a fabricated statutory guess) when there's
// no real data yet to derive a suggestion from.
const existingRates = db.prepare(`SELECT 1 FROM labor_tax_rates WHERE id = 1`).get()
if (!existingRates) {
  const wageSubjectAccountIds = new Set(
    db.prepare(`
      SELECT a.id FROM accounts a
      WHERE a.category = 'labor'
        AND a.id NOT IN (
          SELECT id FROM accounts WHERE account_number IN ('6060', '6080')
          UNION
          SELECT id FROM accounts WHERE parent_account_id IN (SELECT id FROM accounts WHERE account_number IN ('6060', '6080'))
        )
    `).all().map(r => r.id)
  )

  function impliedRate(taxAccountNumber) {
    const taxAccount = db.prepare(`SELECT id FROM accounts WHERE account_number = ?`).get(taxAccountNumber)
    if (!taxAccount) return 0
    const months = db.prepare(`
      SELECT DISTINCT strftime('%Y-%m', date) AS ym FROM daily_line_items WHERE account_id = ? ORDER BY ym DESC LIMIT 6
    `).all(taxAccount.id).map(r => r.ym)
    if (months.length === 0) return 0
    const placeholders = months.map(() => '?').join(',')
    const taxTotal = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM daily_line_items WHERE account_id = ? AND strftime('%Y-%m', date) IN (${placeholders})
    `).get(taxAccount.id, ...months).total
    if (wageSubjectAccountIds.size === 0) return 0
    const wagePlaceholders = [...wageSubjectAccountIds].map(() => '?').join(',')
    const wageTotal = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM daily_line_items
      WHERE account_id IN (${wagePlaceholders}) AND strftime('%Y-%m', date) IN (${placeholders})
    `).get(...wageSubjectAccountIds, ...months).total
    return wageTotal > 0 ? Math.round((taxTotal / wageTotal) * 10000) / 10000 : 0
  }

  const futaRate = impliedRate('6083')
  const sutaMaRate = impliedRate('6087')
  const pfmlMaRate = impliedRate('6085')

  db.prepare(`
    INSERT INTO labor_tax_rates (id, medicare_rate, social_security_rate, futa_rate, suta_ma_rate, pfml_ma_rate, updated_at)
    VALUES (1, 0.0145, 0.062, ?, ?, ?, ?)
  `).run(futaRate, sutaMaRate, pfmlMaRate, now)

  console.log(`Seeded labor_tax_rates: medicare 1.45%, social security 6.2% (statutory); FUTA ${(futaRate * 100).toFixed(2)}%, SUTA MA ${(sutaMaRate * 100).toFixed(2)}%, PFML MA ${(pfmlMaRate * 100).toFixed(2)}% (implied from trailing actuals, or 0 if no data yet) — all editable on the Labor tab.`)
} else {
  console.log('labor_tax_rates already seeded — left untouched.')
}

db.close()
