// Declares how much gift card cash is still expected before year end — see
// schema.sql's gift_card_plan comment. Single row, upserted.
type Body = { expectedCash: number, cushionPct: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (typeof body?.expectedCash !== 'number' || !Number.isFinite(body.expectedCash) || body.expectedCash < 0) {
    throw createError({ statusCode: 400, statusMessage: 'expectedCash must be a number of 0 or more' })
  }

  if (typeof body?.cushionPct !== 'number' || !Number.isFinite(body.cushionPct) || body.cushionPct < 0 || body.cushionPct > 100) {
    throw createError({ statusCode: 400, statusMessage: 'cushionPct must be a number from 0 to 100' })
  }

  const db = useDb()
  db.prepare(`
    INSERT INTO gift_card_plan (id, expected_cash, cushion_pct, updated_at) VALUES (1, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET expected_cash = excluded.expected_cash, cushion_pct = excluded.cushion_pct, updated_at = excluded.updated_at
  `).run(body.expectedCash, body.cushionPct, new Date().toISOString())

  return { expectedCash: body.expectedCash, cushionPct: body.cushionPct }
})
