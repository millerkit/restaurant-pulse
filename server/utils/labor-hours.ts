// Real Toast hours for the Staffing Plan (dynamic budgeting step 4, 2026-11-12).
// Spec: docs/specs/staffing-auto-hours.md (Kit chose a 6-week window, not the spec's 3: one odd
// week moves a 6-week mean a third as far, and the median is stored beside the mean so a gap shows).
//
// computeAutoHours() answers, per mapped Staffing Plan person and per overtime account: what do
// the last few usable Mon-Sun weeks of Toast say their weekly hours are? Nothing is written here
// (server/utils/labor-forecast.ts writes), and nothing is guessed: a person with no usable data
// gets no value, and the page keeps whatever it had.
import type Database from 'better-sqlite3'
import { loadLaborAccounts } from './labor-accounts'

type Db = Database.Database

// Complete Mon-Sun weeks averaged. Single named constant: change it here only.
export const AUTO_HOURS_WINDOW_WEEKS = 6
// How far back to look for usable weeks (holiday / short weeks are skipped, so reach further).
export const AUTO_HOURS_MAX_LOOKBACK_WEEKS = 10
// Fewer usable weeks than this: compute nothing and keep the current values.
export const AUTO_HOURS_MIN_USABLE_WEEKS = 3
// A week with fewer open nights than this isn't a normal week (a day is open at >= OPEN_NIGHT_MIN_COVERS covers).
const MIN_OPEN_NIGHTS = 5
const OPEN_NIGHT_MIN_COVERS = 15

export type HoursFlag = 'vacation?' | 'new hire' | 'no shifts 2 wks' | 'auto clock-outs'

export type SlotBasis = {
  guid: string
  accountId: number
  weeks: string[] // Mondays of the usable weeks, oldest first
  hours: number[] // that person's regular hours each of those weeks (0 where they didn't work)
  used: boolean[] // whether each week counted toward the mean
  mean: number | null
  median: number | null
  flags: HoursFlag[]
}
export type OtBasis = { weeks: string[], hours: number[], mean: number | null, median: number | null }
export type UnplannedHours = { guid: string, name: string, hours: number }

export type AutoHours = {
  window: { weeks: string[], skipped: { week: string, reason: string }[], latest: string }
  // Actual covers per open night over the window's weeks (null if Toast has none).
  coversPerNight: number | null
  slots: Map<number, { value: number | null, basis: SlotBasis }>
  ot: Map<number, { value: number | null, basis: OtBasis }>
  unplanned: Map<number, UnplannedHours[]>
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function dow(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}
function mondayOf(iso: string): string {
  return addDays(iso, -((dow(iso) + 6) % 7))
}
export function roundHalf(n: number): number {
  return Math.round(n * 2) / 2
}
function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length
}
function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
const r2 = (n: number | null) => n == null ? null : Math.round(n * 100) / 100

// The usable weeks: the last complete Mon-Sun weeks whose Sunday is on or before `latest`, skipping
// any week with a holiday closure or fewer than 5 open nights, reaching back at most
// AUTO_HOURS_MAX_LOOKBACK_WEEKS weeks until AUTO_HOURS_WINDOW_WEEKS are found. Returns Mondays,
// oldest first, plus every week considered (newest first) so callers can look at the last 2 weeks.
export function findUsableWeeks(db: Db, latest: string, requireHours = true): { usable: string[], considered: string[], skipped: { week: string, reason: string }[] } {
  const lastSunday = addDays(latest, -((dow(latest) + 7) % 7)) // dow 0 = Sunday -> itself
  const considered: string[] = []
  const skipped: { week: string, reason: string }[] = []
  const usable: string[] = []
  const holiday = db.prepare('SELECT COUNT(*) AS n FROM holiday_closures WHERE date BETWEEN ? AND ?')
  const openNights = db.prepare('SELECT COUNT(*) AS n FROM daily_toast_metrics WHERE date BETWEEN ? AND ? AND covers >= ?')
  const hoursRows = db.prepare('SELECT COUNT(*) AS n FROM daily_toast_job_hours WHERE date BETWEEN ? AND ?')
  for (let i = 0; i < AUTO_HOURS_MAX_LOOKBACK_WEEKS && usable.length < AUTO_HOURS_WINDOW_WEEKS; i++) {
    const sunday = addDays(lastSunday, -7 * i)
    const monday = addDays(sunday, -6)
    considered.push(monday)
    if ((holiday.get(monday, sunday) as { n: number }).n > 0) { skipped.push({ week: monday, reason: 'holiday closure' }); continue }
    const open = (openNights.get(monday, sunday, OPEN_NIGHT_MIN_COVERS) as { n: number }).n
    if (requireHours && (hoursRows.get(monday, sunday) as { n: number }).n === 0) { skipped.push({ week: monday, reason: 'no hours synced' }); continue }
    if (open < MIN_OPEN_NIGHTS) { skipped.push({ week: monday, reason: `only ${open} open nights` }); continue }
    usable.push(monday)
  }
  usable.reverse()
  return { usable, considered, skipped }
}

