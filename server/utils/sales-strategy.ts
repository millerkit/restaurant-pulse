// Sales Strategy, step 1 (2026-11-18): the Breakeven math run for every open month of a year, so the
// owners can see which months need help and which kind of help is realistic. Powers Planning › Sales
// Strategy (/sales-strategy, owner-only by default deny). Nothing here is new math: each month is one
// computeBreakeven() call (server/utils/breakeven.ts), plus the Capacity model's seat limit for headroom.
//
// Each month is sorted by what closes its gap at the P&L breakeven (fixed labor + kitchen crew + fixed
// opex) after planned events and retail, the same "still short" the Breakeven page headlines. Kit's
// constraint (2026-11-19): at most MAX_EVENTS_PER_MONTH special event (on-site or off-site; catering is a
// separate lever) a month; the rest has to come from covers, buyouts (at most MAX_BUYOUTS_PER_MONTH),
// catering or retail. The levers are applied in this order:
//   1. one event at the typical on-site/off-site size, unless one is already dated that month
//   2. more covers, up to REALISTIC_LIFT_PCT every night and within Capacity's max covers
//   3. buyouts on the nights where one adds most (its rate − that weekday's forecast normal night),
//      up to the cap less any already dated
//   4. whatever is left is "still to find": catering, retail, or covers beyond the realistic lift
// Kinds: covered (no gap) / dine-in (covers alone, within the realistic lift) / event (one event + covers)
// / buyouts (also needs buyouts, within the cap) / gap (still short after all of it) / no-data.
// The cash line (+ loan principal) is returned alongside, not used for the kind.
import { computeBreakeven, restaurantYearMonth } from './breakeven'

// A sustained lift in covers every night that we'd call "realistic" without a campaign behind it.
// A judgment call, not a measurement; the page shows the real lift next to it so it can be revisited.
export const REALISTIC_LIFT_PCT = 0.10

// A seat that's full 100% of the time isn't a plan: focus targets room up to this share of a night's
// seats (another judgment call, like REALISTIC_LIFT_PCT).
export const REALISTIC_FILL_PCT = 0.85
const FOCUS_SLOTS_SHOWN = 3
// Kit, 2026-11-19: realistically no more than one special event a month (catering doesn't count toward
// it), and buyouts capped at two a month so a month that needs more reads as a real gap.
export const MAX_EVENTS_PER_MONTH = 1
export const MAX_BUYOUTS_PER_MONTH = 2
const BUYOUT_NIGHTS_SHOWN = 2

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export type MonthKind = 'covered' | 'dine-in' | 'event' | 'buyouts' | 'gap' | 'no-data'

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

// Float leftovers (covers sized to close a gap exactly) must not trigger the next lever.
const CENT = 0.01

export type GapPlan = {
  event: null | { sales: number, profit: number }
  covers: null | { liftPct: number, profit: number }
  buyouts: null | { count: number, nights: { weekday: string, extraSales: number }[], profit: number }
  stillToFind: number, stillToFindSales: number | null
  eventSlotUsed: boolean, buyoutSlotsLeft: number
}

// The ladder for one month, pure so it can be checked by hand. short = P&L still short after planned
// events & retail; lift = the every-night covers lift that would close it alone (profit is linear in lift:
// Breakeven's lift = gap ÷ dine-in margin at expected covers); profits are sales × contribRate.
export function planMonthGap(i: {
  short: number | null, lift: number | null, headroomPct: number | null, contribRate: number | null,
  eventSize: number | null, eventSlotUsed: boolean, buyoutSlotsLeft: number,
  bestBuyout: { weekday: string, extraSales: number } | null
}): { kind: MonthKind, plan: GapPlan } {
  const c = i.contribRate
  const plan: GapPlan = { event: null, covers: null, buyouts: null, stillToFind: 0, stillToFindSales: null, eventSlotUsed: i.eventSlotUsed, buyoutSlotsLeft: i.buyoutSlotsLeft }
  if (i.short == null) return { kind: 'no-data', plan }
  if (i.short <= 0) return { kind: 'covered', plan }
  const liftCap = Math.max(0, Math.min(REALISTIC_LIFT_PCT, i.headroomPct ?? Infinity))
  if (i.lift != null && i.lift <= liftCap) {
    plan.covers = { liftPct: i.lift, profit: i.short }
    return { kind: 'dine-in', plan }
  }
  let remaining = i.short
  if (!i.eventSlotUsed && i.eventSize && c) {
    plan.event = { sales: i.eventSize, profit: i.eventSize * c }
    remaining -= plan.event.profit
  }
  const profitPerLift = i.lift != null && i.lift > 0 ? i.short / i.lift : null
  if (remaining > CENT && profitPerLift && liftCap > 0) {
    const l = Math.min(liftCap, remaining / profitPerLift)
    plan.covers = { liftPct: l, profit: l * profitPerLift }
    remaining -= plan.covers.profit
  }
  if (remaining > CENT && c && i.buyoutSlotsLeft > 0 && i.bestBuyout) {
    const b = i.bestBuyout
    const count = Math.min(i.buyoutSlotsLeft, Math.ceil(remaining / (b.extraSales * c)))
    plan.buyouts = { count, nights: Array.from({ length: count }, () => b), profit: count * b.extraSales * c }
    remaining -= plan.buyouts.profit
  }
  plan.stillToFind = remaining > CENT ? remaining : 0
  plan.stillToFindSales = c ? plan.stillToFind / c : null
  return { kind: plan.stillToFind > 0 ? 'gap' : plan.buyouts ? 'buyouts' : 'event', plan }
}

