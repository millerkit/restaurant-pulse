// One-off check: does the existing Toast API client (provisioned for the
// Urban Hearth e-commerce site) have Orders/Labor API scope, or only the
// narrower scope it was originally set up for? Run with:
//   node --env-file=.env.local scripts/toast-scope-check.mjs
// Not part of the app — delete once the answer is known.

const { TOAST_API_HOSTNAME, TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID } = process.env
if (!TOAST_API_HOSTNAME || !TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET || !TOAST_RESTAURANT_GUID) {
  console.error('Missing one of TOAST_API_HOSTNAME / TOAST_CLIENT_ID / TOAST_CLIENT_SECRET / TOAST_RESTAURANT_GUID in the environment.')
  process.exit(1)
}
const HOST = TOAST_API_HOSTNAME

async function login() {
  const res = await fetch(`${HOST}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: TOAST_CLIENT_ID,
      clientSecret: TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT'
    })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(body)}`)
  }
  return body.token.accessToken
}

async function checkEndpoint(name, path) {
  const token = await login()
  const res = await fetch(`${HOST}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': TOAST_RESTAURANT_GUID
    }
  })
  const status = res.status
  let detail = ''
  if (!res.ok) {
    const body = await res.text()
    detail = ` — ${body.slice(0, 200)}`
  }
  const verdict = status === 200 ? 'OK — scope present' : status === 401 ? 'UNAUTHORIZED (bad token/auth)' : status === 403 ? 'FORBIDDEN (no scope for this API)' : 'UNEXPECTED'
  console.log(`${name}: HTTP ${status} — ${verdict}${detail}`)
}

const today = new Date()
today.setDate(today.getDate() - 1)
const businessDate = today.toISOString().slice(0, 10).replace(/-/g, '')

try {
  console.log('Authenticating...')
  await login()
  console.log('Auth OK. Checking API scopes...\n')
  await checkEndpoint('Orders API', `/orders/v2/ordersBulk?businessDate=${businessDate}`)
  await checkEndpoint('Labor API (time entries, labor:read)', `/labor/v1/timeEntries?businessDate=${businessDate}`)
  await checkEndpoint('Labor API (employees, labor.employees:read)', `/labor/v1/employees?pageSize=1`)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
