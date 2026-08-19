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
