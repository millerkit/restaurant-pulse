// Backs the Cash Flow tab (see CLAUDE.md's Debt Service / Cash Flow tab
// section) — the second of the "Two Parallel Views" the source brief
// recommended: the P&L view (QBO budget, interest only, from the existing
// accounts/daily_line_items tables) vs. this Cash Flow view (full debt
// service — interest + principal + one-time catch-up interest + reserve
// transfers — from loan_schedule, which QBO's P&L can never show).
//
// query: year, month (1-12). Returns both the requested month's figures and
// the requested year's, so the page can offer a Month/Year toggle without a
// second round trip (mirrors /api/budget/targets' per-month shape, just
// bundled instead of fetched 12x).
const RESERVE_WEEKLY_AMOUNT = 2200
const RESERVE_START = '2026-07-13' // first Monday transfer (see CLAUDE.md)
const RESERVE_END = '2026-12-14'   // last Monday transfer before the Dec 20 catch-up

function mondaysBetween(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const d = new Date(`${startIso}T00:00:00Z`)
  const end = new Date(`${endIso}T00:00:00Z`)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return out
}
// All 23 planned reserve transfer dates, computed once — Section 6 of the
// source brief describes this as "every Monday, Jul 13 – Dec 14 2026",
// which this reproduces exactly (verified: 23 Mondays, matching the brief).
const RESERVE_TRANSFER_DATES = mondaysBetween(RESERVE_START, RESERVE_END)

