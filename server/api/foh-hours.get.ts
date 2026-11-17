// JSON for the Team › FOH Hours page. ?week=YYYY-MM-DD (any day in the wanted Mon–Sun week);
// default is the week of the latest synced day. Hours only, no dollars, so the Floor Manager may call it.
export default defineEventHandler((event) => {
  const { week } = getQuery(event)
  return buildFohHoursReport(typeof week === 'string' ? week : null)
})
