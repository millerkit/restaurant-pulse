// Records an eligible employee's enrollment decision: enrolled, declined or
// canceled — or clears it (status null = TBD, no decision yet). See
// schema.sql's benefits_enrollment_status. Setting status keeps any existing
// note unless a new one is sent; clearing the mark drops the note too.
type Body = { guid: string; status: 'enrolled' | 'declined' | 'canceled' | null; note?: string }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (typeof body?.guid !== 'string' || !body.guid) {
    throw createError({ statusCode: 400, statusMessage: 'guid is required' })
  }
  if (body.status !== null && body.status !== 'enrolled' && body.status !== 'declined' && body.status !== 'canceled') {
    throw createError({ statusCode: 400, statusMessage: "status must be 'enrolled', 'declined', 'canceled' or null" })
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'note must be a string' })
  }

  const db = useDb()
  if (!db.prepare('SELECT 1 FROM toast_employees WHERE guid = ?').get(body.guid)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown employee' })
  }

  if (body.status === null) {
    db.prepare('DELETE FROM benefits_enrollment_status WHERE employee_guid = ?').run(body.guid)
    return { guid: body.guid, status: null }
  }

  const note = body.note === undefined ? null : body.note.trim().slice(0, 500) || null
  try {
    db.prepare(`
    INSERT INTO benefits_enrollment_status (employee_guid, status, note, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (employee_guid) DO UPDATE SET
      status = excluded.status,
      note = CASE WHEN ? THEN excluded.note ELSE benefits_enrollment_status.note END,
      updated_at = excluded.updated_at
  `).run(body.guid, body.status, note, new Date().toISOString(), body.note === undefined ? 0 : 1)
  } catch (err) {
    // An old-shape table only allows declined/canceled; say what to do instead
    // of a bare 500 the page can't explain.
    if (err instanceof Error && err.message.includes('CHECK constraint')) {
      throw createError({
        statusCode: 500,
        statusMessage: "The enrollment table is out of date — run scripts/add-toast-employee-hours-tables.mjs on this server, then try again."
      })
    }
    throw err
  }

  return { guid: body.guid, status: body.status }
})
