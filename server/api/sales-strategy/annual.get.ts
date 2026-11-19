// Sales Strategy › Annual plan (owner-only by default deny): baseline + saved inputs. See server/utils/annual-sales-plan.ts.
export default defineEventHandler((event) => {
  const today = restaurantYearMonth()
  let year = Number(getQuery(event).year) || today.year
  if (year < today.year) year = today.year
  if (year > today.year + 1) year = today.year + 1
  return computeAnnualPlan(useDb(), year)
})
