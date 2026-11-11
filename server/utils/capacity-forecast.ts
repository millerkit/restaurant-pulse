// The automatic capacity forecast (2026-11-11). Replaces the Capacity page's
// "Set from Actuals", "Auto-update monthly", "Set by History" and "Set by
// Actuals" controls: the forecast inputs now update themselves, and anything
// typed by hand is *pinned* and left alone until it's unpinned.
//
// Two kinds of input, two rules:
//
// - Spend per guest (capacity_areas.per_cover_revenue_food/_beverage): each
//   area's real blend over the two most recently closed months that are fully
//   synced. It only moves when a month closes, so a month's comparison against
//   it stays meaningful while the month is in progress. An area with
//   follow_actuals = 0 is pinned (e.g. Chef's Counter, a deliberate price).
//
// - Expected covers per night (capacity_area_seasonality.expected_covers): for
//   every month that hasn't started, the historical seasonal shape × a
//   data-driven baseline, split across areas by each area's real fill rate
//   (server/utils/capacity-history.ts). The current month is frozen: it keeps
//   whatever the forecast said on the night before it started, so actuals have
//   a fixed reference to be judged against. Rows are reused every year, so a
//   closed month's row is next year's forecast and recomputes like any other
//   month that hasn't started.
//
// The auto value is stored even for a pinned row/area (auto_covers,
// auto_per_cover_*), so the page can show "automatic would be X" beside a pin.
//
// Runs after every nightly sync, after a Capacity save, and lazily (at most
// once a day or when newer Toast data exists) when a capacity page loads, so
// local dev, where the nightly sync refuses to run, stays current too.
import type Database from 'better-sqlite3'
import { blendForRange } from './capacity-actuals'
import { loadCapacityHistory } from './capacity-history'
import { refreshBudgetForecast, type BudgetForecastResult } from './budget-forecast'

type Db = Database.Database

