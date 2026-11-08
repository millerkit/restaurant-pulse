// JSON for the Kitchen Labor tab's BOH hours report. ?week=YYYY-MM-DD (any day
// in the wanted Mon–Sun week); default is the week of the latest synced day.
export default defineEventHandler((event) => {
  const { week } = getQuery(event)
  return buildBohHoursReport(typeof week === 'string' ? week : null)
})
