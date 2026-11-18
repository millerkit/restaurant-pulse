// Sales Strategy, step 1 (2026-11-18): the Breakeven math run for every open month of a year, so the
// owners can see which months need help and which kind of help is realistic. Powers Planning › Sales
// Strategy (/sales-strategy, owner-only by default deny). Nothing here is new math: each month is one
// computeBreakeven() call (server/utils/breakeven.ts), plus the Capacity model's seat limit for headroom.
//
// Each month is sorted into one of four kinds, measured at the P&L breakeven (fixed labor + kitchen crew
// + fixed opex) after planned events and retail, the same "still short" the Breakeven page headlines:
//   covered   — still short is zero or negative at expected covers
//   dine-in   — closable by more covers: the lift every night would need is within REALISTIC_LIFT_PCT
//               and within the seats the Capacity model says we have (max covers)
//   events    — dine-in alone can't close it (lift too big or beyond the seats): needs event,
//               catering or buyout money; reported as event sales and about-N-events
//   no-data   — Breakeven couldn't be computed (no recent covers / spend, or no cost targets)
// The cash line (+ loan principal) is returned alongside, not used for the kind.
import { computeBreakeven, restaurantYearMonth } from './breakeven'

// A sustained lift in covers every night that we'd call "realistic" without a campaign behind it.
// A judgment call, not a measurement; the page shows the real lift next to it so it can be revisited.
export const REALISTIC_LIFT_PCT = 0.10

// A seat that's full 100% of the time isn't a plan: focus targets room up to this share of a night's
// seats (another judgment call, like REALISTIC_LIFT_PCT).
export const REALISTIC_FILL_PCT = 0.85
const FOCUS_SLOTS_SHOWN = 3
const BUYOUT_NIGHTS_SHOWN = 2

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export type MonthKind = 'covered' | 'dine-in' | 'events' | 'no-data'

