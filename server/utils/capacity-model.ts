// The Capacity forecast model: per-area expected covers × spend per guest, night by
// night, with weekly area closures and replaced nights (holidays, closures, off-site
// and event nights). Moved out of server/api/capacity.get.ts 2026-11-11 so the
// automatic budget forecast (server/utils/budget-forecast.ts) projects a month's
// food/beverage sales with exactly the same math as the Capacity pages.
import type Database from 'better-sqlite3'
import { loadReplacedNights } from './special-nights'

type Db = Database.Database

export type AreaRow = {
  id: number, name: string, seats: number, max_turns_per_night: number,
  capacity_nov_apr: number | null, capacity_may_oct: number | null,
  per_cover_revenue_food: number, per_cover_revenue_beverage: number, notes: string | null,
  closed_dows: string | null, closed_from: string | null, closure_recapture_pct: number
}

// Tue-Sun: the restaurant's regular service nights (Monday is the standing closure).
const SERVICE_NIGHTS_PER_WEEK = 6
// Weekly closure of one area (capacity_areas.closed_dows/closed_from — see schema.sql).
// Before closed_from, or with no closure configured, uplift is 1 and nothing changes.
// After it, the area is dark on its closed weekdays and its other nights carry
// recapture% of the closed nights' covers: with `closed` closed nights a week,
// weekly covers become base*(6 - closed*(1-r)), spread over the 6-closed open nights.
function closureOn(area: AreaRow, iso: string, dow: number): { closedToday: boolean, uplift: number } {
  if (!area.closed_from || iso < area.closed_from || !area.closed_dows) return { closedToday: false, uplift: 1 }
  const closed = new Set(area.closed_dows.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6 && n !== 1))
  if (closed.size === 0) return { closedToday: false, uplift: 1 }
  const open = SERVICE_NIGHTS_PER_WEEK - closed.size
  const r = Math.min(1, Math.max(0, (area.closure_recapture_pct ?? 0) / 100))
  return {
    closedToday: closed.has(dow),
    uplift: open > 0 ? (SERVICE_NIGHTS_PER_WEEK - closed.size * (1 - r)) / open : 1
  }
}
type AreaMonthRow = { area_id: number, month: number, expected_covers: number }

function isMayThroughOct(month: number): boolean {
  return month >= 5 && month <= 10
}
// Urban Hearth is closed Mondays (see CLAUDE.md) — UTC-based so this is
// deterministic regardless of the server's own timezone.
function isOperatingDow(year: number, month: number, day: number): boolean {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1
}

// fromIso/toIso: the date range replaced nights are loaded for.
export function createCapacityModel(db: Db, fromIso: string, toIso: string) {
  const areas = db.prepare('SELECT * FROM capacity_areas ORDER BY id').all() as AreaRow[]
  const areaMonthRows = db.prepare('SELECT * FROM capacity_area_seasonality').all() as AreaMonthRow[]
  const areaMonth = new Map(areaMonthRows.map(r => [`${r.area_id}:${r.month}`, r.expected_covers]))
  const replaced = loadReplacedNights(db, fromIso, toIso)

  function areaCapacity(area: AreaRow, month: number): number {
    const cap = isMayThroughOct(month) ? area.capacity_may_oct : area.capacity_nov_apr
    return cap ?? 0
  }
  // Expected covers/revenue for a month, summed across every area's own
  // expected_covers (the real editable projection input) — plus the raw
  // max capacity (every seat, every turn) used as the fill % denominator.
  // revenue is split Food/Beverage (per_cover_revenue_food/
  // per_cover_revenue_beverage — see schema.sql's capacity_areas comment)
  // so the Edit Budget page's "Recompute Revenue from Capacity" action (see
  // CLAUDE.md) has a real target for each of the Food (4010) and Beverage
  // (4022/4024/4026/4028) revenue account groups, not just a blended total.
  // revenue is always revenueFood + revenueBeverage.
  // One area's expected covers / capacity on a specific date, or null if the
  // area is dark that day (weekly closure — see closureOn). The stored
  // expected_covers is the pre-closure per-Tue-Sun-night baseline; the
  // closure uplift is applied here, capped at the area's nightly capacity.
  function areaExpectedOn(area: AreaRow, iso: string) {
    const [y, m, day] = iso.split('-').map(Number)
    const closure = closureOn(area, iso, new Date(Date.UTC(y, m - 1, day)).getUTCDay())
    if (closure.closedToday) return null
    const cap = areaCapacity(area, m)
    let covers = areaMonth.get(`${area.id}:${m}`) ?? 0
    if (closure.uplift !== 1) covers = Math.min(covers * closure.uplift, cap)
    return { covers, maxCovers: cap }
  }
  function nightlyExpectedOn(iso: string) {
    let covers = 0, revenueFood = 0, revenueBeverage = 0, maxCovers = 0
    for (const area of areas) {
      const e = areaExpectedOn(area, iso)
      if (!e) continue
      covers += e.covers
      revenueFood += e.covers * area.per_cover_revenue_food
      revenueBeverage += e.covers * area.per_cover_revenue_beverage
      maxCovers += e.maxCovers
    }
    return { covers, revenue: revenueFood + revenueBeverage, revenueFood, revenueBeverage, maxCovers }
  }
  // Average nightly figures across a full calendar month's service nights —
  // what a flat "holiday closure" night is worth, now that nights differ by weekday.
  function dayByDaySum(startIso: string, endIso: string) {
    let expectedCovers = 0, expectedRevenue = 0, expectedRevenueFood = 0, expectedRevenueBeverage = 0, maxCovers = 0, operatingDays = 0, replacedNights = 0
    let d = new Date(`${startIso}T00:00:00Z`)
    const end = new Date(`${endIso}T00:00:00Z`)
    while (d <= end) {
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate()
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const planned = isOperatingDow(y, m, day) ? replaced.get(iso) : undefined
      if (planned) {
        // Replaced night: its expected dine-in revenue, split food/beverage
        // like a normal night that date.
        const normal = nightlyExpectedOn(iso)
        const foodShare = normal.revenue > 0 ? normal.revenueFood / normal.revenue : 0.5
        expectedRevenue += planned.expectedRevenue
        expectedRevenueFood += planned.expectedRevenue * foodShare
        expectedRevenueBeverage += planned.expectedRevenue * (1 - foodShare)
        replacedNights++
      } else if (isOperatingDow(y, m, day)) {
        const nightly = nightlyExpectedOn(iso)
        expectedCovers += nightly.covers
        expectedRevenue += nightly.revenue
        expectedRevenueFood += nightly.revenueFood
        expectedRevenueBeverage += nightly.revenueBeverage
        maxCovers += nightly.maxCovers
        operatingDays++
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }
    return { expectedCovers, expectedRevenue, expectedRevenueFood, expectedRevenueBeverage, maxCovers, operatingDays, replacedNights }
  }

  return { areas, areaMonth, replaced, areaCapacity, areaExpectedOn, nightlyExpectedOn, dayByDaySum }
}