// An area needs at least this many real covers across the two-month window
// before its spend per guest moves: one odd night in a barely used area
// (Outdoor in the shoulder season) shouldn't reset it.
const MIN_COVERS_FOR_PER_COVER = 30

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}
function prevMonth(year: number, month: number): { year: number, month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

export function restaurantToday(timeZone = 'America/New_York'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

type AreaRow = { id: number, name: string, capacity_nov_apr: number | null, capacity_may_oct: number | null, follow_actuals: number }

function areaCapacity(a: AreaRow, month: number): number {
  return ((month >= 5 && month <= 10) ? a.capacity_may_oct : a.capacity_nov_apr) ?? 0
}

// Splits a month's covers target across areas: each area's share is the
// month's fill fraction × its own capacity × its real fill-rate index, capped at
// its capacity, rounded so the whole numbers add up to the restaurant total
// (largest remainder; the leftover only goes to areas below their cap). Same
// rule "Set by History" used, moved server-side.
export function distributeCovers(fraction: number, areas: AreaRow[], month: number, indexFor: (areaId: number) => number): Map<number, number> {
  const caps = areas.map(a => areaCapacity(a, month))
  const exact = areas.map((a, i) => Math.min(fraction * caps[i]! * indexFor(a.id), caps[i]!))
  const totalTarget = Math.round(fraction * caps.reduce((s, c) => s + c, 0))
  const result = exact.map(Math.floor)
  let leftover = Math.max(0, totalTarget - result.reduce((s, v) => s + v, 0))
  const order = result.map((_, i) => i).sort((x, y) => (exact[y]! - result[y]!) - (exact[x]! - result[x]!))
  for (const i of order) {
    if (leftover <= 0) break
    if (result[i]! >= caps[i]!) continue
    result[i] = result[i]! + 1
    leftover--
  }
  return new Map(areas.map((a, i) => [a.id, result[i]!]))
}

export type ForecastRefreshResult = {
  perCoverBasis: string | null // 'YYYY-MM': the later of the two closed months used
  perCoverChanged: string[]
  coverRowsChanged: number
  historyAvailable: boolean
}

// syncedThrough: the last date with complete Toast/QBO data. Defaults to the
// latest Toast per-area date on file.
export function refreshCapacityForecast(db: Db, today: string, syncedThrough?: string): ForecastRefreshResult {
  const toastThrough = syncedThrough
    ?? (db.prepare('SELECT MAX(date) AS d FROM daily_toast_area_metrics').get() as { d: string | null }).d
    ?? ''
  const [ty, tm] = today.split('-').map(Number) as [number, number]
  const areas = db.prepare('SELECT id, name, capacity_nov_apr, capacity_may_oct, follow_actuals FROM capacity_areas ORDER BY id').all() as AreaRow[]
  const result: ForecastRefreshResult = { perCoverBasis: null, perCoverChanged: [], coverRowsChanged: 0, historyAvailable: false }

  // ---- Spend per guest -------------------------------------------------
  // The latest closed month whose data is fully synced, plus the month before it.
  let closed = prevMonth(ty, tm)
  if (toastThrough < monthEnd(closed.year, closed.month)) closed = prevMonth(closed.year, closed.month)
  if (toastThrough >= monthEnd(closed.year, closed.month)) {
    const before = prevMonth(closed.year, closed.month)
    const basis = `${closed.year}-${pad(closed.month)}`
    result.perCoverBasis = basis
    const blend = blendForRange(db, `${before.year}-${pad(before.month)}-01`, monthEnd(closed.year, closed.month))
    const current = new Map((db.prepare('SELECT id, per_cover_revenue_food AS f, per_cover_revenue_beverage AS b, auto_per_cover_food AS af, auto_per_cover_beverage AS ab, follow_actuals_through AS through FROM capacity_areas').all() as { id: number, f: number, b: number, af: number | null, ab: number | null, through: string | null }[]).map(r => [r.id, r]))
    const setAuto = db.prepare('UPDATE capacity_areas SET auto_per_cover_food = ?, auto_per_cover_beverage = ?, follow_actuals_through = ? WHERE id = ?')
    const applyAuto = db.prepare('UPDATE capacity_areas SET per_cover_revenue_food = auto_per_cover_food, per_cover_revenue_beverage = auto_per_cover_beverage WHERE id = ? AND auto_per_cover_food IS NOT NULL')
    db.transaction(() => {
      for (const a of areas) {
        const row = blend.perArea.find(r => r.areaId === a.id)
        if (row && row.perCover != null && row.covers >= MIN_COVERS_FOR_PER_COVER) {
          let food: number | null = null
          let beverage: number | null = null
          if (row.perCoverFood != null && row.perCoverBeverage != null) {
            food = row.perCoverFood
            beverage = row.perCoverBeverage
          } else if (blend.foodBeveragePct) {
            food = row.perCover * blend.foodBeveragePct.food
            beverage = row.perCover * blend.foodBeveragePct.beverage
          } else {
            // No QuickBooks food/beverage split for the window yet (e.g. revenue
            // not synced): keep the area's previous automatic food share, or its
            // stored share if it has never had one (never a pinned figure's share
            // once an automatic one exists).
            const cur = current.get(a.id)
            // Same months as last time: keep the previous figures rather than
            // re-deriving (and re-rounding) them on every refresh.
            const unchanged = cur?.through === basis && cur.af != null && cur.ab != null
            const share = unchanged ? null : cur && cur.af != null && cur.ab != null && cur.af + cur.ab > 0
              ? cur.af / (cur.af + cur.ab)
              : (cur && cur.f + cur.b > 0 ? cur.f / (cur.f + cur.b) : null)
            if (share != null) {
              food = row.perCover * share
              beverage = row.perCover * (1 - share)
            }
          }
          if (food != null && beverage != null) {
            setAuto.run(Math.round(food * 100) / 100, Math.round(beverage * 100) / 100, basis, a.id)
          }
        }
        if (a.follow_actuals) {
          applyAuto.run(a.id)
          const before = current.get(a.id)
          const after = db.prepare('SELECT per_cover_revenue_food AS f, per_cover_revenue_beverage AS b FROM capacity_areas WHERE id = ?').get(a.id) as { f: number, b: number }
          if (before && (before.f !== after.f || before.b !== after.b)) result.perCoverChanged.push(a.name)
        }
      }
    })()
  }

  // ---- Expected covers per night ----------------------------------------
  const history = loadCapacityHistory(db)
  const baseline = history.dataAnnualFillPct
  const indexFor = (areaId: number) => history.areaFillIndex?.find(r => r.areaId === areaId)?.indexValue ?? 1
  const rows = db.prepare('SELECT area_id, month, expected_covers, pinned, auto_covers FROM capacity_area_seasonality').all() as { area_id: number, month: number, expected_covers: number, pinned: number, auto_covers: number | null }[]
  const byKey = new Map(rows.map(r => [`${r.area_id}:${r.month}`, r]))
  const setRow = db.prepare(`
    UPDATE capacity_area_seasonality
    SET auto_covers = @auto, auto_basis = @basis, auto_updated_at = @today,
        expected_covers = CASE WHEN pinned = 1 THEN expected_covers ELSE @auto END
    WHERE area_id = @areaId AND month = @month
  `)
  db.transaction(() => {
    for (let month = 1; month <= 12; month++) {
      if (month === tm) continue // the current month is frozen
      const idx = history.monthlyIndex.find(m => m.month === month)?.indexPct
      if (idx == null || baseline == null) continue
      result.historyAvailable = true
      const fraction = baseline * (idx / 100)
      const split = distributeCovers(fraction, areas, month, indexFor)
      for (const a of areas) {
        const row = byKey.get(`${a.id}:${month}`)
        if (!row) continue
        const auto = split.get(a.id) ?? 0
        if (!row.pinned && row.expected_covers !== auto) result.coverRowsChanged++
        setRow.run({ auto, basis: `history:${Math.round(fraction * 1000) / 10}`, today, areaId: a.id, month })
      }
    }
    db.prepare(`
      INSERT INTO capacity_forecast_refresh (id, refreshed_on, toast_through) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET refreshed_on = excluded.refreshed_on, toast_through = excluded.toast_through
    `).run(today, toastThrough)
  })()
  return result
}

// The whole automatic forecast, in order: the capacity inputs first, then the
// budget lines built from them (server/utils/budget-forecast.ts).
export function refreshForecasts(db: Db, today: string, syncedThrough?: string): { capacity: ForecastRefreshResult, budget: BudgetForecastResult } {
  const capacity = refreshCapacityForecast(db, today, syncedThrough)
  const budget = refreshBudgetForecast(db, today)
  return { capacity, budget }
}

// After an input changes (a save on Capacity, Settings, special nights, buyouts):
// recompute now, but never fail the save over it.
export function refreshForecastsAfterChange(db: Db, timeZone?: string): void {
  try {
    refreshForecasts(db, restaurantToday(timeZone))
  } catch (err) {
    console.warn(`forecast refresh failed: ${err instanceof Error ? err.message : err}`)
  }
}

// Lazy refresh for page loads: at most once a day, or when newer Toast data
// has arrived since the last refresh. Never throws (a failure just leaves the
// last forecast in place and logs), so a page can't fail to load over it.
export function ensureForecastsFresh(db: Db, timeZone?: string): void {
  try {
    const today = restaurantToday(timeZone)
    const last = db.prepare('SELECT refreshed_on, toast_through FROM capacity_forecast_refresh WHERE id = 1').get() as { refreshed_on: string, toast_through: string } | undefined
    const toast = (db.prepare('SELECT MAX(date) AS d FROM daily_toast_area_metrics').get() as { d: string | null }).d ?? ''
    if (last && last.refreshed_on === today && last.toast_through >= toast) return
    refreshForecasts(db, today)
  } catch (err) {
    console.warn(`forecast refresh failed: ${err instanceof Error ? err.message : err}`)
  }
}
