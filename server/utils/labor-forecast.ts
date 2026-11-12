// The automatic Staffing Plan (dynamic budgeting step 4, 2026-11-12), copying the pattern of
// capacity-forecast.ts / budget-forecast.ts: automatic unless pinned.
//
// 1. Hours: every Staffing Plan person mapped to a Toast employee gets auto_weekly_hours (their
//    mean hours over the last AUTO_HOURS_WINDOW_WEEKS usable weeks, server/utils/labor-hours.ts),
//    and every overtime account gets auto_ot_hours. A slot / OT row with hours_pinned = 1 (typed
//    by hand, and every row at the time of the migration) keeps its own figure; unpinned ones
//    follow the auto value.
// 2. Budget: every labor line for every month AFTER the current one, through December of next
//    year, is priced with the same model the Staffing Plan page uses (shared/utils/labor-model.ts)
//    and written to budget_targets. A line typed on the Budget page is pinned and kept (auto_amount
//    still holds what the plan says). The current month is frozen, like every other budget line.
// 3. Scaling: a direct role that scales multiplies its hours by
//    clamp(forecast covers per open night for the month / actual covers per open night over the
//    same window the hours came from, 1 +/- SEASONALITY_CAP_PCT). Both sides use the same weeks,
//    so the window length doesn't bias the ratio. This replaces last year's seasonal index.
import type Database from 'better-sqlite3'
import { createLaborModel, SEASONALITY_CAP_PCT } from '../../shared/utils/labor-model'
import { loadLaborAccounts, loadLaborTaxRates } from './labor-accounts'
import { actualCoversPerNight, AUTO_HOURS_MIN_USABLE_WEEKS, computeAutoHours, findUsableWeeks, latestJobHoursDate } from './labor-hours'
import { createCapacityModel } from './capacity-model'
import { nonLeafAccountIds } from './accounts'

type Db = Database.Database

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

export type CoversRatio = {
  month: string // 'YYYY-MM'
  ratio: number // capped, 1 = no adjustment
  rawRatio: number | null
  wasCapped: boolean
  forecastPerNight: number | null
  actualPerNight: number | null
}

// Actual covers per open night over the same usable weeks the hours average uses. If there aren't
// enough weeks of job hours, falls back to the same rule applied to covers alone.
export function windowCovers(db: Db): { perNight: number | null, weeks: string[] } {
  const jobsLatest = latestJobHoursDate(db)
  let usable = jobsLatest ? findUsableWeeks(db, jobsLatest).usable : []
  if (usable.length < AUTO_HOURS_MIN_USABLE_WEEKS) {
    const t = (db.prepare('SELECT MAX(date) AS d FROM daily_toast_metrics').get() as { d: string | null }).d
    usable = t ? findUsableWeeks(db, t, false).usable : []
  }
  if (usable.length < AUTO_HOURS_MIN_USABLE_WEEKS) return { perNight: null, weeks: [] }
  return { perNight: actualCoversPerNight(db, usable), weeks: usable }
}

// Forecast covers per open night for each month of this year and next, over the window's actual.
export function coversRatios(db: Db, today: string, actualPerNight?: number | null): Map<string, CoversRatio> {
  const [ty] = today.split('-').map(Number) as [number]
  const actual = actualPerNight === undefined ? windowCovers(db).perNight : actualPerNight
  const model = createCapacityModel(db, `${ty}-01-01`, `${ty + 1}-12-31`)
  const out = new Map<string, CoversRatio>()
  for (const year of [ty, ty + 1]) {
    for (let month = 1; month <= 12; month++) {
      const sum = model.dayByDaySum(`${year}-${pad(month)}-01`, monthEnd(year, month))
      const forecast = sum.operatingDays > 0 ? sum.expectedCovers / sum.operatingDays : null
      const raw = actual != null && actual > 0 && forecast != null ? forecast / actual : null
      const ratio = raw == null ? 1 : Math.min(1 + SEASONALITY_CAP_PCT / 100, Math.max(1 - SEASONALITY_CAP_PCT / 100, raw))
      out.set(`${year}-${pad(month)}`, { month: `${year}-${pad(month)}`, ratio, rawRatio: raw, wasCapped: raw != null && ratio !== raw, forecastPerNight: forecast, actualPerNight: actual ?? null })
    }
  }
  return out
}

export type LaborForecastResult = { months: string[], rowsChanged: number, hoursUpdated: number, windowWeeks: string[] }

