// Declares the current buyout guaranteed-minimum pricing — see schema.sql's
// buyout_rates comment. Single row, upserted, same shape/pattern as
// server/api/dashboard/weekly-benchmark.post.ts.
type Body = { weekdayRate: number, weekendRate: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (typeof body?.weekdayRate !== 'number' || !Number.isFinite(body.weekdayRate) || body.weekdayRate <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'weekdayRate must be a positive number' })
  }
  if (typeof body?.weekendRate !== 'number' || !Number.isFinite(body.weekendRate) || body.weekendRate <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'weekendRate must be a positive number' })
  }

  const db = useDb()
  db.prepare(`
    INSERT INTO buyout_rates (id, weekday_rate, weekend_rate, updated_at) VALUES (1, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET weekday_rate = excluded.weekday_rate, weekend_rate = excluded.weekend_rate, updated_at = excluded.updated_at
  `).run(body.weekdayRate, body.weekendRate, new Date().toISOString())

  return { weekdayRate: body.weekdayRate, weekendRate: body.weekendRate }
})
