// Declares the user's current weekly reserve-transfer plan — see
// schema.sql's reserve_plan comment for why this is separate from
// reserve_transfers (the plan can change before the next actual transfer
// at the new rate has happened). Single row, upserted.
type Body = { weeklyAmount: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (typeof body?.weeklyAmount !== 'number' || !Number.isFinite(body.weeklyAmount) || body.weeklyAmount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'weeklyAmount must be a positive number' })
  }

  const db = useDb()
  db.prepare(`
    INSERT INTO reserve_plan (id, weekly_amount, updated_at) VALUES (1, ?, ?)
    ON CONFLICT (id) DO UPDATE SET weekly_amount = excluded.weekly_amount, updated_at = excluded.updated_at
  `).run(body.weeklyAmount, new Date().toISOString())

  return { weeklyAmount: body.weeklyAmount }
})