export function computeSalesStrategy(db: ReturnType<typeof useDb>, year: number) {
  const today = restaurantYearMonth()
  const firstMonth = year === today.year ? today.month : 1
  const pad = (n: number) => String(n).padStart(2, '0')

  const lead = computeBookingLeadTimes(db)
  const shape = weekdayShape(db)
  const promoteLead = lead.available ? lead.all.p80Days : null
  // Event outreach lead time, best source first: real booked-on dates on dated events/buyouts (migration
  // 0027), else large-party reservations as a stand-in, else all bookings as a floor (events are booked
  // earlier than a dinner for two).
  const eventLeads = computeEventLeadTimes(db)
  const eventLeadLarge = lead.available ? lead.large.p80Days : null
  const eventLead = eventLeads.p80Days ?? eventLeadLarge ?? promoteLead
  const eventLeadBasis: 'booked-events' | 'large-parties' | 'all-bookings' | null = eventLead == null ? null
    : eventLeads.p80Days != null ? 'booked-events' : eventLeadLarge != null ? 'large-parties' : 'all-bookings'

  // Typical special event: dated on-site/off-site nights with event revenue (catering is its own lever,
  // so it's left out here, unlike Breakeven's avgEventSize).
  const typicalEvent = (db.prepare(`
    SELECT AVG(event_revenue) AS avg, COUNT(*) AS n FROM special_nights
    WHERE kind IN ('event', 'offsite') AND event_revenue > 0
  `).get() as { avg: number | null, n: number })
  const eventSize = typicalEvent.n > 0 ? typicalEvent.avg : null
  const buyoutRates = loadBuyoutRates(db)

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
    // ---- Step 2: what's booked, where the room is, and when to act ----
    const special = [...loadSpecialNights(db, start, end).values()]
    const bookedEvents = special.filter(n => n.kind === 'event' || n.kind === 'offsite' || n.kind === 'catering').length
    const bookedSpecialEvents = special.filter(n => n.kind === 'event' || n.kind === 'offsite').length
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
      // The night's expected sales with each area's real weekday pattern applied (the forecast alone has
      // none, so the quietest nights would just be whichever areas are closed).
      let nightRevenue = 0
      for (const area of model.areas) {
        const e = model.areaExpectedOn(area, d)
        if (e) nightRevenue += e.covers * (shape.get(`${dow}:${area.id}`) ?? 1) * (area.per_cover_revenue_food + area.per_cover_revenue_beverage)
      }
      if (nightRevenue > 0) {
        const agg = dowRevenue.get(dow) ?? { total: 0, n: 0 }
        dowRevenue.set(dow, { total: agg.total + nightRevenue, n: agg.n + 1 })
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

    // ---- The ladder (Kit, 2026-11-19): one event, realistic covers, capped buyouts, then what's left ----
    // Where a buyout adds most: its rate minus that weekday's forecast normal night (dowRevenue).
    const bestBuyout = buyoutWeekdaysFor(buyoutRates, start)
      .filter(w => w.dow !== 1 && dowRevenue.has(w.dow))
      .map(w => ({ weekday: w.short, extraSales: w.rate - dowRevenue.get(w.dow)!.total / dowRevenue.get(w.dow)!.n }))
      .filter(w => w.extraSales > 0)
      .sort((a, b) => b.extraSales - a.extraSales)[0] ?? null
    const { kind, plan } = planMonthGap({
      short, lift, headroomPct, contribRate: be.contribRate, eventSize,
      eventSlotUsed: bookedSpecialEvents >= MAX_EVENTS_PER_MONTH,
      buyoutSlotsLeft: Math.max(0, MAX_BUYOUTS_PER_MONTH - bookedBuyouts),
      bestBuyout
    })

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
      plan,
      plannedEventsRevenue: be.planned.eventsRevenue,
      nights: be.nights,
      laborBudgeted: be.laborBudgeted,
      bookedEvents, bookedSpecialEvents, bookedBuyouts, bookedEventRevenue,
      focus, buyoutNights, actBy
    })
  }

  const probe = computeBreakeven(db, year, firstMonth)
  return {
    year, today, firstMonth,
    realisticLiftPct: REALISTIC_LIFT_PCT,
    avgEventSize: eventSize,
    typicalEventCount: typicalEvent.n,
    maxEventsPerMonth: MAX_EVENTS_PER_MONTH,
    maxBuyoutsPerMonth: MAX_BUYOUTS_PER_MONTH,
    buyoutRates: { weekday: buyoutRates.weekdayRate, weekend: buyoutRates.weekendRate },
    asOfDate: probe.asOfDate,
    todayIso: todayIso(),
    realisticFillPct: REALISTIC_FILL_PCT,
    leadTimes: lead,
    eventLeadTimes: eventLeads,
    months
  }
}
