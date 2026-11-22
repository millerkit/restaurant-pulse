// Dated special nights between ?from and ?to (inclusive, YYYY-MM-DD). See schema.sql.
// On-site event nights also carry `bookings` (2026-11-22): covers on the book from the latest OpenTable
// upload and, with a ticket price, a SUGGESTED event revenue (covers x price). Display only; nothing
// in the budget or forecast reads it.
import { loadSpecialNights } from '../utils/special-nights'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler((event) => {
  const { from, to } = getQuery(event) as { from?: string, to?: string }
  if (!from || !to || !ISO.test(from) || !ISO.test(to)) {
    throw createError({ statusCode: 400, statusMessage: 'from and to must be YYYY-MM-DD' })
  }
  const db = useDb()
  const nights = [...loadSpecialNights(db, from, to).values()]
  let asOf: string | null = null
  let tally: (date: string) => { covers: number, parties: number }
  try {
    asOf = (db.prepare('SELECT imported_at AS t FROM reservation_imports ORDER BY id DESC LIMIT 1').get() as { t: string } | undefined)?.t ?? null
    const stmt = db.prepare(`
      SELECT COALESCE(SUM(size), 0) AS covers, COUNT(*) AS parties FROM reservations
      WHERE visit_date = ? AND canceled_at IS NULL AND status <> 'Cancelled' AND COALESCE(source, '') <> 'Walk-in'
    `)
    tally = date => stmt.get(date) as { covers: number, parties: number }
  } catch {
    tally = () => ({ covers: 0, parties: 0 })
  }
  return {
    nights: nights.map((n) => {
      if (n.kind !== 'event' || !asOf) return n
      const { covers, parties } = tally(n.date)
      const price = n.ticketPrice ?? null
      return { ...n, bookings: { covers, parties, asOf, suggestedRevenue: price && price > 0 ? Math.round(covers * price) : null } }
    })
  }
})
