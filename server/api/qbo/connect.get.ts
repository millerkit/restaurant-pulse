// Visit /api/qbo/connect in a browser to kick off the one-time OAuth
// consent flow. Intuit redirects the signed-in QBO user here, they approve
// access, then Intuit redirects back to QBO_REDIRECT_URI (handled by
// callback.get.ts) with a code we exchange for tokens.
export default defineEventHandler((event) => {
  const { qbo } = useRuntimeConfig()
  if (!qbo.clientId || !qbo.redirectUri) {
    throw createError({ statusCode: 500, statusMessage: 'QBO_CLIENT_ID / QBO_REDIRECT_URI are not set in .env.local' })
  }
  const state = crypto.randomUUID()
  return sendRedirect(event, buildAuthorizeUrl(qbo.clientId, qbo.redirectUri, state))
})
