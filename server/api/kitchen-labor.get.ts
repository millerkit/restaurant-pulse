// Kitchen Labor: BOH wages as a percent of food revenue, week by week.
//
// Two alignments matter here (both from the user, 2026-10-27):
//  - Payroll posts on Friday for the PRECEDING Mon–Sun week, ending the Sunday
//    before. The 10/23 payroll covers hours worked 10/12–10/18. So a labor
//    posting dated F belongs to the week starting F − 11 days.
//  - That week's hours are matched against that same Mon–Sun week's revenue.
//
// "Kitchen labor" = every account under 6010 BOH Wages (cooks, chefs, BOH OT,
// service charge distribution) except Porter, plus the Executive Chef (6054,
// under Management Salaries). Overtime and the Executive Chef are returned
// separately so the page can toggle them; the Executive Chef: it's salaried owner compensation and moves the ratio a
// lot. Inactive accounts are kept on purpose — the old per-role OT accounts
// (Line Cook OT, ...) were folded into BOH OT, but their history still sits
// on them. Matched by account_number/parent, never raw id.
//
// Revenue is food only, so labor is compared against the revenue it serves:
// restaurant food, event food (on-site + off-site), catering food, retail
// food. Beverage, service/equipment fees, books and contra-income (discounts
// & comps — not splittable into food vs. beverage) are left out.

const BOH_PARENT_ACCOUNT_NUMBER = '6010'
const EXECUTIVE_CHEF_ACCOUNT_NUMBER = '6054'
const PORTER_NAME_PATTERN = 'Porter%'
// Overtime accounts under 6010 are named "<role> OT" (BOH OT, plus the old
// per-role ones folded into it). Returned separately so the page can toggle
// them (user's call 2026-10-27). Porter OT is already excluded by the Porter
// pattern above; porters almost never have overtime.
const OVERTIME_NAME_PATTERN = '% OT'

const FOOD_STREAMS = [
  { key: 'restaurant', label: 'Restaurant', accountNumbers: ['4010'] },
  { key: 'events', label: 'Events', accountNumbers: ['4150', '4180'] },
  { key: 'catering', label: 'Catering', accountNumbers: ['4230'] },
  { key: 'retail', label: 'Retail', accountNumbers: ['4320'] }
] as const
type StreamKey = typeof FOOD_STREAMS[number]['key']

// Only the last 4 months of weeks are returned (user's call 2026-10-27): the
// pre-opening weeks have huge labor against tiny revenue and would dominate
// the chart's scale.
const HISTORY_MONTHS = 4

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function monthsBefore(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const first = new Date(Date.UTC(y, m - 1 - n, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, lastDay))
  return first.toISOString().slice(0, 10)
}
function dow(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sunday
}
function mondayOf(iso: string): string {
  return addDays(iso, -((dow(iso) + 6) % 7))
}
// The payroll Friday a labor posting belongs to: the first Friday on or
// after it. "On or after" (not "before") so a payroll run early for a holiday
// (Thursday) still lands in its own cycle.
function payrollFridayFor(iso: string): string {
  return addDays(iso, (5 - dow(iso) + 7) % 7)
}
// Payroll Friday F covers the Mon–Sun week that ended 5 days earlier.
const WEEK_START_BEFORE_PAYROLL_DAYS = 11

interface WeekAcc {
  weekStart: string
  revenue: Record<StreamKey, number>
  laborBoh: number
  laborOvertime: number
  laborExecChef: number
  laborRows: number
}

