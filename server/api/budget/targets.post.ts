import { refreshForecastsAfterChange } from '../../utils/capacity-forecast'
// Bulk upsert of budget_targets rows. Used both by the Budget tab's macro
// "edit a category total" flow (which computes a per-account redistribution
// client-side, since the page already has every account's current amount
// loaded) and any direct account-level edit — this route doesn't care which,
// it just persists whatever (year, month, accountId, amount) rows it's given.
// pinned (2026-11-11, automatic budget lines): true = typed by hand, kept as entered;
// false = back to automatic (the stored automatic figure replaces amount when there is
// one); omitted = leave the line's pin as it is. Only meaningful for lines the
// automatic forecast manages (server/utils/budget-forecast.ts).
type TargetInput = { year: number, month: number, accountId: number, amount: number, pinned?: boolean }

export default defineEventHandler(async (event) => {
  const body = await readBody<{ targets: TargetInput[] }>(event)
  const targets = body?.targets
  if (!Array.isArray(targets) || targets.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Expected a non-empty "targets" array' })
  }

  for (const t of targets) {
    if (!Number.isInteger(t.year) || t.year < 2000 || t.year > 2100) {
      throw createError({ statusCode: 400, statusMessage: `Invalid year: ${t.year}` })
    }
    if (!Number.isInteger(t.month) || t.month < 1 || t.month > 12) {
      throw createError({ statusCode: 400, statusMessage: `Invalid month: ${t.month}` })
    }
    if (!Number.isInteger(t.accountId)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid accountId: ${t.accountId}` })
    }
    if (typeof t.amount !== 'number' || !Number.isFinite(t.amount)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid amount: ${t.amount}` })
    }
  }

  const db = useDb()
  const accountExists = db.prepare('SELECT 1 FROM accounts WHERE id = ? AND is_active = 1')
  const nonLeafIds = nonLeafAccountIds(db)
  for (const t of targets) {
    if (!accountExists.get(t.accountId)) {
      throw createError({ statusCode: 400, statusMessage: `No active account with id ${t.accountId}` })
    }
    // Budget entry is leaf-accounts-only — a parent's own stored amount gets
    // double-counted by categoryTotals()/hybridYearTotals() while budget/
    // edit.vue's tree ignores it entirely, so the two pages disagree. See
    // server/utils/accounts.ts.
    if (nonLeafIds.has(t.accountId)) {
      throw createError({ statusCode: 400, statusMessage: `Account ${t.accountId} has sub-accounts — budget the sub-accounts instead, not the parent` })
    }
  }

  const upsert = db.prepare(`
    INSERT INTO budget_targets (year, month, account_id, amount, pinned)
    VALUES (@year, @month, @accountId, @amount, COALESCE(@pinned, 0))
    ON CONFLICT(year, month, account_id) DO UPDATE SET
      pinned = COALESCE(@pinned, budget_targets.pinned),
      amount = CASE WHEN @pinned = 0 AND budget_targets.auto_amount IS NOT NULL
        THEN budget_targets.auto_amount ELSE excluded.amount END
  `)
  const upsertAll = db.transaction((rows: TargetInput[]) => {
    for (const t of rows) upsert.run({ ...t, pinned: t.pinned == null ? null : (t.pinned ? 1 : 0) })
  })
  upsertAll(targets)
  // A pin change moves the forecast: unpinning hands a line back to it, and pinning a
  // sales line changes the food & drink cost built on it. Recompute so both are current.
  if (targets.some(t => t.pinned != null)) refreshForecastsAfterChange(db, useRuntimeConfig().qbo?.syncTimeZone)

  return { updated: targets.length }
})
