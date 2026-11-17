// Which in-page view is showing, kept in the URL as ?show=<key> (PageTabs.vue). The first key is the
// default and leaves the URL clean. Deliberately not ?tab= (the Capacity page and the role guard use
// that) and not ?view= (Kitchen Hours uses it for the Sous Chef's restricted version).
export function usePageTab<T extends string>(keys: readonly T[], fallback: T) {
  const route = useRoute()
  const router = useRouter()
  return computed<T>({
    get: () => {
      const q = route.query.show
      return typeof q === 'string' && (keys as readonly string[]).includes(q) ? (q as T) : fallback
    },
    set: (v) => {
      router.replace({ query: { ...route.query, show: v === fallback ? undefined : v } })
    }
  })
}
