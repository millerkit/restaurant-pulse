<script setup lang="ts">
// Settings › Restaurant setup (moved from Planning › Capacity, 2026-11-08):
// the room's physical setup — seats and turns per area (nightly capacity is
// derived), weekly area closures, and holiday closures per month. The
// forecast (expected covers, spend per guest) stays on Planning › Capacity,
// which reads these. Saves only these fields (see capacity/settings.post.ts).
import { MONTH_NAMES } from '~/composables/useBudgetData'

type AreaRow = {
  id: number, name: string, seats: number, max_turns_per_night: number,
  capacity_nov_apr: number | null, capacity_may_oct: number,
  closed_dows: string | null, closed_from: string | null, closure_recapture_pct: number,
  closure_recapture_weights: string | null
}
type SeasonalityRow = { month: number, holiday_closures: number }
const { data, pending, error, refresh } = await useFetch<{ areas: AreaRow[], seasonality: SeasonalityRow[] }>('/api/capacity/settings')

type AreaDraft = {
  id: number, name: string, seats: string, turns: string,
  closedDows: number[], closedFrom: string, recapturePct: string, recaptureWeights: Record<number, string>
}
const areas = ref<AreaDraft[]>([])
const holidays = ref<{ month: number, closures: string }[]>([])

function draftsFrom(d: typeof data.value) {
  return {
    areas: (d?.areas ?? []).map(a => ({
      id: a.id,
      name: a.name,
      seats: String(Math.round(a.seats)),
      turns: String(a.max_turns_per_night),
      closedDows: parseClosedDows(a.closed_dows),
      closedFrom: a.closed_from ?? '',
      recapturePct: String(a.closure_recapture_pct ?? 0),
      recaptureWeights: parseRecaptureWeights(a.closure_recapture_weights)
    })),
    holidays: (d?.seasonality ?? []).map(s => ({ month: s.month, closures: String(s.holiday_closures) }))
  }
}
function load() {
  const d = draftsFrom(data.value)
  areas.value = d.areas
  holidays.value = d.holidays
}
watch(data, load, { immediate: true })

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
const capacity = (a: AreaDraft, season: 'novApr' | 'mayOct') => seasonalCapacity(a.name, num(a.seats), num(a.turns), season)
const fmtCap = (n: number | null) => (n == null ? 'closed' : Number.isFinite(n) ? String(n) : '—')

// Stored capacity that no longer matches seats × turns counts as a change, so
// saving corrects it (same rule the Capacity page used to apply).
const capacityMismatch = computed(() => areas.value.some((a) => {
  const row = data.value?.areas.find(r => r.id === a.id)
  return !!row && (capacity(a, 'novApr') !== row.capacity_nov_apr || capacity(a, 'mayOct') !== row.capacity_may_oct)
}))
const dirty = computed(() => JSON.stringify({ areas: areas.value, holidays: holidays.value }) !== JSON.stringify(draftsFrom(data.value)) || capacityMismatch.value)

function toggleDow(a: AreaDraft, dow: number) {
  a.closedDows = a.closedDows.includes(dow) ? a.closedDows.filter(d => d !== dow) : [...a.closedDows, dow].sort((x, y) => x - y)
}
const openDows = (a: AreaDraft) => CLOSABLE_DOWS.filter(d => !a.closedDows.includes(d.dow))
function fillDefaultWeights(a: AreaDraft) {
  a.recaptureWeights = Object.fromEntries(openDows(a).map(d => [d.dow, String(RECAPTURE_DEFAULTS[d.dow] ?? 0)]))
}
function summary(a: AreaDraft) {
  if (a.closedDows.length === 0) return 'Open every service night'
  const u = closureUpliftFor(a.closedDows.length, Number(a.recapturePct) || 0)
  return `Open ${SERVICE_NIGHTS_PER_WEEK - a.closedDows.length} nights a week; covers on open nights × ${u.toFixed(2)}`
}
function weightsPayload(a: AreaDraft): Record<string, number> | null {
  const entries = openDows(a).map(d => [String(d.dow), Number(a.recaptureWeights[d.dow]) || 0] as const)
  return entries.some(([, v]) => v > 0) ? Object.fromEntries(entries) : null
}

