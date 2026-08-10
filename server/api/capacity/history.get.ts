// Historical seasonality reference, derived from real QBO revenue history —
// backs the Capacity Pace page's year-over-year weekly chart and the Edit
// Capacity page's "Set by History" action (added 2026-08-10, after the user
// asked how prior years' actual seasonal fluctuation could inform the
// monthly expected-covers assumptions without turning Edit Capacity's
// editable grain into a 5-area × 52-week grid).
//
// Restricted to core dine-in food/beverage accounts only (4000 Restaurant
// Sales, 4010 Food, 4020 Beverage, 4022/4024/4026/4028 Beer/Liquor/Wine/
// Non-Alcoholic) — matched by account_number, never a raw id (see
// CLAUDE.md's local/prod account-drift section). Event Sales (4100s),
// Catering (4200s), Retail (4300s), and Other Service Income (4400) are
// deliberately excluded: verified against real production data that a
// revenue-based seasonality check including those swings with sporadic
// private-event bookings rather than real dine-in demand — e.g. a single
// offsite-buyout closure day showed up as a "slow week" in total revenue
// when the restaurant's own dining room hadn't actually slowed down at all.
const CORE_REVENUE_ACCOUNT_NUMBERS = ['4000', '4010', '4020', '4022', '4024', '4026', '4028']

// A day's core revenue below this counts as "closed" (a full-restaurant
// closure — a private buyout, a holiday, or the standing weekly closure —
// not just a slow night). Verified against the real distribution rather
// than guessed: every non-service day landed at $252 or below (mostly
// exactly $0, a few tiny stray postings), while the lowest *real* service
// day was $585 — a clean gap, so 300 cleanly separates the two without
// risking miscounting a genuinely slow but real service night as closed.
const CLOSED_DAY_THRESHOLD = 300
// A month needs at least this many open days in a given year to produce a
// trustworthy per-open-day average — guards against a month that's mostly
// outside the data window (e.g. 2024's history starts mid-July) being
// treated as a real, if extreme, data point.
const MIN_OPEN_DAYS_FOR_MONTH_INDEX = 3

type DailyRevenueRow = { date: string, revenue: number }

