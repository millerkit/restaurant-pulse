// Breakeven covers/night — how many covers a night core dine-in sales need to carry each
// layer of cost that doesn't flex with volume (see CLAUDE.md's "Breakeven covers/night"
// section for the full reasoning). Powers the card on the Capacity Pace page.
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
const RESTAURANT_TIME_ZONE = 'America/New_York'
const WINDOW_DAYS = 56

function localToday(): { year: number, month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: RESTAURANT_TIME_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return { year: Number(parts.find(p => p.type === 'year')!.value), month: Number(parts.find(p => p.type === 'month')!.value) }
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// Operating nights in a month: every non-Monday (the standing closure), minus that month's flat
// holiday-closure count (capacity_seasonality) — same convention as capacity.get.ts.
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
  const year = today.year
  const month = Math.min(12, Math.max(1, Number(q.month) || today.month))
  const mm = String(month).padStart(2, '0')

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
  const fixedLabor = (fixedWages + otherFlat) * (1 + taxRate) + benefits
  const kitchenCrew = kitchenWages * (1 + taxRate)
  const variableLabor = variableWages * (1 + taxRate)

  const fixedOpex = (db.prepare(`
    SELECT COALESCE(SUM(bt.amount), 0) AS total
    FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE a.category = 'opex' AND a.cost_behavior = 'fixed' AND a.is_active = 1 AND bt.year = ? AND bt.month = ?
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
  // Excluded nights are returned and listed on the card, never dropped silently.
  const { kept: openDays, excluded: excludedNights } = excludeSpendOutliers(allOpenDays)
  const totalCovers = openDays.reduce((s, d) => s + d.covers, 0)
  const totalRevenue = openDays.reduce((s, d) => s + d.revenue, 0)
  const avgCoversPerNight = openDays.length > 0 ? totalCovers / openDays.length : null
  const avgSpend = totalCovers > 0 ? totalRevenue / totalCovers : null

  // ---- Contribution + tiers ----------------------------------------------------------------
  const bench = new Map((db.prepare('SELECT category, target_pct AS pct FROM category_benchmarks').all() as { category: string, pct: number }[]).map(r => [r.category, r.pct]))
  const cogsPct = bench.get('cogs') ?? null
  const varOpexPct = bench.get('opex_variable') ?? null
  const holiday = (db.prepare('SELECT holiday_closures AS n FROM capacity_seasonality WHERE month = ?').get(month) as { n: number } | undefined)?.n ?? 0
  const nights = operatingNights(year, month, holiday)

  const contribRate = cogsPct != null && varOpexPct != null ? 1 - cogsPct - varOpexPct : null
  const fohPerCover = avgCoversPerNight && nights > 0 ? variableLabor / (nights * avgCoversPerNight) : 0
  const contribPerCover = (spend: number | null) => (spend != null && contribRate != null ? spend * contribRate - fohPerCover : null)

  const cumulative = [
    { key: 'fixed_labor', label: 'Fixed labor', detail: 'supervision, overhead, growth roles, benefits & payroll taxes', monthly: fixedLabor },
    { key: 'kitchen', label: '+ Kitchen crew', detail: 'direct BOH hourly wages & taxes', monthly: fixedLabor + kitchenCrew },
    { key: 'fixed_opex', label: '+ Fixed opex (P&L breakeven)', detail: 'rent, insurance, loan interest, other fixed opex', monthly: fixedLabor + kitchenCrew + fixedOpex },
    { key: 'principal', label: '+ Loan principal (cash breakeven)', detail: 'scheduled principal — not on the P&L', monthly: fixedLabor + kitchenCrew + fixedOpex + loanPrincipal }
  ]
  const coversNeeded = (monthly: number, spend: number | null): number | null => {
    const c = contribPerCover(spend)
    return c != null && c > 0 && nights > 0 ? monthly / nights / c : null
  }
  const tiers = cumulative.map(t => ({ ...t, coversPerNight: coversNeeded(t.monthly, avgSpend) }))

  const weekdays = WEEKDAYS.map((w) => {
    const days = openDays.filter(d => d.dow === w.dow)
    const covers = days.reduce((s, d) => s + d.covers, 0)
    const revenue = days.reduce((s, d) => s + d.revenue, 0)
    const avgCovers = days.length > 0 ? covers / days.length : null
    const spend = covers > 0 ? revenue / covers : null
    return {
      key: w.key, label: w.label, short: w.short, sampleDays: days.length, avgCovers, avgSpend: spend,
      coversNeeded: Object.fromEntries(cumulative.map(t => [t.key, coversNeeded(t.monthly, spend)]))
    }
  })

  return {
    year, month, asOfDate, windowStart, sampleOpenDays: openDays.length, nights,
    laborBudgeted,
    avgCoversPerNight, avgSpend, excludedNights,
    cogsPct, varOpexPct, contribRate, fohPerCover,
    contribPerCover: contribPerCover(avgSpend),
    components: { fixedLabor, kitchenCrew, variableLabor, fixedOpex, loanPrincipal },
    tiers, weekdays
  }
})
