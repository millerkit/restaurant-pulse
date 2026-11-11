<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES, YEAR, paceStatus } from '~/composables/useBudgetData'


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
// The section nav (layouts/default.vue) switches tabs by changing ?tab= on
// the same route, which doesn't remount the page — follow it here.
watch(() => route.query.tab, (t) => { tab.value = t === 'edit' ? 'edit' : 'pace' })
useHead(() => ({ title: `${site.restaurantName} — ${tab.value === 'edit' ? 'Capacity' : 'Covers & Spend'}` }))
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
type AreaBreakdownRow = { areaId: number, areaName: string, assumedCoversPerNight: number, assumedPerCover: number, actualCoversPerNight: number | null, actualNights?: number, byWeekday?: Record<number, { covers: number, nights: number }>, actualPerCover: number | null }

const { isOwner } = useMe()
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
  per_cover_revenue_food: number, per_cover_revenue_beverage: number, notes: string | null,
  follow_actuals: number, follow_actuals_through: string | null,
  auto_per_cover_food: number | null, auto_per_cover_beverage: number | null,
  closed_dows: string | null, closed_from: string | null, closure_recapture_pct: number,
  closure_recapture_weights: string | null
}
type SeasonalityRow = { month: number, holiday_closures: number }
type AreaSeasonalityRow = { area_id: number, month: number, expected_covers: number, pinned: number, auto_covers: number | null, auto_basis: string | null }

type ReplacedNight = { date: string, kind: string, expectedRevenue: number, name: string | null }
const { data: editData, pending: editPending, error: editError, refresh: editRefresh } = await useFetch<{ areas: AreaRow[], seasonality: SeasonalityRow[], areaSeasonality: AreaSeasonalityRow[], replacedNights: ReplacedNight[], forecast: { currentMonth: number, refreshedOn: string | null } }>('/api/capacity/settings', { query: { year: YEAR } })
// Holidays + special nights other than buyouts in YEAR, by date (2026-11-08):
// those nights have no regular covers and are worth their own expected revenue.
const replacedByDate = computed(() => new Map((editData.value?.replacedNights ?? []).map(n => [n.date, n])))
function replacedInMonth(month: number): ReplacedNight[] {
  const prefix = `${YEAR}-${String(month).padStart(2, '0')}`
  return (editData.value?.replacedNights ?? []).filter(n => n.date.startsWith(prefix))
}
function replacedTitle(month: number): string {
  return replacedInMonth(month).map(n => `${n.date.slice(5)} ${n.name ?? n.kind}`).join(', ') || 'None'
}

// Real per-area actuals (this month / last month), added 2026-08-13 once
// Toast Configuration API scope unblocked resolving table.guid to an area
// (see server/utils/toast-table-map.ts). Shown next to the aspirational
// Per-Cover Revenue (Total) column so it reads as "assumed vs. actually
// happening" rather than a separate table. Display only: the automatic
// spend per guest (server/utils/capacity-forecast.ts) uses closed months.
type AreaActualsRow = { areaId: number, covers: number, revenue: number, foodRevenue: number | null, beverageRevenue: number | null, perCover: number | null }
type AreaActualsPeriod = { start: string, end: string, cappedAt: string, perArea: AreaActualsRow[] }
const { data: areaActualsData } = await useFetch<{ asOfDate: string | null, thisMonth: AreaActualsPeriod | null, lastMonth: AreaActualsPeriod | null }>('/api/capacity/area-actuals')
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

