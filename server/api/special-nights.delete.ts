import { refreshForecastsAfterChange } from '../utils/capacity-forecast'
// Removes one dated special night (?date=YYYY-MM-DD).
export default defineEventHandler((event) => {
  const { date } = getQuery(event) as { date?: string }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, statusMessage: 'date must be YYYY-MM-DD' })
  }
  const { changes } = useDb().prepare('DELETE FROM special_nights WHERE date = ?').run(date)
  // A forecast input changed: recompute the automatic forecast and budget lines.
  refreshForecastsAfterChange(useDb(), useRuntimeConfig().qbo?.syncTimeZone)
  return { deleted: changes }
})
