<script setup lang="ts">
// The Budget/Revenue/Labor tabs treat their year as a constant for the life of the page
// (see useBudgetYearSelection), so toggling the year remounts the page via its key.
const route = useRoute()
const { year } = useBudgetYearSelection()
const pageKey = computed(() => (route.path.startsWith('/budget') && route.path !== '/budget' ? `${route.path}:${year.value}` : undefined))
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLoadingIndicator color="var(--accent)" :height="3" :throttle="0" />
    <NuxtLayout>
      <NuxtPage :page-key="pageKey" />
    </NuxtLayout>
  </div>
</template>
