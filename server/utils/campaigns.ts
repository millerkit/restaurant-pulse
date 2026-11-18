// Marketing campaigns and what they did (Sales Strategy step 3, 2026-11-18). A campaign is a dated push aimed at
// certain weekdays and/or one area (marketing_campaigns, see schema.sql). Its result is a COMPARISON, never proof of
// cause: the targeted nights' real covers against
//   - "before": the average of the same weekdays on normal nights in the 28 days before it started, and
//   - "plan": for whole-restaurant campaigns, the month's frozen plan (forecast_snapshots month_start covers,
//     per operating night, shaped by the real weekday pattern). Per-area plans aren't snapshotted.
// Seasonality, weather, holidays and events all move covers too; the page says so. Nights that don't count: Mondays,
// holiday closures, dated special nights, and any night under the open-day cover threshold.
import type Database from 'better-sqlite3'

type Db = Database.Database

export const CAMPAIGN_CHANNELS = ['email', 'social', 'paid-ads', 'press', 'partner', 'in-house', 'other'] as const
// Fewer measured nights than this and the result is "too early", not a number.
export const MIN_CAMPAIGN_NIGHTS = 3
// Same-weekday nights before the start used as the "before" baseline, and how many are needed.
const BEFORE_WINDOW_DAYS = 28
const MIN_BEFORE_NIGHTS = 3
// A lift within this share of a baseline reads as flat, not a win or a loss.
export const FLAT_BAND = 0.05

