// Holiday closures for a year (Settings › Restaurant Setup), plus any old
// per-month counts (capacity_seasonality.holiday_closures, no longer read) so
// they can be replaced with dated, named closures.
export default defineEventHandler((event) => {
  const year = Number(getQuery(event).year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw createError({ statusCode: 400, statusMessage: 'year is required' })
  const db = useDb()
  const holidays = [...loadHolidayClosures(db, `${year}-01-01`, `${year}-12-31`).values()]
  const legacyCounts = (db.prepare('SELECT month, holiday_closures AS count FROM capacity_seasonality WHERE holiday_closures > 0 ORDER BY month').all() as { month: number, count: number }[])
  return { year, holidays, legacyCounts }
})