// How much each weekday runs above or below an area's own average night, from real Toast area covers since
// the move (the Capacity forecast is one level per area per month with no weekday shape, so on its own
// every weekday ties). Normal service nights only: dated special nights and holiday closures are left
// out, and so is any night under the open-day cover threshold. Needs MIN_SHAPE_NIGHTS per weekday, else
// that weekday reads as an average night (index 1).
const MIN_SHAPE_NIGHTS = 3
function weekdayShape(db: ReturnType<typeof useDb>): Map<string, number> {
  const rows = db.prepare(`
    SELECT m.date AS date, m.area_id AS areaId, m.covers AS covers,
      (SELECT SUM(covers) FROM daily_toast_area_metrics t WHERE t.date = m.date) AS dayCovers
    FROM daily_toast_area_metrics m WHERE m.date >= ? AND m.covers > 0
  `).all(NEW_LOCATION_START) as { date: string, areaId: number, covers: number, dayCovers: number }[]
  const special = loadSpecialNights(db, NEW_LOCATION_START, '2099-12-31')
  const holidays = loadHolidayClosures(db, NEW_LOCATION_START, '2099-12-31')
  const byDow = new Map<string, number[]>()
  const byArea = new Map<number, number[]>()
  for (const r of rows) {
    if (r.dayCovers < MIN_COVERS_FOR_OPEN_DAY || special.has(r.date) || holidays.has(r.date)) continue
    const dow = new Date(`${r.date}T00:00:00Z`).getUTCDay()
    if (dow === 1) continue
    byDow.set(`${dow}:${r.areaId}`, [...(byDow.get(`${dow}:${r.areaId}`) ?? []), r.covers])
    byArea.set(r.areaId, [...(byArea.get(r.areaId) ?? []), r.covers])
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const shape = new Map<string, number>()
  for (const [key, xs] of byDow) {
    const areaId = Number(key.split(':')[1])
    const overall = mean(byArea.get(areaId) ?? [])
    if (xs.length >= MIN_SHAPE_NIGHTS && overall > 0) shape.set(key, mean(xs) / overall)
  }
  return shape
}

export function computeSalesStrategy(db: ReturnType<typeof useDb>, year: number) {
  const today = restaurantYearMonth()
  const firstMonth = year === today.year ? today.month : 1
  const pad = (n: number) => String(n).padStart(2, '0')

  const lead = computeBookingLeadTimes(db)
  const shape = weekdayShape(db)
  const promoteLead = lead.available ? lead.all.p80Days : null
  // Event and buyout lead time isn't recorded; large parties are the closest stand-in. Until there are
  // enough of them, all bookings' lead time is a floor (events are booked earlier than a dinner for two).
  const eventLeadLarge = lead.available ? lead.large.p80Days : null
  const eventLead = eventLeadLarge ?? promoteLead
  const eventLeadBasis: 'large-parties' | 'all-bookings' | null = eventLead == null ? null : eventLeadLarge != null ? 'large-parties' : 'all-bookings'

  const months = []
  for (let month = firstMonth; month <= 12; month++) {
    const be = computeBreakeven(db, year, month)
    const pl = be.tiers.find(t => t.key === 'fixed_opex')!
    const cash = be.tiers.find(t => t.key === 'principal')!

    // Seat limit per normal night (before weekly closures lift the others, same as Capacity).
    const start = `${year}-${pad(month)}-01`
    const end = `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
    const sum = createCapacityModel(db, start, end).dayByDaySum(start, end)
    const maxCoversPerNight = sum.operatingDays > 0 ? sum.maxCovers / sum.operatingDays : null
    const headroomPct = maxCoversPerNight != null && be.expectedCoversPerNight
      ? maxCoversPerNight / be.expectedCoversPerNight - 1 : null

    const lift = pl.liftPct.withOther
    const short = pl.stillShort
    let kind: MonthKind
    if (short == null) kind = 'no-data'
    else if (short <= 0) kind = 'covered'
    else if (lift != null && lift <= REALISTIC_LIFT_PCT && (headroomPct == null || lift <= headroomPct)) kind = 'dine-in'
    else kind = 'events'

    // ---- Step 2: what's booked, where the room is, and when to act ----
    const special = [...loadSpecialNights(db, start, end).values()]
    const bookedEvents = special.filter(n => n.kind === 'event' || n.kind === 'offsite' || n.kind === 'catering').length
    const bookedBuyouts = special.filter(n => n.kind === 'buyout').length
    const bookedEventRevenue = special.reduce((sum, n) => sum + (n.kind === 'closed' ? 0 : n.eventRevenue), 0)

    // Room to grow by weekday x area: seats up to REALISTIC_FILL_PCT of capacity that the forecast leaves
    // empty, valued at that area's profit per cover (spend x contribution rate - FOH labor per cover).
    const model = createCapacityModel(db, start, end)
    const slots = new Map<string, { dow: number, area: string, nights: number, spare: number, profit: number }>()
    const dowRevenue = new Map<number, { total: number, n: number }>()
    for (let d = start; d <= end; d = addDaysIso(d, 1)) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
      if (dow === 1 || model.replaced.has(d)) continue
      const night = model.nightlyExpectedOn(d)
      if (night.revenue > 0) {
        const agg = dowRevenue.get(dow) ?? { total: 0, n: 0 }
        dowRevenue.set(dow, { total: agg.total + night.revenue, n: agg.n + 1 })
      }
      if (be.contribRate == null) continue
      for (const area of model.areas) {
        const e = model.areaExpectedOn(area, d)
        if (!e) continue
        const expected = e.covers * (shape.get(`${dow}:${area.id}`) ?? 1)
        const spare = Math.max(0, e.maxCovers * REALISTIC_FILL_PCT - expected)
        const perCover = (area.per_cover_revenue_food + area.per_cover_revenue_beverage) * be.contribRate - be.fohPerCover
        if (spare <= 0 || perCover <= 0) continue
        const key = `${dow}:${area.id}`
        const cur = slots.get(key) ?? { dow, area: area.name, nights: 0, spare: 0, profit: 0 }
        cur.nights++; cur.spare += spare; cur.profit += spare * perCover
        slots.set(key, cur)
      }
    }
    const focus = [...slots.values()].sort((a, b) => b.profit - a.profit).slice(0, FOCUS_SLOTS_SHOWN).map(x => ({
      weekday: WEEKDAYS.find(w => w.dow === x.dow)?.short ?? '', area: x.area, nights: x.nights,
      spareCoversPerNight: x.spare / x.nights, monthlyProfit: x.profit
    }))
    // A buyout adds its price minus that weekday's normal night, so it's worth most on the quietest nights.
    const buyoutNights = [...dowRevenue.entries()]
      .map(([dow, a]) => ({ dow, avg: a.total / a.n }))
      .sort((a, b) => a.avg - b.avg).slice(0, BUYOUT_NIGHTS_SHOWN)
      .map(x => ({ weekday: WEEKDAYS.find(w => w.dow === x.dow)?.short ?? '', normalNightSales: x.avg }))
    const actBy = {
      promote: promoteLead != null ? addDaysIso(start, -promoteLead) : null,
      events: eventLead != null ? addDaysIso(start, -eventLead) : null,
      eventsBasis: eventLeadBasis
    }

    const eventsNeeded = short != null && short > 0 && be.planned.avgEventSize
      ? Math.ceil(pl.eventSalesNeeded / be.planned.avgEventSize) : null

    months.push({
      month, kind,
      costs: pl.monthly,
      stillShort: short,
      cashStillShort: cash.stillShort,
      expectedCoversPerNight: be.expectedCoversPerNight,
      coversSource: be.coversSource,
      maxCoversPerNight,
      headroomPct,
      liftPct: lift,
      coversNeededPerNight: pl.coversPerNightWithOther,
      eventSalesNeeded: pl.eventSalesNeeded,
      eventsNeeded,
      plannedEventsRevenue: be.planned.eventsRevenue,
      nights: be.nights,
      laborBudgeted: be.laborBudgeted,
      bookedEvents, bookedBuyouts, bookedEventRevenue,
      focus, buyoutNights, actBy
    })
  }

  // Event size is the same for every month (all dated event nights), so read it once.
  const probe = computeBreakeven(db, year, firstMonth)
  return {
    year, today, firstMonth,
    realisticLiftPct: REALISTIC_LIFT_PCT,
    avgEventSize: probe.planned.avgEventSize,
    asOfDate: probe.asOfDate,
    todayIso: todayIso(),
    realisticFillPct: REALISTIC_FILL_PCT,
    leadTimes: lead,
    months
  }
}
