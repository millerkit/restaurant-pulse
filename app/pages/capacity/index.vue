<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES, YEAR, paceStatus } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Capacity` })

// Combines the old separate Capacity Pace (app/pages/capacity/index.vue)
// and Edit Capacity (app/pages/capacity/edit.vue) pages into one page with
// two tabs, at the user's request (2026-09-18) — both are always fetched
// and both trees stay mounted underneath a v-show (not v-if), so switching
// tabs never loses in-progress Edit drafts and never re-fetches. The old
// two nav links collapse into one "Capacity" link; the sub-tab pair below
// the page header mirrors the existing month-tab visual pattern
// (budget/edit.vue, and this page's own By-Month tabs below).
type Tab = 'pace' | 'edit'
const route = useRoute()
const router = useRouter()
const tab = ref<Tab>(route.query.tab === 'edit' ? 'edit' : 'pace')
function setTab(t: Tab) {
  tab.value = t
  router.replace({ query: { ...route.query, tab: t === 'edit' ? 'edit' : undefined } })
}

// ---------------------------------------------------------------------
// Capacity Pace tab — data + helpers (formerly app/pages/capacity/index.vue)
// ---------------------------------------------------------------------
type Assumed = { operatingDays: number, expectedCovers: number, expectedRevenue: number, maxCapacityCovers: number, assumedFillPct: number | null, assumedAvgCheck: number | null }
type Actual = { throughDate: string, covers: number | null, revenue: number | null, toastDaysSynced: number, operatingDays: number, maxCapacityCovers: number, actualFillPct: number | null, actualAvgCheck: number | null } | null
type Period = { start: string, end: string, isFuture: boolean, isCurrent: boolean, assumed: Assumed, actual: Actual }
type AreaBreakdownRow = { areaId: number, areaName: string, assumedCoversPerNight: number, assumedPerCover: number, actualCoversPerNight: number | null, actualPerCover: number | null }

const { data: paceData, pending: pacePending, error: paceError, refresh: paceRefresh } = await useFetch('/api/capacity')

function fmtMoney(n: number | null | undefined): string {
  return n == null ? '—' : `$${n.toFixed(2)}`
}
function fmtMoneyRound(n: number | null | undefined): string {
  return n == null ? '—' : `$${Math.round(n).toLocaleString()}`
}
function fmtCovers(n: number | null | undefined): string {
  return n == null ? '—' : Math.round(n).toLocaleString()
}
// Average nightly covers over a range — covers ÷ the same operating-day
// count already used to build the assumed/actual rate figures, so it's
// consistent with everything else on this page (Mondays and holiday
// closures already excluded upstream, not re-derived here).
function fmtAvgCovers(covers: number | null | undefined, operatingDays: number | null | undefined): string {
  if (covers == null || !operatingDays) return '—'
  return Math.round(covers / operatingDays).toLocaleString()
}
function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}
function parseIso(s: string) {
  return new Date(`${s}T00:00:00Z`)
}
function fmtDate(s: string) {
  return parseIso(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function rangeLabel(p: Period) {
  return `${fmtDate(p.start)}–${fmtDate(p.end)}`
}

// Both fill % and per-cover $ are already rate metrics, so "actual vs
// assumed" is judged as a ratio (actual as a % of assumed), same
// good/warning/serious/critical scale every other pace card in the app
// uses — 100% of assumed = good, each 10pts short bumps a level.
function ratioStatus(actual: number | null | undefined, assumed: number | null | undefined) {
  if (actual == null || assumed == null || assumed === 0) return null
  return paceStatus((actual / assumed) * 100, 100, 'higher-is-better')
}
function fillDeltaLabel(p: Period): string {
  const actual = p.actual?.actualFillPct
  const assumed = p.assumed.assumedFillPct
  if (actual == null || assumed == null) return ''
  const pts = (actual - assumed) * 100
  return pts >= 0 ? `+${pts.toFixed(1)}pts` : `${pts.toFixed(1)}pts`
}
function checkDeltaLabel(p: Period): string {
  const actual = p.actual?.actualAvgCheck
  const assumed = p.assumed.assumedAvgCheck
  if (actual == null || assumed == null) return ''
  const delta = actual - assumed
  return delta >= 0 ? `+$${delta.toFixed(2)}` : `−$${Math.abs(delta).toFixed(2)}`
}
function fmtCoversPerNight(n: number | null | undefined): string {
  return n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString()
}
function deltaMoneyLabel(actual: number | null | undefined, assumed: number | null | undefined): string {
  if (actual == null || assumed == null) return ''
  const delta = actual - assumed
  return delta >= 0 ? `+$${delta.toFixed(2)}` : `−$${Math.abs(delta).toFixed(2)}`
}
function deltaCoversLabel(actual: number | null | undefined, assumed: number | null | undefined): string {
  if (actual == null || assumed == null) return ''
  const delta = Math.round((actual - assumed) * 10) / 10
  return delta >= 0 ? `+${delta}` : `${delta}`
}

const periods = computed(() => paceData.value?.periods ?? null)

// ---- Month tabs (Capacity Pace's own "By Month" section) --------------
const months = computed(() => paceData.value?.months ?? [])
const selectedMonth = ref<number | null>(null)
watch(() => paceData.value?.asOfMonth, (m) => { if (m != null && selectedMonth.value === null) selectedMonth.value = m }, { immediate: true })
const selectedMonthData = computed(() => months.value.find(m => m.month === selectedMonth.value) ?? null)

// ---------------------------------------------------------------------
// Edit Capacity tab — data + helpers (formerly app/pages/capacity/edit.vue)
// ---------------------------------------------------------------------
type AreaRow = {
  id: number, name: string, seats: number, max_turns_per_night: number,
  capacity_nov_apr: number | null, capacity_may_oct: number,
  per_cover_revenue_food: number, per_cover_revenue_beverage: number, notes: string | null
}
type SeasonalityRow = { month: number, holiday_closures: number }
type AreaSeasonalityRow = { area_id: number, month: number, expected_covers: number }

const { data: editData, pending: editPending, error: editError, refresh: editRefresh } = await useFetch<{ areas: AreaRow[], seasonality: SeasonalityRow[], areaSeasonality: AreaSeasonalityRow[] }>('/api/capacity/settings')

type MonthlyIndexRow = { month: number, indexPct: number | null, years: number[] }
type AreaFillIndexRow = { areaId: number, indexValue: number | null }
const { data: historyData } = await useFetch<{ monthlyIndex: MonthlyIndexRow[], historicalYears: number[], areaFillIndex: AreaFillIndexRow[] | null, areaFillIndexSince: string | null, dataAnnualFillPct: number | null }>('/api/capacity/history')
// Real per-area fill-rate index, since the Cambridge St move — see
// areaFillIndex's own comment in server/api/capacity/history.get.ts for
// why this is a flat (non-seasonal) index rather than a month-by-month
// one (the user's own explicit call, 2026-08-13: ~8 weeks of real
// per-area data isn't enough to trust a seasonal shape, and Bar/Salon have
// no prior-location history at all). Falls back to 1 (equal weighting,
// today's pre-existing behavior) for any area with no real index value
// yet, rather than leaving that area at 0.
function areaFillIndexFor(areaId: number): number {
  return historyData.value?.areaFillIndex?.find(r => r.areaId === areaId)?.indexValue ?? 1
}
// Built from the API's own historicalYears rather than hardcoded, so this
// label can't go stale as years roll forward — e.g. reads "2025" today,
// "2026" once 2027 rolls around. See history.get.ts: normally just one
// year (simplified 2026-08-10, at the user's request, from an earlier
// multi-year average) but this stays correct if that ever changes.
const historyYearsLabel = computed(() => (historyData.value?.historicalYears ?? []).join('/') || 'prior years')

// Real per-area actuals (this month / last month), added 2026-08-13 once
// Toast Configuration API scope unblocked resolving table.guid to an area
// (see server/utils/toast-table-map.ts). Shown next to the aspirational
// Per-Cover Revenue (Total) column so it reads as "assumed vs. actually
// happening" rather than a separate table — display only by default
// (unlike Set by History's covers, a $/cover actual has no natural place
// in the covers-based draft shape) except via the explicit "Set from
// Actuals" button below, the same one-shot-action-not-ambient-binding
// posture Set by History itself uses for the same reason.
type AreaActualsRow = { areaId: number, covers: number, revenue: number, foodRevenue: number | null, beverageRevenue: number | null, perCover: number | null }
type AreaActualsPeriod = { start: string, end: string, cappedAt: string, perArea: AreaActualsRow[] }
type TrailingTwoMonthRow = { areaId: number, covers: number, revenue: number, perCover: number | null, perCoverFood: number | null, perCoverBeverage: number | null }
type TrailingTwoMonth = { start: string, end: string, perArea: TrailingTwoMonthRow[], foodBeveragePct: { food: number, beverage: number } | null }
const { data: areaActualsData } = await useFetch<{ asOfDate: string | null, thisMonth: AreaActualsPeriod | null, lastMonth: AreaActualsPeriod | null, trailingTwoMonth: TrailingTwoMonth | null }>('/api/capacity/area-actuals')
function areaActualPerCover(areaId: number, period: 'thisMonth' | 'lastMonth'): number | null {
  const p = areaActualsData.value?.[period]
  return p?.perArea.find(r => r.areaId === areaId)?.perCover ?? null
}
// Rounded to the nearest dollar for quick readability (2026-08-17, at the
// user's request) — this is a display-only rounding of a derived/read-only
// figure, not the underlying stored precision; the editable Food/Beverage
// per-cover inputs above keep their exact decimal value on purpose (see
// their own comment).
function fmtMoneyOrDash(n: number | null): string {
  return n == null ? '—' : `$${Math.round(n)}`
}

// "Set from Actuals" — writes that area's real trailing two-month (this +
// last month combined) per-cover $ into the Food/Beverage draft inputs, an
// explicit button rather than a live binding for the same reason Set by
// History's covers aren't live-bound either (see its own comment above):
// overwriting a hand-tuned per-area assumption should be something the
// user chooses, not a side effect of a derived figure existing.
//
// Chef's Counter gets a real per-area Food/Beverage split
// (perCoverFood/perCoverBeverage, from daily_toast_area_metrics'
// food_revenue/beverage_revenue) instead of the restaurant-wide mix below
// — its real food revenue isn't reliably in Toast at all (prepaid tickets
// go through Stripe), so it's assumed flat at $190/cover and only the
// beverage side comes from real Toast data; see
// CHEFS_COUNTER_FOOD_PRICE_PER_COVER's comment in
// server/utils/toast-metrics-sync.ts. Every other area has no real
// per-area food/beverage signal (Toast's check totals aren't split that
// way), so it falls back to dividing the blended actual using this
// restaurant's real, whole-restaurant Food/Beverage revenue mix (see
// area-actuals.get.ts's own comment on that approximation).
function trailingTwoMonthRow(areaId: number): TrailingTwoMonthRow | null {
  return areaActualsData.value?.trailingTwoMonth?.perArea.find(r => r.areaId === areaId) ?? null
}
function trailingTwoMonthPerCover(areaId: number): number | null {
  return trailingTwoMonthRow(areaId)?.perCover ?? null
}
function canSetFromActuals(a: AreaDraft): boolean {
  const row = trailingTwoMonthRow(a.id)
  if (!row || row.perCover == null) return false
  return row.perCoverFood != null || areaActualsData.value?.trailingTwoMonth?.foodBeveragePct != null
}
function setFromActuals(a: AreaDraft) {
  const row = trailingTwoMonthRow(a.id)
  if (!row || row.perCover == null) return
  if (row.perCoverFood != null && row.perCoverBeverage != null) {
    a.perCoverRevenueFood = row.perCoverFood.toFixed(2)
    a.perCoverRevenueBeverage = row.perCoverBeverage.toFixed(2)
    return
  }
  const pct = areaActualsData.value?.trailingTwoMonth?.foodBeveragePct
  if (!pct) return
  a.perCoverRevenueFood = (row.perCover * pct.food).toFixed(2)
  a.perCoverRevenueBeverage = (row.perCover * pct.beverage).toFixed(2)
}

// Colors the two Actual columns against that area's own assumed Per-Cover
// Revenue (Total) draft — same ratio-based status/chip pattern the
// Capacity Pace tab already uses for its fill%/per-cover comparisons
// (ratioStatus above), and the same "icon must always pair with color,
// never stand alone" rule as the P&L/Edit Budget pages' ✓/▲/▼ treatment.
// Judged against the *live draft* assumption (perCoverTotal(a)), not the
// last-saved value, so an in-progress edit to Per-Cover Revenue
// immediately re-colors the actual next to it.
function areaActualVariance(a: AreaDraft, period: 'thisMonth' | 'lastMonth') {
  const actual = areaActualPerCover(a.id, period)
  const assumed = perCoverTotal(a)
  if (actual == null || !assumed) return null
  const status = paceStatus((actual / assumed) * 100, 100, 'higher-is-better')
  return { actual, delta: actual - assumed, status }
}
function varianceIcon(v: ReturnType<typeof areaActualVariance>): string {
  if (!v) return ''
  return v.status === 'good' ? '✓' : (v.delta >= 0 ? '▲' : '▼')
}
function varianceDeltaLabel(v: ReturnType<typeof areaActualVariance>): string {
  if (!v) return ''
  const sign = v.delta >= 0 ? '+' : '−'
  return `(${sign}$${Math.round(Math.abs(v.delta))})`
}
const thisMonthLabel = computed(() => {
  const d = areaActualsData.value?.thisMonth
  return d ? MONTH_NAMES[Number(d.start.slice(5, 7)) - 1] : 'This Month'
})
const lastMonthLabel = computed(() => {
  const d = areaActualsData.value?.lastMonth
  return d ? MONTH_NAMES[Number(d.start.slice(5, 7)) - 1] : 'Last Month'
})

function isMayThroughOct(month: number): boolean {
  return month >= 5 && month <= 10
}
function isOutdoor(name: string): boolean {
  return name.trim().toLowerCase() === 'outdoor'
}
// Every input on this tab is integer-only except Max Turns/Night and
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
// One row per month: closures (unchanged) plus each area's own
// expected nightly covers, keyed by area id — the real editable projection
// input as of 2026-08-07 (replacing a single blended Expected Fill %),
// per the user's own request after $86.12/cover looked low blended across
// very different areas.
type MonthlyDraft = { month: number, holidayClosuresInput: string, areaCoversInput: Record<number, string> }

const areaDrafts = ref<AreaDraft[]>([])
const monthlyDrafts = ref<MonthlyDraft[]>([])

function loadDrafts() {
  areaDrafts.value = (editData.value?.areas ?? []).map(a => ({
    id: a.id,
    name: a.name,
    seats: String(Math.round(a.seats)),
    maxTurnsPerNight: String(a.max_turns_per_night),
    perCoverRevenueFood: String(a.per_cover_revenue_food),
    perCoverRevenueBeverage: String(a.per_cover_revenue_beverage)
  }))
  const areaMonthMap = new Map((editData.value?.areaSeasonality ?? []).map(r => [`${r.area_id}:${r.month}`, r.expected_covers]))
  monthlyDrafts.value = (editData.value?.seasonality ?? []).map(s => ({
    month: s.month,
    holidayClosuresInput: String(s.holiday_closures),
    areaCoversInput: Object.fromEntries(areaDrafts.value.map(a => [a.id, String(roundCovers(areaMonthMap.get(`${a.id}:${s.month}`) ?? 0))]))
  }))
}
watch(editData, loadDrafts, { immediate: true })

const draftSnapshot = computed(() => JSON.stringify({ areaDrafts: areaDrafts.value, monthlyDrafts: monthlyDrafts.value }))
// Compares the draft against what loadDrafts() would produce from a clean
// reload of the current data, rather than against the raw loaded rows —
// avoids false positives just from string-vs-number formatting.
const cleanDraftSnapshot = computed(() => {
  const areas = (editData.value?.areas ?? []).map(a => ({
    id: a.id, name: a.name, seats: String(Math.round(a.seats)), maxTurnsPerNight: String(a.max_turns_per_night),
    perCoverRevenueFood: String(a.per_cover_revenue_food), perCoverRevenueBeverage: String(a.per_cover_revenue_beverage)
  }))
  const areaMonthMap = new Map((editData.value?.areaSeasonality ?? []).map(r => [`${r.area_id}:${r.month}`, r.expected_covers]))
  const monthly = (editData.value?.seasonality ?? []).map(s => ({
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
    const row = editData.value?.areas.find(r => r.id === a.id)
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
// numeric field on this tab, so save-time validation still catches it).
function computedCapacity(a: AreaDraft, season: 'novApr' | 'mayOct'): number | null {
  if (season === 'novApr' && isOutdoor(a.name)) return null
  return Math.round(num(a.seats) * num(a.maxTurnsPerNight))
}
function fmtCapacity(n: number | null): string {
  return n == null ? 'closed' : (Number.isFinite(n) ? String(n) : '—')
}
// Blended per-cover revenue, live-derived from the two draft inputs —
// display only, not a separately stored/editable field (see schema.sql's
// capacity_areas comment on why the total is computed, not stored).
function perCoverTotal(a: AreaDraft): number {
  return (Number(a.perCoverRevenueFood) || 0) + (Number(a.perCoverRevenueBeverage) || 0)
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
// Operating nights for a month, anchored to YEAR (the same "current year"
// convention useBudgetData's other figures use) — Tue-Sun (the standing
// Monday closure) minus that row's own Closures input. This is the same
// definition capacity.get.ts's isOperatingDow/holidayAdjustment apply to
// real dates, just computed generically for month 1-12 rather than a real
// calendar range, since this table's rows aren't tied to any specific year.
function operatingNightsInMonth(s: MonthlyDraft): number {
  const dim = new Date(Date.UTC(YEAR, s.month, 0)).getUTCDate()
  let nights = 0
  for (let day = 1; day <= dim; day++) {
    if (new Date(Date.UTC(YEAR, s.month - 1, day)).getUTCDay() !== 1) nights++
  }
  const closures = intNum(s.holidayClosuresInput)
  return Math.max(0, nights - (Number.isFinite(closures) ? closures : 0))
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
    avgCheck: covers > 0 ? revenue / covers : null,
    projectedMonthlyRevenue: revenue * operatingNightsInMonth(s)
  }
}
// Rounded to the nearest whole percent / dollar for quick readability
// (2026-08-17, at the user's request) — display-only, not the underlying
// stored precision. Named distinctly from the Capacity Pace tab's own
// fmtPct (one decimal place) above, since the two tabs deliberately format
// this differently and now share a script scope.
function fmtPctWhole(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}
function fmtMoney2(n: number | null): string {
  return n == null ? '—' : String(Math.round(n))
}
function fmtMoneyFull(n: number | null): string {
  return n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`
}

