// Real, dynamically-recalculated weekday revenue targets — the single
// source of truth behind the Dashboard's "This Week's Targets" section
// (server/api/dashboard.get.ts) and the Revenue Calendar page
// (server/api/pl.get.ts), so both pages judge a day against the exact same
// number rather than two independently-derived ones.
//
// A day-specific revenue target, scaled from a single editable weekly
// "good week" benchmark (weekly_revenue_benchmark) by the real weekday
// revenue pattern — Fri/Sat reliably run far above the weekly average and
// pull it up, so a single flat nightly target understates a slow Tuesday
// and understates what Friday/Saturday should be. See CLAUDE.md's
// "Dashboard reframed as Weekly Performance" section for the full history.
//
// Window choice: "everything since the move," not a rolling window — see
// that same CLAUDE.md section for why.
import type { ExcludedNight } from './core-revenue'

export const NEW_LOCATION_START = '2026-06-20'

export const WEEKDAYS = [
  { key: 'tue', label: 'Tuesday', short: 'Tue', dow: 2 },
  { key: 'wed', label: 'Wednesday', short: 'Wed', dow: 3 },
  { key: 'thu', label: 'Thursday', short: 'Thu', dow: 4 },
  { key: 'fri', label: 'Friday', short: 'Fri', dow: 5 },
  { key: 'sat', label: 'Saturday', short: 'Sat', dow: 6 },
  { key: 'sun', label: 'Sunday', short: 'Sun', dow: 0 }
] as const

export type WeekdayTarget = {
  key: string
  label: string
  short: string
  dow: number
  share: number | null
  sampleDays: number
  dollarTarget: number | null
  coversTarget: number | null
}

// One complete set of weekday targets. The baseline set (from = null) is the plain pattern of
// real history. When an area has a weekly closure (capacity_areas.closed_dows/closed_from), each
// closure start date adds a set that applies from that date on — see closureSets below.
export type TargetSet = {
  from: string | null
  source: 'baseline' | 'model' | 'actual'
  note: string | null
  avgSpendPerCover: number | null
  days: WeekdayTarget[] // Tue..Sun, in that order
  targetByDow: Map<number, WeekdayTarget> // 0=Sun..6=Sat — Monday (1) never populated
}

export type WeeklyRevenueTargets = {
  benchmarkAmount: number | null
  benchmarkUpdatedAt: string | null
  avgSpendPerCover: number | null
  sinceDate: string
  sampleOpenDays: number
  excludedNights: ExcludedNight[] // unrepresentative nights left out (see excludeSpendOutliers)
  days: WeekdayTarget[] // baseline set (no closure), Tue..Sun
  targetByDow: Map<number, WeekdayTarget> // baseline set — use forDate() for a specific day
  sets: TargetSet[] // baseline first, then one per closure start date
  forDate: (iso: string) => TargetSet // the set in force on a date (the latest set whose start is on/before it)
}

type OpenDay = { date: string, dow: number, revenue: number, covers: number }
type DowStat = { dow: number, key: string, label: string, short: string, avgRevenue: number | null, avgCovers: number | null, sampleDays: number }
type ClosureArea = {
  id: number, name: string, closed_dows: string, closed_from: string,
  closure_recapture_pct: number, closure_recapture_weights: string | null,
  capacity_nov_apr: number | null, capacity_may_oct: number
}

// Real post-closure data replaces the model once it has this much to say: four weeks of open days,
// with at least three samples of every weekday.
const MIN_ACTUAL_DAYS = 24
const MIN_ACTUAL_PER_WEEKDAY = 3

function dowStats(days: OpenDay[]): DowStat[] {
  return WEEKDAYS.map((w) => {
    const ds = days.filter(d => d.dow === w.dow)
    return {
      ...w,
      avgRevenue: ds.length > 0 ? ds.reduce((s, d) => s + d.revenue, 0) / ds.length : null,
      avgCovers: ds.length > 0 ? ds.reduce((s, d) => s + d.covers, 0) / ds.length : null,
      sampleDays: ds.length
    }
  })
}

