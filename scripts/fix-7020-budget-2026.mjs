// One-time correction: fixes account 7020 (Loan Interest)'s budget_targets
// for Aug-Dec 2026, which had been populated with cash debt-service totals
// (including the Jones/Miller and Investor-7 catch-up interest lump sums)
// instead of P&L-only interest. Catch-up interest is a balance-sheet event
// (it clears 2365 Accrued Interest Payable, already expensed monthly via
// accrual journal entries as it accrued) — it should never hit account 7020
// again in the month it's paid. See CLAUDE.md's Debt Service section.
//
// The correct monthly figure is derived directly from loan_schedule rather
// than hardcoded: SUM(interest) across all loans for that calendar month,
// payment_type = 'regular' only (excluding 'catch_up' rows) — this is the
// same rule the app's own Cash Flow / P&L split already follows. Run
// scripts/fix-jones-miller-amortization.mjs first so loan_schedule reflects
// the corrected $2,750.31 Jones/Miller payment before this script reads it.
//
// Matches the budget row by account_number (not a raw account id) — ids for
// the same account differ across local dev and production (see CLAUDE.md's
// local/prod account-drift incident), so this script is safe to run
// unmodified against either database.
//
//   node scripts/fix-7020-budget-2026.mjs [path/to/restaurant.sqlite]
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

const YEAR = 2026
const MONTHS = [8, 9, 10, 11, 12]

const db = new Database(dbPath)

const account = db.prepare(`SELECT id FROM accounts WHERE account_number = '7020'`).get()
if (!account) {
  console.error(`No account found with account_number = '7020' in ${dbPath}`)
  process.exit(1)
}

const correctInterest = db.prepare(`
  SELECT ROUND(SUM(interest), 2) AS total FROM loan_schedule
  WHERE payment_type = 'regular'
    AND strftime('%Y', payment_date) = ?
    AND strftime('%m', payment_date) = ?
`)

const selectCurrent = db.prepare(`SELECT amount FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?`)
const upsert = db.prepare(`
  INSERT INTO budget_targets (year, month, account_id, amount) VALUES (?, ?, ?, ?)
  ON CONFLICT (year, month, account_id) DO UPDATE SET amount = excluded.amount
`)

console.log(`Fixing account 7020 (id=${account.id}) budget_targets for ${YEAR}, months ${MONTHS.join(',')} — ${dbPath}\n`)

const apply = db.transaction(() => {
  for (const month of MONTHS) {
    const monthStr = String(month).padStart(2, '0')
    const { total } = correctInterest.get(String(YEAR), monthStr)
    if (total === null) {
      console.log(`  ${YEAR}-${monthStr}: no loan_schedule 'regular' rows found — skipping.`)
      continue
    }
    const current = selectCurrent.get(YEAR, month, account.id)
    const currentAmount = current ? current.amount : null
    upsert.run(YEAR, month, account.id, total)
    console.log(`  ${YEAR}-${monthStr}: ${currentAmount === null ? '(none)' : '$' + currentAmount.toFixed(2)} -> $${total.toFixed(2)}`)
  }
})
apply()

db.close()
