import type Database from 'better-sqlite3'
import { neverOpenOn } from '#shared/utils/area-hours'
import { CORE_REVENUE_ACCOUNT_NUMBERS, MIN_COVERS_FOR_OPEN_DAY } from './core-revenue'

type Db = Database.Database

// Seasonality from real history: backs the Seasonal Trends page (revenue, covers and spend
// charts) and the automatic capacity forecast (server/utils/capacity-forecast.ts), which
// projects expected covers per night = the location's demand level × this month's covers index.
// Moved here from server/api/capacity/history.get.ts 2026-11-11; rebuilt 2026-11-17 (see
// docs/claude-history.md, "Seasonality rebuilt"). Covers come from Toast (daily_toast_metrics),
// revenue from QuickBooks core dine-in accounts (CORE_REVENUE_ACCOUNT_NUMBERS, by account_number).
//
// How the covers index is built:
// - **Regular nights only.** A night counts when it has >= MIN_COVERS_FOR_OPEN_DAY covers, falls on
//   one of the location's own service nights (Mass Ave Tue-Sat, Cambridge St Tue-Sun: Mass Ave's
//   few Sunday openings were private events), isn't a dated holiday closure or special night
//   (buyout / event / off-site; catering runs alongside a normal night and stays), and isn't a
//   private party: covers over PARTY_NIGHT_MULTIPLE × that month's median regular night.
//   It does NOT need same-day QuickBooks dine-in revenue: a night's money can land elsewhere
//   (January 2025's Tasting Collective nights were coded to On-Site Events until Kit recoded them
//   2026-11-17; cash-basis deposits can post on another day), and requiring it dropped half of
//   January 2025's real nights (9 of 18), understating its index by ~20 points.
// - **Each month against the year around it, at the same location.** A month's covers per
//   night ÷ the average of the 12 full months centered on it (a centered moving average, the
//   classic way to separate seasonality from a trend), never mixing Mass Ave and Cambridge St.
//   A month needs MIN_NIGHTS_FOR_FULL_MONTH regular nights to be "full" (Cambridge St's
//   opening June has 9). So the move year is no longer skipped: January-May 2026 at Mass Ave
//   are measured against June 2025-May 2026, and Cambridge St months join automatically once
//   it has 12 full months (from mid-2027).
// - **Recent years count more.** Each calendar month averages its observations with weight
//   RECENCY_WEIGHT^(years older than the newest one): January-May lean 2/3 on 2026, 1/3 on
//   2025; August-December 2/3 on 2025, 1/3 on 2024. Then the 12 values are scaled to average 100.

const MIN_COVERS = MIN_COVERS_FOR_OPEN_DAY
// A month with fewer regular nights than this isn't used for the index or its 12-month reference.
const MIN_NIGHTS_FOR_FULL_MONTH = 15
// A month needs this many nights to show as a bar on the charts.
const MIN_NIGHTS_FOR_CHART_POINT = 3
// A night with more covers than this × the month's median regular night is a private party.
const PARTY_NIGHT_MULTIPLE = 1.75
// Weight of an observation one year older than the newest one for the same calendar month.
const RECENCY_WEIGHT = 0.5

type LocationKey = 'massAve' | 'cambridgeSt'
// The two rooms. Mass Ave closed 2026-05-30 (open Tue-Sat); Cambridge St opened 2026-06-20
// (Tue-Sun; friends & family nights before that are left out).
const LOCATIONS: { key: LocationKey, start: string, end: string, serviceDows: number[] }[] = [
  { key: 'massAve', start: '0000-01-01', end: '2026-05-31', serviceDows: [2, 3, 4, 5, 6] },
  { key: 'cambridgeSt', start: '2026-06-20', end: '9999-12-31', serviceDows: [0, 2, 3, 4, 5, 6] }
]
export const CAMBRIDGE_ST_START = LOCATIONS[1]!.start

type Metric = 'covers' | 'spend' | 'revenue'
// One location-month: regular nights (the covers index) and every open night (revenue / spend).
type MonthStats = {
  loc: LocationKey, ym: string, year: number, month: number,
  regularNights: number, regularCovers: number,
  openNights: number, openCovers: number, revenue: number
}
export type MonthlyIndexPoint = { month: number, indexPct: number | null, years: number[], observations: { year: number, indexPct: number, weight: number }[] }

