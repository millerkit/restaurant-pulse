// Forecast snapshots (dynamic budgeting step 3, 2026-11-11). The forecast overwrites itself
// nightly, so past forecasts can't be rebuilt later; this saves month-level copies as it goes so
// the Forecast Accuracy page can measure error by lead time, and Covers & Spend can show what a
// month was planned at when it started. Records only — never changes the forecast math.
//
// Kinds: 'weekly' (first sync on/after each Monday; snapshot_date = that Monday) and
// 'month_start' (first sync on/after the 1st; snapshot_date = the 1st, the frozen plan record).
// Months covered: the current month through 12 months ahead. Idempotent: an existing row for the
// same (snapshot_date, kind, year, month, source, metric) is left alone.
import type Database from 'better-sqlite3'
import { CORE_REVENUE_ACCOUNT_NUMBERS } from './core-revenue'
import { createCapacityModel } from './capacity-model'
import { computeRevenueProjection } from './revenue-projection'

type Db = Database.Database

const pad = (n: number) => String(n).padStart(2, '0')
const monthEndIso = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

export const MONTHS_AHEAD = 12
export type SnapshotMetric = 'sales' | 'core_sales' | 'food_drink_cost' | 'labor' | 'opex' | 'other_income' | 'other_expense' | 'net_income' | 'covers' | 'max_covers' | 'capacity_sales'

export function mondayOfIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dow = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return d.toISOString().slice(0, 10)
}

export function netIncomeOf(v: { sales: number, food_drink_cost: number, labor: number, opex: number, other_income: number, other_expense: number }) {
  // Same formula as netIncome() in app/composables/useBudgetData.ts
  return v.sales - v.food_drink_cost - v.labor - v.opex + v.other_income - v.other_expense
}

const CATEGORY_METRIC: Record<string, 'sales' | 'food_drink_cost' | 'labor' | 'opex' | 'other_income' | 'other_expense'> = {
  revenue: 'sales', cogs: 'food_drink_cost', labor: 'labor', opex: 'opex', other_income: 'other_income', other_expense: 'other_expense'
}
const CORE_PLACEHOLDERS = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
// Leaf accounts only, like every other server-side budget sum.
const LEAF = `NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)`

// The budget (plan) for one month, per category and for core sales.
function planFromBudget(db: Db, year: number, month: number) {
  const byCat = db.prepare(`
    SELECT a.category, COALESCE(SUM(bt.amount), 0) AS total
    FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE bt.year = ? AND bt.month = ? AND ${LEAF}
    GROUP BY a.category
  `).all(year, month) as { category: string, total: number }[]
  const core = db.prepare(`
    SELECT COALESCE(SUM(bt.amount), 0) AS total
    FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE bt.year = ? AND bt.month = ? AND a.account_number IN (${CORE_PLACEHOLDERS}) AND ${LEAF}
  `).get(year, month, ...CORE_REVENUE_ACCOUNT_NUMBERS) as { total: number }
  const v = { sales: 0, food_drink_cost: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }
  for (const r of byCat) {
    const k = CATEGORY_METRIC[r.category]
    if (k) v[k] = r.total
  }
  return { ...v, core_sales: core.total, net_income: netIncomeOf(v) }
}

export type SnapshotResult = { snapshotDate: string, kind: 'weekly' | 'month_start', rowsWritten: number, skipped: boolean }

// today: the restaurant's local date (or an "as of" date for manual tests). By default each kind
// is taken only when its snapshot_date doesn't exist yet; force = take both kinds now (manual use).
export function takeForecastSnapshots(db: Db, today: string, opts: { force?: boolean } = {}): SnapshotResult[] {
  const [cy, cm] = today.split('-').map(Number) as [number, number]
  const plans: { kind: 'weekly' | 'month_start', snapshotDate: string }[] = [
    { kind: 'weekly', snapshotDate: mondayOfIso(today) },
    { kind: 'month_start', snapshotDate: `${cy}-${pad(cm)}-01` }
  ]
  const exists = db.prepare('SELECT 1 FROM forecast_snapshots WHERE snapshot_date = ? AND kind = ? LIMIT 1')
  const due = plans.filter(p => opts.force || !exists.get(p.snapshotDate, p.kind))
  const results: SnapshotResult[] = plans.filter(p => !due.includes(p)).map(p => ({ ...p, rowsWritten: 0, skipped: true }))
  if (due.length === 0) return results

  // Gather the figures once; both kinds hold the same numbers for a given run.
  const months: { year: number, month: number }[] = []
  for (let i = 0, y = cy, m = cm; i <= MONTHS_AHEAD; i++) {
    months.push({ year: y, month: m })
    m++
    if (m > 12) { m = 1; y++ }
  }
  const last = months[months.length - 1]!
  const model = createCapacityModel(db, `${cy}-${pad(cm)}-01`, monthEndIso(last.year, last.month))
  const rows: { year: number, month: number, source: 'plan' | 'live', metric: SnapshotMetric, value: number }[] = []
  for (const { year, month } of months) {
    const plan = planFromBudget(db, year, month)
    for (const [metric, value] of Object.entries(plan)) rows.push({ year, month, source: 'plan', metric: metric as SnapshotMetric, value })
    const cap = model.dayByDaySum(`${year}-${pad(month)}-01`, monthEndIso(year, month))
    rows.push({ year, month, source: 'plan', metric: 'covers', value: cap.expectedCovers })
    rows.push({ year, month, source: 'plan', metric: 'max_covers', value: cap.maxCovers })
    rows.push({ year, month, source: 'plan', metric: 'capacity_sales', value: cap.expectedRevenue })
  }
  // Live: the current month's night-by-night core sales. An incomplete projection (a night with
  // too little weekday history) is left out rather than stored short.
  const live = computeRevenueProjection(db, cy, cm)
  if (live.missingHistory === 0) rows.push({ year: cy, month: cm, source: 'live', metric: 'core_sales', value: live.projectedCoreTotal })

  const insert = db.prepare(`
    INSERT OR IGNORE INTO forecast_snapshots (snapshot_date, kind, year, month, source, metric, value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  db.transaction(() => {
    for (const p of due) {
      let written = 0
      for (const r of rows) written += insert.run(p.snapshotDate, p.kind, r.year, r.month, r.source, r.metric, r.value, now).changes
      results.push({ ...p, rowsWritten: written, skipped: false })
    }
  })()
  return results
}