export function refreshLaborForecast(db: Db, today: string): LaborForecastResult {
  const [ty, tm] = today.split('-').map(Number) as [number, number]
  const targetMonths: { year: number, month: number }[] = []
  for (let idx = tm; ; idx++) {
    const year = ty + Math.floor(idx / 12)
    if (year > ty + 1) break
    targetMonths.push({ year, month: (idx % 12) + 1 })
  }

  // ---- 1. Hours ---------------------------------------------------------------------------
  let hoursUpdated = 0
  const auto = computeAutoHours(db)
  if (auto) {
    const accounts = loadLaborAccounts(db)
    const setSlot = db.prepare(`
      UPDATE labor_position_slots
      SET auto_weekly_hours = @value, auto_hours_basis = @basis, auto_updated_at = @today,
          weekly_hours = CASE WHEN hours_pinned = 0 THEN @value ELSE weekly_hours END
      WHERE id = @id
    `)
    const setSlotFlagsOnly = db.prepare('UPDATE labor_position_slots SET auto_hours_basis = @basis WHERE id = @id')
    const setOt = db.prepare(`
      UPDATE labor_position_settings
      SET auto_ot_hours = @value, auto_ot_basis = @basis,
          ot_hours = CASE WHEN ot_hours_pinned = 0 THEN @value ELSE ot_hours END
      WHERE account_id = @accountId
    `)
    db.transaction(() => {
      for (const acc of accounts) {
        for (const slot of acc.slots) {
          const r = slot.id == null ? undefined : auto.slots.get(slot.id)
          if (!r || slot.id == null) continue
          const prev = slot.autoHoursBasis
          if (r.value == null) {
            // No usable hours for this person: keep their value and weeks; just refresh the flags.
            if (prev && JSON.stringify(prev.flags) !== JSON.stringify(r.basis.flags)) {
              setSlotFlagsOnly.run({ id: slot.id, basis: JSON.stringify({ ...prev, flags: r.basis.flags }) })
            } else if (!prev) {
              setSlotFlagsOnly.run({ id: slot.id, basis: JSON.stringify(r.basis) })
            }
            continue
          }
          // Same person, same weeks, same hours: keep the stored value untouched (no re-derivation).
          const unchanged = prev && slot.autoWeeklyHours != null && prev.guid === r.basis.guid && prev.accountId === r.basis.accountId
            && JSON.stringify(prev.weeks) === JSON.stringify(r.basis.weeks) && JSON.stringify(prev.hours) === JSON.stringify(r.basis.hours)
            && JSON.stringify(prev.flags) === JSON.stringify(r.basis.flags)
          if (unchanged && (slot.hoursPinned || slot.weeklyHours === slot.autoWeeklyHours)) continue
          setSlot.run({ id: slot.id, value: r.value, basis: JSON.stringify(r.basis), today })
          hoursUpdated++
        }
        const ot = auto.ot.get(acc.accountId)
        if (ot && ot.value != null) {
          const unchanged = acc.autoOtBasis && acc.autoOtHours != null && JSON.stringify(acc.autoOtBasis.weeks) === JSON.stringify(ot.basis.weeks) && JSON.stringify(acc.autoOtBasis.hours) === JSON.stringify(ot.basis.hours)
          if (unchanged && (acc.otHoursPinned || acc.otHours === acc.autoOtHours)) continue
          setOt.run({ accountId: acc.accountId, value: ot.value, basis: JSON.stringify(ot.basis) })
          hoursUpdated++
        }
      }
    })()
  }

  // ---- 2. Budget lines for every month after the current one ----------------------------------
  const accounts = loadLaborAccounts(db)
  const taxRates = loadLaborTaxRates(db)
  if (!taxRates) return { months: [], rowsChanged: 0, hoursUpdated, windowWeeks: auto?.window.weeks ?? [] }
  const ratios = coversRatios(db, today, auto ? auto.coversPerNight : undefined)
  const leaf = new Set(accounts.map(a => a.accountId))
  for (const id of nonLeafAccountIds(db)) leaf.delete(id)
  const models = new Map<number, ReturnType<typeof createLaborModel>>()
  const modelFor = (year: number) => {
    let m = models.get(year)
    if (!m) {
      m = createLaborModel({ year, accounts: () => accounts, taxRates: () => taxRates, seasonalPct: month => (ratios.get(`${year}-${pad(month)}`)?.ratio ?? 1) * 100 })
      models.set(year, m)
    }
    return m
  }
  const existing = db.prepare('SELECT amount, pinned FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?')
  const upsert = db.prepare(`
    INSERT INTO budget_targets (year, month, account_id, amount, auto_amount, pinned)
    VALUES (@year, @month, @accountId, @amount, @amount, 0)
    ON CONFLICT(year, month, account_id) DO UPDATE SET
      auto_amount = excluded.auto_amount,
      amount = CASE WHEN budget_targets.pinned = 1 THEN budget_targets.amount ELSE excluded.amount END
  `)
  let rowsChanged = 0
  db.transaction(() => {
    for (const { year, month } of targetMonths) {
      const model = modelFor(year)
      for (const acc of accounts) {
        if (!leaf.has(acc.accountId)) continue
        const amount = Math.round(model.accountMonthlyDollars(acc as any, month) * 100) / 100
        const before = existing.get(year, month, acc.accountId) as { amount: number, pinned: number } | undefined
        if (!before || (!before.pinned && Math.abs(before.amount - amount) >= 0.01)) rowsChanged++
        upsert.run({ year, month, accountId: acc.accountId, amount })
      }
    }
  })()
  return { months: targetMonths.map(t => `${t.year}-${pad(t.month)}`), rowsChanged, hoursUpdated, windowWeeks: auto?.window.weeks ?? [] }
}
