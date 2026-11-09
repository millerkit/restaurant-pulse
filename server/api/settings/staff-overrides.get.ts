// Benefits eligibility rules for Settings: current overrides plus the active Toast employees
// they can be applied to.
import { staffKeys, type StaffKind } from '../../utils/staff-overrides'

export default defineEventHandler(() => {
  const db = useDb()
  const overrides = db.prepare('SELECT name_key AS nameKey, kind FROM staff_overrides ORDER BY kind, name_key').all() as { nameKey: string, kind: StaffKind }[]
  const people = db.prepare(
    'SELECT guid, first_name AS firstName, last_name AS lastName, chosen_name AS chosenName FROM toast_employees WHERE deleted = 0'
  ).all() as { guid: string, firstName: string | null, lastName: string | null, chosenName: string | null }[]
  const employees = people.map((p) => {
    const k = staffKeys(p.firstName, p.lastName, p.chosenName)
    const name = [(p.chosenName || p.firstName || '').trim(), (p.lastName ?? '').trim()].filter(Boolean).join(' ')
    return { guid: p.guid, name, nameKey: k.nameKey, displayKey: k.displayKey }
  }).filter(e => e.name).sort((a, b) => a.name.localeCompare(b.name))
  const label = new Map<string, string>()
  for (const e of employees) { label.set(`n:${e.nameKey}`, e.name); label.set(`d:${e.displayKey}`, e.name) }
  return {
    overrides: overrides.map(o => ({
      nameKey: o.nameKey,
      kind: o.kind,
      // Show the real name when Toast still has them; otherwise the stored key (a typo or a rename).
      name: label.get(`${o.kind === 'excluded' ? 'd' : 'n'}:${o.nameKey}`) ?? null
    })),
    employees: employees.map(e => ({ guid: e.guid, name: e.name }))
  }
})
