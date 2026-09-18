// Everything the Labor tab (app/pages/budget/labor.vue) needs in one fetch: every
// labor_position_settings-managed account, its labor_position_slots rows, the current
// labor_tax_rates (or null if never saved — the seed script normally sets a starting
// suggestion, see scripts/seed-labor-position-settings.mjs), and a trailing-actual
// $/week hint for BOH OT / FOH OT. See schema.sql's labor_position_settings comment for
// the overall design.
type SlotRow = { id: number, slotIndex: number, employeeName: string | null, hourlyRate: number, weeklyHours: number, weeklySalary: number }
type GroupKey = 'boh' | 'foh' | 'management' | 'benefits' | 'tax' | 'other'

const GROUP_PARENT_NUMBERS: Record<string, GroupKey> = {
  '6010': 'boh', '6030': 'foh', '6050': 'management', '6060': 'benefits', '6080': 'tax'
}

// Local-date Friday counter — server routes can't import app/composables (client-only
// build context), so this is a small self-contained duplicate of the same definition as
// countFridays in useBudgetData.ts, same "duplicate a small helper across a context
// boundary" posture this codebase already uses elsewhere (see qbo-pl-parse.mjs,
// backfill scripts). Dates are parsed from explicit y/m/d components, not a raw string,
// to avoid UTC-parse timezone drift.
function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function countFridaysBetween(startIso: string, endIso: string): number {
  let count = 0
  const d = isoToLocalDate(startIso)
  const end = isoToLocalDate(endIso)
  while (d <= end) {
    if (d.getDay() === 5) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

function otHistoryFor(db: ReturnType<typeof useDb>, accountNumber: string): { weeklyAvg: number | null, monthsOfData: number } {
  const account = db.prepare('SELECT id FROM accounts WHERE account_number = ?').get(accountNumber) as { id: number } | undefined
  if (!account) return { weeklyAvg: null, monthsOfData: 0 }
  const months = (db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', date) AS ym FROM daily_line_items WHERE account_id = ? ORDER BY ym DESC LIMIT 6
  `).all(account.id) as { ym: string }[]).map(r => r.ym)
  if (months.length === 0) return { weeklyAvg: null, monthsOfData: 0 }
  const placeholders = months.map(() => '?').join(',')
  const bounds = db.prepare(`
    SELECT MIN(date) AS minDate, MAX(date) AS maxDate, COALESCE(SUM(amount), 0) AS total
    FROM daily_line_items WHERE account_id = ? AND strftime('%Y-%m', date) IN (${placeholders})
  `).get(account.id, ...months) as { minDate: string, maxDate: string, total: number }
  const fridays = countFridaysBetween(bounds.minDate, bounds.maxDate)
  return { weeklyAvg: fridays > 0 ? bounds.total / fridays : null, monthsOfData: months.length }
}

// Trailing 2-month reference data for wage roles (hourly), flat accounts (Other Labor,
// Employee Benefits), and the tax accounts — added at the user's request to help set more
// accurate hours/amounts/rates than guessing. A single shared window (the 2 most recent
// months with any real labor activity at all), not each account picking its own — keeps
// the "trailing Jun-Jul avg" label meaningful across every account it's shown next to,
// rather than silently comparing different months account to account.
//
// For hourly accounts this returns the raw trailing $ actual only — converting that into
// "implied hours" needs an hourly rate, and the only rate that means anything is whatever
// the user has currently typed into this account's own slots (their live, unsaved draft),
// which this server route has no visibility into. That conversion happens client-side
// instead (see accountAvgRate/impliedWeeklyHours in labor.vue).
function trailingWindowMonths(db: ReturnType<typeof useDb>): string[] {
  return (db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', dli.date) AS ym
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = 'labor'
    ORDER BY ym DESC LIMIT 2
  `).all() as { ym: string }[]).map(r => r.ym)
}

// avgMonthlyDollars backs the flat accounts' (Other Labor/Benefits) "$/mo" hint directly.
// weeklyAvg backs the hourly roles' "hrs/wk" hint instead — added after the user pointed
// out monthly hours don't map cleanly onto a field labeled "typical hrs/wk"; you'd have to
// do the month-to-week conversion yourself. Rather than a flat /4.33-weeks-per-month
// guess, this reuses the exact same real-Friday-count technique otHistoryFor already uses
// (per-account MIN/MAX date within the window, divided by the real number of Fridays
// between them) — consistent with the rest of this app treating payroll as a real weekly
// Friday lump, not a smoothed monthly average.
function trailingActualsByAccount(db: ReturnType<typeof useDb>, months: string[]): Record<number, { avgMonthlyDollars: number, weeklyAvg: number | null }> {
  if (months.length === 0) return {}
  const placeholders = months.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT dli.account_id AS accountId, SUM(dli.amount) AS total, MIN(dli.date) AS minDate, MAX(dli.date) AS maxDate
    FROM daily_line_items dli
    JOIN labor_position_settings lps ON lps.account_id = dli.account_id
    WHERE strftime('%Y-%m', dli.date) IN (${placeholders})
    GROUP BY dli.account_id
  `).all(...months) as { accountId: number, total: number, minDate: string, maxDate: string }[]
  const result: Record<number, { avgMonthlyDollars: number, weeklyAvg: number | null }> = {}
  for (const r of rows) {
    const fridays = countFridaysBetween(r.minDate, r.maxDate)
    result[r.accountId] = { avgMonthlyDollars: r.total / months.length, weeklyAvg: fridays > 0 ? r.total / fridays : null }
  }
  return result
}

// Same "wage-subject" definition used everywhere else (every hourly/salary/overtime/flat
// labor account except Employee Benefits and Payroll Taxes themselves) — mirrors
// scripts/seed-labor-position-settings.mjs's impliedRate() helper, duplicated rather than
// shared since that script runs under plain Node, not this Nitro server context.
function trailingTaxRates(db: ReturnType<typeof useDb>, months: string[]): Record<string, number | null> {
  const empty = { medicare: null, social_security: null, futa: null, suta_ma: null, pfml_ma: null }
  if (months.length === 0) return empty
  const placeholders = months.map(() => '?').join(',')
  const wageSubjectTotal = (db.prepare(`
    SELECT COALESCE(SUM(dli.amount), 0) AS total
    FROM daily_line_items dli
    WHERE dli.account_id IN (
      SELECT a.id FROM accounts a
      WHERE a.category = 'labor'
        AND a.id NOT IN (
          SELECT id FROM accounts WHERE account_number IN ('6060', '6080')
          UNION
          SELECT id FROM accounts WHERE parent_account_id IN (SELECT id FROM accounts WHERE account_number IN ('6060', '6080'))
        )
    )
    AND strftime('%Y-%m', dli.date) IN (${placeholders})
  `).get(...months) as { total: number }).total
  if (wageSubjectTotal <= 0) return empty
  const taxTotals = db.prepare(`
    SELECT lps.tax_key AS taxKey, SUM(dli.amount) AS total
    FROM daily_line_items dli
    JOIN labor_position_settings lps ON lps.account_id = dli.account_id AND lps.pay_type = 'tax'
    WHERE strftime('%Y-%m', dli.date) IN (${placeholders})
    GROUP BY lps.tax_key
  `).all(...months) as { taxKey: string, total: number }[]
  const result: Record<string, number | null> = { ...empty }
  for (const r of taxTotals) result[r.taxKey] = r.total / wageSubjectTotal
  return result
}

export default defineEventHandler(() => {
  const db = useDb()

  const accountRows = db.prepare(`
    SELECT
      a.id AS accountId, a.account_number AS accountNumber, a.name, a.parent_account_id AS parentAccountId,
      p.account_number AS parentAccountNumber,
      lps.pay_type AS payType, lps.scales_with_seasonality AS scalesWithSeasonality,
      lps.ot_hours AS otHours, lps.ot_base_group AS otBaseGroup, lps.flat_amount AS flatAmount, lps.tax_key AS taxKey
    FROM accounts a
    JOIN labor_position_settings lps ON lps.account_id = a.id
    LEFT JOIN accounts p ON p.id = a.parent_account_id
    WHERE a.is_active = 1
    ORDER BY a.account_number
  `).all() as any[]

  const slotRows = db.prepare(`
    SELECT account_id AS accountId, id, slot_index AS slotIndex, employee_name AS employeeName,
           hourly_rate AS hourlyRate, weekly_hours AS weeklyHours, weekly_salary AS weeklySalary
    FROM labor_position_slots ORDER BY account_id, slot_index
  `).all() as (SlotRow & { accountId: number })[]
  const slotsByAccount = new Map<number, SlotRow[]>()
  for (const s of slotRows) {
    const list = slotsByAccount.get(s.accountId) ?? []
    list.push({ id: s.id, slotIndex: s.slotIndex, employeeName: s.employeeName, hourlyRate: s.hourlyRate, weeklyHours: s.weeklyHours, weeklySalary: s.weeklySalary })
    slotsByAccount.set(s.accountId, list)
  }

  const accounts = accountRows.map(r => ({
    accountId: r.accountId,
    accountNumber: r.accountNumber,
    name: r.name,
    parentAccountId: r.parentAccountId,
    groupKey: (r.otBaseGroup === 'boh' ? 'boh' : r.otBaseGroup === 'foh' ? 'foh'
      : GROUP_PARENT_NUMBERS[r.parentAccountNumber] ?? 'other') as GroupKey,
    payType: r.payType as 'hourly' | 'salary' | 'overtime' | 'flat' | 'tax',
    scalesWithSeasonality: !!r.scalesWithSeasonality,
    otHours: r.otHours,
    otBaseGroup: r.otBaseGroup as 'boh' | 'foh' | null,
    flatAmount: r.flatAmount,
    taxKey: r.taxKey as 'medicare' | 'social_security' | 'futa' | 'suta_ma' | 'pfml_ma' | null,
    slots: slotsByAccount.get(r.accountId) ?? []
  }))

  const taxRow = db.prepare(`
    SELECT medicare_rate AS medicareRate, social_security_rate AS socialSecurityRate,
           futa_rate AS futaRate, suta_ma_rate AS sutaMaRate, pfml_ma_rate AS pfmlMaRate
    FROM labor_tax_rates WHERE id = 1
  `).get() as any

  const trailingMonths = trailingWindowMonths(db)

  return {
    accounts,
    taxRates: taxRow ?? null,
    otHistory: {
      boh: otHistoryFor(db, '6026'),
      foh: otHistoryFor(db, '6036')
    },
    trailingWindow: { months: trailingMonths },
    trailingActuals: trailingActualsByAccount(db, trailingMonths),
    trailingTaxRates: trailingTaxRates(db, trailingMonths)
  }
})
