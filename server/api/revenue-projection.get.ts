// Night-by-night core dine-in revenue projection for one month (added 2026-11-05),
// used by the Revenue tab's current-month "Projected" column. See CLAUDE.md's
// "Night-by-night revenue projection" section for the backtest behind it.
//
// projected = core revenue already synced this month
//           + for each remaining operating night (Tue–Sun):
//               a dated special night  → its entered expected core revenue (buyout amount, $0 if closed/off-site)
//               otherwise              → that weekday's average core revenue over its last 6 ordinary open nights
//                                        + (within 3 days of the latest OpenTable upload) the booking-pace
//                                          covers adjustment × that weekday's revenue per cover
//
// Core dine-in only (CORE_REVENUE_ACCOUNT_NUMBERS); event/catering/retail keep the
// Revenue tab's existing budget-floor projection.
import { CORE_REVENUE_ACCOUNT_NUMBERS, MIN_COVERS_FOR_OPEN_DAY, excludeSpendOutliers } from '../utils/core-revenue'
import { NEW_LOCATION_START } from '../utils/weekly-targets'
import { computeBookingPace } from '../utils/booking-pace'
import { loadSpecialNights } from '../utils/special-nights'

const SAME_WEEKDAY_HISTORY = 6
const MIN_HISTORY = 3

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const pad = (n: number) => String(n).padStart(2, '0')

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const year = Number(q.year)
  const month = Number(q.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'year and month are required' })
  }
  const db = useDb()
  const monthStart = `${year}-${pad(month)}-01`
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)

  const { date: lastSynced } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  const knownThrough = lastSynced && lastSynced >= monthStart ? (lastSynced < monthEnd ? lastSynced : monthEnd) : null
  const firstRemaining = knownThrough ? addDays(knownThrough, 1) : monthStart

  const placeholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
  const coreByDate = new Map((db.prepare(`
    SELECT dli.date, SUM(dli.amount) AS revenue
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number IN (${placeholders}) AND dli.date >= ? AND dli.date <= ?
    GROUP BY dli.date
  `).all(...CORE_REVENUE_ACCOUNT_NUMBERS, NEW_LOCATION_START, monthEnd) as { date: string, revenue: number }[])
    .map(r => [r.date, r.revenue]))

  let actualCoreToDate = 0
  if (knownThrough) {
    for (const [d, v] of coreByDate) if (d >= monthStart && d <= knownThrough) actualCoreToDate += v
  }

  // History: ordinary open nights before the first night being projected. Special nights
  // (buyouts, closures, events) and spend outliers are left out so they can't skew a
  // weekday's normal night.
  const specialInHistory = loadSpecialNights(db, NEW_LOCATION_START, monthEnd)
  const coversRows = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date >= ? AND date < ?')
    .all(NEW_LOCATION_START, firstRemaining) as { date: string, covers: number }[]
  const candidates = coversRows
    .map(r => ({ date: r.date, covers: r.covers, revenue: coreByDate.get(r.date) ?? 0 }))
    .filter(r => r.covers >= MIN_COVERS_FOR_OPEN_DAY && r.revenue > 0 && !specialInHistory.has(r.date))
  const { kept: history, excluded } = excludeSpendOutliers(candidates)
  history.sort((a, b) => a.date.localeCompare(b.date))

  function weekdayNormal(d: string) {
    const same = history.filter(h => dow(h.date) === dow(d)).slice(-SAME_WEEKDAY_HISTORY)
    if (same.length < MIN_HISTORY) return null
    const revenue = same.reduce((s, h) => s + h.revenue, 0) / same.length
    const covers = same.reduce((s, h) => s + h.covers, 0) / same.length
    return { revenue, revenuePerCover: covers > 0 ? revenue / covers : 0, nights: same.length }
  }

  const pace = computeBookingPace(db)
  const paceByDate = new Map(pace.available ? pace.nights.map(n => [n.date, n]) : [])

  const nights = []
  for (let d = firstRemaining; d <= monthEnd; d = addDays(d, 1)) {
    if (dow(d) === 1) continue // closed Mondays
    const special = specialInHistory.get(d) ?? null
    const normal = weekdayNormal(d)
    if (special) {
      nights.push({ date: d, expected: special.expectedRevenue, normalRevenue: normal?.revenue ?? null, bookingAdjustment: 0, special })
      continue
    }
    let bookingAdjustment = 0
    const p = paceByDate.get(d)
    if (normal && p && p.estimate != null && p.weekdayAvgCovers != null) {
      bookingAdjustment = (p.estimate - p.weekdayAvgCovers) * normal.revenuePerCover
    }
    nights.push({
      date: d,
      expected: normal ? Math.max(0, normal.revenue + bookingAdjustment) : null,
      normalRevenue: normal?.revenue ?? null,
      bookingAdjustment,
      special: null
    })
  }

  const missingHistory = nights.filter(n => n.expected == null).length
  const remainingTotal = nights.reduce((s, n) => s + (n.expected ?? 0), 0)
  return {
    year,
    month,
    knownThrough,
    actualCoreToDate,
    remainingTotal,
    projectedCoreTotal: actualCoreToDate + remainingTotal,
    // Any night with too little same-weekday history to project leaves the total
    // incomplete; the client falls back to its old method when this is nonzero.
    missingHistory,
    excludedOutliers: excluded,
    bookingSnapshot: pace.available ? { date: pace.snapshotDate, time: pace.snapshotTime } : null,
    nights
  }
})
