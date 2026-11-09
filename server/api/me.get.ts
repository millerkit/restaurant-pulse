// Who is signed in and what role they have (set by server/middleware/auth.ts). The app uses
// this to filter the nav; the server enforces the same rules independently.
export default defineEventHandler((event) => {
  const auth = event.context.auth as { role: string, email: string | null, name: string | null, realRole?: string } | undefined
  return { role: auth?.role ?? 'owner', email: auth?.email ?? null, name: auth?.name ?? null, viewingAs: auth?.realRole === 'owner' }
})
