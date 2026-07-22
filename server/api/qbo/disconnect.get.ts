// Intuit redirects here — from QuickBooks' own "Connected Apps" management
// screen, or as this app's registered Disconnect URL — when the user
// disconnects. Revokes the token with Intuit and clears the locally stored
// qbo_tokens row either way, so a stale token never lingers if revocation
// fails (e.g. the user already revoked it from QuickBooks' side).
export default defineEventHandler(async (event) => {
  const { qbo } = useRuntimeConfig()
  const row = loadTokens()

  if (row) {
    try {
      await revokeToken(qbo.clientId, qbo.clientSecret, row.refresh_token)
    } catch (err) {
      console.error('QBO token revoke failed during disconnect:', err)
    }
    clearTokens()
  }

  return { disconnected: true }
})
