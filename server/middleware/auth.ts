import { timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { H3Event } from 'h3'
import type { Role } from '#shared/utils/access'

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

async function checkCloudflareAccess(event: H3Event, teamDomain: string, aud: string): Promise<string | null> {
  const token = getHeader(event, 'cf-access-jwt-assertion')
  if (!token) {
    console.error(`Cloudflare Access: request to ${event.path} had no Cf-Access-Jwt-Assertion header`)
    throw createError({ statusCode: 401, statusMessage: 'Missing Cloudflare Access assertion' })
  }
  accessJwks ??= createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
  try {
    const { payload } = await jwtVerify(token, accessJwks, { issuer: `https://${teamDomain}`, audience: aud })
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : null
  } catch (err) {
    console.error(`Cloudflare Access: JWT verification failed for ${event.path}:`, err)
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

// Roles (phase 2 of the UI cleanup): the verified Cloudflare Access email picks a role from
// user_roles; the Basic Auth backstop is always owner. What each role may touch is in
// shared/utils/access.ts and is enforced here for pages AND API routes, so hiding a nav link
// is never the only protection. An email with no role row is refused.
function resolveRole(email: string | null): { role: Role, email: string | null, name: string | null } | null {
  if (!email) return null
  const row = useDb().prepare('SELECT role, name FROM user_roles WHERE email = ?').get(email) as { role: Role, name: string | null } | undefined
  return row ? { role: row.role, email, name: row.name } : null
}

// "View as" (2026-11-09): a real owner can preview what the GM or Sous Chef sees. The choice is
// kept in an httpOnly cookie set by POST /api/view-as and is honored ONLY when the signed-in
// person is really an owner, and only ever downgrades (to gm or kitchen), so it can't be used to
// gain access. The real role is kept in `realRole` so the owner can always switch back.
function applyViewAs(event: H3Event, auth: { role: Role, email: string | null, name: string | null }) {
  if (auth.role !== 'owner') return auth
  const want = parseCookies(event)['view_as']
  if (want !== 'gm' && want !== 'kitchen') return auth
  return { ...auth, role: want as Role, realRole: 'owner' as Role }
}

function enforceRole(event: H3Event, path: string, auth: { role: Role, email: string | null }) {
  if (auth.role === 'owner') return
  const isApi = path.startsWith('/api/')
  // Nuxt internals (payloads, icons, error page) carry no data of their own.
  if (!isApi && (path.startsWith('/_') || path === '/favicon.ico')) return
  const tab = new URL(event.path, 'http://x').searchParams.get('tab')
  const ok = isApi
    ? roleCanCallApi(auth.role, path, event.method)
    : roleCanViewPage(auth.role, path, tab)
  if (ok) return
  if (isApi) throw createError({ statusCode: 403, statusMessage: 'Your account does not have access to this.' })
  return sendRedirect(event, roleHome(auth.role), 302)
}

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]
  if (PUBLIC_PATHS.includes(path) || path.startsWith('/_nuxt/')) return

  const { basicAuth, cloudflareAccess } = useRuntimeConfig()
  const host = (getHeader(event, 'host') ?? '').split(':')[0]

  if (cloudflareAccess.hostname && cloudflareAccess.teamDomain && cloudflareAccess.aud && host === cloudflareAccess.hostname) {
    const email = await checkCloudflareAccess(event, cloudflareAccess.teamDomain, cloudflareAccess.aud)
    const resolved = resolveRole(email)
    if (!resolved) {
      console.error(`Access: ${email ?? 'unknown email'} has no role in user_roles`)
      throw createError({ statusCode: 403, statusMessage: 'This account has not been given access yet. Ask the owner to add it under Settings > People & Access.' })
    }
    const effective = applyViewAs(event, resolved)
    event.context.auth = effective
    return enforceRole(event, path, effective)
  }

  checkBasicAuth(event, basicAuth.user, basicAuth.pass)
  event.context.auth = applyViewAs(event, { role: 'owner' as Role, email: null, name: null })
  return enforceRole(event, path, event.context.auth)
})
