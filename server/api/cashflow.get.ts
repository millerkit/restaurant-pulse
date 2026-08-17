// Backs the Cash Flow tab (see CLAUDE.md's Debt Service / Cash Flow tab
// section) — the second of the "Two Parallel Views" the source brief
// recommended: the P&L view (QBO budget, interest only, from the existing
// accounts/daily_line_items tables) vs. this Cash Flow view (full debt
// service — interest + principal + one-time catch-up interest + reserve
// transfers — from loan_schedule, which QBO's P&L can never show).
//
// query: year. Year-to-date only — the page dropped its Month view
// 2026-08-11: a single in-progress month's accrued loan interest isn't
// posted until month-end, so a partial month never had a meaningful number
// to show here.
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
  if (!Number.isInteger(year)) {
    throw createError({ statusCode: 400, statusMessage: 'year query param is required' })
  }

  const db = useDb()
  const today = new Date().toISOString().slice(0, 10)
  const yearStart = `${year}-01-01`
  const yearEndFull = `${year}-12-31`
  // Free Cash Flow compares actual net income (only ever known through
  // today) against debt service — so both sides of that comparison must be
  // capped at today too, or the Year view would subtract full-year
  // scheduled principal/catch-up (including payments months in the future,
  // like the Dec 20 catch-up) from a net income figure that only covers
  // Jan–today, understating cash position for months that haven't happened
  // yet.
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
  const yearRows = allLoanRows.filter(r => r.payment_date >= yearStart && r.payment_date <= yearEnd)

  // Reserve target: the full Dec 20, 2026 cash payment across the 7
  // original investor loans (catch-up interest + their first regular
  // installment) — $61,693.48. Widened 2026-08-15 from just the catch-up
  // interest portion ($50,562.50): that narrower figure was correct only
  // as long as the 7 loans' regular installment was assumed to come from
  // separate operating cash, per the filter comment on reserveFundedRows
  // above — the SaasAnt Expense import built that day draws their ENTIRE
  // Dec 20 payment (catch-up AND installment) from this same account, so
  // the target — "how much needs to be sitting here right before Dec 20"
  // — has to cover all of it, not just the catch-up piece. (This is a
  // separate widening from the one reverted 2026-07-31, which was about
  // folding Jones & Miller's OWN catch-up into a static target — that
  // reasoning still holds: their catch-up stays modeled as an ordinary
  // scheduled withdrawal in the simulation below, not part of this
  // target.) Computed from loan_schedule rather than hardcoded so it can't
  // drift from the actual imported schedule; catchUpDate is pulled the
  // same way.
  const catchUpLoanKeys = allLoanRows
    .filter(r => r.payment_type === 'catch_up' && r.loan_key !== 'jones' && r.loan_key !== 'miller')
    .map(r => r.loan_key)
  const catchUpRows = allLoanRows.filter(r => r.payment_type === 'catch_up' && catchUpLoanKeys.includes(r.loan_key))
  const catchUpDate = catchUpRows[0]?.payment_date ?? null
  const reserveTarget = allLoanRows
    .filter(r => catchUpLoanKeys.includes(r.loan_key) && r.payment_date === catchUpDate)
    .reduce((s, r) => s + r.total_payment, 0)

  // Every loan_schedule row that's actually paid out of this same reserve
  // account (QBO: "American Express Loan Reserve (1832)"). Widened
  // 2026-08-15 to all 9 private loans, not just Jones & Miller — the
  // SaasAnt Expense import built that day set up Chen/Savage/Schaefer/
  // Gilreath/Mis/Price/Reid's payments (including their Dec 20 catch-up +
  // first installment, not just the catch-up) to draw from this account
  // too, not from separate operating cash as originally assumed when this
  // filter was first written 2026-07-31. reserveTarget above stays scoped
  // to just the pure catch-up interest figure ($50,562.50) — the 7 loans'
  // regular installment is treated the same way Jones & Miller's regular
  // payments always have been: an ordinary withdrawal event in the
  // simulation below, not part of the minimum-balance target itself.
  const reserveFundedRows = allLoanRows.filter(r => r.loan_key !== 'sba')

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
      // >= asOfIso, not >: a loan payment scheduled for today still draws
      // the account down today regardless of what moment reserveProgress()
      // happens to run at — found 2026-08-15 when this ran on a real
      // Jones/Miller payment date and silently ignored that day's own
      // $7,776.92 draw, since `saved` (from reserve_transfers) only ever
      // reflects deposits and has no way to already account for it.
      const withdrawals = reserveFundedRows
        .filter(r => r.payment_date >= asOfIso && r.payment_date < catchUpDate)
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

  // Only SBA's debt service is paid directly from operating cash — every
  // other loan (reserveFundedRows, above) draws from the 1005 reserve
  // account, which is itself built up FROM operating cash via the reserve
  // transfers subtracted below. Subtracting those loans' principal/catch-up
  // interest AGAIN here would double-count the same cash outflow: once when
  // it left operating cash as a reserve transfer, again when it left the
  // reserve to pay the lender. Found 2026-08-16 after the user pointed out
  // the reserve transfers exist specifically TO cover these loan payments,
  // which made adding both to "profit needed" confusing — and, on
  // inspection, not just confusing but wrong once reserveFundedRows was
  // widened to all 9 private loans (was a much smaller double-count back
  // when only Jones/Miller drew from reserve). rows is still summarized in
  // full for display elsewhere (thisYear.debtService below, and
  // fullYearReserveFunded further down — both informational totals) — only
  // this subtraction is scoped to SBA.
  function freeCashFlow(startIso: string, endIso: string, rows: LoanRow[]) {
    const actuals = actualsFor(startIso, endIso)
    const reserveTransfers = reserveTransferredInRange(startIso, endIso)
    const direct = summarizeDebtService(rows.filter(r => r.loan_key === 'sba'))
    const reserveFunded = summarizeDebtService(rows.filter(r => r.loan_key !== 'sba'))
    const freeCashFlow = actuals.netIncome + actuals.depreciation - direct.principal - direct.catchUpInterest - reserveTransfers
    return {
      ...actuals,
      reserveTransfers,
      principal: direct.principal,
      catchUpInterest: direct.catchUpInterest,
      reserveFundedPrincipal: reserveFunded.principal,
      reserveFundedCatchUpInterest: reserveFunded.catchUpInterest,
      freeCashFlow
    }
  }

  const yearDebtService = summarizeDebtService(yearRows)

  // ---- Year-end projection (budget as-is) --------------------------------
  // Backs the Year view's "profit needed to cover the loans" / "profit
  // projected" headline numbers. Deliberately the FULL calendar year
  // (uncapped at today), unlike yearRows/yearDebtService above (which stay
  // capped at today so they compare fairly against actual-to-date Net
  // Income) — this is a forward-looking target for the whole year, not a
  // to-date figure.
  const fullYearRows = allLoanRows.filter(r => r.payment_date >= yearStart && r.payment_date <= yearEndFull)

  const depBudgetRow = db.prepare(`
    SELECT SUM(bt.amount) AS total
    FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE a.name = 'Depreciation' AND a.is_active = 1 AND bt.year = ?
  `).get(year) as { total: number | null }
  const budgetedDepreciationForYear = depBudgetRow.total ?? 0

  // Reserve transfers for the full year: actual net transfers already made
  // (through today) plus every remaining Monday through Dec 31 at the
  // currently-declared weekly plan — same fallback reserveProgress() uses
  // (last real positive transfer) if no plan has ever been declared.
  const transfersInYearToDate = allTransfers.filter(t => t.transfer_date >= yearStart && t.transfer_date <= today)
  const savedInYearToDate = transfersInYearToDate.reduce((s, t) => s + t.amount, 0)
  const lastPositiveTransfer = [...allTransfers].reverse().find(t => t.amount > 0)
  const currentWeeklyAmountForProjection = plan?.weekly_amount ?? lastPositiveTransfer?.amount ?? 0
  let remainingMondaysInYear = 0
  for (let d = nextMonday(today); d <= yearEndFull; ) {
    if (d > today) remainingMondaysInYear++ // nextMonday(today) returns today itself when today's a Monday — already covered by savedInYearToDate, so don't double-count it
    const next = new Date(`${d}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 7)
    d = next.toISOString().slice(0, 10)
  }
  const reserveTransfersProjectedForYear = savedInYearToDate + remainingMondaysInYear * currentWeeklyAmountForProjection

  // Net Income needed for full-year Free Cash Flow to hit $0 — i.e. profit
  // needed to cover what the P&L doesn't show. Only SBA's principal is
  // added directly (see the freeCashFlow() comment above for why the other
  // 9 loans' principal/catch-up interest isn't also added here — it's
  // already inside reserveTransfersProjectedForYear). Loan interest itself
  // is already netted into Net Income and so doesn't need a separate check.
  const fullYearDirect = summarizeDebtService(fullYearRows.filter(r => r.loan_key === 'sba'))
  const fullYearReserveFunded = summarizeDebtService(fullYearRows.filter(r => r.loan_key !== 'sba'))
  const breakevenNetIncomeForYear = fullYearDirect.principal + fullYearDirect.catchUpInterest + reserveTransfersProjectedForYear - budgetedDepreciationForYear

  return {
    year,
    thisYear: {
      debtService: yearDebtService,
      freeCashFlow: freeCashFlow(yearStart, yearEnd, yearRows)
    },
    yearProjection: {
      principal: fullYearDirect.principal,
      catchUpInterest: fullYearDirect.catchUpInterest,
      reserveFundedPrincipal: fullYearReserveFunded.principal,
      reserveFundedCatchUpInterest: fullYearReserveFunded.catchUpInterest,
      depreciation: budgetedDepreciationForYear,
      reserveTransfers: reserveTransfersProjectedForYear,
      breakevenNetIncome: breakevenNetIncomeForYear
    },
    reserve: reserveProgress(today),
    upcomingPayments: allLoanRows
      .filter(r => r.payment_date >= today)
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date))
      .slice(0, 10)
      .map(r => ({ loanKey: r.loan_key, lender: r.lender, date: r.payment_date, type: r.payment_type, interest: r.interest, principal: r.principal, total: r.total_payment }))
  }
})
