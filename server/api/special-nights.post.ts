import { refreshForecastsAfterChange } from '../utils/capacity-forecast'
// Adds or replaces one dated special night. expectedRevenue is regular core dine-in revenue
// expected that night; eventRevenue (2026-11-12) is what the event itself brings in (tickets,
// event food/drink, catering), which the automatic budget posts to Event Sales / Catering.
// See schema.sql's special_nights comment.
//
// A dated buyout also feeds the BUDGET as (expectedRevenue − that weekday's normal night),
// computed in server/utils/budget-forecast.ts.
import { SPECIAL_NIGHT_KINDS, type SpecialNightKind } from '../utils/special-nights'

type Body = { date: string, kind: SpecialNightKind, expectedRevenue: number, eventRevenue?: number, note?: string | null }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '') || Number.isNaN(Date.parse(`${body.date}T00:00:00Z`))) {
    throw createError({ statusCode: 400, statusMessage: 'date must be YYYY-MM-DD' })
  }
  if (!SPECIAL_NIGHT_KINDS.includes(body.kind)) {
    throw createError({ statusCode: 400, statusMessage: `kind must be one of ${SPECIAL_NIGHT_KINDS.join(', ')}` })
  }
  if (typeof body.expectedRevenue !== 'number' || !Number.isFinite(body.expectedRevenue) || body.expectedRevenue < 0) {
    throw createError({ statusCode: 400, statusMessage: 'expectedRevenue must be a number of 0 or more' })
  }
  const eventRevenue = body.eventRevenue ?? 0
  if (typeof eventRevenue !== 'number' || !Number.isFinite(eventRevenue) || eventRevenue < 0) {
    throw createError({ statusCode: 400, statusMessage: 'eventRevenue must be a number of 0 or more' })
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null
  const db = useDb()
  try {
    db.prepare(`
      INSERT INTO special_nights (date, kind, expected_revenue, event_revenue, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (date) DO UPDATE SET kind = excluded.kind, expected_revenue = excluded.expected_revenue,
        event_revenue = excluded.event_revenue, note = excluded.note, updated_at = excluded.updated_at
    `).run(body.date, body.kind, body.expectedRevenue, eventRevenue, note, new Date().toISOString())
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) {
      throw createError({ statusCode: 500, statusMessage: 'special_nights table is missing — database migrations have not been applied (see Settings)' })
    }
    throw err
  }
  // A forecast input changed: recompute the automatic forecast and budget lines.
  refreshForecastsAfterChange(useDb(), useRuntimeConfig().qbo?.syncTimeZone)
  return { date: body.date, kind: body.kind, expectedRevenue: body.expectedRevenue, eventRevenue, note }
})
