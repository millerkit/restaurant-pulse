export default defineEventHandler((event) => {
  const key = String(getQuery(event).nameKey ?? '')
  const r = useDb().prepare('DELETE FROM staff_overrides WHERE name_key = ?').run(key)
  if (!r.changes) throw createError({ statusCode: 404, statusMessage: 'No such rule.' })
  return { ok: true }
})
