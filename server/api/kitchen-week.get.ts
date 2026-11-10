// "This Week" for the Sous Chef (kitchen role): covers only, never dollars.
//
// The owner/GM This Week page (/api/dashboard) mixes covers with revenue goals, budgets and cost
// data, so the kitchen role is NOT allowed to call it (shared/utils/access.ts, default deny).
// This route returns only what the kitchen plans prep and schedules from: this week's expected
// covers per night vs. real Toast covers so far, and the next 7 nights' OpenTable booking pace.
// Every field is a count of guests, a date or a label. Dollar amounts (the weekly sales goal,
// per-night dollar targets, spend per cover, a special night's expected revenue) are never
// selected, so there is nothing to redact after the fact.
import { computeBookingPace } from '../utils/booking-pace'
import { loadPlannedNights } from '../utils/special-nights'
import { computeWeeklyRevenueTargets } from '../utils/weekly-targets'

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// Monday on/before iso: start of the calendar week containing it (same as dashboard.get.ts).
function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return addDaysIso(iso, dow === 0 ? -6 : 1 - dow)
}

type SpecialKind = 'buyout' | 'closed' | 'offsite' | 'event'
type KitchenSpecial = { kind: SpecialKind, note: string | null, holiday: string | null }

export default defineEventHandler(() => {
  const db = useDb()

  const row = db.prepare('SELECT MAX(date) AS date FROM daily_toast_metrics').get() as { date: string | null }
  const asOfDate = row.date

  // Next 7 nights. Reuses the shared booking-pace math; the special night's expected revenue is
  // dropped (kind and note only).
  let bookingPace: ReturnType<typeof computeBookingPace> | null = null
  let nights: { date: string, special: KitchenSpecial | null }[] = []
  try {
    bookingPace = computeBookingPace(db)
  } catch {
    bookingPace = null
  }
  const specialFor = (map: ReturnType<typeof loadPlannedNights>, date: string): KitchenSpecial | null => {
    const s = map.get(date)
    return s ? { kind: s.kind, note: s.note, holiday: s.holiday ?? null } : null
  }
  let pace: unknown = bookingPace
  if (bookingPace?.available) {
    const first = bookingPace.nights[0]?.date ?? ''
    const last = bookingPace.nights[bookingPace.nights.length - 1]?.date ?? ''
    let special = new Map() as ReturnType<typeof loadPlannedNights>
    try { special = loadPlannedNights(db, first, last) } catch { /* table missing: no special nights */ }
    nights = bookingPace.nights.map(n => ({ date: n.date, special: specialFor(special, n.date) }))
    pace = { ...bookingPace, nights: bookingPace.nights.map((n, i) => ({ ...n, special: nights[i]!.special })) }
  }

  if (!asOfDate) return { asOfDate: null, week: null, bookingPace: pace }

  // This week, Tue..Sun: expected covers (the same day-specific pattern the owner's page uses,
  // converted to covers) against real Toast covers so far.
  const weekly = computeWeeklyRevenueTargets()
  const monday = mondayOf(asOfDate)
  const weekEnd = addDaysIso(monday, 6)
  const coversRows = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date BETWEEN ? AND ?').all(monday, weekEnd) as { date: string, covers: number }[]
  const coversByDate = new Map(coversRows.map(r => [r.date, r.covers]))
  let weekSpecial = new Map() as ReturnType<typeof loadPlannedNights>
  try { weekSpecial = loadPlannedNights(db, monday, weekEnd) } catch { /* none */ }

  const days = weekly.days.map((_, i) => {
    const date = addDaysIso(monday, i + 1) // Tue = Monday + 1 .. Sun = Monday + 6
    const target = weekly.forDate(date).days[i]!
    const hasHappened = date <= asOfDate
    return {
      key: target.key,
      date,
      hasHappened,
      coversTarget: target.coversTarget,
      actualCovers: hasHappened ? (coversByDate.get(date) ?? null) : null,
      special: specialFor(weekSpecial, date)
    }
  })
  const elapsed = days.filter(d => d.hasHappened && !d.special)
  const closure = weekly.forDate(asOfDate)

  return {
    asOfDate,
    week: {
      monday,
      days,
      // Week-to-date compares only ordinary nights that have happened, so a buyout or closure
      // doesn't skew "behind/ahead".
      toDate: {
        actualCovers: elapsed.reduce((s, d) => s + (d.actualCovers ?? 0), 0),
        targetCovers: elapsed.reduce((s, d) => s + (d.coversTarget ?? 0), 0)
      },
      fullWeekTargetCovers: days.filter(d => !d.special).reduce((s, d) => s + (d.coversTarget ?? 0), 0),
      closureNote: closure.from ? closure.note : null,
      sampleOpenDays: weekly.sampleOpenDays,
      sinceDate: weekly.sinceDate
    },
    bookingPace: pace
  }
})