const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const message = ref('')
async function save() {
  status.value = 'saving'
  message.value = ''
  try {
    const areaPayload = areas.value.map((a) => {
      const seats = Math.round(num(a.seats)), turns = num(a.turns)
      if (!Number.isFinite(seats) || seats < 0 || !Number.isFinite(turns) || turns < 0) throw new Error(`Check seats and turns for ${a.name}`)
      const closed = a.closedDows.length > 0
      const recapture = num(a.recapturePct)
      if (closed && !/^\d{4}-\d{2}-\d{2}$/.test(a.closedFrom)) throw new Error(`Pick a start date for ${a.name}'s closure`)
      if (closed && (!Number.isFinite(recapture) || recapture < 0 || recapture > 100)) throw new Error(`Recapture for ${a.name} must be 0–100%`)
      return {
        id: a.id,
        seats,
        maxTurnsPerNight: turns,
        capacityNovApr: seasonalCapacity(a.name, seats, turns, 'novApr'),
        capacityMayOct: seasonalCapacity(a.name, seats, turns, 'mayOct')!,
        closedDows: a.closedDows,
        closedFrom: closed ? a.closedFrom : null,
        closureRecapturePct: closed ? recapture : 0,
        closureRecaptureWeights: closed ? weightsPayload(a) : null
      }
    })
    const seasonality = holidays.value.map((h) => {
      const n = Math.round(num(h.closures))
      if (!Number.isFinite(n) || n < 0) throw new Error(`Check holiday closures for ${MONTH_NAMES[h.month - 1]}`)
      return { month: h.month, holidayClosures: n }
    })
    await $fetch('/api/capacity/settings', { method: 'POST', body: { areas: areaPayload, seasonality } })
    await refresh()
    load()
    status.value = 'saved'
  } catch (err: any) {
    status.value = 'error'
    message.value = err?.data?.statusMessage || err?.message || 'Save failed'
  }
}
</script>

