export default defineEventHandler((event) => {
  const q = getQuery(event)
  const areaId = Number(q.areaId)
  const date = String(q.date ?? '')
  if (!Number.isInteger(areaId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw createError({ statusCode: 400, statusMessage: 'areaId and date are required' })
  const r = useDb().prepare('DELETE FROM area_night_exclusions WHERE area_id = ? AND date = ?').run(areaId, date)
  return { deleted: r.changes }
})
