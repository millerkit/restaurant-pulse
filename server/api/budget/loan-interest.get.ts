// Scheduled loan interest per month for one year, from loan_schedule (the 10-loan amortization
// import — see CLAUDE.md's Debt Service / Cash Flow tab section). Backs the Budget tab's
// "Build next year's budget" action: carrying December 2026's 7020 Loan Interest budget into
// every month of 2027 would bake in the one-time Dec 20 catch-up interest, so 7020 can instead
// be budgeted from what the schedule says each 2027 month actually owes.
//
// Deferred-payment accrual: during the Miller deferral (see scripts/defer-miller-loan.mjs and
// CLAUDE.md) there are no Miller payment rows for Nov 2026 - Jun 2027, but interest still accrues
// on the P&L (a monthly accrual journal entry in QBO). So for each month where the deferral's
// backup table has Miller rows and loan_schedule has none, the accrual is added: the backup's
// first row's interest (= opening principal x rate / 12, the same figure the script reports as
// its monthly accrual). Absent the backup table (no deferral applied), nothing is added.
//
// Only 'regular' payments: a 'catch_up' row is a one-time lump that isn't part of a month's
// ordinary run rate. (A year with no catch-up rows, like 2027, is unaffected.)
export default defineEventHandler((event) => {
  const year = Number(getQuery(event).year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createError({ statusCode: 400, statusMessage: 'year query param is required' })
  }
  const db = useDb()
  const rows = db.prepare(`
    SELECT CAST(substr(payment_date, 6, 2) AS INTEGER) AS month, SUM(interest) AS interest
    FROM loan_schedule
    WHERE payment_type = 'regular' AND substr(payment_date, 1, 4) = ?
    GROUP BY month
  `).all(String(year)) as { month: number, interest: number }[]
  const months: (number | null)[] = Array.from({ length: 12 }, () => null)
  for (const r of rows) months[r.month - 1] = Math.round(r.interest * 100) / 100

  const accrued: (number | null)[] = Array.from({ length: 12 }, () => null)
  const hasBackup = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'loan_schedule_miller_backup'").get()
  if (hasBackup) {
    const monthlyAccrual = (db.prepare('SELECT interest FROM loan_schedule_miller_backup ORDER BY payment_date LIMIT 1').get() as { interest: number } | undefined)?.interest
    const deferredMonths = db.prepare(`
      SELECT DISTINCT CAST(substr(b.payment_date, 6, 2) AS INTEGER) AS month
      FROM loan_schedule_miller_backup b
      WHERE substr(b.payment_date, 1, 4) = ?
        AND NOT EXISTS (SELECT 1 FROM loan_schedule l WHERE l.loan_key = 'miller' AND substr(l.payment_date, 1, 7) = substr(b.payment_date, 1, 7))
    `).all(String(year)) as { month: number }[]
    if (monthlyAccrual) {
      for (const d of deferredMonths) {
        const amount = Math.round(monthlyAccrual * 100) / 100
        accrued[d.month - 1] = amount
        months[d.month - 1] = Math.round(((months[d.month - 1] ?? 0) + amount) * 100) / 100
      }
    }
  }
  // `months` includes the accrual; `accrued` shows which months carry one.
  return { year, hasSchedule: rows.length > 0, months, accrued }
})
