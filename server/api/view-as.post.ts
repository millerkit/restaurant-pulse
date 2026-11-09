// Owner-only "view as" switch (see applyViewAs in server/middleware/auth.ts). Body: { role: 'gm' |
// 'kitchen' | null }. null clears it. A person who isn't really an owner is refused, so a GM or Sous
// Chef can't use this for anything.
export default defineEventHandler(async (event) => {
  const auth = event.context.auth as { role: string, realRole?: string } | undefined
  const realRole = auth?.realRole ?? auth?.role
  if (realRole !== 'owner') throw createError({ statusCode: 403, statusMessage: 'Only an owner can do this.' })
  const body = await readBody<{ role?: string | null }>(event)
  const role = body?.role
  if (role == null) {
    deleteCookie(event, 'view_as', { path: '/' })
    return { ok: true, viewingAs: null }
  }
  if (role !== 'gm' && role !== 'kitchen') throw createError({ statusCode: 400, statusMessage: 'Pick gm or kitchen.' })
  setCookie(event, 'view_as', role, { path: '/', httpOnly: true, sameSite: 'lax', secure: !import.meta.dev, maxAge: 60 * 60 * 8 })
  return { ok: true, viewingAs: role }
})
