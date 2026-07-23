// Smoke test: confirms a connected token can actually reach the QBO
// Accounting API, analogous to scripts/toast-scope-check.mjs. Visit
// /api/qbo/status after /api/qbo/connect to verify the connection.
//
// Never throws a raw 500 for auth failures — returns a typed
// `connected: false` response instead, so a future UI can distinguish
// "never connected" from "was connected, needs reconnecting" (e.g. an
// expired/revoked refresh token) and prompt the customer accordingly.
export default defineEventHandler(async (event) => {
  const { qbo } = useRuntimeConfig()

  try {
    const { res, realmId, intuitTid } = await qboFetch(qbo.environment, qbo.clientId, qbo.clientSecret, (r) => `/v3/company/${r}/companyinfo/${r}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok || qboFaultType(body)) {
      throw logAndWrapQboError('QBO CompanyInfo check', res, body, intuitTid)
    }
    return {
      connected: true,
      environment: qbo.environment,
      realmId,
      companyName: body.CompanyInfo?.CompanyName
    }
  } catch (err) {
    if (err instanceof QboNotConnectedError) {
      return { connected: false, reason: 'not_connected' }
    }
    if (err instanceof QboAuthError) {
      return { connected: false, reason: 'reconnect_required' }
    }
    throw err
  }
})
