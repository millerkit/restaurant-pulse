// Scheduled loan principal per month for one year, from loan_schedule (all 10 loans). Principal is
// not a P&L expense: it only reduces cash. Backs the Budget Total tab's "Loan principal payments"
// line under Net Income. Same source as Cash & Loans (`principal` on each schedule row).
export default defineEventHandler((event) => {
  const year = Number(getQuery(event).year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createError({ statusCode: 400, statusMessage: 'year query param is required' })
  }
  const rows = useDb().prepare(`
    SELECT CAST(substr(payment_date, 6, 2) AS INTEGER) AS month, SUM(principal) AS principal
    FROM loan_schedule
    WHERE substr(payment_date, 1, 4) = ?
    GROUP BY month
  `).all(String(year)) as { month: number, principal: number }[]
  const months: number[] = Array.from({ length: 12 }, () => 0)
  for (const r of rows) months[r.month - 1] = Math.round(r.principal * 100) / 100
  return { months, total: Math.round(months.reduce((s, v) => s + v, 0) * 100) / 100 }
})
