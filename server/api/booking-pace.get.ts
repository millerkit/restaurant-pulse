// Dashboard "Next 7 nights" panel: booking pace (server/utils/booking-pace.ts) plus any
// dated special night (buyout, closure, off-site, event) on each of those nights.
import { computeBookingPace } from '../utils/booking-pace'
import { loadPlannedNights } from '../utils/special-nights'

export default defineEventHandler(() => {
  const db = useDb()
  const pace = computeBookingPace(db)
  if (!pace.available) return pace
  const first = pace.nights[0]?.date ?? ''
  const last = pace.nights[pace.nights.length - 1]?.date ?? ''
  const special = loadPlannedNights(db, first, last)
  return { ...pace, nights: pace.nights.map(n => ({ ...n, special: special.get(n.date) ?? null })) }
})
