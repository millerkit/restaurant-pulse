// Real, dynamically-recalculated weekday revenue targets — the single
// source of truth behind the Dashboard's "This Week's Targets" section
// (server/api/dashboard.get.ts) and the P&L Drill-Downs page's Revenue
// Calendar (server/api/pl.get.ts), so both pages judge a day against the
// exact same number rather than two independently-derived ones.
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

export type WeeklyRevenueTargets = {
  benchmarkAmount: number | null
  benchmarkUpdatedAt: string | null
  avgSpendPerCover: number | null
  sinceDate: string
  sampleOpenDays: number
  days: WeekdayTarget[] // Tue..Sun, in that order
  targetByDow: Map<number, WeekdayTarget> // 0=Sun..6=Sat — Monday (1) never populated
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
  const openDays: OpenDay[] = []
  for (const [date, covers] of coversByDate) {
    if (covers < MIN_COVERS_FOR_OPEN_DAY) continue
    const revenue = coreRevenueByDate.get(date)
    if (revenue == null || revenue <= 0) continue
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (dow === 1) continue
    openDays.push({ date, dow, revenue, covers })
  }

  const weekdayAvg = WEEKDAYS.map((w) => {
    const days = openDays.filter(d => d.dow === w.dow)
    const avgRevenue = days.length > 0 ? days.reduce((s, d) => s + d.revenue, 0) / days.length : null
    return { ...w, avgRevenue, sampleDays: days.length }
  })
  const shareTotal = weekdayAvg.reduce((s, w) => s + (w.avgRevenue ?? 0), 0)
  const weekdayShare = weekdayAvg.map(w => ({
    ...w,
    share: shareTotal > 0 && w.avgRevenue != null ? w.avgRevenue / shareTotal : null
  }))

  // Real average spend per cover, blended across every open day since the
  // move — a live number rather than a hand-typed one.
  const totalOpenRevenue = openDays.reduce((s, d) => s + d.revenue, 0)
  const totalOpenCovers = openDays.reduce((s, d) => s + d.covers, 0)
  const avgSpendPerCover = totalOpenCovers > 0 ? totalOpenRevenue / totalOpenCovers : null

  const benchmarkRow = db.prepare('SELECT weekly_amount AS weeklyAmount, updated_at AS updatedAt FROM weekly_revenue_benchmark WHERE id = 1')
    .get() as { weeklyAmount: number, updatedAt: string } | undefined
  const benchmarkAmount = benchmarkRow?.weeklyAmount ?? null

  const days: WeekdayTarget[] = weekdayShare.map((w) => {
    const dollarTarget = benchmarkAmount != null && w.share != null ? benchmarkAmount * w.share : null
    const coversTarget = dollarTarget != null && avgSpendPerCover ? Math.round(dollarTarget / avgSpendPerCover) : null
    return { key: w.key, label: w.label, short: w.short, dow: w.dow, share: w.share, sampleDays: w.sampleDays, dollarTarget, coversTarget }
  })

  return {
    benchmarkAmount,
    benchmarkUpdatedAt: benchmarkRow?.updatedAt ?? null,
    avgSpendPerCover,
    sinceDate: NEW_LOCATION_START,
    sampleOpenDays: openDays.length,
    days,
    targetByDow: new Map(days.map(d => [d.dow, d]))
  }
}
