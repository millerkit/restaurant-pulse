// Bulk upsert of budget_targets rows. Used both by the Budget tab's macro
// "edit a category total" flow (which computes a per-account redistribution
// client-side, since the page already has every account's current amount
// loaded) and any direct account-level edit — this route doesn't care which,
// it just persists whatever (year, month, accountId, amount) rows it's given.
type TargetInput = { year: number, month: number, accountId: number, amount: number }

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
  for (const t of targets) {
    if (!accountExists.get(t.accountId)) {
      throw createError({ statusCode: 400, statusMessage: `No active account with id ${t.accountId}` })
    }
  }

  const upsert = db.prepare(`
    INSERT INTO budget_targets (year, month, account_id, amount)
    VALUES (@year, @month, @accountId, @amount)
    ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount
  `)
  const upsertAll = db.transaction((rows: TargetInput[]) => {
    for (const t of rows) upsert.run(t)
  })
  upsertAll(targets)

  return { updated: targets.length }
})