// Automatic spend per guest (2026-11-11, server/utils/capacity-forecast.ts):
// each area follows its real blend over the two most recently closed months,
// updated when a month closes, unless it's pinned (typed by hand).
function autoPerCover(areaId: number): { food: number, beverage: number } | null {
  const row = editData.value?.areas.find(r => r.id === areaId)
  if (row?.auto_per_cover_food == null || row.auto_per_cover_beverage == null) return null
  return { food: row.auto_per_cover_food, beverage: row.auto_per_cover_beverage }
}
// "Sep–Oct actuals": the two closed months the automatic value is built from.
function perCoverBasisLabel(areaId: number): string | null {
  const through = editData.value?.areas.find(r => r.id === areaId)?.follow_actuals_through
  if (!through) return null
  const m = Number(through.slice(5, 7))
  return `${MONTH_NAMES[(m + 10) % 12]}–${MONTH_NAMES[m - 1]} actuals`
}
function autoPerCoverTotal(areaId: number): number | null {
  const auto = autoPerCover(areaId)
  return auto ? auto.food + auto.beverage : null
}
function useAutoTitle(areaId: number): string {
  const total = autoPerCoverTotal(areaId)
  return total != null
    ? `Follow ${perCoverBasisLabel(areaId)}: $${total.toFixed(2)} per guest`
    : 'No automatic figure yet: needs 30+ covers in this area over the last two closed months'
}
function pinPerCover(a: AreaDraft) {
  a.perCoverPinned = true
}
function usePerCoverAuto(a: AreaDraft) {
  const auto = autoPerCover(a.id)
  a.perCoverPinned = false
  if (auto) {
    a.perCoverRevenueFood = String(auto.food)
    a.perCoverRevenueBeverage = String(auto.beverage)
  }
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
  perCoverRevenueFood: string, perCoverRevenueBeverage: string,
  // Typed by hand (kept as entered) vs. automatic (follows closed-month actuals)
  perCoverPinned: boolean,
  // Weekly closure (capacity_areas.closed_dows/closed_from/closure_recapture_pct)
  closedDows: number[], closedFrom: string, recapturePct: string,
  // Relative share of the recaptured covers landing on each open weekday (keyed by weekday number)
  recaptureWeights: Record<number, string>
}
// One row per month: closures (unchanged) plus each area's own
// expected nightly covers, keyed by area id — the real editable projection
// input as of 2026-08-07 (replacing a single blended Expected Fill %),
// per the user's own request after $86.12/cover looked low blended across
// very different areas.
// areaPinned (2026-11-11): a typed covers value is pinned and kept; anything
// else is automatic and follows the nightly forecast (server/utils/capacity-forecast.ts).
type MonthlyDraft = { month: number, holidayClosuresInput: string, areaCoversInput: Record<number, string>, areaPinned: Record<number, boolean> }

const areaDrafts = ref<AreaDraft[]>([])
const monthlyDrafts = ref<MonthlyDraft[]>([])

function loadDrafts() {
  areaDrafts.value = (editData.value?.areas ?? []).map(a => ({
    id: a.id,
    name: a.name,
    seats: String(Math.round(a.seats)),
    maxTurnsPerNight: String(a.max_turns_per_night),
    perCoverRevenueFood: String(a.per_cover_revenue_food),
    perCoverRevenueBeverage: String(a.per_cover_revenue_beverage),
    perCoverPinned: !a.follow_actuals,
    closedDows: parseClosedDows(a.closed_dows),
    closedFrom: a.closed_from ?? '',
    recapturePct: String(a.closure_recapture_pct ?? 0),
    recaptureWeights: parseRecaptureWeights(a.closure_recapture_weights)
  }))
  const areaMonthMap = new Map((editData.value?.areaSeasonality ?? []).map(r => [`${r.area_id}:${r.month}`, r]))
  monthlyDrafts.value = (editData.value?.seasonality ?? []).map(s => ({
    month: s.month,
    holidayClosuresInput: String(replacedInMonth(s.month).length),
    areaCoversInput: Object.fromEntries(areaDrafts.value.map(a => [a.id, String(roundCovers(areaMonthMap.get(`${a.id}:${s.month}`)?.expected_covers ?? 0))])),
    areaPinned: Object.fromEntries(areaDrafts.value.map(a => [a.id, !!areaMonthMap.get(`${a.id}:${s.month}`)?.pinned]))
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
    perCoverRevenueFood: String(a.per_cover_revenue_food), perCoverRevenueBeverage: String(a.per_cover_revenue_beverage),
    perCoverPinned: !a.follow_actuals,
    closedDows: parseClosedDows(a.closed_dows),
    closedFrom: a.closed_from ?? '',
    recapturePct: String(a.closure_recapture_pct ?? 0),
    recaptureWeights: parseRecaptureWeights(a.closure_recapture_weights)
  }))
  const areaMonthMap = new Map((editData.value?.areaSeasonality ?? []).map(r => [`${r.area_id}:${r.month}`, r]))
  const monthly = (editData.value?.seasonality ?? []).map(s => ({
    month: s.month,
    holidayClosuresInput: String(replacedInMonth(s.month).length),
    areaCoversInput: Object.fromEntries(areas.map(a => [a.id, String(roundCovers(areaMonthMap.get(`${a.id}:${s.month}`)?.expected_covers ?? 0))])),
    areaPinned: Object.fromEntries(areas.map(a => [a.id, !!areaMonthMap.get(`${a.id}:${s.month}`)?.pinned]))
  }))
  return JSON.stringify({ areaDrafts: areas, monthlyDrafts: monthly })
})
const hasUnsavedChanges = computed(() => draftSnapshot.value !== cleanDraftSnapshot.value)

