<script setup lang="ts">
// Year switch for the Budget / Revenue / Labor tabs (2026 <-> 2027). Selecting a year updates
// the shared selection (useBudgetYearSelection), which app.vue uses to remount the page —
// so any unsaved edits are lost; the parent passes confirmLeave to ask first.
import { BUDGET_YEARS, useBudgetYearSelection } from '~/composables/useBudgetData'

const props = defineProps<{ confirmLeave?: () => boolean }>()
const { year, setYear } = useBudgetYearSelection()

function choose(y: number) {
  if (y === year.value) return
  if (props.confirmLeave && !props.confirmLeave()) return
  setYear(y)
}
</script>

<template>
  <div class="year-toggle" role="group" aria-label="Budget year">
    <span class="year-toggle-label">Year</span>
    <button
      v-for="y in BUDGET_YEARS"
      :key="y"
      type="button"
      :class="['year-btn', { active: y === year }]"
      :aria-pressed="y === year"
      @click="choose(y)"
    >{{ y }}</button>
  </div>
</template>

<style scoped>
.year-toggle { display: inline-flex; align-items: center; gap: 4px; margin: 0 0 14px; padding: 3px; border: 1px solid var(--hair); border-radius: 10px; background: var(--surface); }
.year-toggle-label { font-size: 12px; color: var(--ink-2); padding: 0 8px 0 6px; }
.year-btn { border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 600; padding: 5px 14px; border-radius: 7px; cursor: pointer; }
.year-btn:hover { color: var(--ink); }
.year-btn.active { background: var(--accent-wash); color: var(--accent-text); }
</style>
