// Sales Strategy › Annual plan (2026-11-19): a full-year, not month-by-month, scenario for closing the budget gap
// with extra event sales, buyouts, retail and extra covers per area. The server supplies the baseline (the year's
// saved budget, loan principal, the Capacity forecast per area, the average normal night a buyout replaces) and the
// saved inputs; the page does the arithmetic live so the owners can try numbers before saving.
import { createCapacityModel } from './capacity-model'
import { computeBreakeven } from './breakeven'
import { loadBuyoutRates } from './buyout-rates'

export type AnnualPlanInputs = {
  eventSales: number // extra event / catering sales beyond what's budgeted, $ a year
  eventMarginPct: number // share kept as profit
  buyouts: number // buyouts a year (any night)
  buyoutPrice: number // average price of a buyout
  retailPerMonth: number
  retailMarginPct: number
  dineInMarginPct: number // share of extra dine-in sales kept as profit (also used for buyouts)
  extraCovers: Record<string, number> // area id -> extra covers per open night
}

// Kit's ranges (2026-11-19): events $150-250K extra, buyouts about 1.5 a month, retail $3-4K a month.
// Defaults are the middle of those. Event margin is lower than dine-in for event staffing and rentals
// (event costs post to the dine-in accounts, so it can't be measured); retail is a guess until it has history.
export function defaultAnnualPlanInputs(dineInMarginPct: number, buyoutPrice: number, areaNames: { id: number, name: string }[]): AnnualPlanInputs {
  const extra: Record<string, number> = {}
  for (const a of areaNames) {
    const n = a.name.toLowerCase()
    extra[a.id] = n.includes('dining') ? 4 : n.includes('bar') || n.includes('salon') ? 2 : 0
  }
  return { eventSales: 200000, eventMarginPct: 55, buyouts: 18, buyoutPrice, retailPerMonth: 3500, retailMarginPct: 45, dineInMarginPct, extraCovers: extra }
}

