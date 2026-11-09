// Who can see what (phase 2 of the 2026-11 UI cleanup). One definition shared by
// the server (server/middleware/auth.ts enforces it on every page and API request)
// and the app (nav filtering, client route guard) so the two can't drift apart.
//
// Roles:
//   owner   - everything, including Settings and every write.
//   gm      - read-only: This Week, Daily Results (sales view), Covers & Spend, Seasonal
//             Trends, Kitchen Hours & Cost with dollars (Executive Chef pay still withheld).
//   kitchen - read-only: Kitchen Hours & Cost, percentages and hours only (forced
//             server-side, see server/api/kitchen-labor.get.ts).
// Default deny: anything not listed here is owner-only.

export type Role = 'owner' | 'gm' | 'kitchen'
export const ROLES: Role[] = ['owner', 'gm', 'kitchen']
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner (everything)',
  gm: 'General Manager',
  kitchen: 'Kitchen (Sous Chef)'
}

const PAGES: Record<Exclude<Role, 'owner'>, string[]> = {
  gm: ['/', '/pl/revenue-calendar', '/capacity', '/historical', '/kitchen-labor'],
  kitchen: ['/kitchen-labor']
}

// Read-only API prefixes (matched exactly or as a path prefix). Anything with a
// method other than GET/HEAD is denied unless listed in API_WRITES.
const COMMON_GET = ['/api/me', '/api/sync-status']
const API_GET: Record<Exclude<Role, 'owner'>, string[]> = {
  gm: [
    ...COMMON_GET,
    '/api/dashboard', '/api/booking-pace', '/api/pl', '/api/capacity',
    '/api/kitchen-labor'
  ],
  kitchen: [...COMMON_GET, '/api/kitchen-labor']
}
// The "Sync now" button in the page header.
const API_WRITES = ['/api/qbo/sync']

function norm(p: string) {
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}
function matches(path: string, list: string[]) {
  return list.some(x => path === x || path.startsWith(`${x}/`))
}

export function roleCanViewPage(role: Role, path: string, tab?: string | null): boolean {
  if (role === 'owner') return true
  const p = norm(path)
  // The Planning > Capacity entry is the same route with ?tab=edit.
  if (p === '/capacity' && tab === 'edit') return false
  return PAGES[role].includes(p)
}

export function roleCanCallApi(role: Role, path: string, method: string): boolean {
  if (role === 'owner') return true
  const p = norm(path)
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return matches(p, API_GET[role])
  return m === 'POST' && API_WRITES.includes(p)
}

export function roleHome(role: Role): string {
  return role === 'kitchen' ? '/kitchen-labor' : '/'
}
