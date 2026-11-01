// Models the Miller note deferral in loan_schedule (see CLAUDE.md's
// "Miller loan deferral" section): no payments Nov 15 2026 - Jun 15 2027, 3.82%
// interest accruing and capitalizing, then a level payment from Jul 15 2027
// through Jan 15 2032 (55 payments).
//
//   node scripts/defer-miller-loan.mjs            # dry run: prints the new schedule
//   node scripts/defer-miller-loan.mjs --apply    # rewrites Miller's rows from Nov 2026 on
//   node scripts/defer-miller-loan.mjs --revert   # restores the rows saved by --apply
//
// Only loan_key='miller' rows dated on/after 2026-11-01 are touched (Aug-Oct
// 2026 payments and the Aug catch-up already happened). --apply saves the
// replaced rows in loan_schedule_miller_backup first and refuses to run twice.
// The opening balance is the schedule's own remaining principal, not the
// note's statement balance - if the real balance differs, change nothing here
// by hand; pass --balance=<amount> to re-run after --revert.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const balanceArg = args.find(a => a.startsWith('--balance='))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')
if (!existsSync(dbPath)) { console.error(`Database not found at ${dbPath}`); process.exit(1) }

const ANNUAL_RATE = 0.0382
const DEFERRED_MONTHS = 8 // Nov 15 2026 .. Jun 15 2027
const RESUME = { year: 2027, month: 7 }
const PAYMENTS = 55 // Jul 15 2027 .. Jan 15 2032
const CUTOFF = '2026-11-01'
const r = ANNUAL_RATE / 12
const round2 = (n) => Math.round(n * 100) / 100

const db = new Database(dbPath)
const backupExists = !!db.prepare("SELECT name FROM sqlite_master WHERE name='loan_schedule_miller_backup'").get()

if (flag('--revert')) {
  if (!backupExists) { console.error('No backup table - nothing to revert.'); process.exit(1) }
  db.transaction(() => {
    db.prepare("DELETE FROM loan_schedule WHERE loan_key='miller' AND payment_date >= ?").run(CUTOFF)
    db.exec(`INSERT INTO loan_schedule (loan_key, lender, payment_date, payment_type, interest, principal, total_payment)
             SELECT loan_key, lender, payment_date, payment_type, interest, principal, total_payment FROM loan_schedule_miller_backup`)
    db.exec('DROP TABLE loan_schedule_miller_backup')
  })()
  console.log('Reverted Miller rows to the original schedule.')
  process.exit(0)
}

const existing = db.prepare("SELECT * FROM loan_schedule WHERE loan_key='miller' AND payment_date >= ? ORDER BY payment_date").all(CUTOFF)
if (backupExists) { console.error('Already applied (backup table exists). Run --revert first.'); process.exit(1) }
if (!existing.length) { console.error('No Miller rows on/after Nov 2026.'); process.exit(1) }
const lender = existing[0].lender

const principal0 = balanceArg ? Number(balanceArg.split('=')[1]) : round2(existing.reduce((s, x) => s + x.principal, 0))
const accruedMonthly = principal0 * r // P&L accrual, simple on the uncapitalized principal
const capitalized = principal0 * r * DEFERRED_MONTHS
const balance = principal0 + capitalized
const payment = round2((balance * r) / (1 - Math.pow(1 + r, -PAYMENTS)))

const rows = []
let b = balance
for (let i = 0; i < PAYMENTS; i++) {
  const month0 = RESUME.month - 1 + i
  const date = `${RESUME.year + Math.floor(month0 / 12)}-${String((month0 % 12) + 1).padStart(2, '0')}-15`
  const interest = round2(b * r)
  const pay = i === PAYMENTS - 1 ? round2(b + interest) : payment
  const princ = round2(pay - interest)
  b = round2(b - princ)
  rows.push({ date, interest, principal: princ, total: pay })
}

const oldTotal = existing.reduce((s, x) => s + x.total_payment, 0)
const oldInterest = existing.reduce((s, x) => s + x.interest, 0)
const newInterest = rows.reduce((s, x) => s + x.interest, 0) + capitalized
console.log(`Opening principal ${principal0.toFixed(2)}; accrued+capitalized ${capitalized.toFixed(2)} (${accruedMonthly.toFixed(2)}/mo); balance at resume ${balance.toFixed(2)}`)
console.log(`Level payment ${payment.toFixed(2)} x ${PAYMENTS}, ${rows[0].date} -> ${rows[rows.length - 1].date}; final balance ${b.toFixed(2)}`)
console.log(`Remaining payments: old ${existing.length} totaling ${oldTotal.toFixed(2)}, new ${rows.length} totaling ${rows.reduce((s, x) => s + x.total, 0).toFixed(2)}`)
console.log(`Total interest from Nov 2026: old ${oldInterest.toFixed(2)}, new ${newInterest.toFixed(2)} (+${(newInterest - oldInterest).toFixed(2)})`)

if (!flag('--apply')) { console.log('\nDry run - pass --apply to write.'); process.exit(0) }

db.transaction(() => {
  db.exec(`CREATE TABLE loan_schedule_miller_backup AS SELECT loan_key, lender, payment_date, payment_type, interest, principal, total_payment FROM loan_schedule WHERE loan_key='miller' AND payment_date >= '${CUTOFF}'`)
  db.prepare("DELETE FROM loan_schedule WHERE loan_key='miller' AND payment_date >= ?").run(CUTOFF)
  const ins = db.prepare("INSERT INTO loan_schedule (loan_key, lender, payment_date, payment_type, interest, principal, total_payment) VALUES ('miller', ?, ?, 'regular', ?, ?, ?)")
  for (const x of rows) ins.run(lender, x.date, x.interest, x.principal, x.total)
})()
console.log('Applied.')
