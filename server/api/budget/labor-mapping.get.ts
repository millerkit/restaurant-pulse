// Toast jobs -> Staffing Plan roles, and Toast employees (for the Staffing Plan's person picker),
// each with a suggested match (dynamic budgeting step 4, 2026-11-12). Suggestions are never saved
// on their own: the Settings table / the Staffing Plan show them preselected until someone picks.
// Owner-only by default deny (shared/utils/access.ts).
import { BOH_JOB_PATTERN } from '../../utils/boh-hours-report'
import { loadLaborAccounts } from '../../utils/labor-accounts'
import { restaurantToday } from '../../utils/capacity-forecast'

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export default defineEventHandler(() => {
  const db = useDb()
  const accounts = loadLaborAccounts(db).filter(a => a.payType === 'hourly')
  const accountList = accounts.map(a => ({ accountId: a.accountId, accountNumber: a.accountNumber, name: a.name, groupKey: a.groupKey, isHidden: a.isHidden }))
  const byName = new Map(accounts.map(a => [norm(a.name), a.accountId]))
  const saved = new Map((db.prepare('SELECT job_guid, account_id FROM toast_job_labor_accounts').all() as { job_guid: string, account_id: number | null }[]).map(r => [r.job_guid, r.account_id]))

  // Recent activity (last ~12 weeks of synced hours) so Settings can tell live jobs from old ones.
  const since = new Date(`${restaurantToday()}T00:00:00Z`)
  since.setUTCDate(since.getUTCDate() - 84)
  const sinceIso = since.toISOString().slice(0, 10)
  const jobHours = new Map((db.prepare('SELECT job_guid AS guid, SUM(regular_hours + overtime_hours) AS hours, COUNT(DISTINCT employee_guid) AS people FROM daily_toast_job_hours WHERE date >= ? GROUP BY job_guid').all(sinceIso) as { guid: string, hours: number, people: number }[]).map(r => [r.guid, r]))

  const jobs = (db.prepare('SELECT guid, title, wage_frequency AS wageFrequency, deleted FROM toast_jobs ORDER BY title').all() as { guid: string, title: string, wageFrequency: string | null, deleted: number }[])
    .filter(j => !j.deleted || jobHours.has(j.guid) || saved.has(j.guid))
    .map((j) => {
      const t = norm(j.title)
      const isBoh = BOH_JOB_PATTERN.test(j.title)
      // Exact title match first, then a single account whose name contains / is contained in the title.
      let suggested: number | null = byName.get(t) ?? null
      if (suggested == null) {
        const hits = accounts.filter(a => t.length >= 3 && (norm(a.name).includes(t) || t.includes(norm(a.name))))
        if (hits.length === 1) suggested = hits[0]!.accountId
      }
      return {
        guid: j.guid, title: j.title, wageFrequency: j.wageFrequency, deleted: !!j.deleted, isBoh,
        savedAccountId: saved.has(j.guid) ? saved.get(j.guid)! : undefined,
        isSaved: saved.has(j.guid),
        suggestedAccountId: suggested,
        recentHours: Math.round((jobHours.get(j.guid)?.hours ?? 0) * 10) / 10,
        recentPeople: jobHours.get(j.guid)?.people ?? 0
      }
    })

  const empHours = new Set((db.prepare('SELECT DISTINCT employee_guid AS guid FROM daily_toast_job_hours WHERE date >= ?').all(sinceIso) as { guid: string }[]).map(r => r.guid))
  const employees = (db.prepare('SELECT guid, first_name AS firstName, last_name AS lastName, chosen_name AS chosenName, deleted FROM toast_employees').all() as any[])
    .filter(e => !e.deleted || empHours.has(e.guid))
    .map(e => ({
      guid: e.guid as string,
      name: ((e.chosenName && e.lastName ? `${e.chosenName} ${e.lastName}` : [e.firstName, e.lastName].filter(Boolean).join(' ')) || e.chosenName || e.guid.slice(0, 8)) as string,
      firstName: e.firstName as string | null, lastName: e.lastName as string | null, chosenName: e.chosenName as string | null,
      deleted: !!e.deleted, workedRecently: empHours.has(e.guid)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // A suggested employee for each unmapped, named slot: a unique name match (full name, or the
  // first / chosen name when the slot holds just that).
  const slotSuggestions: Record<number, string> = {}
  const slots = db.prepare('SELECT id, employee_name AS name FROM labor_position_slots WHERE toast_employee_guid IS NULL AND employee_name IS NOT NULL AND employee_name != \'\'').all() as { id: number, name: string }[]
  for (const s of slots) {
    const n = norm(s.name)
    if (!n) continue
    const hits = employees.filter(e => [norm(e.name), norm([e.firstName, e.lastName].filter(Boolean).join(' ')), ...(n.includes(' ') ? [] : [norm(e.firstName), norm(e.chosenName)])].includes(n))
    const unique = new Set(hits.map(h => h.guid))
    if (unique.size === 1) slotSuggestions[s.id] = hits[0]!.guid
  }

  return { accounts: accountList, jobs, employees, slotSuggestions }
})
