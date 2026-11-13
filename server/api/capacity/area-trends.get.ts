// Weekly covers/night trend per seating area (last TREND_WEEKS complete Mon-Sun weeks) for the Covers &
// Spend page's trend section. Moved here 2026-11-12 from server/api/revenue-modeling.get.ts (the What-If
// page), since it is a read-only look at what actually happened, not simulation input.
//
// Rules (fixed 2026-11-13 after the Nov 12 buyout showed as a Dining Room collapse):
// - Only complete weeks. The week in progress is mostly weeknights so far and read as a false dip.
// - An open night = whole-restaurant covers >= MIN_COVERS_FOR_OPEN_DAY, and not a dated special night
//   (buyout, event, off-site, closed) or holiday. Those are rung as big tabs on whatever table is handy
//   (Nov 12: 60 guests on table 1, 40 on B1), so their area split says nothing about normal demand.
//   Catering runs alongside a normal night and stays in.
// - Every open night counts for every area that was open that night. The sync writes no row for an area
//   with no guests, so a missing row is 0 covers, not a skipped night (before this, Salon and Outdoor
//   averaged only the nights they had anyone). An area is closed that night when its seasonal capacity is
//   null (Outdoor Nov-Apr) or the weekday is in its weekly closure (closed_dows from closed_from).
import { MIN_COVERS_FOR_OPEN_DAY } from '../../utils/core-revenue'
import { loadPlannedNights } from '../../utils/special-nights'

const TREND_WEEKS = 12
type AreaRow = { id: number, name: string, novApr: number | null, mayOct: number | null, closedDows: string | null, closedFrom: string | null }
type Sum = { covers: number, nights: number }
type AreaTrend = {
  areaId: number, areaName: string, capacity: number | null,
  recent4WeekCoversPerNight: number | null,
  prior4WeekCoversPerNight: number | null,
  points: { weekStart: string, nights: number, coversPerNight: number | null }[]
}

const addDays = (d: string, n: number): string => {
  const dt = new Date(`${d}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
const weekday = (d: string): number => new Date(`${d}T00:00:00Z`).getUTCDay()
const weekStart = (d: string): string => addDays(d, -((weekday(d) + 6) % 7))

export default defineEventHandler(() => {
  const db = useDb()
  const areas = db.prepare(`
    SELECT id, name, capacity_nov_apr AS novApr, capacity_may_oct AS mayOct,
           closed_dows AS closedDows, closed_from AS closedFrom
    FROM capacity_areas ORDER BY id
  `).all() as AreaRow[]
  const { date: asOfAreaDate } = db.prepare('SELECT MAX(date) AS date FROM daily_toast_area_metrics').get() as { date: string | null }
  if (!asOfAreaDate) return { asOfAreaDate, throughDate: null, excludedNights: [], areaTrends: [] as AreaTrend[] }

  // Last complete week ends on the Sunday on/before the last synced date.
  const lastSunday = weekday(asOfAreaDate) === 0 ? asOfAreaDate : addDays(asOfAreaDate, -weekday(asOfAreaDate))
  const firstWeek = addDays(weekStart(lastSunday), -7 * (TREND_WEEKS - 1))
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => addDays(firstWeek, 7 * i))

  const planned = loadPlannedNights(db, firstWeek, lastSunday)
  const totals = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date BETWEEN ? AND ?')
    .all(firstWeek, lastSunday) as { date: string, covers: number }[]
  const excludedNights: { date: string, kind: string, note: string | null }[] = []
  const openDates: string[] = []
  for (const t of totals) {
    if (t.covers < MIN_COVERS_FOR_OPEN_DAY) continue
    const p = planned.get(t.date)
    if (p && p.kind !== 'catering') {
      excludedNights.push({ date: t.date, kind: p.kind, note: p.note })
      continue
    }
    openDates.push(t.date)
  }
  excludedNights.sort((a, b) => a.date.localeCompare(b.date))

  const coversByKey = new Map<string, number>()
  const rows = db.prepare('SELECT date, area_id AS areaId, covers FROM daily_toast_area_metrics WHERE date BETWEEN ? AND ?')
    .all(firstWeek, lastSunday) as { date: string, areaId: number, covers: number }[]
  for (const r of rows) coversByKey.set(`${r.date}|${r.areaId}`, r.covers)

  const isSummer = (d: string) => { const m = Number(d.slice(5, 7)); return m >= 5 && m <= 10 }
  const areaOpen = (a: AreaRow, d: string): boolean => {
    const cap = isSummer(d) ? a.mayOct : a.novApr
    if (cap == null || cap <= 0) return false
    if (a.closedDows && a.closedFrom && d >= a.closedFrom) {
      const closed = a.closedDows.split(',').map(s => Number(s.trim()))
      if (closed.includes(weekday(d))) return false
    }
    return true
  }

  // Capacity shown beside the trend = the area's capacity in the latest synced month.
  const capNow = (a: AreaRow) => (isSummer(asOfAreaDate) ? a.mayOct : a.novApr)
  const pool = (list: (Sum | undefined)[]): number | null => {
    const c = list.reduce((t, s) => t + (s?.covers ?? 0), 0)
    const n = list.reduce((t, s) => t + (s?.nights ?? 0), 0)
    return n > 0 ? c / n : null
  }

  const areaTrends: AreaTrend[] = areas.map((a) => {
    const sums = new Map<string, Sum>()
    for (const d of openDates) {
      if (!areaOpen(a, d)) continue
      const w = weekStart(d)
      const s = sums.get(w) ?? { covers: 0, nights: 0 }
      s.covers += coversByKey.get(`${d}|${a.id}`) ?? 0
      s.nights += 1
      sums.set(w, s)
    }
    const points = weeks.map((w) => {
      const s = sums.get(w)
      return { weekStart: w, nights: s?.nights ?? 0, coversPerNight: s && s.nights > 0 ? s.covers / s.nights : null }
    })
    // Pooled by nights (not an average of weekly averages).
    return {
      areaId: a.id,
      areaName: a.name,
      capacity: capNow(a),
      recent4WeekCoversPerNight: pool(weeks.slice(-4).map(w => sums.get(w))),
      prior4WeekCoversPerNight: pool(weeks.slice(-8, -4).map(w => sums.get(w))),
      points
    }
  })

  return { asOfAreaDate, throughDate: lastSunday, excludedNights, areaTrends }
})
