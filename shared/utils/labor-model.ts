// (Lives in shared/ so both the Staffing Plan page and the server's automatic labor forecast
// use it; app/utils/laborModel.ts re-exports it.)
// The Labor tab's payroll model, pulled out of app/pages/budget/labor.vue so the same math
// can price a month in any year: the Labor tab itself uses it for the year it's showing, and
// the Budget tab's "Build next year's budget" action uses it to carry the Labor tab's
// rates/hours/salaries into every month of the following year.
//
// Payroll posts every Friday, so a person's monthly cost is weekly $ x the number of Fridays
// in that month — months with five Fridays cost more than months with four. That is the only
// calendar-dependent part (fridaysInMonth(year, month)); everything else is a function of the
// saved rates/hours/salaries, the seasonal-demand scaling, and the tax rates.

// Payroll runs every Friday (see CLAUDE.md's Labor tab section) — this is the shared
// definition of "how many payroll cycles land in this month," used by both Edit Budget's
// labor payroll-cycle projection and the Labor tab's weekly-$-to-monthly-$ conversion.
// (Moved here from app/composables/useBudgetData.ts 2026-11-12 so the server's automatic
// labor forecast prices months with the same code; useBudgetData re-exports them.)
export function countFridays(start: Date, end: Date): number {
  let count = 0
  const d = new Date(start)
  while (d <= end) {
    if (d.getDay() === 5) count++ // Date#getDay(): 5 = Friday
    d.setDate(d.getDate() + 1)
  }
  return count
}
export function fridaysInMonth(year: number, month: number): number {
  return countFridays(new Date(year, month - 1, 1), new Date(year, month, 0))
}

export type PayType = 'hourly' | 'salary' | 'overtime' | 'flat' | 'tax'
export type RoleClass = 'direct' | 'supervision' | 'overhead' | 'growth'
export type GroupKey = 'boh' | 'foh' | 'management' | 'benefits' | 'tax' | 'other'
export type LaborSlot = { id: number | null, slotIndex: number, employeeName: string, hourlyRate: number, weeklyHours: number, weeklySalary: number, firstPaycheckDate: string }
export type LaborAccount = {
  accountId: number, accountNumber: string | null, name: string, groupKey: GroupKey, payType: PayType,
  scalesWithSeasonality: boolean, otHours: number, otBaseGroup: 'boh' | 'foh' | null, flatAmount: number,
  taxKey: 'medicare' | 'social_security' | 'futa' | 'suta_ma' | 'pfml_ma' | null, isHidden: boolean, roleClass: RoleClass | null, slots: LaborSlot[]
}
export type LaborTaxRates = { medicareRate: number, socialSecurityRate: number, futaRate: number, sutaMaRate: number, pfmlMaRate: number, taxableTipsPerPayroll: number }
export type MonthlyIndexEntry = { month: number, indexPct: number | null, years: number[] }

// The raw seasonal index is built from a single prior year of Toast covers, so its effect on
// hours is capped to a band around 100% (see labor.vue's history for why).
export const SEASONALITY_CAP_PCT = 15

export function seasonalityInfoFrom(monthlyIndex: MonthlyIndexEntry[], month: number): { raw: number | null, capped: number, years: number[], wasCapped: boolean } {
  const entry = monthlyIndex.find(m => m.month === month)
  const raw = entry?.indexPct ?? null
  const years = entry?.years ?? []
  if (raw === null) return { raw: null, capped: 100, years, wasCapped: false }
  const capped = Math.min(100 + SEASONALITY_CAP_PCT, Math.max(100 - SEASONALITY_CAP_PCT, raw))
  return { raw, capped, years, wasCapped: Math.round(capped) !== Math.round(raw) }
}

export type LaborModelContext = {
  year: number
  accounts: () => LaborAccount[]
  taxRates: () => LaborTaxRates
  // Capped demand index for a month as a percent (100 = no adjustment).
  seasonalPct: (month: number) => number
}

