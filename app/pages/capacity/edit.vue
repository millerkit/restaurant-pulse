<script setup lang="ts">
// Redirect stub — Edit Capacity was merged into the Edit tab of the
// combined /capacity page 2026-09-18 (see app/pages/capacity/index.vue).
// Kept as a thin redirect (rather than deleted outright) so any existing
// bookmark or external link to /capacity/edit still lands somewhere useful.
definePageMeta({
  redirect: () => ({ path: '/capacity', query: { tab: 'edit' } })
})
</script>

<template>
  <div />
</template>
