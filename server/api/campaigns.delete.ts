// Removes one marketing campaign (?id=).
export default defineEventHandler((event) => {
  const id = Number(getQuery(event).id)
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'id must be a number' })
  const r = useDb().prepare('DELETE FROM marketing_campaigns WHERE id = ?').run(id)
  return { deleted: r.changes }
})
