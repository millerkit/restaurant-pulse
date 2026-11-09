// Client-side half of the role rules (the server enforces them on every request regardless,
// server/middleware/auth.ts): a non-owner who navigates in-app to a page they can't see is
// sent to their home page instead of getting a page full of failed requests.
import { roleCanViewPage, roleHome } from '#shared/utils/access'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/privacy' || to.path === '/terms') return
  const { load } = useMe()
  const me = await load()
  if (!me || me.role === 'owner') return
  const tab = typeof to.query.tab === 'string' ? to.query.tab : null
  if (!roleCanViewPage(me.role, to.path, tab)) return navigateTo(roleHome(me.role))
})
