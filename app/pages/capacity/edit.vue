<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Edit Capacity` })

type AreaRow = {
  id: number, name: string, seats: number, max_turns_per_night: number,
  capacity_nov_apr: number | null, capacity_may_oct: number,
  per_cover_revenue_food: number, per_cover_revenue_beverage: number, notes: string | null
}
type SeasonalityRow = { month: number, holiday_closures: number }
type AreaSeasonalityRow = { area_id: number, month: number, expected_covers: number }

const { data, pending, error, refresh } = await useFetch<{ areas: AreaRow[], seasonality: SeasonalityRow[], areaSeasonality: AreaSeasonalityRow[] }>('/api/capacity/settings')

type MonthlyIndexRow = { month: number, indexPct: number | null, years: number[] }
const { data: historyData } = await useFetch<{ monthlyIndex: MonthlyIndexRow[], historicalYears: number[] }>('/api/capacity/history')
// Built from the API's own historicalYears rather than hardcoded, so this
// label can't go stale as years roll forward — e.g. reads "2025" today,
// "2026" once 2027 rolls around. See history.get.ts: normally just one
// year (simplified 2026-08-10, at the user's request, from an earlier
// multi-year average) but this stays correct if that ever changes.
const historyYearsLabel = computed(() => (historyData.value?.historicalYears ?? []).join('/') || 'prior years')

function isMayThroughOct(month: number): boolean {
  return month >= 5 && month <= 10
}
function isOutdoor(name: string): boolean {
  return name.trim().toLowerCase() === 'outdoor'
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
// already uses between loaded data and in-progress edits. Capacity
// Nov-Apr/May-Oct are no longer directly editable (2026-08-08) — they're
// calculated from Seats × Max Turns/Night, so they aren't part of the
// draft shape at all; see computedCapacity() below.
type AreaDraft = {
  id: number, name: string, seats: string, maxTurnsPerNight: string,
  perCoverRevenueFood: string, perCoverRevenueBeverage: string
}
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
    perCoverRevenueFood: String(a.per_cover_revenue_food),
    perCoverRevenueBeverage: String(a.per_cover_revenue_beverage)
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
    perCoverRevenueFood: String(a.per_cover_revenue_food), perCoverRevenueBeverage: String(a.per_cover_revenue_beverage)
  }))
  const areaMonthMap = new Map((data.value?.areaSeasonality ?? []).map(r => [`${r.area_id}:${r.month}`, r.expected_covers]))
  const monthly = (data.value?.seasonality ?? []).map(s => ({
    month: s.month,
    holidayClosuresInput: String(s.holiday_closures),
    areaCoversInput: Object.fromEntries(areas.map(a => [a.id, String(roundCovers(areaMonthMap.get(`${a.id}:${s.month}`) ?? 0))]))
  }))
  return JSON.stringify({ areaDrafts: areas, monthlyDrafts: monthly })
})
// Capacity Nov-Apr/May-Oct are calculated, not edited — but they're still
// stored columns other pages/scripts read directly, so a mismatch between
// what's currently in the DB and what Seats × Max Turns/Night computes
// right now (e.g. a row whose capacity was hand-edited before this change,
// or last saved before an intervening Seats/Turns edit was applied
// elsewhere) needs to count as an unsaved change too — otherwise the Save
// button stays disabled and the stale stored value never gets corrected
// until the user happens to also touch Seats or Max Turns/Night.
const capacityMismatch = computed(() => {
  return areaDrafts.value.some(a => {
    const row = data.value?.areas.find(r => r.id === a.id)
    if (!row) return false
    return computedCapacity(a, 'novApr') !== row.capacity_nov_apr || computedCapacity(a, 'mayOct') !== row.capacity_may_oct
  })
})
const hasUnsavedChanges = computed(() => draftSnapshot.value !== cleanDraftSnapshot.value || capacityMismatch.value)

// Capacity Nov-Apr/May-Oct is calculated from Seats × Max Turns/Night
// (added 2026-08-08, at the user's request, replacing free-typed capacity
// figures that could silently drift from those two inputs). Outdoor has no
// Nov-Apr season at all — it stays closed through winter, same as the old
// "leave it blank" convention — every other area gets both seasons.
// Returns null for "closed this season," never for invalid input (an
// unparseable Seats/Turns draft surfaces as NaN instead, same as any other
// numeric field on this page, so save-time validation still catches it).
function computedCapacity(a: AreaDraft, season: 'novApr' | 'mayOct'): number | null {
  if (season === 'novApr' && isOutdoor(a.name)) return null
  return Math.round(num(a.seats) * num(a.maxTurnsPerNight))
}
function fmtCapacity(n: number | null): string {
  return n == null ? 'closed' : (Number.isFinite(n) ? String(n) : '—')
}

// Live-derived Fill %/Per-Cover $ for a month, recomputed from the
// in-progress drafts (not the loaded data) so an edit shows its effect
// immediately, before saving — same per-area capacity/per-cover-revenue
// math as server/api/capacity.get.ts's nightlyExpectedForMonth.
function areaCapacityForMonth(a: AreaDraft, month: number): number {
  const cap = isMayThroughOct(month) ? computedCapacity(a, 'mayOct') : computedCapacity(a, 'novApr')
  if (cap == null || !Number.isFinite(cap)) return 0
  return cap
}
function monthDerived(s: MonthlyDraft) {
  let covers = 0, revenue = 0, maxCovers = 0
  for (const a of areaDrafts.value) {
    const c = Number(s.areaCoversInput[a.id])
    const coversNum = Number.isFinite(c) ? c : 0
    covers += coversNum
    revenue += coversNum * ((Number(a.perCoverRevenueFood) || 0) + (Number(a.perCoverRevenueBeverage) || 0))
    maxCovers += areaCapacityForMonth(a, s.month)
  }
  return {
    totalCovers: covers,
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

// The current blended fill % implied by whatever's already typed into the
// covers grid, across every area and month — the "overall ambition level"
// that "Set by History" reshapes around, rather than a separately-entered
// target. Live/reactive off the in-progress drafts, same as monthDerived.
const currentAnnualFillPct = computed(() => {
  let covers = 0, capacity = 0
  for (const s of monthlyDrafts.value) {
    for (const a of areaDrafts.value) {
      const c = Number(s.areaCoversInput[a.id])
      if (Number.isFinite(c)) covers += c
      capacity += areaCapacityForMonth(a, s.month)
    }
  }
  return capacity > 0 ? covers / capacity : null
})
function historyIndexFor(month: number): number | null {
  return historyData.value?.monthlyIndex?.find(m => m.month === month)?.indexPct ?? null
}
// The fraction "Set by History" would apply to a given month: this month's
// historical index (its per-open-day core dine-in revenue as a % of that
// year's own average, from the most recent prior year's QBO history — see
// server/api/capacity/history.get.ts) scaled against the current overall
// annual average above, so history determines the *shape* across months
// while the total-year level stays anchored to what's already entered. Null
// (and the button disabled) when either input is missing — no historical
// reading for that month, or nothing entered anywhere yet to anchor to.
function historyTargetFraction(s: MonthlyDraft): number | null {
  const indexPct = historyIndexFor(s.month)
  const baseline = currentAnnualFillPct.value
  if (indexPct == null || baseline == null) return null
  return baseline * (indexPct / 100)
}
function historyTooltip(s: MonthlyDraft): string {
  const indexPct = historyIndexFor(s.month)
  if (indexPct == null) return 'No historical QuickBooks data available for this month yet.'
  if (currentAnnualFillPct.value == null) return 'Enter at least some covers below first — Set by History scales its own average against whatever is already on this page.'
  return `${MONTH_NAMES[s.month - 1]} historically runs ${indexPct.toFixed(0)}% of the year's average dine-in revenue (${historyYearsLabel.value} QuickBooks, food & beverage only) — applied to this page's current ${fmtPct(currentAnnualFillPct.value)} year-round average.`
}
// "Set by History" (replaced the manually-typed "Set %" 2026-08-10) applies
// one blended fill % — derived from real historical seasonality rather than
// typed in by hand — equally across every area's own capacity for that
// month, overwriting whatever per-area covers were there before. Still a
// one-shot action (a button), not a live two-way-bound field, for the same
// reason the old Set % was: continuous syncing would fight direct per-area
// edits. A closed-season area (areaCapacityForMonth already returns 0 for
// that case, e.g. Outdoor Nov-Apr) naturally stays at 0 covers.
//
// Uses largest-remainder rounding rather than rounding each area
// independently — unchanged from the old Set %'s own fix for the same
// issue (see git history): computes the exact (unrounded) share per area,
// floors every one, then hands out the leftover whole covers (the total's
// own rounding, computed once) to the areas with the largest fractional
// remainder, so the summed result matches round(fraction × total capacity)
// exactly instead of drifting from n independently-rounded areas.
function applySetByHistory(s: MonthlyDraft) {
  const fraction = historyTargetFraction(s)
  if (fraction == null) return
  const areas = areaDrafts.value
  const exact = areas.map(a => fraction * areaCapacityForMonth(a, s.month))
  const totalCapacity = areas.reduce((sum, a) => sum + areaCapacityForMonth(a, s.month), 0)
  const totalTarget = Math.round(fraction * totalCapacity)
  const floors = exact.map(Math.floor)
  const floorSum = floors.reduce((sum, v) => sum + v, 0)
  const order = floors
    .map((_, i) => i)
    .sort((x, y) => (exact[y] - floors[y]) - (exact[x] - floors[x]))
  const result = [...floors]
  let leftover = Math.max(0, totalTarget - floorSum)
  for (let k = 0; k < order.length && leftover > 0; k++, leftover--) {
    result[order[k]] += 1
  }
  areas.forEach((a, i) => { s.areaCoversInput[a.id] = String(result[i]) })
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
      capacityNovApr: computedCapacity(a, 'novApr'),
      capacityMayOct: computedCapacity(a, 'mayOct') ?? NaN,
      perCoverRevenueFood: num(a.perCoverRevenueFood),
      perCoverRevenueBeverage: num(a.perCoverRevenueBeverage)
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
      if ([a.seats, a.maxTurnsPerNight, a.capacityMayOct, a.perCoverRevenueFood, a.perCoverRevenueBeverage].some(Number.isNaN) || (a.capacityNovApr !== null && Number.isNaN(a.capacityNovApr))) {
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
          <div class="section-note">Capacity Nov–Apr and May–Oct are calculated as Seats × Max Turns/Night, not entered directly. Outdoor has no Nov–Apr season — it stays closed through winter.</div>
        </div>
        <div class="pl-table-card">
          <table class="pl-table edit-table">
            <caption>Editable per-area seats, turns/night, and revenue assumptions, with calculated seasonal capacity</caption>
            <thead>
              <tr>
                <th scope="col">Area</th>
                <th scope="col">Seats</th>
                <th scope="col">Max Turns/Night</th>
                <th scope="col">Capacity Nov–Apr</th>
                <th scope="col">Capacity May–Oct</th>
                <th scope="col">Per-Cover Revenue (Food)</th>
                <th scope="col">Per-Cover Revenue (Beverage)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in areaDrafts" :key="a.id">
                <th scope="row" style="text-transform: capitalize;">{{ a.name }}</th>
                <td><input v-model="a.seats" class="cell-input" inputmode="numeric" /></td>
                <td><input v-model="a.maxTurnsPerNight" class="cell-input decimal" inputmode="decimal" /></td>
                <td class="derived">{{ fmtCapacity(computedCapacity(a, 'novApr')) }}</td>
                <td class="derived">{{ fmtCapacity(computedCapacity(a, 'mayOct')) }}</td>
                <td><span class="money-cell">$<input v-model="a.perCoverRevenueFood" class="cell-input decimal" inputmode="decimal" /></span></td>
                <td><span class="money-cell">$<input v-model="a.perCoverRevenueBeverage" class="cell-input decimal" inputmode="decimal" /></span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div class="section-head">
          <div class="section-label">Expected Nightly Covers by Area &amp; Holiday Closures</div>
          <div class="section-note">Average nightly covers per area, by month — edit these directly, or use "Set by History" to apply that month's real historical seasonality ({{ historyYearsLabel }} QuickBooks dine-in revenue, scaled to this page's current year-round average) equally across every area's own capacity for that month (overwrites that row's per-area covers to the right). Total, Fill %, and Per-Cover $ are derived. Holiday closures are additional nights closed beyond the standing Monday closure.</div>
        </div>
        <div class="pl-table-card">
          <table class="pl-table edit-table">
            <caption>Editable monthly expected covers per area, a history-derived quick-set blended fill percentage, a total covers figure, derived fill percentage and per-cover revenue, and holiday closure counts</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Set by History</th>
                <th v-for="a in areaDrafts" :key="a.id" scope="col" style="text-transform: capitalize;">{{ a.name }}</th>
                <th scope="col">Total</th>
                <th scope="col">Fill %</th>
                <th scope="col">Per-Cover $</th>
                <th scope="col">Holiday Closures</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in monthlyDrafts" :key="s.month">
                <th scope="row">{{ MONTH_NAMES[s.month - 1] }}</th>
                <td class="setpct-cell">
                  <div class="setpct-row">
                    <button
                      type="button"
                      class="apply-pct-btn"
                      :disabled="historyTargetFraction(s) == null"
                      :title="historyTooltip(s)"
                      @click="applySetByHistory(s)"
                    >Set by History</button>
                    <span class="setpct-arrow" aria-hidden="true">→</span>
                  </div>
                  <span v-if="historyTargetFraction(s) != null" class="setpct-result">≈{{ fmtPct(historyTargetFraction(s)) }}</span>
                </td>
                <td v-for="a in areaDrafts" :key="a.id"><input v-model="s.areaCoversInput[a.id]" class="cell-input narrow" inputmode="numeric" /></td>
                <td class="derived">{{ monthDerived(s).totalCovers }}</td>
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
.pl-table th, .pl-table td { padding: 10px 12px; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-table th:first-child, .pl-table td:first-child { text-align: left; white-space: normal; }
/* Header labels wrap instead of forcing their column wide (added
   2026-08-09, at the user's request) — "Chefs Counter"/"Holiday Closures"/
   "Per-Cover Revenue" no longer set the column width on their own; the
   narrow input boxes now do, and center comfortably under a 2-line
   header. */
.pl-table thead th { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); border-bottom: 1px solid var(--hair); white-space: normal; }
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
/* inline-flex on a <span> nested inside the <td>, not on the <td> itself —
   display:flex directly on a <td> changes its outer display away from
   table-cell, and two such <td>s adjacent in the same row (Food/Beverage
   per-cover revenue, added 2026-08-10) get fixed up by the browser into a
   single anonymous table cell and stack vertically instead of sitting in
   their own columns. Wrapping the flex layout in an inline child keeps each
   <td> a normal table cell. */
.money-cell { display: inline-flex; align-items: center; gap: 3px; }
.derived { font-weight: 600; color: var(--ink-2); font-variant-numeric: tabular-nums; }

.setpct-cell { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
.setpct-row { display: flex; align-items: center; justify-content: center; gap: 5px; }
.setpct-arrow { color: var(--ink-3); font-size: 14px; }
.setpct-result { font-size: 10.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.apply-pct-btn {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 9px;
  border-radius: 6px;
  border: 1px solid var(--hair);
  background: var(--surface-alt);
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
}
.apply-pct-btn:disabled { opacity: 0.4; cursor: default; }
.apply-pct-btn:not(:disabled):hover { background: var(--accent); color: white; border-color: var(--accent); }

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
