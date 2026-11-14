<script setup lang="ts">
// Settings › Restaurant Setup › Skipped nights for one area (2026-11-14). A night an area was used for
// something that isn't regular demand (e.g. Chef's Counter hosting a private, no-revenue event) while the
// rest of the restaurant ran normally. It's left out of that area's Covers & Spend trend only; other
// areas, sales and the forecast are untouched. (Whole-restaurant nights belong in holidays or Special Nights.)
type Row = { areaId: number, areaName: string, date: string, note: string | null }
const { data, refresh } = await useFetch<{ exclusions: Row[], areas: { id: number, name: string }[] }>('/api/settings/area-night-exclusions')

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const areaId = ref<number | null>(null)
const date = ref('')
const note = ref('')
const error = ref('')
watch(data, (d) => { if (areaId.value == null && d?.areas.length) areaId.value = d.areas[0]!.id }, { immediate: true })

async function add() {
  error.value = ''
  try {
    await $fetch('/api/settings/area-night-exclusions', { method: 'POST', body: { areaId: areaId.value, date: date.value, note: note.value } })
    date.value = ''
    note.value = ''
    await refresh()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Save failed'
  }
}
async function remove(r: Row) {
  error.value = ''
  try {
    await $fetch('/api/settings/area-night-exclusions', { method: 'DELETE', query: { areaId: r.areaId, date: r.date } })
    await refresh()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Delete failed'
  }
}
</script>

<template>
  <div>
    <h3 class="an-h">Skipped nights for one area</h3>
    <p class="an-note">
      A night an area was used for something other than regular service (say, a private event with no sales at Chef's Counter)
      while the rest of the restaurant ran normally. It's left out of that area's Covers &amp; Spend trend only.
      Whole-restaurant closures go under Holiday closures or Special Nights.
    </p>
    <ul v-if="data?.exclusions?.length" class="an-list">
      <li v-for="r in data.exclusions" :key="`${r.areaId}|${r.date}`">
        <span class="an-date">{{ fmt(r.date) }}</span>
        <span class="an-area">{{ r.areaName }}</span>
        <span class="an-text">{{ r.note }}</span>
        <button type="button" class="an-remove" :aria-label="`Remove ${r.areaName} ${r.date}`" @click="remove(r)">Remove</button>
      </li>
    </ul>
    <p v-else class="an-note">No skipped nights entered.</p>
    <form class="an-form" @submit.prevent="add">
      <select v-model="areaId" class="an-input" aria-label="Area">
        <option v-for="a in data?.areas ?? []" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <input v-model="date" type="date" class="an-input" aria-label="Night" required />
      <input v-model="note" type="text" class="an-input wide" placeholder="Why, e.g. Private investor event" maxlength="120" aria-label="Reason" />
      <button type="submit" class="an-add">Skip night</button>
      <span v-if="error" class="chip critical">{{ error }}</span>
    </form>
  </div>
</template>

<style scoped>
.an-h { font-size: 15px; font-weight: 800; color: var(--ink); margin: 0 0 4px; }
.an-note { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; margin: 0 0 10px; max-width: 760px; }
.an-list { list-style: none; margin: 0 0 10px; padding: 0; max-width: 760px; background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; }
.an-list li { display: flex; align-items: center; gap: 12px; padding: 8px 12px; font-size: 13px; }
.an-list li + li { border-top: 1px solid var(--hair); }
.an-date { width: 140px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.an-area { width: 110px; font-weight: 700; color: var(--ink); text-transform: capitalize; }
.an-text { flex: 1; color: var(--ink-2); }
.an-remove { font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--hair); background: var(--surface); color: var(--accent-text); cursor: pointer; }
.an-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.an-form .chip { margin: 0; }
.an-input { font-size: 13px; padding: 6px 8px; border: 1px solid var(--hair); border-radius: 6px; background: var(--surface-alt); color: var(--ink); }
.an-input.wide { width: 240px; }
.an-add { font-size: 12.5px; font-weight: 700; padding: 7px 14px; border-radius: 8px; border: none; background: var(--accent); color: white; cursor: pointer; }
</style>