// An area dark on some weekdays: its revenue on those nights leaves the weekday pattern, and
// recapture% of its covers comes back on its other nights, split by the area's recapture weights
// and capped at the headroom those nights have left (capacity minus what they already seat).
// Mutates `stats`.
function applyClosure(db: ReturnType<typeof useDb>, stats: DowStat[], sample: OpenDay[], area: ClosureArea) {
  const closed = new Set(area.closed_dows.split(',').map(Number).filter(n => Number.isInteger(n) && n !== 1))
  const openDows = WEEKDAYS.map(w => w.dow).filter(d => !closed.has(d))
  if (closed.size === 0 || openDows.length === 0) return
  const rows = db.prepare('SELECT date, covers, revenue FROM daily_toast_area_metrics WHERE area_id = ? AND date >= ?')
    .all(area.id, NEW_LOCATION_START) as { date: string, covers: number, revenue: number }[]
  const byDate = new Map(rows.map(r => [r.date, r]))
  // The area's average covers/revenue per weekday over the sample (a night with no area rows counts 0).
  const areaAvg = new Map<number, { covers: number, revenue: number }>()
  for (const w of WEEKDAYS) {
    const ds = sample.filter(d => d.dow === w.dow)
    if (ds.length === 0) continue
    areaAvg.set(w.dow, {
      covers: ds.reduce((t, d) => t + (byDate.get(d.date)?.covers ?? 0), 0) / ds.length,
      revenue: ds.reduce((t, d) => t + (byDate.get(d.date)?.revenue ?? 0), 0) / ds.length
    })
  }
  let lostCovers = 0, lostRevenue = 0
  for (const c of closed) {
    lostCovers += areaAvg.get(c)?.covers ?? 0
    lostRevenue += areaAvg.get(c)?.revenue ?? 0
  }
  const r = Math.min(1, Math.max(0, (area.closure_recapture_pct ?? 0) / 100))
  let weights: Record<string, number> = {}
  try { weights = area.closure_recapture_weights ? JSON.parse(area.closure_recapture_weights) : {} } catch { weights = {} }
  const rawW = openDows.map(d => (area.closure_recapture_weights ? Math.max(0, Number(weights[String(d)]) || 0) : 1))
  const wTotal = rawW.reduce((t, w) => t + w, 0)
  const capacities = [area.capacity_nov_apr, area.capacity_may_oct].filter((c): c is number => c != null && c > 0)
  const capacity = capacities.length > 0 ? Math.min(...capacities) : Infinity

  const stat = new Map(stats.map(st => [st.dow, st]))
  if (wTotal > 0) {
    openDows.forEach((d, i) => {
      const st = stat.get(d), a = areaAvg.get(d)
      if (!st || st.avgRevenue == null || st.avgCovers == null || !a) return
      const add = Math.min(r * lostCovers * (rawW[i] / wTotal), Math.max(0, capacity - a.covers))
      const perCover = a.covers > 0 ? a.revenue / a.covers : (lostCovers > 0 ? lostRevenue / lostCovers : 0)
      st.avgCovers += add
      st.avgRevenue += add * perCover
    })
  }
  for (const c of closed) {
    const st = stat.get(c), a = areaAvg.get(c)
    if (!st || st.avgRevenue == null || st.avgCovers == null || !a) continue
    st.avgRevenue = Math.max(0, st.avgRevenue - a.revenue)
    st.avgCovers = Math.max(0, st.avgCovers - a.covers)
  }
}

