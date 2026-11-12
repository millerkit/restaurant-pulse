import { ensureForecastsFresh, restaurantToday } from '../../utils/capacity-forecast'
import { MANAGED_ACCOUNT_NUMBERS } from '../../utils/budget-forecast'
// Returns every account's budget_targets row for one month, joined to the
// account info the Budget tab needs to build both the macro rollup (group
// by category) and the per-account drill-down (group by parent_account_id)
// from a single response.
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = Number(query.year)
  const month = Number(query.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month (1-12) query params are required' })
  }

  const db = useDb()
  ensureForecastsFresh(db, useRuntimeConfig().qbo?.syncTimeZone)
  const rows = db.prepare(`
    SELECT
      a.id AS accountId,
      a.account_number AS accountNumber,
      a.parent_account_id AS parentAccountId,
      a.name,
      a.category,
      a.subcategory,
      a.cost_behavior AS costBehavior,
      a.is_owner_compensation AS isOwnerCompensation,
      EXISTS (SELECT 1 FROM labor_position_settings lps WHERE lps.account_id = a.id) AS laborManaged,
      bt.amount AS amount,
      COALESCE(bt.pinned, 0) AS pinned,
      bt.auto_amount AS autoAmount
    FROM accounts a
    LEFT JOIN budget_targets bt ON bt.account_id = a.id AND bt.year = ? AND bt.month = ?
    WHERE a.is_active = 1
    ORDER BY a.category, a.id
  `).all(year, month) as any[]

  // SQLite's EXISTS(...) comes back as 0/1 — coerce to a real boolean so the client
  // (BudgetAccount.laborManaged: boolean) doesn't have to know that.
  for (const r of rows) r.laborManaged = !!r.laborManaged

  // Automatic forecast lines (server/utils/budget-forecast.ts): only for months that
  // haven't started. autoManaged = the forecast writes this line unless it's pinned. Labor lines
  // (every Staffing Plan account) are written by server/utils/labor-forecast.ts since step 4.
  const today = restaurantToday(useRuntimeConfig().qbo?.syncTimeZone)
  const [ty, tm] = today.split('-').map(Number) as [number, number]
  const autoMonth = year * 12 + month > ty * 12 + tm
  const managed = new Set(MANAGED_ACCOUNT_NUMBERS)
  for (const r of rows) {
    r.autoManaged = autoMonth && (managed.has(r.accountNumber) || r.laborManaged)
    r.pinned = r.autoManaged && !!r.pinned
    if (!r.autoManaged) r.autoAmount = null
  }

  // A parent account's own budget row is never counted: its amount is the sum of its children
  // (that's how the Budget page's tree works), so a stored parent amount would double count in every
  // category/year total that sums raw rows. The client sums this response, so null them here;
  // server-side sums skip parents in SQL (NOT EXISTS child) for the same reason.
  const parentIds = new Set(rows.map(r => r.parentAccountId).filter(id => id != null))
  for (const r of rows) if (parentIds.has(r.accountId)) r.amount = null

  // Non-owner roles (see shared/utils/access.ts) get the owners' own pay merged into one
  // "Owner pay" row, unflagged, so individual salaries can't be read and labor totals still add up.
  const role = (event.context.auth as { role?: string } | undefined)?.role ?? 'owner'
  if (role !== 'owner') {
    const owner = rows.filter(r => r.isOwnerCompensation === 1)
    const first = owner[0]
    if (first) {
      first.amount = owner.some(r => r.amount != null) ? owner.reduce((s, r) => s + (r.amount ?? 0), 0) : null
      first.name = 'Owner pay'
      first.accountNumber = null
      first.isOwnerCompensation = 0
      const drop = new Set(owner.slice(1).map(r => r.accountId))
      rows.splice(0, rows.length, ...rows.filter(r => !drop.has(r.accountId)))
    }
  }

  return { year, month, autoMonth, accounts: rows }
})
