// Breakeven — how much each layer of cost that doesn't flex with volume needs from dine-in
// covers, planned events/buyouts/catering and retail, and what's still short after all three
// (see CLAUDE.md's "Breakeven" section). Powers Planning › Breakeven (/breakeven, owner-only).
//
// The gap view (2026-11-14): costs − dine-in margin at EXPECTED covers − planned events margin −
// planned retail margin = still short, also expressed as event sales needed. Expected covers are
// the recent average for the current month and the Capacity forecast for later months (with the
// recent weekday shape scaled to the forecast).
//
// Tiers are CUMULATIVE, each adding one more block of fixed cost on top of the last:
//   1. Fixed labor     — supervision + overhead + growth roles (labor_position_settings.role_class),
//                        unclassified wage roles, Additional Pay, benefits, and the payroll taxes on them
//   2. + Kitchen crew  — direct-class BOH hourly wages (semi-fixed: a minimum crew regardless of covers)
//   3. + Fixed opex    — opex accounts with cost_behavior='fixed' (rent, insurance, loan interest ...)
//                        => the P&L breakeven
//   4. + Loan principal — scheduled principal from loan_schedule, which QBO's P&L never shows
//                        => the cash breakeven (interest is already inside fixed opex via 7020)
//
// Labor is restated to an average payroll month by default (wages × the year's paychecks ÷ 12 ÷ this
// month's paychecks); ?payroll=month keeps the month's real paychecks.
// Everything labor/opex comes from the saved month budget (budget_targets), so it reflects what
// the Labor/Edit Budget tabs currently say; spend per cover and covers/night come from a trailing
// 8-week window of real data (Toast covers, core dine-in QBO revenue), using the same open-day
// filter as the Dashboard's weekday targets. Direct FOH hourly is treated as VARIABLE (a per-cover
// cost at current volume), not a fixed tier — tipped FOH hours flex with covers.
//
// Contribution per cover = spend x (1 - COGS% - variable opex%) - FOH labor per cover, with COGS%
// and variable opex% taken from category_benchmarks (the app's own standards), not recent actuals.
// Only CORE dine-in revenue is modeled: events/catering/retail margin lowers the covers needed
// further but isn't part of this per-cover framing.
import { fridaysInMonth } from '#shared/utils/labor-model'

const RESTAURANT_TIME_ZONE = 'America/New_York'
const WINDOW_DAYS = 56

const pad = (n: number) => String(n).padStart(2, '0')
function localToday(): { year: number, month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: RESTAURANT_TIME_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return { year: Number(parts.find(p => p.type === 'year')!.value), month: Number(parts.find(p => p.type === 'month')!.value) }
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// Operating nights in a month: every non-Monday (the standing closure), minus that month's
// holidays and non-buyout special nights (replacedNightsByMonth) — same as capacity.get.ts.
function operatingNights(year: number, month: number, holidayClosures: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  let n = 0
  for (let day = 1; day <= days; day++) if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1) n++
  return Math.max(0, n - holidayClosures)
}

