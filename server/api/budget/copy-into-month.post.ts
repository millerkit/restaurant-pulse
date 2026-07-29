// Shared engine behind three Budget-tab actions: "update this month's budget
// from actuals" (source and target month are the same — reconciling a
// closed month against real results), "update this month from last month",
// and "update this month from the same month last year". For each account,
// sums daily_line_items for the source month and upserts that total into
// budget_targets for every target month.
//
// The latter two are also asked to work when the source month has no
// actuals yet — e.g. seeding an unbudgeted future month from a recent
// month's budget, or from last year before this year's sync has caught up.
// When allowBudgetFallback is set, a source month with no *usable* actuals
// falls back to copying that month's existing budget_targets instead of
// failing outright. The same-month reconcile action never sets this —
// falling back to a month's own budget would just copy it onto itself, a
// no-op that would also mask "no actuals yet" as if the action had done
// something.
//
// "Usable" actuals means the source month has actually closed. A source
// month that's still in progress (e.g. copying July into August while
// July itself isn't over) only has a partial-month sum in daily_line_items
// — using that as a full-month starting figure would understate it the
// same way the disabled same-month case would. So an in-progress or future
// source month always prefers its budget over its own partial actuals,
// regardless of whether some actuals rows exist for it. This uses the real
// calendar date — daily_line_items/budget_targets are real synced data, not
// the sample figures still shown on the P&L page.
type MonthRef = { year: number, month: number }

function monthBounds({ year, month }: MonthRef) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

function isMonthClosed(year: number, month: number): boolean {
  const now = new Date()
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    sourceYear: number, sourceMonth: number, targetMonths: MonthRef[], accountIds?: number[], allowBudgetFallback?: boolean,
    roundTo?: number, onlyMissing?: boolean
  }>(event)
  const { sourceYear, sourceMonth, targetMonths, accountIds, allowBudgetFallback, onlyMissing } = body || {}
  // Defaults to the original $100 rounding for callers that don't pass it;
  // the per-line-item "fill missing" action passes 10 (see edit.vue).
  const roundTo = body?.roundTo || 100

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
  const accountFilter = accountIds && accountIds.length > 0
    ? `AND account_id IN (${accountIds.map(() => '?').join(',')})`
    : ''
  const accountFilterArgs = accountIds && accountIds.length > 0 ? accountIds : []
  const sourceLabel = `${sourceYear}-${String(sourceMonth).padStart(2, '0')}`

  const closed = isMonthClosed(sourceYear, sourceMonth)
  const anyActuals = closed && db.prepare(`SELECT 1 FROM daily_line_items WHERE date BETWEEN ? AND ? ${accountFilter} LIMIT 1`)
    .get(start, end, ...accountFilterArgs)

  let rows: { accountId: number, amount: number }[]
  let source: 'actuals' | 'budget'

  if (anyActuals) {
    source = 'actuals'
    const actuals = db.prepare(`
      SELECT account_id AS accountId, SUM(amount) AS total
      FROM daily_line_items
      WHERE date BETWEEN ? AND ? ${accountFilter}
      GROUP BY account_id
    `).all(start, end, ...accountFilterArgs) as { accountId: number, total: number }[]
    // Rounded (to $100 by default, or roundTo if the caller passes one) —
    // these are starting points meant to be edited by hand afterward, not
    // final figures, so cent-level actuals would be false precision.
    rows = actuals.map(a => ({ accountId: a.accountId, amount: Math.round(a.total / roundTo) * roundTo }))
  } else if (allowBudgetFallback) {
    source = 'budget'
    rows = db.prepare(`
      SELECT account_id AS accountId, amount
      FROM budget_targets
      WHERE year = ? AND month = ? ${accountFilter}
    `).all(sourceYear, sourceMonth, ...accountFilterArgs) as { accountId: number, amount: number }[]
    if (rows.length === 0) {
      throw createError({
        statusCode: 422,
        statusMessage: closed
          ? `No actuals or budget available for ${sourceLabel} yet`
          : `No budget set for ${sourceLabel} yet (it hasn't closed, so its actuals can't be used as a full-month figure)`
      })
    }
  } else {
    throw createError({ statusCode: 422, statusMessage: `No actuals available for ${sourceLabel} yet` })
  }

  // onlyMissing (the per-line-item "fill gaps" action) never touches an
  // account that already has a budget_targets row for the target month —
  // e.g. a revenue figure the user already typed in by hand should survive
  // a click of this button, not get clobbered by the source month's number.
  const existingQuery = db.prepare(`SELECT account_id FROM budget_targets WHERE year = ? AND month = ? AND amount IS NOT NULL`)

  const upsert = db.prepare(`
    INSERT INTO budget_targets (year, month, account_id, amount)
    VALUES (@year, @month, @accountId, @amount)
    ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount
  `)
  const upsertAll = db.transaction(() => {
    let count = 0
    for (const target of targetMonths) {
      const alreadySet = onlyMissing
        ? new Set((existingQuery.all(target.year, target.month) as { account_id: number }[]).map(r => r.account_id))
        : null
      for (const r of rows) {
        if (alreadySet?.has(r.accountId)) continue
        upsert.run({ year: target.year, month: target.month, accountId: r.accountId, amount: r.amount })
        count++
      }
    }
    return count
  })
  const updated = upsertAll()

  return { accountsCopied: rows.length, targetMonths, updated, source }
})
