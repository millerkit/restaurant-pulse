<script setup lang="ts">
// In-page view switcher (segmented control) for pages that hold several views, e.g. FOH Hours
// (Productivity / Hours / Trends) and Kitchen Hours (Hours / Cost). The selection lives in the URL as
// ?show= (see usePageTab), so a view can be linked and survives a reload. Sits under the section's own
// sub-nav, so it is styled as pills rather than as another underlined tab row.
defineProps<{ tabs: { key: string, label: string }[], modelValue: string, label?: string }>()
defineEmits<{ 'update:modelValue': [key: string] }>()
</script>

<template>
  <div class="page-tabs" role="tablist" :aria-label="label ?? 'Page view'">
    <button
      v-for="t in tabs" :key="t.key"
      type="button" role="tab"
      :aria-selected="modelValue === t.key"
      :class="{ active: modelValue === t.key }"
      @click="$emit('update:modelValue', t.key)"
    >{{ t.label }}</button>
  </div>
</template>

<style scoped>
.page-tabs { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; margin: 0 0 18px; background: var(--surface-alt); border: 1px solid var(--hair); border-radius: 12px; }
.page-tabs button { font: inherit; font-size: 13px; font-weight: 700; padding: 7px 18px; border: none; border-radius: 9px; background: transparent; color: var(--ink-2); cursor: pointer; }
.page-tabs button:hover { color: var(--ink); }
.page-tabs button.active { background: var(--accent); color: white; }
.page-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
