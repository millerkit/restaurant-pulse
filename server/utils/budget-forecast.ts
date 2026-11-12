// Automatic budget lines (dynamic budgeting step 2, 2026-11-11). Replaces the Sales
// Plan's "Recompute Revenue from Capacity" buttons, its buyout "Apply", and the
// Budget page's "Recompute food & drink cost from trailing average".
//
// For every month AFTER the current one, through December of next year, the job
// writes a fixed set of budget lines (MANAGED below, matched by account number):
//
// - Food sales (4010) = the Capacity forecast's food sales for that month
//   (server/utils/capacity-model.ts, so holidays, special nights and area closures
//   count the same way) + the food share of planned buyouts.
// - Beverage sales (4022/4024/4026/4028) = Capacity's beverage sales + the beverage
//   share of planned buyouts, split by the real beer/liquor/wine/N-A mix since the
//   move.
// - Planned buyouts = dated buyouts that month (expected night − a normal night that
//   weekday) + the undated per-weekday counts (count × (rate − a normal night)).
// - Food & drink cost (5010, 5110/5120/5125/5130) = each line's real cost % of its
//   paired sales account over the last (up to) three closed, fully synced months
//   from August 2026 on × that month's sales line.
//
// The current month and earlier are never touched: a month's plan freezes on the
// 1st, and the night-by-night projection is the live forecast for it. A line typed
// by hand is pinned (budget_targets.pinned = 1) and left alone; auto_amount always
// holds what the forecast says, so the pages can show it beside a pin.
import type Database from 'better-sqlite3'
import { createCapacityModel } from './capacity-model'
import { loadSpecialNights } from './special-nights'
import { NEW_LOCATION_START } from './weekly-targets'
import { buyoutWeekdaysFor, loadBuyoutRates } from './buyout-rates'

type Db = Database.Database

export const FOOD_SALES = '4010'
export const BEVERAGE_SALES = ['4022', '4024', '4026', '4028']
// Food & drink cost lines and the sales line each is a % of.
// Food (2026-11-11): catering and event food is bought through the same Food Costs
// account, so food cost % is measured against ALL food sales (restaurant + on-site
// event + off-site event + catering food), and budgeted against all of them too: a
// month with catering budgeted gets that catering's food cost, a month without it
// isn't charged for some other month's catering. Assumes catering runs the same food
// cost % as the dining room. extraCost (5220 Catering Food Costs, rarely used) counts
// in the %, and its own budget is subtracted from what 5010 gets so the total is right.
// extraSales lines are budgeted by hand (not written by the forecast).
export const COST_PAIRS: { cost: string, sales: string, extraCost?: string[], extraSales?: string[] }[] = [
  { cost: '5010', sales: '4010', extraCost: ['5220'], extraSales: ['4150', '4180', '4230'] },
  { cost: '5110', sales: '4022' },
  { cost: '5120', sales: '4024' },
  { cost: '5125', sales: '4026' },
  { cost: '5130', sales: '4028' }
]
// Event Sales / Catering lines the dated special nights feed (2026-11-12): each kind's event
// revenue is split food/drink by the real sales mix.
export const EVENT_ACCOUNTS: Record<'event' | 'offsite' | 'catering', { food: string, beverage: string }> = {
  event: { food: '4150', beverage: '4145' },
  offsite: { food: '4180', beverage: '4175' },
  catering: { food: '4230', beverage: '4210' }
}
export const EVENT_ACCOUNT_NUMBERS = Object.values(EVENT_ACCOUNTS).flatMap(a => [a.food, a.beverage])
export const MANAGED_ACCOUNT_NUMBERS = [FOOD_SALES, ...BEVERAGE_SALES, ...COST_PAIRS.map(p => p.cost), ...EVENT_ACCOUNT_NUMBERS]

// First steady month at the new location: June/July food cost reflects the opening
// stock-up (purchase-based cost, no inventory accounting). Same rule the Budget
// page's old recompute used (COGS_BASELINE_START_MONTH).
const COST_BASELINE_START = '2026-08'
const COST_WINDOW_MONTHS = 3
// Share of food when there's no real food/beverage sales history yet.
const FOOD_SHARE_FALLBACK = 0.65

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

