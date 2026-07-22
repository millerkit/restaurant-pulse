// Shared engine behind two Budget-tab actions that are really the same
// operation: "update this month's budget from actuals" (source and target
// month are the same) and "project remaining months from a recent actual
// month" (source is the last closed month, targets are the months ahead).
// For each account, sums daily_line_items for the source month and upserts
// that total into budget_targets for every target month.
type MonthRef = { year: number, month: number }

function monthBounds({ year, month }: MonthRef) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ sourceYear: number, sourceMonth: number, targetMonths: MonthRef[], accountIds?: number[] }>(event)
  const { sourceYear, sourceMonth, targetMonths, accountIds } = body || {}

  if (!Number.isInteger(sourceYear) || !Number.isInteger(sourceMonth) || sourceMonth < 1 || sourceMonth > 12) {
    throw createError({ statusCode: 400, statusMessage: 'sourceYear and sourceMonth (1-12) are required' })
  }
  if (!Array.isArray(targetMonths) || targetMonths.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'targetMonths must be a non-empty array of { year, month }' })
  }
  for (const t of targetMonths) {
    if (!Number.isInteger(t.year) || !Number.isInteger(t.month) || t.month < 1 || t.month > 12) {
      throw createError({ statusCode: 400, statusMessage: `Invalid target month: ${JSON.stringify(t)}` })
    }
  }

  const db = useDb()
  const { start, end } = monthBounds({ year: sourceYear, month: sourceMonth })

  const anyActuals = db.prepare('SELECT 1 FROM daily_line_items WHERE date BETWEEN ? AND ? LIMIT 1').get(start, end)
  if (!anyActuals) {
    throw createError({ statusCode: 422, statusMessage: `No actuals available for ${sourceYear}-${String(sourceMonth).padStart(2, '0')} yet` })
  }

  const accountFilter = accountIds && accountIds.length > 0
    ? `AND account_id IN (${accountIds.map(() => '?').join(',')})`
    : ''
  const actuals = db.prepare(`
    SELECT account_id AS accountId, SUM(amount) AS total
    FROM daily_line_items
    WHERE date BETWEEN ? AND ? ${accountFilter}
    GROUP BY account_id
  `).all(start, end, ...(accountIds && accountIds.length > 0 ? accountIds : [])) as { accountId: number, total: number }[]

  const upsert = db.prepare(`
    INSERT INTO budget_targets (year, month, account_id, amount)
    VALUES (@year, @month, @accountId, @amount)
    ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount
  `)
  const upsertAll = db.transaction(() => {
    let count = 0
    for (const target of targetMonths) {
      for (const a of actuals) {
        upsert.run({ year: target.year, month: target.month, accountId: a.accountId, amount: a.total })
        count++
      }
    }
    return count
  })
  const updated = upsertAll()

  return { accountsCopied: actuals.length, targetMonths, updated }
})
