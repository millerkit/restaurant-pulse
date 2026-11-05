// Budgets 2027 On-Site Events revenue: $200K for the year, the same amount every month, split
// Food (4150) / Beverage (4145) in the proportion of the 2026 On-Site Events budget
// ($69,780 food / $16,911 beverage = 80.5% / 19.5%). Sets (does not add to) those two accounts'
// 2027 budget_targets; the 4140 parent is a rollup and is never written.
//
//   node scripts/seed-2027-onsite-events.mjs             # dry run: prints current vs new per month
//   node scripts/seed-2027-onsite-events.mjs --apply     # writes budget_targets (previous values saved)
//   node scripts/seed-2027-onsite-events.mjs --revert    # restores the values --apply replaced
// Options: --year=2027  --annual=200000  --food=69780 --bev=16911 (the split basis)  --db=/path/to/restaurant.sqlite
// Matches accounts by account_number (never by id). Previous values live in
// budget_targets_backup_2027_onsite (no QBO tokens), written on the first --apply only, so a
// second --apply cannot overwrite the originals.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = (name, fallback) => args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback
const YEAR = Number(opt('--year', '2027'))
const ANNUAL = Number(opt('--annual', '200000'))
const FOOD_BASIS = Number(opt('--food', '69780'))
const BEV_BASIS = Number(opt('--bev', '16911'))
const REVERT = flag('--revert')
const APPLY = flag('--apply')
const dbPath = opt('--db', join(rootDir, 'data', 'restaurant.sqlite'))
if (!existsSync(dbPath)) { console.error(`Database not found at ${dbPath}`); process.exit(1) }
if (!(ANNUAL > 0) || !(FOOD_BASIS > 0) || !(BEV_BASIS > 0)) { console.error('--annual, --food and --bev must be positive'); process.exit(1) }

const db = new Database(dbPath)
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const round2 = n => Math.round(n * 100) / 100
const money = n => `$${Math.round(n).toLocaleString()}`

const accountByNumber = number => {
  const rows = db.prepare('SELECT id, name FROM accounts WHERE account_number = ? AND is_active = 1').all(number)
  if (rows.length !== 1) throw new Error(`Expected exactly one active account ${number}, found ${rows.length}`)
  return rows[0]
}
const food = accountByNumber('4150')
const bev = accountByNumber('4145')

const getBudget = (month, accountId) =>
  db.prepare('SELECT amount FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?').get(YEAR, month, accountId)?.amount ?? null

db.exec(`CREATE TABLE IF NOT EXISTS budget_targets_backup_2027_onsite (
  year INTEGER NOT NULL, month INTEGER NOT NULL, account_id INTEGER NOT NULL,
  prev_amount REAL, PRIMARY KEY (year, month, account_id)
)`)

if (REVERT) {
  const rows = db.prepare('SELECT month, account_id AS accountId, prev_amount AS prev FROM budget_targets_backup_2027_onsite WHERE year = ?').all(YEAR)
  if (rows.length === 0) { console.error('Nothing to revert: no saved previous values.'); process.exit(1) }
  db.transaction(() => {
    for (const r of rows) {
      if (r.prev == null) db.prepare('DELETE FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?').run(YEAR, r.month, r.accountId)
      else db.prepare(`INSERT INTO budget_targets (year, month, account_id, amount) VALUES (?, ?, ?, ?)
        ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount`).run(YEAR, r.month, r.accountId, r.prev)
    }
    db.prepare('DELETE FROM budget_targets_backup_2027_onsite WHERE year = ?').run(YEAR)
  })()
  console.log(`Restored ${rows.length} budget entries for ${YEAR}.`)
  process.exit(0)
}

const monthly = round2(ANNUAL / 12)
const foodPct = FOOD_BASIS / (FOOD_BASIS + BEV_BASIS)
const foodAmt = round2(monthly * foodPct)
const bevAmt = round2(monthly - foodAmt)
console.log(`On-Site Events ${YEAR}: ${money(ANNUAL)} / 12 = ${money(monthly)} a month`)
console.log(`Split ${(foodPct * 100).toFixed(1)}% food / ${((1 - foodPct) * 100).toFixed(1)}% beverage -> 4150 ${money(foodAmt)}, 4145 ${money(bevAmt)}\n`)
for (let m = 1; m <= 12; m++) {
  console.log(`${MONTH_NAMES[m - 1].padEnd(4)} 4150 ${money(getBudget(m, food.id) ?? 0)} -> ${money(foodAmt)}   4145 ${money(getBudget(m, bev.id) ?? 0)} -> ${money(bevAmt)}`)
}
console.log(`\nYear total: ${money((foodAmt + bevAmt) * 12)}`)

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0) }

const saveBackup = db.prepare('INSERT OR IGNORE INTO budget_targets_backup_2027_onsite (year, month, account_id, prev_amount) VALUES (?, ?, ?, ?)')
const upsert = db.prepare(`INSERT INTO budget_targets (year, month, account_id, amount) VALUES (?, ?, ?, ?)
  ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount`)
db.transaction(() => {
  for (let m = 1; m <= 12; m++) {
    for (const [acc, amt] of [[food, foodAmt], [bev, bevAmt]]) {
      saveBackup.run(YEAR, m, acc.id, getBudget(m, acc.id))
      upsert.run(YEAR, m, acc.id, amt)
    }
  }
})()
console.log(`\nApplied ${YEAR} On-Site Events budget for 12 months.`)