// Year-total footer row (added at the user's request, 2026-09-14) — only
// Closures and Projected Revenue are genuinely additive across months; the
// rest of the table's columns (covers per area, the monthly Total, Fill %,
// Per-Cover $) are nightly rates, and summing a rate across 12 months
// doesn't produce a meaningful number — those instead show the plain
// (unweighted) average of the 12 monthly figures, added 2026-09-14 in
// place of the "—" placeholder those columns started with. Fill %/
// Per-Cover $ average only over months with a real (non-null) value —
// null only happens if a month's capacity or covers are both zero, which
// doesn't occur in practice given every area has some capacity, but this
// guards it anyway rather than letting a null silently count as zero and
// drag the average down.
const yearlyTotals = computed(() => {
  const months = monthlyDrafts.value
  const areaCoversSum = new Map(areaDrafts.value.map(a => [a.id, 0]))
  let closures = 0, projectedRevenue = 0
  let totalCoversSum = 0, fillPctSum = 0, fillPctCount = 0, avgCheckSum = 0, avgCheckCount = 0
  for (const s of months) {
    const c = Number(s.holidayClosuresInput)
    closures += Number.isFinite(c) ? c : 0
    const d = monthDerived(s)
    projectedRevenue += d.projectedMonthlyRevenue
    totalCoversSum += d.totalCovers
    if (d.fillPct != null) { fillPctSum += d.fillPct; fillPctCount++ }
    if (d.avgCheck != null) { avgCheckSum += d.avgCheck; avgCheckCount++ }
    for (const a of areaDrafts.value) {
      const v = Number(s.areaCoversInput[a.id])
      areaCoversSum.set(a.id, (areaCoversSum.get(a.id) ?? 0) + (Number.isFinite(v) ? v : 0))
    }
  }
  const areaCoversAvg = new Map(areaDrafts.value.map(a => [a.id, months.length > 0 ? (areaCoversSum.get(a.id) ?? 0) / months.length : 0]))
  return {
    closures,
    projectedRevenue,
    areaCoversAvg,
    totalCoversAvg: months.length > 0 ? totalCoversSum / months.length : 0,
    fillPctAvg: fillPctCount > 0 ? fillPctSum / fillPctCount : null,
    avgCheckAvg: avgCheckCount > 0 ? avgCheckSum / avgCheckCount : null
  }
})

