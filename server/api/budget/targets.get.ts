// Returns every account's budget_targets row for one month, joined to the
// account info the Budget tab needs to build both the macro rollup (group
// by category) and the per-account drill-down (group by parent_account_id)
// from a single response.
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = Number(query.year)
  const month = Number(query.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month (1-12) query params are required' })
  }

  const db = useDb()
  const rows = db.prepare(`
    SELECT
      a.id AS accountId,
      a.account_number AS accountNumber,
      a.parent_account_id AS parentAccountId,
      a.name,
      a.category,
      a.subcategory,
      a.cost_behavior AS costBehavior,
      a.is_owner_compensation AS isOwnerCompensation,
      bt.amount AS amount
    FROM accounts a
    LEFT JOIN budget_targets bt ON bt.account_id = a.id AND bt.year = ? AND bt.month = ?
    WHERE a.is_active = 1
    ORDER BY a.category, a.id
  `).all(year, month)

  return { year, month, accounts: rows }
})