export default defineEventHandler((event) => {
  const db = useDb()
  const today = localToday()
  const q = getQuery(event)
  // Current month through December of next year.
  let year = Number(q.year) || today.year
  if (year < today.year) year = today.year
  if (year > today.year + 1) year = today.year + 1
  const minMonth = year === today.year ? today.month : 1
  const month = Math.min(12, Math.max(minMonth, Number(q.month) || minMonth))
  const mm = pad(month)
  const isCurrentMonth = year === today.year && month === today.month

  // ---- Costs from the saved month budget ---------------------------------------------------
  const laborRows = db.prepare(`
    SELECT lps.pay_type AS payType, lps.role_class AS roleClass, lps.ot_base_group AS otBaseGroup,
           p.account_number AS parentNumber, bt.amount AS amount
    FROM labor_position_settings lps
    JOIN accounts a ON a.id = lps.account_id
    LEFT JOIN accounts p ON p.id = a.parent_account_id
    LEFT JOIN budget_targets bt ON bt.account_id = a.id AND bt.year = ? AND bt.month = ?
    WHERE a.is_active = 1
  `).all(year, month) as { payType: string, roleClass: string | null, otBaseGroup: string | null, parentNumber: string | null, amount: number | null }[]

  const laborBudgeted = laborRows.some(r => r.amount != null && r.amount > 0)
  let taxTotal = 0, benefits = 0, subject = 0
  let fixedWages = 0, kitchenWages = 0, variableWages = 0, otherFlat = 0
  for (const r of laborRows) {
    const amt = r.amount ?? 0
    if (r.payType === 'tax') { taxTotal += amt; continue }
    if (r.parentNumber === '6060') { benefits += amt; continue }
    subject += amt
    if (r.payType === 'flat') { otherFlat += amt; continue }
    const isBoh = r.otBaseGroup === 'boh' || r.parentNumber === '6010'
    if (r.roleClass === 'direct') {
      if (isBoh) kitchenWages += amt
      else variableWages += amt
    } else {
      // supervision / overhead / growth — and anything still unclassified, treated as fixed
      // (the conservative reading: don't let an untagged role silently look variable).
      fixedWages += amt
    }
  }
  const taxRate = subject > 0 ? taxTotal / subject : 0
  // Payroll posts every Friday (cash basis), so a 5-Friday month carries ~25% more wages than a
  // 4-Friday one. "Average payroll month" (the default, 2026-11-17) restates wages and their payroll
  // taxes at the year's paychecks ÷ 12, so a month is judged on a normal month's labor, not on paycheck
  // timing; ?payroll=month shows the month's real paychecks (what Budget and Cash & Loans use).
  // Benefits and flat monthly pay don't depend on paydays and are never restated.
  const payrollMode: 'average' | 'month' = q.payroll === 'month' ? 'month' : 'average'
  const monthPaychecks = fridaysInMonth(year, month)
  const averagePaychecks = Array.from({ length: 12 }, (_, i) => fridaysInMonth(year, i + 1)).reduce((s, n) => s + n, 0) / 12
  const payrollFactor = payrollMode === 'average' && monthPaychecks > 0 ? averagePaychecks / monthPaychecks : 1
  const laborWith = (f: number) => ({
    fixedLabor: (fixedWages * f + otherFlat) * (1 + taxRate) + benefits,
    kitchenCrew: kitchenWages * f * (1 + taxRate),
    variableLabor: variableWages * f * (1 + taxRate)
  })
  const { fixedLabor, kitchenCrew, variableLabor } = laborWith(payrollFactor)
  // How much more (or less) the month's real paychecks cost than an average payroll month.
  const cashLabor = laborWith(1)
  const averageLabor = laborWith(monthPaychecks > 0 ? averagePaychecks / monthPaychecks : 1)
  const paycheckTimingDifference = (cashLabor.fixedLabor + cashLabor.kitchenCrew + cashLabor.variableLabor)
    - (averageLabor.fixedLabor + averageLabor.kitchenCrew + averageLabor.variableLabor)

  const fixedOpex = (db.prepare(`
    SELECT COALESCE(SUM(bt.amount), 0) AS total
    FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE a.category = 'opex' AND a.cost_behavior = 'fixed' AND a.is_active = 1 AND bt.year = ? AND bt.month = ?
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)
  `).get(year, month) as { total: number }).total
  const loanPrincipal = (db.prepare(`
    SELECT COALESCE(SUM(principal), 0) AS total FROM loan_schedule WHERE payment_date LIKE ?
  `).get(`${year}-${mm}-%`) as { total: number }).total

  // ---- Real trailing volume + spend (open days only) --------------------------------------
  const asOfRow = db.prepare('SELECT MAX(date) AS date FROM daily_toast_metrics').get() as { date: string | null }
  const asOfDate = asOfRow.date
  const windowStart = asOfDate ? addDaysIso(asOfDate, -(WINDOW_DAYS - 1)) : null

  type OpenDay = { date: string, dow: number, revenue: number, covers: number }
  const allOpenDays: OpenDay[] = []
  if (asOfDate && windowStart) {
    const corePlaceholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
    const revenueByDate = new Map((db.prepare(`
      SELECT dli.date AS date, SUM(dli.amount) AS revenue
      FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.account_number IN (${corePlaceholders}) AND a.is_active = 1 AND dli.date BETWEEN ? AND ?
      GROUP BY dli.date
    `).all(...CORE_REVENUE_ACCOUNT_NUMBERS, windowStart, asOfDate) as { date: string, revenue: number }[]).map(r => [r.date, r.revenue]))
    const coverRows = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date BETWEEN ? AND ?').all(windowStart, asOfDate) as { date: string, covers: number }[]
    for (const { date, covers } of coverRows) {
      const revenue = revenueByDate.get(date)
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
      if (covers < MIN_COVERS_FOR_OPEN_DAY || revenue == null || revenue <= 0 || dow === 1) continue
      allOpenDays.push({ date, dow, revenue, covers })
    }
  }
  // Excluded nights are returned and listed on the page, never dropped silently.
  const { kept: openDays, excluded: excludedNights } = excludeSpendOutliers(allOpenDays)
  const totalCovers = openDays.reduce((s, d) => s + d.covers, 0)
  const totalRevenue = openDays.reduce((s, d) => s + d.revenue, 0)
  const avgCoversPerNight = openDays.length > 0 ? totalCovers / openDays.length : null
  const avgSpend = totalCovers > 0 ? totalRevenue / totalCovers : null

  // Holidays and special nights other than buyouts aren't normal service nights.
  const holiday = replacedNightsByMonth(db, year).get(month) ?? 0
  const nights = operatingNights(year, month, holiday)

  // ---- Expected covers for the month ---------------------------------------------------------
  // Current month: the recent average (what we're doing now). Later months: the Capacity
  // forecast's covers per normal night, so seasonality is in (a slow January isn't judged
  // against an October average).
  let forecastCoversPerNight: number | null = null
  if (!isCurrentMonth) {
    const monthStart = `${year}-${mm}-01`
    const monthEndIso = `${year}-${mm}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
    const model = createCapacityModel(db, monthStart, monthEndIso)
    const sum = model.dayByDaySum(monthStart, monthEndIso)
    forecastCoversPerNight = sum.operatingDays > 0 ? sum.expectedCovers / sum.operatingDays : null
  }
  const expectedCoversPerNight = isCurrentMonth ? avgCoversPerNight : (forecastCoversPerNight ?? avgCoversPerNight)
  const coversSource: 'recent' | 'forecast' = !isCurrentMonth && forecastCoversPerNight != null ? 'forecast' : 'recent'
  // Recent weekday shape scaled to the expected level.
  const expectedScale = expectedCoversPerNight != null && avgCoversPerNight ? expectedCoversPerNight / avgCoversPerNight : 1

  // ---- Contribution + tiers ----------------------------------------------------------------
  const bench = new Map((db.prepare('SELECT category, target_pct AS pct FROM category_benchmarks').all() as { category: string, pct: number }[]).map(r => [r.category, r.pct]))
  const cogsPct = bench.get('cogs') ?? null
  const varOpexPct = bench.get('opex_variable') ?? null

  const contribRate = cogsPct != null && varOpexPct != null ? 1 - cogsPct - varOpexPct : null
  const fohPerCover = expectedCoversPerNight && nights > 0 ? variableLabor / (nights * expectedCoversPerNight) : 0
  const contribPerCover = (spend: number | null) => (spend != null && contribRate != null ? spend * contribRate - fohPerCover : null)

  // ---- Planned events, buyouts, catering and retail -----------------------------------------
  // Revenue from the saved month budget (leaf rows only): Event Sales / Catering 41xx–42xx,
  // Retail 43xx. Future months' event budget already follows the dated special nights.
  const budgetSum = (glob: string, category: string) => (db.prepare(`
    SELECT COALESCE(SUM(bt.amount), 0) AS total
    FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE a.category = ? AND a.account_number GLOB ? AND a.is_active = 1 AND bt.year = ? AND bt.month = ?
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)
  `).get(category, glob, year, month) as { total: number }).total
  const eventSales = budgetSum('4[12]*', 'revenue')
  // Dated buyouts (price above a normal night) and the dine-in diners on nights an event replaces
  // service — both are special-night money the covers forecast doesn't include.
  const buyoutExtra = plannedBuyoutIncrement(db, year, month).total
  const replacedDineIn = specialNightAdditions(db, year, month, 0.65).dineIn
  // Event food & drink costs mostly post to the same accounts as dine-in (5010 etc.), so a
  // separate event cost % can't be measured: events use the same food & drink cost target and
  // variable-expense % as dine-in. Event-only labor isn't modeled (caveat shown on the page).
  const eventsRevenue = eventSales + buyoutExtra + replacedDineIn
  const eventsMargin = contribRate != null ? eventsRevenue * contribRate : 0

  const retailSales = budgetSum('43*', 'revenue')
  // Retail cost %: actual 53xx ÷ 43xx since the move when there's enough history ($1,000+ sales),
  // else this month's budgeted ratio, else the food & drink cost target.
  const actualSum = (glob: string, category: string) => (db.prepare(`
    SELECT COALESCE(SUM(dli.amount), 0) AS total
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.category = ? AND a.account_number GLOB ? AND dli.date >= ?
  `).get(category, glob, NEW_LOCATION_START) as { total: number }).total
  const retailActualSales = actualSum('43*', 'revenue')
  const retailActualCost = actualSum('53*', 'cogs')
  const retailBudgetCost = budgetSum('53*', 'cogs')
  let retailCostPct: number | null = cogsPct
  let retailCostBasis: 'actual' | 'budget' | 'target' = 'target'
  if (retailActualSales >= 1000) { retailCostPct = retailActualCost / retailActualSales; retailCostBasis = 'actual' }
  else if (retailSales > 0 && retailBudgetCost > 0) { retailCostPct = retailBudgetCost / retailSales; retailCostBasis = 'budget' }
  const retailMargin = retailCostPct != null && varOpexPct != null ? retailSales * (1 - retailCostPct - varOpexPct) : 0
  const plannedOtherMargin = eventsMargin + retailMargin

  // Typical event size, for "about N more events" (dated special nights with event revenue).
  const avgEvent = (db.prepare(`
    SELECT AVG(event_revenue) AS avg, COUNT(*) AS n FROM special_nights
    WHERE kind IN ('event', 'offsite', 'catering') AND event_revenue > 0
  `).get() as { avg: number | null, n: number })

  const cumulative = [
    { key: 'fixed_labor', label: 'Fixed labor', detail: 'supervision, overhead, growth roles, benefits & payroll taxes', monthly: fixedLabor },
    { key: 'kitchen', label: '+ Kitchen crew', detail: 'direct BOH hourly wages & taxes', monthly: fixedLabor + kitchenCrew },
    { key: 'fixed_opex', label: '+ Fixed opex (P&L breakeven)', detail: 'rent, insurance, loan interest, other fixed opex', monthly: fixedLabor + kitchenCrew + fixedOpex },
    { key: 'principal', label: '+ Loan principal (cash breakeven)', detail: 'scheduled principal — not on the P&L', monthly: fixedLabor + kitchenCrew + fixedOpex + loanPrincipal }
  ]

  // ---- By weekday: needed covers follow each night's real pattern ----------------------------
  // Every night is asked to lift by the SAME percentage over its expected covers, so a quiet
  // Tuesday needs a little more and a busy Friday carries most of the load. Solve for the common
  // multiplier k:  sum over the month's nights of (k x expectedCovers_w x contribution_w) = cost
  // using how many of each weekday the month has (scaled to `nights`, so holidays and replaced
  // special nights come off proportionally). If any weekday lacks recent data, fall back to an
  // equal share per night (cost / nights / that weekday's contribution).
  const weekdayStats = WEEKDAYS.map((w) => {
    const days = openDays.filter(d => d.dow === w.dow)
    const covers = days.reduce((s, d) => s + d.covers, 0)
    const revenue = days.reduce((s, d) => s + d.revenue, 0)
    const avgCovers = days.length > 0 ? covers / days.length : null
    return { w, sampleDays: days.length, avgCovers, expectedCovers: avgCovers != null ? avgCovers * expectedScale : null, spend: covers > 0 ? revenue / covers : null }
  })
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const dowCount = new Map<number, number>()
  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    dowCount.set(dow, (dowCount.get(dow) ?? 0) + 1)
  }
  const rawNights = weekdayStats.reduce((s, x) => s + (dowCount.get(x.w.dow) ?? 0), 0)
  const nightScale = rawNights > 0 ? nights / rawNights : 0
  // Monthly dine-in contribution at expected covers (k = 1).
  let dineInMargin: number | null = 0
  for (const x of weekdayStats) {
    const c = contribPerCover(x.spend)
    if (x.expectedCovers == null || c == null || c <= 0) { dineInMargin = null; break }
    dineInMargin += (dowCount.get(x.w.dow) ?? 0) * nightScale * x.expectedCovers * c
  }
  const weighted = dineInMargin != null && dineInMargin > 0
  // Flat fallback for the dine-in margin when the weekday pattern is incomplete.
  const dineInMarginFlat = expectedCoversPerNight != null && contribPerCover(avgSpend) != null
    ? nights * expectedCoversPerNight * contribPerCover(avgSpend)! : null
  const dineInMarginUsed = weighted ? dineInMargin! : dineInMarginFlat

  // Covers/night needed (month average) for a cost amount, at the overall average spend.
  const coversNeeded = (monthly: number, spend: number | null): number | null => {
    const c = contribPerCover(spend)
    return c != null && c > 0 && nights > 0 ? Math.max(0, monthly) / nights / c : null
  }
  // Same in "lift" terms: multiplier on every night's expected covers.
  const liftFor = (monthly: number) => (weighted ? Math.max(0, monthly) / dineInMargin! : null)

  const tiers = cumulative.map((t) => {
    const afterOther = t.monthly - plannedOtherMargin
    const stillShort = dineInMarginUsed != null ? t.monthly - dineInMarginUsed - plannedOtherMargin : null
    return {
      ...t,
      // Dine-in only (the "Michelin" reading) and after planned events & retail.
      coversPerNight: coversNeeded(t.monthly, avgSpend),
      coversPerNightWithOther: coversNeeded(afterOther, avgSpend),
      stillShort,
      // Event sales that would close the gap at the events margin rate.
      eventSalesNeeded: stillShort != null && stillShort > 0 && contribRate ? stillShort / contribRate : 0,
      liftPct: { dineInOnly: liftFor(t.monthly) != null ? liftFor(t.monthly)! - 1 : null, withOther: liftFor(afterOther) != null ? liftFor(afterOther)! - 1 : null }
    }
  })

  const weekdays = weekdayStats.map(({ w, sampleDays, avgCovers, expectedCovers, spend }) => {
    const needed = (monthly: number) => {
      if (weighted) return expectedCovers! * (Math.max(0, monthly) / dineInMargin!)
      return coversNeeded(monthly, spend)
    }
    return {
      key: w.key, label: w.label, short: w.short, sampleDays, avgCovers, expectedCovers, avgSpend: spend,
      coversNeeded: Object.fromEntries(cumulative.map(t => [t.key, needed(t.monthly)])),
      coversNeededWithOther: Object.fromEntries(cumulative.map(t => [t.key, needed(t.monthly - plannedOtherMargin)]))
    }
  })

  return {
    year, month, isCurrentMonth, today, asOfDate, windowStart, sampleOpenDays: openDays.length, nights,
    laborBudgeted,
    payroll: { mode: payrollMode, monthPaychecks, averagePaychecks, paycheckTimingDifference },
    avgCoversPerNight, avgSpend, excludedNights,
    expectedCoversPerNight, coversSource,
    cogsPct, varOpexPct, contribRate, fohPerCover,
    contribPerCover: contribPerCover(avgSpend),
    components: { fixedLabor, kitchenCrew, variableLabor, fixedOpex, loanPrincipal },
    dineInMargin: dineInMarginUsed,
    planned: {
      eventSales, buyoutExtra, replacedDineIn, eventsRevenue, eventsMargin,
      retailSales, retailCostPct, retailCostBasis, retailMargin,
      avgEventSize: avgEvent.n > 0 ? avgEvent.avg : null
    },
    tiers, weekdays, weekdayWeighting: weighted ? 'pattern' : 'equal'
  }
})
