// Dev-only synthetic daily_line_items seed — lets the Budget tab's actuals
// UI (Live Preview cards, closed/current-month tables, Overspending) be
// exercised on localhost without a real QBO sync, which the user
// deliberately won't run against sandbox/dev for Intuit security reasons
// (see CLAUDE.md's QBO OAuth hardening section on why credentials stay
// scoped and reconnect is a manual, user-driven step). Data here is
// entirely fabricated — it exists to make the UI look populated, not to
// approximate Urban Hearth's real numbers.
//
// Run: npm run db:seed-dev-actuals -- [--months=3] [--clear]
//
//   --months=N  how many months back (inclusive of the current month) to
//               seed, default 3. Only seeds months that already have
//               budget_targets rows for a given account — scales each
//               leaf account's synthetic daily amount off its own budget so
//               pace/variance figures look plausible instead of random, and
//               silently skips accounts/months with no budget to scale
//               from (nothing to seed against).
//   --clear     delete previously-seeded rows in the target month range
//               instead of writing new ones (does not touch other months).
//
// Safety: refuses to run if FLY_APP_NAME is set (only ever true inside a
// deployed Fly machine — this file should never be invoked there, since
// the production volume holds real synced data) or if QBO_ENVIRONMENT is
// explicitly 'production'.
//
// Idempotent per invocation (ON CONFLICT DO UPDATE, like the real backfill
// script) but NOT deterministic across runs — re-running regenerates fresh
// random noise rather than reproducing the same numbers. That's fine here:
// this is throwaway dev fixture data, not something anything else depends
// on matching byte-for-byte.
//
// Skips Mondays entirely (Urban Hearth is closed Mondays — see CLAUDE.md's
// "Tue-Sun operating days" note on the Edit Budget page), matching how a
// real sync would have no transactions, and therefore no report rows, for
// a day the restaurant didn't operate.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')

if (process.env.FLY_APP_NAME) {
  console.error('Refusing to run: FLY_APP_NAME is set, meaning this is executing inside a deployed Fly machine. This script only ever writes fabricated data and must never touch the production volume.')
  process.exit(1)
}
if (process.env.QBO_ENVIRONMENT === 'production') {
  console.error('Refusing to run: QBO_ENVIRONMENT=production. This script is for local/sandbox dev only.')
  process.exit(1)
}
if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=')
    args[key] = value ?? true
  }
  return args
}
const args = parseArgs(process.argv.slice(2))
const monthsBack = args.months ? Number(args.months) : 3
if (!Number.isInteger(monthsBack) || monthsBack < 1) {
  console.error(`--months must be a positive integer, got: ${args.months}`)
  process.exit(1)
}

const now = new Date()
const currentYear = now.getFullYear()
const currentMonth = now.getMonth() + 1
const today = now.getDate()

// Same operating-calendar rule as monthExpectedFraction in
// app/pages/budget/edit.vue: every day except Monday, capped at "today" for
// the current month so we never fabricate actuals for days that haven't
// happened yet.
function operatingDaysInMonth(year, month, throughDay) {
  const lastDay = new Date(year, month, 0).getDate()
  const cap = throughDay ?? lastDay
  const days = []
  for (let d = 1; d <= Math.min(cap, lastDay); d++) {
    const dow = new Date(year, month - 1, d).getDay() // 0=Sun..6=Sat
    if (dow !== 1) days.push(d) // skip Monday
  }
  return days
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Plain Math.random() jitter — no reproducibility requirement exists for
// throwaway fixture data (see header), so a seeded PRNG would be overkill.
function jitter(base, spreadPct) {
  const factor = 1 + (Math.random() * 2 - 1) * spreadPct
  return Math.max(0, base * factor)
}

const monthsToSeed = []
for (let i = monthsBack - 1; i >= 0; i--) {
  const d = new Date(currentYear, currentMonth - 1 - i, 1)
  monthsToSeed.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
}

const db = new Database(dbPath)

if (args.clear) {
  const del = db.prepare(`DELETE FROM daily_line_items WHERE date >= ? AND date <= ?`)
  const first = monthsToSeed[0]
  const last = monthsToSeed[monthsToSeed.length - 1]
  const lastDay = last.year === currentYear && last.month === currentMonth
    ? today
    : new Date(last.year, last.month, 0).getDate()
  const fromDate = isoDate(first.year, first.month, 1)
  const toDate = isoDate(last.year, last.month, lastDay)
  const result = del.run(fromDate, toDate)
  console.log(`Cleared ${result.changes} daily_line_items row(s) between ${fromDate} and ${toDate}.`)
  db.close()
  process.exit(0)
}

const leafAccounts = db.prepare(`
  SELECT a.id, a.name, a.category
  FROM accounts a
  WHERE a.is_active = 1
    AND a.id NOT IN (SELECT parent_account_id FROM accounts WHERE parent_account_id IS NOT NULL)
`).all()

const budgetStmt = db.prepare(`SELECT amount FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?`)
const upsert = db.prepare(`
  INSERT INTO daily_line_items (date, account_id, amount) VALUES (@date, @accountId, @amount)
  ON CONFLICT(date, account_id) DO UPDATE SET amount = excluded.amount
`)

let totalRows = 0
let totalAccountsSeeded = 0
let totalAccountsSkipped = 0

for (const { year, month } of monthsToSeed) {
  const isCurrentMonth = year === currentYear && month === currentMonth
  const throughDay = isCurrentMonth ? today : null
  const days = operatingDaysInMonth(year, month, throughDay)
  if (days.length === 0) continue

  const write = db.transaction(() => {
    let accountsSeeded = 0
    let accountsSkipped = 0
    let rows = 0
    for (const acc of leafAccounts) {
      const budgetRow = budgetStmt.get(year, month, acc.id)
      if (!budgetRow || !budgetRow.amount) { accountsSkipped++; continue }
      // A random overall pace (85%-108% of budget) per account so the
      // month's synthetic total isn't a suspiciously exact match to
      // budget — gives the pace meters/variance columns something real
      // to show, both "on pace" and "off pace" cases.
      const monthPaceFactor = 0.85 + Math.random() * 0.23
      const perDayBase = (budgetRow.amount * monthPaceFactor) / days.length
      for (const day of days) {
        const amount = Math.round(jitter(perDayBase, 0.25) * 100) / 100
        upsert.run({ date: isoDate(year, month, day), accountId: acc.id, amount })
        rows++
      }
      accountsSeeded++
    }
    return { accountsSeeded, accountsSkipped, rows }
  })()

  totalRows += write.rows
  totalAccountsSeeded += write.accountsSeeded
  totalAccountsSkipped += write.accountsSkipped
  console.log(`${year}-${String(month).padStart(2, '0')}: seeded ${write.accountsSeeded} account(s) across ${days.length} operating day(s) (${write.rows} row(s)); ${write.accountsSkipped} account(s) skipped (no budget to scale from)${isCurrentMonth ? ` — current month, through day ${today}` : ''}.`)
}

console.log(`Done. ${totalRows} synthetic daily_line_items row(s) written across ${monthsToSeed.length} month(s); ${totalAccountsSeeded} account-months seeded, ${totalAccountsSkipped} skipped.`)
console.log('Reminder: this data is entirely fabricated for local UI testing — never run this against the production database.')
db.close()