export type CampaignRow = {
  id: number, name: string, channel: string, startDate: string, endDate: string,
  targetDows: number[] | null, targetArea: string | null, cost: number, note: string | null
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

export function loadCampaigns(db: Db): CampaignRow[] {
  try {
    const rows = db.prepare(`
      SELECT id, name, channel, start_date AS startDate, end_date AS endDate, target_dows AS dows,
             target_area AS targetArea, cost, note
      FROM marketing_campaigns ORDER BY start_date DESC, id DESC
    `).all() as (Omit<CampaignRow, 'targetDows'> & { dows: string | null })[]
    return rows.map(({ dows, ...r }) => ({ ...r, targetDows: dows ? dows.split(',').map(Number).filter(n => Number.isInteger(n)) : null }))
  } catch {
    return []
  }
}

export function computeCampaignResults(db: Db, c: CampaignRow, todayIso: string) {
  const asOf = (db.prepare('SELECT MAX(date) AS d FROM daily_toast_metrics').get() as { d: string | null }).d
  const area = c.targetArea
    ? db.prepare('SELECT id, per_cover_revenue_food AS food, per_cover_revenue_beverage AS bev FROM capacity_areas WHERE name = ?').get(c.targetArea) as { id: number, food: number, bev: number } | undefined
    : undefined

  // Real covers per date: the area's, or the whole restaurant's; only nights that count.
  const from = addDays(c.startDate, -BEFORE_WINDOW_DAYS)
  const to = c.endDate
  const special = loadSpecialNights(db, from, to)
  const holidays = loadHolidayClosures(db, from, to)
  const totals = new Map((db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date BETWEEN ? AND ?').all(from, to) as { date: string, covers: number }[]).map(r => [r.date, r.covers]))
  const areaCovers = area
    ? new Map((db.prepare('SELECT date, covers FROM daily_toast_area_metrics WHERE area_id = ? AND date BETWEEN ? AND ?').all(area.id, from, to) as { date: string, covers: number }[]).map(r => [r.date, r.covers]))
    : null
  const counts = (date: string) => {
    const dow = dowOf(date)
    if (dow === 1 || special.has(date) || holidays.has(date)) return false
    if (c.targetDows && !c.targetDows.includes(dow)) return false
    return (totals.get(date) ?? 0) >= MIN_COVERS_FOR_OPEN_DAY
  }
  const coversOn = (date: string) => (areaCovers ? areaCovers.get(date) ?? 0 : totals.get(date) ?? 0)

  const during: { date: string, covers: number }[] = []
  for (let d = c.startDate; d <= c.endDate && (!asOf || d <= asOf); d = addDays(d, 1)) {
    if (counts(d)) during.push({ date: d, covers: coversOn(d) })
  }
  const before: number[] = []
  for (let d = addDays(c.startDate, -BEFORE_WINDOW_DAYS); d < c.startDate; d = addDays(d, 1)) {
    if (counts(d)) before.push(coversOn(d))
  }

  const status: 'upcoming' | 'running' | 'done' = c.startDate > todayIso ? 'upcoming' : c.endDate >= todayIso ? 'running' : 'done'
  const measured = during.length >= MIN_CAMPAIGN_NIGHTS
  const avgActual = during.length > 0 ? mean(during.map(x => x.covers)) : null
  const avgBefore = before.length >= MIN_BEFORE_NIGHTS ? mean(before) : null

  // Plan baseline (whole restaurant only): the frozen month_start plan covers per operating night in each
  // night's month, shaped by that weekday's real share of an average night since the move.
  let avgPlan: number | null = null
  if (!area && measured) {
    const shape = totalWeekdayShape(db)
    const plans: number[] = []
    for (const { date } of during) {
      const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7))
      const snap = db.prepare(`
        SELECT value FROM forecast_snapshots WHERE kind = 'month_start' AND source = 'plan' AND metric = 'covers'
          AND year = ? AND month = ? ORDER BY snapshot_date LIMIT 1
      `).get(y, m) as { value: number } | undefined
      if (!snap) continue
      const start = `${y}-${String(m).padStart(2, '0')}-01`
      const end = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1)
      const nights = createCapacityModel(db, start, end).dayByDaySum(start, end).operatingDays
      if (nights > 0) plans.push((snap.value / nights) * (shape.get(dowOf(date)) ?? 1))
    }
    if (plans.length === during.length) avgPlan = mean(plans)
  }

  const lift = (base: number | null) => (avgActual != null && base != null && base > 0 ? { perNight: avgActual - base, pct: avgActual / base - 1 } : null)
  const vsBefore = measured ? lift(avgBefore) : null
  const vsPlan = measured ? lift(avgPlan) : null

  // Profit per extra cover: spend × contribution rate − front-of-house labor per cover (Breakeven's own numbers,
  // for the campaign's first month). The area's own spend per guest when the campaign targets one area.
  let profitPerCover: number | null = null
  try {
    const month = Number(c.startDate.slice(5, 7)), year = Number(c.startDate.slice(0, 4))
    const be = computeBreakeven(db, year, month)
    if (be.contribRate != null) {
      const spend = area ? area.food + area.bev : be.avgSpend
      if (spend != null) profitPerCover = spend * be.contribRate - be.fohPerCover
    }
  } catch { /* Breakeven can't be computed for this month: covers only */ }
  const basis = vsBefore ?? vsPlan
  const addedCovers = basis ? basis.perNight * during.length : null
  const addedProfit = addedCovers != null && profitPerCover != null ? addedCovers * profitPerCover : null

  // The read needs every available baseline to agree; a split is "mixed".
  const lifts = [vsBefore, vsPlan].filter((x): x is { perNight: number, pct: number } => x != null)
  let read: 'ahead' | 'flat' | 'behind' | 'mixed' | 'too-early'
  if (!measured || lifts.length === 0) read = 'too-early'
  else if (lifts.every(l => l.pct > FLAT_BAND)) read = 'ahead'
  else if (lifts.every(l => l.pct < -FLAT_BAND)) read = 'behind'
  else if (lifts.every(l => Math.abs(l.pct) <= FLAT_BAND)) read = 'flat'
  else read = 'mixed'

  return {
    status, nights: during.length, beforeNights: before.length,
    avgActual, avgBefore, avgPlan, vsBefore, vsPlan,
    addedCovers, profitPerCover, addedProfit,
    net: addedProfit != null ? addedProfit - c.cost : null,
    read
  }
}

// Each weekday's share of an average normal night, whole restaurant, since the move.
function totalWeekdayShape(db: Db): Map<number, number> {
  const special = loadSpecialNights(db, NEW_LOCATION_START, '2099-12-31')
  const holidays = loadHolidayClosures(db, NEW_LOCATION_START, '2099-12-31')
  const rows = (db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date >= ?').all(NEW_LOCATION_START) as { date: string, covers: number }[])
    .filter(r => r.covers >= MIN_COVERS_FOR_OPEN_DAY && dowOf(r.date) !== 1 && !special.has(r.date) && !holidays.has(r.date))
  if (rows.length === 0) return new Map()
  const overall = mean(rows.map(r => r.covers))
  const by = new Map<number, number[]>()
  for (const r of rows) by.set(dowOf(r.date), [...(by.get(dowOf(r.date)) ?? []), r.covers])
  const shape = new Map<number, number>()
  for (const [dow, xs] of by) if (xs.length >= 3) shape.set(dow, mean(xs) / overall)
  return shape
}
