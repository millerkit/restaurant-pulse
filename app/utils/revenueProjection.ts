// Shared current-month revenue projection rules, used by BOTH the Revenue tab
// (app/pages/budget/revenue.vue) and Edit Budget (app/pages/budget/edit.vue) so the two
// pages can't show different "Projected" revenue for the same month (they did until
// 2026-11-05: Edit Budget straight-lined everything while the Revenue tab built core
// dine-in night by night).
//
// Rules for a revenue LEAF account:
//   - core dine-in (CORE_REVENUE_ACCOUNT_NUMBERS): actual to date + its share of the
//     night-by-night remaining-nights total (server/api/revenue-projection.get.ts), or the
//     caller's straight-line fallback when that projection is missing/unusable;
//   - everything else (Event Sales, Catering, Retail, Other Service Income, contra-income):
//     its own budget, floored at actual to date (sign-aware), since those land in large,
//     sporadic amounts rather than a steady daily trickle.
//
// Mirrors server/utils/core-revenue.ts's CORE_REVENUE_ACCOUNT_NUMBERS — duplicated since
// server/utils isn't part of the client bundle.
export const CORE_REVENUE_ACCOUNT_NUMBERS = ['4000', '4010', '4020', '4022', '4024', '4026', '4028']

export type NightlyProjectionSummary = { remainingTotal: number, missingHistory: number }

export function isCoreRevenueAccountNumber(accountNumber: string | null): boolean {
  return accountNumber !== null && CORE_REVENUE_ACCOUNT_NUMBERS.includes(accountNumber)
}

// The floor at actual-to-date has to be sign-aware: most revenue accounts are budgeted
// positive, where "actual already exceeds budget" should win via Math.max. A contra-revenue
// account (4900 Contra-Income / 4910 Discounts & Comps) is budgeted negative, where
// Math.max(0, -2200) would wrongly resolve to $0 — silently dropping the expected discount.
export function budgetFloor(actual: number, budget: number): number {
  return budget >= 0 ? Math.max(actual, budget) : Math.min(actual, budget)
}

// A night with too little same-weekday history can't be projected; rather than show a
// silently short total, callers fall back to straight-line for the whole month.
export function nightlyProjectionUsable(p: NightlyProjectionSummary | null | undefined): p is NightlyProjectionSummary {
  return !!p && p.missingHistory === 0
}

// Each core leaf's share of the remaining-nights total: its share of month-to-date actuals,
// or its share of budget before anything has synced (equal split as a last resort), so
// Food vs. each beverage account keep their real mix and the leaves sum to the total.
export function coreRevenueShares(
  leaves: { accountId: number, accountNumber: string | null }[],
  actualOf: (accountId: number) => number,
  budgetOf: (accountId: number) => number
): Map<number, number> {
  const core = leaves.filter(l => isCoreRevenueAccountNumber(l.accountNumber))
  const totalActual = core.reduce((sum, l) => sum + Math.max(0, actualOf(l.accountId)), 0)
  const totalBudget = core.reduce((sum, l) => sum + Math.max(0, budgetOf(l.accountId)), 0)
  const shares = new Map<number, number>()
  for (const l of core) {
    if (totalActual > 0) shares.set(l.accountId, Math.max(0, actualOf(l.accountId)) / totalActual)
    else if (totalBudget > 0) shares.set(l.accountId, Math.max(0, budgetOf(l.accountId)) / totalBudget)
    else shares.set(l.accountId, 1 / Math.max(1, core.length))
  }
  return shares
}

export function projectRevenueLeaf(args: {
  accountNumber: string | null
  actual: number
  budget: number
  share: number | undefined
  nightly: NightlyProjectionSummary | null | undefined
  straightLine: (actual: number) => number
}): number {
  if (!isCoreRevenueAccountNumber(args.accountNumber)) return budgetFloor(args.actual, args.budget)
  if (nightlyProjectionUsable(args.nightly) && args.share !== undefined) {
    return args.actual + args.nightly.remainingTotal * args.share
  }
  return args.straightLine(args.actual)
}

// The whole current month's projected revenue (every revenue leaf) by the same rules, for pages
// that need one number rather than a per-account figure (the Cash Flow year-end outlook).
// Returns null when the night-by-night projection isn't usable, rather than guessing.
export function projectMonthRevenue(
  accounts: { accountId: number, accountNumber: string | null, category: string, parentAccountId: number | null, amount: number | null }[],
  actualOf: (accountId: number) => number,
  nightly: NightlyProjectionSummary | null | undefined
): number | null {
  if (!nightlyProjectionUsable(nightly)) return null
  const revenue = accounts.filter(a => a.category === 'revenue')
  const parentIds = new Set(revenue.map(a => a.parentAccountId))
  const leaves = revenue.filter(a => !parentIds.has(a.accountId))
  const budgetOf = (id: number) => leaves.find(l => l.accountId === id)?.amount ?? 0
  const shares = coreRevenueShares(leaves, actualOf, budgetOf)
  return leaves.reduce((sum, a) => sum + projectRevenueLeaf({
    accountNumber: a.accountNumber,
    actual: actualOf(a.accountId),
    budget: budgetOf(a.accountId),
    share: shares.get(a.accountId),
    nightly,
    straightLine: x => x
  }), 0)
}
