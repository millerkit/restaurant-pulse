// Backs the Revenue tab's buyout-planning section: real weekday revenue
// targets (so "how much does a buyout actually add" can be computed client-
// side as buyout rate minus what that night would have made anyway), the
// currently-declared buyout rates, this month's planned counts, and
// whatever this feature last applied to each revenue account's budget —
// the client needs all four to render the preview and to compute a correct
// re-apply delta. See schema.sql's revenue_buyout_applied comment for why
// that last piece exists.
const DEFAULT_WEEKDAY_RATE = 10000
const DEFAULT_WEEKEND_RATE = 12000

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = Number(query.year)
  const month = Number(query.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month (1-12) query params are required' })
  }

  const db = useDb()

  const ratesRow = db.prepare('SELECT weekday_rate AS weekdayRate, weekend_rate AS weekendRate, updated_at AS updatedAt FROM buyout_rates WHERE id = 1')
    .get() as { weekdayRate: number, weekendRate: number, updatedAt: string } | undefined
  const rates = {
    weekdayRate: ratesRow?.weekdayRate ?? DEFAULT_WEEKDAY_RATE,
    weekendRate: ratesRow?.weekendRate ?? DEFAULT_WEEKEND_RATE,
    updatedAt: ratesRow?.updatedAt ?? null
  }

  const weeklyTargets = computeWeeklyRevenueTargets()
  const weekdays = weeklyTargets.days.map(d => ({
    dow: d.dow,
    label: d.label,
    short: d.short,
    dollarTarget: d.dollarTarget,
    rate: (d.dow === 5 || d.dow === 6 || d.dow === 0) ? rates.weekendRate : rates.weekdayRate
  }))

  const countRows = db.prepare('SELECT dow, count FROM revenue_buyout_plan WHERE year = ? AND month = ?').all(year, month) as { dow: number, count: number }[]
  const countByDow: Record<number, number> = {}
  for (const r of countRows) countByDow[r.dow] = r.count

  const appliedRows = db.prepare('SELECT account_id AS accountId, amount FROM revenue_buyout_applied WHERE year = ? AND month = ?').all(year, month) as { accountId: number, amount: number }[]
  const appliedByAccountId: Record<number, number> = {}
  for (const r of appliedRows) appliedByAccountId[r.accountId] = r.amount

  const foodBeverageMix = computeFoodBeverageMix()

  return { year, month, rates, weekdays, countByDow, appliedByAccountId, foodBeverageMix }
})
