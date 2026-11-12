import { refreshForecastsAfterChange, restaurantToday } from '../../utils/capacity-forecast'
// Persists the Labor tab's assumptions — labor_position_settings, labor_position_slots,
// and labor_tax_rates. Never touches budget_targets; the client computes the resulting
// monthly $ figures itself and writes them via the existing /api/budget/targets route in
// the same Save action (see app/pages/budget/labor.vue).
//
// Slots are sent as the FULL desired list per account, sequentially numbered
// (slot_index 1..N) — simplest way to represent "a person was removed" without a
// separate delete list: any stored slot_index beyond what's sent for that account is
// deleted, then every sent slot is upserted by (account_id, slot_index).
//
// Because removing a person renumbers everyone after them, a slot's Toast mapping
// (toastEmployeeGuid) and pin (hoursPinned) are sent with EVERY slot and overwrite the row at
// that index; the stored automatic hours belong to whoever was in that slot before, so they're
// cleared whenever the guid at an index changes (the refresh below recomputes them). hoursPinned
// false restores the automatic hours (step 4, 2026-11-12: server/utils/labor-hours.ts).
type RoleClass = 'direct' | 'supervision' | 'overhead' | 'growth'
const ROLE_CLASSES: RoleClass[] = ['direct', 'supervision', 'overhead', 'growth']
type SettingsInput = { accountId: number, scalesWithSeasonality: boolean, otHours: number, flatAmount: number, isHidden: boolean, roleClass?: RoleClass | null, otHoursPinned?: boolean }
type SlotInput = { accountId: number, slotIndex: number, employeeName: string | null, hourlyRate: number, weeklyHours: number, weeklySalary: number, firstPaycheckDate?: string | null, toastEmployeeGuid?: string | null, hoursPinned?: boolean }
type TaxRatesInput = { medicareRate: number, socialSecurityRate: number, futaRate: number, sutaMaRate: number, pfmlMaRate: number, taxableTipsPerPayroll?: number }
// Pay is dated by year (migration 0020). A rate/salary typed while viewing a year that hasn't
// started becomes that year's pay and carries forward; earlier years keep the pay they had.
// Editing an earlier year while a later change exists changes only the years before that change.
type PayRow = { employee_name: string | null, toast_employee_guid: string | null, hourly_rate: number, weekly_salary: number, prior_hourly_rate: number | null, prior_weekly_salary: number | null, pay_change_year: number | null }
type Pay = { rate: number, salary: number, priorRate: number | null, priorSalary: number | null, changeYear: number | null }
function resolvePay(existing: PayRow | undefined, slot: SlotInput, year: number | null, currentYear: number): Pay {
  const rate = slot.hourlyRate ?? 0
  const salary = slot.weeklySalary ?? 0
  const fresh: Pay = { rate, salary, priorRate: null, priorSalary: null, changeYear: null }
  if (year == null || !existing) return fresh
  const sameWho = (existing.toast_employee_guid ?? null) === (slot.toastEmployeeGuid || null) && (existing.employee_name ?? '') === (slot.employeeName ?? '')
  if (!sameWho) return fresh // a different person now sits in this slot index
  const cy = existing.pay_change_year
  const hasPrior = cy != null && existing.prior_hourly_rate != null && existing.prior_weekly_salary != null
  const inForce = hasPrior && year < cy! ? { r: existing.prior_hourly_rate!, s: existing.prior_weekly_salary! } : { r: existing.hourly_rate, s: existing.weekly_salary }
  if (rate === inForce.r && salary === inForce.s) {
    return { rate: existing.hourly_rate, salary: existing.weekly_salary, priorRate: existing.prior_hourly_rate, priorSalary: existing.prior_weekly_salary, changeYear: existing.pay_change_year }
  }
  if (hasPrior) {
    if (year < cy!) {
      // Earlier year edited: only years before the change move (collapse if it now equals the later pay).
      if (rate === existing.hourly_rate && salary === existing.weekly_salary) return { rate, salary, priorRate: null, priorSalary: null, changeYear: null }
      return { rate: existing.hourly_rate, salary: existing.weekly_salary, priorRate: rate, priorSalary: salary, changeYear: cy }
    }
    if (rate === existing.prior_hourly_rate && salary === existing.prior_weekly_salary) return { rate, salary, priorRate: null, priorSalary: null, changeYear: null }
    return { rate, salary, priorRate: existing.prior_hourly_rate, priorSalary: existing.prior_weekly_salary, changeYear: cy }
  }
  // One pay for all years so far. A change in a future year is dated to that year; otherwise it applies everywhere.
  if (year > currentYear) return { rate, salary, priorRate: existing.hourly_rate, priorSalary: existing.weekly_salary, changeYear: year }
  return fresh
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(async (event) => {
  const body = await readBody<{ settings?: SettingsInput[], slots?: SlotInput[], slotAccountIds?: number[], taxRates?: TaxRatesInput, year?: number }>(event)
  const settings = body?.settings ?? []
  const slots = body?.slots ?? []
  const slotAccountIds = body?.slotAccountIds ?? []
  const taxRates = body?.taxRates
  const payYear = Number.isInteger(body?.year) ? Number(body!.year) : null
  const currentYear = Number(restaurantToday(useRuntimeConfig().qbo?.syncTimeZone).slice(0, 4))

  const db = useDb()
  const now = new Date().toISOString()

  const managedIds = new Set((db.prepare('SELECT account_id FROM labor_position_settings').all() as { account_id: number }[]).map(r => r.account_id))
  for (const s of settings) {
    if (!managedIds.has(s.accountId)) {
      throw createError({ statusCode: 400, statusMessage: `Account ${s.accountId} has no labor_position_settings row — not managed by the Labor tab` })
    }
    if (s.roleClass != null && !ROLE_CLASSES.includes(s.roleClass)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid role class "${s.roleClass}" for account ${s.accountId}` })
    }
  }

  for (const slot of slots) {
    if (slot.firstPaycheckDate != null && slot.firstPaycheckDate !== '' && !ISO_DATE.test(slot.firstPaycheckDate)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid first paycheck date "${slot.firstPaycheckDate}" (expected YYYY-MM-DD)` })
    }
  }
  if (taxRates && !(Number(taxRates.taxableTipsPerPayroll ?? 0) >= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Taxable tips per payroll must be zero or more' })
  }

  const updateSettings = db.prepare(`
    UPDATE labor_position_settings SET scales_with_seasonality = @scalesWithSeasonality, flat_amount = @flatAmount, is_hidden = @isHidden, role_class = @roleClass, updated_at = @updatedAt,
      ot_hours_pinned = COALESCE(@otHoursPinned, ot_hours_pinned),
      ot_hours = CASE WHEN @otHoursPinned = 0 AND auto_ot_hours IS NOT NULL THEN auto_ot_hours ELSE @otHours END
    WHERE account_id = @accountId
  `)
  const upsertSlot = db.prepare(`
    INSERT INTO labor_position_slots (account_id, slot_index, employee_name, hourly_rate, weekly_hours, weekly_salary, first_paycheck_date, toast_employee_guid, hours_pinned, prior_hourly_rate, prior_weekly_salary, pay_change_year, updated_at)
    VALUES (@accountId, @slotIndex, @employeeName, @hourlyRate, @weeklyHours, @weeklySalary, @firstPaycheckDate, @toastEmployeeGuid, @hoursPinned, @priorRate, @priorSalary, @changeYear, @updatedAt)
    ON CONFLICT(account_id, slot_index) DO UPDATE SET
      employee_name = excluded.employee_name, hourly_rate = excluded.hourly_rate,
      weekly_hours = CASE WHEN excluded.hours_pinned = 0 AND labor_position_slots.toast_employee_guid IS excluded.toast_employee_guid AND labor_position_slots.auto_weekly_hours IS NOT NULL
        THEN labor_position_slots.auto_weekly_hours ELSE excluded.weekly_hours END,
      weekly_salary = excluded.weekly_salary, prior_hourly_rate = excluded.prior_hourly_rate, prior_weekly_salary = excluded.prior_weekly_salary, pay_change_year = excluded.pay_change_year, first_paycheck_date = excluded.first_paycheck_date,
      auto_weekly_hours = CASE WHEN labor_position_slots.toast_employee_guid IS excluded.toast_employee_guid THEN labor_position_slots.auto_weekly_hours ELSE NULL END,
      auto_hours_basis = CASE WHEN labor_position_slots.toast_employee_guid IS excluded.toast_employee_guid THEN labor_position_slots.auto_hours_basis ELSE NULL END,
      auto_updated_at = CASE WHEN labor_position_slots.toast_employee_guid IS excluded.toast_employee_guid THEN labor_position_slots.auto_updated_at ELSE NULL END,
      toast_employee_guid = excluded.toast_employee_guid, hours_pinned = excluded.hours_pinned, updated_at = excluded.updated_at
  `)
  const existingSlot = db.prepare('SELECT employee_name, toast_employee_guid, hourly_rate, weekly_salary, prior_hourly_rate, prior_weekly_salary, pay_change_year FROM labor_position_slots WHERE account_id = ? AND slot_index = ?')
  const trimSlots = db.prepare(`DELETE FROM labor_position_slots WHERE account_id = ? AND slot_index > ?`)
  const upsertTaxRates = db.prepare(`
    INSERT INTO labor_tax_rates (id, medicare_rate, social_security_rate, futa_rate, suta_ma_rate, pfml_ma_rate, taxable_tips_per_payroll, updated_at)
    VALUES (1, @medicareRate, @socialSecurityRate, @futaRate, @sutaMaRate, @pfmlMaRate, @taxableTipsPerPayroll, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      medicare_rate = excluded.medicare_rate, social_security_rate = excluded.social_security_rate,
      futa_rate = excluded.futa_rate, suta_ma_rate = excluded.suta_ma_rate, pfml_ma_rate = excluded.pfml_ma_rate, taxable_tips_per_payroll = excluded.taxable_tips_per_payroll,
      updated_at = excluded.updated_at
  `)

  const run = db.transaction(() => {
    for (const s of settings) {
      updateSettings.run({ accountId: s.accountId, scalesWithSeasonality: s.scalesWithSeasonality ? 1 : 0, otHours: s.otHours ?? 0, flatAmount: s.flatAmount ?? 0, isHidden: s.isHidden ? 1 : 0, roleClass: s.roleClass ?? null, otHoursPinned: s.otHoursPinned == null ? null : (s.otHoursPinned ? 1 : 0), updatedAt: now })
    }

    const maxSlotIndexByAccount = new Map<number, number>()
    for (const slot of slots) {
      maxSlotIndexByAccount.set(slot.accountId, Math.max(maxSlotIndexByAccount.get(slot.accountId) ?? 0, slot.slotIndex))
      const pay = resolvePay(existingSlot.get(slot.accountId, slot.slotIndex) as PayRow | undefined, slot, payYear, currentYear)
      upsertSlot.run({
        accountId: slot.accountId, slotIndex: slot.slotIndex, employeeName: slot.employeeName || null,
        hourlyRate: pay.rate, priorRate: pay.priorRate, priorSalary: pay.priorSalary, changeYear: pay.changeYear,
        weeklyHours: slot.weeklyHours ?? 0, weeklySalary: pay.salary, firstPaycheckDate: slot.firstPaycheckDate || null,
        toastEmployeeGuid: slot.toastEmployeeGuid || null, hoursPinned: slot.hoursPinned === false ? 0 : 1, updatedAt: now
      })
    }
    for (const [accountId, maxIndex] of maxSlotIndexByAccount) {
      trimSlots.run(accountId, maxIndex)
    }
    // An account whose last person was removed sends no slots at all, so it never appears
    // in maxSlotIndexByAccount above — the client lists every slot-bearing account here so
    // those still get trimmed (slot_index > 0 = all of them). The role itself survives as an
    // empty placeholder (its labor_position_settings row is untouched).
    for (const accountId of slotAccountIds) {
      if (!maxSlotIndexByAccount.has(accountId)) trimSlots.run(accountId, 0)
    }

    if (taxRates) upsertTaxRates.run({ ...taxRates, taxableTipsPerPayroll: taxRates.taxableTipsPerPayroll ?? 0, updatedAt: now })
  })
  run()
  // Mapping, pins and hours all move the automatic labor lines and OT: recompute now (never fails the save).
  refreshForecastsAfterChange(db, useRuntimeConfig().qbo?.syncTimeZone)

  return { updatedSettings: settings.length, updatedSlots: slots.length, taxRatesUpdated: !!taxRates }
})