// Actual covers per open night (a night is open at >= 15 covers) over the given weeks.
export function actualCoversPerNight(db: Db, weeks: string[]): number | null {
  if (weeks.length === 0) return null
  let covers = 0
  let nights = 0
  const stmt = db.prepare('SELECT COALESCE(SUM(covers), 0) AS c, COUNT(*) AS n FROM daily_toast_metrics WHERE date BETWEEN ? AND ? AND covers >= ?')
  for (const monday of weeks) {
    const r = stmt.get(monday, addDays(monday, 6), OPEN_NIGHT_MIN_COVERS) as { c: number, n: number }
    covers += r.c
    nights += r.n
  }
  return nights > 0 ? covers / nights : null
}

export function latestJobHoursDate(db: Db): string | null {
  return (db.prepare('SELECT MAX(date) AS d FROM daily_toast_job_hours').get() as { d: string | null }).d
}

function employeeName(e: { chosen_name: string | null, first_name: string | null, last_name: string | null } | undefined, guid: string): string {
  if (!e) return guid.slice(0, 8)
  const full = [e.first_name, e.last_name].filter(Boolean).join(' ')
  return (e.chosen_name && e.last_name ? `${e.chosen_name} ${e.last_name}` : full || e.chosen_name || guid.slice(0, 8))
}

