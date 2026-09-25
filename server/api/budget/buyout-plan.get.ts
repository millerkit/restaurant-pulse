// Backs the Revenue tab's buyout-planning section: real weekday revenue
// targets (so "how much does a buyout actually add" can be computed client-
// side as buyout rate minus what that night would have made anyway), the
// currently-declared buyout rates, this month's planned counts, and
// whatever this feature last applied to each revenue account's budget —
// the client needs all four to render the preview and to compute a correct
// re-apply delta. See schema.sql's revenue_buyout_applied comment for why
// that last piece exists. The rates/weekday-target computation itself lives
// in server/utils/buyout-rates.ts, shared with revenue-modeling.get.ts's
// own (unpersisted, annual-count) buyout what-if.

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = Number(query.year)
  const month = Number(query.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month (1-12) query params are required' })
  }

  const db = useDb()

  const rates = loadBuyoutRates(db)
  const weekdays = buyoutWeekdaysFor(rates)

  const countRows = db.prepare('SELECT dow, count FROM revenue_buyout_plan WHERE year = ? AND month = ?').all(year, month) as { dow: number, count: number }[]
  const countByDow: Record<number, number> = {}
  for (const r of countRows) countByDow[r.dow] = r.count

  const appliedRows = db.prepare('SELECT account_id AS accountId, amount FROM revenue_buyout_applied WHERE year = ? AND month = ?').all(year, month) as { accountId: number, amount: number }[]
  const appliedByAccountId: Record<number, number> = {}
  for (const r of appliedRows) appliedByAccountId[r.accountId] = r.amount

  const foodBeverageMix = computeFoodBeverageMix()

  return { year, month, rates, weekdays, countByDow, appliedByAccountId, foodBeverageMix }
})