export function createLaborModel(ctx: LaborModelContext) {
  const { year } = ctx

  function effectiveHours(account: LaborAccount, typicalHours: number, month: number): number {
    return account.scalesWithSeasonality ? typicalHours * (ctx.seasonalPct(month) / 100) : typicalHours
  }

  // $/hr blended across every slot in a BOH/FOH group's hourly accounts, weighted by each
  // slot's typical (pre-seasonality) hours — the base rate BOH/FOH OT is computed against.
  function blendedRate(group: 'boh' | 'foh'): number {
    let weightedSum = 0
    let totalHours = 0
    for (const acc of ctx.accounts()) {
      if (acc.groupKey !== group || acc.payType !== 'hourly') continue
      for (const s of acc.slots) {
        weightedSum += s.hourlyRate * s.weeklyHours
        totalHours += s.weeklyHours
      }
    }
    return totalHours > 0 ? weightedSum / totalHours : 0
  }

  function slotWeeklyDollars(account: LaborAccount, slot: LaborSlot, month: number): number {
    return account.payType === 'hourly' ? slot.hourlyRate * effectiveHours(account, slot.weeklyHours, month) : 0
  }
  // Payroll Fridays in a month that this person is actually paid: all of them, or only those
  // on/after their first paycheck date when one is set (a mid-month hire). Compared as local
  // y/m/d components, never through a UTC-parsed Date, to avoid timezone drift.
  function slotFridays(slot: LaborSlot, month: number): number {
    const total = fridaysInMonth(year, month)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.firstPaycheckDate)) return total
    const [fy, fm, fd] = slot.firstPaycheckDate.split('-').map(Number)
    const monthStart = new Date(year, month - 1, 1)
    const monthEnd = new Date(year, month, 0)
    const from = new Date(fy!, fm! - 1, fd!)
    if (from <= monthStart) return total
    if (from > monthEnd) return 0
    return countFridays(from, monthEnd)
  }
  function slotMonthlyDollars(account: LaborAccount, slot: LaborSlot, month: number): number {
    return slotWeeklyDollars(account, slot, month) * slotFridays(slot, month)
  }
  function slotSalaryMonthlyDollars(slot: LaborSlot, month: number): number {
    return slot.weeklySalary * slotFridays(slot, month)
  }
  // Total scaled hrs/wk across every person on an hourly role.
  function accountEffectiveHours(account: LaborAccount, month: number): number {
    return account.slots.reduce((sum, s) => sum + effectiveHours(account, s.weeklyHours, month), 0)
  }

  function accountWeeklyDollars(account: LaborAccount, month: number): number {
    if (account.payType === 'hourly') {
      return account.slots.reduce((sum, s) => sum + slotWeeklyDollars(account, s, month), 0)
    }
    if (account.payType === 'salary') {
      return account.slots.reduce((sum, s) => sum + s.weeklySalary, 0)
    }
    if (account.payType === 'overtime' && account.otBaseGroup) {
      return 1.5 * blendedRate(account.otBaseGroup) * effectiveHours(account, account.otHours, month)
    }
    return 0
  }

  function wageSubjectTotal(month: number): number {
    let total = 0
    for (const acc of ctx.accounts()) {
      if (acc.payType === 'tax' || acc.groupKey === 'benefits') continue
      total += accountMonthlyDollars(acc, month)
    }
    return total
  }

  // Social Security and Medicare apply to wages PLUS reported tips; FUTA/SUTA/PFML stay on
  // wages only. Tips are entered per weekly payroll, so the monthly figure scales by Fridays.
  function taxBaseFor(key: NonNullable<LaborAccount['taxKey']>, month: number): number {
    const wages = wageSubjectTotal(month)
    return key === 'medicare' || key === 'social_security' ? wages + ctx.taxRates().taxableTipsPerPayroll * fridaysInMonth(year, month) : wages
  }
  function taxRateFor(key: NonNullable<LaborAccount['taxKey']>): number {
    const t = ctx.taxRates()
    return { medicare: t.medicareRate, social_security: t.socialSecurityRate, futa: t.futaRate, suta_ma: t.sutaMaRate, pfml_ma: t.pfmlMaRate }[key]
  }

  function accountMonthlyDollars(account: LaborAccount, month: number): number {
    if (account.payType === 'flat') return account.flatAmount
    if (account.payType === 'tax') return account.taxKey ? taxRateFor(account.taxKey) * taxBaseFor(account.taxKey, month) : 0
    if (account.payType === 'hourly') return account.slots.reduce((sum, s) => sum + slotMonthlyDollars(account, s, month), 0)
    if (account.payType === 'salary') return account.slots.reduce((sum, s) => sum + slotSalaryMonthlyDollars(s, month), 0)
    return accountWeeklyDollars(account, month) * fridaysInMonth(year, month)
  }

  return {
    effectiveHours, blendedRate, slotWeeklyDollars, slotFridays, slotMonthlyDollars, slotSalaryMonthlyDollars,
    accountEffectiveHours, accountWeeklyDollars, wageSubjectTotal, taxBaseFor, taxRateFor, accountMonthlyDollars
  }
}
