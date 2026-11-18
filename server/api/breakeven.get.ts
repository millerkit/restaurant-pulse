// Breakeven route: clamps the year/month the page asks for and hands off to computeBreakeven
// (server/utils/breakeven.ts, where the cost layers and expected covers are explained).
export default defineEventHandler((event) => {
  const today = restaurantYearMonth()
  const q = getQuery(event)
  // Current month through December of next year.
  let year = Number(q.year) || today.year
  if (year < today.year) year = today.year
  if (year > today.year + 1) year = today.year + 1
  const minMonth = year === today.year ? today.month : 1
  const month = Math.min(12, Math.max(minMonth, Number(q.month) || minMonth))
  return computeBreakeven(useDb(), year, month, q.payroll === 'month' ? 'month' : 'average')
})
