// OAuth2 + API helpers for QuickBooks Online. The authorize/token endpoints
// are the same for sandbox and production — only the accounting API base
// URL differs (see qboApiBase), which is why `environment` is only needed
// there.
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
const SCOPE = 'com.intuit.quickbooks.accounting'

export function qboApiBase(environment: string) {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri,
    state
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number // access token lifetime in seconds (~1 hour)
  x_refresh_token_expires_in: number // refresh token lifetime in seconds (~100 days)
}

async function requestToken(clientId: string, clientSecret: string, body: URLSearchParams): Promise<TokenResponse> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
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
    throw new Error(`QBO token request failed: ${res.status} ${JSON.stringify(json)}`)
  }
  return json as TokenResponse
}

export function exchangeCodeForTokens(clientId: string, clientSecret: string, code: string, redirectUri: string) {
  return requestToken(clientId, clientSecret, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  }))
}

export function refreshTokens(clientId: string, clientSecret: string, refreshToken: string) {
  return requestToken(clientId, clientSecret, new URLSearchParams({
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
export async function revokeToken(clientId: string, clientSecret: string, token: string) {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(REVOKE_URL, {
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
    throw new Error(`QBO token revoke failed: ${res.status} ${JSON.stringify(json)}`)
  }
}

// Returns a valid access token for the connected company, transparently
// refreshing (and persisting the rotated refresh token) if it's expired
// or close to it.
export async function getValidAccessToken(clientId: string, clientSecret: string) {
  const row = loadTokens()
  if (!row) {
    throw new Error('QBO is not connected yet — visit /api/qbo/connect first.')
  }
  const bufferMs = 2 * 60 * 1000
  if (Date.now() < new Date(row.access_token_expires_at).getTime() - bufferMs) {
    return { accessToken: row.access_token, realmId: row.realm_id }
  }
  const tokens = await refreshTokens(clientId, clientSecret, row.refresh_token)
  saveTokens(row.realm_id, tokens)
  return { accessToken: tokens.access_token, realmId: row.realm_id }
}
