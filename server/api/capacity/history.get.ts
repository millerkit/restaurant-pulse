// Historical seasonality reference, derived from real Toast covers + QBO
// revenue history — backs the Historical page's three seasonality charts
// (revenue, covers, spend-per-cover) and the Edit Capacity page's
// "Set by History" action.
//
// Rebuilt 2026-08-12 around two separate indexes instead of one blended
// revenue index, at the user's request: the original "per-open-day core
// dine-in revenue, indexed to own average" conflated two different things
// — how many covers came through the door, and how much each cover spent
// — into one number that isn't how a restaurateur actually thinks about
// seasonality. Splitting them also fixes a real problem with using
// Mass Ave's history to forecast the new (much larger) Cambridge St space:
// a raw fill % isn't transferable across two differently-sized rooms (95%
// full in a small room and 75% full in a big room can reflect the exact
// same demand), but an index of covers relative to *that location's own*
// typical night sidesteps the comparison entirely — it's demand-shape, not
// an absolute occupancy level.
//
// Covers come from Toast (daily_toast_metrics); spend-per-cover divides
// QBO's own core dine-in revenue by those same covers, rather than trusting
// Toast's own dollar totals — QBO is already the trusted, cash-basis,
// sign-corrected revenue source everywhere else in this app.
//
// Restricted to core dine-in food/beverage accounts only (4000 Restaurant
// Sales, 4010 Food, 4020 Beverage, 4022/4024/4026/4028 Beer/Liquor/Wine/
// Non-Alcoholic) — matched by account_number, never a raw id (see
// CLAUDE.md's local/prod account-drift section). Event Sales (4100s),
// Catering (4200s), Retail (4300s), and Other Service Income (4400) are
// deliberately excluded, same reasoning as the original revenue index: a
// private-event booking swing isn't regular dine-in demand seasonality.
const CORE_REVENUE_ACCOUNT_NUMBERS = ['4000', '4010', '4020', '4022', '4024', '4026', '4028']

// A month needs at least this many open days in a given year to produce a
// trustworthy per-open-day average — guards against a month that's mostly
// outside the data window being treated as a real, if extreme, data point.
const MIN_OPEN_DAYS_FOR_MONTH_INDEX = 3

// A day needs at least this many Toast covers to count as genuinely open —
// found by checking the real distribution rather than assuming covers > 0
// was good enough (it wasn't). ~95 local days show covers between 1-13,
// with a clean gap before real service nights start at 17+; 44 of those
// low-covers days are Mondays (the standing closure) and 24 are Sundays
// (Mass Ave's second closure day — see CLAUDE.md's location-move section),
// with most of the rest clustering around known holidays. These are real
// closures where a single stray online order (a gift card purchase, a
// pre-order) slipped through Toast, not real slow nights — counting them as
// "open" both understates real demand seasonality and, worse, corrupts the
// spend-per-cover index: a closure day with one $150 gift-card order
// produces a nonsensical $150/cover reading that can swamp a whole month's
// average. Same "verify the real distribution, find the clean gap"
// methodology as MAX_PLAUSIBLE_GUESTS_PER_ORDER in
// server/utils/toast-metrics-sync.ts.
const MIN_COVERS_FOR_OPEN_DAY = 15

type DailyRevenueRow = { date: string, revenue: number }
type DailyCoversRow = { date: string, covers: number }

