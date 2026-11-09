import { staffKeys } from '../../utils/staff-overrides'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ guid?: string, kind?: string }>(event)
  const kind = body?.kind
  if (kind !== 'salaried' && kind !== 'grandfathered' && kind !== 'excluded') throw createError({ statusCode: 400, statusMessage: 'Pick a rule.' })
  const db = useDb()
  const p = db.prepare('SELECT first_name AS firstName, last_name AS lastName, chosen_name AS chosenName FROM toast_employees WHERE guid = ? AND deleted = 0')
    .get(String(body?.guid ?? '')) as { firstName: string | null, lastName: string | null, chosenName: string | null } | undefined
  if (!p) throw createError({ statusCode: 404, statusMessage: 'No such Toast employee.' })
  const k = staffKeys(p.firstName, p.lastName, p.chosenName)
  const key = kind === 'excluded' ? k.displayKey : k.nameKey
  if (!key) throw createError({ statusCode: 400, statusMessage: 'That employee has no name in Toast.' })
  // One rule per person.
  db.prepare('DELETE FROM staff_overrides WHERE name_key IN (?, ?)').run(k.nameKey, k.displayKey)
  db.prepare('INSERT INTO staff_overrides (name_key, kind, updated_at) VALUES (?, ?, ?)').run(key, kind, new Date().toISOString())
  return { ok: true }
})
