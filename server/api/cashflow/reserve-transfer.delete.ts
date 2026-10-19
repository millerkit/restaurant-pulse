// Deletes one recorded reserve transfer by id — for a mis-entered row. A
// genuine reversal of a real transfer should still be recorded as an
// offsetting negative row (see reserve-transfer.post.ts), since that's what
// actually happened in the bank; this is only for entries that never should
// have existed.
export default defineEventHandler(async (event) => {
  const id = Number(getQuery(event).id)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'id must be a positive integer' })
  }
  const { changes } = useDb().prepare('DELETE FROM reserve_transfers WHERE id = ?').run(id)
  if (changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Transfer not found' })
  }
  return { id }
})
