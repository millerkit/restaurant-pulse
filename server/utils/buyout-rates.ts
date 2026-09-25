// Shared buyout weekday-rate computation — extracted 2026-09-24 from
// server/api/budget/buyout-plan.get.ts so the Revenue Modeling what-if page
// (server/api/revenue-modeling.get.ts) can reuse the exact same "how much
// does a buyout actually add" math (guaranteed minimum minus that
// weekday's real normal-night target) instead of re-deriving it. Safe to
// share as-is: computeWeeklyRevenueTargets() reflects the real weekday
// pattern since the location move, not any one month's figures, so neither
// consumer needs a year/month param to get the right numbers.
const DEFAULT_BUYOUT_WEEKDAY_RATE = 10000
const DEFAULT_BUYOUT_WEEKEND_RATE = 12000

export type BuyoutRates = { weekdayRate: number, weekendRate: number, updatedAt: string | null }
export type BuyoutWeekday = { dow: number, label: string, short: string, dollarTarget: number | null, rate: number }

export function loadBuyoutRates(db: ReturnType<typeof useDb>): BuyoutRates {
  const row = db.prepare('SELECT weekday_rate AS weekdayRate, weekend_rate AS weekendRate, updated_at AS updatedAt FROM buyout_rates WHERE id = 1')
    .get() as { weekdayRate: number, weekendRate: number, updatedAt: string } | undefined
  return {
    weekdayRate: row?.weekdayRate ?? DEFAULT_BUYOUT_WEEKDAY_RATE,
    weekendRate: row?.weekendRate ?? DEFAULT_BUYOUT_WEEKEND_RATE,
    updatedAt: row?.updatedAt ?? null
  }
}

export function buyoutWeekdaysFor(rates: BuyoutRates): BuyoutWeekday[] {
  const weeklyTargets = computeWeeklyRevenueTargets()
  return weeklyTargets.days.map(d => ({
    dow: d.dow,
    label: d.label,
    short: d.short,
    dollarTarget: d.dollarTarget,
    rate: (d.dow === 5 || d.dow === 6 || d.dow === 0) ? rates.weekendRate : rates.weekdayRate
  }))
}
