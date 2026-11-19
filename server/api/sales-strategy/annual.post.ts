// Saves the Annual plan inputs for a year (owner-only by default deny). Body: { year, inputs }; { year, reset: true }
// deletes the saved row so the defaults show again.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ year?: number, inputs?: unknown, reset?: boolean }>(event)
  const year = Number(body?.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw createError({ statusCode: 400, statusMessage: 'year is required' })
  const db = useDb()
  if (body?.reset) {
    db.prepare('DELETE FROM annual_sales_plan WHERE year = ?').run(year)
    return computeAnnualPlan(db, year)
  }
  const inputs = validateAnnualPlanInputs(body?.inputs)
  if (typeof inputs === 'string') throw createError({ statusCode: 400, statusMessage: inputs })
  const auth = event.context.auth as { name?: string | null, email?: string | null } | undefined
  db.prepare(`
    INSERT INTO annual_sales_plan (year, inputs, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(year) DO UPDATE SET inputs = excluded.inputs, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(year, JSON.stringify(inputs), new Date().toISOString(), auth?.name ?? auth?.email ?? null)
  return computeAnnualPlan(db, year)
})
