// Declares the user's current "good week" revenue benchmark — see
// schema.sql's weekly_revenue_benchmark comment. Single row, upserted, same
// shape/pattern as server/api/cashflow/reserve-plan.post.ts.
type Body = { weeklyAmount: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (typeof body?.weeklyAmount !== 'number' || !Number.isFinite(body.weeklyAmount) || body.weeklyAmount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'weeklyAmount must be a positive number' })
  }

  const db = useDb()
  db.prepare(`
    INSERT INTO weekly_revenue_benchmark (id, weekly_amount, updated_at) VALUES (1, ?, ?)
    ON CONFLICT (id) DO UPDATE SET weekly_amount = excluded.weekly_amount, updated_at = excluded.updated_at
  `).run(body.weeklyAmount, new Date().toISOString())

  return { weeklyAmount: body.weeklyAmount }
})
