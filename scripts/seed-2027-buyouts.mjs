// Plans 2 buyouts per month for 2027, rotated so every operating weekday gets the same number
// over the year (24 buyouts / 6 weekdays = 4 each), and applies them to the revenue budget the
// same way the Revenue tab's "Apply to <month>'s budget" button does:
//   increment = count x (buyout rate - that weekday's normal-night target)
//   split Food / Beverage by the real mix since the location move, Beverage further split across
//   the four beverage leaf accounts by their real mix, written into budget_targets and recorded
//   in revenue_buyout_applied so the Revenue tab can net against it on a later re-apply.
//
// Rotation (month -> weekdays): Jan Tue+Wed, Feb Thu+Fri, Mar Sat+Sun, then repeats.
//
//   node scripts/seed-2027-buyouts.mjs             # dry run: prints the plan and per-month increments
//   node scripts/seed-2027-buyouts.mjs --apply     # writes revenue_buyout_plan, budget_targets, revenue_buyout_applied
//   node scripts/seed-2027-buyouts.mjs --revert    # sets every month's buyout count to 0 and removes the applied amounts
// Options: --year=2027  --per-month=2  --db=/path/to/restaurant.sqlite
//          --normal=2:5385,3:8051,4:8642,5:10883,6:10745,0:6293   (dow:normal-night $, override the defaults)
//          --force   (apply even if a month has no revenue budget yet)
// Matches accounts by account_number (never by id). Run it AFTER "Build 2027 budget" has been applied,
// since it adds onto each month's existing revenue budget. Re-running --apply is safe: it nets against
// whatever was applied before, same as the Revenue tab.
//
// Normal-night targets come from computeWeeklyRevenueTargets(), which only runs inside the app, so the
// defaults below are the values the Revenue tab showed on 2026-11-02 (rounded to the dollar, so each
// buyout can be off by under $1). Pass --normal= to use different ones.
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = (name, fallback) => args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback
const YEAR = Number(opt('--year', '2027'))
const PER_MONTH = Number(opt('--per-month', '2'))
const REVERT = flag('--revert')
const APPLY = flag('--apply') || REVERT
const FORCE = flag('--force')
const dbPath = opt('--db', join(rootDir, 'data', 'restaurant.sqlite'))
if (!existsSync(dbPath)) { console.error(`Database not found at ${dbPath}`); process.exit(1) }

