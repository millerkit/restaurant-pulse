import { NEW_LOCATION_START } from './weekly-targets'

// Real whole-restaurant Food/Beverage revenue split (accounts 4010/4020/
// 4022/4024/4026/4028 — 4000/4020 are parent rollups that never receive
// their own postings, included here only so a future direct posting to
// either wouldn't silently vanish). Same "since the location move, not a
// rolling window" reasoning as beverage-revenue-mix.get.ts: this is the
// largest continuous stretch of real data for the current space, not a
// deliberate choice to revisit once more history accumulates.
//
// Used by the Revenue tab's buyout-planning feature to split a computed
// buyout revenue increment between Food and Beverage before the Beverage
// share gets split further across the four real beverage accounts by
// computeBeverageMix's own real mix.
export type FoodBeverageMix = { foodPct: number | null, beveragePct: number | null, hasData: boolean }

export function computeFoodBeverageMix(): FoodBeverageMix {
  const db = useDb()
  const rows = db.prepare(`
    SELECT a.subcategory AS grp, SUM(dli.amount) AS total
    FROM daily_line_items dli
    JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = 'revenue' AND a.account_number IN ('4010','4020','4022','4024','4026','4028')
      AND dli.date >= ?
    GROUP BY a.subcategory
  `).all(NEW_LOCATION_START) as { grp: string, total: number }[]

  const foodTotal = rows.find(r => r.grp === 'Food')?.total || 0
  const beverageTotal = rows.find(r => r.grp === 'Beverage')?.total || 0
  const total = foodTotal + beverageTotal
  const hasData = total > 0

  return {
    foodPct: hasData ? foodTotal / total : null,
    beveragePct: hasData ? beverageTotal / total : null,
    hasData
  }
}
