// Second pass of the 2027 budget, after the Edit Budget page's "Build 2027 budget" (fixed opex,
// Capacity revenue, Labor-tab labor — see CLAUDE.md's "2027 budget" section). Fills in what that
// leaves blank, from real numbers instead of guesses:
//
//   explicit, from the user (2026-11-02): 1281 Cambridge St rent 6510 = $11,500/mo; Mass Ave
//     lease 7920 = $2,950/mo (kept for all of 2027); Mass Ave sublet income 8030 = $5,000/mo.
//   electricity 6521 and gas 6522: seasonal Cambridge St profiles built from the utility-bill
//     export (see ELECTRIC_CAMBRIDGE / GAS_CAMBRIDGE below) plus a small Mass Ave baseline each.
//   COGS: Food = trailing Food COGS % x each month's Food revenue budget; each beverage COGS
//     account = its own trailing % of its paired revenue account (same pairing as the Edit Budget
//     page's recompute); packaging/draft supplies = trailing monthly average.
//   processing fees (Stripe 6210, Toast 6220): trailing % of total revenue x each month's revenue.
//   every other variable opex account: trailing monthly average, flat across the year.
//
// Deliberately NOT touched: gain on asset sale (8010 — timing unknown), depreciation (7910 — TBD),
// catering/retail COGS (their revenue isn't budgeted), labor, revenue, fixed opex.
//
// "Trailing" = the closed months since the new location settled (default 2026-08-01 on, newest 3),
// never a month the nightly sync hasn't fully reached.
//
//   node scripts/seed-2027-budget-extras.mjs                 # dry run: prints the plan + net income
//   node scripts/seed-2027-budget-extras.mjs --apply         # writes 2027 budget_targets
//   node scripts/seed-2027-budget-extras.mjs --revert        # restores what --apply replaced
// Options: --year=2027  --since=2026-08-01  --exclude=6xxx,6yyy (variable accounts to skip)
//          --food-pct=0.265 (override the computed Food COGS %)  --db=/path/to/restaurant.sqlite
// Matches every account by account_number (never by id — local dev and production ids differ).
// Run it AFTER "Build 2027 budget" has been applied (it needs the 2027 revenue budget).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = (name, fallback) => args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback
const YEAR = Number(opt('--year', '2027'))
const SINCE = opt('--since', '2026-08-01')
const EXCLUDE = new Set((opt('--exclude', '') || '').split(',').filter(Boolean))
const FOOD_PCT_OVERRIDE = opt('--food-pct') ? Number(opt('--food-pct')) : null
const dbPath = opt('--db', join(rootDir, 'data', 'restaurant.sqlite'))
if (!existsSync(dbPath)) { console.error(`Database not found at ${dbPath}`); process.exit(1) }
const db = new Database(dbPath)

// ---- Inputs from the user / bills --------------------------------------------------------
const CAMBRIDGE_RENT = 11500
const MASS_AVE_RENT = 2950
const SUBLET_INCOME = 5000
// Electricity, 1281 Cambridge St. Evidence (Eversource export, new location opened 2026-06-20):
// Jul $4,643 | Aug+Sep two bills totalling $12,503 (~$6,250/mo) | Oct $2,886 (mild month, little
// HVAC, so a good read on base load). Pre-opening empty-building months ($380-$1,360) are not
// representative. No winter data exists for the open restaurant, so Nov-Mar assume base load plus
// a little for shorter days; heat is gas. Warm months use the observed Jul-Sep average (~$5,700),
// June a little lower (cooling just starting), Apr/May ramping up. Bills post on a cash basis, so
// an individual month's actual will be lumpy around these.
const ELECTRIC_CAMBRIDGE = [3200, 3200, 3000, 3000, 3600, 4650, 5700, 5700, 5700, 3000, 3000, 3200]
// Mass Ave keeps a small electric bill while the lease runs (Aug-Oct 2026 bills: $483, $481, $918, $335).
// Assumed to stay with us until the sublet's utility terms are settled; set to 0 if the subtenant pays.
const ELECTRIC_MASS_AVE = 450