const NEW_LOCATION_START = '2026-06-20'
const OPERATING_DOWS = [2, 3, 4, 5, 6, 0] // Tue..Sat, Sun (Monday is closed)
const DOW_LABEL = { 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const normalNight = { 2: 5385, 3: 8051, 4: 8642, 5: 10883, 6: 10745, 0: 6293 }
for (const pair of (opt('--normal', '') || '').split(',').filter(Boolean)) {
  const [dow, amount] = pair.split(':').map(Number)
  if (!(dow in normalNight) || !Number.isFinite(amount)) { console.error(`Bad --normal entry: ${pair}`); process.exit(1) }
  normalNight[dow] = amount
}

const db = new Database(dbPath)

// ---- Rates, mixes, accounts -------------------------------------------------------------------
const rateRow = db.prepare('SELECT weekday_rate AS w, weekend_rate AS e FROM buyout_rates WHERE id = 1').get()
const weekdayRate = rateRow?.w ?? 10000
const weekendRate = rateRow?.e ?? 12000
const rateFor = dow => (dow === 5 || dow === 6 || dow === 0) ? weekendRate : weekdayRate

const accountByNumber = number => {
  const rows = db.prepare('SELECT id, name FROM accounts WHERE account_number = ? AND is_active = 1').all(number)
  if (rows.length !== 1) throw new Error(`Expected exactly one active account ${number}, found ${rows.length}`)
  return rows[0]
}
const foodAccount = accountByNumber('4010')

const beverageLeaves = db.prepare(`
  SELECT a.id, a.account_number AS number, a.name, COALESCE(SUM(dli.amount), 0) AS total
  FROM accounts a
  LEFT JOIN daily_line_items dli ON dli.account_id = a.id AND dli.date >= ?
  WHERE a.category = 'revenue' AND a.subcategory = 'Beverage' AND a.is_active = 1
    AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id AND c.is_active = 1)
  GROUP BY a.id ORDER BY a.account_number
`).all(NEW_LOCATION_START)
if (beverageLeaves.length === 0) throw new Error('No beverage revenue leaf accounts found')
const beverageTotal = beverageLeaves.reduce((s, a) => s + a.total, 0)
const hasBeverageMix = beverageTotal > 0

const fbRows = db.prepare(`
  SELECT a.subcategory AS grp, SUM(dli.amount) AS total
  FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
  WHERE a.category = 'revenue' AND a.account_number IN ('4010','4020','4022','4024','4026','4028') AND dli.date >= ?
  GROUP BY a.subcategory
`).all(NEW_LOCATION_START)
const foodTotal = fbRows.find(r => r.grp === 'Food')?.total || 0
const bevTotalWhole = fbRows.find(r => r.grp === 'Beverage')?.total || 0
const FOOD_PCT_FALLBACK = 0.65 // same fallback as the Revenue tab
const foodPct = foodTotal + bevTotalWhole > 0 ? foodTotal / (foodTotal + bevTotalWhole) : FOOD_PCT_FALLBACK
const beveragePct = 1 - foodPct

// ---- The plan ----------------------------------------------------------------------------------
// Month m (1-12) gets PER_MONTH consecutive weekdays from the rotation, starting where the last
// month left off, so the whole year is evenly spread.
const plan = [] // [{ month, counts: { dow: n } }]
let cursor = 0
for (let m = 1; m <= 12; m++) {
  const counts = Object.fromEntries(OPERATING_DOWS.map(d => [d, 0]))
  for (let i = 0; i < PER_MONTH; i++) {
    counts[OPERATING_DOWS[cursor % OPERATING_DOWS.length]] += 1
    cursor++
  }
  plan.push({ month: m, counts })
}

const monthRevenueBudget = month => db.prepare(`
  SELECT COALESCE(SUM(b.amount), 0) AS total
  FROM budget_targets b JOIN accounts a ON a.id = b.account_id
  WHERE b.year = ? AND b.month = ? AND a.category = 'revenue' AND a.is_active = 1
    AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id AND c.is_active = 1)
`).get(YEAR, month).total

const getBudget = (month, accountId) =>
  db.prepare('SELECT amount FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?').get(YEAR, month, accountId)?.amount ?? 0
const getApplied = (month, accountId) =>
  db.prepare('SELECT amount FROM revenue_buyout_applied WHERE year = ? AND month = ? AND account_id = ?').get(YEAR, month, accountId)?.amount ?? 0

const round2 = n => Math.round(n * 100) / 100
const money = n => `$${Math.round(n).toLocaleString()}`

// Per month: total increment, then per-account increments (food + each beverage leaf).
const writes = []
let grandTotal = 0
console.log(`Buyout rates: Tue-Thu ${money(weekdayRate)}, Fri-Sun ${money(weekendRate)}`)
console.log(`Food/Beverage split: ${(foodPct * 100).toFixed(1)}% / ${(beveragePct * 100).toFixed(1)}%${foodTotal + bevTotalWhole > 0 ? ' (real, since the move)' : ' (fallback; no sales data in this database)'}`)
console.log(`Beverage account split: ${hasBeverageMix ? 'real sales mix' : 'equal (no sales data in this database)'}\n`)

for (const { month, counts } of plan) {
  const days = OPERATING_DOWS.filter(d => counts[d] > 0).map(d => `${counts[d]}x ${DOW_LABEL[d]}`).join(', ')
  const increment = REVERT ? 0 : OPERATING_DOWS.reduce((s, d) => s + counts[d] * (rateFor(d) - normalNight[d]), 0)
  const foodInc = round2(increment * foodPct)
  const bevInc = increment * beveragePct
  const perAccount = [{ accountId: foodAccount.id, label: '4010 Food', inc: foodInc }]
  for (const a of beverageLeaves) {
    const weight = hasBeverageMix ? a.total / beverageTotal : 1 / beverageLeaves.length
    perAccount.push({ accountId: a.id, label: `${a.number} ${a.name}`, inc: round2(bevInc * weight) })
  }
  const monthBudgetBefore = monthRevenueBudget(month)
  const alreadyApplied = perAccount.reduce((s, p) => s + getApplied(month, p.accountId), 0)
  const delta = perAccount.reduce((s, p) => s + p.inc, 0) - alreadyApplied
  console.log(`${MONTH_NAMES[month - 1].padEnd(4)} ${REVERT ? '(revert)' : days.padEnd(18)} ` +
    `buyout adds ${money(perAccount.reduce((s, p) => s + p.inc, 0)).padStart(8)}  ` +
    `revenue budget ${money(monthBudgetBefore)} -> ${money(monthBudgetBefore + delta)}`)
  if (monthBudgetBefore === 0 && !FORCE && !REVERT) {
    console.error(`\n${MONTH_NAMES[month - 1]} ${YEAR} has no revenue budget yet. Run "Build 2027 budget" first (or pass --force).`)
    process.exit(1)
  }
  grandTotal += perAccount.reduce((s, p) => s + p.inc, 0)
  writes.push({ month, counts: REVERT ? Object.fromEntries(OPERATING_DOWS.map(d => [d, 0])) : counts, perAccount })
}
console.log(`\nTotal buyout revenue for ${YEAR}: ${money(grandTotal)}`)

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  process.exit(0)
}

// ---- Write -------------------------------------------------------------------------------------
const backupPath = `${dbPath}.pre-buyouts-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`
db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
console.log(`\nBackup written: ${backupPath} (contains QBO tokens; delete when done)`)

const upsertBudget = db.prepare(`
  INSERT INTO budget_targets (year, month, account_id, amount) VALUES (?, ?, ?, ?)
  ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount
`)
const upsertCount = db.prepare(`
  INSERT INTO revenue_buyout_plan (year, month, dow, count) VALUES (?, ?, ?, ?)
  ON CONFLICT(year, month, dow) DO UPDATE SET count = excluded.count
`)
const upsertApplied = db.prepare(`
  INSERT INTO revenue_buyout_applied (year, month, account_id, amount) VALUES (?, ?, ?, ?)
  ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount
`)
db.transaction(() => {
  for (const w of writes) {
    for (const p of w.perAccount) {
      const newAmount = round2(getBudget(w.month, p.accountId) - getApplied(w.month, p.accountId) + p.inc)
      upsertBudget.run(YEAR, w.month, p.accountId, newAmount)
      upsertApplied.run(YEAR, w.month, p.accountId, p.inc)
    }
    for (const d of OPERATING_DOWS) upsertCount.run(YEAR, w.month, d, w.counts[d])
  }
})()
console.log(`${REVERT ? 'Reverted' : 'Applied'} ${YEAR} buyouts for 12 months.`)
