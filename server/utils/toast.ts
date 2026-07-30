// Auth + API helpers for Toast POS. Much simpler than QBO's OAuth flow
// (server/utils/qbo.ts): Toast uses a machine-client login (client
// id/secret in, short-lived bearer token out) rather than a
// authorize/exchange/refresh-token dance, so there's no persisted token
// row — just an in-memory cache of the current access token.

interface ToastLoginResponse {
  token: {
    accessToken: string
    expiresIn: number // seconds, ~1 hour per Toast's docs
  }
}

// Thrown for real (non-transient) auth failures — bad client id/secret, or
// a 403 (credentials valid but lacking scope for the called endpoint).
// Never retried.
export class ToastAuthError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ToastAuthError'
    this.status = status
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 300): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof ToastAuthError || attempt === retries) throw err
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
    }
  }
}

interface ToastCredentials {
  apiHostname: string
  clientId: string
  clientSecret: string
  restaurantGuid: string
}

// Cached per clientId so a stale test/sandbox credential swap can't reuse
// another credential's token. Cleared implicitly by expiry, not manually —
// there's no "disconnect" flow for a machine client the way there is for
// QBO's user-granted OAuth.
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()

async function login(creds: ToastCredentials): Promise<string> {
  return withRetry(async () => {
    const res = await fetch(`${creds.apiHostname}/authentication/v1/authentication/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        userAccessType: 'TOAST_MACHINE_CLIENT'
      })
    })
    const body = await res.json().catch(() => ({})) as Partial<ToastLoginResponse>
    if (!res.ok) {
      if (res.status >= 500) {
        throw new Error(`Toast login failed (transient): ${res.status} ${JSON.stringify(body)}`)
      }
      throw new ToastAuthError(res.status, `Toast login failed: ${res.status} ${JSON.stringify(body)}`)
    }
    if (!body.token) {
      throw new ToastAuthError(res.status, `Toast login response missing token: ${JSON.stringify(body)}`)
    }
    return body.token.accessToken
  })
}

// 2-minute buffer before expiry, matching qbo.ts's getValidAccessToken.
async function getValidAccessToken(creds: ToastCredentials, force = false): Promise<string> {
  const cached = tokenCache.get(creds.clientId)
  const bufferMs = 2 * 60 * 1000
  if (!force && cached && Date.now() < cached.expiresAt - bufferMs) {
    return cached.accessToken
  }
  const accessToken = await login(creds)
  // expiresIn isn't captured above (login() only returns the token string);
  // Toast's own docs put it at ~1 hour, so cache conservatively at 55
  // minutes rather than trusting an assumed constant beyond that.
  tokenCache.set(creds.clientId, { accessToken, expiresAt: Date.now() + 55 * 60 * 1000 })
  return accessToken
}

// Calls a Toast API endpoint with a valid access token, retrying once
// after a forced re-login if the cached token was rejected (401) — mirrors
// qboFetch's handling of a token that dies between the proactive expiry
// check and the actual request.
export async function toastFetch(creds: ToastCredentials, path: string, init?: RequestInit) {
  const call = async (accessToken: string) => fetch(`${creds.apiHostname}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
      'Toast-Restaurant-External-ID': creds.restaurantGuid
    }
  })

  let accessToken = await getValidAccessToken(creds)
  let res = await call(accessToken)
  if (res.status === 401) {
    accessToken = await getValidAccessToken(creds, true)
    res = await call(accessToken)
  }
  return res
}
