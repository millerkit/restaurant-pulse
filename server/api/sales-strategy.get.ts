// Planning › Sales Strategy (owner-only by default deny): the Breakeven gap for every open month of a
// year, sorted by what kind of help closes it. See server/utils/sales-strategy.ts.
export default defineEventHandler((event) => {
  const today = restaurantYearMonth()
  let year = Number(getQuery(event).year) || today.year
  if (year < today.year) year = today.year
  if (year > today.year + 1) year = today.year + 1
  return computeSalesStrategy(useDb(), year)
})
