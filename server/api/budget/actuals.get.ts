// Real per-month, per-category actuals from daily_line_items — the
// independent "what actually happened" side of a budget-vs-actual
// comparison. Deliberately a separate source from budget_targets, which
// (per CLAUDE.md) has sometimes been hand-overwritten with real numbers for
// closed months — daily_line_items is only ever written by the QBO sync, so
// it stays a clean actuals signal even for months where that habit
// clobbered the original budget. Empty until a real backfill/sync has
// populated this year's data.
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = Number(query.year)
  if (!Number.isInteger(year)) {
    throw createError({ statusCode: 400, statusMessage: 'year query param is required' })
  }

  const db = useDb()
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%m', dli.date) AS INTEGER) AS month,
      a.category AS category,
      SUM(dli.amount) AS total
    FROM daily_line_items dli
    JOIN accounts a ON a.id = dli.account_id
    WHERE strftime('%Y', dli.date) = ?
    GROUP BY month, category
  `).all(String(year)) as { month: number, category: string, total: number }[]

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    hasData: false,
    totals: { revenue: 0, cogs: 0, labor: 0, opex: 0, other: 0 } as Record<string, number>
  }))
  for (const r of rows) {
    const m = months[r.month - 1]
    m.hasData = true
    m.totals[r.category] = r.total
  }

  return { year, months }
})
