// Intuit redirects here after the user approves (or denies) access, per
// QBO_REDIRECT_URI. Exchanges the one-time code for an access/refresh token
// pair and stores them in qbo_tokens — from here on, sync jobs read tokens
// from the database, not from this route.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const code = query.code as string | undefined
  const realmId = query.realmId as string | undefined
  const error = query.error as string | undefined
  const returnedState = query.state as string | undefined

  const expectedState = getCookie(event, 'qbo_oauth_state')
  deleteCookie(event, 'qbo_oauth_state')
  if (!expectedState || !returnedState || returnedState !== expectedState) {
    throw createError({ statusCode: 400, statusMessage: 'QBO callback failed CSRF state check — please restart the connect flow at /api/qbo/connect.' })
  }

  if (error) {
    throw createError({ statusCode: 400, statusMessage: `QBO authorization was not granted: ${error}` })
  }
  if (!code || !realmId) {
    throw createError({ statusCode: 400, statusMessage: 'QBO callback is missing code or realmId.' })
  }

  const { qbo } = useRuntimeConfig()
  const tokens = await exchangeCodeForTokens(qbo.environment, qbo.clientId, qbo.clientSecret, code, qbo.redirectUri)
  saveTokens(realmId, tokens)

  return { connected: true, realmId }
})
