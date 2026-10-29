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
  // Actuals" button on the Edit Capacity page). The math lives in
  // server/utils/capacity-actuals.ts so the nightly month-close auto-update
  // for areas with follow_actuals = 1 uses exactly the same definition.
  const mixStart = lastMonth.start
  const mixEnd = thisMonth.cappedAt
  const blend = blendForRange(db, mixStart, mixEnd)
  const trailingTwoMonth = blend.perArea
  const foodBeveragePct = blend.foodBeveragePct

  return {
    asOfDate,
    thisMonth,
    lastMonth,
    trailingTwoMonth: { start: mixStart, end: mixEnd, perArea: trailingTwoMonth, foodBeveragePct }
  }
})
