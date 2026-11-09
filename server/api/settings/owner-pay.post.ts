export default defineEventHandler(async (event) => {
  const body = await readBody<{ accountId?: number, value?: boolean }>(event)
  if (!Number.isInteger(body?.accountId) || typeof body?.value !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Bad request.' })
  const r = useDb().prepare("UPDATE accounts SET is_owner_compensation = ? WHERE id = ? AND category = 'labor'").run(body.value ? 1 : 0, body.accountId)
  if (!r.changes) throw createError({ statusCode: 404, statusMessage: 'No such labor account.' })
  return { ok: true }
})
