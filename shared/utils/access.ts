// Who can see what (phase 2 of the 2026-11 UI cleanup). One definition shared by
// the server (server/middleware/auth.ts enforces it on every page and API request)
// and the app (nav filtering, client route guard) so the two can't drift apart.
//
// Roles:
//   owner   - everything, including Settings and every write.
//   gm      - read-only: This Week (with cost pace and budget runway), Daily Results (sales and
//             profit views), Covers & Spend, Seasonal Trends, Budget Check, Kitchen Hours & Cost
//             with dollars. Owner compensation is withheld server-side (see the redactions).
//   kitchen - read-only: This Week for the kitchen (covers and bookings only, /kitchen-week) and
//             Kitchen Hours & Cost, percentages and hours only (forced server-side, see
//             server/api/kitchen-labor.get.ts). Kitchen is deliberately NOT allowed on
//             /api/dashboard or /api/booking-pace (they carry dollar goals, budgets, special-night
//             revenue); /api/kitchen-week selects only covers, so there is nothing to redact.
// Default deny: anything not listed here is owner-only.

export type Role = 'owner' | 'gm' | 'kitchen'
export const ROLES: Role[] = ['owner', 'gm', 'kitchen']
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner (everything)',
  gm: 'General Manager',
  kitchen: 'Kitchen (Sous Chef)'
}

const PAGES: Record<Exclude<Role, 'owner'>, string[]> = {
  gm: ['/', '/pl/revenue-calendar', '/capacity', '/historical', '/kitchen-labor', '/budget'],
  kitchen: ['/kitchen-week', '/kitchen-labor']
}

// Read-only API prefixes (matched exactly or as a path prefix). Anything with a
// method other than GET/HEAD is denied unless listed in API_WRITES.
const COMMON_GET = ['/api/me', '/api/sync-status']
const API_GET: Record<Exclude<Role, 'owner'>, string[]> = {
  gm: [
    ...COMMON_GET,
    '/api/dashboard', '/api/booking-pace', '/api/pl', '/api/capacity',
    '/api/kitchen-labor', '/api/nightly-margin',
    // Budget Check
    '/api/budget/targets', '/api/budget/actuals', '/api/budget/overspending-detail'
  ],
  kitchen: [...COMMON_GET, '/api/kitchen-labor', '/api/kitchen-week']
}
// Writes a non-owner may make: the "Sync now" button in the page header (not for the Sous Chef,
// 2026-11-09), and /api/view-as, whose handler itself only honors a real owner.
const API_WRITES: Record<Exclude<Role, 'owner'>, string[]> = {
  gm: ['/api/qbo/sync', '/api/view-as'],
  kitchen: ['/api/view-as']
}

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
  return m === 'POST' && API_WRITES[role].includes(p)
}

export function roleHome(role: Role): string {
  return role === 'kitchen' ? '/kitchen-week' : '/'
}
