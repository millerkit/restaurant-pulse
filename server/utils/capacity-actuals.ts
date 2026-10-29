// Real per-area per-cover revenue over a date range, and the month-close
// auto-update that writes it into capacity_areas for areas that opted in
// via follow_actuals (added 2026-10-29, replacing the habit of clicking
// "Set from Actuals" by hand on the Edit Capacity page).
//
// blendForRange is shared with server/api/capacity/area-actuals.get.ts (the
// interactive button's source), so the button and the automatic update can
// never disagree about what "real per-cover" means.
import type Database from 'better-sqlite3'

type Db = Database.Database

export type AreaBlendRow = {
  areaId: number
  covers: number
  revenue: number
  perCover: number | null
  perCoverFood: number | null
  perCoverBeverage: number | null
}

export type AreaBlend = {
  perArea: AreaBlendRow[]
  foodBeveragePct: { food: number; beverage: number } | null
}

// Total revenue over total covers across the whole range, not an average of
// per-month ratios (averaging two ratios isn't the combined ratio once
// covers differ month to month). foodRevenue/beverageRevenue are only
// non-null for Chef's Counter (see toast-metrics-sync.ts's
// CHEFS_COUNTER_FOOD_PRICE_PER_COVER); every other area is split using the
// restaurant-wide real Food/Beverage revenue mix over the same range, a
// known simplification since QBO has no per-area revenue signal.
export function blendForRange(db: Db, start: string, end: string): AreaBlend {
  const areas = db.prepare('SELECT id FROM capacity_areas ORDER BY id').all() as { id: number }[]
  const rows = db.prepare(`
    SELECT area_id AS areaId, SUM(covers) AS covers, SUM(revenue) AS revenue,
      SUM(food_revenue) AS foodRevenue, SUM(beverage_revenue) AS beverageRevenue
    FROM daily_toast_area_metrics
    WHERE date BETWEEN ? AND ?
    GROUP BY area_id
  `).all(start, end) as { areaId: number; covers: number; revenue: number; foodRevenue: number | null; beverageRevenue: number | null }[]
  const byArea = new Map(rows.map(r => [r.areaId, r]))

  const perArea = areas.map((a) => {
    const r = byArea.get(a.id)
    const covers = r?.covers ?? 0
    const revenue = r?.revenue ?? 0
    const hasRealSplit = r?.foodRevenue != null && r?.beverageRevenue != null
    return {
      areaId: a.id,
      covers,
      revenue,
      perCover: covers > 0 ? revenue / covers : null,
      perCoverFood: hasRealSplit && covers > 0 ? (r!.foodRevenue as number) / covers : null,
      perCoverBeverage: hasRealSplit && covers > 0 ? (r!.beverageRevenue as number) / covers : null
    }
  })

  const mixRows = db.prepare(`
    SELECT a.subcategory AS subcategory, COALESCE(SUM(dli.amount), 0) AS total
    FROM accounts a
    JOIN daily_line_items dli ON dli.account_id = a.id AND dli.date BETWEEN ? AND ?
    WHERE a.category = 'revenue' AND a.subcategory IN ('Food', 'Beverage')
    GROUP BY a.subcategory
  `).all(start, end) as { subcategory: string; total: number }[]
  const foodTotal = mixRows.find(r => r.subcategory === 'Food')?.total ?? 0
  const beverageTotal = mixRows.find(r => r.subcategory === 'Beverage')?.total ?? 0
  const mixSum = foodTotal + beverageTotal
  const foodBeveragePct = mixSum > 0 ? { food: foodTotal / mixSum, beverage: beverageTotal / mixSum } : null

  return { perArea, foodBeveragePct }
}

// An area needs at least this many real covers across the two-month window
// before it's allowed to move its own assumption — a single odd night in a
// barely-used area (e.g. Outdoor shoulder season) shouldn't reset a target.
const MIN_COVERS_TO_UPDATE = 30

function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}
function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

export type FollowActualsUpdate = {
  areaId: number
  name: string
  closedMonth: string
  food: number
  beverage: number
}

// Called by the nightly sync after Toast/QBO are caught up. For every area
// with follow_actuals = 1 that hasn't yet been updated for the most recently
// closed month, writes the real per-cover blend of the two most recently
// closed months (the closed month plus the one before it) into
// per_cover_revenue_food/_beverage. Effectively fires once, on the first
// successful sync of a new month; follow_actuals_through makes it
// idempotent across nights and restarts.
//
// syncedThrough is the last date the sync that's calling this actually
// covered — if it's earlier than the closed month's last day (e.g. a
// single-date manual re-sync), the data isn't complete and nothing happens.
export function applyMonthCloseActuals(db: Db, today: string, syncedThrough: string): FollowActualsUpdate[] {
  const [ty, tm] = today.split('-').map(Number) as [number, number]
  const closedYear = tm === 1 ? ty - 1 : ty
  const closedMonthNum = tm === 1 ? 12 : tm - 1
  const closedYm = `${closedYear}-${String(closedMonthNum).padStart(2, '0')}`
  const closedEnd = monthEnd(closedYear, closedMonthNum)
  if (syncedThrough < closedEnd) return []

  const due = db.prepare(`
    SELECT id, name FROM capacity_areas
    WHERE follow_actuals = 1 AND (follow_actuals_through IS NULL OR follow_actuals_through < ?)
  `).all(closedYm) as { id: number; name: string }[]
  if (due.length === 0) return []

  const prevYear = closedMonthNum === 1 ? closedYear - 1 : closedYear
  const prevMonthNum = closedMonthNum === 1 ? 12 : closedMonthNum - 1
  const blend = blendForRange(db, monthStart(prevYear, prevMonthNum), closedEnd)

  const update = db.prepare(`
    UPDATE capacity_areas
    SET per_cover_revenue_food = ?, per_cover_revenue_beverage = ?, follow_actuals_through = ?
    WHERE id = ?
  `)
  const applied: FollowActualsUpdate[] = []
  for (const area of due) {
    const row = blend.perArea.find(r => r.areaId === area.id)
    if (!row || row.perCover == null || row.covers < MIN_COVERS_TO_UPDATE) continue
    let food: number
    let beverage: number
    if (row.perCoverFood != null && row.perCoverBeverage != null) {
      food = row.perCoverFood
      beverage = row.perCoverBeverage
    } else if (blend.foodBeveragePct) {
      food = row.perCover * blend.foodBeveragePct.food
      beverage = row.perCover * blend.foodBeveragePct.beverage
    } else {
      continue
    }
    food = Math.round(food * 100) / 100
    beverage = Math.round(beverage * 100) / 100
    update.run(food, beverage, closedYm, area.id)
    applied.push({ areaId: area.id, name: area.name, closedMonth: closedYm, food, beverage })
  }
  return applied
}