function historyIndexFor(month: number): number | null {
  return historyData.value?.monthlyIndex?.find(m => m.month === month)?.indexPct ?? null
}
// The fraction "Set by History" would apply to a given month: this month's
// historical index (its covers per open day as a % of that year's own
// average, from the most recent prior year's Toast history — see
// server/api/capacity/history.get.ts; switched from a revenue-based proxy
// to real covers 2026-08-12) scaled against a fully data-driven annual
// baseline (`dataAnnualFillPct`, server-computed) rather than whatever
// happened to already be typed into the covers grid — replaced 2026-08-13
// at the user's own request, after they pointed out that anchoring to
// on-page numbers meant a stale or optimistic guess would silently distort
// "Set by History"'s output. `dataAnnualFillPct` de-seasonalizes the real
// ~8 weeks of Cambridge St data using this same historical shape, so it's
// not just "raw summer fill %" either — see its own comment in
// history.get.ts. Null (and the button disabled) when either input is
// missing — no historical reading for that month, or not enough real
// Cambridge St data yet to compute a baseline from.
function historyTargetFraction(s: MonthlyDraft): number | null {
  const indexPct = historyIndexFor(s.month)
  const baseline = historyData.value?.dataAnnualFillPct ?? null
  if (indexPct == null || baseline == null) return null
  return baseline * (indexPct / 100)
}
function historyTooltip(s: MonthlyDraft): string {
  const indexPct = historyIndexFor(s.month)
  const baseline = historyData.value?.dataAnnualFillPct ?? null
  if (indexPct == null) return 'No historical Toast covers data available for this month yet.'
  if (baseline == null) return 'Not enough real Cambridge St Toast data yet to compute a data-driven baseline.'
  return `${MONTH_NAMES[s.month - 1]} historically runs ${indexPct.toFixed(0)}% of the year's average covers per night (${historyYearsLabel.value} Toast) — applied to a real, data-driven ${fmtPctWhole(baseline)} annual baseline (real Cambridge St covers since the move, de-seasonalized using this same historical shape).`
}
// "Set by History" (replaced the manually-typed "Set %" 2026-08-10) applies
// one blended fill % — derived from real historical seasonality rather than
// typed in by hand — across every area's own capacity for that month,
// weighted by each area's real relative fill-rate index (areaFillIndexFor,
// added 2026-08-13 — see its own comment above; falls back to equal
// weighting, the original behavior, for any area with no real index yet).
// Still a one-shot action (a button), not a live two-way-bound field, for
// the same reason the old Set % was: continuous syncing would fight direct
// per-area edits. A closed-season area (areaCapacityForMonth already
// returns 0 for that case, e.g. Outdoor Nov-Apr) naturally stays at 0
// covers regardless of its index — 0 capacity × any index is still 0.
//
// Uses largest-remainder rounding, same technique the old equal-weighted
// version already used (see git history) — computes the exact (unrounded)
// target per area, floors every one, then hands out the leftover whole
// covers (the total's own rounding, computed once from the *unweighted*
// total so the overall total stays anchored to the seasonal figure
// regardless of the per-area weighting) to the areas with the largest
// fractional remainder. Each area's exact target is clamped to its own
// capacity first — a real possibility once weighting is uneven (e.g. an
// area with a >1 index in an already-high-fill month could otherwise be
// asked for more covers than it physically seats) — with the leftover
// then distributed only among areas still below their own cap, so the
// total still lands on the seasonal target without asking any one area to
// overbook itself.
// "Set by Actuals" — for the current (in-progress) month only, overwrites
// each area's expected covers with that area's real actual covers/night
// so far this month, from daily_toast_area_metrics — the same
// actualCoversPerNight figure already shown on the Capacity Pace tab's "By
// Area" cards (areaBreakdownForMonth in server/api/capacity.get.ts), reused
// here rather than adding a new endpoint. Lets the assumption tighten as
// real data comes in mid-month, the same "readjust as data arrives" role
// Set by History plays for a month with no real data yet — a one-shot
// button, not a live binding, for the same reason every other "Set..."
// action on this tab is (see Set by History's own comment above).
function currentMonthAreaBreakdown(): AreaBreakdownRow[] | null {
  const asOfMonth = paceData.value?.asOfMonth
  if (asOfMonth == null) return null
  return months.value.find(m => m.month === asOfMonth)?.areaBreakdown ?? null
}
function canSetByActuals(s: MonthlyDraft): boolean {
  if (paceData.value?.asOfMonth !== s.month) return false
  const bd = currentMonthAreaBreakdown()
  return !!bd && bd.some(a => a.actualCoversPerNight != null)
}
function actualsPreviewTotal(): number | null {
  const bd = currentMonthAreaBreakdown()
  if (!bd) return null
  const known = bd.filter(a => a.actualCoversPerNight != null)
  if (known.length === 0) return null
  return known.reduce((sum, a) => sum + (a.actualCoversPerNight ?? 0), 0)
}
function setByActualsTooltip(s: MonthlyDraft): string {
  if (paceData.value?.asOfMonth !== s.month) return `Only available for the current month (${paceData.value?.asOfMonth != null ? MONTH_NAMES[paceData.value.asOfMonth - 1] : '—'}).`
  if (!canSetByActuals(s)) return `No real Toast covers data synced yet for ${MONTH_NAMES[s.month - 1]}.`
  return `Set each area's covers to its real average covers/night so far this month (Toast, through ${paceData.value?.asOfDate ?? 'the latest sync'}).`
}
function applySetByActuals(s: MonthlyDraft) {
  const bd = currentMonthAreaBreakdown()
  if (!bd) return
  for (const row of bd) {
    if (row.actualCoversPerNight != null) {
      s.areaCoversInput[row.areaId] = String(roundCovers(row.actualCoversPerNight))
    }
  }
}

