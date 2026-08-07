<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Edit Capacity` })

type AreaRow = {
  id: number, name: string, seats: number, max_turns_per_night: number,
  capacity_nov_apr: number | null, capacity_may_oct: number, per_cover_revenue: number, notes: string | null
}
type SeasonalityRow = { month: number, holiday_closures: number }
type AreaSeasonalityRow = { area_id: number, month: number, expected_covers: number }

const { data, pending, error, refresh } = await useFetch<{ areas: AreaRow[], seasonality: SeasonalityRow[], areaSeasonality: AreaSeasonalityRow[] }>('/api/capacity/settings')

function isMayThroughOct(month: number): boolean {
  return month >= 5 && month <= 10
}
// Every input on this page is integer-only except Max Turns/Night and
// Per-Cover Revenue (added 2026-08-07, at the user's request, to save
// horizontal space and simplify data entry) — capacity * fill % (the seed
// migration's source) routinely produces floating-point noise
// (4.199999999999999 instead of 4) too, so this also cleans that up before
// it ever reaches an editable input field.
function roundCovers(n: number): number {
  return Math.round(n)
}

// Editable drafts, separate from the loaded data so unsaved edits don't
// leak into anything else and a failed save doesn't need a re-fetch to
// recover a clean baseline to diff against — same split budget/edit.vue
// already uses between loaded data and in-progress edits. capacity_nov_apr
// is edited as a plain string so "closed this season" (null) can be
// represented as an empty field rather than a magic number like 0 (0 would
// mean "open, zero capacity," a different real state).
type AreaDraft = { id: number, name: string, seats: string, maxTurnsPerNight: string, capacityNovApr: string, capacityMayOct: string, perCoverRevenue: string }
// One row per month: holiday closures (unchanged) plus each area's own
// expected nightly covers, keyed by area id — the real editable projection
// input as of 2026-08-07 (replacing a single blended Expected Fill %),
// per the user's own request after $86.12/cover looked low blended across
// very different areas.
type MonthlyDraft = { month: number, holidayClosuresInput: string, areaCoversInput: Record<number, string> }

const areaDrafts = ref<AreaDraft[]>([])
const monthlyDrafts = ref<MonthlyDraft[]>([])

function loadDrafts() {
  areaDrafts.value = (data.value?.areas ?? []).map(a => ({
    id: a.id,
    name: a.name,
    seats: String(Math.round(a.seats)),
    maxTurnsPerNight: String(a.max_turns_per_night),
    capacityNovApr: a.capacity_nov_apr == null ? '' : String(Math.round(a.capacity_nov_apr)),
    capacityMayOct: String(Math.round(a.capacity_may_oct)),
    perCoverRevenue: String(a.per_cover_revenue)
  }))
  const areaMonthMap = new Map((data.value?.areaSeasonality ?? []).map(r => [`${r.area_id}:${r.month}`, r.expected_covers]))
  monthlyDrafts.value = (data.value?.seasonality ?? []).map(s => ({
    month: s.month,
    holidayClosuresInput: String(s.holiday_closures),
    areaCoversInput: Object.fromEntries(areaDrafts.value.map(a => [a.id, String(roundCovers(areaMonthMap.get(`${a.id}:${s.month}`) ?? 0))]))
  }))
}
watch(data, loadDrafts, { immediate: true })

const draftSnapshot = computed(() => JSON.stringify({ areaDrafts: areaDrafts.value, monthlyDrafts: monthlyDrafts.value }))
// Compares the draft against what loadDrafts() would produce from a clean
// reload of the current data, rather than against the raw loaded rows —
// avoids false positives just from string-vs-number formatting.
const cleanDraftSnapshot = computed(() => {
  const areas = (data.value?.areas ?? []).map(a => ({
    id: a.id, name: a.name, seats: String(Math.round(a.seats)), maxTurnsPerNight: String(a.max_turns_per_night),
    capacityNovApr: a.capacity_nov_apr == null ? '' : String(Math.round(a.capacity_nov_apr)),
    capacityMayOct: String(Math.round(a.capacity_may_oct)), perCoverRevenue: String(a.per_cover_revenue)
  }))
  const areaMonthMap = new Map((data.value?.areaSeasonality ?? []).map(r => [`${r.area_id}:${r.month}`, r.expected_covers]))
  const monthly = (data.value?.seasonality ?? []).map(s => ({
    month: s.month,
    holidayClosuresInput: String(s.holiday_closures),
    areaCoversInput: Object.fromEntries(areas.map(a => [a.id, String(roundCovers(areaMonthMap.get(`${a.id}:${s.month}`) ?? 0))]))
  }))
  return JSON.stringify({ areaDrafts: areas, monthlyDrafts: monthly })
})
const hasUnsavedChanges = computed(() => draftSnapshot.value !== cleanDraftSnapshot.value)

// Live-derived Fill %/Per-Cover $ for a month, recomputed from the
// in-progress drafts (not the loaded data) so an edit shows its effect
// immediately, before saving — same per-area capacity/per-cover-revenue
// math as server/api/capacity.get.ts's nightlyExpectedForMonth.
function areaCapacityForMonth(a: AreaDraft, month: number): number {
  const raw = isMayThroughOct(month) ? a.capacityMayOct : a.capacityNovApr
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}
function monthDerived(s: MonthlyDraft) {
  let covers = 0, revenue = 0, maxCovers = 0
  for (const a of areaDrafts.value) {
    const c = Number(s.areaCoversInput[a.id])
    const coversNum = Number.isFinite(c) ? c : 0
    covers += coversNum
    revenue += coversNum * (Number(a.perCoverRevenue) || 0)
    maxCovers += areaCapacityForMonth(a, s.month)
  }
  return {
    fillPct: maxCovers > 0 ? covers / maxCovers : null,
    avgCheck: covers > 0 ? revenue / covers : null
  }
}
function fmtPct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}
function fmtMoney2(n: number | null): string {
  return n == null ? '—' : n.toFixed(2)
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', handleBeforeUnload))
onBeforeRouteLeave(() => {
  if (hasUnsavedChanges.value && !window.confirm('You have unsaved capacity edits. Leave without saving?')) return false
})

const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveMessage = ref('')

function num(s: string): number {
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}
// Rounds to the nearest integer, but preserves NaN (Math.round(NaN) is
// already NaN, so the invalid-number checks below still catch it) — used
// for every field on this page except Max Turns/Night and Per-Cover
// Revenue, which stay decimal.
function intNum(s: string): number {
  return Math.round(num(s))
}

async function save() {
  saveStatus.value = 'saving'
  saveMessage.value = ''
  try {
    const areas = areaDrafts.value.map(a => ({
      id: a.id,
      seats: intNum(a.seats),
      maxTurnsPerNight: num(a.maxTurnsPerNight),
      capacityNovApr: a.capacityNovApr.trim() === '' ? null : intNum(a.capacityNovApr),
      capacityMayOct: intNum(a.capacityMayOct),
      perCoverRevenue: num(a.perCoverRevenue)
    }))
    const seasonality = monthlyDrafts.value.map(s => ({
      month: s.month,
      holidayClosures: intNum(s.holidayClosuresInput)
    }))
    const areaSeasonality = monthlyDrafts.value.flatMap(s =>
      areaDrafts.value.map(a => ({
        areaId: a.id,
        month: s.month,
        expectedCovers: intNum(s.areaCoversInput[a.id])
      }))
    )
    for (const a of areas) {
      if ([a.seats, a.maxTurnsPerNight, a.capacityMayOct, a.perCoverRevenue].some(Number.isNaN) || (a.capacityNovApr !== null && Number.isNaN(a.capacityNovApr))) {
        throw new Error(`Invalid number in the ${areaDrafts.value.find(d => d.id === a.id)?.name} row`)
      }
    }
    for (const s of seasonality) {
      if (Number.isNaN(s.holidayClosures)) {
        throw new Error(`Invalid holiday closures number in the ${MONTH_NAMES[s.month - 1]} row`)
      }
    }
    for (const s of areaSeasonality) {
      if (Number.isNaN(s.expectedCovers)) {
        const areaName = areaDrafts.value.find(a => a.id === s.areaId)?.name
        throw new Error(`Invalid covers number for ${areaName} in ${MONTH_NAMES[s.month - 1]}`)
      }
    }
    await $fetch('/api/capacity/settings', { method: 'POST', body: { areas, seasonality, areaSeasonality } })
    await refresh()
    saveStatus.value = 'saved'
  } catch (err: any) {
    saveStatus.value = 'error'
    saveMessage.value = err?.data?.statusMessage || err?.message || 'Save failed'
  }
}
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading capacity assumptions…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load capacity assumptions</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>

    <template v-else>
      <header class="page-head">
        <div>
          <h1>{{ site.restaurantName }} — Edit Capacity</h1>
          <div class="sub">Capacity, turns/night, and per-cover revenue assumptions, plus the monthly fill % and holiday-closure counts these get tested against. See <NuxtLink to="/capacity">Capacity Pace</NuxtLink> to see how real fill % and per-cover spend compare.</div>
        </div>
      </header>

      <section>
        <div class="section-head">
          <div class="section-label">Per-Area Capacity &amp; Revenue</div>
          <div class="section-note">Leave "Capacity Nov–Apr" blank if the area is closed that season (e.g. outdoor).</div>
        </div>
        <div class="pl-table-card">
          <table class="pl-table edit-table">
            <caption>Editable per-area capacity and revenue assumptions</caption>
            <thead>
              <tr>
                <th scope="col">Area</th>
                <th scope="col">Seats</th>
                <th scope="col">Max Turns/Night</th>
                <th scope="col">Capacity Nov–Apr</th>
                <th scope="col">Capacity May–Oct</th>
                <th scope="col">Per-Cover Revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in areaDrafts" :key="a.id">
                <th scope="row" style="text-transform: capitalize;">{{ a.name }}</th>
                <td><input v-model="a.seats" class="cell-input" inputmode="numeric" /></td>
                <td><input v-model="a.maxTurnsPerNight" class="cell-input decimal" inputmode="decimal" /></td>
                <td><input v-model="a.capacityNovApr" class="cell-input" inputmode="numeric" placeholder="closed" /></td>
                <td><input v-model="a.capacityMayOct" class="cell-input" inputmode="numeric" /></td>
                <td class="money-cell">$<input v-model="a.perCoverRevenue" class="cell-input decimal" inputmode="decimal" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div class="section-head">
          <div class="section-label">Expected Nightly Covers by Area &amp; Holiday Closures</div>
          <div class="section-note">Average nightly covers per area, by month — edit these directly. Fill % and Per-Cover $ are derived from them, shown for reference. Holiday closures are additional nights closed beyond the standing Monday closure.</div>
        </div>
        <div class="pl-table-card">
          <table class="pl-table edit-table">
            <caption>Editable monthly expected covers per area, derived fill percentage and per-cover revenue, and holiday closure counts</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th v-for="a in areaDrafts" :key="a.id" scope="col" style="text-transform: capitalize;">{{ a.name }}</th>
                <th scope="col">Fill %</th>
                <th scope="col">Per-Cover $</th>
                <th scope="col">Holiday Closures</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in monthlyDrafts" :key="s.month">
                <th scope="row">{{ MONTH_NAMES[s.month - 1] }}</th>
                <td v-for="a in areaDrafts" :key="a.id"><input v-model="s.areaCoversInput[a.id]" class="cell-input narrow" inputmode="numeric" /></td>
                <td class="derived">{{ fmtPct(monthDerived(s).fillPct) }}</td>
                <td class="derived">${{ fmtMoney2(monthDerived(s).avgCheck) }}</td>
                <td><input v-model="s.holidayClosuresInput" class="cell-input" inputmode="numeric" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="save-bar">
        <button class="save-btn" :disabled="saveStatus === 'saving' || !hasUnsavedChanges" @click="save">
          {{ saveStatus === 'saving' ? 'Saving…' : 'Save changes' }}
        </button>
        <span v-if="saveStatus === 'saved'" class="chip good">Saved</span>
        <span v-if="saveStatus === 'error'" class="chip critical">{{ saveMessage }}</span>
        <span v-if="hasUnsavedChanges && saveStatus !== 'saving'" class="quiet-note">Unsaved changes</span>
      </div>

      <footer>
        <span>Buyout revenue (a private event trading one service night for a guaranteed minimum) is budgeted for but not yet modeled here — see CLAUDE.md's Capacity tab section.</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }
.page-head { margin-bottom: 1.25rem; }
.page-head h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
.page-head .sub { font-size: 13px; color: var(--ink-3); max-width: 720px; line-height: 1.5; }

.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
  margin-bottom: 14px;
}
table.pl-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
.pl-table caption { display: none; }
.pl-table th, .pl-table td { padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-table th:first-child, .pl-table td:first-child { text-align: left; white-space: normal; }
.pl-table thead th { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); border-bottom: 1px solid var(--hair); }
.pl-table tbody th { text-align: left; font-weight: 600; font-size: 13px; color: var(--ink); }
.pl-table tbody tr { border-bottom: 1px solid var(--hair); }
.pl-table tbody tr:last-child { border-bottom: none; }

.cell-input {
  width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  padding: 5px 7px;
  border: 1px solid var(--hair);
  border-radius: 6px;
  background: var(--surface-alt);
  color: var(--ink);
}
.cell-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
/* Integer-only inputs (everything except Max Turns/Night and Per-Cover
   Revenue, per the user's 2026-08-07 request) can run narrower — most
   values here are 1-3 digits. */
.cell-input.narrow { width: 40px; }
.cell-input.decimal { width: 72px; }
.money-cell { display: flex; align-items: center; justify-content: flex-end; gap: 3px; }
.derived { font-weight: 600; color: var(--ink-2); font-variant-numeric: tabular-nums; }

.save-bar { display: flex; align-items: center; gap: 12px; margin: 8px 0 20px; }
.save-btn {
  font-size: 13px;
  font-weight: 700;
  padding: 8px 18px;
  border-radius: 10px;
  border: none;
  background: var(--accent);
  color: white;
  cursor: pointer;
}
.save-btn:disabled { opacity: 0.5; cursor: default; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.drill-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
