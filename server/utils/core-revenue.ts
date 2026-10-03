// Core dine-in food/beverage revenue account numbers — extracted 2026-08-19
// from server/api/capacity/history.get.ts (the original source of this
// list/reasoning) so the Dashboard's Weekly Performance section can reuse
// the exact same definition instead of re-deriving it. Matched by
// account_number, never a raw id (see CLAUDE.md's local/prod account-drift
// section).
//
// Deliberately excludes Event Sales (4100s), Catering (4200s), Retail
// (4300s), and Other Service Income (4400) — those land unevenly (a private
// event booking swing isn't regular dine-in demand) and would distort any
// per-day or per-weekday pattern built from this list.
export const CORE_REVENUE_ACCOUNT_NUMBERS = ['4000', '4010', '4020', '4022', '4024', '4026', '4028']

// A day needs at least this many Toast covers to count as genuinely open —
// found by checking the real distribution rather than assuming covers > 0
// was good enough (it wasn't). ~95 local days show covers between 1-13,
// with a clean gap before real service nights start at 17+; 44 of those
// low-covers days are Mondays (the standing closure) and 24 are Sundays
// (Mass Ave's second closure day — see CLAUDE.md's location-move section),
// with most of the rest clustering around known holidays. These are real
// closures where a single stray online order (a gift card purchase, a
// pre-order) slipped through Toast, not real slow nights — counting them as
// "open" both understates real demand seasonality and, worse, corrupts a
// per-day revenue/spend calculation: a closure day with one $150 gift-card
// order produces a nonsensical reading that can swamp an average. Same
// "verify the real distribution, find the clean gap" methodology as
// MAX_PLAUSIBLE_GUESTS_PER_ORDER in server/utils/toast-metrics-sync.ts.
// Extracted (from server/api/capacity/history.get.ts, the original source)
// 2026-08-19 alongside CORE_REVENUE_ACCOUNT_NUMBERS so both are shared by a
// second real consumer, the Dashboard's Weekly Performance section, instead
// of being redefined.
export const MIN_COVERS_FOR_OPEN_DAY = 15

// A night whose core spend per cover is this far from the window's median is treated as
// unrepresentative — almost always a private event/buyout whose revenue landed in a core
// account while Toast logged few (or unrelated) covers, or the reverse. Calibrated against
// real production data (2026-10-03): 85 of 87 open nights since the location move ran
// $67-$120/cover, then a clean gap to two Tuesdays at $145 and $156 (Aug 25, Sep 29) that
// alone distorted Tuesday's average spend and weekday revenue share. The 1.4x/0.6x band
// around the median sits inside that gap. Shared by the Breakeven card
// (server/api/breakeven.get.ts) and the weekday revenue targets
// (server/utils/weekly-targets.ts, behind the Dashboard and Revenue Calendar) so all three
// judge a "normal night" the same way. NOT yet applied to server/api/capacity/history.get.ts,
// which has its own, separate open-day filter.
const SPEND_OUTLIER_HIGH = 1.4
const SPEND_OUTLIER_LOW = 0.6

export type ExcludedNight = { date: string, covers: number, revenue: number, spend: number }

// Splits open days into representative nights and excluded outliers. Excluded nights are
// returned (not just dropped) so callers can name them to the user.
export function excludeSpendOutliers<T extends { date: string, revenue: number, covers: number }>(days: T[]): { kept: T[], excluded: ExcludedNight[] } {
  const spends = days.map(d => d.revenue / d.covers).sort((a, b) => a - b)
  if (spends.length === 0) return { kept: days, excluded: [] }
  const median = spends[Math.floor(spends.length / 2)]!
  const isOutlier = (d: T) => {
    const spend = d.revenue / d.covers
    return spend > median * SPEND_OUTLIER_HIGH || spend < median * SPEND_OUTLIER_LOW
  }
  return {
    kept: days.filter(d => !isOutlier(d)),
    excluded: days.filter(isOutlier).map(d => ({ date: d.date, covers: d.covers, revenue: Math.round(d.revenue), spend: d.revenue / d.covers }))
  }
}