function applySetByHistory(s: MonthlyDraft) {
  const fraction = historyTargetFraction(s)
  if (fraction == null) return
  const areas = areaDrafts.value
  const caps = areas.map(a => areaCapacityForMonth(a, s.month))
  const exact = areas.map((a, i) => Math.min(fraction * caps[i] * areaFillIndexFor(a.id), caps[i]))
  const totalCapacity = caps.reduce((sum, c) => sum + c, 0)
  const totalTarget = Math.round(fraction * totalCapacity)
  const floors = exact.map(Math.floor)
  const floorSum = floors.reduce((sum, v) => sum + v, 0)
  const order = floors
    .map((_, i) => i)
    .sort((x, y) => (exact[y] - floors[y]) - (exact[x] - floors[x]))
  const result = [...floors]
  let leftover = Math.max(0, totalTarget - floorSum)
  for (let k = 0; k < order.length && leftover > 0; k++) {
    if (result[order[k]] >= caps[order[k]]) continue
    result[order[k]] += 1
    leftover--
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
// for every field on this tab except Max Turns/Night and Per-Cover
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
        throw new Error(`Invalid closures number in the ${MONTH_NAMES[s.month - 1]} row`)
      }
    }
    for (const s of areaSeasonality) {
      if (Number.isNaN(s.expectedCovers)) {
        const areaName = areaDrafts.value.find(a => a.id === s.areaId)?.name
        throw new Error(`Invalid covers number for ${areaName} in ${MONTH_NAMES[s.month - 1]}`)
      }
    }
    await $fetch('/api/capacity/settings', { method: 'POST', body: { areas, seasonality, areaSeasonality } })
    await editRefresh()
    saveStatus.value = 'saved'
  } catch (err: any) {
    saveStatus.value = 'error'
    saveMessage.value = err?.data?.statusMessage || err?.message || 'Save failed'
  }
}
</script>

