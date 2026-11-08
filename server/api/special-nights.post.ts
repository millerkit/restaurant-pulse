// Adds or replaces one dated special night. expectedRevenue is core dine-in revenue
// expected that night (see schema.sql's special_nights comment).
//
// A dated buyout also feeds the BUDGET: the Revenue tab's buyout panel counts it as
// (expectedRevenue − that weekday's normal night) alongside the planner's undated
// per-weekday counts. When `replacesUndated` is set, the matching undated count in
// revenue_buyout_plan is reduced by what this buyout is worth in that weekday's
// "standard buyout" units, so promoting a planned-but-undated buyout to a real date
// doesn't count it twice. If it prices the same, that count goes to zero.
import { SPECIAL_NIGHT_KINDS, type SpecialNightKind } from '../utils/special-nights'

type Body = { date: string, kind: SpecialNightKind, expectedRevenue: number, note?: string | null, replacesUndated?: boolean }

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
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null
  const db = useDb()
  const [yearStr, monthStr] = body.date.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const dow = new Date(`${body.date}T00:00:00Z`).getUTCDay()

  let undatedCountBefore: number | null = null
  let undatedCountAfter: number | null = null
  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO special_nights (date, kind, expected_revenue, note, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (date) DO UPDATE SET kind = excluded.kind, expected_revenue = excluded.expected_revenue,
          note = excluded.note, updated_at = excluded.updated_at
      `).run(body.date, body.kind, body.expectedRevenue, note, new Date().toISOString())

      if (body.kind === 'buyout' && body.replacesUndated && dow !== 1) {
        const row = db.prepare('SELECT count FROM revenue_buyout_plan WHERE year = ? AND month = ? AND dow = ?').get(year, month, dow) as { count: number } | undefined
        if (row && row.count > 0) {
          undatedCountBefore = row.count
          const weekday = buyoutWeekdaysFor(loadBuyoutRates(db), `${year}-${monthStr}-01`).find(w => w.dow === dow)
          const target = weekday?.dollarTarget
          // This buyout's worth in standard-buyout units: (price − normal) / (rate − normal).
          // Without a normal-night target (not enough history), treat it as exactly one buyout.
          const worth = weekday && target != null && weekday.rate > target
            ? (body.expectedRevenue - target) / (weekday.rate - target)
            : 1
          undatedCountAfter = Math.max(0, Math.round((row.count - Math.max(0, worth)) * 10000) / 10000)
          db.prepare('UPDATE revenue_buyout_plan SET count = ? WHERE year = ? AND month = ? AND dow = ?').run(undatedCountAfter, year, month, dow)
        }
      }
    })()
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) {
      throw createError({ statusCode: 500, statusMessage: 'special_nights table is missing — database migrations have not been applied (see Settings)' })
    }
    throw err
  }
  return { date: body.date, kind: body.kind, expectedRevenue: body.expectedRevenue, note, undatedCountBefore, undatedCountAfter }
})
