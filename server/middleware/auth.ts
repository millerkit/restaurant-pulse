import { timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { H3Event } from 'h3'

// Gates every request. This app shows real restaurant financials once QBO
// is wired in, so it must never be reachable by an unauthenticated visitor
// after deployment.
//
// Two auth paths, keyed off the request's Host header:
//   - The custom domain (cloudflareAccess.hostname, e.g.
//     pulse.urbanhearth.net) is gated by Cloudflare Access at the edge —
//     each person gets their own login (email one-time code) instead of a
//     shared password. The app verifies the signed `Cf-Access-Jwt-Assertion`
//     header against Cloudflare's public JWKS rather than just trusting the
//     Host header, since Fly apps are also reachable directly by IP — a
//     spoofed Host claiming to be the custom domain must not be enough to
//     get in without ever going through Cloudflare.
//   - Everything else (notably the raw *.fly.dev hostname, which stays
//     publicly resolvable and bypasses Cloudflare entirely) falls back to
//     the original shared Basic Auth credential, kept intentionally as a
//     backstop rather than left wide open.
// If cloudflareAccess isn't configured (hostname/teamDomain/aud unset),
// this is a no-op and every request uses Basic Auth, same as before.
//
// /privacy and /terms are the exception on both paths: Intuit's app-review
// process (and QuickBooks users generally) must be able to load these pages
// without credentials, since they're linked from the OAuth consent/
// production-key flow. They contain no restaurant financial data, so
// exposing them is safe.
const PUBLIC_PATHS = ['/privacy', '/terms']

let accessJwks: ReturnType<typeof createRemoteJWKSet> | undefined

async function checkCloudflareAccess(event: H3Event, teamDomain: string, aud: string) {
  const token = getHeader(event, 'cf-access-jwt-assertion')
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Missing Cloudflare Access assertion' })
  }
  accessJwks ??= createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
  try {
    await jwtVerify(token, accessJwks, { issuer: `https://${teamDomain}`, audience: aud })
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid Cloudflare Access assertion' })
  }
}

function checkBasicAuth(event: H3Event, user?: string, pass?: string) {
  if (!user || !pass) {
    throw createError({ statusCode: 500, statusMessage: 'BASIC_AUTH_USER / BASIC_AUTH_PASS are not configured.' })
  }
  const expected = Buffer.from(`Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`)
  const provided = Buffer.from(getHeader(event, 'authorization') ?? '')
  const valid = provided.length === expected.length && timingSafeEqual(provided, expected)
  if (!valid) {
    setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="Restaurant Pulse"')
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
}

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]
  if (PUBLIC_PATHS.includes(path) || path.startsWith('/_nuxt/')) return

  const { basicAuth, cloudflareAccess } = useRuntimeConfig()
  const host = (getHeader(event, 'host') ?? '').split(':')[0]

  if (cloudflareAccess.hostname && cloudflareAccess.teamDomain && cloudflareAccess.aud && host === cloudflareAccess.hostname) {
    await checkCloudflareAccess(event, cloudflareAccess.teamDomain, cloudflareAccess.aud)
    return
  }

  checkBasicAuth(event, basicAuth.user, basicAuth.pass)
})
