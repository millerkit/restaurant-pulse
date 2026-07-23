// OAuth2 + API helpers for QuickBooks Online.

// Fallback endpoints, used only if the discovery document fetch fails (see
// getDiscoveryDocument) — these are Intuit's own long-stable URLs, kept here
// so a network hiccup reaching Intuit's discovery endpoint can't block the
// OAuth flow entirely.
const FALLBACK_ENDPOINTS: Record<string, DiscoveryDocument> = {
  production: {
    authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2',
    token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
  },
  sandbox: {
    authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2',
    token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
  }
}

const DISCOVERY_URLS: Record<string, string> = {
  production: 'https://developer.api.intuit.com/.well-known/openid_configuration',
  sandbox: 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration'
}

const SCOPE = 'com.intuit.quickbooks.accounting'

export function qboApiBase(environment: string) {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

interface DiscoveryDocument {
  authorization_endpoint: string
  token_endpoint: string
  revocation_endpoint: string
}

// Intuit's discovery document is the source of truth for these endpoints
// (question 5 of the app assessment questionnaire asks specifically whether
// an app uses it). It changes rarely, so this is cached in-memory per
// environment rather than fetched on every OAuth request.
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000
const discoveryCache = new Map<string, { doc: DiscoveryDocument; fetchedAt: number }>()

async function getDiscoveryDocument(environment: string): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(environment)
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
    return cached.doc
  }
  try {
    const res = await fetch(DISCOVERY_URLS[environment] ?? DISCOVERY_URLS.sandbox)
    if (!res.ok) throw new Error(`discovery document fetch failed: ${res.status}`)
    const doc = (await res.json()) as DiscoveryDocument
    discoveryCache.set(environment, { doc, fetchedAt: Date.now() })
    return doc
  } catch (err) {
    console.error('QBO discovery document fetch failed, falling back to known endpoints:', err)
    return FALLBACK_ENDPOINTS[environment] ?? FALLBACK_ENDPOINTS.sandbox
  }
}

// Thrown for real (non-transient) token-endpoint failures: a 4xx response,
// carrying Intuit's own error code (e.g. "invalid_grant"). Never retried —
// retrying a genuine auth failure won't help and risks tripping rate limits.
export class QboAuthError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'QboAuthError'
    this.code = code
  }
}

// Thrown when there's no stored token at all (never connected, or already
// disconnected).
export class QboNotConnectedError extends Error {
  constructor(message = 'QBO is not connected — visit /api/qbo/connect first.') {
    super(message)
    this.name = 'QboNotConnectedError'
  }
}

// Retries transient failures (network errors, 5xx) with short exponential
// backoff. QboAuthError (a real 4xx auth failure) is never retried.
async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 300): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof QboAuthError || attempt === retries) throw err
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
    }
  }
}

