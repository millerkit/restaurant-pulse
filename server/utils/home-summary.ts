// Home › Summary (2026-11-17): a short, plain-language read of how the restaurant has been doing,
// shown first to every role. Built by fixed rules, not an AI writer, so the same data always gives
// the same words and every number matches the page it came from.
//
// How it works: each rule below looks for one finding ("guest counts up 7% on the past four
// weeks") and returns a Fact with a tone (good / neutral / concern), a size (weight, used for
// ranking and the headline) and the roles allowed to see it. buildHomeSummary() keeps only the
// facts the reader's role may see BEFORE any sentence or headline is assembled, so a GM's or Sous
// Chef's text can never be built from owner-only data. Within a section, good news comes first
// (Kit's call: the softer tone for everyone, good news first), then neutral, then concerns.
//
// Visibility (Kit, 2026-11-17):
//   owner   - everything, including Cash and loans (reserve, loan payments, gift cards).
//   gm      - covers, sales vs. goal, spend per guest, month pace, last closed month's profit,
//             food & drink cost and labor %. Profit matches the owner's figure: non-owners see
//             owner pay folded into labor, never broken out or removed.
//   kitchen - guest counts, busiest/quietest nights, last closed month's food cost %, what's
//             coming up (no dollar amounts anywhere, including special nights' expected revenue).
//
// Profit and cost percentages are only ever stated for closed, fully synced months: month-to-date
// P&L is cash basis and understates expenses until the month's bills land.
import type Database from 'better-sqlite3'
import { roleCanViewPage, type Role } from '#shared/utils/access'
import { CORE_REVENUE_ACCOUNT_NUMBERS, EVENT_REVENUE_RANGE, MIN_COVERS_FOR_OPEN_DAY, isEventNight } from './core-revenue'
import { computeWeeklyRevenueTargets, WEEKDAYS } from './weekly-targets'
import { loadPlannedNights, type SpecialNight } from './special-nights'
import { computeBookingPace } from './booking-pace'
import { computeRevenueProjection } from './revenue-projection'

type Db = Database.Database
export type Tone = 'good' | 'neutral' | 'concern'
type SectionKey = 'thisweek' | 'week' | 'month' | 'cash' | 'ahead'

type Fact = {
  id: string
  section: SectionKey
  tone: Tone
  weight: number // size of the finding (e.g. % off); ranks facts and picks the headline
  text: string
  roles: Role[]
  headline?: string // short clause for the headline, lower case ("guest counts were up 7%")
  // Week concerns about guests or spend (2026-11-19, Kit): they only matter when dine-in sales miss
  // the goal. Sales on or above goal → `calm` replaces the sentence (neutral), or it is dropped when
  // there's no calm version. Sales short → `reason` explains the shortfall in the headline.
  salesSide?: boolean // a guest/spend concern that only matters when sales miss the goal
  reason?: string
  calm?: string
  primary?: boolean // a section's main fact (sales vs. goal, guest counts, profit); listed before details of the same tone
  order?: number // Looking ahead keeps its own order (soonest first)
}

export type SummaryNight = {
  date: string
  short: string
  status: 'up' | 'on' | 'down' | 'event' | 'closed' | 'none' | 'upcoming'
  value: string // what the dot shows: "+6%" vs goal, or a guest count
  detail: string // accessible description / tooltip
}

// A week block (2026-11-19): "This week so far" (the current Tue–Sun, synced nights only) on top,
// then "Last week" (the most recent complete Tue–Sun). Each has its own headline and night strip so
// it's always clear which week a sentence describes.
export type WeekBlock = {
  key: 'thisweek' | 'week'
  title: string
  start: string
  end: string
  headline: string
  link: { to: string, label: string } | null
  nights: { basis: 'sales' | 'covers', items: SummaryNight[] }
  items: { tone: Tone, text: string }[]
}

export type HomeSummary = {
  today: string
  toastThrough: string | null
  salesThrough: string | null
  weeks: WeekBlock[]
  notices: string[]
  sections: { key: SectionKey, title: string, link: { to: string, label: string } | null, items: { tone: Tone, text: string }[] }[]
  progress: { label: string, actual: number, target: number, status: 'up' | 'on' | 'down', note: string } | null
}

// Owner-only Cash and loans inputs, taken from the Cash & Loans route's own payload (see
// server/api/home-summary.get.ts) so the reserve figures are never re-derived here.
export type CashInputs = {
  reserve: { target: number, catchUpDate: string | null, onPaceForCatchUp: boolean | null, catchUpShortfall: number | null } | null
  upcomingPayments: { date: string, total: number }[]
  giftCards: { startDate: string, sold: number, net: number } | null
}

const ALL: Role[] = ['owner', 'gm', 'kitchen', 'floor']
// Roles that never see dollars and share the Sous Chef's view: guest counts and food cost %, no dollars.
const GUESTS_ONLY: Role[] = ['kitchen', 'floor']
const MONEY: Role[] = ['owner', 'gm']
const OWNER: Role[] = ['owner']

const STEADY_PCT = 0.05 // within ±5% reads as "in line"
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const FOOD_COST_ACCOUNTS = ['5010', '5220'] // same definition as budget-forecast.ts COST_PAIRS
const FOOD_SALES_ACCOUNTS = ['4010', '4150', '4180', '4230']

