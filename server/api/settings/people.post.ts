// Add a person or change their role. The email must also be on the Cloudflare Access
// allow-list (done in Cloudflare, not here) or they can't sign in at all.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string, role?: string, name?: string | null }>(event)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const role = body?.role
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address.' })
  if (role !== 'owner' && role !== 'gm' && role !== 'kitchen') throw createError({ statusCode: 400, statusMessage: 'Pick a role.' })
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null
  const db = useDb()
  const existing = db.prepare('SELECT role FROM user_roles WHERE email = ?').get(email) as { role: string } | undefined
  if (existing?.role === 'owner' && role !== 'owner') {
    const owners = (db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'owner'").get() as { n: number }).n
    if (owners <= 1) throw createError({ statusCode: 400, statusMessage: 'There must be at least one owner.' })
  }
  db.prepare(`
    INSERT INTO user_roles (email, role, name, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET role = excluded.role, name = excluded.name, updated_at = excluded.updated_at
  `).run(email, role, name, new Date().toISOString())
  return { ok: true }
})
