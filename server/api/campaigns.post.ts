// Adds a marketing campaign, or updates one when `id` is given. See server/utils/campaigns.ts.
type Body = {
  id?: number, name?: string, channel?: string, startDate?: string, endDate?: string,
  targetDows?: number[] | null, targetArea?: string | null, cost?: number, note?: string | null
}
const ISO = /^\d{4}-\d{2}-\d{2}$/
const bad = (msg: string) => createError({ statusCode: 400, statusMessage: msg })

export default defineEventHandler(async (event) => {
  const b = await readBody<Body>(event)
  if (!b) throw bad('Missing body')
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : ''
  if (!name) throw bad('Give the campaign a name')
  if (!(CAMPAIGN_CHANNELS as readonly string[]).includes(b.channel ?? '')) throw bad(`channel must be one of ${CAMPAIGN_CHANNELS.join(', ')}`)
  if (!ISO.test(b.startDate ?? '') || !ISO.test(b.endDate ?? '') || Number.isNaN(Date.parse(`${b.startDate}T00:00:00Z`)) || Number.isNaN(Date.parse(`${b.endDate}T00:00:00Z`))) throw bad('Dates must be YYYY-MM-DD')
  if (b.endDate! < b.startDate!) throw bad('The end date is before the start date')
  const dows = Array.isArray(b.targetDows) && b.targetDows.length > 0 ? [...new Set(b.targetDows)] : null
  if (dows && dows.some(d => !Number.isInteger(d) || d < 0 || d > 6 || d === 1)) throw bad('Weekdays must be Tue–Sun (Mondays are closed)')
  const cost = b.cost ?? 0
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) throw bad('cost must be a number of 0 or more')
  const db = useDb()
  const area = typeof b.targetArea === 'string' && b.targetArea ? b.targetArea : null
  if (area && !db.prepare('SELECT 1 FROM capacity_areas WHERE name = ?').get(area)) throw bad('Unknown area')
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 200) : null
  const dowText = dows ? dows.sort((x, y) => x - y).join(',') : null
  try {
    if (b.id) {
      const r = db.prepare(`UPDATE marketing_campaigns SET name=?, channel=?, start_date=?, end_date=?, target_dows=?, target_area=?, cost=?, note=? WHERE id=?`)
        .run(name, b.channel, b.startDate, b.endDate, dowText, area, cost, note, b.id)
      if (r.changes === 0) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })
      return { id: b.id }
    }
    const r = db.prepare(`INSERT INTO marketing_campaigns (name, channel, start_date, end_date, target_dows, target_area, cost, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(name, b.channel, b.startDate, b.endDate, dowText, area, cost, note, new Date().toISOString())
    return { id: Number(r.lastInsertRowid) }
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) {
      throw createError({ statusCode: 500, statusMessage: 'marketing_campaigns table is missing — database migrations have not been applied (see Settings)' })
    }
    throw err
  }
})