// Gas, 1281 Cambridge St. Evidence: open-restaurant bills Jul $639 | Aug $726 | Sep $688 | Oct $785
// (cooking + hot water, heating just starting in Oct); pre-opening empty-building bills ($118-$670)
// are not representative. Winter costs more: heating plus demand pricing, and the existing Dec 2026
// budget already assumed $1,300 for Dec and $900 for Nov (no winter history at this location yet).
// Profile: ~$700 summer base, rising from Oct, Dec-Feb peak (Jan/Feb a little above Dec as the
// coldest months). Winter figures are assumptions to be replaced by real bills after this winter.
const GAS_CAMBRIDGE = [1400, 1400, 1200, 900, 750, 700, 700, 725, 725, 800, 950, 1300]
// Mass Ave gas is essentially off now ($21-$23/mo bills since the move).
const GAS_MASS_AVE = 25

// OpenTable's $60K signing incentive is recognized as a $5,000/mo credit on 6305 Reservation
// Platform Fees; the user confirmed (2026-11-03) it ends after July 2027. The trailing window already
// nets the credit against the real fees, so 6305 is budgeted at the net trailing average through July
// and at the gross fees (net + credit) from August.
const OPENTABLE_CREDIT = 5000
const OPENTABLE_CREDIT_LAST_MONTH = 7
// One-off credits in the trailing window that won't recur — never budgeted.
const ONE_OFF_CREDITS = new Map([['6644', 'amplifier refund (one-off)']])

// ---- Helpers -------------------------------------------------------------------------------
const months = Array.from({ length: 12 }, (_, i) => i + 1)
const round2 = n => Math.round(n * 100) / 100
const money = n => `$${Math.round(n).toLocaleString()}`
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`

const accounts = db.prepare('SELECT * FROM accounts WHERE is_active = 1').all()
const childIds = new Set(accounts.filter(a => a.parent_account_id != null).map(a => a.parent_account_id))
const isLeaf = a => !childIds.has(a.id)
function byNumber(num, category) {
  const hits = accounts.filter(a => a.account_number === num && (!category || a.category === category))
  if (hits.length !== 1) throw new Error(`Expected exactly one active account ${num}${category ? ` (${category})` : ''}, found ${hits.length}. If it was just created in QBO, run "Sync now" first.`)
  if (!isLeaf(hits[0])) throw new Error(`Account ${num} has sub-accounts; budget the leaves instead`)
  return hits[0]
}

// ---- Revert ----------------------------------------------------------------------------------
const BACKUP = 'budget_targets_backup_2027_extras'
const backupExists = !!db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(BACKUP)
if (flag('--revert')) {
  if (!backupExists) { console.error('No backup table — nothing to revert.'); process.exit(1) }
  db.transaction(() => {
    for (const r of db.prepare(`SELECT * FROM ${BACKUP}`).all()) {
      if (r.existed) db.prepare('UPDATE budget_targets SET amount = ? WHERE year = ? AND month = ? AND account_id = ?').run(r.amount, r.year, r.month, r.account_id)
      else db.prepare('DELETE FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?').run(r.year, r.month, r.account_id)
    }
    db.exec(`DROP TABLE ${BACKUP}`)
  })()
  console.log('Reverted.')
  process.exit(0)
}
if (flag('--apply') && backupExists) { console.error(`Already applied (${BACKUP} exists). Run --revert first.`); process.exit(1) }

// ---- Existing 2027 budget (what the Build wrote) --------------------------------------------
const budgetRows = db.prepare('SELECT month, account_id, amount FROM budget_targets WHERE year = ?').all(YEAR)
const budget = new Map(budgetRows.map(r => [`${r.account_id}:${r.month}`, r.amount]))
const budgetOf = (acct, m) => budget.get(`${acct.id}:${m}`) ?? 0
const revenueLeaves = accounts.filter(a => a.category === 'revenue' && isLeaf(a))
const totalRevenue = months.map(m => revenueLeaves.reduce((s, a) => s + budgetOf(a, m), 0))
if (totalRevenue.every(v => v === 0)) {
  console.error(`No ${YEAR} revenue budget found. Apply "Build ${YEAR} budget" on the Budget tab first.`)
  process.exit(1)
}
const foodRevenueLeaves = revenueLeaves.filter(a => a.subcategory === 'Food')
const foodRevenue = months.map(m => foodRevenueLeaves.reduce((s, a) => s + budgetOf(a, m), 0))

// ---- Trailing window -------------------------------------------------------------------------
const lastSynced = db.prepare('SELECT MAX(date) AS d FROM daily_line_items').get().d
const nowParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
const monthTotals = db.prepare(`
  SELECT substr(date, 1, 7) AS ym, COUNT(*) AS n FROM daily_line_items WHERE date >= ? GROUP BY 1 ORDER BY 1
