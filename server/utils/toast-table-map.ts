// Resolves a Toast order's opaque table.guid to one of capacity_areas' 5
// real dining areas, so per-area actual covers/revenue can be computed
// (server/utils/toast-metrics-sync.ts) alongside the existing whole-
// restaurant covers/labor-hours sync. Needs Toast's Configuration API
// scope (`/config/v2/tables`), which 403'd under the original TOAST_*
// credential — granted 2026-08-13 specifically to unblock this.
//
// Classifies by the restaurant's own table-*naming* convention (confirmed
// directly by the user against the real Cambridge St. floor plan), not
// Toast's own RevenueCenter field on /config/v2/tables — verified live
// that RevenueCenter is a worse signal here: it groups Bar and Salon
// tables into a single "Bar" center, and misfiles table "C2" under
// "Dining Room" instead of "Chef's Counter" (a real, confirmed
// misconfiguration in Toast's own admin setup, not a bug in this code).
//
//   Dining Room: 1-19 (banquette 1-7 + 20s... see NUMERIC_RANGES) and 20s
//   Salon:       30s and 40s
//   Outdoor:     50s
//   Bar:         B<n>
//   Chef's Counter: C<n>
//
// capacity_areas.name values are lowercase ('dining room', 'bar', etc.) —
// see schema.sql / scripts/import-capacity-projections.mjs.
const NUMERIC_RANGES: { min: number; max: number; area: string }[] = [
  { min: 1, max: 19, area: 'dining room' }, // banquette 1-7 (8-19 unused today, grouped with it rather than left unclassified)
  { min: 20, max: 29, area: 'dining room' },
  { min: 30, max: 49, area: 'salon' },
  { min: 50, max: 59, area: 'outdoor' }
]

export function classifyTableName(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (/^B\d+$/i.test(trimmed)) return 'bar'
  if (/^C\d+$/i.test(trimmed)) return 'chefs counter'
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    const match = NUMERIC_RANGES.find(r => n >= r.min && n <= r.max)
    return match?.area ?? null
  }
  return null
}

interface ToastCredentials {
  apiHostname: string
  clientId: string
  clientSecret: string
  restaurantGuid: string
}

interface ToastTableConfig {
  guid: string
  name: string
}

// Table config changes rarely (a physical floor plan), so cache per
// restaurantGuid for the process lifetime rather than re-fetching on every
// sync — mirrors toast.ts's own tokenCache pattern. No TTL/refresh: a
// mid-process table rename/add would need a restart to pick up, an
// acceptable tradeoff given how infrequently this actually changes.
const tableMapCache = new Map<string, Map<string, string | null>>()

export async function getTableAreaMap(creds: ToastCredentials): Promise<Map<string, string | null>> {
  const cached = tableMapCache.get(creds.restaurantGuid)
  if (cached) return cached

  const res = await toastFetch(creds, '/config/v2/tables')
  if (!res.ok) {
    throw new Error(`Toast Config API request failed [/config/v2/tables]: ${res.status} ${await res.text()}`)
  }
  const tables = await res.json() as ToastTableConfig[]
  const map = new Map<string, string | null>()
  const unclassified = new Set<string>()
  for (const t of tables) {
    const area = classifyTableName(t.name)
    map.set(t.guid, area)
    if (!area) unclassified.add(t.name)
  }
  if (unclassified.size > 0) {
    console.warn(`getTableAreaMap: ${unclassified.size} Toast table(s) didn't match a known naming pattern, excluded from per-area metrics: ${[...unclassified].join(', ')}`)
  }
  tableMapCache.set(creds.restaurantGuid, map)
  return map
}
