// Inspection-only route: pulls the raw ProfitAndLoss report (summarized by
// day) from the connected QBO company, so we can see its actual shape
// before designing the accounts-table mapping and the real sync job. Not
// part of the eventual nightly sync — delete once that's built.
// Query params: start_date / end_date (YYYY-MM-DD), default to the last 7 days.
export default defineEventHandler(async (event) => {
  const { qbo } = useRuntimeConfig()
  const { accessToken, realmId } = await getValidAccessToken(qbo.clientId, qbo.clientSecret)

  const query = getQuery(event)
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const startDate = (query.start_date as string) || weekAgo.toISOString().slice(0, 10)
  const endDate = (query.end_date as string) || today.toISOString().slice(0, 10)

  const base = qboApiBase(qbo.environment)
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: (query.summarize_column_by as string) || 'Days'
  })
  const res = await fetch(`${base}/v3/company/${realmId}/reports/ProfitAndLoss?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw createError({ statusCode: res.status, statusMessage: `QBO ProfitAndLoss request failed: ${JSON.stringify(body)}` })
  }
  return body
})