// ---- small helpers --------------------------------------------------------
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const pad = (n: number) => String(n).padStart(2, '0')
function monthEndIso(year: number, month: number) {
  return `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
}
function weekdayName(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}
function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function money(n: number) {
  const a = Math.abs(n)
  if (a >= 1000) {
    const k = a / 1000
    return `$${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K`
  }
  return `$${Math.round(a)}`
}
const pctWhole = (r: number) => `${Math.round(Math.abs(r) * 100)}%`
const pctOne = (r: number) => `${(Math.round(r * 1000) / 10).toFixed(1).replace(/\.0$/, '')}%`
function points(diff: number) {
  const p = Math.round(Math.abs(diff) * 1000) / 10
  return p === 1 ? 'one point' : p === 2 ? 'two points' : `${p} points`
}
function listJoin(items: string[]) {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function sumByAccounts(db: Db, numbers: string[], from: string, to: string, table: 'actual' | 'budget'): number {
  const ph = numbers.map(() => '?').join(',')
  if (table === 'actual') {
    const r = db.prepare(`
      SELECT COALESCE(SUM(dli.amount), 0) AS t FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
      WHERE a.account_number IN (${ph}) AND dli.date BETWEEN ? AND ?
    `).get(...numbers, from, to) as { t: number }
    return r.t
  }
  const [y, m] = from.split('-').map(Number)
  const r = db.prepare(`
    SELECT COALESCE(SUM(bt.amount), 0) AS t FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE a.account_number IN (${ph}) AND bt.year = ? AND bt.month = ?
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)
  `).get(...numbers, y, m) as { t: number }
  return r.t
}

function categoryTotals(db: Db, from: string, to: string) {
  const rows = db.prepare(`
    SELECT a.category AS c, SUM(dli.amount) AS t FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE dli.date BETWEEN ? AND ? GROUP BY a.category
  `).all(from, to) as { c: string, t: number }[]
  return Object.fromEntries(rows.map(r => [r.c, r.t])) as Record<string, number>
}
function budgetCategoryTotals(db: Db, year: number, month: number) {
  const rows = db.prepare(`
    SELECT a.category AS c, SUM(bt.amount) AS t FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
    WHERE bt.year = ? AND bt.month = ? AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)
    GROUP BY a.category
  `).all(year, month) as { c: string, t: number }[]
  return rows.length ? Object.fromEntries(rows.map(r => [r.c, r.t])) as Record<string, number> : null
}
// Same formula as netIncome() in app/composables/useBudgetData.ts.
function netIncomeOf(t: Record<string, number>) {
  const g = (k: string) => t[k] ?? 0
  return g('revenue') - g('cogs') - g('labor') - g('opex') + g('other_income') - g('other_expense')
}

// ---- the summary ----------------------------------------------------------
export function buildHomeSummary(db: Db, role: Role, today: string, cash: CashInputs | null): HomeSummary {
  const facts: Fact[] = []
  const notices: string[] = []
  const guestsOnly = GUESTS_ONLY.includes(role)

  const toastThrough = (db.prepare('SELECT MAX(date) AS d FROM daily_toast_metrics').get() as { d: string | null }).d
  const salesThrough = (db.prepare('SELECT MAX(date) AS d FROM daily_line_items').get() as { d: string | null }).d
  const weekly = computeWeeklyRevenueTargets()
  const targetOn = (iso: string) => weekly.forDate(iso).targetByDow.get(dow(iso)) ?? null

  const coversRows = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date >= ?').all(addDays(today, -120)) as { date: string, covers: number }[]
  const coversOn = new Map(coversRows.map(r => [r.date, r.covers]))
  const corePh = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
  const coreOn = new Map((db.prepare(`
    SELECT dli.date AS date, SUM(dli.amount) AS t FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number IN (${corePh}) AND dli.date >= ? GROUP BY dli.date
  `).all(...CORE_REVENUE_ACCOUNT_NUMBERS, addDays(today, -120)) as { date: string, t: number }[]).map(r => [r.date, r.t]))
  const eventOn = new Map((db.prepare(`
    SELECT dli.date AS date, SUM(dli.amount) AS t FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number >= ? AND a.account_number < ? AND dli.date >= ? GROUP BY dli.date
  `).all(EVENT_REVENUE_RANGE.from, EVENT_REVENUE_RANGE.toExclusive, addDays(today, -120)) as { date: string, t: number }[]).map(r => [r.date, r.t]))
  const planned = loadPlannedNights(db, addDays(today, -120), addDays(today, 45))

  // Freshness: say so rather than describe stale numbers as current.
  const lastSync = db.prepare('SELECT status FROM sync_runs ORDER BY id DESC LIMIT 1').get() as { status: string } | undefined
  if (lastSync && lastSync.status !== 'success' && lastSync.status !== 'running') {
    notices.push('The last nightly sync didn’t finish, so some numbers may be a day or two behind.')
  }
  if (toastThrough && toastThrough < addDays(today, -3)) {
    notices.push(`Guest counts are only synced through ${shortDate(toastThrough)}.`)
  }
  if (!guestsOnly && salesThrough && salesThrough < addDays(today, -3)) {
    notices.push(`Sales from QuickBooks are only synced through ${shortDate(salesThrough)}, so dollar figures are left out until they catch up.`)
  }

  // ---- Shared night helpers for both week blocks ----
  type Night = {
    date: string, covers: number | null, core: number | null, event: number,
    plan: SpecialNight | null, coversTarget: number | null, dollarTarget: number | null,
    kind: 'ordinary' | 'event' | 'closed'
  }
  const nightsFor = (from: string): Night[] => Array.from({ length: 6 }, (_, i) => {
    const date = addDays(from, i)
    const plan = planned.get(date) ?? null
    const t = targetOn(date)
    const covers = coversOn.get(date) ?? null
    const core = coreOn.get(date) ?? null
    const event = eventOn.get(date) ?? 0
    let kind: Night['kind'] = 'ordinary'
    if (plan && (plan.kind === 'closed' || plan.kind === 'offsite')) kind = 'closed'
    else if ((covers ?? 0) < MIN_COVERS_FOR_OPEN_DAY && !(event > 0)) kind = 'closed'
    else if (plan && (plan.kind === 'buyout' || plan.kind === 'event')) kind = 'event'
    else if (t?.dollarTarget != null && isEventNight(core ?? 0, event, t.dollarTarget)) kind = 'event'
    return { date, covers, core, event, plan, coversTarget: t?.coversTarget ?? null, dollarTarget: t?.dollarTarget ?? null, kind }
  })

  // Special nights that have happened (buyouts, events, closures) in a week block.
  const specialFacts = (nights: Night[], section: SectionKey, salesSynced: boolean) => {
    for (const n of nights) {
      if (!n.plan && n.kind !== 'event') continue
      const day = weekdayName(n.date)
      if (n.plan?.kind === 'closed') {
        facts.push({ id: `closed-${n.date}`, section, tone: 'neutral', weight: 0, roles: ALL, text: `We were closed ${day}${n.plan.holiday ? ` for ${n.plan.holiday}` : ''}.` })
        continue
      }
      const label = n.plan?.note ? n.plan.note : n.plan?.kind === 'buyout' ? 'buyout' : n.plan?.kind === 'offsite' ? 'off-site event' : n.plan?.kind === 'catering' ? 'catering' : 'event'
      const guests = n.covers && n.covers >= MIN_COVERS_FOR_OPEN_DAY ? `, with ${n.covers} guests` : ''
      // Without synced sales, owner and GM get the same dollar-free sentence as the kitchen.
      facts.push({ id: `special-${n.date}`, section, tone: 'neutral', weight: 0, roles: salesSynced ? GUESTS_ONLY : ALL, text: `${day} was the ${label}${guests}.` })
      if (salesSynced) {
        // Event sales (41xx) only; a buyout's price rings into dine-in, so that night's dine-in counts.
        const brought = n.plan?.kind === 'buyout' ? (n.core ?? 0) : n.event
        facts.push({
          id: `special-$-${n.date}`, section, tone: brought > 0 ? 'good' : 'neutral', weight: 0, roles: MONEY,
          text: brought > 0 ? `${day}’s ${label} brought in ${money(brought)}${guests}.` : `${day} was the ${label}${guests}.`
        })
      }
    }
  }

  // The six-night strip: sales vs. goal for owner/GM (when synced), guests vs. expected otherwise.
  // Nights after `through` haven't been synced yet ("Tonight" / "To come", or their planned closure/event).
  const stripFor = (nights: Night[], basis: 'sales' | 'covers', through: string): SummaryNight[] => nights.map((n) => {
    const short = WEEKDAYS.find(w => w.dow === dow(n.date))!.short
    if (n.date > through) {
      const p = n.plan
      if (p && (p.kind === 'closed' || p.kind === 'offsite')) return { date: n.date, short, status: 'closed' as const, value: 'Closed', detail: `${weekdayName(n.date)}: ${p.kind === 'offsite' ? 'off-site event, no dinner service' : `closed${p.holiday ? ` (${p.holiday})` : ''}`}` }
      if (p && (p.kind === 'buyout' || p.kind === 'event')) return { date: n.date, short, status: 'event' as const, value: p.kind === 'buyout' ? 'Buyout' : 'Event', detail: `${weekdayName(n.date)}: ${p.note ?? 'special night'} (still to come)` }
      if (n.date < today) return { date: n.date, short, status: 'none' as const, value: '—', detail: `${weekdayName(n.date)}: not synced yet` }
      return { date: n.date, short, status: 'upcoming' as const, value: n.date === today ? 'Tonight' : 'To come', detail: `${weekdayName(n.date)}: still to come` }
    }
    if (n.kind === 'closed') return { date: n.date, short, status: 'closed' as const, value: 'Closed', detail: `${weekdayName(n.date)}: closed${n.plan?.holiday ? ` (${n.plan.holiday})` : ''}` }
    if (n.kind === 'event') return { date: n.date, short, status: 'event' as const, value: basis === 'sales' ? (n.plan?.kind === 'buyout' ? 'Buyout' : 'Event') : (n.covers ? `${n.covers}` : 'Event'), detail: `${weekdayName(n.date)}: ${n.plan?.note ?? 'special night'}` }
    const actual = basis === 'sales' ? n.core : n.covers
    const target = basis === 'sales' ? n.dollarTarget : n.coversTarget
    if (actual == null || !target) return { date: n.date, short, status: 'none' as const, value: '—', detail: `${weekdayName(n.date)}: no data` }
    const r = actual / target - 1
    const status = r >= STEADY_PCT ? 'up' as const : r > -STEADY_PCT ? 'on' as const : 'down' as const
    const value = basis === 'sales' ? `${r >= 0 ? '+' : '−'}${pctWhole(r)}` : `${actual}`
    const detail = basis === 'sales'
      ? `${weekdayName(n.date)}: ${money(actual)} against a ${money(target)} goal`
      : `${weekdayName(n.date)}: ${actual} guests against about ${Math.round(target)} expected`
    return { date: n.date, short, status, value, detail }
  })

  // ---- Last week (the most recent complete Tue–Sun with covers synced) ----
  let week: { start: string, end: string } | null = null
  let lastStrip: WeekBlock['nights'] | null = null
  if (toastThrough) {
    const lastSunday = addDays(toastThrough, -dow(toastThrough)) // Sunday on/before
    const start = addDays(lastSunday, -5)
    week = { start, end: lastSunday }
    const salesSynced = !!salesThrough && salesThrough >= lastSunday

    const nights = nightsFor(start)
    const ordinary = nights.filter(n => n.kind === 'ordinary' && n.covers != null)
    const open = nights.filter(n => n.kind !== 'closed')
    const totalGuests = open.reduce((s, n) => s + (n.covers ?? 0), 0)

    // Guest counts vs. the four weeks before (per ordinary open night, so a closure doesn't skew it).
    const prior: Night[] = []
    for (let w = 1; w <= 4; w++) prior.push(...nightsFor(addDays(start, -7 * w)).filter(n => n.kind === 'ordinary' && n.covers != null))
    if (ordinary.length >= 3 && prior.length >= 8) {
      const cur = ordinary.reduce((s, n) => s + n.covers!, 0) / ordinary.length
      const base = prior.reduce((s, n) => s + n.covers!, 0) / prior.length
      const chg = cur / base - 1
      const over = `${totalGuests.toLocaleString()} guests over ${open.length} nights`
      if (chg >= STEADY_PCT) {
        facts.push({ id: 'covers', primary: true, section: 'week', tone: 'good', weight: chg, roles: ALL, text: `Guest counts were up ${pctWhole(chg)} on the past four weeks, with ${over}.`, headline: `guest counts were up ${pctWhole(chg)}` })
      } else if (chg <= -STEADY_PCT) {
        facts.push({ id: 'covers', primary: true, section: 'week', tone: 'concern', weight: -chg, roles: ALL, text: `Guest counts came in ${pctWhole(chg)} below the past four weeks, at ${over}.`, headline: `guest counts were ${pctWhole(chg)} below recent weeks`, salesSide: true, reason: `guest counts ${pctWhole(chg)} below recent weeks`, calm: `Guest counts came in at ${over}.` })
      } else {
        facts.push({ id: 'covers', primary: true, section: 'week', tone: 'neutral', weight: 0, roles: ALL, text: `Guest counts held steady at ${over}, in line with the past four weeks.` })
      }
    }

    // Busiest night, and the night furthest under its usual pattern.
    if (ordinary.length) {
      const busiest = ordinary.reduce((a, b) => (b.covers! > a.covers! ? b : a))
      const above = busiest.coversTarget ? busiest.covers! / busiest.coversTarget - 1 : 0
      facts.push({
        id: 'busiest', section: 'week', tone: above >= STEADY_PCT ? 'good' : 'neutral', weight: Math.max(0, above), roles: ALL,
        text: `${weekdayName(busiest.date)} was the busiest night, with ${busiest.covers} guests${above >= STEADY_PCT ? `, above a typical ${weekdayName(busiest.date)}` : ''}.`
      })
      const judged = ordinary.filter(n => n.coversTarget && n.coversTarget > 0 && n.date !== busiest.date)
      if (judged.length) {
        const quiet = judged.reduce((a, b) => (b.covers! / b.coversTarget! < a.covers! / a.coversTarget! ? b : a))
        const off = quiet.covers! / quiet.coversTarget! - 1
        if (off <= -0.1) {
          facts.push({
            id: 'quiet', section: 'week', tone: 'concern', weight: -off, roles: ALL, salesSide: true,
            text: `${weekdayName(quiet.date)} was quieter than usual, with ${quiet.covers} guests against a typical ${Math.round(quiet.coversTarget!)}.`
          })
        }
      }
    }

    specialFacts(nights, 'week', salesSynced)

    // Sales vs. the weekly goal, and spend per guest (owner and GM).
    if (salesSynced) {
      const goalNights = nights.filter(n => n.kind !== 'closed' && n.dollarTarget != null)
      const goal = goalNights.reduce((s, n) => s + n.dollarTarget!, 0)
      const actual = goalNights.reduce((s, n) => s + (n.core ?? 0) + (n.kind === 'event' ? n.event : 0), 0)
      if (goal > 0) {
        const diff = actual / goal - 1
        if (diff >= 0.02) {
          facts.push({ id: 'sales', primary: true, section: 'week', tone: 'good', weight: diff, roles: MONEY, text: `Dine-in sales reached ${money(actual)}, ${pctWhole(diff)} above the weekly goal of ${money(goal)}.`, headline: `dine-in sales beat the weekly goal by ${pctWhole(diff)}` })
        } else if (diff > -STEADY_PCT) {
          facts.push({ id: 'sales', primary: true, section: 'week', tone: 'neutral', weight: 0, roles: MONEY, text: `Dine-in sales came in at ${money(actual)}, close to the weekly goal of ${money(goal)}.` })
        } else {
          facts.push({ id: 'sales', primary: true, section: 'week', tone: 'concern', weight: -diff, roles: MONEY, text: `Dine-in sales reached ${money(actual)}, about ${pctWhole(diff)} short of the ${money(goal)} weekly goal.`, headline: `dine-in sales finished about ${pctWhole(diff)} short of goal` })
        }
      }
      const spendNights = ordinary.filter(n => (n.core ?? 0) > 0)
      const typical = weekly.forDate(lastSunday).avgSpendPerCover
      if (spendNights.length >= 3 && typical) {
        const spend = spendNights.reduce((s, n) => s + n.core!, 0) / spendNights.reduce((s, n) => s + n.covers!, 0)
        const chg = spend / typical - 1
        if (chg >= 0.04) facts.push({ id: 'spend', section: 'week', tone: 'good', weight: chg, roles: MONEY, text: `Guests spent about ${money(spend)} each, up from a typical ${money(typical)}.`, headline: 'guests spent more per visit' })
        else if (chg <= -0.04) facts.push({ id: 'spend', section: 'week', tone: 'concern', weight: -chg, roles: MONEY, text: `Spend per guest eased to about ${money(spend)}, from a typical ${money(typical)}.`, headline: 'spend per guest dipped', salesSide: true, reason: 'lower spend per guest' })
        else facts.push({ id: 'spend', section: 'week', tone: 'neutral', weight: 0, roles: MONEY, text: `Spend per guest held steady at about ${money(spend)}.` })
      }
    }

    const basis: 'sales' | 'covers' = !guestsOnly && salesSynced ? 'sales' : 'covers'
    lastStrip = { basis, items: stripFor(nights, basis, lastSunday) }
  }

  // ---- This week so far (the current Tue–Sun, through the last synced night before today) ----
  // Skipped when it is the same week as "Last week" (Mondays) or no night of it is synced yet.
  let thisWeek: { start: string, end: string, through: string } | null = null
  let thisStrip: WeekBlock['nights'] | null = null
  const thisStart = addDays(today, -((dow(today) + 5) % 7)) // Tuesday on/before today
  const thisThrough = toastThrough ? (toastThrough < today ? toastThrough : addDays(today, -1)) : null
  if (thisThrough && thisThrough >= thisStart && (!week || thisStart > week.start)) {
    thisWeek = { start: thisStart, end: addDays(thisStart, 5), through: thisThrough }
    const salesSynced = !!salesThrough && salesThrough >= thisThrough
    const nights = nightsFor(thisStart)
    const past = nights.filter(n => n.date <= thisThrough)

    // Guests on regular nights so far vs. what's expected for those weekdays (same targets as This Week).
    const judged = past.filter(n => n.kind === 'ordinary' && n.covers != null && n.coversTarget && n.coversTarget > 0)
    if (judged.length) {
      const guests = judged.reduce((s, n) => s + n.covers!, 0)
      const expected = judged.reduce((s, n) => s + n.coversTarget!, 0)
      const r = guests / expected - 1
      const over = `${guests.toLocaleString()} guests over ${judged.length} regular night${judged.length === 1 ? '' : 's'} so far`
      if (r >= STEADY_PCT) facts.push({ id: 'tw-covers', primary: true, section: 'thisweek', tone: 'good', weight: r, roles: ALL, text: `${cap(over)}, ${pctWhole(r)} more than expected for those nights.`, headline: `guest counts are ${pctWhole(r)} ahead of expected` })
      else if (r <= -STEADY_PCT) facts.push({ id: 'tw-covers', primary: true, section: 'thisweek', tone: 'concern', weight: -r, roles: ALL, text: `${cap(over)}, ${pctWhole(r)} fewer than expected for those nights.`, headline: `guest counts are ${pctWhole(r)} behind expected`, salesSide: true, reason: `guest counts ${pctWhole(r)} behind expected`, calm: `${cap(over)}.` })
      else facts.push({ id: 'tw-covers', primary: true, section: 'thisweek', tone: 'neutral', weight: 0, roles: ALL, text: `${cap(over)}, about what’s expected for those nights.` })
    }

    specialFacts(past, 'thisweek', salesSynced)

    // Dine-in sales so far vs. the goal for the same nights (owner and GM).
    if (salesSynced) {
      const goalNights = past.filter(n => n.kind !== 'closed' && n.dollarTarget != null)
      const goal = goalNights.reduce((s, n) => s + n.dollarTarget!, 0)
      const actual = goalNights.reduce((s, n) => s + (n.core ?? 0) + (n.kind === 'event' ? n.event : 0), 0)
      if (goal > 0) {
        const diff = actual / goal - 1
        const after = `after ${goalNights.length} night${goalNights.length === 1 ? '' : 's'}`
        if (diff >= 0.02) facts.push({ id: 'tw-sales', primary: true, section: 'thisweek', tone: 'good', weight: diff, roles: MONEY, text: `Dine-in sales are at ${money(actual)} ${after}, ${pctWhole(diff)} above the ${money(goal)} goal for those nights.`, headline: `dine-in sales are ${pctWhole(diff)} ahead of goal` })
        else if (diff > -STEADY_PCT) facts.push({ id: 'tw-sales', primary: true, section: 'thisweek', tone: 'neutral', weight: 0, roles: MONEY, text: `Dine-in sales are at ${money(actual)} ${after}, close to the ${money(goal)} goal for those nights.` })
        else facts.push({ id: 'tw-sales', primary: true, section: 'thisweek', tone: 'concern', weight: -diff, roles: MONEY, text: `Dine-in sales are at ${money(actual)} ${after}, about ${pctWhole(diff)} short of the ${money(goal)} goal for those nights.`, headline: `dine-in sales are about ${pctWhole(diff)} behind goal` })
      }
      // Spend per guest on regular nights so far (two or more), mainly to explain a sales shortfall.
      const spendNights = past.filter(n => n.kind === 'ordinary' && (n.core ?? 0) > 0 && (n.covers ?? 0) > 0)
      const typical = weekly.forDate(thisStart).avgSpendPerCover
      if (spendNights.length >= 2 && typical) {
        const spend = spendNights.reduce((s, n) => s + n.core!, 0) / spendNights.reduce((s, n) => s + n.covers!, 0)
        const chg = spend / typical - 1
        if (chg >= 0.04) facts.push({ id: 'tw-spend', section: 'thisweek', tone: 'good', weight: chg, roles: MONEY, text: `Guests are spending about ${money(spend)} each, up from a typical ${money(typical)}.`, headline: 'guests are spending more per visit' })
        else if (chg <= -0.04) facts.push({ id: 'tw-spend', section: 'thisweek', tone: 'concern', weight: -chg, roles: MONEY, text: `Spend per guest is about ${money(spend)}, below a typical ${money(typical)}.`, headline: 'spend per guest is down', salesSide: true, reason: 'lower spend per guest' })
      }
    }

    const basis: 'sales' | 'covers' = !guestsOnly && salesSynced ? 'sales' : 'covers'
    thisStrip = { basis, items: stripFor(nights, basis, thisThrough) }
  }

  // ---- This month so far ----
  const [ty, tm] = today.split('-').map(Number) as [number, number]
  const monthName = MONTH_NAMES[tm - 1]!
  const monthStart = `${ty}-${pad(tm)}-01`
  let progress: HomeSummary['progress'] = null
  if (toastThrough && toastThrough >= monthStart) {
    let guests = 0, expected = 0, n = 0
    for (let d = monthStart; d <= toastThrough; d = addDays(d, 1)) {
      if (dow(d) === 1 || planned.has(d)) continue
      const c = coversOn.get(d)
      const t = targetOn(d)?.coversTarget
      if (c == null || c < MIN_COVERS_FOR_OPEN_DAY || !t) continue
      guests += c; expected += t; n++
    }
    if (n >= 3 && expected > 0) {
      const r = guests / expected - 1
      const over = `${guests.toLocaleString()} guests over ${n} regular nights`
      if (r >= STEADY_PCT) facts.push({ id: 'month-guests', primary: true, section: 'month', tone: 'good', weight: r, roles: ALL, text: `${monthName} is running ${pctWhole(r)} ahead of expected guests so far, with ${over}.` })
      else if (r <= -STEADY_PCT) facts.push({ id: 'month-guests', primary: true, section: 'month', tone: 'concern', weight: -r, roles: ALL, text: `${monthName} is running ${pctWhole(r)} below expected guests so far, with ${over}.` })
      else facts.push({ id: 'month-guests', primary: true, section: 'month', tone: 'neutral', weight: 0, roles: ALL, text: `${monthName} is on pace for expected guests so far, with ${over}.` })
      if (guestsOnly || !salesThrough || salesThrough < addDays(today, -3)) {
        progress = { label: `${monthName} guests so far vs. expected`, actual: guests, target: expected, status: r >= STEADY_PCT ? 'up' : r > -STEADY_PCT ? 'on' : 'down', note: 'Regular nights only; buyouts, events and closures are left out.' }
      }
    }
  }

  // Dine-in sales projection for the month vs. its frozen plan (owner and GM).
  if (!guestsOnly && salesThrough && salesThrough >= addDays(today, -3)) {
    try {
      const proj = computeRevenueProjection(db, ty, tm)
      const plan = sumByAccounts(db, CORE_REVENUE_ACCOUNT_NUMBERS, monthStart, monthEndIso(ty, tm), 'budget')
      if (proj.knownThrough && proj.missingHistory === 0 && plan > 0) {
        const r = proj.projectedCoreTotal / plan - 1
        const left = proj.nights.filter(x => !(x.special && (x.special.kind === 'closed' || x.special.kind === 'offsite'))).length
        const leftText = left > 0 ? `, with ${left} service night${left === 1 ? '' : 's'} still to go` : ''
        if (r >= 0.03) facts.push({ id: 'month-sales', primary: true, section: 'month', tone: 'good', weight: r, roles: MONEY, text: `${monthName} is on track for about ${money(proj.projectedCoreTotal)} in dine-in sales, ${pctWhole(r)} above plan${leftText}.` })
        else if (r > -0.03) facts.push({ id: 'month-sales', primary: true, section: 'month', tone: 'neutral', weight: 0, roles: MONEY, text: `${monthName} is on track for about ${money(proj.projectedCoreTotal)} in dine-in sales, close to the plan of ${money(plan)}${leftText}.` })
        else facts.push({ id: 'month-sales', primary: true, section: 'month', tone: 'concern', weight: -r, roles: MONEY, text: `${monthName} is heading for about ${money(proj.projectedCoreTotal)} in dine-in sales, ${pctWhole(r)} below the plan of ${money(plan)}${leftText}.` })
        progress = { label: `${monthName} dine-in sales: projected vs. plan`, actual: proj.projectedCoreTotal, target: plan, status: r >= 0.03 ? 'up' : r > -0.03 ? 'on' : 'down', note: 'Projected = sales so far plus each remaining night’s recent average and bookings.' }
      }
    } catch { /* projection unavailable: the sentence is simply left out */ }
  }

  // Last closed, fully synced month: profit, cost percentages, food cost.
  const prev = tm === 1 ? { y: ty - 1, m: 12 } : { y: ty, m: tm - 1 }
  const prevEnd = monthEndIso(prev.y, prev.m)
  const prevStart = `${prev.y}-${pad(prev.m)}-01`
  const prevName = MONTH_NAMES[prev.m - 1]!
  if (salesThrough && salesThrough >= prevEnd) {
    const actual = categoryTotals(db, prevStart, prevEnd)
    const revenue = actual.revenue ?? 0
    if (revenue > 0) {
      const ni = netIncomeOf(actual)
      const budget = budgetCategoryTotals(db, prev.y, prev.m)
      const bni = budget ? netIncomeOf(budget) : null
      const vs = bni == null ? '' : ni >= bni ? `, ${money(ni - bni)} better than budget` : `, ${money(bni - ni)} short of budget`
      const tone: Tone = bni == null ? (ni >= 0 ? 'good' : 'concern') : ni >= bni ? 'good' : 'concern'
      facts.push({
        id: 'profit', section: 'month', tone, weight: bni ? Math.abs(ni - bni) / revenue : 0, roles: MONEY,
        text: ni >= 0 ? `${prevName} closed with a ${money(ni)} profit${vs}.` : `${prevName} closed with a ${money(ni)} loss${vs}.`
      })

      const benches = db.prepare('SELECT category, target_pct AS t, warning_pct AS w FROM category_benchmarks').all() as { category: string, t: number, w: number }[]
      const costLine = (cat: 'cogs' | 'labor', label: string) => {
        const b = benches.find(x => x.category === cat)
        const pct = (actual[cat] ?? 0) / revenue
        if (!b || !(pct > 0)) return
        const d = pct - b.t
        if (d <= 0) facts.push({ id: cat, section: 'month', tone: 'good', weight: -d, roles: MONEY, text: `${label} was ${pctOne(pct)} of sales in ${prevName}, within the ${pctOne(b.t)} target.` })
        else if (pct <= b.w) facts.push({ id: cat, section: 'month', tone: 'neutral', weight: d, roles: MONEY, text: `${label} was ${pctOne(pct)} of sales in ${prevName}, just above the ${pctOne(b.t)} target.` })
        else facts.push({ id: cat, section: 'month', tone: 'concern', weight: d, roles: MONEY, text: `${label} was ${pctOne(pct)} of sales in ${prevName}, ${points(d)} above the ${pctOne(b.t)} target.` })
      }
      costLine('cogs', 'Food and drink cost')
      costLine('labor', 'Labor')
    }

    // Food cost for the kitchen: food costs over all food sales, vs. the month before and the plan.
    const foodPct = (from: string, to: string, src: 'actual' | 'budget') => {
      const sales = sumByAccounts(db, FOOD_SALES_ACCOUNTS, from, to, src)
      return sales > 0 ? sumByAccounts(db, FOOD_COST_ACCOUNTS, from, to, src) / sales : null
    }
    const fc = foodPct(prevStart, prevEnd, 'actual')
    if (fc != null && fc > 0) {
      const before = prev.m === 1 ? { y: prev.y - 1, m: 12 } : { y: prev.y, m: prev.m - 1 }
      const beforeStart = `${before.y}-${pad(before.m)}-01`
      const fcBefore = foodPct(beforeStart, monthEndIso(before.y, before.m), 'actual')
      const fcPlan = foodPct(prevStart, prevEnd, 'budget')
      const d = fcBefore != null ? fc - fcBefore : 0
      let text = `Food cost came in at ${pctOne(fc)} of food sales in ${prevName}`
      if (fcBefore != null && Math.abs(d) >= 0.005) text += `, ${d < 0 ? 'down' : 'up'} from ${pctOne(fcBefore)} in ${MONTH_NAMES[before.m - 1]}`
      else if (fcBefore != null) text += `, about the same as ${MONTH_NAMES[before.m - 1]}`
      const vsPlan = fcPlan != null ? fc - fcPlan : 0
      if (fcPlan != null && Math.abs(vsPlan) >= 0.005) text += ` and ${vsPlan > 0 ? `${points(vsPlan)} above` : `${points(vsPlan)} under`} the ${pctOne(fcPlan)} planned`
      text += '.'
      // Judged against the plan when there is one, else against the month before.
      const gap = fcPlan != null ? vsPlan : d
      const tone: Tone = gap >= 0.01 ? 'concern' : gap <= -0.005 ? 'good' : 'neutral'
      facts.push({ id: 'food-cost', primary: true, section: 'month', tone, weight: Math.abs(vsPlan || d), roles: GUESTS_ONLY, text })
    }
  }

  // ---- Cash and loans (owner only) ----
  if (cash) {
    const r = cash.reserve
    if (r && r.catchUpDate && r.catchUpDate > today && r.onPaceForCatchUp != null) {
      if (r.onPaceForCatchUp) {
        facts.push({ id: 'reserve', primary: true, section: 'cash', tone: 'good', weight: 1, roles: OWNER, text: `The loan reserve is on pace for the ${shortDate(r.catchUpDate)} catch-up payment of ${money(r.target)}.` })
      } else {
        facts.push({ id: 'reserve', primary: true, section: 'cash', tone: 'concern', weight: 1, roles: OWNER, text: `The loan reserve is projected to come up about ${money(r.catchUpShortfall ?? 0)} short of the ${shortDate(r.catchUpDate)} catch-up payment of ${money(r.target)}; Cash & Loans shows the weekly amount that closes the gap.` })
      }
    }
    const due = cash.upcomingPayments.filter(p => p.date >= today && p.date <= addDays(today, 30))
    if (due.length) {
      const total = due.reduce((s, p) => s + p.total, 0)
      facts.push({ id: 'payments', section: 'cash', tone: 'neutral', weight: 0, roles: OWNER, text: `${money(total)} in loan payments ${due.length === 1 ? 'is' : 'are'} due over the next 30 days (${due.length} payment${due.length === 1 ? '' : 's'}).` })
    }
    const g = cash.giftCards
    if (g && g.sold > 0) {
      facts.push({ id: 'gift-cards', section: 'cash', tone: g.net > 0 ? 'good' : 'neutral', weight: 0, roles: OWNER, text: `Gift cards: ${money(g.sold)} sold since ${shortDate(g.startDate)}, ${money(g.net)} net of redemptions, an extra cushion beyond the loan reserve.` })
    }
  }

  // ---- Looking ahead (today through the next two weeks) ----
  const when = (iso: string) => {
    if (iso === today) return 'Tonight'
    if (iso === addDays(today, 1)) return 'Tomorrow'
    return iso <= addDays(today, 6) ? weekdayName(iso) : `${weekdayName(iso)}, ${shortDate(iso)}`
  }
  let order = 0
  const aheadNights = [...planned.values()].filter(p => p.date >= today && p.date <= addDays(today, 13) && dow(p.date) !== 1).sort((a, b) => a.date.localeCompare(b.date))
  for (const p of aheadNights.slice(0, 5)) {
    const w = when(p.date)
    const note = p.note ? ` (${p.note})` : ''
    let base: string
    switch (p.kind) {
      case 'closed': base = `${w}: closed${p.holiday ? ` for ${p.holiday}` : ''}.`; break
      case 'offsite': base = `${w}: off-site event${note}, no dinner service.`; break
      case 'buyout': base = `${w}: buyout${note}.`; break
      case 'catering': base = `${w}: catering${note} alongside dinner.`; break
      default: base = `${w}: ${p.note ?? 'event night'}.`
    }
    facts.push({ id: `ahead-${p.date}`, section: 'ahead', tone: 'neutral', weight: 0, order: order++, roles: GUESTS_ONLY, text: base })
    const dollars = p.kind === 'buyout' ? p.expectedRevenue : p.eventRevenue
    const withMoney = dollars > 0 && p.kind !== 'closed' ? base.replace(/\.$/, `, ${money(dollars)} expected.`) : base
    facts.push({ id: `ahead-$-${p.date}`, section: 'ahead', tone: 'neutral', weight: 0, order: order++, roles: MONEY, text: withMoney })
  }

  // Bookings: only from a fresh OpenTable upload, and only for nights from today on (the pace is
  // computed as of the upload, so a stale one would describe nights that have already passed).
  const estimateOn = new Map<string, number>()
  try {
    const pace = computeBookingPace(db)
    if (pace.available) {
      const fresh = pace.staleDays < pace.staleAfterDays
      const regular = pace.nights.filter(n => n.date >= today && !planned.has(n.date))
      if (fresh) {
        const ahead = regular.filter(n => n.pace != null && n.pace >= 1.15).map(n => weekdayName(n.date))
        const behind = regular.filter(n => n.pace != null && n.pace <= 0.8 && (n.typicalBooked ?? 0) >= 10).map(n => weekdayName(n.date))
        if (ahead.length) facts.push({ id: 'pace-ahead', section: 'ahead', tone: 'good', weight: 0, order: order++, roles: ALL, text: `${listJoin(ahead)} ${ahead.length === 1 ? 'is' : 'are'} booking ahead of a typical week.` })
        if (behind.length) facts.push({ id: 'pace-behind', section: 'ahead', tone: 'concern', weight: 0, order: order++, roles: ALL, text: `${listJoin(behind)} ${behind.length === 1 ? 'is' : 'are'} booking lighter than usual so far.` })
        for (const n of regular) if (n.estimate != null) estimateOn.set(n.date, n.estimate)
      } else {
        facts.push({ id: 'pace-stale', section: 'ahead', tone: 'neutral', weight: 0, order: order++, roles: OWNER, text: `The last OpenTable upload is ${pace.staleDays} days old, so booking pace is left out; a fresh upload brings it back.` })
      }
    }
  } catch { /* no reservations data: booking sentences are left out */ }

  // Busiest regular night in the next seven: the booking estimate where there is one, else the
  // weekday's expected guests (same numbers as This Week).
  let busiest: { date: string, guests: number } | null = null
  for (let d = today; d <= addDays(today, 6); d = addDays(d, 1)) {
    if (dow(d) === 1 || planned.has(d)) continue
    const guests = estimateOn.get(d) ?? targetOn(d)?.coversTarget ?? null
    if (guests != null && (!busiest || guests > busiest.guests)) busiest = { date: d, guests }
  }
  if (busiest) facts.push({ id: 'busiest-ahead', section: 'ahead', tone: 'neutral', weight: 0, order: order++, roles: ALL, text: `${when(busiest.date)} looks like the busiest night ahead, around ${Math.round(busiest.guests / 5) * 5} guests.` })

  const closures = db.prepare('SELECT name, closed_dows AS dows, closed_from AS fromDate FROM capacity_areas WHERE closed_dows IS NOT NULL AND closed_dows != \'\' AND closed_from > ? AND closed_from <= ?')
    .all(today, addDays(today, 30)) as { name: string, dows: string, fromDate: string }[]
  const dayPlural = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
  for (const c of closures) {
    const days = c.dows.split(',').map(s => dayPlural[Number(s.trim())]).filter(Boolean) as string[]
    const name = c.name.split(' ').map(w => cap(w)).join(' ').replace(/^Chefs Counter$/, 'Chef’s Counter')
    facts.push({ id: `closure-${c.name}`, section: 'ahead', tone: 'neutral', weight: 0, order: order++, roles: ALL, text: `${name} closes on ${listJoin(days)} starting ${shortDate(c.fromDate)}.` })
  }

  // ---- Role filter FIRST, then everything is assembled from what's left ----
  const roleFacts = facts.filter(f => f.roles.includes(role))
  // Sales first (Kit, 2026-11-19): when a week's dine-in sales are on or above goal, all is good, so
  // its guest and spend concerns are calmed or dropped. Only roles that see the sales fact are affected.
  const SALES_FACT: Record<'thisweek' | 'week', string> = { thisweek: 'tw-sales', week: 'sales' }
  const salesOk = (section: SectionKey) => {
    if (section !== 'thisweek' && section !== 'week') return false
    const sf = roleFacts.find(f => f.id === SALES_FACT[section])
    return !!sf && sf.tone !== 'concern'
  }
  const visible: Fact[] = roleFacts.flatMap((f) => {
    if (f.tone !== 'concern' || !f.salesSide || !salesOk(f.section)) return [f]
    return f.calm ? [{ ...f, tone: 'neutral' as const, weight: 0, text: f.calm, headline: undefined }] : []
  })
  const toneRank: Record<Tone, number> = { good: 0, neutral: 1, concern: 2 }
  const sorted = (key: SectionKey) => visible
    .filter(f => f.section === key)
    .sort((a, b) => key === 'ahead'
      ? (a.order ?? 0) - (b.order ?? 0)
      : toneRank[a.tone] - toneRank[b.tone] || Number(!!b.primary) - Number(!!a.primary) || b.weight - a.weight)

  const link = (to: string, label: string) => (roleCanViewPage(role, to) ? { to, label } : null)
  const sectionDefs: { key: SectionKey, title: string, link: { to: string, label: string } | null }[] = [
    { key: 'month', title: `${monthName} so far`, link: link('/budget', 'Budget Check') },
    { key: 'cash', title: 'Cash and loans', link: link('/cashflow', 'Cash & Loans') },
    { key: 'ahead', title: 'Looking ahead', link: guestsOnly ? link('/kitchen-week', 'Next 7 nights') : link('/this-week', 'Next 7 nights') }
  ]
  const sections = sectionDefs
    .map(s => ({ ...s, items: sorted(s.key).map(f => ({ tone: f.tone, text: f.text })) }))
    .filter(s => s.items.length > 0)

  // Headlines. With a sales fact (owner, GM): sales vs. goal leads; on/above goal it's good news only,
  // short of goal it is explained by the week's reasons (fewer guests, lower spend). Without one
  // (Sous Chef, Floor Manager): the biggest good news first, then the biggest concern.
  const headlineFor = (key: 'thisweek' | 'week') => {
    const sales = visible.find(f => f.id === SALES_FACT[key])
    if (sales?.tone === 'concern') {
      const reasons = visible.filter(f => f.section === key && f.tone === 'concern' && f.reason).sort((a, b) => b.weight - a.weight).map(f => f.reason!)
      const why = reasons.length ? `, with ${listJoin(reasons)}` : ''
      return key === 'thisweek' ? `A slower start to the week: ${sales.headline}${why}.` : `A quieter week: ${sales.headline}${why}.`
    }
    const hs = visible.filter(f => f.section === key && f.headline)
    const good = hs.filter(f => f.tone === 'good').sort((a, b) => Number(b === sales) - Number(a === sales) || b.weight - a.weight)
    const concern = hs.filter(f => f.tone === 'concern').sort((a, b) => b.weight - a.weight)
    if (key === 'thisweek') {
      if (good[0] && concern[0]) return `So far this week, ${good[0].headline}, though ${concern[0].headline}.`
      if (good[0]) return `A good start to the week: ${good[0].headline}${good[1] ? ` and ${good[1].headline}` : ''}.`
      if (concern[0]) return `A slower start to the week: ${concern[0].headline}.`
      return 'A steady start to the week, close to what’s expected so far.'
    }
    if (good[0] && concern[0]) return `${cap(good[0].headline!)} last week, though ${concern[0].headline}.`
    if (good[0]) return `A good week: ${good[0].headline}${good[1] ? ` and ${good[1].headline}` : ''}.`
    if (concern[0]) return `A quieter week: ${concern[0].headline}.`
    return 'A steady week, in line with recent weeks.'
  }
  const range = (from: string, to: string) => (from === to ? `${weekdayName(from).slice(0, 3)}, ${shortDate(from)}` : `${shortDate(from)} – ${shortDate(to)}`)
  const weeks: WeekBlock[] = []
  if (thisWeek && thisStrip) {
    weeks.push({
      key: 'thisweek', title: `This week so far (${range(thisWeek.start, thisWeek.through)})`, start: thisWeek.start, end: thisWeek.end,
      headline: headlineFor('thisweek'), link: guestsOnly ? link('/kitchen-week', 'This Week') : link('/this-week', 'This Week'),
      nights: thisStrip, items: sorted('thisweek').map(f => ({ tone: f.tone, text: f.text }))
    })
  }
  if (week && lastStrip) {
    weeks.push({
      key: 'week', title: `Last week (${range(week.start, week.end)})`, start: week.start, end: week.end,
      headline: headlineFor('week'), link: guestsOnly ? null : link('/pl/revenue-calendar', 'Daily Results'),
      nights: lastStrip, items: sorted('week').map(f => ({ tone: f.tone, text: f.text }))
    })
  }

  return { today, toastThrough, salesThrough, weeks, notices, sections, progress }
}
