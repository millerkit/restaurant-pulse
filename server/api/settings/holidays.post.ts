import { refreshForecastsAfterChange } from '../../utils/capacity-forecast'
// Add or rename a holiday closure, or clear the old per-month counts.
//   { date: 'YYYY-MM-DD', name: 'Thanksgiving' }  upsert
//   { clearLegacyCounts: true }                    zero capacity_seasonality.holiday_closures
export default defineEventHandler(async (event) => {
  const body = await readBody<{ date?: string, name?: string, clearLegacyCounts?: boolean }>(event)
  const db = useDb()
  if (body?.clearLegacyCounts) {
    db.prepare('UPDATE capacity_seasonality SET holiday_closures = 0').run()
    return { cleared: true }
  }
  const date = body?.date ?? ''
  const name = (body?.name ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw createError({ statusCode: 400, statusMessage: 'A valid date (YYYY-MM-DD) is required' })
  if (!name || name.length > 80) throw createError({ statusCode: 400, statusMessage: 'Give the closure a name (up to 80 characters)' })
  db.prepare(`
    INSERT INTO holiday_closures (date, name, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (date) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `).run(date, name, new Date().toISOString())
  // A forecast input changed: recompute the automatic forecast and budget lines.
  refreshForecastsAfterChange(useDb(), useRuntimeConfig().qbo?.syncTimeZone)
  return { date, name }
})
