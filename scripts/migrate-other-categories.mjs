// One-time migration: splits the old single category='other' bucket into
// other_income/other_expense (see CLAUDE.md's 2026-07-29 entry) so each
// account's real QBO sign is known instead of guessed. Needed because
// SQLite can't ALTER a CHECK constraint in place — this rebuilds the
// accounts table (rename -> recreate with the new CHECK -> copy rows ->
// drop old) rather than going through "npm run db:init", which would
// destroy real data (OAuth tokens, budget_targets, daily_line_items — see
// CLAUDE.md's "Running it" section).
//
//   node scripts/migrate-other-categories.mjs [path/to/restaurant.sqlite]
//
// Idempotent: exits immediately if the accounts table's CHECK constraint
// already mentions other_income (already migrated). Existing category=
// 'other' rows are reclassified by a fixed, hand-verified name list (this
// restaurant's real chart of accounts only ever had ~19 such rows — see
// CLAUDE.md) rather than guessed generically, since there's no stored QBO
// AccountType to re-derive it from at this point; going forward,
// qbo-account-sync.ts and import-budget-xlsx.mjs write other_income/
// other_expense directly from QBO's own AccountType, so this reclassification
// list never needs to grow.
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

// Every account name this restaurant's real chart of accounts has ever had
// under category='other' that's expense-shaped (subtracts from net income) —
// verified by hand against the real accounts table on 2026-07-29. Everything
// else under 'other' is income-shaped (Grant Income, Insurance Proceeds,
// Gain on Asset Sale, Interest Income, Credit card rewards, Misc Refunds &
// Credits, Cancellation of Debt Income, "Other income" itself, etc.).
const OTHER_EXPENSE_NAMES = new Set([
  'depreciation',
  'penalties & settlements',
  'reconciliation discrepancies',
  'miscellaneous'
])

const db = new Database(dbPath)

const { sql: accountsSql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get()
if (accountsSql.includes('other_income')) {
  console.log('accounts table already migrated (CHECK constraint already includes other_income) — nothing to do.')
  db.close()
  process.exit(0)
}

const otherRows = db.prepare("SELECT id, name FROM accounts WHERE category = 'other'").all()
console.log(`Found ${otherRows.length} account(s) with category='other' to reclassify.`)

const classification = new Map(otherRows.map(r => {
  const lower = r.name.trim().toLowerCase()
  return [r.id, OTHER_EXPENSE_NAMES.has(lower) ? 'other_expense' : 'other_income']
}))

for (const row of otherRows) {
  console.log(`  #${row.id} ${JSON.stringify(row.name)} -> ${classification.get(row.id)}`)
}

// PRAGMA foreign_keys is a no-op inside an active transaction, so it must
// be set before db.transaction() opens one below.
db.exec('PRAGMA foreign_keys = OFF')

const migrate = db.transaction(() => {
  db.exec(`
    CREATE TABLE accounts_new (
      id                 INTEGER PRIMARY KEY,
      qbo_account_id     TEXT UNIQUE,
      account_number     TEXT,
      parent_account_id  INTEGER REFERENCES accounts_new(id),
      name               TEXT NOT NULL,
      category           TEXT NOT NULL CHECK (category IN ('revenue', 'cogs', 'labor', 'opex', 'other_income', 'other_expense')),
      subcategory        TEXT,
      cost_behavior      TEXT CHECK (cost_behavior IN ('fixed', 'variable')),
      is_owner_compensation INTEGER NOT NULL DEFAULT 0,
      is_active          INTEGER NOT NULL DEFAULT 1
    )
  `)

  const allRows = db.prepare('SELECT * FROM accounts').all()
  const insert = db.prepare(`
    INSERT INTO accounts_new (id, qbo_account_id, account_number, parent_account_id, name, category, subcategory, cost_behavior, is_owner_compensation, is_active)
    VALUES (@id, @qbo_account_id, @account_number, @parent_account_id, @name, @category, @subcategory, @cost_behavior, @is_owner_compensation, @is_active)
  `)
  for (const row of allRows) {
    const category = row.category === 'other' ? classification.get(row.id) : row.category
    insert.run({ ...row, category })
  }

  db.exec('DROP TABLE accounts')
  db.exec('ALTER TABLE accounts_new RENAME TO accounts')
})

migrate()
db.exec('PRAGMA foreign_keys = ON')

const incomeCount = [...classification.values()].filter(c => c === 'other_income').length
const expenseCount = [...classification.values()].filter(c => c === 'other_expense').length
console.log(`\nMigrated accounts table: CHECK constraint now allows other_income/other_expense.`)
console.log(`Reclassified ${otherRows.length} account(s): ${incomeCount} -> other_income, ${expenseCount} -> other_expense.`)

db.close()