<template>
  <div>
    <div v-if="pending" class="rs-note">Loading…</div>
    <div v-else-if="error" class="rs-note"><span class="chip critical">Couldn't load the room setup</span> {{ error.message }}</div>
    <template v-else>
      <div class="rs-block">
        <h3 class="rs-h">Dining areas</h3>
        <p class="rs-note">Nightly capacity is seats × turns per night. Outdoor is closed November–April.</p>
        <div class="rs-table-wrap">
          <table class="rs-table">
            <thead>
              <tr><th scope="col">Area</th><th scope="col">Seats</th><th scope="col">Turns per night</th><th scope="col">Capacity Nov–Apr</th><th scope="col">Capacity May–Oct</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in areas" :key="a.id">
                <th scope="row">{{ a.name }}</th>
                <td><input v-model="a.seats" class="rs-input" inputmode="numeric" :aria-label="`${a.name} seats`" /></td>
                <td><input v-model="a.turns" class="rs-input" inputmode="decimal" :aria-label="`${a.name} turns per night`" /></td>
                <td class="rs-derived">{{ fmtCap(capacity(a, 'novApr')) }}</td>
                <td class="rs-derived">{{ fmtCap(capacity(a, 'mayOct')) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="rs-block">
        <h3 class="rs-h">Weekly area closures</h3>
        <p class="rs-note">
          Close an area on fixed weekdays from a start date (Monday is already closed for the whole restaurant).
          Recapture is the share of those nights' guests expected to come on the area's other nights instead;
          the weights say which nights they land on.
        </p>
        <div class="rs-table-wrap">
          <table class="rs-table">
            <thead>
              <tr><th scope="col">Area</th><th scope="col">Closed on</th><th scope="col">Starting</th><th scope="col">Recapture</th><th scope="col">Result</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in areas" :key="a.id">
                <th scope="row">{{ a.name }}</th>
                <td>
                  <span class="rs-dows">
                    <label v-for="d in CLOSABLE_DOWS" :key="d.dow" :class="['rs-dow', { on: a.closedDows.includes(d.dow) }]">
                      <input type="checkbox" :checked="a.closedDows.includes(d.dow)" @change="toggleDow(a, d.dow)" />{{ d.short }}
                    </label>
                  </span>
                </td>
                <td><input v-model="a.closedFrom" type="date" class="rs-input date" :disabled="a.closedDows.length === 0" :aria-label="`${a.name} closure start date`" /></td>
                <td><span class="rs-pct"><input v-model="a.recapturePct" class="rs-input" inputmode="numeric" :disabled="a.closedDows.length === 0" :aria-label="`${a.name} recapture percent`" />%</span></td>
                <td class="rs-derived left">
                  {{ summary(a) }}
                  <div v-if="a.closedDows.length > 0" class="rs-weights">
                    <span>Recaptured guests land on:</span>
                    <label v-for="d in openDows(a)" :key="d.dow">
                      {{ d.short }} <input v-model="a.recaptureWeights[d.dow]" class="rs-input narrow" inputmode="numeric" placeholder="0" :aria-label="`${a.name} weight ${d.short}`" />
                    </label>
                    <button type="button" class="rs-mini" @click="fillDefaultWeights(a)">Wed/Thu heavy</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="rs-block">
        <h3 class="rs-h">Holiday closures</h3>
        <p class="rs-note">Nights the whole restaurant is closed each month, beyond the regular Monday closure.</p>
        <div class="rs-months">
          <label v-for="h in holidays" :key="h.month" class="rs-month">
            <span>{{ MONTH_NAMES[h.month - 1] }}</span>
            <input v-model="h.closures" class="rs-input" inputmode="numeric" :aria-label="`${MONTH_NAMES[h.month - 1]} holiday closures`" />
          </label>
        </div>
      </div>

      <div class="rs-actions">
        <button class="rs-save" :disabled="status === 'saving' || !dirty" @click="save">{{ status === 'saving' ? 'Saving…' : 'Save room setup' }}</button>
        <span v-if="status === 'saved' && !dirty" class="chip good">✓ Saved</span>
        <span v-else-if="status === 'error'" class="chip critical">{{ message }}</span>
        <span v-else-if="dirty" class="rs-note inline">Unsaved changes<template v-if="capacityMismatch"> (stored capacity is out of date)</template></span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rs-block { margin-bottom: 18px; }
.rs-h { font-size: 15px; font-weight: 800; color: var(--ink); margin: 0 0 4px; }
.rs-note { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; margin: 0 0 8px; max-width: 760px; }
.rs-note.inline { margin: 0; }
.rs-table-wrap { background: var(--surface); border: 1px solid var(--hair); border-radius: 12px; overflow-x: auto; }
.rs-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 520px; }
.rs-table th, .rs-table td { padding: 9px 12px; text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rs-table thead th { font-size: 11.5px; font-weight: 700; color: var(--ink-3); background: var(--surface-alt); border-bottom: 1px solid var(--hair); white-space: normal; }
.rs-table tbody th { text-align: left; font-weight: 700; color: var(--ink); text-transform: capitalize; }
.rs-table tbody tr + tr { border-top: 1px solid var(--hair); }
.rs-derived { color: var(--ink-2); font-weight: 600; }
.rs-derived.left { text-align: left; white-space: normal; font-weight: 500; }
.rs-input {
  width: 60px; text-align: right; font-size: 13px; padding: 5px 7px; font-variant-numeric: tabular-nums;
  border: 1px solid var(--hair); border-radius: 6px; background: var(--surface-alt); color: var(--ink);
}
.rs-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.rs-input:disabled { opacity: 0.45; }
.rs-input.narrow { width: 40px; }
.rs-input.date { width: 140px; text-align: left; }
.rs-pct { display: inline-flex; align-items: center; gap: 3px; }
.rs-dows { display: inline-flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.rs-dow { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; padding: 3px 8px; border: 1px solid var(--hair); border-radius: 999px; color: var(--ink-3); cursor: pointer; }
.rs-dow input { accent-color: var(--accent); margin: 0; }
.rs-dow.on { color: var(--ink); background: var(--surface-alt); border-color: var(--ink-3); }
.rs-weights { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--ink-3); }
.rs-weights label { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; color: var(--ink-2); }
.rs-mini { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--hair); background: var(--surface); color: var(--accent-text); cursor: pointer; }
.rs-months { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; max-width: 760px; }
.rs-month { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
.rs-month .rs-input { width: 44px; }
.rs-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.rs-actions .chip { margin: 0; }
.rs-save { font-size: 13px; font-weight: 700; padding: 8px 18px; border-radius: 10px; border: none; background: var(--accent); color: white; cursor: pointer; }
.rs-save:disabled { opacity: 0.5; cursor: default; }
</style>
