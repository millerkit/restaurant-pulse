// Visit /api/qbo/connect in a browser to kick off the one-time OAuth
// consent flow. Intuit redirects the signed-in QBO user here, they approve
// access, then Intuit redirects back to QBO_REDIRECT_URI (handled by
// callback.get.ts) with a code we exchange for tokens.
//
// The `state` value is stored in a short-lived cookie and checked against
// the callback's `state` query param (CSRF protection — without this, an
// attacker could get a victim to hit a crafted callback URL and bind an
// arbitrary QBO company to this app's stored tokens). SameSite=Lax, not
// Strict: the callback is a cross-site top-level GET navigation from
// Intuit's domain, which Strict cookies aren't sent on.
export default defineEventHandler(async (event) => {
  const { qbo } = useRuntimeConfig()
  if (!qbo.clientId || !qbo.redirectUri) {
    throw createError({ statusCode: 500, statusMessage: 'QBO_CLIENT_ID / QBO_REDIRECT_URI are not set in .env.local' })
  }
  const state = crypto.randomUUID()
  setCookie(event, 'qbo_oauth_state', state, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 10 * 60
  })
  return sendRedirect(event, await buildAuthorizeUrl(qbo.environment, qbo.clientId, qbo.redirectUri, state))
})
