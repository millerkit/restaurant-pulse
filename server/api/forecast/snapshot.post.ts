// Manual trigger for a forecast snapshot (the nightly sync refuses outside production, so this is
// how it's tested locally). Owner-only by default (access is default-deny). Body: optional
// { date: 'YYYY-MM-DD' } to take the snapshot "as of" that day; both kinds are taken (existing
// ones for that snapshot_date are left alone).
import { restaurantToday } from '../../utils/capacity-forecast'
import { takeForecastSnapshots } from '../../utils/forecast-snapshots'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ date?: string }>(event).catch(() => null)
  const date = body?.date ?? restaurantToday(useRuntimeConfig().qbo?.syncTimeZone)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw createError({ statusCode: 400, statusMessage: 'date must be YYYY-MM-DD' })
  }
  return { date, snapshots: takeForecastSnapshots(useDb(), date, { force: true }) }
})
