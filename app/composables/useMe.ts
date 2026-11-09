// Who is signed in (server/api/me.get.ts). Shared via useState so the nav, the route guard
// and pages all read one copy per request. The server enforces access independently
// (server/middleware/auth.ts); this only decides what to show.
import type { Role } from '#shared/utils/access'

export type Me = { role: Role, email: string | null, name: string | null }

export function useMe() {
  const me = useState<Me | null>('me', () => null)
  async function load() {
    if (me.value) return me.value
    try {
      me.value = await $fetch<Me>('/api/me', { headers: useRequestHeaders(['cookie', 'authorization', 'cf-access-jwt-assertion', 'host']) })
    } catch {
      me.value = null
    }
    return me.value
  }
  const role = computed<Role>(() => me.value?.role ?? 'owner')
  const isOwner = computed(() => role.value === 'owner')
  return { me, role, isOwner, load }
}
