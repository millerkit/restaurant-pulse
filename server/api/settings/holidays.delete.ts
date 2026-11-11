import { refreshForecastsAfterChange } from '../../utils/capacity-forecast'
export default defineEventHandler((event) => {
  const date = String(getQuery(event).date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw createError({ statusCode: 400, statusMessage: 'date is required' })
  const r = useDb().prepare('DELETE FROM holiday_closures WHERE date = ?').run(date)
  // A forecast input changed: recompute the automatic forecast and budget lines.
  refreshForecastsAfterChange(useDb(), useRuntimeConfig().qbo?.syncTimeZone)
  return { deleted: r.changes }
})
