<script setup lang="ts">
import site from '~/config/site.json'
import { MONTH_NAMES, YEAR, currentAsOfMonth, fridaysInMonth, monthCategoryBudget, useBudgetYear } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Labor` })

const asOfMonth = currentAsOfMonth()
const targetMonths = computed(() => Array.from({ length: 12 - asOfMonth + 1 }, (_, i) => asOfMonth + i))

// For the "model changes" summary cards: the same year-of-budget_targets fetch Budget
// Pace/Edit Budget already use, so already-closed/already-budgeted months (Jan through
// the month before this page's own Sep-Dec-style range) have a real number to draw from,
// not just this page's own forward-looking draft. loadYear() runs on mount automatically.
const { monthlyData: yearBudgetData } = useBudgetYear()

// Slider bounds for $/hr and hrs/wk — one fixed range on every hourly card rather than a
// per-role range, so nothing shifts around as different roles are edited (the user's own
// call). OT's hours slider reuses HOURS_STEP but caps lower (OT rarely approaches a full
// second workweek).
const RATE_MIN = 10, RATE_MAX = 40, RATE_STEP = 0.25
const HOURS_MIN = 0, HOURS_MAX = 60, HOURS_STEP = 1
const OT_HOURS_MAX = 30

// The real seasonal index (monthlyIndex, from /api/capacity/history) is built from a
// SINGLE prior year of real Toast covers (see that route's own comment) — no averaging
// across years to smooth out one unusual month, and today that single year is 2025,
// entirely at the old Mass Ave location, so it's really "how did the old, smaller space's
// demand ebb and flow" being borrowed to scale hours at Cambridge St. Raised directly by
// the user after the redesign: they don't expect big seasonal swings here (not a resort
// town) and were worried a noisy single-year index could overcorrect a slower month's
// staffing more than real demand warrants. Rather than trust the raw index outright, its
// effect on hours is capped to a band around 100% — loosen or remove this once more years
// of Cambridge St-specific data exist to validate the shape against.
const SEASONALITY_CAP_PCT = 15

type PayType = 'hourly' | 'salary' | 'overtime' | 'flat' | 'tax'
type GroupKey = 'boh' | 'foh' | 'management' | 'benefits' | 'tax' | 'other'
type Slot = { id: number | null, slotIndex: number, employeeName: string, hourlyRate: number, weeklyHours: number, weeklySalary: number }
type LaborAccount = {
  accountId: number, accountNumber: string | null, name: string, groupKey: GroupKey, payType: PayType,
  scalesWithSeasonality: boolean, otHours: number, otBaseGroup: 'boh' | 'foh' | null, flatAmount: number,
  taxKey: 'medicare' | 'social_security' | 'futa' | 'suta_ma' | 'pfml_ma' | null, slots: Slot[]
}
type TaxRates = { medicareRate: number, socialSecurityRate: number, futaRate: number, sutaMaRate: number, pfmlMaRate: number }
type MonthlyIndexEntry = { month: number, indexPct: number | null, years: number[] }

const GROUP_LABEL: Record<GroupKey, string> = {
  boh: 'Back of House', foh: 'Front of House', management: 'Management Salaries',
  benefits: 'Employee Benefits', tax: 'Employer Payroll Taxes', other: 'Other Labor'
}
const GROUP_ORDER: GroupKey[] = ['boh', 'foh', 'management', 'other', 'benefits', 'tax']
const TABLE_GROUPS: GroupKey[] = ['boh', 'foh']

const loading = ref(true)
const loadError = ref<string | null>(null)
const accounts = ref<LaborAccount[]>([])
const taxRates = ref<TaxRates>({ medicareRate: 0, socialSecurityRate: 0, futaRate: 0, sutaMaRate: 0, pfmlMaRate: 0 })
const otHistory = ref<{ boh: { weeklyAvg: number | null, monthsOfData: number }, foh: { weeklyAvg: number | null, monthsOfData: number } }>({
  boh: { weeklyAvg: null, monthsOfData: 0 }, foh: { weeklyAvg: null, monthsOfData: 0 }
})
const monthlyIndex = ref<MonthlyIndexEntry[]>([])
const currentMonthActuals = ref<Record<number, number>>({})
const hasCurrentMonthActuals = ref(false)

// Trailing 2-month reference data (see labor-settings.get.ts) — a single shared window
// (the 2 most recent months with any real labor activity), so "trailing Jun-Jul avg"
// means the same thing next to every account it's shown for.
const trailingWindowMonths = ref<string[]>([])
const trailingActuals = ref<Record<number, { avgMonthlyDollars: number, weeklyAvg: number | null }>>({})
const trailingTaxRates = ref<Record<string, number | null>>({ medicare: null, social_security: null, futa: null, suta_ma: null, pfml_ma: null })
const trailingWindowLabel = computed(() => {
  if (trailingWindowMonths.value.length === 0) return null
  return [...trailingWindowMonths.value].reverse().map(ym => MONTH_NAMES[Number(ym.slice(5, 7)) - 1]).join('–')
})

async function loadAll() {
  loading.value = true
  loadError.value = null
  try {
    const [settingsRes, historyRes, actualsRes] = await Promise.all([
      $fetch<{
        accounts: any[], taxRates: TaxRates | null, otHistory: typeof otHistory.value,
        trailingWindow: { months: string[] }, trailingActuals: Record<number, { avgMonthlyDollars: number, weeklyAvg: number | null }>, trailingTaxRates: Record<string, number | null>
      }>('/api/budget/labor-settings'),
      $fetch<{ monthlyIndex: MonthlyIndexEntry[] }>('/api/capacity/history').catch(() => ({ monthlyIndex: [] })),
      $fetch<{ accounts: { accountId: number, amount: number }[] }>('/api/budget/actuals-by-account', { query: { year: YEAR, month: asOfMonth } }).catch(() => ({ accounts: [] }))
    ])
    accounts.value = settingsRes.accounts.map(a => ({
      ...a,
      slots: (a.slots ?? []).map((s: any) => ({ id: s.id, slotIndex: s.slotIndex, employeeName: s.employeeName ?? '', hourlyRate: s.hourlyRate, weeklyHours: s.weeklyHours, weeklySalary: s.weeklySalary }))
    }))
    if (settingsRes.taxRates) taxRates.value = settingsRes.taxRates
    otHistory.value = settingsRes.otHistory
    trailingWindowMonths.value = settingsRes.trailingWindow?.months ?? []
    trailingActuals.value = settingsRes.trailingActuals ?? {}
    trailingTaxRates.value = settingsRes.trailingTaxRates ?? { medicare: null, social_security: null, futa: null, suta_ma: null, pfml_ma: null }
    monthlyIndex.value = historyRes.monthlyIndex ?? []
    globalScaleSeasonally.value = accounts.value.some(a => (a.payType === 'hourly' || a.payType === 'overtime') && a.scalesWithSeasonality)
    const map: Record<number, number> = {}
    for (const a of actualsRes.accounts) map[a.accountId] = a.amount
    currentMonthActuals.value = map
    hasCurrentMonthActuals.value = actualsRes.accounts.length > 0
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || err?.message || 'Failed to load labor data'
  } finally {
    loading.value = false
  }
}
onMounted(loadAll)

function accountsIn(group: GroupKey) {
  return accounts.value.filter(a => a.groupKey === group).sort((a, b) => (a.accountNumber ?? '').localeCompare(b.accountNumber ?? '', undefined, { numeric: true }))
}
function hourlyAccountsIn(group: GroupKey) {
  return accountsIn(group).filter(a => a.payType === 'hourly')
}
function overtimeAccountIn(group: GroupKey) {
  return accountsIn(group).find(a => a.payType === 'overtime')
}

// The real index, the capped-for-use version, whether capping actually kicked in, and
// which year(s) it's based on — everything the "show the math" note needs to render, in
// one place, so the page is never applying an adjustment the user can't see the reasoning
// for. capped defaults to 100 (no adjustment) when there's no real data for that month.
function seasonalityInfoFor(month: number): { raw: number | null, capped: number, years: number[], wasCapped: boolean } {
  const entry = monthlyIndex.value.find(m => m.month === month)
  const raw = entry?.indexPct ?? null
  const years = entry?.years ?? []
  if (raw === null) return { raw: null, capped: 100, years, wasCapped: false }
  const capped = Math.min(100 + SEASONALITY_CAP_PCT, Math.max(100 - SEASONALITY_CAP_PCT, raw))
  return { raw, capped, years, wasCapped: Math.round(capped) !== Math.round(raw) }
}

// This slot's effective hours for a given month, scaled by the real (capped) historical
// demand index when the parent account has seasonal scaling on — see schema.sql's
// labor_position_settings comment.
function effectiveHours(account: LaborAccount, typicalHours: number, month: number): number {
  return account.scalesWithSeasonality ? typicalHours * (seasonalityInfoFor(month).capped / 100) : typicalHours
}

// One global on/off switch rather than a per-role checkbox — added after the user said
// they expect to scale every hourly role the same way, making a per-role toggle just
// visual clutter. Still backed by each account's own scales_with_seasonality column (no
// schema change), so this just sets every hourly/overtime account's flag together;
// initialized from whatever's already true on load (the seed default is "on" for all of
// them) rather than hardcoding true, so a saved all-off state loads as off too.
const globalScaleSeasonally = ref(true)
function setGlobalSeasonality(value: boolean) {
  globalScaleSeasonally.value = value
  for (const a of accounts.value) {
    if (a.payType === 'hourly' || a.payType === 'overtime') a.scalesWithSeasonality = value
  }
}

// $/hr blended across every slot in a BOH/FOH group's hourly accounts, weighted by each
// slot's typical (pre-seasonality) hours — the base rate BOH/FOH OT is computed against.
function blendedRate(group: 'boh' | 'foh'): number {
  let weightedSum = 0
  let totalHours = 0
  for (const acc of accounts.value) {
    if (acc.groupKey !== group || acc.payType !== 'hourly') continue
    for (const s of acc.slots) {
      weightedSum += s.hourlyRate * s.weeklyHours
      totalHours += s.weeklyHours
    }
  }
  return totalHours > 0 ? weightedSum / totalHours : 0
}

// Converts the OT trailing-$/week hint into "≈ N hrs" at today's blended rate — null
// (hide the conversion, but still show the raw $/wk) when nothing's been entered for
// that group's hourly roles yet, since dividing by a $0 blended rate would otherwise
// produce a meaningless, oversized hours figure (caught while testing: it showed
// "≈1132.8 hrs" against a $1,133/wk trailing average with no rates entered yet).
function impliedOtHours(group: 'boh' | 'foh'): number | null {
  const rate = blendedRate(group)
  const weeklyAvg = otHistory.value[group].weeklyAvg
  if (rate <= 0 || weeklyAvg === null) return null
  return weeklyAvg / (1.5 * rate)
}

// A plain (unweighted) average of whatever nonzero $/hr rates have been entered across
// this one role's own people — deliberately NOT weighted by hours, unlike blendedRate()
// above: hours is exactly the thing "implied weekly hours" (below) is trying to help set,
// so weighting by an as-yet-unset/zero value would be circular. One person's own rate
// stands in trivially; two people at different rates average evenly.
function accountAvgRate(account: LaborAccount): number {
  const rates = account.slots.map(s => s.hourlyRate).filter(r => r > 0)
  return rates.length > 0 ? rates.reduce((sum, r) => sum + r, 0) / rates.length : 0
}
// Trailing real $/week (Friday-count-normalized, see labor-settings.get.ts) ÷ this role's
// own rate = implied avg hrs/wk — directly comparable to the "typical hrs/wk" field itself,
// unlike a monthly figure the user would have to convert by hand. Null until a rate is
// entered (see accountAvgRate) or if the trailing window has no real Friday span to divide
// by, same "hide the conversion rather than show a meaningless number" posture as
// impliedOtHours above.
function impliedWeeklyHours(account: LaborAccount): number | null {
  const rate = accountAvgRate(account)
  const weeklyAvg = trailingActuals.value[account.accountId]?.weeklyAvg
  if (rate <= 0 || weeklyAvg == null) return null
  return weeklyAvg / rate
}

function slotWeeklyDollars(account: LaborAccount, slot: Slot, month: number): number {
  return account.payType === 'hourly' ? slot.hourlyRate * effectiveHours(account, slot.weeklyHours, month) : 0
}
function slotMonthlyDollars(account: LaborAccount, slot: Slot, month: number): number {
  return slotWeeklyDollars(account, slot, month) * fridaysInMonth(YEAR, month)
}

function accountWeeklyDollars(account: LaborAccount, month: number): number {
  if (account.payType === 'hourly') {
    return account.slots.reduce((sum, s) => sum + slotWeeklyDollars(account, s, month), 0)
  }
  if (account.payType === 'salary') {
    return account.slots.reduce((sum, s) => sum + s.weeklySalary, 0)
  }
  if (account.payType === 'overtime' && account.otBaseGroup) {
    return 1.5 * blendedRate(account.otBaseGroup) * effectiveHours(account, account.otHours, month)
  }
  return 0
}

function wageSubjectTotal(month: number): number {
  let total = 0
  for (const acc of accounts.value) {
    if (acc.payType === 'tax' || acc.groupKey === 'benefits') continue
    total += accountMonthlyDollars(acc, month)
  }
  return total
}

function taxRateFor(key: NonNullable<LaborAccount['taxKey']>): number {
  return { medicare: taxRates.value.medicareRate, social_security: taxRates.value.socialSecurityRate, futa: taxRates.value.futaRate, suta_ma: taxRates.value.sutaMaRate, pfml_ma: taxRates.value.pfmlMaRate }[key]
}
function setTaxRate(key: NonNullable<LaborAccount['taxKey']>, pct: number) {
  const field = { medicare: 'medicareRate', social_security: 'socialSecurityRate', futa: 'futaRate', suta_ma: 'sutaMaRate', pfml_ma: 'pfmlMaRate' }[key] as keyof TaxRates
  taxRates.value[field] = Number.isFinite(pct) ? pct / 100 : 0
}

function accountMonthlyDollars(account: LaborAccount, month: number): number {
  if (account.payType === 'flat') return account.flatAmount
  if (account.payType === 'tax') return account.taxKey ? taxRateFor(account.taxKey) * wageSubjectTotal(month) : 0
  return accountWeeklyDollars(account, month) * fridaysInMonth(YEAR, month)
}

function groupMonthlyTotal(group: GroupKey, month: number): number {
  return accountsIn(group).reduce((sum, a) => sum + accountMonthlyDollars(a, month), 0)
}
// ---- Annual modeling summary (the header cards) ---------------------------------------
// This page models rates/hours/salaries going forward, not a single month in isolation —
// per the user's own framing, these cards answer "what does keeping this produce, on
// average and for the year," not just "what's September." Already-closed/already-budgeted
// months (before asOfMonth) use the real stored budget_targets figure (via yearBudgetData,
// the same fetch Budget Pace/Edit Budget use) since this page has no draft for them; the
// modeled months (asOfMonth..12) use this page's own live, unsaved inputs, so the cards
// react immediately as you edit — the whole point of calling this a modeling tool.
function modeledLaborTotal(month: number): number {
  return GROUP_ORDER.reduce((sum, g) => sum + groupMonthlyTotal(g, month), 0)
}
function yearLaborTotal(month: number): number {
  return month < asOfMonth ? (monthCategoryBudget(yearBudgetData.value[month - 1], 'labor') ?? 0) : modeledLaborTotal(month)
}
function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
}
const avgWagesPerMonth = computed(() => average(targetMonths.value.map(m => groupMonthlyTotal('boh', m) + groupMonthlyTotal('foh', m))))
const avgSalariesPerMonth = computed(() => average(targetMonths.value.map(m => groupMonthlyTotal('management', m))))
const avgLaborPerMonth = computed(() => average(targetMonths.value.map(m => modeledLaborTotal(m))))
const totalLaborForYear = computed(() => Array.from({ length: 12 }, (_, i) => yearLaborTotal(i + 1)).reduce((sum, v) => sum + v, 0))
const projectedAnnualRevenue = computed(() =>
  Array.from({ length: 12 }, (_, i) => monthCategoryBudget(yearBudgetData.value[i], 'revenue') ?? 0).reduce((sum, v) => sum + v, 0)
)
const laborPctOfRevenue = computed(() => projectedAnnualRevenue.value > 0 ? (totalLaborForYear.value / projectedAnnualRevenue.value) * 100 : null)

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

// Drives the filled portion of a slider's track (bound as the --pct custom property —
// see the .slider-cell CSS) so the blue fill actually tracks each slider's own min/max
// instead of relying on a browser default that can't be styled consistently across
// engines (Chrome/Safari have no native "filled track" pseudo-element; Firefox's
// ::-moz-range-progress needs no help, but computing this once and using it everywhere
// is simpler than maintaining two different mechanisms).
function sliderPct(value: number, min: number, max: number): string {
  if (max <= min) return '0%'
  return `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`
}

function addPerson(account: LaborAccount) {
  account.slots.push({ id: null, slotIndex: account.slots.length + 1, employeeName: '', hourlyRate: 0, weeklyHours: 0, weeklySalary: 0 })
}
function removePerson(account: LaborAccount, index: number) {
  account.slots.splice(index, 1)
  account.slots.forEach((s, i) => { s.slotIndex = i + 1 })
}

// Salaried roles are deliberately single-person (no add/remove-person UI, unlike hourly
// roles) — the user doesn't need multiple people sharing one salaried account today, and
// dropping that UI cuts visual clutter. Still backed by the same labor_position_slots
// table (a defensive single-element accessor, not a schema difference), so re-adding
// multi-person salaries later needs no migration.
function primarySlot(account: LaborAccount): Slot {
  if (account.slots.length === 0) account.slots.push({ id: null, slotIndex: 1, employeeName: '', hourlyRate: 0, weeklyHours: 0, weeklySalary: 0 })
  return account.slots[0]!
}
// Salaries are entered/displayed as an annual figure (how they're actually communicated
// and negotiated) but still stored as weekly_salary internally, matching every other
// pay_type's "weekly $, extended by Friday count" computation — converted at the edges
// via the standard 52-week-year convention, not persisted as a separate annual column.
function annualSalary(account: LaborAccount): number {
  return primarySlot(account).weeklySalary * 52
}
function setAnnualSalary(account: LaborAccount, annual: number) {
  primarySlot(account).weeklySalary = Number.isFinite(annual) ? annual / 52 : 0
}

function actualReference(accountId: number): { hasActual: boolean, amount: number } {
  return { hasActual: hasCurrentMonthActuals.value, amount: currentMonthActuals.value[accountId] ?? 0 }
}
function referenceClass(computedAmount: number, actualAmount: number): string {
  const diff = Math.abs(computedAmount - actualAmount)
  if (actualAmount === 0) return 'neutral'
  return diff / actualAmount <= 0.1 ? 'good' : 'warning'
}

const saveStatus = ref<'idle' | 'saving' | 'done' | 'error'>('idle')
const saveMessage = ref('')

async function save() {
  saveStatus.value = 'saving'
  try {
    const settingsPayload = accounts.value.map(a => ({
      accountId: a.accountId, scalesWithSeasonality: a.scalesWithSeasonality, otHours: a.otHours, flatAmount: a.flatAmount
    }))
    const slotsPayload = accounts.value
      .filter(a => a.payType === 'hourly' || a.payType === 'salary')
      .flatMap(a => a.slots.map((s, i) => ({
        accountId: a.accountId, slotIndex: i + 1, employeeName: s.employeeName || null,
        hourlyRate: s.hourlyRate, weeklyHours: s.weeklyHours, weeklySalary: s.weeklySalary
      })))

    await $fetch('/api/budget/labor-settings', { method: 'POST', body: { settings: settingsPayload, slots: slotsPayload, taxRates: taxRates.value } })

    const targets: { year: number, month: number, accountId: number, amount: number }[] = []
    for (const month of targetMonths.value) {
      for (const acc of accounts.value) {
        targets.push({ year: YEAR, month, accountId: acc.accountId, amount: Math.round(accountMonthlyDollars(acc, month) * 100) / 100 })
      }
    }
    await $fetch('/api/budget/targets', { method: 'POST', body: { targets } })

    await loadAll()
    saveMessage.value = `Saved — recomputed ${targetMonths.value.length} month(s) of budget (${MONTH_NAMES[asOfMonth - 1]}–Dec).`
    saveStatus.value = 'done'
  } catch (err: any) {
    saveStatus.value = 'error'
    saveMessage.value = err?.data?.statusMessage || err?.message || 'Save failed'
  }
}
</script>

<template>
  <div>
    <PageHeader
      page-name="Labor"
      description="Edit rates, hours, and salaries — the monthly budget is computed from payroll frequency and real seasonal demand"
    />

    <div v-if="loadError" class="drill-card">
      <span class="chip critical">Couldn't load labor data</span>
      <span class="quiet-note">{{ loadError }}</span>
    </div>
    <div v-else-if="loading" class="state-note">Loading labor data…</div>

    <template v-else>
      <div class="scope-row">
        <span class="quiet-note">Applies to <strong>{{ MONTH_NAMES[asOfMonth - 1] }}–Dec {{ YEAR }}</strong> — already-closed months stay as budgeted.</span>
        <button class="action-btn primary" :disabled="saveStatus === 'saving'" @click="save">Save</button>
      </div>
      <div v-if="saveStatus === 'done'" class="chip good">{{ saveMessage }}</div>
      <div v-if="saveStatus === 'error'" class="chip critical">{{ saveMessage }}</div>

      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-label">Avg wages / mo ({{ MONTH_NAMES[asOfMonth - 1] }}&ndash;Dec)</div>
          <div class="stat-value">{{ fmt(avgWagesPerMonth) }}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Avg salaries / mo ({{ MONTH_NAMES[asOfMonth - 1] }}&ndash;Dec)</div>
          <div class="stat-value">{{ fmt(avgSalariesPerMonth) }}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Avg labor / mo ({{ MONTH_NAMES[asOfMonth - 1] }}&ndash;Dec)</div>
          <div class="stat-value">{{ fmt(avgLaborPerMonth) }}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Total labor, {{ YEAR }}</div>
          <div class="stat-value">{{ fmt(totalLaborForYear) }}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Labor % of projected revenue</div>
          <div class="stat-value">{{ laborPctOfRevenue !== null ? laborPctOfRevenue.toFixed(1) + '%' : '—' }}</div>
        </div>
      </div>

      <div class="drill-card seasonality-panel">
        <label class="seasonal-toggle-lg">
          <input type="checkbox" :checked="globalScaleSeasonally" @change="setGlobalSeasonality(($event.target as HTMLInputElement).checked)" />
          Scale hourly wages &amp; overtime with seasonal demand
        </label>
        <div class="quiet-note small">
          <template v-if="!globalScaleSeasonally">Off — every hourly and OT role uses its typical hours flat, every month.</template>
          <template v-else-if="seasonalityInfoFor(asOfMonth).raw === null">No real historical demand data yet for {{ MONTH_NAMES[asOfMonth - 1] }} — hours stay at 100% of typical this month.</template>
          <template v-else>
            {{ MONTH_NAMES[asOfMonth - 1] }} scales to <strong>{{ Math.round(seasonalityInfoFor(asOfMonth).capped) }}%</strong> of typical hours
            (real {{ seasonalityInfoFor(asOfMonth).years.join(', ') }} covers data<template v-if="seasonalityInfoFor(asOfMonth).wasCapped">, raw index was {{ Math.round(seasonalityInfoFor(asOfMonth).raw!) }}% — capped to &plusmn;{{ SEASONALITY_CAP_PCT }}%</template>).
          </template>
        </div>
      </div>

      <template v-for="group in GROUP_ORDER" :key="group">
        <div v-if="accountsIn(group).length > 0" class="group-block">
          <div class="group-header" :class="group">{{ GROUP_LABEL[group] }}</div>

          <!-- BOH/FOH keep the dense table (sliders + multi-person rows need the room).
               Management/Other/Benefits/Taxes are short, single-input rows — a
               single-column table left a lot of wasted horizontal space and forced extra
               scrolling, so those lay out two-up in a grid instead (the user's own
               suggestion after seeing the built page). -->
          <table v-if="TABLE_GROUPS.includes(group)" class="labor-table">
            <thead>
              <tr class="col-labels">
                <td>role / person</td><td>$/hr</td><td>hrs/wk</td><td class="num">weekly</td><td class="num">this month</td>
              </tr>
            </thead>

            <tbody>
              <template v-for="acc in hourlyAccountsIn(group)" :key="acc.accountId">
                <tr class="role-row">
                  <td colspan="5"><strong>{{ acc.name }}</strong></td>
                </tr>
                <tr v-for="(slot, i) in acc.slots" :key="i" class="person-row">
                  <td><input type="text" v-model="slot.employeeName" :placeholder="`Person ${i + 1}`" class="name-input" /></td>
                  <td>
                    <div class="slider-cell">
                      <input
                        type="range" :min="RATE_MIN" :max="RATE_MAX" :step="RATE_STEP" v-model.number="slot.hourlyRate"
                        :style="{ '--pct': sliderPct(slot.hourlyRate, RATE_MIN, RATE_MAX) }"
                      />
                      <input type="number" :step="RATE_STEP" min="0" v-model.number="slot.hourlyRate" class="slider-readout" />
                    </div>
                  </td>
                  <td>
                    <div class="slider-cell">
                      <input
                        type="range" :min="HOURS_MIN" :max="HOURS_MAX" :step="HOURS_STEP" v-model.number="slot.weeklyHours"
                        :style="{ '--pct': sliderPct(slot.weeklyHours, HOURS_MIN, HOURS_MAX) }"
                      />
                      <input type="number" :step="HOURS_STEP" min="0" v-model.number="slot.weeklyHours" class="slider-readout" />
                    </div>
                  </td>
                  <td class="num muted">{{ fmt(slotWeeklyDollars(acc, slot, asOfMonth)) }}</td>
                  <td class="num">
                    <strong>{{ fmt(slotMonthlyDollars(acc, slot, asOfMonth)) }}</strong>
                    <button type="button" class="remove-slot" title="Remove person" @click="removePerson(acc, i)">×</button>
                  </td>
                </tr>
                <tr v-if="actualReference(acc.accountId).hasActual" class="note-row">
                  <td colspan="5" class="reference" :class="referenceClass(accountMonthlyDollars(acc, asOfMonth), actualReference(acc.accountId).amount)">
                    {{ referenceClass(accountMonthlyDollars(acc, asOfMonth), actualReference(acc.accountId).amount) === 'good' ? '✓ near' : '▲' }} last actual {{ fmt(actualReference(acc.accountId).amount) }}
                  </td>
                </tr>
                <tr v-if="trailingActuals[acc.accountId]?.weeklyAvg != null" class="note-row">
                  <td colspan="5" class="quiet-note small">
                    trailing {{ trailingWindowLabel }} avg: {{ fmt(trailingActuals[acc.accountId].weeklyAvg!) }}/wk<template v-if="impliedWeeklyHours(acc) !== null"> (&asymp;{{ impliedWeeklyHours(acc)!.toFixed(1) }} hrs/wk at ${{ accountAvgRate(acc).toFixed(2) }}/hr)</template><template v-else> — enter an hourly rate to see implied hours</template>
                  </td>
                </tr>
                <tr class="add-row">
                  <td colspan="5"><button type="button" class="add-person" @click="addPerson(acc)">+ Add person to {{ acc.name }}</button></td>
                </tr>
              </template>

              <template v-if="overtimeAccountIn(group)">
                <tr class="ot-row">
                  <td>
                    <strong>{{ overtimeAccountIn(group)!.name }}</strong>
                    <span class="ot-note">1.5&times; ${{ blendedRate(group as 'boh' | 'foh').toFixed(2) }}/hr blended</span>
                  </td>
                  <td class="num muted">—</td>
                  <td>
                    <div class="slider-cell">
                      <input
                        type="range" min="0" :max="OT_HOURS_MAX" :step="HOURS_STEP" v-model.number="overtimeAccountIn(group)!.otHours"
                        :style="{ '--pct': sliderPct(overtimeAccountIn(group)!.otHours, 0, OT_HOURS_MAX) }"
                      />
                      <input type="number" :step="HOURS_STEP" min="0" v-model.number="overtimeAccountIn(group)!.otHours" class="slider-readout" />
                    </div>
                  </td>
                  <td class="num muted">{{ fmt(accountWeeklyDollars(overtimeAccountIn(group)!, asOfMonth)) }}</td>
                  <td class="num"><strong>{{ fmt(accountMonthlyDollars(overtimeAccountIn(group)!, asOfMonth)) }}</strong></td>
                </tr>
                <tr v-if="otHistory[group as 'boh' | 'foh'].weeklyAvg !== null" class="note-row">
                  <td colspan="5" class="quiet-note small">
                    trailing actual ~{{ fmt(otHistory[group as 'boh' | 'foh'].weeklyAvg!) }}/wk<template v-if="impliedOtHours(group as 'boh' | 'foh') !== null"> (&asymp;{{ impliedOtHours(group as 'boh' | 'foh')!.toFixed(1) }} hrs at today's rate)</template>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div v-else-if="group === 'management'" class="simple-grid">
            <div v-for="acc in accountsIn('management')" :key="acc.accountId" class="simple-row">
              <span class="label">{{ acc.name }}</span>
              <input
                type="number" step="500" min="0" class="simple-input"
                :value="Math.round(annualSalary(acc))"
                @input="setAnnualSalary(acc, Number(($event.target as HTMLInputElement).value))"
              />
              <span class="unit">/yr</span>
              <span class="value">{{ fmt(accountMonthlyDollars(acc, asOfMonth)) }}</span>
            </div>
          </div>

          <div v-else-if="group === 'other' || group === 'benefits'" class="simple-grid">
            <div v-for="acc in accountsIn(group)" :key="acc.accountId" class="simple-row-wrap">
              <div class="simple-row">
                <span class="label">{{ acc.name }}</span>
                <input type="number" step="1" min="0" v-model.number="acc.flatAmount" class="simple-input small" />
                <span class="unit">/mo</span>
              </div>
              <div v-if="trailingActuals[acc.accountId] !== undefined" class="simple-hint">trailing {{ trailingWindowLabel }} avg: {{ fmt(trailingActuals[acc.accountId].avgMonthlyDollars) }}/mo</div>
            </div>
          </div>

          <div v-else-if="group === 'tax'" class="simple-grid">
            <div v-for="acc in accountsIn('tax')" :key="acc.accountId" class="simple-row-wrap">
              <div class="simple-row">
              <span class="label">{{ acc.name }}</span>
              <input
                type="number" step="0.01" min="0" class="simple-input tiny"
                :value="(taxRateFor(acc.taxKey!) * 100).toFixed(2)"
                @input="setTaxRate(acc.taxKey!, Number(($event.target as HTMLInputElement).value))"
              />
              <span class="unit">%</span>
              <span class="value">{{ fmt(accountMonthlyDollars(acc, asOfMonth)) }}</span>
              </div>
              <div v-if="acc.taxKey && trailingTaxRates[acc.taxKey] !== null && trailingTaxRates[acc.taxKey] !== undefined" class="simple-hint">
                trailing {{ trailingWindowLabel }} effective rate: {{ (trailingTaxRates[acc.taxKey]! * 100).toFixed(2) }}%
              </div>
            </div>
            <div class="simple-note quiet-note small">&times; {{ fmt(wageSubjectTotal(asOfMonth)) }} modeled wages ({{ MONTH_NAMES[asOfMonth - 1] }})</div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }
.drill-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px;
}
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.quiet-note.small { font-size: 11px; color: var(--ink-3); }

.scope-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 4px;
}
.action-btn {
  font-size: 13px; border: 1px solid var(--border); background: var(--surface);
  border-radius: 8px; padding: 8px 14px; color: var(--ink); cursor: pointer;
}
.action-btn.primary { background: var(--ink); color: var(--surface); border-color: var(--ink); }

.stat-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;
  margin: 14px 0 24px;
}
.stat-tile { background: var(--surface-alt); border-radius: 10px; padding: 10px 14px; }
.stat-label { font-size: 11px; color: var(--ink-3); }
.stat-value { font-size: 19px; font-weight: 500; }

/* Each group is its own card with a colored header row (the user's own request, after
   finding the earlier one-card-per-role grid "visually overwhelming") — margin-bottom on
   the card itself is the "vertical space between groupings" the user asked for, rather
   than relying on the browser's default table spacing. */
.group-block {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 14px;
  box-shadow: var(--card-shadow); overflow: hidden; margin-bottom: 26px;
}
.labor-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.labor-table .num { text-align: right; }
.labor-table .muted { color: var(--ink-3); }

/* Blended toward the surface (not a flat hex) so every group's header stays legible and
   on-brand in both light and dark mode without a separate dark-mode override block —
   same color-mix technique this app already uses elsewhere for mode-safe tints. */
.group-header {
  text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
  color: var(--ink);
}
.group-header.boh { background: color-mix(in srgb, var(--accent) 16%, var(--surface)); }
.group-header.foh { background: color-mix(in srgb, var(--good) 16%, var(--surface)); }
.group-header.management { background: color-mix(in srgb, #7c5cbf 18%, var(--surface)); }
.group-header.other { background: var(--surface-alt); }
.group-header.benefits { background: color-mix(in srgb, #c15990 16%, var(--surface)); }
.group-header.tax { background: color-mix(in srgb, var(--warning) 16%, var(--surface)); }

.col-labels td { font-size: 10px; color: var(--ink-3); padding: 8px 12px 2px; }
.role-row td { padding: 10px 12px 4px; }
.person-row td { padding: 6px 12px; border-top: 1px solid var(--hair); vertical-align: middle; }
.role-row + .person-row td { border-top: none; }
.note-row td { padding: 0 12px 8px; }
.add-row td { padding: 2px 12px 12px; }
.ot-row td { padding: 10px 12px; border-top: 1px solid var(--hair); vertical-align: middle; }

.name-input {
  font-size: 12.5px; border: 1px solid var(--hair); border-radius: 5px; padding: 4px 6px;
  background: var(--surface); color: var(--ink); width: 100%;
}
.unit { font-size: 11px; color: var(--ink-3); }

/* Two-up grid for the short, single-input rows (Management/Other/Benefits/Taxes) — moved
   off the single-column table these used to share with BOH/FOH, at the user's own
   request after seeing how much horizontal space a full-width input/table left empty for
   a row that's really just "label + one small number." auto-fit/minmax rather than a
   flat repeat(2, 1fr) so a narrow viewport still gets one column instead of squeezing. */
.simple-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0 24px; padding: 4px 12px 12px;
}
.simple-row {
  display: flex; align-items: center; gap: 6px; padding: 7px 0; border-top: 1px solid var(--hair);
}
.simple-row .label { flex: 1; font-size: 12.5px; font-weight: 500; }
.simple-row .value { font-size: 12.5px; font-weight: 700; min-width: 48px; text-align: right; }
/* Other Labor/Benefits/Taxes rows that also carry a trailing-actual hint need a second
   line — the border/padding moves to the wrapper so it reads as one bordered row, not two
   stacked ones. */
.simple-row-wrap { border-top: 1px solid var(--hair); padding: 7px 0; }
.simple-row-wrap > .simple-row { border-top: none; padding: 0; }
.simple-hint { font-size: 10.5px; color: var(--ink-3); padding-top: 3px; }
.simple-input {
  font-size: 12.5px; border: 1px solid var(--hair); border-radius: 5px; padding: 4px 6px;
  background: var(--surface); color: var(--ink); text-align: right; width: 92px;
}
.simple-input.small { width: 72px; }
.simple-input.tiny { width: 56px; }
.simple-note { grid-column: 1 / -1; padding-top: 6px; }

.slider-cell { display: flex; align-items: center; gap: 8px; min-width: 150px; }

/* Thick, rounded, blue-filled track with a large round thumb (the user's own reference
   screenshot) — native range inputs have no cross-engine "filled portion" pseudo-element,
   so the fill is a background gradient split at --pct (set per-slider from sliderPct()
   above); Firefox's own ::-moz-range-progress does this natively and just ignores the
   gradient trick, so both engines end up looking the same without duplicating the fill
   logic per browser. */
.slider-cell input[type='range'] {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--accent) var(--pct, 0%), var(--hair) var(--pct, 0%));
  outline: none;
  cursor: pointer;
}
.slider-cell input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  border: 3px solid var(--surface);
  box-shadow: 0 0 0 1px var(--accent);
  cursor: pointer;
}
.slider-cell input[type='range']::-moz-range-track {
  height: 8px;
  border-radius: 999px;
  background: var(--hair);
}
.slider-cell input[type='range']::-moz-range-progress {
  height: 8px;
  border-radius: 999px;
  background: var(--accent);
}
.slider-cell input[type='range']::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  border: 3px solid var(--surface);
  box-shadow: 0 0 0 1px var(--accent);
  cursor: pointer;
}
.slider-readout {
  width: 56px; font-size: 12px; border: 1px solid var(--hair); border-radius: 5px;
  padding: 3px 4px; background: var(--surface); color: var(--ink); text-align: right;
}

.remove-slot {
  margin-left: 8px; font-size: 14px; color: var(--ink-3); background: none; border: none; cursor: pointer;
}
.remove-slot:hover { color: var(--critical); }
.add-person { font-size: 11px; color: var(--accent); background: none; border: none; cursor: pointer; padding: 0; }

.seasonality-panel { padding: 12px 16px; margin-bottom: 22px; gap: 4px; }
.seasonal-toggle-lg { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; }
.seasonal-toggle-lg input { margin: 0; }
.ot-note { font-size: 10.5px; color: var(--ink-3); margin-left: 8px; font-weight: 400; }

.reference { font-size: 10px; }
.reference.good { color: var(--good); }
.reference.warning { color: var(--warning); }
.reference.neutral { color: var(--ink-3); }
</style>