`).all(SINCE)
const eligible = monthTotals.map(r => r.ym).filter((s) => {
  if (s >= nowParts) return false // current month is still open
  const [y, m] = s.split('-').map(Number)
  const end = `${s}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  return !!lastSynced && lastSynced >= end // sync has fully reached the month
})
const WINDOW = eligible.slice(-3)
if (WINDOW.length === 0) { console.error(`No fully-synced closed month on or after ${SINCE} to average from.`); process.exit(1) }
const actualRows = db.prepare(`
  SELECT account_id, substr(date, 1, 7) AS ym, SUM(amount) AS amt FROM daily_line_items
  WHERE substr(date, 1, 7) IN (${WINDOW.map(() => '?').join(',')}) GROUP BY 1, 2
`).all(...WINDOW)
const actual = new Map(actualRows.map(r => [`${r.account_id}:${r.ym}`, r.amt]))
const actualOver = (acct, monthList = WINDOW) => monthList.reduce((s, k) => s + (actual.get(`${acct.id}:${k}`) ?? 0), 0)
// "One month made up most of the window" — a one-off (an opening purchase, an annual bill) that a
// flat monthly average would repeat all year. Flagged, not dropped: use --exclude to skip it.
const lumpFlag = (acct) => {
  if (WINDOW.length < 2) return ''
  const per = WINDOW.map(k => Math.max(0, actual.get(`${acct.id}:${k}`) ?? 0))
  const total = per.reduce((s, v) => s + v, 0)
  return total > 0 && Math.max(...per) / total >= 0.7 ? `  ⚠ lumpy: ${Math.round(Math.max(...per) / total * 100)}% from one month` : ''
}
const sumAcc = (list, monthList = WINDOW) => list.reduce((s, a) => s + actualOver(a, monthList), 0)

// ---- Build the plan ----------------------------------------------------------------------------
const plan = [] // { acct, values[12], basis }
const notes = []
const excluded = []
const add = (acct, values, basis) => plan.push({ acct, values: values.map(round2), basis })

// Explicit amounts
add(byNumber('6510', 'opex'), months.map(() => CAMBRIDGE_RENT), '1281 Cambridge St lease, constant')
add(byNumber('7920', 'other_expense'), months.map(() => MASS_AVE_RENT), 'Mass Ave lease, constant')
add(byNumber('8030', 'other_income'), months.map(() => SUBLET_INCOME), 'assumed sublet income')
add(byNumber('6521', 'opex'), ELECTRIC_CAMBRIDGE.map(v => v + ELECTRIC_MASS_AVE), `Cambridge St bill profile + Mass Ave $${ELECTRIC_MASS_AVE}`)

add(byNumber('6522', 'opex'), GAS_CAMBRIDGE.map(v => v + GAS_MASS_AVE), `Cambridge St seasonal profile + Mass Ave $${GAS_MASS_AVE}`)