export default defineEventHandler(() => {
  const db = useDb()
  const placeholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
  const revenueRows = db.prepare(`
    SELECT dli.date as date, SUM(dli.amount) as revenue
    FROM daily_line_items dli
    JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number IN (${placeholders}) AND a.is_active = 1
    GROUP BY dli.date
    ORDER BY dli.date
  `).all(...CORE_REVENUE_ACCOUNT_NUMBERS) as DailyRevenueRow[]
  const revenueByDate = new Map(revenueRows.map(r => [r.date, r.revenue]))

  // Real Toast covers, not a revenue threshold, now define "open" — a
  // genuine improvement over the old $300-revenue-guess heuristic, now that
  // real covers data reaches back through the Mass Ave era too (see
  // CLAUDE.md's "Ongoing per-area/whole-restaurant tracking" section). Uses
  // MIN_COVERS_FOR_OPEN_DAY rather than a bare covers > 0 — see that
  // constant's comment for why a stray single order on an otherwise-closed
  // day needs to be excluded, not just a covers=0 day. A day below the
  // threshold could in principle also mean "no Toast data synced for that
  // date yet" rather than a real closure — same ambiguity
  // backfill-toast-metrics.mjs's own "quiet streak" check already flags —
  // but it's a strictly better signal than guessing from a dollar amount
  // that doesn't even distinguish a closure from a buyout night whose
  // revenue posted to a different GL bucket.
  const coversRows = db.prepare(`SELECT date, covers FROM daily_toast_metrics WHERE covers >= ? ORDER BY date`).all(MIN_COVERS_FOR_OPEN_DAY) as DailyCoversRow[]

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_toast_metrics').get() as { date: string | null }
  if (!asOfDate || coversRows.length === 0) {
    return {
      asOfYear: null, historicalYears: [], currentYear: null, monthlyIndex: [],
      coversSeries: [], spendSeries: [], revenueSeries: [],
      locationBaselines: { covers: { massAve: null, cambridgeSt: null }, spend: { massAve: null, cambridgeSt: null }, revenue: { massAve: null, cambridgeSt: null } },
      areaFillIndex: null, areaFillIndexSince: null, dataAnnualFillPct: null
    }
  }
  const asOfYear = Number(asOfDate.slice(0, 4))

  type DayPoint = { date: string, month: number, covers: number, revenue: number | null, spend: number | null }
  const byYear = new Map<number, DayPoint[]>()
  for (const r of coversRows) {
    const year = Number(r.date.slice(0, 4))
    const month = Number(r.date.slice(5, 7))
    const revenue = revenueByDate.get(r.date) ?? null
    // A day with real Toast covers but exactly $0 core revenue isn't a real
    // slow dine-in night — verified against real production data (2026-08-13):
    // ~6% of open days show this, and checking a few showed real substantial
    // money that day, just posted to Off-Site/On-Site Events or Catering
    // accounts instead (e.g. 2025-06-22: 171 covers, $0 core revenue,
    // $12,519 to "Off-Site Events – Food Revenue") — a private event Toast
    // still logged covers for, correctly excluded from *core dine-in*
    // revenue by CORE_REVENUE_ACCOUNT_NUMBERS above, but with nothing
    // filtering its covers out the same way. Left in, it produces a
    // nonsensical $0/cover spend reading (corrupting that month's spend
    // average) and, for the covers index, counts event attendance as if it
    // were regular walk-in demand. `revenue == null` (no QBO sync yet for
    // that date — effectively only "today") gets the same treatment, since
    // there's no way to confirm the day was real core dine-in either way.
    if (revenue == null || revenue <= 0) continue
    const spend = revenue / r.covers
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)!.push({ date: r.date, month, covers: r.covers, revenue, spend })
  }

  const allYears = [...byYear.keys()].sort((a, b) => a - b)
  // Only the single most recent prior year — see CLAUDE.md's 2026-08-10
  // note for why (a straight "this year vs. last year" reads more clearly
  // than an equal-weighted multi-year average, at the user's own request).
  const priorYears = allYears.filter(y => y < asOfYear)
  const historicalYears = priorYears.length > 0 ? [priorYears[priorYears.length - 1]] : []

  type Metric = 'covers' | 'spend' | 'revenue'
  // spend/revenue are typed nullable on DayPoint defensively, but every
  // DayPoint in byYear was already required to have real, positive revenue
  // (and therefore spend) above — this filter is belt-and-suspenders, not
  // load-bearing.
  function metricValue(d: DayPoint, metric: Metric): number | null {
    return metric === 'covers' ? d.covers : metric === 'spend' ? d.spend : d.revenue
  }
  function avgOf(days: DayPoint[], metric: Metric): number | null {
    const vals = days.map(d => metricValue(d, metric)).filter((v): v is number => v != null)
    if (vals.length === 0) return null
    return vals.reduce((sum, v) => sum + v, 0) / vals.length
  }
  function yearAvg(year: number, metric: Metric): number | null {
    return avgOf(byYear.get(year) ?? [], metric)
  }

  // 2026 spans the real location move (old Mass Ave location closed
  // 2026-05-30, new Cambridge St location's real opening was 2026-06-20 —
  // see CLAUDE.md). A single whole-year average blends two operationally
  // different rooms; each half needs its own baseline. Hand-verified
  // constant, not a generic mechanism — no other year has this problem.
  const LOCATION_MOVE_PERIODS: { start: string, end: string }[] = [
    { start: '2026-01-01', end: '2026-05-31' },
    { start: '2026-06-20', end: '2026-12-31' }
  ]
  function periodAvgFor(year: number, dateIso: string, metric: Metric): number | null {
    if (year !== 2026) return yearAvg(year, metric)
    const period = LOCATION_MOVE_PERIODS.find(p => dateIso >= p.start && dateIso <= p.end)
    if (!period) return null
    const days = (byYear.get(year) ?? []).filter(d => d.date >= period.start && d.date <= period.end)
    return avgOf(days, metric)
  }

  // ---- Monthly index (for Edit Capacity's "Set by History") -------------
  // Covers-based (switched from revenue 2026-08-12) — "Set by History"
  // writes into each area's *covers* input, so a covers-shaped index is a
  // direct measurement rather than the revenue-based approximation this
  // used before (revenue seasonality mixes in spend-per-cover seasonality,
  // which isn't what a covers target should track).
  const monthlyIndex = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const perYear: { year: number, indexPct: number }[] = []
    for (const year of historicalYears) {
      const yAvg = yearAvg(year, 'covers')
      if (yAvg == null) continue
      const monthDays = (byYear.get(year) ?? []).filter(d => d.month === month)
      if (monthDays.length < MIN_OPEN_DAYS_FOR_MONTH_INDEX) continue
      const monthAvg = monthDays.reduce((sum, d) => sum + d.covers, 0) / monthDays.length
      perYear.push({ year, indexPct: (monthAvg / yAvg) * 100 })
    }
    const indexPct = perYear.length > 0 ? perYear.reduce((sum, p) => sum + p.indexPct, 0) / perYear.length : null
    return { month, indexPct, years: perYear.map(p => p.year) }
  })

  // ---- Monthly series (for the Historical page's three charts) ----------
  // Same "index to own average" technique as monthlyIndex, but per
  // chartYear's own raw value (for a grouped-bar current-vs-prior
  // comparison), and split into parallel series per metric rather than one
  // blended figure. `revenue` (added 2026-08-13, at the user's request, to
  // sit alongside covers/spend as a "which months actually made the most
  // money" headline) is real per-open-day revenue — mathematically the
  // same thing as covers × spend per day (spend is defined as revenue ÷
  // covers), so this isn't a third, independently-derived number; it's
  // just building the ratio-to-own-average index directly off `d.revenue`
  // rather than off `coversIndex × spendIndex`, which would drift from a
  // true revenue average (averaging two ratios and multiplying isn't the
  // same as averaging their product).
  // Classifies each *day* individually via periodAvgFor (not by picking one
  // representative day per month) — see CLAUDE.md's 2026-08-10 note on why
  // that matters (a month whose earliest day falls in the location-move gap
  // would otherwise get dropped whole, discarding real data from its other
  // days).
  const chartYears = [...historicalYears, asOfYear]
  function buildSeries(metric: Metric): { year: number, month: number, indexPct: number, openDays: number }[] {
    const series: { year: number, month: number, indexPct: number, openDays: number }[] = []
    for (const year of chartYears) {
      if (yearAvg(year, metric) == null) continue
      const byMonth = new Map<number, { ratioSum: number, days: number }>()
      for (const d of byYear.get(year) ?? []) {
        const value = metricValue(d, metric)
        if (value == null) continue // defensive — see metricValue's comment above
        const avg = periodAvgFor(year, d.date, metric)
        if (avg == null) continue // this day falls in the location-move gap — excluded on its own, not by dragging its whole month down with it
        const m = byMonth.get(d.month) ?? { ratioSum: 0, days: 0 }
        m.ratioSum += value / avg
        m.days += 1
        byMonth.set(d.month, m)
      }
      for (const [month, m] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
        if (m.days < MIN_OPEN_DAYS_FOR_MONTH_INDEX) continue
        series.push({ year, month, indexPct: (m.ratioSum / m.days) * 100, openDays: m.days })
      }
    }
    return series
  }

  // The chart's "Year average (100%)" reference line is a ratio — on its
  // own it doesn't say what real number a bar is actually being measured
  // against. Added 2026-08-12 at the user's request, framed the same way
  // they asked for it: by *location*, not by calendar year, since that's
  // what a restaurateur actually wants to compare (Mass Ave vs. Cambridge
  // St), not "2025" as an abstract label. Mass Ave's number is 2025's own
  // whole-year average (2025 is the only historical year, and it's
  // entirely Mass Ave); Cambridge St's is the new-location half of
  // LOCATION_MOVE_PERIODS. Hardcoded to this specific transition the same
  // way LOCATION_MOVE_PERIODS itself already is — only meaningful while
  // 2026 (the move year) is still the current lens; once next year rolls
  // around and asOfYear moves past 2026, this pairing stops being
  // applicable and simply won't render (both page and component treat a
  // null baseline as "don't show it").
  const massAveYear = historicalYears.includes(2025) ? 2025 : null
  function baselinesFor(metric: Metric) {
    return asOfYear === 2026 && massAveYear != null
      ? { massAve: yearAvg(massAveYear, metric), cambridgeSt: periodAvgFor(2026, LOCATION_MOVE_PERIODS[1].start, metric) }
      : { massAve: null, cambridgeSt: null }
  }
  const locationBaselines = {
    covers: baselinesFor('covers'),
    spend: baselinesFor('spend'),
    revenue: baselinesFor('revenue')
  }

  // ---- Per-area fill-rate index (for Edit Capacity's "Set by History") --
  // How much more/less intensely each area fills, relative to the
  // restaurant-wide average, since the Cambridge St move — a flat index
  // (not month-varying), at the user's explicit choice 2026-08-13: the
  // Cambridge St location only has ~8 weeks of real per-area data so far,
  // nowhere near enough to trust a month-by-month per-area seasonal shape,
  // and Bar/Salon have *no* prior-location history at all (Mass Ave never
  // had those spaces). "Set by History" still applies the existing
  // monthlyIndex's real seasonal *total* per month (2+ years of
  // whole-restaurant Mass Ave + Cambridge St history) — only how that
  // total splits across the 5 areas uses this flat index instead of an
  // equal split.
  //
  // Expressed as fill% relative to the blended average
  // (areaCovers/areaCapacity ÷ totalCovers/totalCapacity), not a raw share
  // of covers — a raw covers share would conflate area size with real
  // demand (a bigger room always gets more raw covers) and, worse, doesn't
  // naturally respect a seasonally-closed area's 0 capacity. This ratio
  // form is dimensionless and gets applied by the client against that
  // area's own capacity for the target month (already 0 for Outdoor
  // Nov-Apr), so a closed season needs no special-casing here — 0
  // capacity × any index is still 0.
  const areaCoversRows = db.prepare(`
    SELECT area_id AS areaId, SUM(covers) AS covers
    FROM daily_toast_area_metrics
    WHERE date >= ?
    GROUP BY area_id
  `).all(LOCATION_MOVE_PERIODS[1].start) as { areaId: number; covers: number }[]
  const areaCapacityRows = db.prepare('SELECT id, capacity_may_oct AS capacityMayOct FROM capacity_areas').all() as { id: number; capacityMayOct: number }[]
  const areaCoversByAreaId = new Map(areaCoversRows.map(r => [r.areaId, r.covers]))
  const totalAreaCovers = areaCoversRows.reduce((sum, r) => sum + r.covers, 0)
  const totalCapacityMayOct = areaCapacityRows.reduce((sum, r) => sum + (r.capacityMayOct || 0), 0)
  const areaFillIndex = (totalAreaCovers > 0 && totalCapacityMayOct > 0)
    ? areaCapacityRows.map((a) => {
        const covers = areaCoversByAreaId.get(a.id) ?? 0
        if (!a.capacityMayOct) return { areaId: a.id, indexValue: null as number | null }
        const areaFillPct = covers / a.capacityMayOct
        const blendedFillPct = totalAreaCovers / totalCapacityMayOct
        return { areaId: a.id, indexValue: areaFillPct / blendedFillPct }
      })
    : null

  // ---- Data-driven annual baseline (for Edit Capacity's "Set by History")
  // Previously "Set by History" scaled the historical monthly shape against
  // whatever fill % was already typed into the covers grid — not a real
  // number, just whatever assumption (optimistic, stale, or otherwise)
  // happened to already be on the page. Replaced 2026-08-13 at the user's
  // request for something fully data-driven instead.
  //
  // The real complication: only ~8 weeks of real Cambridge St data exist
  // (2026-06-20 onward, all summer), and summer is very likely not
  // representative of the whole year — using its raw fill % as "the
  // annual average" would just trade one bias (a stale manual guess) for
  // another (assuming summer = average). Fixed by de-seasonalizing: divide
  // real covers by an "expected capacity contribution" that already
  // accounts for each day's own month running historically hot or cold
  // (via monthlyIndex, from 2+ years of real covers history) — so a summer
  // that's running exactly at its historically-typical elevated level
  // implies a baseline *below* the raw summer fill %, not equal to it.
  // This does lean on one real assumption: that Mass Ave's historical
  // month-to-month demand *shape* (not the absolute capacity/fill level,
  // which is location-specific and already handled separately by
  // areaFillIndex/capacity_areas) still roughly holds for Cambridge St —
  // the best available proxy until a full year of Cambridge St-only
  // history exists to replace it with.
  let dataBaselineActual = 0
  let dataBaselineExpected = 0
  if (totalCapacityMayOct > 0) {
    for (const r of coversRows) {
      if (r.date < LOCATION_MOVE_PERIODS[1].start) continue
      const month = Number(r.date.slice(5, 7))
      const idx = monthlyIndex.find(m => m.month === month)?.indexPct
      if (idx == null) continue
      dataBaselineActual += r.covers
      dataBaselineExpected += totalCapacityMayOct * (idx / 100)
    }
  }
  const dataAnnualFillPct = dataBaselineExpected > 0 ? dataBaselineActual / dataBaselineExpected : null

  return {
    asOfYear,
    historicalYears,
    currentYear: asOfYear,
    monthlyIndex,
    coversSeries: buildSeries('covers'),
    spendSeries: buildSeries('spend'),
    revenueSeries: buildSeries('revenue'),
    locationBaselines,
    areaFillIndex,
    areaFillIndexSince: LOCATION_MOVE_PERIODS[1].start,
    dataAnnualFillPct
  }
})
