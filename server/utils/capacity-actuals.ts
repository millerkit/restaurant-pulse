// Real per-area per-cover revenue over a date range. Used by the automatic
// capacity forecast (server/utils/capacity-forecast.ts) for each area's spend
// per guest.
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
