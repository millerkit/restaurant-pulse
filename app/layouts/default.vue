<script setup lang="ts">
import site from '~/config/site.json'

// Sectioned navigation (2026-11 UI cleanup): a few sections in the top bar
// (a bottom bar on phones), with the current section's pages as sub-tabs
// underneath. Sections and pages come from app/utils/navigation.ts.
// Use the router's own current route, not useRoute(): inside a layout, useRoute()
// can lag behind the real navigation (it only updates once the new page has
// finished mounting), which left the nav highlighting the old section.
const router = useRouter()
const route = router.currentRoute
const queryTab = computed(() => (typeof route.value.query.tab === 'string' ? route.value.query.tab : undefined))
const active = computed(() => findActive(route.value.path, queryTab.value))
const onSettings = computed(() => SETTINGS_PATHS.includes(route.value.path.replace(/\/+$/, '') || '/'))
// Most pages block navigation on their first data fetch, so a click can look
// dead for a second. Remember where we're headed and highlight it right away.
const pendingTo = ref<string | null>(null)
router.beforeEach((to) => { pendingTo.value = to.fullPath })
router.afterEach(() => { pendingTo.value = null })
router.onError(() => { pendingTo.value = null })
const pendingActive = computed(() => {
  if (!pendingTo.value) return null
  const u = new URL(pendingTo.value, 'http://x')
  return findActive(u.pathname, u.searchParams.get('tab') ?? undefined)
})
const shownSection = computed(() => (pendingActive.value ?? active.value)?.section.key)
const subPages = computed(() => (active.value && active.value.section.pages.length > 1 ? active.value.section.pages : []))
</script>

<template>
  <div class="wrap">
    <div class="topbar">
      <NuxtLink to="/" class="brand">{{ site.restaurantName }}</NuxtLink>
      <nav class="section-nav" aria-label="Sections">
        <NuxtLink
          v-for="s in NAV_SECTIONS"
          :key="s.key"
          :to="s.pages[0]!.to"
          :class="['section-link', shownSection === s.key && 'active']"
          :aria-current="active?.section.key === s.key ? 'page' : undefined"
        >
          <NavIcon :name="s.icon" />
          <span>{{ s.label }}</span>
        </NuxtLink>
      </nav>
      <div class="topbar-tools">
        <ThemeToggle />
        <NuxtLink to="/settings" :class="['gear', onSettings && 'active']" title="Settings" aria-label="Settings">
          <NavIcon name="settings" />
        </NuxtLink>
      </div>
    </div>

    <nav v-if="subPages.length" class="subnav" :aria-label="`${active!.section.label} pages`">
      <NuxtLink
        v-for="p in subPages"
        :key="p.to"
        :to="p.to"
        :class="['subnav-link', (pendingActive ? pendingActive.page.to === p.to : isPageActive(p, route.path, queryTab)) && 'active']"
      >{{ p.label }}</NuxtLink>
    </nav>

    <slot />

    <footer class="app-footer">
      <a href="mailto:kmillercc@gmail.com">Contact / Support</a>
      <NuxtLink to="/privacy">Privacy</NuxtLink>
      <NuxtLink to="/terms">Terms</NuxtLink>
    </footer>

    <!-- Phone: sections move to a bottom bar, easier to reach mid-shift. -->
    <nav class="bottom-nav" aria-label="Sections">
      <NuxtLink
        v-for="s in NAV_SECTIONS"
        :key="s.key"
        :to="s.pages[0]!.to"
        :class="['bottom-link', shownSection === s.key && 'active']"
      >
        <NavIcon :name="s.icon" />
        <span>{{ s.label }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