type LoanRow = { loan_key: string, lender: string, payment_date: string, payment_type: 'catch_up' | 'regular', interest: number, principal: number, total_payment: number }

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = Number(query.year)
  const month = Number(query.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month query params are required' })
  }

  const db = useDb()
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEndFull = `${year}-${String(month).padStart(2, '0')}-31`
  const yearStart = `${year}-01-01`
  const yearEndFull = `${year}-12-31`
  // Free Cash Flow compares actual net income (only ever known through
  // today) against debt service — so both sides of that comparison must be
  // capped at today too, or a Year view would subtract full-year scheduled
  // principal/catch-up (including payments months in the future, like the
  // Dec 20 catch-up) from a net income figure that only covers Jan–today,
  // understating cash position for months that haven't happened yet.
  const monthEnd = monthEndFull < today ? monthEndFull : today
  const yearEnd = yearEndFull < today ? yearEndFull : today

  const allLoanRows = db.prepare('SELECT * FROM loan_schedule ORDER BY payment_date').all() as LoanRow[]

  function summarizeDebtService(rows: LoanRow[]) {
    const regular = rows.filter(r => r.payment_type === 'regular')
    const catchUp = rows.filter(r => r.payment_type === 'catch_up')
    return {
      principal: regular.reduce((s, r) => s + r.principal, 0),
      interest: regular.reduce((s, r) => s + r.interest, 0),
      catchUpInterest: catchUp.reduce((s, r) => s + r.interest, 0),
      totalCashOut: rows.reduce((s, r) => s + r.total_payment, 0),
      payments: rows.map(r => ({ loanKey: r.loan_key, lender: r.lender, date: r.payment_date, type: r.payment_type, interest: r.interest, principal: r.principal, total: r.total_payment }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }
  }
  const monthRows = allLoanRows.filter(r => r.payment_date >= monthStart && r.payment_date <= monthEnd)
  const yearRows = allLoanRows.filter(r => r.payment_date >= yearStart && r.payment_date <= yearEnd)

  // Reserve target: dynamically the sum of catch-up interest for the 7
  // original investor loans only (excludes Jones & Miller's separate, much
  // smaller Aug 2026 catch-up, which the source brief's reserve plan
  // doesn't fund) — computed from loan_schedule rather than hardcoded so it
  // can't drift from the actual imported schedule.
  const reserveTarget = allLoanRows
    .filter(r => r.payment_type === 'catch_up' && r.loan_key !== 'jones' && r.loan_key !== 'miller')
    .reduce((s, r) => s + r.interest, 0)

  function reserveProgress(asOfIso: string) {
    const transfersDone = RESERVE_TRANSFER_DATES.filter(d => d <= asOfIso)
    const transfersRemaining = RESERVE_TRANSFER_DATES.filter(d => d > asOfIso)
    const saved = transfersDone.length * RESERVE_WEEKLY_AMOUNT
    const nextTransferDate = transfersRemaining[0] ?? null
    return {
      weeklyAmount: RESERVE_WEEKLY_AMOUNT,
      target: reserveTarget,
      totalPlanned: RESERVE_TRANSFER_DATES.length * RESERVE_WEEKLY_AMOUNT,
      transfersDone: transfersDone.length,
      transfersTotal: RESERVE_TRANSFER_DATES.length,
      saved,
      nextTransferDate,
      onTrack: saved >= transfersDone.length * RESERVE_WEEKLY_AMOUNT // always true; kept for shape symmetry with pace cards elsewhere
    }
  }
  // How much reserve was transferred *within* the requested month/year, for
  // the Free Cash Flow subtraction below — distinct from cumulative
  // progress-to-date above.
  function reserveTransferredInRange(startIso: string, endIso: string) {
    return RESERVE_TRANSFER_DATES.filter(d => d >= startIso && d <= endIso).length * RESERVE_WEEKLY_AMOUNT
  }

  // Net income + depreciation actuals from the real QBO-synced data, same
  // source the Budget tab uses — see server/api/budget/actuals.get.ts.
  function actualsFor(startIso: string, endIso: string) {
    const catRows = db.prepare(`
      SELECT a.category AS category, SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE dli.date BETWEEN ? AND ?
      GROUP BY category
    `).all(startIso, endIso) as { category: string, total: number }[]
    const totals: Record<string, number> = { revenue: 0, cogs: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }
    let hasData = false
    for (const r of catRows) { totals[r.category] = r.total; hasData = true }
    const netIncome = totals.revenue - totals.cogs - totals.labor - totals.opex + totals.other_income - totals.other_expense

    const depRow = db.prepare(`
      SELECT SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.name = 'Depreciation' AND a.is_active = 1 AND dli.date BETWEEN ? AND ?
    `).get(startIso, endIso) as { total: number | null }
    const depreciation = depRow.total ?? 0

    // What QBO's own books actually show posted to 7020 Loan Interest —
    // deliberately not the same number as debtService.interest below
    // (loan_schedule's computed amortization figure). Spot-checked against
    // local data: actual 7020 already had real dollars posted in May/June
    // 2026, before any of these 10 loans' first payment dates — this
    // account evidently also carries interest from debt outside the scope
    // of this brief, so the P&L table column must show what's really
    // booked, not a number reconstructed from the schedule.
    const interestRow = db.prepare(`
      SELECT SUM(dli.amount) AS total
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.account_number = '7020' AND dli.date BETWEEN ? AND ?
    `).get(startIso, endIso) as { total: number | null }
    const actualLoanInterest = interestRow.total ?? 0

    return { hasData, netIncome, depreciation, actualLoanInterest, totals }
  }

  function freeCashFlow(startIso: string, endIso: string, debtService: ReturnType<typeof summarizeDebtService>) {
    const actuals = actualsFor(startIso, endIso)
    const reserveTransfers = reserveTransferredInRange(startIso, endIso)
    const freeCashFlow = actuals.netIncome + actuals.depreciation - debtService.principal - debtService.catchUpInterest - reserveTransfers
    return { ...actuals, reserveTransfers, principal: debtService.principal, catchUpInterest: debtService.catchUpInterest, freeCashFlow }
  }

  const monthDebtService = summarizeDebtService(monthRows)
  const yearDebtService = summarizeDebtService(yearRows)

  return {
    year,
    month,
    thisMonth: {
      debtService: monthDebtService,
      freeCashFlow: freeCashFlow(monthStart, monthEnd, monthDebtService)
    },
    thisYear: {
      debtService: yearDebtService,
      freeCashFlow: freeCashFlow(yearStart, yearEnd, yearDebtService)
    },
    reserve: reserveProgress(today),
    upcomingPayments: allLoanRows
      .filter(r => r.payment_date >= today)
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date))
      .slice(0, 10)
      .map(r => ({ loanKey: r.loan_key, lender: r.lender, date: r.payment_date, type: r.payment_type, interest: r.interest, principal: r.principal, total: r.total_payment }))
  }
})
