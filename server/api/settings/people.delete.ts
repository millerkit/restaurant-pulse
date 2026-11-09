export default defineEventHandler((event) => {
  const email = String(getQuery(event).email ?? '').trim().toLowerCase()
  const db = useDb()
  const row = db.prepare('SELECT role FROM user_roles WHERE email = ?').get(email) as { role: string } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No such person.' })
  if (row.role === 'owner') {
    const owners = (db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'owner'").get() as { n: number }).n
    if (owners <= 1) throw createError({ statusCode: 400, statusMessage: 'There must be at least one owner.' })
  }
  db.prepare('DELETE FROM user_roles WHERE email = ?').run(email)
  return { ok: true }
})
