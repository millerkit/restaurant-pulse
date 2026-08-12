// Pulls a business date's covers (guest count) and labor hours from Toast
// POS and upserts into daily_toast_metrics. See schema.sql for why these
// two specific fields were chosen (order-level numberOfGuests, not the
// check-level field which came back null on every check in a live
// spot-check; regularHours + overtimeHours from Toast's own time-entry
// computation, not a manual clock-in/out diff).

interface ToastCredentials {
  apiHostname: string
  clientId: string
  clientSecret: string
  restaurantGuid: string
}

interface ToastCheck {
  voided: boolean
  totalAmount: number | null
}

interface ToastOrder {
  guid: string
  deleted: boolean
  numberOfGuests: number | null
  openedDate: string
  table: { guid: string } | null
  checks: ToastCheck[]
}

// Urban Hearth is dinner-only; a daytime pop-up/market event (confirmed by
// the user, e.g. 2025-01-19: 39 separate orders between 11:59am-3:48pm,
// every one a guests=1 stub from a single server, no evening orders at all)
// still creates real Toast orders and shouldn't count as dinner covers.
// Orders opened before 5pm local are excluded entirely — verified against
// a real sample of normal dinner nights first: pre-5pm activity on those
// days is 0-3 stray guests=1 orders (gift cards, not seated guests), so the
// cutoff costs a real dinner night essentially nothing while correctly
// zeroing out an all-daytime day like 2025-01-19 (which previously
// inflated that day's covers to 39, on par with a real dinner night).
// 5pm, not midnight — matches the user's own stated rule ("ignore anything
// that happened before 5pm... unlikely they could have been seated early
// enough to order anything by then").
const MIN_DINNER_HOUR_LOCAL = 17
const RESTAURANT_TIME_ZONE = 'America/New_York' // see nuxt.config.ts's own confirmation of this
function isDinnerHour(openedDateIso: string): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: RESTAURANT_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date(openedDateIso)))
  return hour >= MIN_DINNER_HOUR_LOCAL
}

// A single order's numberOfGuests above this is treated as a data-entry
// error, not a real party size — verified against real order history
// (both the live API and a manually exported CSV covering 2025-2026): real
// guest counts top out at 28 (a large private party), then jump straight
// to 133/788 on a handful of otherwise-normal seated orders (same table,
// same real check total) with no service in between — a staff fat-finger,
// not a genuinely large party. Excluded from the covers sum entirely
// (there's no way to recover the intended value), not clamped to some
// guess, and logged so a real large future party isn't silently dropped
// without a trace.
const MAX_PLAUSIBLE_GUESTS_PER_ORDER = 50

interface ToastTimeEntry {
  regularHours: number | null
  overtimeHours: number | null
}

// Both ordersBulk and timeEntries are paginated (max pageSize 100); this
// restaurant sees well under 100 orders/entries a day today, but paginate
// generically rather than assume that stays true.
async function fetchAllPages<T>(creds: ToastCredentials, path: string, businessDate: string): Promise<T[]> {
  const results: T[] = []
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const res = await toastFetch(creds, `${path}${sep}businessDate=${businessDate}&page=${page}&pageSize=100`)
    if (!res.ok) {
      throw new Error(`Toast API request failed [${path}]: ${res.status} ${await res.text()}`)
    }
    const body = await res.json() as T[]
    if (!Array.isArray(body) || body.length === 0) break
    results.push(...body)
    if (body.length < 100) break
  }
  return results
}

function toBusinessDateParam(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

export async function syncToastMetricsForDate(creds: ToastCredentials, isoDate: string) {
  const businessDate = toBusinessDateParam(isoDate)

  const orders = await fetchAllPages<ToastOrder>(creds, '/orders/v2/ordersBulk', businessDate)
  const dinnerOrders = orders.filter(o => !o.deleted && isDinnerHour(o.openedDate))
  const covers = dinnerOrders
    .reduce((sum, o) => {
      const guests = o.numberOfGuests ?? 0
      if (guests > MAX_PLAUSIBLE_GUESTS_PER_ORDER) {
        console.warn(`syncToastMetricsForDate: dropping implausible numberOfGuests=${guests} on order ${o.guid} (${businessDate}) — treating as a data-entry error, not counted toward covers.`)
        return sum
      }
      return sum + guests
    }, 0)

  const timeEntries = await fetchAllPages<ToastTimeEntry>(creds, '/labor/v1/timeEntries', businessDate)
  const laborHours = timeEntries
    .reduce((sum, te) => sum + (te.regularHours ?? 0) + (te.overtimeHours ?? 0), 0)

  const db = useDb()
  db.prepare(`
    INSERT INTO daily_toast_metrics (date, covers, labor_hours, synced_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (date) DO UPDATE SET
      covers = excluded.covers,
      labor_hours = excluded.labor_hours,
      synced_at = excluded.synced_at
  `).run(isoDate, covers, laborHours, new Date().toISOString())

  // Per-area breakdown — see toast-table-map.ts. Reuses the same
  // dinnerOrders (already deleted/dinner-hour filtered) rather than a
  // second Toast API call. Orders with no table (deleted/gift-card/API
  // orders, per the live spot-check in toast-table-map.ts) or a table
  // whose name didn't match a known area pattern are excluded from the
  // per-area sums but still counted in the whole-restaurant covers above.
  const areaMap = await getTableAreaMap(creds)
  const areaIds = new Map(db.prepare('SELECT id, name FROM capacity_areas').all().map((r: any) => [r.name, r.id]))
  const perArea = new Map<string, { covers: number; revenue: number }>()
  for (const o of dinnerOrders) {
    const areaName = o.table ? areaMap.get(o.table.guid) : null
    if (!areaName) continue
    const guests = o.numberOfGuests ?? 0
    if (guests > MAX_PLAUSIBLE_GUESTS_PER_ORDER) continue
    const checkTotal = (o.checks ?? []).filter(c => !c.voided).reduce((sum, c) => sum + (c.totalAmount ?? 0), 0)
    const entry = perArea.get(areaName) ?? { covers: 0, revenue: 0 }
    entry.covers += guests
    entry.revenue += checkTotal
    perArea.set(areaName, entry)
  }
  const upsertArea = db.prepare(`
    INSERT INTO daily_toast_area_metrics (date, area_id, covers, revenue, synced_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (date, area_id) DO UPDATE SET
      covers = excluded.covers,
      revenue = excluded.revenue,
      synced_at = excluded.synced_at
  `)
  const syncedAt = new Date().toISOString()
  for (const [areaName, { covers: areaCovers, revenue }] of perArea) {
    const areaId = areaIds.get(areaName)
    if (areaId == null) continue
    upsertArea.run(isoDate, areaId, areaCovers, revenue, syncedAt)
  }

  return { covers, laborHours }
}