export function computeAnnualPlan(db: ReturnType<typeof useDb>, year: number) {
  const budget = db.prepare(`
    SELECT a.category AS cat, COALESCE(SUM(bt.amount), 0) AS total
    FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE bt.year = ? AND a.is_active = 1 AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)
    GROUP BY a.category
  `).all(year) as { cat: string, total: number }[]
  const b = (cat: string) => budget.find(r => r.cat === cat)?.total ?? 0
  const netIncome = b('revenue') - b('cogs') - b('labor') - b('opex') + b('other_income') - b('other_expense')
  const principal = (db.prepare(`SELECT COALESCE(SUM(principal), 0) AS total FROM loan_schedule WHERE substr(payment_date, 1, 4) = ?`)
    .get(String(year)) as { total: number }).total

  // The Capacity forecast for every normal night of the year (Tue-Sun, holidays and replaced nights out).
  const start = `${year}-01-01`, end = `${year}-12-31`
  const model = createCapacityModel(db, start, end)
  const areaAgg = new Map<number, { nights: number, covers: number, max: number }>()
  let nights = 0, nightSales = 0
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (d.getUTCDay() === 1 || model.replaced.has(iso)) continue
    const night = model.nightlyExpectedOn(iso)
    if (night.covers <= 0) continue
    nights++; nightSales += night.revenue
    for (const area of model.areas) {
      const e = model.areaExpectedOn(area, iso)
      if (!e || e.maxCovers <= 0) continue
      const agg = areaAgg.get(area.id) ?? { nights: 0, covers: 0, max: 0 }
      agg.nights++; agg.covers += e.covers; agg.max += e.maxCovers
      areaAgg.set(area.id, agg)
    }
  }
  const areas = model.areas.map((a) => {
    const agg = areaAgg.get(a.id)
    return {
      id: a.id, name: a.name, nights: agg?.nights ?? 0,
      coversPerNight: agg && agg.nights ? agg.covers / agg.nights : 0,
      seatsPerNight: agg && agg.nights ? agg.max / agg.nights : 0,
      spendPerGuest: a.per_cover_revenue_food + a.per_cover_revenue_beverage
    }
  }).filter(a => a.nights > 0)

  // A buyout can land on any night (Kit: "we're thrilled to book any day"), so it replaces an average normal night.
  const rates = loadBuyoutRates(db)
  const avgBuyoutRate = (rates.weekdayRate * 3 + rates.weekendRate * 3) / 6 // Tue-Thu weekday, Fri-Sun weekend
  const avgNormalNight = nights > 0 ? nightSales / nights : null

  // The dine-in contribution rate Breakeven uses (1 - food & drink cost target - variable expense target).
  let contribRate: number | null = null
  for (let m = 1; m <= 12 && contribRate == null; m++) contribRate = computeBreakeven(db, year, m).contribRate
  const dineInMarginPct = contribRate != null ? Math.round(contribRate * 100) : 60

  const defaults = defaultAnnualPlanInputs(dineInMarginPct, Math.round(avgBuyoutRate), areas)
  const row = db.prepare('SELECT inputs, updated_at AS updatedAt, updated_by AS updatedBy FROM annual_sales_plan WHERE year = ?')
    .get(year) as { inputs: string, updatedAt: string, updatedBy: string | null } | undefined
  let saved: Partial<AnnualPlanInputs> | null = null
  try { saved = row ? JSON.parse(row.inputs) : null } catch { saved = null }
  const inputs: AnnualPlanInputs = { ...defaults, ...(saved ?? {}), extraCovers: { ...defaults.extraCovers, ...(saved?.extraCovers ?? {}) } }

  return {
    year,
    baseline: {
      revenue: b('revenue'), netIncome, principal, afterPrincipal: netIncome - principal,
      eventSalesBudgeted: (db.prepare(`
        SELECT COALESCE(SUM(bt.amount), 0) AS t FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
        WHERE bt.year = ? AND a.category = 'revenue' AND a.account_number GLOB '4[12]*' AND a.is_active = 1
          AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)
      `).get(year) as { t: number }).t,
      nights, avgNormalNight, buyoutRates: { weekday: rates.weekdayRate, weekend: rates.weekendRate },
      contribRate
    },
    areas,
    inputs, defaults,
    saved: row ? { updatedAt: row.updatedAt, updatedBy: row.updatedBy } : null
  }
}

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

export function validateAnnualPlanInputs(v: unknown): AnnualPlanInputs | string {
  const i = v as AnnualPlanInputs
  if (!i || typeof i !== 'object') return 'Missing inputs'
  if (!num(i.eventSales, 0, 5_000_000)) return 'Event sales must be between $0 and $5M'
  if (!num(i.buyouts, 0, 200)) return 'Buyouts must be between 0 and 200'
  if (!num(i.buyoutPrice, 0, 200_000)) return 'Buyout price must be between $0 and $200K'
  if (!num(i.retailPerMonth, 0, 500_000)) return 'Retail must be between $0 and $500K a month'
  for (const k of ['eventMarginPct', 'retailMarginPct', 'dineInMarginPct'] as const) if (!num(i[k], 0, 100)) return 'Profit shares must be 0–100%'
  if (!i.extraCovers || typeof i.extraCovers !== 'object') return 'Missing extra covers'
  const extra: Record<string, number> = {}
  for (const [k, n] of Object.entries(i.extraCovers)) {
    if (!/^\d+$/.test(k) || !num(n, -100, 500)) return 'Extra covers must be numbers'
    extra[k] = n
  }
  return { eventSales: i.eventSales, eventMarginPct: i.eventMarginPct, buyouts: i.buyouts, buyoutPrice: i.buyoutPrice, retailPerMonth: i.retailPerMonth, retailMarginPct: i.retailMarginPct, dineInMarginPct: i.dineInMarginPct, extraCovers: extra }
}
