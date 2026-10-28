// Declares how much gift card cash is still expected before year end — see
// schema.sql's gift_card_plan comment. Single row, upserted.
type Body = { expectedCash: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (typeof body?.expectedCash !== 'number' || !Number.isFinite(body.expectedCash) || body.expectedCash < 0) {
    throw createError({ statusCode: 400, statusMessage: 'expectedCash must be a number of 0 or more' })
  }

  const db = useDb()
  db.prepare(`
    INSERT INTO gift_card_plan (id, expected_cash, updated_at) VALUES (1, ?, ?)
    ON CONFLICT (id) DO UPDATE SET expected_cash = excluded.expected_cash, updated_at = excluded.updated_at
  `).run(body.expectedCash, new Date().toISOString())

  return { expectedCash: body.expectedCash }
})
