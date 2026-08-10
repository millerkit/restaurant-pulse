// Real Beer/Liquor/Wine/Non-Alcoholic revenue mix (accounts 4022/4024/4026/
// 4028 — all category='revenue', subcategory='Beverage', no children), used
// by the Edit Budget page's "Recompute Revenue from Capacity" action to
// split a month's Capacity-projected Beverage $ across the four real
// accounts by how guests actually spend, instead of by whatever mix
// happens to already be budgeted. Deliberately revenue-only — this never
// reads or writes the COGS-side beverage cost accounts (5110/5120/5125/
// 5130), which are a separate part of the chart of accounts entirely.
//
// Summed only from 2026-06-20 onward (the new location's real opening date
// — see server/api/capacity/history.get.ts's LOCATION_MOVE_PERIODS) rather
// than all of daily_line_items history: blending the old, smaller
// location's beverage program in with the new one would produce a mix that
// reflects neither, the same distortion LOCATION_MOVE_PERIODS was built to
// avoid for the seasonality index. Not a rolling trailing window (unlike
// the COGS recompute's 3-month average) — the new location only has one
// continuous stretch of real data so far, so using all of it is the
// largest, most stable sample available, not a deliberate design choice to
// revisit once more history accumulates.
const SINCE_LOCATION_MOVE = '2026-06-20'

type AccountMixRow = { accountId: number, accountNumber: string | null, name: string, total: number }

export default defineEventHandler(() => {
  const db = useDb()
  const rows = db.prepare(`
    SELECT a.id AS accountId, a.account_number AS accountNumber, a.name AS name, COALESCE(SUM(dli.amount), 0) AS total
    FROM accounts a
    LEFT JOIN daily_line_items dli ON dli.account_id = a.id AND dli.date >= ?
    WHERE a.category = 'revenue' AND a.subcategory = 'Beverage' AND a.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id AND c.is_active = 1)
    GROUP BY a.id
    ORDER BY a.account_number
  `).all(SINCE_LOCATION_MOVE) as AccountMixRow[]

  const total = rows.reduce((sum, r) => sum + r.total, 0)
  const hasData = total > 0
  const accounts = rows.map(r => ({
    accountId: r.accountId,
    accountNumber: r.accountNumber,
    name: r.name,
    actualTotal: r.total,
    pct: hasData ? r.total / total : null
  }))

  return { sinceDate: SINCE_LOCATION_MOVE, hasData, accounts }
})
