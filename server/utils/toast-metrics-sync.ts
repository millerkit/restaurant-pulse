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
  deleted: boolean
  numberOfGuests: number | null
}

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
    .reduce((sum, o) => sum + (o.numberOfGuests ?? 0), 0)

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
