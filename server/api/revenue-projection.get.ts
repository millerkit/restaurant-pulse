// Night-by-night core dine-in revenue projection for one month (added 2026-11-05),
// used by the Revenue tab's current-month "Projected" column. The logic lives in
// server/utils/revenue-projection.ts (moved 2026-11-11 so forecast snapshots can reuse it).
import { computeRevenueProjection } from '../utils/revenue-projection'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const year = Number(q.year)
  const month = Number(q.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month are required' })
  }
  return computeRevenueProjection(useDb(), year, month)
})
