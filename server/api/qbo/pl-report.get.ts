// Inspection-only route: pulls the raw ProfitAndLoss report (summarized by
// day) from the connected QBO company, so we can see its actual shape
// before designing the accounts-table mapping and the real sync job. Not
// part of the eventual nightly sync — delete once that's built.
// Query params: start_date / end_date (YYYY-MM-DD), default to the last 7 days.
export default defineEventHandler(async (event) => {
  const { qbo } = useRuntimeConfig()

  const query = getQuery(event)
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const startDate = (query.start_date as string) || weekAgo.toISOString().slice(0, 10)
  const endDate = (query.end_date as string) || today.toISOString().slice(0, 10)

  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: (query.summarize_column_by as string) || 'Days'
  })
  const { res, intuitTid } = await qboFetch(qbo.environment, qbo.clientId, qbo.clientSecret, (realmId) => `/v3/company/${realmId}/reports/ProfitAndLoss?${params}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || qboFaultType(body)) {
    throw logAndWrapQboError('QBO ProfitAndLoss request', res, body, intuitTid)
  }
  return body
})
