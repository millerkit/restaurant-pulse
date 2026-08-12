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

interface ToastOrder {
  guid: string
  deleted: boolean
  numberOfGuests: number | null
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
  const covers = orders
    .filter(o => !o.deleted)
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

  return { covers, laborHours }
}
