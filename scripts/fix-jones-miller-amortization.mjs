// One-time correction: recomputes the 'regular' loan_schedule rows for the
// Jones and Miller loans using the $2,750.31 monthly payment confirmed by
// the signed promissory notes (UrbanHearth_Jones_Promissory_Note.pdf /
// UrbanHearth_Miller_Promissory_Note.pdf), replacing the $2,745.91 figure
// imported from investor_loans_v6.xlsx's "2750 Jones"/"2755 Miller" tabs.
//
// $2,745.91 was a real error in that workbook, not just an outdated
// figure — verified by recomputation: it doesn't fully amortize $150,000 at
// 3.82%/12 over 60 months (it leaves a $290.43 balance). $2,750.31 is the
// mathematically correct fully-amortizing payment (ends within $0.04 of
// zero). See the Debt Service section of CLAUDE.md.
//
// Deliberately a standalone recomputation, not a re-run of
// import-debt-schedule.mjs — that script deletes and re-inserts every loan's
// rows from the source xlsx, which would also require an edited copy of the
// (not-checked-in) xlsx and would touch the other 8 loans' already-correct
// rows for no reason. This only UPDATEs jones/miller 'regular' rows, matched
// by (loan_key, payment_date, payment_type) — stable across environments,
// unlike a raw id (see CLAUDE.md's local/prod account-drift incident for why
// that distinction matters). 'catch_up' rows are untouched — both PDFs
// confirm the catch-up interest figures ($1,146.00 Jones / $1,130.30 Miller)
// exactly match what's already in the database.
//
// Idempotent: recomputes the full schedule from scratch (principal,
// rate, payment) every run rather than adjusting existing values.
//
//   node scripts/fix-jones-miller-amortization.mjs [path/to/restaurant.sqlite]
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

const PRINCIPAL = 150000
const ANNUAL_RATE = 0.0382
const MONTHLY_PAYMENT = 2750.31
const MONTHLY_RATE = ANNUAL_RATE / 12

const db = new Database(dbPath)

const selectRegular = db.prepare(`
  SELECT payment_date FROM loan_schedule
  WHERE loan_key = ? AND payment_type = 'regular'
  ORDER BY payment_date ASC
`)
const updateRegular = db.prepare(`
  UPDATE loan_schedule SET interest = ?, principal = ?, total_payment = ?
  WHERE loan_key = ? AND payment_date = ? AND payment_type = 'regular'
`)

function recompute(loanKey) {
  const dates = selectRegular.all(loanKey).map(r => r.payment_date)
  if (dates.length === 0) {
    console.log(`  ${loanKey}: no 'regular' rows found — nothing to update.`)
    return
  }
  let balance = PRINCIPAL
  const update = db.transaction(() => {
    for (const date of dates) {
      const interest = Math.round(balance * MONTHLY_RATE * 100) / 100
      const principal = Math.round((MONTHLY_PAYMENT - interest) * 100) / 100
      balance = Math.round((balance - principal) * 100) / 100
      updateRegular.run(interest, principal, MONTHLY_PAYMENT, loanKey, date)
    }
  })
  update()
  console.log(`  ${loanKey}: updated ${dates.length} regular payment(s), ${dates[0]} -> ${dates[dates.length - 1]}. Ending balance: $${balance.toFixed(2)}`)
}

console.log(`Recomputing Jones/Miller amortization at $${MONTHLY_PAYMENT}/month (was $2,745.91) against ${dbPath}`)
recompute('jones')
recompute('miller')

const check = db.prepare(`
  SELECT loan_key, payment_date, interest, principal, total_payment
  FROM loan_schedule WHERE loan_key IN ('jones','miller') AND payment_type = 'regular'
  ORDER BY loan_key, payment_date LIMIT 6
`).all()
console.log('\nFirst rows after update (sanity check):')
for (const r of check) console.log(`  ${r.loan_key} ${r.payment_date}  interest=${r.interest.toFixed(2)}  principal=${r.principal.toFixed(2)}  total=${r.total_payment.toFixed(2)}`)

db.close()