function ymShift(ym: string, k: number): string {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + k
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function loadCapacityHistory(db: Db) {
  const placeholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
  const revenueRows = db.prepare(`
    SELECT dli.date as date, SUM(dli.amount) as revenue
    FROM daily_line_items dli
    JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number IN (${placeholders}) AND a.is_active = 1
    GROUP BY dli.date
  `).all(...CORE_REVENUE_ACCOUNT_NUMBERS) as { date: string, revenue: number }[]
  const coversRows = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE covers >= ? ORDER BY date').all(MIN_COVERS) as { date: string, covers: number }[]
  const holidays = new Set((db.prepare('SELECT date FROM holiday_closures').all() as { date: string }[]).map(r => r.date))
  const specialNights = new Set((db.prepare("SELECT date FROM special_nights WHERE kind != 'catering'").all() as { date: string }[]).map(r => r.date))

  const { date: asOfDate } = db.prepare('SELECT MAX(date) AS date FROM daily_toast_metrics').get() as { date: string | null }
  if (!asOfDate || coversRows.length === 0) {
    return {
      asOfYear: null, historicalYears: [] as number[], currentYear: null, monthlyIndex: [] as MonthlyIndexPoint[],
      coversSeries: [], spendSeries: [], revenueSeries: [],
      locationBaselines: { covers: { massAve: null, cambridgeSt: null }, spend: { massAve: null, cambridgeSt: null }, revenue: { massAve: null, cambridgeSt: null } },
      areaFillIndex: null, areaFillIndexSince: CAMBRIDGE_ST_START, coversPerNightLevel: null as number | null
    }
  }
  const asOfYear = Number(asOfDate.slice(0, 4))
  const locationOf = (iso: string) => LOCATIONS.find(l => iso >= l.start && iso <= l.end) ?? null

  // ---- Nights -----------------------------------------------------------
  type Night = { date: string, ym: string, loc: LocationKey, covers: number, regular: boolean }
  const nights: Night[] = []
  for (const r of coversRows) {
    const loc = locationOf(r.date)
    if (!loc || holidays.has(r.date)) continue
    const regular = loc.serviceDows.includes(dowOf(r.date)) && !specialNights.has(r.date)
    nights.push({ date: r.date, ym: r.date.slice(0, 7), loc: loc.key, covers: r.covers, regular })
  }
  // Private parties: well above the month's typical regular night.
  const regularByMonth = new Map<string, number[]>()
  for (const n of nights) {
    if (!n.regular) continue
    const k = `${n.loc}:${n.ym}`
    regularByMonth.set(k, [...(regularByMonth.get(k) ?? []), n.covers])
  }
  const medianByMonth = new Map([...regularByMonth].map(([k, v]) => [k, median(v)]))
  for (const n of nights) {
    if (n.regular && n.covers > PARTY_NIGHT_MULTIPLE * (medianByMonth.get(`${n.loc}:${n.ym}`) ?? Infinity)) n.regular = false
  }

  // ---- Location-months --------------------------------------------------
  const stats = new Map<string, MonthStats>()
  const statFor = (loc: LocationKey, ym: string) => {
    const k = `${loc}:${ym}`
    let s = stats.get(k)
    if (!s) {
      s = { loc, ym, year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)), regularNights: 0, regularCovers: 0, openNights: 0, openCovers: 0, revenue: 0 }
      stats.set(k, s)
    }
    return s
  }
  for (const n of nights) {
    const s = statFor(n.loc, n.ym)
    s.openNights++
    s.openCovers += n.covers
    if (n.regular) { s.regularNights++; s.regularCovers += n.covers }
  }
  // Revenue by month total, not by night: cash-basis deposits land on other days than the
  // night they belong to, but within a month they even out.
  for (const r of revenueRows) {
    const loc = locationOf(r.date)
    const s = loc ? stats.get(`${loc.key}:${r.date.slice(0, 7)}`) : undefined
    if (s) s.revenue += r.revenue
  }
  function valueOf(s: MonthStats, metric: Metric): number | null {
    if (metric === 'covers') return s.regularNights > 0 ? s.regularCovers / s.regularNights : null
    if (s.revenue <= 0 || s.openNights === 0) return null
    return metric === 'revenue' ? s.revenue / s.openNights : s.revenue / s.openCovers
  }
  const isFull = (s: MonthStats | undefined) => !!s && s.regularNights >= MIN_NIGHTS_FOR_FULL_MONTH

  // The average of the 12 full months centered on `s` at the same location (null when the
  // location doesn't have 12 consecutive full months around it yet).
  function centeredReference(s: MonthStats, metric: Metric): number | null {
    let best: { offset: number, value: number } | null = null
    for (let startShift = -11; startShift <= 0; startShift++) {
      const window = Array.from({ length: 12 }, (_, i) => stats.get(`${s.loc}:${ymShift(s.ym, startShift + i)}`))
      if (!window.every(isFull)) continue
      const vals = window.map(w => valueOf(w!, metric))
      if (vals.some(v => v == null)) continue
      const offset = Math.abs(startShift + 5.5)
      if (!best || offset < best.offset) best = { offset, value: mean(vals as number[]) }
    }
    return best?.value ?? null
  }
  // Fallback reference for the charts: the location's average over its full months so far.
  function locationAverage(loc: LocationKey, metric: Metric, year?: number): number | null {
    const vals = [...stats.values()]
      .filter(s => s.loc === loc && isFull(s) && (year == null || s.year === year))
      .map(s => valueOf(s, metric)).filter((v): v is number => v != null)
    return vals.length ? mean(vals) : null
  }

  // ---- Monthly covers index (the forecast's seasonal shape) -----------------
  const observationsByMonth = new Map<number, { year: number, indexPct: number }[]>()
  for (const s of stats.values()) {
    if (!isFull(s)) continue
    const value = valueOf(s, 'covers')
    const ref = centeredReference(s, 'covers')
    if (value == null || ref == null || ref <= 0) continue
    observationsByMonth.set(s.month, [...(observationsByMonth.get(s.month) ?? []), { year: s.year, indexPct: (value / ref) * 100 }])
  }
  const rawIndex = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const obs = (observationsByMonth.get(month) ?? []).sort((a, b) => a.year - b.year)
    if (obs.length === 0) return { month, raw: null as number | null, observations: [] as { year: number, indexPct: number, weight: number }[] }
    const newest = obs[obs.length - 1]!.year
    const weighted = obs.map(o => ({ ...o, weight: RECENCY_WEIGHT ** (newest - o.year) }))
    const total = weighted.reduce((sum, o) => sum + o.weight, 0)
    return { month, raw: weighted.reduce((sum, o) => sum + o.weight * o.indexPct, 0) / total, observations: weighted.map(o => ({ ...o, weight: o.weight / total })) }
  })
  // Scale so the 12 months average 100 (only possible once every month has a value).
  const raws = rawIndex.map(r => r.raw)
  const scale = raws.every(r => r != null) ? 100 / mean(raws as number[]) : 1
  const monthlyIndex: MonthlyIndexPoint[] = rawIndex.map(r => ({
    month: r.month,
    indexPct: r.raw == null ? null : r.raw * scale,
    years: r.observations.map(o => o.year),
    observations: r.observations
  }))

  // ---- Cambridge St demand level (for the automatic capacity forecast) -------
  // De-seasonalized covers per regular night since the move: real covers ÷ what the seasonal
  // shape says each of those nights should carry relative to an average month. The forecast
  // for a month is this level × that month's index. Demand, not seats: November (no outdoor
  // seating) ran about as busy as October, so the forecast no longer scales covers with each
  // month's capacity.
  // Full months only (MIN_NIGHTS_FOR_FULL_MONTH, the same rule as the index): the 9 opening
  // nights of June 2026 divided by June's Mass Ave-driven index (~125) counted as ~70/night of
  // demand and pulled the level ~3% low, as did the first few nights of a month in progress.
  let levelCovers = 0
  let levelIndex = 0
  for (const n of nights) {
    if (n.loc !== 'cambridgeSt' || !n.regular) continue
    if (!isFull(stats.get(`${n.loc}:${n.ym}`))) continue
    const idx = monthlyIndex[Number(n.date.slice(5, 7)) - 1]?.indexPct
    if (idx == null) continue
    levelCovers += n.covers
    levelIndex += idx / 100
  }
  const coversPerNightLevel = levelIndex > 0 ? levelCovers / levelIndex : null

  // ---- Chart series (Seasonal Trends) -----------------------------------
  // Last year and this year, each month against the same centered 12-month reference the
  // forecast uses. Cambridge St months, until it has a full year, are compared with its
  // average so far (`partial: true`).
  const priorYears = [...new Set([...stats.values()].map(s => s.year))].filter(y => y < asOfYear).sort((a, b) => a - b)
  const historicalYears = priorYears.length > 0 ? [priorYears[priorYears.length - 1]!] : []
  const chartYears = [...historicalYears, asOfYear]
  type SeriesPoint = { year: number, month: number, indexPct: number, openDays: number, location: LocationKey, partial: boolean }
  function buildSeries(metric: Metric): SeriesPoint[] {
    const series: SeriesPoint[] = []
    for (const s of [...stats.values()].sort((a, b) => a.ym.localeCompare(b.ym))) {
      if (!chartYears.includes(s.year)) continue
      const nightsUsed = metric === 'covers' ? s.regularNights : s.openNights
      if (nightsUsed < MIN_NIGHTS_FOR_CHART_POINT) continue
      const value = valueOf(s, metric)
      if (value == null) continue
      let ref = isFull(s) ? centeredReference(s, metric) : null
      const partial = ref == null
      if (ref == null) ref = locationAverage(s.loc, metric)
      if (ref == null || ref <= 0) continue
      series.push({ year: s.year, month: s.month, indexPct: (value / ref) * 100, openDays: nightsUsed, location: s.loc, partial })
    }
    return series
  }
  // The chart legend's real numbers: last year's Mass Ave average month, and Cambridge St's so far.
  function baselinesFor(metric: Metric) {
    const lastYear = historicalYears[0]
    return {
      massAve: lastYear != null ? locationAverage('massAve', metric, lastYear) : null,
      cambridgeSt: locationAverage('cambridgeSt', metric)
    }
  }
  const locationBaselines = { covers: baselinesFor('covers'), spend: baselinesFor('spend'), revenue: baselinesFor('revenue') }

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
  // Season-aware capacity (fixed 2026-11-11): every day is measured against the
  // seats actually available that month (Outdoor has none Nov-Apr). This used to
  // use May-Oct capacity for every day, so winter days were judged against summer
  // seating that didn't exist, which understated the baseline (and so every
  // winter month "Set by History" produced) by roughly a fifth.
  const areaCapacityRows = db.prepare('SELECT id, name, capacity_nov_apr AS capacityNovApr, capacity_may_oct AS capacityMayOct FROM capacity_areas').all() as { id: number; name: string; capacityNovApr: number | null; capacityMayOct: number | null }[]
  const areaCapForMonth = (a: { capacityNovApr: number | null; capacityMayOct: number | null }, month: number) =>
    (month >= 5 && month <= 10 ? a.capacityMayOct : a.capacityNovApr) ?? 0
  // An area's capacity on a given date: 0 on its never-open weekdays (Chef's Counter Sundays), so those
  // nights neither add capacity nor count covers toward its fill rate (area-hours.ts).
  const areaCapOn = (a: { name: string; capacityNovApr: number | null; capacityMayOct: number | null }, iso: string) =>
    neverOpenOn(a.name, dowOf(iso)) ? 0 : areaCapForMonth(a, Number(iso.slice(5, 7)))
  const totalCapOn = (iso: string) => areaCapacityRows.reduce((sum, a) => sum + areaCapOn(a, iso), 0)
  const areaNameById = new Map(areaCapacityRows.map(a => [a.id, a.name]))

  // Only open days since the move (same open-day rule as the rest of this file).
  const moveStart = CAMBRIDGE_ST_START
  const openDaysSinceMove = coversRows.filter(r => r.date >= moveStart)
  const openDateSet = new Set(openDaysSinceMove.map(r => r.date))
  const areaDayRows = db.prepare(`
    SELECT date, area_id AS areaId, covers FROM daily_toast_area_metrics WHERE date >= ?
  `).all(moveStart) as { date: string; areaId: number; covers: number }[]
  const areaCovers = new Map<number, number>()
  const areaCapDays = new Map<number, number>(areaCapacityRows.map(a => [a.id, 0]))
  let totalAreaCovers = 0
  let totalCapDays = 0
  for (const r of areaDayRows) {
    if (!openDateSet.has(r.date)) continue
    if (neverOpenOn(areaNameById.get(r.areaId) ?? '', dowOf(r.date))) continue
    areaCovers.set(r.areaId, (areaCovers.get(r.areaId) ?? 0) + r.covers)
    totalAreaCovers += r.covers
  }
  for (const d of openDaysSinceMove) {
    for (const a of areaCapacityRows) areaCapDays.set(a.id, (areaCapDays.get(a.id) ?? 0) + areaCapOn(a, d.date))
    totalCapDays += totalCapOn(d.date)
  }
  const blendedFill = totalCapDays > 0 ? totalAreaCovers / totalCapDays : 0
  const areaFillIndex = (totalAreaCovers > 0 && blendedFill > 0)
    ? areaCapacityRows.map((a) => {
        const capDays = areaCapDays.get(a.id) ?? 0
        if (capDays <= 0) return { areaId: a.id, indexValue: null as number | null }
        return { areaId: a.id, indexValue: ((areaCovers.get(a.id) ?? 0) / capDays) / blendedFill }
      })
    : null


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
    areaFillIndexSince: CAMBRIDGE_ST_START,
    coversPerNightLevel
  }
}