// mixedMonths: window months whose catering/event sales (41xx/42xx) were over 5% of
// core dining sales. Catering purchases can't be separated from Food Costs, so the
// food % reads a little high for a month with no catering. Shown, not corrected.
export type CostWindow = { months: string[], pctByCost: Record<string, number | null>, mixedMonths: { month: string, share: number }[] }
const CATERING_MIX_THRESHOLD = 0.05

// The (up to) three most recent closed months, from August 2026 on, whose
// QuickBooks data is fully synced, and each cost line's % of its sales line over them.
export function costWindow(db: Db, today: string): CostWindow {
  const syncedThrough = (db.prepare('SELECT MAX(date) AS d FROM daily_line_items').get() as { d: string | null }).d ?? ''
  const months: string[] = []
  let [y, m] = today.split('-').map(Number) as [number, number]
  for (let i = 0; i < 24 && months.length < COST_WINDOW_MONTHS; i++) {
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
    const ym = `${y}-${pad(m)}`
    if (ym < COST_BASELINE_START) break
    if (syncedThrough >= monthEnd(y, m)) months.unshift(ym)
  }
  const pctByCost: Record<string, number | null> = {}
  if (months.length === 0) {
    for (const p of COST_PAIRS) pctByCost[p.cost] = null
    return { months, pctByCost, mixedMonths: [] }
  }
  const from = `${months[0]}-01`
  const last = months[months.length - 1]!
  const to = monthEnd(Number(last.slice(0, 4)), Number(last.slice(5, 7)))
  const sumFor = db.prepare(`
    SELECT COALESCE(SUM(dli.amount), 0) AS total FROM daily_line_items dli
    JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number = ? AND dli.date BETWEEN ? AND ?
  `)
  const total = (nums: string[]) => nums.reduce((sum, n) => sum + (sumFor.get(n, from, to) as { total: number }).total, 0)
  for (const p of COST_PAIRS) {
    const cost = total([p.cost, ...(p.extraCost ?? [])])
    const sales = total([p.sales, ...(p.extraSales ?? [])])
    pctByCost[p.cost] = sales > 0 ? cost / sales : null
  }
  const mixFor = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.account_number IN ('${FOOD_SALES}', ${BEVERAGE_SALES.map(n => `'${n}'`).join(', ')}) THEN dli.amount END), 0) AS core,
      COALESCE(SUM(CASE WHEN a.account_number LIKE '41%' OR a.account_number LIKE '42%' THEN dli.amount END), 0) AS catering
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = 'revenue' AND dli.date BETWEEN ? AND ?
  `)
  const mixedMonths: { month: string, share: number }[] = []
  for (const ym of months) {
    const r = mixFor.get(`${ym}-01`, monthEnd(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))) as { core: number, catering: number }
    const share = r.core > 0 ? r.catering / r.core : 0
    if (share > CATERING_MIX_THRESHOLD) mixedMonths.push({ month: ym, share })
  }
  return { months, pctByCost, mixedMonths }
}

// Real food/beverage split and beer/liquor/wine/N-A mix since the move.
function salesMix(db: Db): { foodShare: number, beverageWeights: Map<string, number> | null } {
  const rows = db.prepare(`
    SELECT a.account_number AS num, COALESCE(SUM(dli.amount), 0) AS total FROM accounts a
    JOIN daily_line_items dli ON dli.account_id = a.id AND dli.date >= ?
    WHERE a.account_number IN (?, ?, ?, ?, ?)
    GROUP BY a.account_number
  `).all(NEW_LOCATION_START, FOOD_SALES, ...BEVERAGE_SALES) as { num: string, total: number }[]
  const byNum = new Map(rows.map(r => [r.num, r.total]))
  const food = byNum.get(FOOD_SALES) ?? 0
  const bev = BEVERAGE_SALES.reduce((s, n) => s + Math.max(0, byNum.get(n) ?? 0), 0)
  return {
    foodShare: food + bev > 0 ? food / (food + bev) : FOOD_SHARE_FALLBACK,
    beverageWeights: bev > 0 ? new Map(BEVERAGE_SALES.map(n => [n, Math.max(0, byNum.get(n) ?? 0) / bev])) : null
  }
}

// Extra sales planned buyouts add to a month (above the normal nights they displace).
export function plannedBuyoutIncrement(db: Db, year: number, month: number): { total: number, dated: number, undated: number } {
  const monthStartIso = `${year}-${pad(month)}-01`
  let weekdays: ReturnType<typeof buyoutWeekdaysFor> = []
  try {
    weekdays = buyoutWeekdaysFor(loadBuyoutRates(db), monthStartIso)
  } catch {
    return { total: 0, dated: 0, undated: 0 }
  }
  const normalFor = (dow: number) => weekdays.find(w => w.dow === dow)
  let undated = 0
  const counts = db.prepare('SELECT dow, count FROM revenue_buyout_plan WHERE year = ? AND month = ?').all(year, month) as { dow: number, count: number }[]
  for (const c of counts) {
    const w = normalFor(c.dow)
    if (!w || w.dollarTarget == null || !(c.count > 0)) continue
    undated += c.count * (w.rate - w.dollarTarget)
  }
  let dated = 0
  for (const n of loadSpecialNights(db, monthStartIso, monthEnd(year, month)).values()) {
    if (n.kind !== 'buyout') continue
    const w = normalFor(new Date(`${n.date}T00:00:00Z`).getUTCDay())
    if (!w || w.dollarTarget == null) continue
    dated += n.expectedRevenue - w.dollarTarget
  }
  return { total: dated + undated, dated, undated }
}

// What a month's dated special nights add to the budget beyond the Capacity projection:
// - dineIn: regular dine-in revenue on nights that replace service (the Capacity projection
//   zeroes those nights; this puts back what's expected, e.g. diners alongside a ticketed event)
// - eventByAccount: event revenue (tickets etc.) by Event Sales / Catering account, food/drink
//   split by foodShare.
export function specialNightAdditions(db: Db, year: number, month: number, foodShare: number): { dineIn: number, eventByAccount: Map<string, number> } {
  const nights = [...loadSpecialNights(db, `${year}-${pad(month)}-01`, monthEnd(year, month)).values()]
  let dineIn = 0
  const eventByAccount = new Map<string, number>()
  for (const n of nights) {
    const isMonday = new Date(`${n.date}T00:00:00Z`).getUTCDay() === 1
    if (!isMonday && (n.kind === 'event' || n.kind === 'offsite' || n.kind === 'closed')) dineIn += n.expectedRevenue
    if (n.kind === 'event' || n.kind === 'offsite' || n.kind === 'catering') {
      const acct = EVENT_ACCOUNTS[n.kind]
      if (!(n.eventRevenue > 0)) continue
      eventByAccount.set(acct.food, (eventByAccount.get(acct.food) ?? 0) + n.eventRevenue * foodShare)
      eventByAccount.set(acct.beverage, (eventByAccount.get(acct.beverage) ?? 0) + n.eventRevenue * (1 - foodShare))
    }
  }
  return { dineIn, eventByAccount }
}

export type BudgetForecastResult = { months: string[], rowsChanged: number, costWindow: string[] }

export function refreshBudgetForecast(db: Db, today: string): BudgetForecastResult {
  const [ty, tm] = today.split('-').map(Number) as [number, number]
  // Every month after the current one, through December of next year.
  const targetMonths: { year: number, month: number }[] = []
  for (let idx = tm; ; idx++) {
    const year = ty + Math.floor(idx / 12)
    if (year > ty + 1) break
    targetMonths.push({ year, month: (idx % 12) + 1 })
  }
  const accounts = db.prepare(`
    SELECT id, account_number AS num FROM accounts
    WHERE is_active = 1 AND account_number IN (${MANAGED_ACCOUNT_NUMBERS.map(() => '?').join(',')})
  `).all(...MANAGED_ACCOUNT_NUMBERS) as { id: number, num: string }[]
  const idByNum = new Map<string, number>()
  for (const a of accounts) {
    if (idByNum.has(a.num)) throw new Error(`More than one active account numbered ${a.num}`)
    idByNum.set(a.num, a.id)
  }

  const model = createCapacityModel(db, `${ty}-01-01`, `${ty + 1}-12-31`)
  const mix = salesMix(db)
  const window = costWindow(db, today)

  const existing = db.prepare('SELECT amount, pinned FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?')
  // Hand-budgeted lines (event/catering food sales, catering food cost), by account number.
  const budgetedStmt = db.prepare(`
    SELECT COALESCE(SUM(bt.amount), 0) AS amount FROM budget_targets bt
    JOIN accounts a ON a.id = bt.account_id
    WHERE a.account_number = ? AND a.is_active = 1 AND bt.year = ? AND bt.month = ?
  `)
  const budgetedAmount = (num: string, year: number, month: number) => (budgetedStmt.get(num, year, month) as { amount: number }).amount
  const upsert = db.prepare(`
    INSERT INTO budget_targets (year, month, account_id, amount, auto_amount, pinned)
    VALUES (@year, @month, @accountId, @amount, @amount, 0)
    ON CONFLICT(year, month, account_id) DO UPDATE SET
      auto_amount = excluded.auto_amount,
      amount = CASE WHEN budget_targets.pinned = 1 THEN budget_targets.amount ELSE excluded.amount END
  `)
  let rowsChanged = 0
  db.transaction(() => {
    for (const { year, month } of targetMonths) {
      const proj = model.dayByDaySum(`${year}-${pad(month)}-01`, monthEnd(year, month))
      const buyout = plannedBuyoutIncrement(db, year, month).total
      const additions = specialNightAdditions(db, year, month, mix.foodShare)
      const coreExtra = buyout + additions.dineIn
      const food = proj.expectedRevenueFood + coreExtra * mix.foodShare
      const beverage = proj.expectedRevenueBeverage + coreExtra * (1 - mix.foodShare)
      const sales = new Map<string, number>([[FOOD_SALES, food]])
      for (const n of BEVERAGE_SALES) {
        const w = mix.beverageWeights?.get(n) ?? 1 / BEVERAGE_SALES.length
        sales.set(n, beverage * w)
      }
      const values = new Map<string, number>(sales)
      // Event Sales / Catering lines follow the dated special nights. A row nobody has
      // written automatically (no auto_amount: budgeted by hand before this existed) is left
      // alone in a month with no dated event revenue, so old hand entries aren't zeroed.
      for (const num of EVENT_ACCOUNT_NUMBERS) {
        const accountId = idByNum.get(num)
        if (accountId == null) continue
        const amount = additions.eventByAccount.get(num) ?? 0
        const row = db.prepare('SELECT auto_amount AS autoAmount FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?').get(year, month, accountId) as { autoAmount: number | null } | undefined
        if (amount === 0 && row && row.autoAmount == null) continue
        values.set(num, amount)
      }
      // Cost follows event/catering food sales as budgeted: a pinned line's own amount, else
      // what the forecast just worked out.
      const eventSalesFor = (num: string) => {
        const accountId = idByNum.get(num)
        const row = accountId == null ? undefined : existing.get(year, month, accountId) as { amount: number, pinned: number } | undefined
        if (row?.pinned) return row.amount
        return values.has(num) ? values.get(num)! : budgetedAmount(num, year, month)
      }
      for (const p of COST_PAIRS) {
        const pct = window.pctByCost[p.cost]
        // No cost history yet: leave the cost line as entered.
        if (pct == null) continue
        // Cost follows the sales figure actually budgeted: a pinned sales line's own
        // amount, else the forecast's.
        const salesId = idByNum.get(p.sales)
        const salesRow = salesId == null ? undefined : existing.get(year, month, salesId) as { amount: number, pinned: number } | undefined
        const salesAmount = salesRow?.pinned ? salesRow.amount : (sales.get(p.sales) ?? 0)
        const extraSales = (p.extraSales ?? []).reduce((sum, n) => sum + eventSalesFor(n), 0)
        const extraCost = (p.extraCost ?? []).reduce((sum, n) => sum + budgetedAmount(n, year, month), 0)
        values.set(p.cost, Math.max(0, pct * (salesAmount + extraSales) - extraCost))
      }
      for (const [num, value] of values) {
        const accountId = idByNum.get(num)
        if (accountId == null) continue
        const amount = Math.round(value * 100) / 100
        const before = existing.get(year, month, accountId) as { amount: number, pinned: number } | undefined
        if (!before || (!before.pinned && Math.abs(before.amount - amount) >= 0.01)) rowsChanged++
        upsert.run({ year, month, accountId, amount })
      }
    }
  })()
  return { months: targetMonths.map(t => `${t.year}-${pad(t.month)}`), rowsChanged, costWindow: window.months }
}
