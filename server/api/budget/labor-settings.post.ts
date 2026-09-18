// Persists the Labor tab's assumptions — labor_position_settings, labor_position_slots,
// and labor_tax_rates. Never touches budget_targets; the client computes the resulting
// monthly $ figures itself and writes them via the existing /api/budget/targets route in
// the same Save action (see app/pages/budget/labor.vue).
//
// Slots are sent as the FULL desired list per account, sequentially numbered
// (slot_index 1..N) — simplest way to represent "a person was removed" without a
// separate delete list: any stored slot_index beyond what's sent for that account is
// deleted, then every sent slot is upserted by (account_id, slot_index).
type SettingsInput = { accountId: number, scalesWithSeasonality: boolean, otHours: number, flatAmount: number }
type SlotInput = { accountId: number, slotIndex: number, employeeName: string | null, hourlyRate: number, weeklyHours: number, weeklySalary: number }
type TaxRatesInput = { medicareRate: number, socialSecurityRate: number, futaRate: number, sutaMaRate: number, pfmlMaRate: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<{ settings?: SettingsInput[], slots?: SlotInput[], taxRates?: TaxRatesInput }>(event)
  const settings = body?.settings ?? []
  const slots = body?.slots ?? []
  const taxRates = body?.taxRates

  const db = useDb()
  const now = new Date().toISOString()

  const managedIds = new Set((db.prepare('SELECT account_id FROM labor_position_settings').all() as { account_id: number }[]).map(r => r.account_id))
  for (const s of settings) {
    if (!managedIds.has(s.accountId)) {
      throw createError({ statusCode: 400, statusMessage: `Account ${s.accountId} has no labor_position_settings row — not managed by the Labor tab` })
    }
  }

  const updateSettings = db.prepare(`
    UPDATE labor_position_settings SET scales_with_seasonality = @scalesWithSeasonality, ot_hours = @otHours, flat_amount = @flatAmount, updated_at = @updatedAt
    WHERE account_id = @accountId
  `)
  const upsertSlot = db.prepare(`
    INSERT INTO labor_position_slots (account_id, slot_index, employee_name, hourly_rate, weekly_hours, weekly_salary, updated_at)
    VALUES (@accountId, @slotIndex, @employeeName, @hourlyRate, @weeklyHours, @weeklySalary, @updatedAt)
    ON CONFLICT(account_id, slot_index) DO UPDATE SET
      employee_name = excluded.employee_name, hourly_rate = excluded.hourly_rate,
      weekly_hours = excluded.weekly_hours, weekly_salary = excluded.weekly_salary, updated_at = excluded.updated_at
  `)
  const trimSlots = db.prepare(`DELETE FROM labor_position_slots WHERE account_id = ? AND slot_index > ?`)
  const upsertTaxRates = db.prepare(`
    INSERT INTO labor_tax_rates (id, medicare_rate, social_security_rate, futa_rate, suta_ma_rate, pfml_ma_rate, updated_at)
    VALUES (1, @medicareRate, @socialSecurityRate, @futaRate, @sutaMaRate, @pfmlMaRate, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      medicare_rate = excluded.medicare_rate, social_security_rate = excluded.social_security_rate,
      futa_rate = excluded.futa_rate, suta_ma_rate = excluded.suta_ma_rate, pfml_ma_rate = excluded.pfml_ma_rate,
      updated_at = excluded.updated_at
  `)

  const run = db.transaction(() => {
    for (const s of settings) {
      updateSettings.run({ accountId: s.accountId, scalesWithSeasonality: s.scalesWithSeasonality ? 1 : 0, otHours: s.otHours ?? 0, flatAmount: s.flatAmount ?? 0, updatedAt: now })
    }

    const maxSlotIndexByAccount = new Map<number, number>()
    for (const slot of slots) {
      maxSlotIndexByAccount.set(slot.accountId, Math.max(maxSlotIndexByAccount.get(slot.accountId) ?? 0, slot.slotIndex))
      upsertSlot.run({
        accountId: slot.accountId, slotIndex: slot.slotIndex, employeeName: slot.employeeName || null,
        hourlyRate: slot.hourlyRate ?? 0, weeklyHours: slot.weeklyHours ?? 0, weeklySalary: slot.weeklySalary ?? 0, updatedAt: now
      })
    }
    for (const [accountId, maxIndex] of maxSlotIndexByAccount) {
      trimSlots.run(accountId, maxIndex)
    }

    if (taxRates) upsertTaxRates.run({ ...taxRates, updatedAt: now })
  })
  run()

  return { updatedSettings: settings.length, updatedSlots: slots.length, taxRatesUpdated: !!taxRates }
})
