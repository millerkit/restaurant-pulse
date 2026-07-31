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
type LoanRow = { loan_key: string, lender: string, payment_date: string, payment_type: 'catch_up' | 'regular', interest: number, principal: number, total_payment: number }
type ReserveTransferRow = { id: number, transfer_date: string, amount: number, note: string | null }

// Next Monday on/after asOfIso (asOfIso itself if it's already a Monday) —
// used to project a completion date from the current pace, since real
// transfers land on Mondays (see CLAUDE.md's reserve_transfers note).
function nextMonday(asOfIso: string): string {
  const d = new Date(`${asOfIso}T00:00:00Z`)
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const daysUntilMonday = (8 - day) % 7
  d.setUTCDate(d.getUTCDate() + daysUntilMonday)
  return d.toISOString().slice(0, 10)
}

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

  // Reserve target: the one-time catch-up interest due Dec 20, 2026 across
  // the 7 original investor loans only — $50,562.50. Reverted 2026-07-31
  // from a brief widening to $52,838.80 (all 10 loans, including Jones &
  // Miller's own catch-up) — that widening double-counted Jones & Miller's
  // piece once the real running-balance simulation below was built: their
  // catch-up is now modeled as a scheduled withdrawal paid out of the
  // reserve around Aug 15 (a pass-through, not money held until December),
  // so folding it into a single static "amount to keep saved" overstated
  // what actually needs to still be sitting in the account by Dec 20.
  // Computed from loan_schedule rather than hardcoded so it can't drift
  // from the actual imported schedule; catchUpDate is pulled the same way.
  const catchUpRows = allLoanRows.filter(r => r.payment_type === 'catch_up' && r.loan_key !== 'jones' && r.loan_key !== 'miller')
  const reserveTarget = catchUpRows.reduce((s, r) => s + r.interest, 0)
  const catchUpDate = catchUpRows[0]?.payment_date ?? null

  // Every loan_schedule row that's actually paid out of this same 1005
  // Loan Payment Reserve account — Jones & Miller's full schedule (their
  // catch-up AND every ongoing regular payment, per the user's 2026-07-31
  // decision to fund their monthly payments from here too), NOT the
  // original 7 loans' regular monthly payments (those still come from
  // normal operating cash — only their one-time catch-up above does).
  const reserveFundedRows = allLoanRows.filter(r => r.loan_key === 'jones' || r.loan_key === 'miller')

  const allTransfers = db.prepare('SELECT * FROM reserve_transfers ORDER BY transfer_date, id').all() as ReserveTransferRow[]
  const plan = db.prepare('SELECT weekly_amount FROM reserve_plan WHERE id = 1').get() as { weekly_amount: number } | undefined

  // Real, actual transfers only — see schema.sql's reserve_transfers
  // comment for why this replaced a fixed $/week schedule assumption (two
  // of the real Jul transfers were reversed the same week; the weekly
  // amount itself changed later). amount is signed, so a reversal nets out
  // naturally rather than needing special-casing here.
  function reserveProgress(asOfIso: string) {
    const toDate = allTransfers.filter(t => t.transfer_date <= asOfIso)
    const saved = toDate.reduce((s, t) => s + t.amount, 0)
    const remaining = Math.max(0, reserveTarget - saved)

    // The declared plan (reserve_plan) wins over inferring a rate from the
    // last transfer — see schema.sql's reserve_plan comment: a user
    // announcing a new weekly amount should update the projection
    // immediately, not wait for the next actual transfer at that rate to
    // land and become "the most recent one." Falls back to the last
    // *positive* transfer (a reversal shouldn't reset the ongoing plan) if
    // no plan has ever been declared.
    const lastPositive = [...toDate].reverse().find(t => t.amount > 0)
    const currentWeeklyAmount = plan?.weekly_amount ?? lastPositive?.amount ?? null

    // Real running-balance projection — replaces the old naive "remaining
    // ÷ weekly amount" division, which ignored the Jones & Miller draws
    // entirely and so was always too optimistic once those started coming
    // out of this same account (see CLAUDE.md's "Declared weekly reserve
    // plan" section — the manual version of exactly this calculation).
    // Simulates every Monday deposit from the next Monday through
    // catchUpDate, interleaved chronologically with every reserve-funded
    // withdrawal due in that window, so the projected balance right before
    // the Dec 20 payment reflects what will actually be left after
    // servicing Jones & Miller along the way.
    let projectedBalanceAtCatchUp: number | null = null
    let onPaceForCatchUp: boolean | null = null
    let catchUpShortfall: number | null = null
    if (currentWeeklyAmount && catchUpDate && catchUpDate > asOfIso) {
      const deposits: { date: string, amount: number }[] = []
      for (let d = nextMonday(asOfIso); d <= catchUpDate; ) {
        if (d < catchUpDate) deposits.push({ date: d, amount: currentWeeklyAmount }) // a same-day deposit wouldn't arrive before the payment
        const next = new Date(`${d}T00:00:00Z`)
        next.setUTCDate(next.getUTCDate() + 7)
        d = next.toISOString().slice(0, 10)
      }
      const withdrawals = reserveFundedRows
        .filter(r => r.payment_date > asOfIso && r.payment_date < catchUpDate)
        .map(r => ({ date: r.payment_date, amount: -r.total_payment }))
      const events = [...deposits, ...withdrawals].sort((a, b) => a.date.localeCompare(b.date))
      projectedBalanceAtCatchUp = events.reduce((bal, e) => bal + e.amount, saved)
      onPaceForCatchUp = projectedBalanceAtCatchUp >= reserveTarget
      catchUpShortfall = Math.max(0, reserveTarget - projectedBalanceAtCatchUp)
    }

    return {
      target: reserveTarget,
      saved,
      remaining,
      currentWeeklyAmount,
      catchUpDate,
      projectedBalanceAtCatchUp,
      onPaceForCatchUp,
      catchUpShortfall,
      complete: remaining <= 0,
      transfers: toDate.map(t => ({ date: t.transfer_date, amount: t.amount, note: t.note }))
    }
  }
  // How much reserve was transferred (net) *within* the requested
  // month/year, for the Free Cash Flow subtraction below — distinct from
  // cumulative progress-to-date above.
  function reserveTransferredInRange(startIso: string, endIso: string) {
    return allTransfers
      .filter(t => t.transfer_date >= startIso && t.transfer_date <= endIso)
      .reduce((s, t) => s + t.amount, 0)
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