// Returns null when there isn't enough usable data (compute nothing, keep current values).
export function computeAutoHours(db: Db): AutoHours | null {
  const latest = latestJobHoursDate(db)
  if (!latest) return null
  const { usable, considered, skipped } = findUsableWeeks(db, latest)
  if (usable.length < AUTO_HOURS_MIN_USABLE_WEEKS) return null

  const accounts = loadLaborAccounts(db)
  const accountById = new Map(accounts.map(a => [a.accountId, a]))
  const jobAccount = new Map<string, number>()
  for (const r of db.prepare('SELECT job_guid, account_id FROM toast_job_labor_accounts WHERE account_id IS NOT NULL').all() as { job_guid: string, account_id: number }[]) {
    if (accountById.has(r.account_id)) jobAccount.set(r.job_guid, r.account_id)
  }

  // Everything from the oldest week considered to the last Sunday, aggregated by
  // account > employee > Monday. firstShift = the person's earliest shift on that account's jobs.
  const from = considered[considered.length - 1]!
  const to = addDays(considered[0]!, 6)
  type Agg = { reg: Map<string, number>, ot: Map<string, number>, autoOut: Map<string, number>, firstShift: string }
  const agg = new Map<number, Map<string, Agg>>()
  const rows = db.prepare(`
    SELECT date, employee_guid AS emp, job_guid AS job, regular_hours AS reg, overtime_hours AS ot, auto_clocked_out_hours AS autoOut
    FROM daily_toast_job_hours WHERE date BETWEEN ? AND ?
  `).all(from, to) as { date: string, emp: string, job: string, reg: number, ot: number, autoOut: number }[]
  for (const r of rows) {
    const accountId = jobAccount.get(r.job)
    if (accountId == null) continue
    const byEmp = agg.get(accountId) ?? new Map<string, Agg>()
    agg.set(accountId, byEmp)
    const a = byEmp.get(r.emp) ?? { reg: new Map(), ot: new Map(), autoOut: new Map(), firstShift: r.date }
    byEmp.set(r.emp, a)
    const wk = mondayOf(r.date)
    a.reg.set(wk, (a.reg.get(wk) ?? 0) + r.reg)
    a.ot.set(wk, (a.ot.get(wk) ?? 0) + r.ot)
    a.autoOut.set(wk, (a.autoOut.get(wk) ?? 0) + r.autoOut)
    if (r.reg + r.ot > 0 && r.date < a.firstShift) a.firstShift = r.date
  }
  // A person's real first shift on an account's jobs is looked up over all history, not just the
  // lookback, so someone away for the oldest weeks isn't mistaken for a new hire.
  for (const r of db.prepare('SELECT employee_guid AS emp, job_guid AS job, MIN(date) AS first FROM daily_toast_job_hours WHERE date <= ? GROUP BY employee_guid, job_guid').all(to) as { emp: string, job: string, first: string }[]) {
    const accountId = jobAccount.get(r.job)
    const a = accountId == null ? undefined : agg.get(accountId)?.get(r.emp)
    if (a && r.first < a.firstShift) a.firstShift = r.first
  }
  const lastTwoWeeks = considered.slice(0, 2)

  // ---- Per-slot averages ----------------------------------------------------------------
  const slots = new Map<number, { value: number | null, basis: SlotBasis }>()
  const mappedByAccount = new Map<number, Set<string>>()
  for (const acc of accounts) {
    if (acc.payType !== 'hourly') continue
    for (const slot of acc.slots) {
      if (!slot.toastEmployeeGuid || slot.id == null) continue
      const guid = slot.toastEmployeeGuid
      const set = mappedByAccount.get(acc.accountId) ?? new Set<string>()
      set.add(guid)
      mappedByAccount.set(acc.accountId, set)
      const mine = agg.get(acc.accountId)?.get(guid)
      const hoursPerWeek = usable.map(w => mine?.reg.get(w) ?? 0)
      const flags: HoursFlag[] = []
      const used: boolean[] = []
      let sawVacation = false
      let sawNewHire = false
      usable.forEach((w, i) => {
        // A week counts as the person's own once their first shift is on or before that week's
        // Tuesday (Monday is closed). Earlier weeks are left out silently: a new hire.
        if (!mine || mine.firstShift > addDays(w, 1)) {
          if (mine) sawNewHire = true
          used.push(false)
          return
        }
        if (hoursPerWeek[i]! > 0) { used.push(true); return }
        // Zero while a colleague on this role worked = probably vacation: left out and flagged.
        let othersWorked = false
        for (const [guid2, a2] of agg.get(acc.accountId) ?? []) {
          if (guid2 !== guid && (a2.reg.get(w) ?? 0) > 0) { othersWorked = true; break }
        }
        if (othersWorked) sawVacation = true
        used.push(false)
      })
      if (sawNewHire) flags.push('new hire')
      if (sawVacation) flags.push('vacation?')
      if (lastTwoWeeks.every(w => (mine?.reg.get(w) ?? 0) + (mine?.ot.get(w) ?? 0) === 0)) flags.push('no shifts 2 wks')
      if (mine && usable.some(w => (mine.autoOut.get(w) ?? 0) > 0)) flags.push('auto clock-outs')
      const counted = hoursPerWeek.filter((_, i) => used[i])
      const m = mean(counted)
      slots.set(slot.id, {
        value: m == null ? null : roundHalf(m),
        basis: { guid, accountId: acc.accountId, weeks: usable, hours: hoursPerWeek.map(h => r2(h)!), used, mean: r2(m), median: r2(median(counted)), flags }
      })
    }
  }

  // ---- Unplanned hours: people working an account's mapped jobs who aren't a slot there ------
  const unplanned = new Map<number, UnplannedHours[]>()
  const names = new Map((db.prepare('SELECT guid, first_name, last_name, chosen_name FROM toast_employees').all() as any[]).map(e => [e.guid as string, e]))
  for (const [accountId, mapped] of mappedByAccount) {
    const list: UnplannedHours[] = []
    for (const [guid, a] of agg.get(accountId) ?? []) {
      if (mapped.has(guid)) continue
      const total = usable.reduce((s, w) => s + (a.reg.get(w) ?? 0), 0)
      const perWeek = total / usable.length
      if (perWeek >= 0.5) list.push({ guid, name: employeeName(names.get(guid), guid), hours: roundHalf(perWeek) })
    }
    if (list.length > 0) unplanned.set(accountId, list.sort((x, y) => y.hours - x.hours))
  }

  // ---- Overtime: the window's average weekly overtime across the group's mapped hourly roles --
  const ot = new Map<number, { value: number | null, basis: OtBasis }>()
  for (const acc of accounts) {
    if (acc.payType !== 'overtime' || !acc.otBaseGroup) continue
    const groupAccounts = accounts.filter(a => a.payType === 'hourly' && a.groupKey === acc.otBaseGroup)
    const anyMapped = groupAccounts.some(a => [...jobAccount.values()].includes(a.accountId))
    const perWeek = usable.map(w => {
      let sum = 0
      for (const g of groupAccounts) for (const a of agg.get(g.accountId)?.values() ?? []) sum += a.ot.get(w) ?? 0
      return sum
    })
    const m = mean(perWeek)
    ot.set(acc.accountId, {
      value: anyMapped && m != null ? roundHalf(m) : null,
      basis: { weeks: usable, hours: perWeek.map(h => r2(h)!), mean: r2(m), median: r2(median(perWeek)) }
    })
  }

  return {
    window: { weeks: usable, skipped, latest },
    coversPerNight: actualCoversPerNight(db, usable),
    slots, ot, unplanned
  }
}
