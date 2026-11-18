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

export type MonthKind = 'covered' | 'dine-in' | 'events' | 'no-data'

export function computeSalesStrategy(db: ReturnType<typeof useDb>, year: number) {
  const today = restaurantYearMonth()
  const firstMonth = year === today.year ? today.month : 1
  const pad = (n: number) => String(n).padStart(2, '0')

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
      laborBudgeted: be.laborBudgeted
    })
  }

  // Event size is the same for every month (all dated event nights), so read it once.
  const probe = computeBreakeven(db, year, firstMonth)
  return {
    year, today, firstMonth,
    realisticLiftPct: REALISTIC_LIFT_PCT,
    avgEventSize: probe.planned.avgEventSize,
    asOfDate: probe.asOfDate,
    months
  }
}
