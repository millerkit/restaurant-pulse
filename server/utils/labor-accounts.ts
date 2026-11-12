// Loads the Staffing Plan's accounts (every labor_position_settings-managed account with its
// people) and tax rates. Shared by GET /api/budget/labor-settings (the page) and the automatic
// labor forecast (server/utils/labor-forecast.ts), so both price a month from the same inputs.
import type Database from 'better-sqlite3'
import type { GroupKey, LaborAccount, LaborSlot, LaborTaxRates, RoleClass } from '../../shared/utils/labor-model'

type Db = Database.Database

export type LaborSlotFull = LaborSlot & {
  toastEmployeeGuid: string | null
  hoursPinned: boolean
  autoWeeklyHours: number | null
  autoHoursBasis: Record<string, any> | null
  autoUpdatedAt: string | null
}
export type LaborAccountFull = Omit<LaborAccount, 'slots'> & {
  parentAccountId: number | null
  otHoursPinned: boolean
  autoOtHours: number | null
  autoOtBasis: Record<string, any> | null
  slots: LaborSlotFull[]
}

export const GROUP_PARENT_NUMBERS: Record<string, GroupKey> = {
  '6010': 'boh', '6030': 'foh', '6050': 'management', '6060': 'benefits', '6080': 'tax'
}

function parseJson(text: string | null): Record<string, any> | null {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// year = the budget year being priced: each slot's pay is the value in force that year (see
// labor_position_slots.pay_change_year). Omit it for the latest pay (used only for non-pay fields).
export function loadLaborAccounts(db: Db, year?: number): LaborAccountFull[] {
  const accountRows = db.prepare(`
    SELECT
      a.id AS accountId, a.account_number AS accountNumber, a.name, a.parent_account_id AS parentAccountId,
      p.account_number AS parentAccountNumber,
      lps.pay_type AS payType, lps.scales_with_seasonality AS scalesWithSeasonality,
      lps.ot_hours AS otHours, lps.ot_base_group AS otBaseGroup, lps.flat_amount AS flatAmount, lps.tax_key AS taxKey,
      lps.is_hidden AS isHidden, lps.role_class AS roleClass,
      lps.ot_hours_pinned AS otHoursPinned, lps.auto_ot_hours AS autoOtHours, lps.auto_ot_basis AS autoOtBasis
    FROM accounts a
    JOIN labor_position_settings lps ON lps.account_id = a.id
    LEFT JOIN accounts p ON p.id = a.parent_account_id
    WHERE a.is_active = 1
    ORDER BY a.account_number
  `).all() as any[]

  const slotRows = db.prepare(`
    SELECT account_id AS accountId, id, slot_index AS slotIndex, employee_name AS employeeName,
           hourly_rate AS hourlyRate, weekly_hours AS weeklyHours, weekly_salary AS weeklySalary,
           first_paycheck_date AS firstPaycheckDate, toast_employee_guid AS toastEmployeeGuid,
           hours_pinned AS hoursPinned, auto_weekly_hours AS autoWeeklyHours,
           auto_hours_basis AS autoHoursBasis, auto_updated_at AS autoUpdatedAt,
           prior_hourly_rate AS priorHourlyRate, prior_weekly_salary AS priorWeeklySalary, pay_change_year AS payChangeYear
    FROM labor_position_slots ORDER BY account_id, slot_index
  `).all() as any[]
  const slotsByAccount = new Map<number, LaborSlotFull[]>()
  for (const s of slotRows) {
    const list = slotsByAccount.get(s.accountId) ?? []
    const usePrior = year != null && s.payChangeYear != null && year < s.payChangeYear
    list.push({
      id: s.id, slotIndex: s.slotIndex, employeeName: s.employeeName,
      hourlyRate: usePrior ? (s.priorHourlyRate ?? s.hourlyRate) : s.hourlyRate, weeklyHours: s.weeklyHours,
      weeklySalary: usePrior ? (s.priorWeeklySalary ?? s.weeklySalary) : s.weeklySalary, firstPaycheckDate: s.firstPaycheckDate,
      toastEmployeeGuid: s.toastEmployeeGuid ?? null, hoursPinned: !!s.hoursPinned,
      autoWeeklyHours: s.autoWeeklyHours ?? null, autoHoursBasis: parseJson(s.autoHoursBasis), autoUpdatedAt: s.autoUpdatedAt ?? null
    })
    slotsByAccount.set(s.accountId, list)
  }

  return accountRows.map(r => ({
    accountId: r.accountId,
    accountNumber: r.accountNumber,
    name: r.name,
    parentAccountId: r.parentAccountId,
    groupKey: (r.otBaseGroup === 'boh' ? 'boh' : r.otBaseGroup === 'foh' ? 'foh'
      : GROUP_PARENT_NUMBERS[r.parentAccountNumber] ?? 'other') as GroupKey,
    payType: r.payType as LaborAccount['payType'],
    scalesWithSeasonality: !!r.scalesWithSeasonality,
    otHours: r.otHours,
    otBaseGroup: r.otBaseGroup as 'boh' | 'foh' | null,
    flatAmount: r.flatAmount,
    taxKey: r.taxKey as LaborAccount['taxKey'],
    isHidden: !!r.isHidden,
    roleClass: (r.roleClass ?? null) as RoleClass | null,
    otHoursPinned: !!r.otHoursPinned,
    autoOtHours: r.autoOtHours ?? null,
    autoOtBasis: parseJson(r.autoOtBasis),
    slots: slotsByAccount.get(r.accountId) ?? []
  }))
}

export function loadLaborTaxRates(db: Db): LaborTaxRates | null {
  return (db.prepare(`
    SELECT medicare_rate AS medicareRate, social_security_rate AS socialSecurityRate,
           futa_rate AS futaRate, suta_ma_rate AS sutaMaRate, pfml_ma_rate AS pfmlMaRate,
           taxable_tips_per_payroll AS taxableTipsPerPayroll
    FROM labor_tax_rates WHERE id = 1
  `).get() as LaborTaxRates | undefined) ?? null
}