// COGS — Food: one blended % of Food revenue. Months with notable catering/event revenue are left
// out when a cleaner month exists, since catering purchases sit in Food Costs while catering
// revenue isn't in the denominator (see CLAUDE.md, Oct 5 recalibration).
const foodCogsAcct = byNumber('5010', 'cogs')
const cateringShare = (k) => {
  let core = 0, mix = 0
  for (const a of revenueLeaves) {
    const v = actual.get(`${a.id}:${k}`) ?? 0
    if (a.subcategory === 'Food' || a.subcategory === 'Beverage') core += v
    else if ((a.account_number ?? '').startsWith('41') || (a.account_number ?? '').startsWith('42')) mix += v
  }
  return core > 0 ? mix / core : 0
}
const cleanMonths = WINDOW.filter(k => cateringShare(k) <= 0.05)
const foodMonths = cleanMonths.length > 0 ? cleanMonths : WINDOW
const computedFoodPct = (() => {
  const rev = sumAcc(foodRevenueLeaves, foodMonths)
  return rev > 0 ? actualOver(foodCogsAcct, foodMonths) / rev : null
})()
const foodPct = FOOD_PCT_OVERRIDE ?? computedFoodPct
if (foodPct == null) { console.error('No Food revenue in the trailing window to compute a Food COGS % from; pass --food-pct=0.265'); process.exit(1) }
add(foodCogsAcct, foodRevenue.map(r => r * foodPct), `${(foodPct * 100).toFixed(1)}% of Food revenue${FOOD_PCT_OVERRIDE ? ' (override)' : ` (${foodMonths.join(', ')})`}${foodPct > 0.4 || foodPct < 0.15 ? '  ⚠ implausible, check or pass --food-pct' : ''}`)

// COGS — beverage, each against its own revenue account
const BEVERAGE_PAIRS = [['5110', '4022', 'Beer'], ['5120', '4024', 'Liquor'], ['5125', '4026', 'Wine'], ['5130', '4028', 'Non-Alcoholic']]
for (const [cogsNum, revNum, label] of BEVERAGE_PAIRS) {
  const cogsAcct = byNumber(cogsNum, 'cogs')
  const revAcct = byNumber(revNum, 'revenue')
  const rev = actualOver(revAcct)
  if (rev <= 0) { notes.push(`${label}: no ${revNum} revenue in the window — ${cogsNum} left unbudgeted`); continue }
  const pct = actualOver(cogsAcct) / rev
  add(cogsAcct, months.map(m => budgetOf(revAcct, m) * pct), `${(pct * 100).toFixed(1)}% of ${label} revenue${pct > 0.6 ? '  ⚠ very high, check the window' : ''}`)
}
// COGS — non-scaling supplies: trailing monthly average
for (const num of ['5020', '5115']) {
  const a = byNumber(num, 'cogs')
  const avg = actualOver(a) / WINDOW.length
  if (avg > 0) add(a, months.map(() => avg), `trailing ${WINDOW.length}-mo average${lumpFlag(a)}`)
}

// Processing fees: a share of revenue
const trailingRevenue = revenueLeaves.reduce((s, a) => s + actualOver(a), 0)
const FEE_ACCOUNTS = ['6210', '6220']
for (const num of FEE_ACCOUNTS) {
  const a = byNumber(num, 'opex')
  const pct = trailingRevenue > 0 ? actualOver(a) / trailingRevenue : 0
  if (pct > 0) add(a, totalRevenue.map(r => r * pct), `${(pct * 100).toFixed(2)}% of total revenue`)
}

// Everything else variable: trailing monthly average
const handled = new Set([...FEE_ACCOUNTS, '6521', '6522', '6510'])
for (const a of accounts) {
  if (a.category !== 'opex' || a.cost_behavior !== 'variable' || !isLeaf(a) || !a.account_number || handled.has(a.account_number)) continue
  if (EXCLUDE.has(a.account_number)) { excluded.push(`${a.account_number} ${a.name} — excluded by --exclude`); continue }
  const total = actualOver(a)
  if (total === 0) continue
  if (ONE_OFF_CREDITS.has(a.account_number)) { notes.push(`${a.account_number} ${a.name} — skipped: ${ONE_OFF_CREDITS.get(a.account_number)}`); continue }
  if (a.account_number === '6305' && YEAR === 2027) {
    const net = total / WINDOW.length
    const gross = net + OPENTABLE_CREDIT
    if (gross < 0) notes.push(`6305: net ${money(net)}/mo is more than the $${OPENTABLE_CREDIT} credit — gross fees come out negative; check the window`)
    add(a, months.map(m => (m <= OPENTABLE_CREDIT_LAST_MONTH ? net : gross)), `OpenTable credit through month ${OPENTABLE_CREDIT_LAST_MONTH}: net ${money(net)}/mo, then gross fees ${money(gross)}/mo`)
    continue
  }
  if (total < 0) { excluded.push(`${a.account_number} ${a.name} — net credit of ${money(total)} over the window; needs your call (not budgeted)`); continue }
  add(a, months.map(() => total / WINDOW.length), `trailing ${WINDOW.length}-mo average${lumpFlag(a)}`)
}

