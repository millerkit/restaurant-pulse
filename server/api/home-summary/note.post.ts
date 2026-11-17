// Saves the owners' note on Home › Summary (shown to every role). Owner-only: not listed in
// shared/utils/access.ts API_WRITES, so the auth middleware refuses it for the GM and Sous Chef,
// including an owner previewing as one of them. Body: { body: string }; blank clears the note.
const MAX_LENGTH = 600

export default defineEventHandler(async (event) => {
  const { body } = await readBody<{ body?: string }>(event) ?? {}
  const text = typeof body === 'string' ? body.trim() : ''
  if (text.length > MAX_LENGTH) throw createError({ statusCode: 400, statusMessage: `Keep the note under ${MAX_LENGTH} characters.` })
  const db = useDb()
  if (!text) {
    db.prepare('DELETE FROM home_summary_note WHERE id = 1').run()
    return { note: null }
  }
  const auth = event.context.auth as { name?: string | null, email?: string | null } | undefined
  const updatedBy = auth?.name ?? auth?.email ?? null
  const updatedAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO home_summary_note (id, body, updated_at, updated_by) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(text, updatedAt, updatedBy)
  return { note: { body: text, updatedAt, updatedBy } }
})
