import { timingSafeEqual } from 'node:crypto'

// Gates every request behind one shared HTTP Basic Auth credential. This
// app shows real restaurant financials once QBO is wired in, so it must
// never be reachable by an unauthenticated visitor after deployment.
// Fails closed (500, not silently open) if the credential isn't configured.
export default defineEventHandler((event) => {
  const { basicAuth } = useRuntimeConfig()
  if (!basicAuth.user || !basicAuth.pass) {
    throw createError({ statusCode: 500, statusMessage: 'BASIC_AUTH_USER / BASIC_AUTH_PASS are not configured.' })
  }

  const expected = Buffer.from(`Basic ${Buffer.from(`${basicAuth.user}:${basicAuth.pass}`).toString('base64')}`)
  const provided = Buffer.from(getHeader(event, 'authorization') ?? '')

  const valid = provided.length === expected.length && timingSafeEqual(provided, expected)
  if (!valid) {
    setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="Restaurant Performance Dashboard"')
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
})
