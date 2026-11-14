<script setup lang="ts">
// One-line breakeven summary on Covers & Spend; the full view is Planning › Breakeven (/breakeven).
type Tier = { key: string, stillShort: number | null, eventSalesNeeded: number }
const { data } = useFetch<{ tiers: Tier[] }>('/api/breakeven', { lazy: true, server: false })
const pl = computed(() => data.value?.tiers.find(t => t.key === 'fixed_opex') ?? null)
const fmtMoney = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString()}`
</script>

<template>
  <section class="be-summary">
    <span class="label">Breakeven this month</span>
    <template v-if="pl && pl.stillShort != null">
      <span v-if="pl.stillShort > 0" class="chip serious">▲ {{ fmtMoney(pl.stillShort) }} short</span>
      <span v-else class="chip good">✓ covered</span>
      <span class="note">
        <template v-if="pl.stillShort > 0">after expected covers and planned events & retail — about {{ fmtMoney(pl.eventSalesNeeded) }} more event or retail sales would close it.</template>
        <template v-else>at expected covers with planned events & retail.</template>
      </span>
    </template>
    <NuxtLink to="/breakeven" class="link">See Breakeven →</NuxtLink>
  </section>
</template>

<style scoped>
.be-summary {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 8px 0 26px;
  padding: 12px 16px; background: var(--surface); border: 1px solid var(--hair); border-radius: 14px; font-size: 12.5px;
}
.label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.note { color: var(--ink-2); flex: 1 1 260px; }
.link { margin-left: auto; white-space: nowrap; }
</style>