export async function buildAuthorizeUrl(environment: string, clientId: string, redirectUri: string, state: string) {
  const { authorization_endpoint } = await getDiscoveryDocument(environment)
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri,
    state
  })
  return `${authorization_endpoint}?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number // access token lifetime in seconds (~1 hour)
  x_refresh_token_expires_in: number // refresh token lifetime in seconds (~100 days)
}

async function requestToken(environment: string, clientId: string, clientSecret: string, body: URLSearchParams): Promise<TokenResponse> {
  return withRetry(async () => {
    const { token_endpoint } = await getDiscoveryDocument(environment)
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch(token_endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status >= 500) {
        throw new Error(`QBO token request failed (transient): ${res.status} ${JSON.stringify(json)}`)
      }
      throw new QboAuthError(json.error ?? 'unknown_error', `QBO token request failed: ${res.status} ${JSON.stringify(json)}`)
    }
    return json as TokenResponse
  })
}

export function exchangeCodeForTokens(environment: string, clientId: string, clientSecret: string, code: string, redirectUri: string) {
  return requestToken(environment, clientId, clientSecret, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  }))
}

export function refreshTokens(environment: string, clientId: string, clientSecret: string, refreshToken: string) {
  return requestToken(environment, clientId, clientSecret, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }))
}

interface QboTokenRow {
  realm_id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: string
  refresh_token_expires_at: string
}

export function saveTokens(realmId: string, tokens: TokenResponse) {
  const db = useDb()
  const now = new Date()
  const accessExpiresAt = new Date(now.getTime() + tokens.expires_in * 1000).toISOString()
  const refreshExpiresAt = new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString()
  db.prepare(`
    INSERT INTO qbo_tokens (id, realm_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      realm_id = excluded.realm_id,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      access_token_expires_at = excluded.access_token_expires_at,
      refresh_token_expires_at = excluded.refresh_token_expires_at,
      updated_at = excluded.updated_at
  `).run(realmId, tokens.access_token, tokens.refresh_token, accessExpiresAt, refreshExpiresAt, now.toISOString())
}

export function loadTokens(): QboTokenRow | undefined {
  const db = useDb()
  return db.prepare('SELECT * FROM qbo_tokens WHERE id = 1').get() as QboTokenRow | undefined
}

export function clearTokens() {
  const db = useDb()
  db.prepare('DELETE FROM qbo_tokens WHERE id = 1').run()
}

// Revoking either token invalidates both, per Intuit's docs. Best-effort:
// callers should still clear the local row even if this fails (e.g. the
// user already revoked access from within QuickBooks), so a stale token
// never lingers in qbo_tokens either way.
export async function revokeToken(environment: string, clientId: string, clientSecret: string, token: string) {
  await withRetry(async () => {
    const { revocation_endpoint } = await getDiscoveryDocument(environment)
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch(revocation_endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ token })
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      if (res.status >= 500) {
        throw new Error(`QBO token revoke failed (transient): ${res.status} ${JSON.stringify(json)}`)
      }
      throw new QboAuthError(json.error ?? 'unknown_error', `QBO token revoke failed: ${res.status} ${JSON.stringify(json)}`)
    }
  })
}

// Returns a valid access token for the connected company, transparently
// refreshing (and persisting the rotated refresh token) if it's expired or
// close to it. If the refresh token itself has died (expired, revoked, or
// otherwise invalid — QboAuthError), the stale row is cleared so "not
// connected" becomes the single, unambiguous signal callers need to check.
export async function getValidAccessToken(environment: string, clientId: string, clientSecret: string, force = false) {
  const row = loadTokens()
  if (!row) {
    throw new QboNotConnectedError()
  }
  const bufferMs = 2 * 60 * 1000
  if (!force && Date.now() < new Date(row.access_token_expires_at).getTime() - bufferMs) {
    return { accessToken: row.access_token, realmId: row.realm_id }
  }
  try {
    const tokens = await refreshTokens(environment, clientId, clientSecret, row.refresh_token)
    saveTokens(row.realm_id, tokens)
    return { accessToken: tokens.access_token, realmId: row.realm_id }
  } catch (err) {
    if (err instanceof QboAuthError) {
      clearTokens()
    }
    throw err
  }
}

// Calls the QBO Accounting API with a valid access token. `path` receives
// the connected company's realmId, since most QBO endpoints are scoped to
// it. If the token dies between the proactive expiry check above and the
// actual call (clock drift, early revocation), retries once after a forced
// refresh before giving up.
//
// Also captures the `intuit_tid` response header — Intuit's own request ID,
// which their support team asks for when troubleshooting API issues — so
// callers can log and surface it alongside any error.
export async function qboFetch(environment: string, clientId: string, clientSecret: string, path: string | ((realmId: string) => string), init?: RequestInit) {
  const base = qboApiBase(environment)
  const call = async (accessToken: string, realmId: string) => fetch(`${base}${typeof path === 'function' ? path(realmId) : path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  })

  let { accessToken, realmId } = await getValidAccessToken(environment, clientId, clientSecret)
  let res = await call(accessToken, realmId)
  if (res.status === 401) {
    ;({ accessToken } = await getValidAccessToken(environment, clientId, clientSecret, true))
    res = await call(accessToken, realmId)
  }
  return { res, realmId, intuitTid: res.headers.get('intuit_tid') }
}

// QBO's Reports API (and some other v3 endpoints) can return a 200 OK with
// a `Fault` object in the body instead of a 4xx/5xx — a real quirk verified
// against the live sandbox (a malformed report date returns HTTP 200 with
// `{ Fault: { type: "SystemFault", ... } }`). Callers must check this
// alongside `res.ok`, not instead of it — some faults are real 4xx too.
export function qboFaultType(body: unknown): string | null {
  const fault = (body as { Fault?: { type?: string } } | undefined)?.Fault
  return fault ? (fault.type ?? 'Fault') : null
}

// Logs a QBO API failure with enough context to hand to Intuit support
// (intuit_tid, endpoint, status, response body), and returns a createError
// carrying the same info in `data` so it also reaches the client/caller.
export function logAndWrapQboError(context: string, res: Response, body: unknown, intuitTid: string | null) {
  const faultType = qboFaultType(body)
  // A Fault body with a 2xx status is still a real error — report it as one
  // rather than passing QBO's misleading 200 through.
  const statusCode = res.ok && faultType ? 502 : res.status
  console.error(`QBO API error [${context}]: status=${res.status}${faultType ? ` fault=${faultType}` : ''} intuit_tid=${intuitTid ?? 'none'} body=${JSON.stringify(body)}`)
  return createError({
    statusCode,
    statusMessage: `${context} failed: ${JSON.stringify(body)}`,
    data: { intuitTid }
  })
}