// Standard ISO-8601 week algorithm (Thursday-of-the-week trick) — UTC-based
// so this is deterministic regardless of the server's own timezone, same
// posture as capacity.get.ts's isOperatingDow.
function isoWeekInfo(dateIso: string): { isoYear: number, isoWeek: number, mondayIso: string } {
  const d = new Date(`${dateIso}T00:00:00Z`)
  const dayNum = d.getUTCDay() || 7 // Mon=1..Sun=7
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const isoYear = thursday.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const isoWeek = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - dayNum + 1)
  return { isoYear, isoWeek, mondayIso: monday.toISOString().slice(0, 10) }
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export default defineEventHandler(() => {
  const db = useDb()
  const placeholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT dli.date as date, SUM(dli.amount) as revenue
    FROM daily_line_items dli
    JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number IN (${placeholders}) AND a.is_active = 1
    GROUP BY dli.date
    ORDER BY dli.date
  `).all(...CORE_REVENUE_ACCOUNT_NUMBERS) as DailyRevenueRow[]

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_line_items').get() as { date: string | null }
  if (!asOfDate || rows.length === 0) {
    return { asOfYear: null, historicalYears: [], currentYear: null, monthlyIndex: [], weeklySeries: [] }
  }
  const asOfYear = Number(asOfDate.slice(0, 4))

  type YearAgg = {
    openDays: { date: string, revenue: number, month: number, isoWeek: number, mondayIso: string }[]
  }
  const byYear = new Map<number, YearAgg>()
  for (const r of rows) {
    if (r.revenue < CLOSED_DAY_THRESHOLD) continue // a closure, not a slow night — see CLOSED_DAY_THRESHOLD above
    const year = Number(r.date.slice(0, 4))
    const month = Number(r.date.slice(5, 7))
    const { isoWeek, mondayIso } = isoWeekInfo(r.date)
    if (!byYear.has(year)) byYear.set(year, { openDays: [] })
    byYear.get(year)!.openDays.push({ date: r.date, revenue: r.revenue, month, isoWeek, mondayIso })
  }

  const allYears = [...byYear.keys()].sort((a, b) => a - b)
  // Only the single most recent prior year — simplified 2026-08-10 at the
  // user's request after seeing the real chart in production: a 2024 line
  // (already the noisier, partial-year one — see CLOSED_DAY_THRESHOLD
  // comment's own history) added visual clutter without changing the
  // read, and a straight "this year vs. last year" comparison is simpler
  // to reason about than an equal-weighted multi-year average. Both
  // monthlyIndex and the chart's weeklySeries derive from this same list,
  // so they can't drift out of sync with each other.
  const priorYears = allYears.filter(y => y < asOfYear)
  const historicalYears = priorYears.length > 0 ? [priorYears[priorYears.length - 1]] : []

  function yearOpenDayAvg(year: number): number | null {
    const days = byYear.get(year)?.openDays ?? []
    if (days.length === 0) return null
    return days.reduce((sum, d) => sum + d.revenue, 0) / days.length
  }

  // 2026 specifically spans a real location move: the old (smaller)
  // location closed 2026-05-30, and the new (larger) location's real
  // opening was 2026-06-20 (a Jun 16-19 friends & family preview
  // generated no meaningful revenue) — confirmed directly by the user
  // after the first version of this chart showed a misleading "sudden
  // steep increase" in June that was really just the location switch, not
  // organic growth. A single whole-year per-open-day average blends two
  // operationally different periods — understating the new location's
  // real pace (pulled down by five months of the smaller old location)
  // and overstating the old location's own (pulled up by the new
  // location's higher per-night revenue). Hand-verified against the exact
  // dates the user gave, not a generic multi-segment mechanism — no other
  // year has this problem, so this stays a one-off constant rather than
  // a reusable "location periods" table. Only affects weeklySeries below
  // (2026 is never in historicalYears/monthlyIndex — see above).
  const LOCATION_MOVE_PERIODS: { start: string, end: string }[] = [
    { start: '2026-01-01', end: '2026-05-31' },
    { start: '2026-06-20', end: '2026-12-31' }
  ]
  // Per-day period average for the move year; every other year just gets
  // its own single whole-year average back regardless of the date asked
  // about. A date that falls in neither window (2026-06-01 through
  // 2026-06-19, the real closure/transition gap) returns null — callers
  // skip those days/weeks entirely rather than attributing them to either
  // period, which is also what creates the chart's visual break between
  // the two locations instead of a misleading connecting line.
  function periodAvgFor(year: number, dateIso: string): number | null {
    if (year !== 2026) return yearOpenDayAvg(year)
    const period = LOCATION_MOVE_PERIODS.find(p => dateIso >= p.start && dateIso <= p.end)
    if (!period) return null
    const days = (byYear.get(year)?.openDays ?? []).filter(d => d.date >= period.start && d.date <= period.end)
    if (days.length === 0) return null
    return days.reduce((sum, d) => sum + d.revenue, 0) / days.length
  }

  // ---- Monthly index (for Edit Capacity's "Set by History") -------------
  // That month's per-open-day average ÷ the prior year's own annual
  // per-open-day average — indexed to that year's own average (not raw
  // dollars) so a year with materially higher revenue (the 2026 location
  // move) doesn't distort the comparison. Written as a loop over
  // historicalYears (usually just one — see above) rather than a single
  // year lookup so this still degrades gracefully (no index for a month
  // with too little data that year) without special-casing the single-year
  // case.
  const monthlyIndex = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const perYear: { year: number, indexPct: number }[] = []
    for (const year of historicalYears) {
      const yAvg = yearOpenDayAvg(year)
      if (yAvg == null) continue
      const monthDays = (byYear.get(year)?.openDays ?? []).filter(d => d.month === month)
      if (monthDays.length < MIN_OPEN_DAYS_FOR_MONTH_INDEX) continue
      const monthAvg = monthDays.reduce((sum, d) => sum + d.revenue, 0) / monthDays.length
      perYear.push({ year, indexPct: (monthAvg / yAvg) * 100 })
    }
    const indexPct = perYear.length > 0 ? perYear.reduce((sum, p) => sum + p.indexPct, 0) / perYear.length : null
    return { month, indexPct, years: perYear.map(p => p.year) }
  })

  // ---- Weekly series (for the Capacity Pace chart) -----------------------
  // Includes historical years plus the current year to date, so the current
  // year can be overlaid against prior years' shape — the current year is
  // never included in monthlyIndex above (it's the year being forecast, and
  // for 2026 specifically it also spans the location move, which would
  // contaminate a same-year baseline).
  const chartYears = [...historicalYears, asOfYear]
  const weeklySeries: { year: number, isoWeek: number, start: string, end: string, indexPct: number, openDays: number }[] = []
  for (const year of chartYears) {
    if (yearOpenDayAvg(year) == null) continue
    const byWeek = new Map<number, { revenue: number, days: number, mondayIso: string, firstDate: string }>()
    for (const d of byYear.get(year)!.openDays) {
      const w = byWeek.get(d.isoWeek) ?? { revenue: 0, days: 0, mondayIso: d.mondayIso, firstDate: d.date }
      w.revenue += d.revenue
      w.days += 1
      if (d.date < w.firstDate) w.firstDate = d.date
      byWeek.set(d.isoWeek, w)
    }
    for (const [isoWeek, w] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
      // periodAvgFor keyed off the week's own earliest open day — every
      // day in a real week lands on the same side of the location-move
      // boundary in practice (there's a genuine closure gap between them,
      // not adjacent activity), so this doesn't need per-day splitting.
      const avg = periodAvgFor(year, w.firstDate)
      if (avg == null) continue // the closure/transition gap — skip rather than misattribute, which is also what breaks the chart line here instead of connecting across it
      weeklySeries.push({
        year,
        isoWeek,
        start: w.mondayIso,
        end: addDaysIso(w.mondayIso, 6),
        indexPct: (w.revenue / w.days / avg) * 100,
        openDays: w.days
      })
    }
  }

  return { asOfYear, historicalYears, currentYear: asOfYear, monthlyIndex, weeklySeries }
})
