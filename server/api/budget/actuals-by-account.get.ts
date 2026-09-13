// Real per-account actuals for one month, from daily_line_items — the
// per-line-item counterpart to actuals.get.ts's per-category year totals.
// Powers the Edit Budget page's read-only Budget vs Actual columns for a
// closed month. Only accounts with synced activity are returned; any
// account absent from the response is $0 for that account that month, not
// "unknown" — the caller already knows whether the month has synced data
// at all from whether this list is empty.
type MonthRef = { year: number, month: number }

function monthBounds({ year, month }: MonthRef) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = Number(query.year)
  const month = Number(query.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month (1-12) query params are required' })
  }

  const db = useDb()
  const { start, end } = monthBounds({ year, month })
  const rows = db.prepare(`
    SELECT account_id AS accountId, SUM(amount) AS amount
    FROM daily_line_items
    WHERE date BETWEEN ? AND ?
    GROUP BY account_id
  `).all(start, end) as { accountId: number, amount: number }[]

  // The latest date this month that has any real labor posting. Labor is
  // dominated by payroll paid every Friday — a lump on the pay date, not a
  // cost that accrues evenly across the month — so the Edit Budget page
  // prorates its labor projection by how many of the month's Friday payroll
  // runs have already landed (Fridays on or before this date) rather than by
  // elapsed operating days. null when no labor has synced for the month yet.
  const laborLatest = db.prepare(`
    SELECT MAX(dli.date) AS latest
    FROM daily_line_items dli
    JOIN accounts a ON a.id = dli.account_id
    WHERE dli.date BETWEEN ? AND ? AND a.category = 'labor'
  `).get(start, end) as { latest: string | null }

  return { year, month, accounts: rows, laborLatestDate: laborLatest.latest ?? null }
})
