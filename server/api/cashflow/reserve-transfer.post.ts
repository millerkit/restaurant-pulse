// Records one real, actual transfer (or reversal — amount may be negative)
// into the QBO 1005 Loan Payment Reserve account. See schema.sql's
// reserve_transfers comment for why this exists instead of assuming a fixed
// $/week schedule happened — real transfers get skipped, reversed, or
// resized, and there's no bank feed to detect any of that automatically, so
// this is the manual entry point (Cash Flow tab's "Record a transfer" form).
type Body = { date: string, amount: number, note?: string }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (typeof body?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    throw createError({ statusCode: 400, statusMessage: 'date must be an ISO 8601 date (YYYY-MM-DD)' })
  }
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount === 0) {
    throw createError({ statusCode: 400, statusMessage: 'amount must be a non-zero number' })
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  const db = useDb()
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO reserve_transfers (transfer_date, amount, note) VALUES (?, ?, ?)
  `).run(body.date, body.amount, note)

  return { id: Number(lastInsertRowid), date: body.date, amount: body.amount, note }
})
