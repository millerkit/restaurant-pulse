// Smoke test: confirms a connected token can actually reach the QBO
// Accounting API, analogous to scripts/toast-scope-check.mjs. Visit
// /api/qbo/status after /api/qbo/connect to verify the connection.
export default defineEventHandler(async (event) => {
  const { qbo } = useRuntimeConfig()
  const { accessToken, realmId } = await getValidAccessToken(qbo.clientId, qbo.clientSecret)

  const base = qboApiBase(qbo.environment)
  const res = await fetch(`${base}/v3/company/${realmId}/companyinfo/${realmId}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw createError({ statusCode: res.status, statusMessage: `QBO CompanyInfo check failed: ${JSON.stringify(body)}` })
  }

  return {
    connected: true,
    environment: qbo.environment,
    realmId,
    companyName: body.CompanyInfo?.CompanyName
  }
})
