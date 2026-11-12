// Backs the Sales Plan's Special Nights form: the guaranteed-minimum buyout rates (they prefill a
// buyout's price) and each weekday's normal-night revenue (the hint beside the dine-in field, and
// what a buyout displaces: its increment is price - normal night). The undated per-weekday buyout
// counts this route used to return were removed 2026-11-12; hypothetical buyouts live on the
// What-If page. Rates/weekday math lives in server/utils/buyout-rates.ts.

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const year = Number(query.year)
  const month = Number(query.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month (1-12) query params are required' })
  }
  const rates = loadBuyoutRates(useDb())
  const weekdays = buyoutWeekdaysFor(rates, `${year}-${String(month).padStart(2, '0')}-01`)
  return { year, month, rates, weekdays }
})
