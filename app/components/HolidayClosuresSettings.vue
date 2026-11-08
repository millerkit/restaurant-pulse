<script setup lang="ts">
// Settings › Restaurant Setup › Holiday closures (2026-11-08): named, dated
// whole-restaurant closures, replacing a per-month count. Each one is a night
// with no dinner service and $0 expected sales in the budget, projections and
// Next 7 Nights. Buyouts, events, off-site nights and other one-off closures go
// on the Sales Plan's Special Nights instead, which handle their revenue.
const thisYear = new Date().getFullYear()
const year = ref(thisYear)
type Holiday = { date: string, name: string }
const { data, refresh } = await useFetch<{ year: number, holidays: Holiday[], legacyCounts: { month: number, count: number }[] }>('/api/settings/holidays', { query: { year } })
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
function nthWeekday(y: number, m: number, dow: number, n: number) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  return iso(y, m, 1 + ((dow - first + 7) % 7) + (n - 1) * 7)
}
function easter(y: number) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return iso(y, month, day)
}
const isMonday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1
// Common closures; ones that land on a Monday are left out (already closed).
const suggestions = computed<Holiday[]>(() => {
  const y = year.value
  const taken = new Set((data.value?.holidays ?? []).map(h => h.date))
  return [
    { date: iso(y, 1, 1), name: "New Year's Day" },
    { date: easter(y), name: 'Easter' },
    { date: iso(y, 7, 4), name: 'Independence Day' },
    { date: nthWeekday(y, 11, 4, 4), name: 'Thanksgiving' },
    { date: iso(y, 12, 24), name: 'Christmas Eve' },
    { date: iso(y, 12, 25), name: 'Christmas Day' },
    { date: iso(y, 12, 31), name: "New Year's Eve" }
  ].filter(s => !taken.has(s.date) && !isMonday(s.date))
})

function fmt(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const status = ref<{ kind: 'idle' | 'error', msg: string }>({ kind: 'idle', msg: '' })
async function add(h: Holiday) {
  status.value = { kind: 'idle', msg: '' }
  try {
    await $fetch('/api/settings/holidays', { method: 'POST', body: h })
    await refresh()
  } catch (err: any) {
    status.value = { kind: 'error', msg: err?.data?.statusMessage || err?.message || 'Save failed' }
  }
}
async function remove(date: string) {
  try {
    await $fetch('/api/settings/holidays', { method: 'DELETE', query: { date } })
    await refresh()
  } catch (err: any) {
    status.value = { kind: 'error', msg: err?.data?.statusMessage || err?.message || 'Delete failed' }
  }
}
const newDate = ref('')
const newName = ref('')
async function addCustom() {
  if (newDate.value && isMonday(newDate.value)) { status.value = { kind: 'error', msg: 'That date is a Monday, when the restaurant is already closed' }; return }
  await add({ date: newDate.value, name: newName.value })
  if (status.value.kind !== 'error') { newDate.value = ''; newName.value = '' }
}
async function clearLegacy() {
  await $fetch('/api/settings/holidays', { method: 'POST', body: { clearLegacyCounts: true } })
  await refresh()
}
</script>

<template>
  <div>
    <div class="hc-head">
      <h3 class="hc-h">Holiday closures</h3>
      <div class="hc-years" role="group" aria-label="Year">
        <button v-for="y in [thisYear, thisYear + 1]" :key="y" type="button" :class="['hc-year', { active: year === y }]" @click="year = y">{{ y }}</button>
      </div>
    </div>
    <p class="hc-note">
      Days the whole restaurant is closed, beyond Mondays. Each counts as a night with no sales in the budget and projections.
      Buyouts, events and off-site catering nights go under <NuxtLink to="/budget/revenue">Special Nights on the Sales Plan</NuxtLink> instead,
      where their revenue is budgeted.
    </p>

    <div v-if="data?.legacyCounts?.length" class="hc-legacy">
      <strong>Old monthly counts, no longer used:</strong>
      {{ data.legacyCounts.map(c => `${MONTHS[c.month - 1]} ${c.count}`).join(', ') }}.
      Add the real holidays here by date, and enter any buyout, event or off-site night as a Special Night on the Sales Plan.
      Then recompute revenue from Capacity on the Sales Plan for the months affected.
      <button type="button" class="hc-mini" @click="clearLegacy">Clear old counts</button>
    </div>

    <ul v-if="data?.holidays?.length" class="hc-list">
      <li v-for="h in data.holidays" :key="h.date">
        <span class="hc-date">{{ fmt(h.date) }}</span>
        <span class="hc-name">{{ h.name }}</span>
        <button type="button" class="hc-remove" :aria-label="`Remove ${h.name}`" @click="remove(h.date)">Remove</button>
      </li>
    </ul>
    <p v-else class="hc-note">No holiday closures entered for {{ year }}.</p>

    <div v-if="suggestions.length" class="hc-suggest">
      <span>Add:</span>
      <button v-for="sgg in suggestions" :key="sgg.date" type="button" class="hc-chip" @click="add(sgg)">+ {{ sgg.name }} <span class="hc-chip-date">{{ fmt(sgg.date) }}</span></button>
    </div>
    <form class="hc-custom" @submit.prevent="addCustom">
      <input v-model="newDate" type="date" class="hc-input" :min="`${year}-01-01`" :max="`${year}-12-31`" aria-label="Closure date" required />
      <input v-model="newName" type="text" class="hc-input wide" placeholder="Name, e.g. Staff party" maxlength="80" aria-label="Closure name" required />
      <button type="submit" class="hc-add">Add closure</button>
      <span v-if="status.kind === 'error'" class="chip critical">{{ status.msg }}</span>
    </form>
  </div>
</template>

<style scoped>
.hc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; max-width: 760px; }
.hc-h { font-size: 15px; font-weight: 800; color: var(--ink); margin: 0 0 4px; }
.hc-note { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; margin: 0 0 10px; max-width: 760px; }
.hc-years { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--hair); border-radius: 999px; background: var(--surface-alt); }
.hc-year { font-size: 12px; font-weight: 700; padding: 4px 12px; border: none; border-radius: 999px; background: transparent; color: var(--ink-3); cursor: pointer; }
.hc-year.active { background: var(--surface); color: var(--ink); box-shadow: var(--card-shadow); }
.hc-legacy { font-size: 12.5px; line-height: 1.5; color: var(--ink-2); background: var(--warning-wash); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; max-width: 760px; }
.hc-list { list-style: none; margin: 0 0 10px; padding: 0; max-width: 760px; background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; }
.hc-list li { display: flex; align-items: center; gap: 12px; padding: 8px 12px; font-size: 13px; }
.hc-list li + li { border-top: 1px solid var(--hair); }
.hc-date { width: 110px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.hc-name { flex: 1; font-weight: 700; color: var(--ink); }
.hc-remove, .hc-mini { font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--hair); background: var(--surface); color: var(--accent-text); cursor: pointer; }
.hc-suggest { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 12.5px; color: var(--ink-3); max-width: 760px; }
.hc-chip { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--hair); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.hc-chip:hover { border-color: var(--accent); color: var(--accent-text); }
.hc-chip-date { font-weight: 500; color: var(--ink-3); }
.hc-custom { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.hc-custom .chip { margin: 0; }
.hc-input { font-size: 13px; padding: 6px 8px; border: 1px solid var(--hair); border-radius: 6px; background: var(--surface-alt); color: var(--ink); }
.hc-input.wide { width: 220px; }
.hc-add { font-size: 12.5px; font-weight: 700; padding: 7px 14px; border-radius: 8px; border: none; background: var(--accent); color: white; cursor: pointer; }
</style>
