// Declares the user's editable materiality thresholds for the P&L
// Drill-Downs page's Labor/Opex anomaly flagging — see schema.sql's
// drilldown_thresholds comment. Single row, upserted, same shape as
// server/api/cashflow/reserve-plan.post.ts /
// server/api/dashboard/weekly-benchmark.post.ts. Two fields, not one — the
// page's inline form edits Month and Year together, since both are always
// visible on the page at once (only one is "active" via the period toggle,
// but flipping the toggle shouldn't require a second trip to this form).
type Body = { monthThreshold: number, yearThreshold: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (typeof body?.monthThreshold !== 'number' || !Number.isFinite(body.monthThreshold) || body.monthThreshold < 0) {
    throw createError({ statusCode: 400, statusMessage: 'monthThreshold must be a non-negative number' })
  }
  if (typeof body?.yearThreshold !== 'number' || !Number.isFinite(body.yearThreshold) || body.yearThreshold < 0) {
    throw createError({ statusCode: 400, statusMessage: 'yearThreshold must be a non-negative number' })
  }

  const db = useDb()
  db.prepare(`
    INSERT INTO drilldown_thresholds (id, month_threshold, year_threshold, updated_at) VALUES (1, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET month_threshold = excluded.month_threshold, year_threshold = excluded.year_threshold, updated_at = excluded.updated_at
  `).run(body.monthThreshold, body.yearThreshold, new Date().toISOString())

  return { monthThreshold: body.monthThreshold, yearThreshold: body.yearThreshold }
})
