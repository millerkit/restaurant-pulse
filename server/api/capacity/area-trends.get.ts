// Weekly covers/night trend per seating area (last TREND_WEEKS Mon-Sun weeks) for the Covers & Spend
// page's trend section. Moved here 2026-11-12 from server/api/revenue-modeling.get.ts (the What-If
// page), since it is a read-only look at what actually happened, not simulation input.
import { MIN_COVERS_FOR_OPEN_DAY } from '../../utils/core-revenue'

type AreaRow = { id: number, name: string }
const TREND_WEEKS = 12
type AreaTrend = {
  areaId: number, areaName: string, capacity: number | null,
  recent4WeekCoversPerNight: number | null,
  points: { weekStart: string, nights: number, coversPerNight: number | null }[]
}

export default defineEventHandler(() => {
  const db = useDb()
  const areas = db.prepare('SELECT id, name FROM capacity_areas ORDER BY id').all() as AreaRow[]
  const { date: asOfAreaDate } = db.prepare('SELECT MAX(date) AS date FROM daily_toast_area_metrics').get() as { date: string | null }

  // ---- weekly covers/night trend per area (last TREND_WEEKS Mon-Sun weeks) ----
  // A night counts as open only if the whole restaurant seated at least
  // MIN_COVERS_FOR_OPEN_DAY (same filter as the Historical tab), so closed
  // Mondays and stray-order days don't drag a week's per-night average down.
  // The in-progress week is included, averaged over the nights so far.
  let areaTrends: AreaTrend[] = []
  if (asOfAreaDate) {
    const weekStart = (d: string): string => {
      const dt = new Date(`${d}T00:00:00Z`)
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7))
      return dt.toISOString().slice(0, 10)
    }
    const lastWeek = weekStart(asOfAreaDate)
    const first = new Date(`${lastWeek}T00:00:00Z`)
    first.setUTCDate(first.getUTCDate() - 7 * (TREND_WEEKS - 1))
    const firstWeek = first.toISOString().slice(0, 10)

    const rows = db.prepare(`
      SELECT date, area_id AS areaId, covers
      FROM daily_toast_area_metrics
      WHERE date BETWEEN ? AND ?
    `).all(firstWeek, asOfAreaDate) as { date: string, areaId: number, covers: number }[]
    const totalByDate = new Map<string, number>()
    for (const r of rows) totalByDate.set(r.date, (totalByDate.get(r.date) ?? 0) + r.covers)
    const openDates = new Set([...totalByDate].filter(([, c]) => c >= MIN_COVERS_FOR_OPEN_DAY).map(([d]) => d))

    // Current-season nightly capacity, to express covers as a fill %.
    const asOfMonthNum = Number(asOfAreaDate.slice(5, 7))
    const summer = asOfMonthNum >= 5 && asOfMonthNum <= 10
    const caps = db.prepare('SELECT id, capacity_nov_apr AS novApr, capacity_may_oct AS mayOct FROM capacity_areas').all() as { id: number, novApr: number | null, mayOct: number }[]
    const capByArea = new Map(caps.map(c => [c.id, summer ? c.mayOct : c.novApr]))

    const weeks: string[] = []
    for (let i = 0; i < TREND_WEEKS; i++) {
      const w = new Date(`${firstWeek}T00:00:00Z`)
      w.setUTCDate(w.getUTCDate() + 7 * i)
      weeks.push(w.toISOString().slice(0, 10))
    }
    areaTrends = areas.map((a) => {
      const sums = new Map<string, { covers: number, nights: number }>()
      for (const r of rows) {
        if (r.areaId !== a.id || !openDates.has(r.date)) continue
        const w = weekStart(r.date)
        const s = sums.get(w) ?? { covers: 0, nights: 0 }
        s.covers += r.covers
        s.nights += 1
        sums.set(w, s)
      }
      const points = weeks.map((w) => {
        const s = sums.get(w)
        return { weekStart: w, nights: s?.nights ?? 0, coversPerNight: s && s.nights > 0 ? s.covers / s.nights : null }
      })
      // Last 4 weeks, weighted by nights (not an average of weekly averages).
      const recent = weeks.slice(-4).map(w => sums.get(w)).filter((s): s is { covers: number, nights: number } => !!s)
      const rc = recent.reduce((t, s) => t + s.covers, 0)
      const rn = recent.reduce((t, s) => t + s.nights, 0)
      return {
        areaId: a.id,
        areaName: a.name,
        capacity: capByArea.get(a.id) ?? null,
        recent4WeekCoversPerNight: rn > 0 ? rc / rn : null,
        points
      }
    })
  }

  return { asOfAreaDate, areaTrends }
})