<template>
  <div>
    <div v-if="pacePending || editPending" class="state-note">Loading capacity data…</div>
    <div v-else-if="paceError || editError" class="drill-card">
      <span class="chip critical">Couldn't load capacity data</span>
      <span class="quiet-note">{{ paceError?.message || editError?.message }}</span>
    </div>

    <template v-else>
      <PageHeader
        page-name="Capacity"
        description="Are we filling the room at the rate we've assumed, and are guests spending what we've assumed per cover? Edit those assumptions on the Edit tab."
        :as-of-label="paceData?.asOfDate ? fmtDate(paceData.asOfDate) : undefined"
        @synced="paceRefresh()"
      />

      <div class="tab-nav">
        <button type="button" :class="['tab-btn', tab === 'pace' && 'active']" @click="setTab('pace')">Capacity Pace</button>
        <button type="button" :class="['tab-btn', tab === 'edit' && 'active']" @click="setTab('edit')">Edit Capacity</button>
      </div>

      <!-- ================= Capacity Pace tab ================= -->
      <template v-if="tab === 'pace'">
        <div v-if="!paceData?.asOfDate || !periods" class="drill-card">
          <span class="chip warning">No synced data yet</span>
          <span class="quiet-note">Run a QuickBooks/Toast sync before this page has real actuals to compare against.</span>
        </div>
        <template v-else>
          <!-- Quick look: the four periods a restaurateur actually checks day to day -->
          <section>
            <div class="section-head">
              <div class="section-label">Are We Meeting Our Assumptions?</div>
              <div class="section-note">Per-cover and fill % are rate metrics — a partial period compares fairly against the assumed rate with no projection needed. See <button type="button" class="link-btn" @click="setTab('edit')">Edit assumptions</button>.</div>
            </div>

            <div class="quick-row">
              <div v-for="(p, key) in { 'Last Month': periods.lastMonth, 'Last Week': periods.lastWeek, 'This Month': periods.thisMonth, 'This Week': periods.thisWeek }" :key="key" class="assumption-card" :class="{ anchor: p.isCurrent }">
                <div class="card-head">
                  <span class="period-name">{{ key }}{{ p.isCurrent ? ' (to date)' : '' }}</span>
                  <span class="period-range">{{ rangeLabel(p) }}</span>
                </div>
                <template v-if="p.actual">
                  <div class="metric primary">
                    <div class="metric-top">
                      <span class="metric-label">Per-Cover</span>
                      <span v-if="ratioStatus(p.actual.actualAvgCheck, p.assumed.assumedAvgCheck)" :class="['chip', ratioStatus(p.actual.actualAvgCheck, p.assumed.assumedAvgCheck)]">
                        {{ checkDeltaLabel(p) }}
                      </span>
                    </div>
                    <div class="metric-figure">{{ fmtMoney(p.actual.actualAvgCheck) }}</div>
                    <div class="metric-sub">vs. {{ fmtMoney(p.assumed.assumedAvgCheck) }} assumed</div>
                  </div>
                  <div class="metric">
                    <div class="metric-top">
                      <span class="metric-label">Fill %</span>
                      <span v-if="ratioStatus(p.actual.actualFillPct, p.assumed.assumedFillPct)" :class="['chip', ratioStatus(p.actual.actualFillPct, p.assumed.assumedFillPct)]">
                        {{ fillDeltaLabel(p) }}
                      </span>
                    </div>
                    <div class="metric-figure small">{{ fmtPct(p.actual.actualFillPct) }}</div>
                    <div class="metric-sub">vs. {{ fmtPct(p.assumed.assumedFillPct) }} assumed</div>
                  </div>
                  <div class="caption"><strong>{{ fmtAvgCovers(p.actual.covers, p.actual.operatingDays) }} covers/night</strong> avg &middot; {{ fmtCovers(p.actual.covers) }} covers &middot; {{ fmtMoneyRound(p.actual.revenue) }} revenue</div>
                </template>
                <div v-else class="quiet-note">No actual data for this period yet.</div>
              </div>
            </div>
          </section>

          <!-- Month by month, one at a time -->
          <section>
            <div class="section-head">
              <div class="section-label">By Month — {{ paceData.asOfYear }}</div>
              <div class="section-note"><button type="button" class="link-btn" @click="setTab('edit')">Edit capacity, turns, and per-cover revenue →</button></div>
            </div>

            <div class="month-tabs">
              <button
                v-for="(name, i) in MONTH_NAMES" :key="name"
                type="button"
                :class="['month-tab', selectedMonth === i + 1 && 'active']"
                @click="selectedMonth = i + 1"
              >{{ name }}</button>
            </div>

            <div v-if="selectedMonthData" class="assumption-card month-detail">
              <div class="card-head">
                <span class="period-name">{{ MONTH_NAMES[selectedMonthData.month - 1] }} {{ paceData.asOfYear }}{{ selectedMonthData.isCurrent ? ' (to date)' : '' }}</span>
                <span class="period-range">{{ selectedMonthData.assumed.operatingDays }} operating days<template v-if="selectedMonthData.holidayClosures > 0"> (−{{ selectedMonthData.holidayClosures }} holiday{{ selectedMonthData.holidayClosures === 1 ? '' : 's' }})</template></span>
              </div>
              <template v-if="selectedMonthData.actual">
                <div class="metric-grid">
                  <div class="metric primary">
                    <div class="metric-top">
                      <span class="metric-label">Per-Cover</span>
                      <span v-if="ratioStatus(selectedMonthData.actual.actualAvgCheck, selectedMonthData.assumed.assumedAvgCheck)" :class="['chip', ratioStatus(selectedMonthData.actual.actualAvgCheck, selectedMonthData.assumed.assumedAvgCheck)]">
                        {{ checkDeltaLabel(selectedMonthData) }}
                      </span>
                    </div>
                    <div class="metric-figure">{{ fmtMoney(selectedMonthData.actual.actualAvgCheck) }}</div>
                    <div class="metric-sub">vs. {{ fmtMoney(selectedMonthData.assumed.assumedAvgCheck) }} assumed</div>
                  </div>
                  <div class="metric primary">
                    <div class="metric-top">
                      <span class="metric-label">Fill %</span>
                      <span v-if="ratioStatus(selectedMonthData.actual.actualFillPct, selectedMonthData.assumed.assumedFillPct)" :class="['chip', ratioStatus(selectedMonthData.actual.actualFillPct, selectedMonthData.assumed.assumedFillPct)]">
                        {{ fillDeltaLabel(selectedMonthData) }}
                      </span>
                    </div>
                    <div class="metric-figure">{{ fmtPct(selectedMonthData.actual.actualFillPct) }}</div>
                    <div class="metric-sub">vs. {{ fmtPct(selectedMonthData.assumed.assumedFillPct) }} assumed</div>
                  </div>
                </div>
                <div class="caption">
                  <strong>{{ fmtAvgCovers(selectedMonthData.actual.covers, selectedMonthData.actual.operatingDays) }} covers/night</strong> avg
                  ({{ fmtAvgCovers(selectedMonthData.assumed.expectedCovers, selectedMonthData.assumed.operatingDays) }} covers/night assumed)
                  &middot; {{ fmtCovers(selectedMonthData.actual.covers) }} covers vs. {{ fmtCovers(selectedMonthData.assumed.expectedCovers) }} expected
                  &middot; {{ fmtMoneyRound(selectedMonthData.actual.revenue) }} revenue vs. {{ fmtMoneyRound(selectedMonthData.assumed.expectedRevenue) }} expected
                  <template v-if="selectedMonthData.isCurrent">(through {{ fmtDate(selectedMonthData.actual.throughDate) }})</template>
                </div>
              </template>
              <div v-else class="quiet-note">
                No actual data yet — assumed target: {{ fmtPct(selectedMonthData.assumed.assumedFillPct) }} fill, {{ fmtMoney(selectedMonthData.assumed.assumedAvgCheck) }}/cover ({{ fmtMoneyRound(selectedMonthData.assumed.expectedRevenue) }} expected revenue).
              </div>
            </div>

            <!-- By area: average covers/night and per-cover spend, actual vs. projected.
                 Same period as the month-detail card directly above (areaBreakdownForMonth
                 shares that card's startIso/endIso, capped at asOfDate) — the label here
                 says so explicitly rather than relying on visual proximity alone. -->
            <div v-if="selectedMonthData" class="area-section-head">
              By Area &middot; {{ MONTH_NAMES[selectedMonthData.month - 1] }} {{ paceData.asOfYear }}{{ selectedMonthData.isCurrent ? ' (to date)' : '' }}
            </div>
            <div class="area-grid">
              <div v-for="a in (selectedMonthData?.areaBreakdown ?? [])" :key="a.areaId" class="assumption-card area-card">
                <div class="card-head">
                  <span class="period-name" style="text-transform: capitalize;">{{ a.areaName }}</span>
                </div>
                <div class="metric">
                  <div class="metric-top">
                    <span class="metric-label">Covers/Night</span>
                    <span v-if="ratioStatus(a.actualCoversPerNight, a.assumedCoversPerNight)" :class="['chip', ratioStatus(a.actualCoversPerNight, a.assumedCoversPerNight)]">
                      {{ deltaCoversLabel(a.actualCoversPerNight, a.assumedCoversPerNight) }}
                    </span>
                  </div>
                  <div class="metric-figure small">{{ fmtCoversPerNight(a.actualCoversPerNight) }}</div>
                  <div class="metric-sub">vs. {{ fmtCoversPerNight(a.assumedCoversPerNight) }} assumed</div>
                </div>
                <div class="metric">
                  <div class="metric-top">
                    <span class="metric-label">Per-Cover</span>
                    <span v-if="ratioStatus(a.actualPerCover, a.assumedPerCover)" :class="['chip', ratioStatus(a.actualPerCover, a.assumedPerCover)]">
                      {{ deltaMoneyLabel(a.actualPerCover, a.assumedPerCover) }}
                    </span>
                  </div>
                  <div class="metric-figure small">{{ fmtMoney(a.actualPerCover) }}</div>
                  <div class="metric-sub">vs. {{ fmtMoney(a.assumedPerCover) }} assumed</div>
                </div>
              </div>
            </div>
          </section>

          <div class="legend">
            <span class="chip good">Meeting / exceeding assumption</span>
            <span class="chip warning">Watch</span>
            <span class="chip serious">Off assumption</span>
            <span class="chip critical">Well short</span>
          </div>

          <footer>
            <span>Assumed fill %/per-cover: capacity_areas × capacity_seasonality &middot; Actuals: Toast (covers) and QuickBooks (revenue), synced nightly</span>
          </footer>
        </template>
      </template>

      <!-- ================= Edit Capacity tab ================= -->
      <template v-else>
        <div class="edit-sub">Capacity, turns/night, and per-cover revenue assumptions, plus the monthly fill % and holiday-closure counts these get tested against. See <button type="button" class="link-btn" @click="setTab('pace')">Capacity Pace</button> to see how real fill % and per-cover spend compare.</div>

        <section>
          <div class="section-head">
            <div class="section-label">Per-Area Capacity &amp; Revenue</div>
            <ul class="section-note note-list">
              <li>Capacity Nov–Apr and May–Oct are calculated as Seats × Max Turns/Night, not entered directly.</li>
              <li>Outdoor has no Nov–Apr season — it stays closed through winter.</li>
              <li>Per-Cover Revenue (Total) is an assumed target. Actual This/Last Month is real Toast covers/revenue by area, for comparison — see the Capacity Pace tab for the blended (non-area) version.</li>
              <li>"Set from Actuals" overwrites Food/Beverage with that area's real this + last month blended per-cover $, split using the restaurant-wide real Food/Beverage revenue mix (Toast's own totals have no food/beverage split to draw from directly).</li>
            </ul>
          </div>
          <div class="pl-table-card">
            <table class="pl-table edit-table">
              <caption>Editable per-area seats, turns/night, and revenue assumptions, with calculated seasonal capacity and real actual per-cover revenue for this month and last month</caption>
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Seats</th>
                  <th scope="col">Max Turns/Night</th>
                  <th scope="col">Capacity Nov–Apr</th>
                  <th scope="col">Capacity May–Oct</th>
                  <th scope="col">Set from Actuals</th>
                  <th scope="col">Per-Cover Revenue (Food)</th>
                  <th scope="col">Per-Cover Revenue (Beverage)</th>
                  <th scope="col">Per-Cover Revenue (Total)</th>
                  <th scope="col">Actual ({{ thisMonthLabel }})</th>
                  <th scope="col">Actual ({{ lastMonthLabel }})</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in areaDrafts" :key="a.id">
                  <th scope="row" style="text-transform: capitalize;">{{ a.name }}</th>
                  <td><input v-model="a.seats" class="cell-input" inputmode="numeric" /></td>
                  <td><input v-model="a.maxTurnsPerNight" class="cell-input decimal" inputmode="decimal" /></td>
                  <td class="derived">{{ fmtCapacity(computedCapacity(a, 'novApr')) }}</td>
                  <td class="derived">{{ fmtCapacity(computedCapacity(a, 'mayOct')) }}</td>
                  <td class="setpct-cell">
                    <div class="setpct-row">
                      <button
                        type="button"
                        class="apply-pct-btn"
                        :disabled="!canSetFromActuals(a)"
                        :title="canSetFromActuals(a) ? `Set Food/Beverage from ${fmtMoneyOrDash(trailingTwoMonthPerCover(a.id))}/cover, this + last month combined` : 'No real per-area actuals available yet for this area'"
                        @click="setFromActuals(a)"
                      >Set from Actuals</button>
                      <span class="setpct-arrow" aria-hidden="true">→</span>
                    </div>
                    <span v-if="canSetFromActuals(a)" class="setpct-result">≈{{ fmtMoneyOrDash(trailingTwoMonthPerCover(a.id)) }}/cover</span>
                  </td>
                  <td><span class="money-cell">$<input v-model="a.perCoverRevenueFood" class="cell-input decimal" inputmode="decimal" /></span></td>
                  <td><span class="money-cell">$<input v-model="a.perCoverRevenueBeverage" class="cell-input decimal" inputmode="decimal" /></span></td>
                  <td class="derived">${{ Math.round(perCoverTotal(a)) }}</td>
                  <td class="derived">
                    <span v-if="areaActualVariance(a, 'thisMonth')" :class="['variance-text', `v-${areaActualVariance(a, 'thisMonth')!.status}`]">
                      <span class="variance-main">{{ fmtMoneyOrDash(areaActualPerCover(a.id, 'thisMonth')) }}</span>
                      <span class="variance-delta"><span class="variance-icon">{{ varianceIcon(areaActualVariance(a, 'thisMonth')) }}</span> {{ varianceDeltaLabel(areaActualVariance(a, 'thisMonth')) }}</span>
                    </span>
                    <span v-else>{{ fmtMoneyOrDash(areaActualPerCover(a.id, 'thisMonth')) }}</span>
                  </td>
                  <td class="derived">
                    <span v-if="areaActualVariance(a, 'lastMonth')" :class="['variance-text', `v-${areaActualVariance(a, 'lastMonth')!.status}`]">
                      <span class="variance-main">{{ fmtMoneyOrDash(areaActualPerCover(a.id, 'lastMonth')) }}</span>
                      <span class="variance-delta"><span class="variance-icon">{{ varianceIcon(areaActualVariance(a, 'lastMonth')) }}</span> {{ varianceDeltaLabel(areaActualVariance(a, 'lastMonth')) }}</span>
                    </span>
                    <span v-else>{{ fmtMoneyOrDash(areaActualPerCover(a.id, 'lastMonth')) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div class="section-head">
            <div class="section-label">Expected Nightly Covers by Area &amp; Closures</div>
            <ul class="section-note note-list">
              <li>Average nightly covers per area, by month — edit these directly.</li>
              <li>Or use "Set by History" to apply that month's real historical seasonality ({{ historyYearsLabel }} Toast covers, scaled to this page's current year-round average) equally across every area's own capacity for that month — overwrites that row's per-area covers to the right.</li>
              <li>For the current month, "Set by Actuals" instead overwrites each area's covers with its real average covers/night so far this month (Toast) — use this to tighten the assumption as real data comes in.</li>
              <li>Total, Fill %, and Per-Cover $ are derived.</li>
              <li>Closures are additional nights closed beyond the standing Monday closure.</li>
            </ul>
          </div>
          <div class="pl-table-card covers-table-card">
            <table class="pl-table edit-table covers-table">
              <caption>Editable monthly expected covers per area, a history-derived quick-set blended fill percentage, a total covers figure, derived fill percentage, per-cover revenue, projected revenue, and holiday closure counts</caption>
              <thead>
                <tr>
                  <th scope="col" class="sticky-col">Month</th>
                  <th scope="col">Set by History</th>
                  <th scope="col">Set by Actuals</th>
                  <th v-for="a in areaDrafts" :key="a.id" scope="col" style="text-transform: capitalize;">{{ a.name }}</th>
                  <th scope="col">Total</th>
                  <th scope="col">Fill %</th>
                  <th scope="col">Per-Cover $</th>
                  <th scope="col">Closures</th>
                  <th scope="col">Projected Revenue</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in monthlyDrafts" :key="s.month">
                  <th scope="row" class="sticky-col">{{ MONTH_NAMES[s.month - 1] }}</th>
                  <td>
                    <span class="setpct-cell">
                      <span class="setpct-row">
                        <button
                          type="button"
                          class="apply-pct-btn"
                          :disabled="historyTargetFraction(s) == null"
                          :title="historyTooltip(s)"
                          @click="applySetByHistory(s)"
                        >Set by History</button>
                        <span class="setpct-arrow" aria-hidden="true">→</span>
                      </span>
                      <span v-if="historyTargetFraction(s) != null" class="setpct-result">≈{{ fmtPctWhole(historyTargetFraction(s)) }}</span>
                    </span>
                  </td>
                  <td>
                    <span class="setpct-cell">
                      <span class="setpct-row">
                        <button
                          type="button"
                          class="apply-pct-btn"
                          :disabled="!canSetByActuals(s)"
                          :title="setByActualsTooltip(s)"
                          @click="applySetByActuals(s)"
                        >Set by Actuals</button>
                        <span class="setpct-arrow" aria-hidden="true">→</span>
                      </span>
                      <span v-if="canSetByActuals(s)" class="setpct-result">≈{{ fmtCoversPerNight(actualsPreviewTotal()) }}/night</span>
                    </span>
                  </td>
                  <td v-for="a in areaDrafts" :key="a.id"><input v-model="s.areaCoversInput[a.id]" class="cell-input narrow" inputmode="numeric" /></td>
                  <td class="derived">{{ monthDerived(s).totalCovers }}</td>
                  <td class="derived">{{ fmtPctWhole(monthDerived(s).fillPct) }}</td>
                  <td class="derived">${{ fmtMoney2(monthDerived(s).avgCheck) }}</td>
                  <td><input v-model="s.holidayClosuresInput" class="cell-input" inputmode="numeric" /></td>
                  <td class="derived">{{ fmtMoneyFull(monthDerived(s).projectedMonthlyRevenue) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" class="sticky-col">Total</th>
                  <td class="derived">—</td>
                  <td class="derived">—</td>
                  <td v-for="a in areaDrafts" :key="a.id" class="derived">{{ Math.round(yearlyTotals.areaCoversAvg.get(a.id) ?? 0) }}</td>
                  <td class="derived">{{ Math.round(yearlyTotals.totalCoversAvg) }}</td>
                  <td class="derived">{{ fmtPctWhole(yearlyTotals.fillPctAvg) }}</td>
                  <td class="derived">${{ fmtMoney2(yearlyTotals.avgCheckAvg) }}</td>
                  <td class="derived">{{ yearlyTotals.closures }}</td>
                  <td class="derived">{{ fmtMoneyFull(yearlyTotals.projectedRevenue) }}</td>
                </tr>
              </tfoot>
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
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }

/* ---------- sub-tab nav (Capacity Pace / Edit Capacity) ---------- */
.tab-nav { display: flex; gap: 2px; margin-bottom: 16px; border-bottom: 1px solid var(--hair); }
.tab-btn {
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  padding: 9px 16px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
.link-btn {
  font: inherit;
  font-weight: 600;
  color: var(--accent);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
}

/* ---------- quick-look cards ---------- */
.quick-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.assumption-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.assumption-card.anchor { background: var(--accent-wash); border-color: transparent; }
.card-head { display: flex; flex-direction: column; gap: 2px; }
.card-head .period-name { font-size: 13px; font-weight: 700; color: var(--ink); }
.card-head .period-range { font-size: 11px; color: var(--ink-3); }
.metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.metric { display: flex; flex-direction: column; gap: 2px; }
.metric-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.metric-label { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); text-transform: uppercase; }
.metric-figure { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; color: var(--ink); }
.metric-figure.small { font-size: 20px; }
.metric.primary .metric-figure { font-size: 30px; }
.metric-sub { font-size: 11px; color: var(--ink-3); }
.caption { font-size: 11.5px; color: var(--ink-3); border-top: 1px dashed var(--hair); padding-top: 8px; }
.caption strong { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }

.month-detail { margin-top: 10px; }

/* ---------- month tabs (copied from budget/edit.vue) ---------- */
.month-tabs { display: flex; gap: 2px; padding: 0 0 0; overflow-x: auto; margin-bottom: 10px; }
.month-tab {
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  padding: 8px 16px;
  border: 1px solid var(--hair);
  border-radius: 10px;
  background: var(--surface-alt);
  color: var(--ink-2);
  cursor: pointer;
  white-space: nowrap;
}
.month-tab.active { background: var(--accent-wash); color: var(--accent); border-color: transparent; }

/* ---------- per-area breakdown (below the month detail card) ---------- */
.area-section-head {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--hair);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.area-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 10px; }
.area-card .metric-figure.small { font-size: 22px; }

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

@media (max-width: 960px) {
  .quick-row { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .quick-row { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: 1fr; }
}

/* ---------- Edit Capacity tab ---------- */
.edit-sub { font-size: 13px; color: var(--ink-3); max-width: 720px; line-height: 1.5; margin-bottom: 1.25rem; }

/* Section-note text as a bulleted list (2026-09-14, at the user's request,
   for readability) instead of one dense run-on paragraph — .section-note
   itself is a shared global class (main.css) other pages use for plain
   inline text, so the list layout/spacing is scoped locally here rather
   than added to that shared rule. Stacked under the title and given the
   full row width (rather than main.css's default side-by-side
   space-between layout, which squeezed the bullets into a narrow right
   column and forced heavy wrapping) — also at the user's request, same
   day. .section-head/.section-label are shared global classes too
   (main.css), so both overrides are scoped here rather than changed
   globally. */
.note-list { width: 100%; margin: 2px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.note-list li { line-height: 1.5; }

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
/* Header row background: a fixed slate blue-gray with white text (added at
   the user's request, 2026-09-14), not one of the app's light/dark-aware
   surface tokens — this is meant to read as a distinct "table header bar"
   regardless of theme, the same way it would in a spreadsheet, rather than
   shift with light/dark mode. Applies to both tables on this tab since
   both use .pl-table; the covers-table's own thead th rule below (needed
   for sticky positioning) relies on this already-opaque background rather
   than re-declaring it. */
.pl-table thead th { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: #ffffff; background: #3e5c76; border-bottom: 1px solid #2c4459; white-space: normal; padding-top: 16px; padding-bottom: 16px; }
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

/* Actual (Month) columns' colored figure + icon/delta — same v-good/
   v-warning/v-serious/v-critical status coloring and ✓/▲/▼ icon pairing
   as app/pages/budget/edit.vue's variance-text (status color must always
   pair with an icon, never stand alone — see the Design direction
   section in CLAUDE.md). Kept local rather than shared: the two pages'
   surrounding cell markup already differs enough that sharing would add
   more indirection than it saves. */
.variance-text.v-good { color: var(--good); }
.variance-text.v-warning { color: var(--warning); }
.variance-text.v-serious { color: var(--serious); }
.variance-text.v-critical { color: var(--critical); }
.variance-text { display: inline-flex; flex-direction: column; align-items: center; font-weight: 600; }
.variance-main { white-space: nowrap; }
.variance-icon { display: inline-block; }
.variance-delta { display: block; font-weight: 500; opacity: 0.8; white-space: nowrap; font-size: 11px; }

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

/* Expected Nightly Covers table: sticky Month column (left) so it stays
   visible while scrolling right on a narrow screen. Tighter padding/input
   widths than the table above make room for the new Projected Revenue
   column without the table growing much wider. No vertical height cap
   here (removed 2026-09-24, at the user's request) — this section already
   sits below a page scroll, and the previous 70vh-capped inner scroll
   meant scrolling twice (the page, then the table) to see all 12 months.
   The table now just grows to its natural height, relying on
   `.pl-table-card`'s own `overflow-x: auto` for horizontal scroll only;
   the header/footer rows lost their sticky-top/bottom behavior as a
   result (nothing left for them to stick within), so they render as plain
   rows now — only the Month column stays sticky. */
/* `position: sticky` on a <th>/<td> is a no-op in every major browser when
   the table uses `border-collapse: collapse` (this.pl-table's default) —
   confirmed by testing (the sticky computed style showed up correctly but
   the cell still scrolled away). Switching to `separate` fixes it, but
   `separate` doesn't paint a border set on <tr> at all (only cell borders
   render), so the row-divider line has to move from tr to the cells
   themselves for this table. */
/* `.pl-table.covers-table` (two classes), not just `.covers-table` — needs
   to out-specificity the base `table.pl-table { border-collapse: collapse }`
   rule (element + class), which a single-class selector alone loses to
   regardless of source order. */
.pl-table.covers-table { border-collapse: separate; border-spacing: 0; }
.covers-table tbody tr { border-bottom: none; }
.covers-table tbody td, .covers-table tbody th { border-bottom: 1px solid var(--hair); }
.covers-table tbody tr:last-child td, .covers-table tbody tr:last-child th { border-bottom: none; }
.covers-table th, .covers-table td { padding: 8px 7px; }
.covers-table .cell-input.narrow { width: 34px; }
/* Row shading (zebra striping) was tried and reverted (2026-09-14, at the
   user's request) — the existing 1px row-divider line above is enough on
   its own. */
.covers-table .sticky-col { position: sticky; left: 0; }
.covers-table thead th {
  /* .covers-table th, .covers-table td above sets the table's tighter 8px
     7px padding, which would otherwise win over .pl-table thead th's own
     padding-top/bottom (same specificity, but that rule comes first in the
     file) — re-declared here, after it, so the header row's extra vertical
     padding actually applies on this table too. */
  padding-top: 16px;
  padding-bottom: 16px;
}
.covers-table tbody th.sticky-col {
  z-index: 1;
  background: var(--surface);
}

/* Year-total footer row (added at the user's request, 2026-09-14; restyled
   to match the header — slate blue background, white text, same extra
   vertical padding — 2026-09-14). */
.covers-table tfoot th, .covers-table tfoot td {
  background: #3e5c76;
  font-weight: 700;
  color: #ffffff;
  border-top: 2px solid #2c4459;
  padding-top: 16px;
  padding-bottom: 16px;
}

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
</style>
