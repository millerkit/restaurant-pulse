// Add or update one area's skipped night: { areaId, date: 'YYYY-MM-DD', note? }. Trend display only;
// no forecast input changes, so no refresh.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ areaId?: number, date?: string, note?: string }>(event)
  const db = useDb()
  const areaId = Number(body?.areaId)
  const date = body?.date ?? ''
  const note = (body?.note ?? '').trim()
  if (!db.prepare('SELECT 1 FROM capacity_areas WHERE id = ?').get(areaId)) throw createError({ statusCode: 400, statusMessage: 'Pick an area' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw createError({ statusCode: 400, statusMessage: 'A valid date (YYYY-MM-DD) is required' })
  if (note.length > 120) throw createError({ statusCode: 400, statusMessage: 'Keep the note under 120 characters' })
  db.prepare(`
    INSERT INTO area_night_exclusions (area_id, date, note) VALUES (?, ?, ?)
    ON CONFLICT (area_id, date) DO UPDATE SET note = excluded.note
  `).run(areaId, date, note || null)
  return { areaId, date, note }
})