// ---- Report -----------------------------------------------------------------------------------
console.log(`Database: ${dbPath}`)
console.log(`Trailing window: ${WINDOW.join(', ')} (since ${SINCE}; last synced ${lastSynced})`)
console.log(`Writing ${YEAR} budget for ${plan.length} accounts.\n`)
const sorted = [...plan].sort((a, b) => b.values.reduce((s, v) => s + v, 0) - a.values.reduce((s, v) => s + v, 0))
for (const p of sorted) {
  const total = p.values.reduce((s, v) => s + v, 0)
  console.log(`${(p.acct.account_number ?? '').padEnd(5)} ${p.acct.name.padEnd(42)} ${money(total).padStart(10)}/yr  ${money(p.values[0]).padStart(8)}–${money(Math.max(...p.values)).padEnd(8)}  ${p.basis}`)
}
if (notes.length || excluded.length) {
  console.log('\nNeeds attention:')
  for (const n of [...notes, ...excluded]) console.log(`  - ${n}`)
}

// Net income for the year with the plan overlaid on what is already budgeted
const overlay = new Map(budget)
for (const p of plan) months.forEach((m, i) => overlay.set(`${p.acct.id}:${m}`, p.values[i]))
const catTotals = {}
const netByMonth = months.map(() => 0)
const sign = { revenue: 1, other_income: 1, cogs: -1, labor: -1, opex: -1, other_expense: -1 }
for (const a of accounts) {
  if (!isLeaf(a) || !(a.category in sign)) continue
  months.forEach((m, i) => {
    const v = overlay.get(`${a.id}:${m}`) ?? 0
    catTotals[a.category] = (catTotals[a.category] ?? 0) + v
    netByMonth[i] += sign[a.category] * v
  })
}
console.log(`\n${YEAR} budget after this pass:`)
for (const c of ['revenue', 'cogs', 'labor', 'opex', 'other_income', 'other_expense']) console.log(`  ${c.padEnd(14)} ${money(catTotals[c] ?? 0).padStart(12)}`)
const net = netByMonth.reduce((s, v) => s + v, 0)
console.log(`  ${'NET INCOME'.padEnd(14)} ${money(net).padStart(12)}   (${((net / (catTotals.revenue || 1)) * 100).toFixed(1)}% of revenue)`)
console.log(`  by month: ${netByMonth.map((v, i) => `${i + 1}:${money(v)}`).join('  ')}`)
console.log(`  prime cost (COGS+labor) = ${(((catTotals.cogs ?? 0) + (catTotals.labor ?? 0)) / (catTotals.revenue || 1) * 100).toFixed(1)}% of revenue`)

if (!flag('--apply')) { console.log('\nDry run — nothing written. Re-run with --apply to write.'); process.exit(0) }

// ---- Apply ----------------------------------------------------------------------------------
db.transaction(() => {
  db.exec(`CREATE TABLE ${BACKUP} (year INTEGER, month INTEGER, account_id INTEGER, amount REAL, existed INTEGER)`)
  const save = db.prepare(`INSERT INTO ${BACKUP} VALUES (?, ?, ?, ?, ?)`)
  const upsert = db.prepare(`INSERT INTO budget_targets (year, month, account_id, amount) VALUES (?, ?, ?, ?)
    ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount`)
  for (const p of plan) {
    months.forEach((m, i) => {
      const prev = budget.get(`${p.acct.id}:${m}`)
      save.run(YEAR, m, p.acct.id, prev ?? null, prev === undefined ? 0 : 1)
      upsert.run(YEAR, m, p.acct.id, p.values[i])
    })
  }
})()
console.log(`\nWrote ${plan.length * 12} budget entries. Previous values saved in ${BACKUP} (node scripts/seed-2027-budget-extras.mjs --revert to undo).`)
