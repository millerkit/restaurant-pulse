<script setup lang="ts">
import { useTheme, type ThemePreference } from '~/composables/useTheme'

const { theme, setTheme } = useTheme()

const options: { value: ThemePreference, label: string, icon: string }[] = [
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'dark', label: 'Dark', icon: '☾' },
  { value: 'system', label: 'Match system', icon: '◐' }
]
</script>

<template>
  <div class="theme-toggle" role="group" aria-label="Theme">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :class="['theme-toggle-btn', { active: theme === opt.value }]"
      :aria-pressed="theme === opt.value"
      :aria-label="opt.label"
      :title="opt.label"
      @click="setTheme(opt.value)"
    >{{ opt.icon }}</button>
  </div>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--hair);
  border-radius: 999px;
  background: var(--surface-alt);
}
.theme-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.theme-toggle-btn:hover { color: var(--ink); }
.theme-toggle-btn.active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--card-shadow);
}
</style>
