import { refreshForecastsAfterChange } from '../../utils/capacity-forecast'
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
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(async (event) => {
  const body = await readBody<{ settings?: SettingsInput[], slots?: SlotInput[], slotAccountIds?: number[], taxRates?: TaxRatesInput }>(event)
  const settings = body?.settings ?? []
  const slots = body?.slots ?? []
  const slotAccountIds = body?.slotAccountIds ?? []
  const taxRates = body?.taxRates

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
    INSERT INTO labor_position_slots (account_id, slot_index, employee_name, hourly_rate, weekly_hours, weekly_salary, first_paycheck_date, toast_employee_guid, hours_pinned, updated_at)
    VALUES (@accountId, @slotIndex, @employeeName, @hourlyRate, @weeklyHours, @weeklySalary, @firstPaycheckDate, @toastEmployeeGuid, @hoursPinned, @updatedAt)
    ON CONFLICT(account_id, slot_index) DO UPDATE SET
      employee_name = excluded.employee_name, hourly_rate = excluded.hourly_rate,
      weekly_hours = CASE WHEN excluded.hours_pinned = 0 AND labor_position_slots.toast_employee_guid IS excluded.toast_employee_guid AND labor_position_slots.auto_weekly_hours IS NOT NULL
        THEN labor_position_slots.auto_weekly_hours ELSE excluded.weekly_hours END,
      weekly_salary = excluded.weekly_salary, first_paycheck_date = excluded.first_paycheck_date,
      auto_weekly_hours = CASE WHEN labor_position_slots.toast_employee_guid IS excluded.toast_employee_guid THEN labor_position_slots.auto_weekly_hours ELSE NULL END,
      auto_hours_basis = CASE WHEN labor_position_slots.toast_employee_guid IS excluded.toast_employee_guid THEN labor_position_slots.auto_hours_basis ELSE NULL END,
      auto_updated_at = CASE WHEN labor_position_slots.toast_employee_guid IS excluded.toast_employee_guid THEN labor_position_slots.auto_updated_at ELSE NULL END,
      toast_employee_guid = excluded.toast_employee_guid, hours_pinned = excluded.hours_pinned, updated_at = excluded.updated_at
  `)
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
      upsertSlot.run({
        accountId: slot.accountId, slotIndex: slot.slotIndex, employeeName: slot.employeeName || null,
        hourlyRate: slot.hourlyRate ?? 0, weeklyHours: slot.weeklyHours ?? 0, weeklySalary: slot.weeklySalary ?? 0, firstPaycheckDate: slot.firstPaycheckDate || null,
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
