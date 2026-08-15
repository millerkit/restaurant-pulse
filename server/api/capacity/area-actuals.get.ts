// Real per-area actuals (covers + $/cover) for this month and last month,
// shown on the Edit Capacity page next to the aspirational Per-Cover
// Revenue (Total) figure — added 2026-08-13 once Toast Configuration API
// scope unblocked resolving table.guid to a real dining area (see
// server/utils/toast-table-map.ts, daily_toast_area_metrics in
// schema.sql). "This month" is capped at the latest date
// daily_toast_area_metrics actually has data for, not today's calendar
// date — mirrors capacity.get.ts's own asOfDate pattern, since Toast sync
// freshness can lag a day or two behind the wall clock.
function monthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const end = new Date(Date.UTC(nextMonth.y, nextMonth.m - 1, 1) - 86400000).toISOString().slice(0, 10)
  return { start, end }
}

export default defineEventHandler(() => {
  const db = useDb()

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_toast_area_metrics').get() as { date: string | null }
  const areas = db.prepare('SELECT id, name FROM capacity_areas ORDER BY id').all() as { id: number; name: string }[]

  if (!asOfDate) {
    return { asOfDate: null, thisMonth: null, lastMonth: null }
  }

  const [asOfYear, asOfMonthNum] = asOfDate.split('-').map(Number)
  const thisMonthRange = monthRange(asOfYear, asOfMonthNum)
  const lastMonthDate = new Date(Date.UTC(asOfYear, asOfMonthNum - 2, 1))
  const lastMonthRange = monthRange(lastMonthDate.getUTCFullYear(), lastMonthDate.getUTCMonth() + 1)

  const sumForRange = (start: string, end: string) => {
    const cappedEnd = end > asOfDate ? asOfDate : end
    if (start > cappedEnd) return areas.map(a => ({ areaId: a.id, covers: 0, revenue: 0, foodRevenue: null as number | null, beverageRevenue: null as number | null, perCover: null as number | null }))
    const rows = db.prepare(`
      SELECT area_id AS areaId, SUM(covers) AS covers, SUM(revenue) AS revenue,
        SUM(food_revenue) AS foodRevenue, SUM(beverage_revenue) AS beverageRevenue
      FROM daily_toast_area_metrics
      WHERE date BETWEEN ? AND ?
      GROUP BY area_id
    `).all(start, cappedEnd) as { areaId: number; covers: number; revenue: number; foodRevenue: number | null; beverageRevenue: number | null }[]
    const byArea = new Map(rows.map(r => [r.areaId, r]))
    return areas.map((a) => {
      const r = byArea.get(a.id)
      const covers = r?.covers ?? 0
      const revenue = r?.revenue ?? 0
      return { areaId: a.id, covers, revenue, foodRevenue: r?.foodRevenue ?? null, beverageRevenue: r?.beverageRevenue ?? null, perCover: covers > 0 ? revenue / covers : null }
    })
  }

  const thisMonth = { ...thisMonthRange, cappedAt: thisMonthRange.end > asOfDate ? asOfDate : thisMonthRange.end, perArea: sumForRange(thisMonthRange.start, thisMonthRange.end) }
  const lastMonth = { ...lastMonthRange, cappedAt: lastMonthRange.end > asOfDate ? asOfDate : lastMonthRange.end, perArea: sumForRange(lastMonthRange.start, lastMonthRange.end) }

  // Two-month trailing blend (this + last month combined, "Set from
  // Actuals" button on the Edit Capacity page) — total revenue over total
  // covers across both months, not an average of the two months' own
  // per-cover figures, since averaging two ratios isn't the same as the
  // true combined ratio once covers differ month to month (same reasoning
  // as history.get.ts's revenueSeries not being built from
  // coversIndex × spendIndex).
  // foodRevenue/beverageRevenue are only non-null for Chef's Counter (see
  // toast-metrics-sync.ts's CHEFS_COUNTER_FOOD_PRICE_PER_COVER) — every
  // other area falls back to the whole-restaurant mix below.
  const trailingTwoMonth = areas.map((a) => {
    const t = thisMonth.perArea.find(r => r.areaId === a.id)!
    const l = lastMonth.perArea.find(r => r.areaId === a.id)!
    const covers = t.covers + l.covers
    const revenue = t.revenue + l.revenue
    const hasRealSplit = t.foodRevenue != null && l.foodRevenue != null
    const foodRevenue = hasRealSplit ? (t.foodRevenue ?? 0) + (l.foodRevenue ?? 0) : null
    const beverageRevenue = hasRealSplit ? (t.beverageRevenue ?? 0) + (l.beverageRevenue ?? 0) : null
    return {
      areaId: a.id,
      covers,
      revenue,
      perCover: covers > 0 ? revenue / covers : null,
      perCoverFood: hasRealSplit && covers > 0 ? (foodRevenue as number) / covers : null,
      perCoverBeverage: hasRealSplit && covers > 0 ? (beverageRevenue as number) / covers : null
    }
  })

  // Toast's own check totals have no food/beverage split (a single
  // totalAmount per check), so a per-area actual can't be split that way
  // directly. Instead, this app's real, whole-restaurant Food/Beverage
  // revenue mix (accounts.subcategory, category='revenue') over the same
  // two-month window is used to divide each area's blended actual — same
  // "distribute a real total using this restaurant's own known mix"
  // technique as beverage-revenue-mix.get.ts, applied one level up (food
  // vs. beverage, not beverage's own 4 sub-accounts). This assumes every
  // area shares the restaurant-wide split, which isn't exactly true (e.g.
  // the Bar plausibly skews more beverage-heavy than the Dining Room) —
  // a known simplification, not a measured per-area split, since QBO has
  // no per-area revenue signal at all to measure one from.
  const mixStart = lastMonth.start
  const mixEnd = thisMonth.cappedAt
  const mixRows = db.prepare(`
    SELECT a.subcategory AS subcategory, COALESCE(SUM(dli.amount), 0) AS total
    FROM accounts a
    JOIN daily_line_items dli ON dli.account_id = a.id AND dli.date BETWEEN ? AND ?
    WHERE a.category = 'revenue' AND a.subcategory IN ('Food', 'Beverage')
    GROUP BY a.subcategory
  `).all(mixStart, mixEnd) as { subcategory: string; total: number }[]
  const foodTotal = mixRows.find(r => r.subcategory === 'Food')?.total ?? 0
  const beverageTotal = mixRows.find(r => r.subcategory === 'Beverage')?.total ?? 0
  const mixSum = foodTotal + beverageTotal
  const foodBeveragePct = mixSum > 0 ? { food: foodTotal / mixSum, beverage: beverageTotal / mixSum } : null

  return {
    asOfDate,
    thisMonth,
    lastMonth,
    trailingTwoMonth: { start: mixStart, end: mixEnd, perArea: trailingTwoMonth, foodBeveragePct }
  }
})