export default defineEventHandler(() => {
  const db = useDb()
  const { asOf } = db.prepare('SELECT MAX(date) AS asOf FROM daily_line_items').get() as { asOf: string | null }
  if (!asOf) return { hasData: false as const }

  const streamByAccountNumber = new Map<string, StreamKey>()
  for (const s of FOOD_STREAMS) for (const n of s.accountNumbers) streamByAccountNumber.set(n, s.key)

  const laborRows = db.prepare(`
    SELECT d.date AS date,
           CASE WHEN a.account_number = ? THEN 'exec'
                WHEN a.name LIKE ? THEN 'ot'
                ELSE 'boh' END AS kind,
           SUM(d.amount) AS amount
    FROM daily_line_items d
    JOIN accounts a ON a.id = d.account_id
    LEFT JOIN accounts p ON p.id = a.parent_account_id
    WHERE (a.account_number = ?
           OR ((a.account_number = ? OR p.account_number = ?) AND a.name NOT LIKE ?))
    GROUP BY d.date, kind
  `).all(
    EXECUTIVE_CHEF_ACCOUNT_NUMBER,
    OVERTIME_NAME_PATTERN,
    EXECUTIVE_CHEF_ACCOUNT_NUMBER,
    BOH_PARENT_ACCOUNT_NUMBER, BOH_PARENT_ACCOUNT_NUMBER, PORTER_NAME_PATTERN
  ) as { date: string, kind: 'boh' | 'ot' | 'exec', amount: number }[]

  const revenueNumbers = [...streamByAccountNumber.keys()]
  const revenueRows = db.prepare(`
    SELECT d.date AS date, a.account_number AS accountNumber, SUM(d.amount) AS amount
    FROM daily_line_items d
    JOIN accounts a ON a.id = d.account_id
    WHERE a.account_number IN (${revenueNumbers.map(() => '?').join(',')})
    GROUP BY d.date, a.account_number
  `).all(...revenueNumbers) as { date: string, accountNumber: string, amount: number }[]

  const weeks = new Map<string, WeekAcc>()
  const weekFor = (weekStart: string) => {
    let w = weeks.get(weekStart)
    if (!w) {
      w = { weekStart, revenue: { restaurant: 0, events: 0, catering: 0, retail: 0 }, laborBoh: 0, laborOvertime: 0, laborExecChef: 0, laborRows: 0 }
      weeks.set(weekStart, w)
    }
    return w
  }

  for (const r of revenueRows) {
    weekFor(mondayOf(r.date)).revenue[streamByAccountNumber.get(r.accountNumber)!] += r.amount
  }
  // Labor posted on a day that isn't a Friday is still assigned to a payroll
  // cycle (see payrollFridayFor); the dollars are reported so a lot of
  // off-cycle activity is visible rather than silently folded in.
  let offCycleLabor = 0
  for (const r of laborRows) {
    const friday = payrollFridayFor(r.date)
    if (dow(r.date) !== 5) offCycleLabor += r.amount
    const w = weekFor(addDays(friday, -WEEK_START_BEFORE_PAYROLL_DAYS))
    if (r.kind === 'exec') w.laborExecChef += r.amount
    else if (r.kind === 'ot') w.laborOvertime += r.amount
    else w.laborBoh += r.amount
    w.laborRows += 1
  }

  // Only weeks whose Sunday is in synced data: a partial revenue week would
  // read as a falsely high labor %. A finished week with no payroll yet is
  // kept and shown as awaiting payroll.
  const firstLaborWeek = [...weeks.values()].filter(w => w.laborRows > 0).map(w => w.weekStart).sort()[0]
  const historyStart = monthsBefore(asOf, HISTORY_MONTHS)
  const complete = [...weeks.values()]
    .filter(w => addDays(w.weekStart, 6) <= asOf && w.weekStart >= historyStart && (!firstLaborWeek || w.weekStart >= firstLaborWeek))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))

  const rows = complete.map(w => {
    const payrollDate = addDays(w.weekStart, WEEK_START_BEFORE_PAYROLL_DAYS)
    return {
      weekStart: w.weekStart,
      weekEnd: addDays(w.weekStart, 6),
      payrollDate,
      // The payroll Friday must itself be in synced data, so a cycle that is
      // only partly posted can't pass for a finished week.
      hasPayroll: w.laborRows > 0 && payrollDate <= asOf,
      revenue: { ...w.revenue, total: Object.values(w.revenue).reduce((s, v) => s + v, 0) },
      laborBoh: w.laborBoh,
      laborOvertime: w.laborOvertime,
      laborExecChef: w.laborExecChef
    }
  })

  return {
    hasData: true as const,
    asOf,
    streams: FOOD_STREAMS.map(s => ({ key: s.key, label: s.label })),
    offCycleLabor,
    weeks: rows
  }
})