export function computeWeeklyRevenueTargets(): WeeklyRevenueTargets {
  const db = useDb()

  const corePlaceholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
  const coreRevenueRows = db.prepare(`
    SELECT dli.date AS date, SUM(dli.amount) AS revenue
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number IN (${corePlaceholders}) AND a.is_active = 1 AND dli.date >= ?
    GROUP BY dli.date
  `).all(...CORE_REVENUE_ACCOUNT_NUMBERS, NEW_LOCATION_START) as { date: string, revenue: number }[]
  const coreRevenueByDate = new Map(coreRevenueRows.map(r => [r.date, r.revenue]))

  const coversSinceMoveRows = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date >= ?').all(NEW_LOCATION_START) as { date: string, covers: number }[]
  const coversByDate = new Map(coversSinceMoveRows.map(r => [r.date, r.covers]))

  // Open, non-anomalous days only — same filter as history.get.ts's byYear
  // construction: real Toast covers at/above MIN_COVERS_FOR_OPEN_DAY (a
  // stray online order on an otherwise-closed day doesn't count as open),
  // AND real positive core revenue (a day with covers but $0 core revenue is
  // an event/catering day whose money posted elsewhere, not a real dine-in
  // night). The Monday check is belt-and-suspenders — a real Monday should
  // already fail the covers filter — kept explicit for clarity.
  type OpenDay = { date: string, dow: number, revenue: number, covers: number }
  const allOpenDays: OpenDay[] = []
  for (const [date, covers] of coversByDate) {
    if (covers < MIN_COVERS_FOR_OPEN_DAY) continue
    const revenue = coreRevenueByDate.get(date)
    if (revenue == null || revenue <= 0) continue
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (dow === 1) continue
    allOpenDays.push({ date, dow, revenue, covers })
  }
  // Leave out nights whose spend per cover is far from typical (an event/buyout posting
  // revenue to a core account, or the reverse) so one such night can't skew a weekday's
  // share or the blended spend — see excludeSpendOutliers in core-revenue.ts.
  const { kept: openDays, excluded: excludedNights } = excludeSpendOutliers(allOpenDays)

  // ---- Closure-aware target sets ----------------------------------------
  let closureAreas: ClosureArea[] = []
  try {
    closureAreas = db.prepare(`
      SELECT id, name, closed_dows, closed_from, closure_recapture_pct, closure_recapture_weights, capacity_nov_apr, capacity_may_oct
      FROM capacity_areas WHERE closed_dows IS NOT NULL AND closed_dows != '' AND closed_from IS NOT NULL
    `).all() as ClosureArea[]
  } catch {
    closureAreas = [] // closure columns not migrated yet: behave as if no closure is configured
  }
  const froms = [...new Set(closureAreas.map(a => a.closed_from))].sort()
  const firstFrom = froms[0] ?? null

  const benchmarkRow = db.prepare('SELECT weekly_amount AS weeklyAmount, updated_at AS updatedAt FROM weekly_revenue_benchmark WHERE id = 1')
    .get() as { weeklyAmount: number, updatedAt: string } | undefined
  const benchmarkAmount = benchmarkRow?.weeklyAmount ?? null

  function makeSet(stats: DowStat[], from: string | null, source: TargetSet['source'], note: string | null): TargetSet {
    const shareTotal = stats.reduce((s, w) => s + (w.avgRevenue ?? 0), 0)
    // Real average spend per cover, blended across every sampled open day.
    const totalRevenue = stats.reduce((s, w) => s + (w.avgRevenue ?? 0) * w.sampleDays, 0)
    const totalCovers = stats.reduce((s, w) => s + (w.avgCovers ?? 0) * w.sampleDays, 0)
    const avgSpendPerCover = totalCovers > 0 ? totalRevenue / totalCovers : null
    const days: WeekdayTarget[] = stats.map((w) => {
      const share = shareTotal > 0 && w.avgRevenue != null ? w.avgRevenue / shareTotal : null
      const dollarTarget = benchmarkAmount != null && share != null ? benchmarkAmount * share : null
      const coversTarget = dollarTarget != null && avgSpendPerCover ? Math.round(dollarTarget / avgSpendPerCover) : null
      return { key: w.key, label: w.label, short: w.short, dow: w.dow, share, sampleDays: w.sampleDays, dollarTarget, coversTarget }
    })
    return { from, source, note, avgSpendPerCover, days, targetByDow: new Map(days.map(d => [d.dow, d])) }
  }

  // Baseline: history before any closure starts (everything, when none is configured).
  const preClosure = firstFrom ? openDays.filter(d => d.date < firstFrom) : openDays
  const modelSample = preClosure.length > 0 ? preClosure : openDays
  const sets: TargetSet[] = [makeSet(dowStats(modelSample), null, 'baseline', null)]

  const dowName = (n: number) => WEEKDAYS.find(w => w.dow === n)?.short ?? String(n)
  froms.forEach((from, i) => {
    const nextFrom = froms[i + 1] ?? '9999-12-31'
    const active = closureAreas.filter(a => a.closed_from <= from)
    const describe = active.map(a => `${a.name} closed ${a.closed_dows.split(',').map(n => dowName(Number(n))).join('/')}`).join('; ')
    const post = openDays.filter(d => d.date >= from && d.date < nextFrom)
    const postStats = dowStats(post)
    if (post.length >= MIN_ACTUAL_DAYS && postStats.every(st => st.sampleDays >= MIN_ACTUAL_PER_WEEKDAY)) {
      sets.push(makeSet(postStats, from, 'actual', `${describe} from ${from}: pattern from ${post.length} real nights since then.`))
      return
    }
    const stats = dowStats(modelSample)
    for (const a of active) applyClosure(db, stats, modelSample, a)
    const rec = active.map(a => `${a.closure_recapture_pct}%`).join('/')
    sets.push(makeSet(stats, from, 'model', `${describe} from ${from}: modeled from pre-closure history with ${rec} of the closed nights' covers recaptured. Switches to real data after ${MIN_ACTUAL_DAYS} open nights.`))
  })

  const forDate = (iso: string): TargetSet => {
    let pick = sets[0]
    for (const st of sets) if (st.from != null && st.from <= iso) pick = st
    return pick
  }

  return {
    benchmarkAmount,
    benchmarkUpdatedAt: benchmarkRow?.updatedAt ?? null,
    avgSpendPerCover: sets[0].avgSpendPerCover,
    sinceDate: NEW_LOCATION_START,
    sampleOpenDays: openDays.length,
    excludedNights,
    days: sets[0].days,
    targetByDow: sets[0].targetByDow,
    sets,
    forDate
  }
}