// Capacity Nov-Apr/May-Oct is calculated from Seats × Max Turns/Night
// (added 2026-08-08, at the user's request, replacing free-typed capacity
// figures that could silently drift from those two inputs). Outdoor has no
// Nov-Apr season at all — it stays closed through winter, same as the old
// "leave it blank" convention — every other area gets both seasons.
// Returns null for "closed this season," never for invalid input (an
// unparseable Seats/Turns draft surfaces as NaN instead, same as any other
// numeric field on this tab, so save-time validation still catches it).
function computedCapacity(a: AreaDraft, season: 'novApr' | 'mayOct'): number | null {
  return seasonalCapacity(a.name, num(a.seats), num(a.maxTurnsPerNight), season)
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
    projectedMonthlyRevenue: projectedRevenueForMonth(s)
  }
}

// ---- weekly area closures (mirrors server/api/capacity.get.ts closureOn) ----
// The covers grid holds each area's PRE-closure per-Tue-Sun-night baseline. From
// an area's closure start date, it is dark on its closed weekdays and its other
// nights carry the recaptured share of the closed nights' covers.
function closureUplift(a: AreaDraft): number {
  return closureUpliftFor(a.closedDows.length, Number(a.recapturePct) || 0)
}
function closureOnDate(a: AreaDraft, iso: string, dow: number): { closed: boolean, uplift: number } {
  if (!a.closedFrom || iso < a.closedFrom || a.closedDows.length === 0) return { closed: false, uplift: 1 }
  return { closed: a.closedDows.includes(dow), uplift: closureUplift(a) }
}
// Revenue for a full calendar month of YEAR, night by night, so a closure that
// starts partway through the year (or the month) is applied only from its date.
// Holidays and non-buyout special nights are worth their own expected revenue, same as the server.
function projectedRevenueForMonth(s: MonthlyDraft): number {
  const dim = new Date(Date.UTC(YEAR, s.month, 0)).getUTCDate()
  let total = 0
  for (let day = 1; day <= dim; day++) {
    const dow = new Date(Date.UTC(YEAR, s.month - 1, day)).getUTCDay()
    if (dow === 1) continue
    const iso = `${YEAR}-${String(s.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const planned = replacedByDate.value.get(iso)
    if (planned) { total += planned.expectedRevenue; continue }
    let night = 0
    for (const a of areaDrafts.value) {
      const cl = closureOnDate(a, iso, dow)
      if (cl.closed) continue
      const base = Number(s.areaCoversInput[a.id])
      let covers = Number.isFinite(base) ? base : 0
      if (cl.uplift !== 1) covers = Math.min(covers * cl.uplift, areaCapacityForMonth(a, s.month))
      night += covers * perCoverTotal(a)
    }
    total += night
  }
  return total
}
const DOW_SHORT: Record<number, string> = { 0: 'Sun', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }
function closureSummary(a: AreaDraft): string {
  if (a.closedDows.length === 0) return 'Open all service nights'
  const u = closureUplift(a)
  const open = SERVICE_NIGHTS_PER_WEEK - a.closedDows.length
  return `${open} nights a week; covers on open nights × ${u.toFixed(2)}`
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

// ---- Automatic expected covers (2026-11-11) -----------------------------
// Months that haven't started follow the forecast (history shape × a baseline
// from real covers since the move, split by each area's real fill rate). The
// current month is frozen at what the forecast said when it began.
const forecastCurrentMonth = computed(() => editData.value?.forecast?.currentMonth ?? null)
function areaMonthRow(areaId: number, month: number): AreaSeasonalityRow | undefined {
  return editData.value?.areaSeasonality.find(r => r.area_id === areaId && r.month === month)
}
function autoCovers(areaId: number, month: number): number | null {
  const v = areaMonthRow(areaId, month)?.auto_covers
  return v == null ? null : roundCovers(v)
}
// The month's restaurant-wide fill % the automatic forecast used (from auto_basis 'history:45.3').
function autoFillPct(month: number): number | null {
  const basis = editData.value?.areaSeasonality.find(r => r.month === month && r.auto_basis)?.auto_basis
  const m = basis?.match(/^history:([\d.]+)$/)
  return m ? Number(m[1]) / 100 : null
}
function monthBasisLabel(s: MonthlyDraft): string {
  if (s.month === forecastCurrentMonth.value) return 'Frozen this month'
  const pct = autoFillPct(s.month)
  return pct == null ? 'No history yet' : `History ≈${fmtPctWhole(pct)}`
}
function monthBasisTitle(s: MonthlyDraft): string {
  if (s.month === forecastCurrentMonth.value) return `${MONTH_NAMES[s.month - 1]} has started, so its forecast is frozen at what it was on the 1st and actuals are judged against it. It starts following the forecast again (for next year) when the month ends.`
  const pct = autoFillPct(s.month)
  if (pct == null) return 'Not enough Toast history yet to forecast this month automatically; the saved numbers are used.'
  return `Last year's covers pattern says ${MONTH_NAMES[s.month - 1]} runs at about ${fmtPctWhole(pct)} of seats, scaled to how full Cambridge St has actually been since the move, then split by how full each area really runs. Updated nightly.`
}
function onCoversInput(s: MonthlyDraft, areaId: number) {
  s.areaPinned[areaId] = true
}
function unpinCovers(s: MonthlyDraft, areaId: number) {
  s.areaPinned[areaId] = false
  const auto = autoCovers(areaId, s.month)
  if (auto != null) s.areaCoversInput[areaId] = String(auto)
}
function coverAriaLabel(s: MonthlyDraft, a: AreaDraft): string {
  return `${a.name} covers per night, ${MONTH_NAMES[s.month - 1]}${s.areaPinned[a.id] ? ' (pinned)' : ''}`
}
function pinTitle(s: MonthlyDraft, areaId: number): string {
  const auto = autoCovers(areaId, s.month)
  return `Typed by hand, so it stays put. Click to go back to automatic${auto != null ? ` (${auto})` : ''}.`
}
const pinnedCount = computed(() => monthlyDrafts.value.reduce((n, s) => n + Object.values(s.areaPinned).filter(Boolean).length, 0))
function unpinAllCovers() {
  for (const s of monthlyDrafts.value) for (const a of areaDrafts.value) if (s.areaPinned[a.id]) unpinCovers(s, a.id)
}

// What the leave prompts warn about: real edits to the drafts. The message names what differs so a false alarm
// is diagnosable instead of a bare "unsaved edits".
const unsavedEditSummary = computed(() => {
  const clean = JSON.parse(cleanDraftSnapshot.value) as { areaDrafts: AreaDraft[], monthlyDrafts: MonthlyDraft[] }
  const draft = JSON.parse(draftSnapshot.value) as { areaDrafts: AreaDraft[], monthlyDrafts: MonthlyDraft[] }
  const parts: string[] = []
  for (const a of draft.areaDrafts) {
    const c = clean.areaDrafts.find(x => x.id === a.id)
    if (!c) continue
    const fields = (Object.keys(a) as (keyof AreaDraft)[]).filter(k => JSON.stringify(a[k]) !== JSON.stringify(c[k]))
    if (fields.length > 0) parts.push(`${a.name}: ${fields.join(', ')}`)
  }
  for (const m of draft.monthlyDrafts) {
    const c = clean.monthlyDrafts.find(x => x.month === m.month)
    if (c && JSON.stringify(m) !== JSON.stringify(c)) parts.push(MONTH_NAMES[m.month - 1])
  }
  return parts
})
const hasUserEdits = computed(() => draftSnapshot.value !== cleanDraftSnapshot.value)

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (!hasUserEdits.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', handleBeforeUnload))
onBeforeRouteLeave(() => {
  if (hasUserEdits.value && !window.confirm(`You have unsaved capacity edits (${unsavedEditSummary.value.join('; ')}). Leave without saving?`)) return false
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
    // Forecast fields only: seats, turns, capacity, weekly and holiday
    // closures are saved from Settings › Restaurant Setup (2026-11-08).
    const areas = areaDrafts.value.map(a => ({
      id: a.id,
      perCoverRevenueFood: num(a.perCoverRevenueFood),
      perCoverRevenueBeverage: num(a.perCoverRevenueBeverage),
      followActuals: !a.perCoverPinned
    }))
    const areaSeasonality = monthlyDrafts.value.flatMap(s =>
      areaDrafts.value.map(a => ({
        areaId: a.id,
        month: s.month,
        expectedCovers: intNum(s.areaCoversInput[a.id]),
        pinned: !!s.areaPinned[a.id]
      }))
    )
    for (const a of areas) {
      if ([a.perCoverRevenueFood, a.perCoverRevenueBeverage].some(Number.isNaN)) {
        throw new Error(`Invalid number in the ${areaDrafts.value.find(d => d.id === a.id)?.name} row`)
      }
    }
    for (const s of areaSeasonality) {
      if (Number.isNaN(s.expectedCovers)) {
        const areaName = areaDrafts.value.find(a => a.id === s.areaId)?.name
        throw new Error(`Invalid covers number for ${areaName} in ${MONTH_NAMES[s.month - 1]}`)
      }
    }
    await $fetch('/api/capacity/settings', { method: 'POST', body: { areas, areaSeasonality } })
    await editRefresh()
    // Don't rely only on the editData watcher to re-baseline the drafts.
    loadDrafts()
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
        :page-name="tab === 'edit' ? 'Capacity' : 'Covers & Spend'"
        :description="tab === 'edit' ? 'Seats, turns, expected covers and spend per guest for each area. These assumptions feed the Sales Plan.' : 'Are we filling seats at the rate we planned, and are guests spending what we planned per person?'"
        :as-of-label="paceData?.asOfDate ? fmtDate(paceData.asOfDate) : undefined"
        @synced="paceRefresh()"
      />


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

          <!-- Breakeven: covers/night needed to carry each layer of fixed cost -->
          <BreakevenCard v-if="isOwner" />

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
                <span class="period-range">{{ selectedMonthData.assumed.operatingDays }} operating days<template v-if="selectedMonthData.holidayClosures > 0"> (plus {{ selectedMonthData.holidayClosures }} holiday or special night{{ selectedMonthData.holidayClosures === 1 ? '' : 's' }})</template></span>
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
        <div class="edit-sub">The forecast: expected covers by area and month, and spend per guest. The room itself (seats, turns, closures) is set in <NuxtLink to="/settings">Settings</NuxtLink>. See <button type="button" class="link-btn" @click="setTab('pace')">Covers &amp; Spend</button> to see how real fill % and per-cover spend compare.</div>

        <section>
          <div class="section-head">
            <div class="section-label">Per-Area Capacity &amp; Revenue</div>
            <ul class="section-note note-list">
              <li>Seats, turns per night and closures are set in <NuxtLink to="/settings">Settings › Restaurant Setup</NuxtLink>; capacity is seats × turns, and Outdoor is closed Nov–Apr.</li>
              <li>Spend per guest is <strong>automatic</strong>: each area follows its real Toast spend over the last two closed months, updated when a month closes. Type over a figure to <strong>pin</strong> it (for a price you set on purpose); pinned figures stay until you click "Use automatic".</li>
              <li>Actual This/Last Month is real Toast covers/revenue by area, for comparison — see the Covers &amp; Spend page for the blended (non-area) version.</li>
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
                  <th scope="col">Spend per Guest</th>
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
                  <td class="derived">{{ a.seats }}</td>
                  <td class="derived">{{ a.maxTurnsPerNight }}</td>
                  <td class="derived">{{ fmtCapacity(computedCapacity(a, 'novApr')) }}</td>
                  <td class="derived">{{ fmtCapacity(computedCapacity(a, 'mayOct')) }}</td>
                  <td class="setpct-cell">
                    <template v-if="a.perCoverPinned">
                      <span class="source-tag pinned">Pinned</span>
                      <button
                        type="button"
                        class="apply-pct-btn"
                        :disabled="!autoPerCover(a.id)"
                        :title="useAutoTitle(a.id)"
                        @click="usePerCoverAuto(a)"
                      >Use automatic</button>
                      <span v-if="autoPerCoverTotal(a.id) != null" class="setpct-result">auto ≈{{ fmtMoneyOrDash(autoPerCoverTotal(a.id)) }}/guest</span>
                    </template>
                    <template v-else>
                      <span class="source-tag auto">Automatic</span>
                      <span class="setpct-result">{{ perCoverBasisLabel(a.id) ?? 'Waiting for a closed month' }}</span>
                    </template>
                  </td>
                  <td><span class="money-cell">$<input v-model="a.perCoverRevenueFood" :class="['cell-input', 'decimal', !a.perCoverPinned && 'auto-value']" inputmode="decimal" @input="pinPerCover(a)" /></span></td>
                  <td><span class="money-cell">$<input v-model="a.perCoverRevenueBeverage" :class="['cell-input', 'decimal', !a.perCoverPinned && 'auto-value']" inputmode="decimal" @input="pinPerCover(a)" /></span></td>
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

        <section v-if="areaDrafts.some(a => a.closedDows.length > 0)">
          <div class="section-head">
            <div class="section-label">Weekly Area Closures</div>
            <div class="section-note">Set in <NuxtLink to="/settings">Settings › Restaurant Setup</NuxtLink>. The covers below stay each area's pre-closure baseline; Projected Revenue applies the closure from its start date.</div>
          </div>
          <ul class="closure-list">
            <li v-for="a in areaDrafts.filter(x => x.closedDows.length > 0)" :key="a.id">
              <strong style="text-transform: capitalize;">{{ a.name }}</strong>: closed {{ a.closedDows.map(d => DOW_SHORT[d]).join(', ') }} from {{ a.closedFrom }}, {{ a.recapturePct }}% recaptured. {{ closureSummary(a) }}.
            </li>
          </ul>
        </section>

        <section>
          <div class="section-head">
            <div class="section-label">Expected Nightly Covers by Area &amp; Closures</div>
            <ul class="section-note note-list">
              <li><strong>Automatic</strong> (plain numbers): every month that hasn't started follows the forecast, updated nightly — last year's seasonal pattern, scaled to how full Cambridge St has really been since the move, split by how full each area actually runs.</li>
              <li><strong>Pinned</strong> (outlined, with ↺): a number you typed stays put. Click ↺ to send it back to automatic.</li>
              <li>The current month is frozen at what the forecast said on the 1st, so this month's actuals are judged against a fixed number. Each month's row is reused for next year once the month ends.</li>
              <li>Total, Fill %, and Per-Cover $ are derived from these baselines; Projected Revenue also applies any weekly area closure from its start date.</li>
              <li>Closed nights counts holidays (set in <NuxtLink to="/settings">Settings</NuxtLink>) plus closures, off-site and event nights on the <NuxtLink to="/budget/revenue">Sales Plan</NuxtLink>; hover for the dates. Each is worth its own expected revenue instead of a normal night. Buyouts stay normal nights here; the Sales Plan adds their extra.</li>
            </ul>
          </div>
          <div class="pl-table-card covers-table-card">
            <table class="pl-table edit-table covers-table">
              <caption>Editable monthly expected covers per area, a history-derived quick-set blended fill percentage, a total covers figure, derived fill percentage, per-cover revenue, projected revenue, and holiday closure counts</caption>
              <thead>
                <tr>
                  <th scope="col" class="sticky-col">Month</th>
                  <th scope="col">Basis</th>
                  <th v-for="a in areaDrafts" :key="a.id" scope="col" style="text-transform: capitalize;">{{ a.name }}</th>
                  <th scope="col">Total</th>
                  <th scope="col">Fill %</th>
                  <th scope="col">Per-Cover $</th>
                  <th scope="col">Closed nights</th>
                  <th scope="col">Projected Revenue</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in monthlyDrafts" :key="s.month">
                  <th scope="row" class="sticky-col">{{ MONTH_NAMES[s.month - 1] }}</th>
                  <td :class="['basis-cell', s.month === forecastCurrentMonth && 'frozen']" :title="monthBasisTitle(s)">{{ monthBasisLabel(s) }}</td>
                  <td v-for="a in areaDrafts" :key="a.id">
                    <span :class="['cover-cell', s.areaPinned[a.id] && 'pinned']">
                      <input v-model="s.areaCoversInput[a.id]" class="cell-input narrow" inputmode="numeric" :aria-label="coverAriaLabel(s, a)" @input="onCoversInput(s, a.id)" />
                      <button v-if="s.areaPinned[a.id]" type="button" class="unpin-btn" :title="pinTitle(s, a.id)" :aria-label="'Unpin ' + coverAriaLabel(s, a)" @click="unpinCovers(s, a.id)">↺</button>
                    </span>
                  </td>
                  <td class="derived">{{ monthDerived(s).totalCovers }}</td>
                  <td class="derived">{{ fmtPctWhole(monthDerived(s).fillPct) }}</td>
                  <td class="derived">${{ fmtMoney2(monthDerived(s).avgCheck) }}</td>
                  <td class="derived" :title="replacedTitle(s.month)">{{ s.holidayClosuresInput }}</td>
                  <td class="derived">{{ fmtMoneyFull(monthDerived(s).projectedMonthlyRevenue) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" class="sticky-col">Total</th>
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
          <button v-if="pinnedCount > 0" type="button" class="apply-pct-btn" title="Send every pinned covers figure back to the automatic forecast" @click="unpinAllCovers">Unpin all covers ({{ pinnedCount }})</button>
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
.tab-btn.active { color: var(--accent-text); border-bottom-color: var(--accent); }
.link-btn {
  font: inherit;
  font-weight: 600;
  color: var(--accent-text);
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
.month-tab.active { background: var(--accent-wash); color: var(--accent-text); border-color: transparent; }

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
.variance-text.v-good { color: var(--good-text); }
.variance-text.v-warning { color: var(--warning-text); }
.variance-text.v-serious { color: var(--serious-text); }
.variance-text.v-critical { color: var(--critical-text); }
.variance-text { display: inline-flex; flex-direction: column; align-items: center; font-weight: 600; }
.variance-main { white-space: nowrap; }
.variance-icon { display: inline-block; }
.variance-delta { display: block; font-weight: 500; opacity: 0.8; white-space: nowrap; font-size: 11px; }

.setpct-cell { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
.pct-cell { display: inline-flex; align-items: center; gap: 3px; }
.closure-list { margin: 0 0 14px; padding-left: 18px; font-size: 13px; color: var(--ink-2); line-height: 1.6; }
.recapture-weights { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; justify-content: center; }
.recapture-weight { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; color: var(--ink-2); }
.dow-toggles { display: inline-flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.dow-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; padding: 3px 8px; border: 1px solid var(--hair); border-radius: 999px; color: var(--ink-3); cursor: pointer; }
.dow-toggle input { accent-color: var(--accent); margin: 0; }
.dow-toggle.on { color: var(--ink); background: var(--surface-alt); border-color: var(--ink-3); }
.cell-input.date { width: 140px; }
/* Automatic vs. pinned (2026-11-11): automatic figures read as plain text that
   can still be typed over; a typed (pinned) figure gets an accent outline and a
   small ↺ badge to send it back to automatic. The outline + badge carry the
   distinction, not color alone. */
.cover-cell { position: relative; display: inline-flex; }
.cover-cell .cell-input, .cell-input.auto-value { background: transparent; border-color: transparent; color: var(--ink-2); }
.cover-cell .cell-input:hover, .cell-input.auto-value:hover { border-color: var(--hair); }
.cover-cell.pinned .cell-input { background: var(--surface); border: 1.5px solid var(--accent); color: var(--ink); font-weight: 700; }
.unpin-btn {
  position: absolute; top: -7px; right: -9px;
  width: 16px; height: 16px; padding: 0;
  font-size: 11px; line-height: 14px; font-weight: 700;
  border-radius: 999px; border: 1px solid var(--accent);
  background: var(--surface); color: var(--accent-text); cursor: pointer;
}
.unpin-btn:hover { background: var(--accent); color: white; }
.source-tag { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.source-tag.auto { background: var(--surface-alt); color: var(--ink-2); }
.source-tag.pinned { border: 1px solid var(--accent); color: var(--accent-text); }
.basis-cell { font-size: 11px; color: var(--ink-3); white-space: nowrap; }
.basis-cell.frozen { color: var(--ink-2); font-weight: 700; }
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
