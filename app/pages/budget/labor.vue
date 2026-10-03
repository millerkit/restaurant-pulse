<script setup lang="ts">
import site from '~/config/site.json'
import type { Category } from '~/composables/useBudgetData'
import { MONTH_NAMES, YEAR, countFridays, currentAsOfDay, currentAsOfMonth, fridaysInMonth, hybridYearTotals, monthCategoryBudget, useActualsYear, useBudgetYear } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Labor` })

const asOfMonth = currentAsOfMonth()
const asOfDay = currentAsOfDay()
const targetMonths = computed(() => Array.from({ length: 12 - asOfMonth + 1 }, (_, i) => asOfMonth + i))

// For the "model changes" summary cards: the same year-of-budget_targets fetch Budget
// Pace/Edit Budget already use, so already-closed/already-budgeted months (Jan through
// the month before this page's own Sep-Dec-style range) have a real number to draw from,
// not just this page's own forward-looking draft. loadYear() runs on mount automatically.
const { monthlyData: yearBudgetData } = useBudgetYear()

// Real per-month labor actuals from daily_line_items — used to make "Total labor, 2026"
// (below) a true actual-YTD + modeled-remainder figure instead of budgeted-YTD +
// modeled-remainder. Independent of yearBudgetData/budget_targets above, which sometimes
// gets hand-overwritten with real numbers for a closed month (see CLAUDE.md) and so isn't
// a reliable "what actually happened" signal on its own.
const { monthlyActuals } = useActualsYear()

// Bump-step sizes for each number field's up/down arrows (see NumberStepper) — kept as
// named constants rather than inlined so $/hr, hrs/wk, and annual salary each bump by a
// sensible increment (a quarter-dollar, a whole hour, a thousand dollars) rather than a
// generic 1.
const RATE_STEP = 0.25
const HOURS_STEP = 1
const SALARY_STEP = 1000

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
type RoleClass = 'direct' | 'supervision' | 'overhead' | 'growth'
type GroupKey = 'boh' | 'foh' | 'management' | 'benefits' | 'tax' | 'other'
type Slot = { id: number | null, slotIndex: number, employeeName: string, hourlyRate: number, weeklyHours: number, weeklySalary: number }
type LaborAccount = {
  accountId: number, accountNumber: string | null, name: string, groupKey: GroupKey, payType: PayType,
  scalesWithSeasonality: boolean, otHours: number, otBaseGroup: 'boh' | 'foh' | null, flatAmount: number,
  taxKey: 'medicare' | 'social_security' | 'futa' | 'suta_ma' | 'pfml_ma' | null, isHidden: boolean, roleClass: RoleClass | null, slots: Slot[]
}
type TaxRates = { medicareRate: number, socialSecurityRate: number, futaRate: number, sutaMaRate: number, pfmlMaRate: number }
type MonthlyIndexEntry = { month: number, indexPct: number | null, years: number[] }

const GROUP_LABEL: Record<GroupKey, string> = {
  boh: 'Back of House', foh: 'Front of House', management: 'Management Salaries',
  benefits: 'Employee Benefits', tax: 'Employer Payroll Taxes', other: 'Other Labor'
}
const GROUP_ORDER: GroupKey[] = ['boh', 'foh', 'management', 'other', 'benefits', 'tax']
const TABLE_GROUPS: GroupKey[] = ['boh', 'foh']

// Role classes (schema.sql's labor_position_settings.role_class): how a role's cost behaves,
// not whether it "produces revenue" — see CLAUDE.md's "Labor role classes" section.
const ROLE_CLASS_ORDER: RoleClass[] = ['direct', 'supervision', 'overhead', 'growth']
const ROLE_CLASS_LABEL: Record<RoleClass, string> = {
  direct: 'Direct / production', supervision: 'Required supervision', overhead: 'Overhead / enabling', growth: 'Growth bets'
}
const ROLE_CLASS_HINT: Record<RoleClass, string> = {
  direct: 'scales with volume',
  supervision: 'sized to shifts & stations, not covers',
  overhead: 'fixed, no direct supervision duty',
  growth: 'fixed cost, judged by return'
}
const isWageAccount = (a: LaborAccount) => a.payType === 'hourly' || a.payType === 'salary' || a.payType === 'overtime'

const loading = ref(true)
const loadError = ref<string | null>(null)
const accounts = ref<LaborAccount[]>([])
const taxRates = ref<TaxRates>({ medicareRate: 0, socialSecurityRate: 0, futaRate: 0, sutaMaRate: 0, pfmlMaRate: 0 })
const monthlyIndex = ref<MonthlyIndexEntry[]>([])
const currentMonthActuals = ref<Record<number, number>>({})
const hasCurrentMonthActuals = ref(false)

// Declutter for unused-but-not-yet-QBO-deactivated accounts — off by default so hidden
// accounts stay out of the way; "Show N hidden" reveals them again without needing to
// re-save first.
const showHidden = ref(false)
const hiddenCount = computed(() => accounts.value.filter(a => a.isHidden).length)

// Trailing 2-month reference data (see labor-settings.get.ts) — a single shared window
// (the 2 most recent months with any real labor activity), so "trailing Jun-Jul avg"
// means the same thing next to every account it's shown for.
const trailingWindowMonths = ref<string[]>([])
const trailingActuals = ref<Record<number, { avgMonthlyDollars: number, weeklyAvg: number | null }>>({})
const trailingTaxRates = ref<Record<string, number | null>>({ medicare: null, social_security: null, futa: null, suta_ma: null, pfml_ma: null })
// First–last month only (e.g. "Jul–Sep"), not every month in between ("Jul–Aug–Sep") —
// shortened at the user's request; the window is always contiguous months, so naming the
// two ends is enough to know what's covered.
const trailingWindowLabel = computed(() => {
  if (trailingWindowMonths.value.length === 0) return null
  const names = [...trailingWindowMonths.value].reverse().map(ym => MONTH_NAMES[Number(ym.slice(5, 7)) - 1])
  return names.length > 1 ? `${names[0]}–${names[names.length - 1]}` : names[0]
})

async function loadAll() {
  loading.value = true
  loadError.value = null
  try {
    const [settingsRes, historyRes, actualsRes] = await Promise.all([
      $fetch<{
        accounts: any[], taxRates: TaxRates | null,
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
// Visibility-filtered — for rendering only. Every total/computation on this page (
// groupMonthlyTotal, wageSubjectTotal, Save's write to budget_targets, etc.) reads from
// accountsIn()/accounts.value directly and never this — hiding an account is purely a
// declutter, per schema.sql's is_hidden comment, not an exclusion from what's modeled.
function visibleAccountsIn(group: GroupKey) {
  return accountsIn(group).filter(a => showHidden.value || !a.isHidden)
}
function hourlyAccountsIn(group: GroupKey) {
  return visibleAccountsIn(group).filter(a => a.payType === 'hourly')
}
function overtimeAccountIn(group: GroupKey) {
  return visibleAccountsIn(group).find(a => a.payType === 'overtime')
}
function toggleHidden(account: LaborAccount) {
  account.isHidden = !account.isHidden
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

// Converts the OT trailing-$/week hint (from trailingActuals, keyed by the OT account's
// own id — it's a labor_position_settings-managed account like any other, so it's already
// covered by the same shared 2-month window as everything else) into "≈ N hrs" at today's
// blended rate — null (hide the conversion, but still show the raw $/wk) when nothing's
// been entered for that group's hourly roles yet, since dividing by a $0 blended rate
// would otherwise produce a meaningless, oversized hours figure (caught while testing: it
// showed "≈1132.8 hrs" against a $1,133/wk trailing average with no rates entered yet).
function impliedOtHours(group: 'boh' | 'foh'): number | null {
  const rate = blendedRate(group)
  const otAccount = overtimeAccountIn(group)
  const weeklyAvg = otAccount ? trailingActuals.value[otAccount.accountId]?.weeklyAvg : undefined
  if (rate <= 0 || weeklyAvg == null) return null
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
// Total scaled hrs/wk across every person on an hourly role, for the role's totals row —
// each slot's own effectiveHours (seasonality-scaled), summed, not the raw typical hours.
function accountEffectiveHours(account: LaborAccount, month: number): number {
  return account.slots.reduce((sum, s) => sum + effectiveHours(account, s.weeklyHours, month), 0)
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
// Medicare/Social Security are flat federal statutory employer rates (1.45%/6.2%) — they
// never vary by employer, state, or experience, unlike FUTA/SUTA MA/PFML MA. Rendered
// read-only rather than editable so they can't drift away from the true rate again
// (production's copies of these two had been edited to 2.12%/9.03% at some point,
// matching the trailing-effective-rate hint almost exactly — likely mistaken for a
// number to copy in, rather than a fixed constant).
function isFixedRateTax(key: LaborAccount['taxKey']): boolean {
  return key === 'medicare' || key === 'social_security'
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
// For a closed month, prefer the real actual (daily_line_items, via monthlyActuals) over
// the budgeted figure — the whole point of this card is "what did labor really cost this
// year," not "what was planned." Falls back to the budgeted amount only if that month
// genuinely has no synced actuals yet (hasData false — e.g. before this year's QBO
// backfill reached that far back), so a month with no real data still contributes
// something rather than silently reading as $0.
function yearLaborTotal(month: number): number {
  if (month < asOfMonth) {
    const actual = monthlyActuals.value[month - 1]
    if (actual?.hasData) return actual.totals.labor
    return monthCategoryBudget(yearBudgetData.value[month - 1], 'labor') ?? 0
  }
  return modeledLaborTotal(month)
}
// Whether every closed month behind this card's total came from a real actual, some from
// a budgeted fallback, or (before Jan) none at all — drives the small note under the
// "Total labor" stat tile so the figure's real composition isn't left implicit.
const yearLaborActualCoverage = computed<'all' | 'partial' | 'none'>(() => {
  const closedMonths = asOfMonth > 1 ? Array.from({ length: asOfMonth - 1 }, (_, i) => i + 1) : []
  if (closedMonths.length === 0) return 'none'
  const withActuals = closedMonths.filter(m => monthlyActuals.value[m - 1]?.hasData).length
  if (withActuals === closedMonths.length) return 'all'
  if (withActuals === 0) return 'none'
  return 'partial'
})
function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
}
const avgWagesPerMonth = computed(() => average(targetMonths.value.map(m => groupMonthlyTotal('boh', m) + groupMonthlyTotal('foh', m))))
const avgSalariesPerMonth = computed(() => average(targetMonths.value.map(m => groupMonthlyTotal('management', m))))
const avgLaborPerMonth = computed(() => average(targetMonths.value.map(m => modeledLaborTotal(m))))
const totalLaborForYear = computed(() => Array.from({ length: 12 }, (_, i) => yearLaborTotal(i + 1)).reduce((sum, v) => sum + v, 0))
// Real bug fixed 2026-09-22: this used to sum ONLY budget_targets for revenue
// (monthCategoryBudget(...) ?? 0), silently treating any unbudgeted month as $0 revenue
// instead of falling back to its real actual — exactly the gap the Revenue tab's own
// Total column already closed for revenue itself (see "Only N of 12 months budgeted..."
// note there). With several months genuinely unbudgeted, that understated the
// denominator badly and inflated both labor % figures below into the 70s% (they should
// read closer to this restaurant's real ~30-40% range). Now uses the same
// actual-where-elapsed, budget-otherwise hybrid every other page on this app already
// uses (hybridYearTotals, also behind Budget Pace's own category totals).
function getMonthCategoryBudgetLive(month: number, cat: Category): number | null {
  return monthCategoryBudget(yearBudgetData.value[month - 1], cat)
}
const projectedAnnualRevenue = computed(() => hybridYearTotals(getMonthCategoryBudgetLive, monthlyActuals.value, asOfMonth).revenue)
const laborPctOfRevenue = computed(() => projectedAnnualRevenue.value > 0 ? (totalLaborForYear.value / projectedAnnualRevenue.value) * 100 : null)

// ---- Labor by role class (the summary card under the modeled row) ---------------------
// Splits modeled labor $ by each wage account's role_class tag. Payroll taxes are allocated
// to each class pro rata by its share of wage-subject pay (they're computed as a flat % of
// that same wage-subject total, so this is exact, not an approximation); the share of taxes
// attributable to flat 'Additional Pay' — plus Employee Benefits and Additional Pay itself —
// has no role to belong to, so it stays in its own "Benefits & other" row rather than being
// smeared across classes. Reads live, unsaved inputs like every other modeled figure here.
type ClassKey = RoleClass | 'unclassified' | 'other'
type ClassRow = { key: ClassKey, label: string, hint: string, monthly: number, shareOfLabor: number | null, pctOfRevenue: number | null, roles: string[] }

const roleClassRows = computed<ClassRow[]>(() => {
  const months = targetMonths.value
  const sums: Record<ClassKey, number> = { direct: 0, supervision: 0, overhead: 0, growth: 0, unclassified: 0, other: 0 }
  const revMonths = months.filter(m => (getMonthCategoryBudgetLive(m, 'revenue') ?? 0) > 0)
  const revSums: Record<ClassKey, number> = { direct: 0, supervision: 0, overhead: 0, growth: 0, unclassified: 0, other: 0 }
  let revenue = 0
  for (const m of months) {
    const taxTotal = accountsIn('tax').reduce((sum, a) => sum + accountMonthlyDollars(a, m), 0)
    const subject = wageSubjectTotal(m)
    const perClass: Record<ClassKey, number> = { direct: 0, supervision: 0, overhead: 0, growth: 0, unclassified: 0, other: 0 }
    for (const a of accounts.value) {
      if (!isWageAccount(a)) continue
      const wages = accountMonthlyDollars(a, m)
      const taxShare = subject > 0 ? taxTotal * wages / subject : 0
      perClass[a.roleClass ?? 'unclassified'] += wages + taxShare
    }
    const classified = (Object.keys(perClass) as ClassKey[]).reduce((sum, k) => sum + perClass[k], 0)
    perClass.other = modeledLaborTotal(m) - classified
    const hasRevenue = revMonths.includes(m)
    if (hasRevenue) revenue += getMonthCategoryBudgetLive(m, 'revenue')!
    for (const k of Object.keys(perClass) as ClassKey[]) {
      sums[k] += perClass[k]
      if (hasRevenue) revSums[k] += perClass[k]
    }
  }
  const totalLabor = (Object.keys(sums) as ClassKey[]).reduce((sum, k) => sum + sums[k], 0)
  const rowFor = (key: ClassKey, label: string, hint: string): ClassRow => ({
    key, label, hint,
    monthly: months.length > 0 ? sums[key] / months.length : 0,
    shareOfLabor: totalLabor > 0 ? sums[key] / totalLabor : null,
    pctOfRevenue: revenue > 0 ? (revSums[key] / revenue) * 100 : null,
    roles: key in ROLE_CLASS_LABEL ? accounts.value.filter(a => isWageAccount(a) && a.roleClass === key && !a.isHidden && a.payType !== 'overtime').map(a => a.name) : []
  })
  const rows: ClassRow[] = ROLE_CLASS_ORDER.map(k => rowFor(k, ROLE_CLASS_LABEL[k], ROLE_CLASS_HINT[k]))
  if (sums.unclassified > 0.5) rows.push(rowFor('unclassified', 'Unclassified', 'wage roles with no class tag yet'))
  rows.push(rowFor('other', 'Benefits & other', 'employee benefits, additional pay, and the taxes on it'))
  return rows
})
const roleClassRevenueMonths = computed(() => targetMonths.value.filter(m => (getMonthCategoryBudgetLive(m, 'revenue') ?? 0) > 0).length)
const roleClassTotalMonthly = computed(() => roleClassRows.value.reduce((sum, r) => sum + r.monthly, 0))
// The "fixed layer" (supervision + overhead + growth) vs. the direct layer, as the one
// headline number the split is meant to surface — fixed-cost labor that doesn't flex with covers.
const roleClassFixedLayerPct = computed(() => {
  const fixed = roleClassRows.value.filter(r => r.key === 'supervision' || r.key === 'overhead' || r.key === 'growth')
  const pcts = fixed.map(r => r.pctOfRevenue)
  return pcts.every(p => p !== null) ? pcts.reduce((sum, p) => sum + p!, 0) : null
})
const laborPctOfRevenueForClassMonths = computed(() => {
  const pcts = roleClassRows.value.map(r => r.pctOfRevenue)
  return pcts.every(p => p !== null) ? pcts.reduce((sum, p) => sum + p!, 0).toFixed(1) + '%' : '—'
})

// ---- Trailing-actual comparison row (rendered above the modeled summary cards) --------
// A second, independently-sourced answer to the same 5 questions, built entirely from
// real trailing actuals rather than this page's own live model — a sanity check for
// "does my model roughly match recent reality," without leaving the page. Reuses the same
// per-account trailingActuals already fetched for the per-role "trailing avg" hints (a
// 3-month window — see trailingWindowMonths() in labor-settings.get.ts), so no extra
// fetch is needed here.
function trailingGroupAvgPerMonth(groups: GroupKey[]): number {
  return groups.reduce((sum, g) => sum + accountsIn(g).reduce((s, a) => s + (trailingActuals.value[a.accountId]?.avgMonthlyDollars ?? 0), 0), 0)
}
const trailingWagesPerMonth = computed(() => trailingGroupAvgPerMonth(['boh', 'foh']))
const trailingSalariesPerMonth = computed(() => trailingGroupAvgPerMonth(['management']))
const trailingLaborPerMonth = computed(() => trailingGroupAvgPerMonth(GROUP_ORDER))

// Real YTD actual (same actual-preferring logic as yearLaborTotal, but stopping before
// asOfMonth — the current month's own actual is still partial, not a fair thing to add to
// a "so far" total) plus a projection for the remaining months (asOfMonth..Dec) at the
// trailing 3-month rate — a second, trend-based projection independent of this page's own
// live model, for comparison against totalLaborForYear/laborPctOfRevenue above.
const ytdActualLaborTotal = computed(() => {
  let sum = 0
  for (let m = 1; m < asOfMonth; m++) {
    const actual = monthlyActuals.value[m - 1]
    sum += actual?.hasData ? actual.totals.labor : (monthCategoryBudget(yearBudgetData.value[m - 1], 'labor') ?? 0)
  }
  return sum
})
const projectedTotalLaborForYear = computed(() => ytdActualLaborTotal.value + targetMonths.value.length * trailingLaborPerMonth.value)
const projectedLaborPctOfRevenue = computed(() => projectedAnnualRevenue.value > 0 ? (projectedTotalLaborForYear.value / projectedAnnualRevenue.value) * 100 : null)

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
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

// Fraction of this month's payroll cycles that have happened so far — mirrors Edit
// Budget's own labor projection (laborPayrollBasis there), which prorates by Friday
// count rather than elapsed calendar days since payroll posts as a weekly lump, not
// smoothly across the month.
const monthExpectedToDateFraction = computed(() => {
  const totalFridays = fridaysInMonth(YEAR, asOfMonth)
  if (totalFridays === 0) return 1
  const monthStart = new Date(YEAR, asOfMonth - 1, 1)
  // Through yesterday, not today: the nightly sync only reaches yesterday, so today's
  // payroll (e.g. a Friday lump) isn't in the actuals yet — counting it as "already
  // happened" would subtract a cycle from the projection that the actuals can't offset.
  const lastSynced = new Date(YEAR, asOfMonth - 1, asOfDay - 1)
  return countFridays(monthStart, lastSynced) / totalFridays
})
// Prorated "should be by now" figure for this role's full-month computed total — added
// after the user flagged that comparing a month-to-date actual against a full-month
// projection always reads as "behind," even with perfectly accurate rates, until the
// month is nearly over.
function expectedToDate(account: LaborAccount): number {
  return accountMonthlyDollars(account, asOfMonth) * monthExpectedToDateFraction.value
}
// "Projected this month" — real actual-to-date plus the modeled remainder of the month
// (whatever Fridays haven't happened yet), rather than a pure hypothetical full-month
// model with no grounding in what's already actually happened. Same actual +
// modeled-remainder shape as the year-level "Projected total labor" card above, just at
// month grain (accountMonthlyDollars − expectedToDate is exactly the modeled remainder,
// since expectedToDate is the modeled total's own to-date share). Falls back to the plain
// modeled full-month figure when there's no synced current-month actual yet — nothing
// real exists to blend in.
function projectedMonthDollars(account: LaborAccount): number {
  const actual = actualReference(account.accountId)
  const modeled = accountMonthlyDollars(account, asOfMonth)
  return actual.hasActual ? actual.amount + (modeled - expectedToDate(account)) : modeled
}
// Trend indicator next to each "trailing" hint: how the modeled figure compares to the
// trailing reference. More than 5% above → red ▲ N%; more than 5% below → green ▼ N%;
// within ±5% → green ✓. Direction is carried by the glyph (not just color) since
// red/green alone isn't readable for everyone. Empty when there's nothing to compare against.
const TREND_BAND = 0.05
function trendRatio(modeled: number, trailing: number): number | null {
  return trailing > 0 ? (modeled - trailing) / trailing : null
}
function trendClass(modeled: number, trailing: number): string {
  const r = trendRatio(modeled, trailing)
  if (r === null) return ''
  return r > TREND_BAND ? 'over' : 'ok'
}
function trendText(modeled: number, trailing: number): string {
  const r = trendRatio(modeled, trailing)
  if (r === null) return ''
  const pct = Math.round(Math.abs(r) * 100)
  return r > TREND_BAND ? `▲ ${pct}%` : r < -TREND_BAND ? `▼ ${pct}%` : '✓'
}
// The month's real trailing-3-month weekly average, projected out across this month's own
// Fridays — a second, trend-based reference for "projected this month" (the bold figure)
// to be checked against, replacing the old to-date actual-vs-expected pacing comparison
// with a full-month, trend-based one (consistent with the weekly column's own comparison,
// and with the year-level "Projected total labor" card's same trailing-average logic).
function trailingProjectedMonthDollars(accountId: number): number | null {
  const weeklyAvg = trailingActuals.value[accountId]?.weeklyAvg
  return weeklyAvg != null ? weeklyAvg * fridaysInMonth(YEAR, asOfMonth) : null
}

const saveStatus = ref<'idle' | 'saving' | 'done' | 'error'>('idle')
const saveMessage = ref('')

async function save() {
  saveStatus.value = 'saving'
  try {
    const settingsPayload = accounts.value.map(a => ({
      accountId: a.accountId, scalesWithSeasonality: a.scalesWithSeasonality, otHours: a.otHours, flatAmount: a.flatAmount, isHidden: a.isHidden, roleClass: isWageAccount(a) ? a.roleClass : null
    }))
    const slotAccounts = accounts.value.filter(a => a.payType === 'hourly' || a.payType === 'salary')
    const slotAccountIds = slotAccounts.map(a => a.accountId)
    const slotsPayload = slotAccounts
      .flatMap(a => a.slots.map((s, i) => ({
        accountId: a.accountId, slotIndex: i + 1, employeeName: s.employeeName || null,
        hourlyRate: s.hourlyRate, weeklyHours: s.weeklyHours, weeklySalary: s.weeklySalary
      })))

    await $fetch('/api/budget/labor-settings', { method: 'POST', body: { settings: settingsPayload, slots: slotsPayload, slotAccountIds, taxRates: taxRates.value } })

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

      <!-- Trailing-actual comparison row: a second, real-data-only answer to the same 5
           questions the modeled row below asks, for an at-a-glance "does my model roughly
           match recent reality" check. Visually distinguished with its own tint (see
           .stat-tile.trailing) so it doesn't get mistaken for more modeled figures. -->
      <div class="stat-row-heading trailing">Recent Actuals &amp; Trend Projection</div>
      <div class="stat-grid comparison-row">
        <div class="stat-tile trailing">
          <div class="stat-label">Trailing 3-mo avg wages / mo<template v-if="trailingWindowLabel"> ({{ trailingWindowLabel }})</template></div>
          <div class="stat-value">{{ fmt(trailingWagesPerMonth) }}</div>
        </div>
        <div class="stat-tile trailing">
          <div class="stat-label">Trailing 3-mo avg salaries / mo<template v-if="trailingWindowLabel"> ({{ trailingWindowLabel }})</template></div>
          <div class="stat-value">{{ fmt(trailingSalariesPerMonth) }}</div>
        </div>
        <div class="stat-tile trailing">
          <div class="stat-label">Trailing 3-mo avg labor / mo<template v-if="trailingWindowLabel"> ({{ trailingWindowLabel }})</template></div>
          <div class="stat-value">{{ fmt(trailingLaborPerMonth) }}</div>
        </div>
        <div class="stat-tile trailing">
          <div class="stat-label">Projected total labor, {{ YEAR }}</div>
          <div class="stat-value">{{ fmt(projectedTotalLaborForYear) }}</div>
          <div class="stat-subnote">actual/budgeted YTD + trailing avg &times; {{ targetMonths.length }} mo ({{ MONTH_NAMES[asOfMonth - 1] }}&ndash;Dec)</div>
        </div>
        <div class="stat-tile trailing">
          <div class="stat-label">Projected labor % of revenue</div>
          <div class="stat-value">{{ projectedLaborPctOfRevenue !== null ? projectedLaborPctOfRevenue.toFixed(1) + '%' : '—' }}</div>
        </div>
      </div>

      <div class="stat-row-heading modeled">Modeled Budget &mdash; Going Forward</div>
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
          <div class="stat-subnote">
            <template v-if="yearLaborActualCoverage === 'all'">actual Jan&ndash;{{ MONTH_NAMES[asOfMonth - 2] }} + modeled {{ MONTH_NAMES[asOfMonth - 1] }}&ndash;Dec</template>
            <template v-else-if="yearLaborActualCoverage === 'partial'">actual where synced, budgeted elsewhere, through {{ MONTH_NAMES[asOfMonth - 2] }} + modeled {{ MONTH_NAMES[asOfMonth - 1] }}&ndash;Dec</template>
            <template v-else-if="asOfMonth > 1">budgeted Jan&ndash;{{ MONTH_NAMES[asOfMonth - 2] }} (no synced actuals yet) + modeled {{ MONTH_NAMES[asOfMonth - 1] }}&ndash;Dec</template>
            <template v-else>modeled Jan&ndash;Dec</template>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Labor % of projected revenue</div>
          <div class="stat-value">{{ laborPctOfRevenue !== null ? laborPctOfRevenue.toFixed(1) + '%' : '—' }}</div>
        </div>
      </div>

      <div class="drill-card class-card">
        <div class="class-card-head">
          <div class="stat-row-heading class">Labor by Role Class &mdash; Going Forward</div>
          <div v-if="roleClassFixedLayerPct !== null" class="class-headline">
            Fixed layer (supervision + overhead + growth): <strong>{{ roleClassFixedLayerPct.toFixed(1) }}%</strong> of revenue
          </div>
        </div>
        <table class="class-table">
          <thead>
            <tr><td>class</td><td class="num">$ / mo</td><td class="num">% of labor</td><td class="num">% of revenue</td><td class="bar-col"></td></tr>
          </thead>
          <tbody>
            <tr v-for="row in roleClassRows" :key="row.key" :class="{ 'class-other': row.key === 'other' || row.key === 'unclassified' }">
              <td>
                <strong>{{ row.label }}</strong>
                <div class="class-sub">{{ row.hint }}<template v-if="row.roles.length > 0"> &middot; {{ row.roles.join(', ') }}</template></div>
              </td>
              <td class="num">{{ fmt(row.monthly) }}</td>
              <td class="num">{{ row.shareOfLabor !== null ? (row.shareOfLabor * 100).toFixed(0) + '%' : '—' }}</td>
              <td class="num">{{ row.pctOfRevenue !== null ? row.pctOfRevenue.toFixed(1) + '%' : '—' }}</td>
              <td class="bar-col"><div class="share-track"><div class="share-fill" :style="{ width: ((row.shareOfLabor ?? 0) * 100) + '%' }"></div></div></td>
            </tr>
            <tr class="class-total">
              <td>Total labor</td>
              <td class="num">{{ fmt(roleClassTotalMonthly) }}</td>
              <td class="num">100%</td>
              <td class="num">{{ laborPctOfRevenueForClassMonths }}</td>
              <td class="bar-col"></td>
            </tr>
          </tbody>
        </table>
        <div class="quiet-note small">
          Average per month, {{ MONTH_NAMES[asOfMonth - 1] }}&ndash;Dec, from the modeled inputs below (including unsaved edits). Payroll taxes are spread across classes in proportion to wages.
          % of revenue uses budgeted revenue for {{ roleClassRevenueMonths }} of {{ targetMonths.length }} months. Set each role's class with the selector on its row.
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

      <div v-if="hiddenCount > 0" class="hidden-toggle-row">
        <button type="button" class="add-person" @click="showHidden = !showHidden">
          {{ showHidden ? 'Hide' : 'Show' }} {{ hiddenCount }} hidden account{{ hiddenCount === 1 ? '' : 's' }}
        </button>
      </div>

      <template v-for="group in GROUP_ORDER" :key="group">
        <div v-if="visibleAccountsIn(group).length > 0" class="group-block">
          <div class="group-header" :class="group">{{ GROUP_LABEL[group] }}</div>

          <!-- BOH/FOH keep the dense table (sliders + multi-person rows need the room).
               Management/Other/Benefits/Taxes are short, single-input rows — a
               single-column table left a lot of wasted horizontal space and forced extra
               scrolling, so those lay out two-up in a grid instead (the user's own
               suggestion after seeing the built page). -->
          <table v-if="TABLE_GROUPS.includes(group)" class="labor-table">
            <thead>
              <tr class="col-labels">
                <td>role / person</td><td class="num num-inset">$/hr</td><td class="num num-inset">hrs/wk</td><td class="num">weekly</td><td class="num">projected this month</td><td class="trend-col"></td><td class="actions-col"></td>
              </tr>
            </thead>

            <tbody>
              <template v-for="acc in hourlyAccountsIn(group)" :key="acc.accountId">
                <tr class="role-row" :class="{ 'is-hidden-row': acc.isHidden }">
                  <td colspan="4"><strong>{{ acc.name }}</strong><span v-if="acc.isHidden" class="hidden-tag">hidden</span>
                    <select v-model="acc.roleClass" class="class-select" title="Role class — how this role's cost behaves">
                      <option :value="null">Unclassified</option>
                      <option v-for="rc in ROLE_CLASS_ORDER" :key="rc" :value="rc">{{ ROLE_CLASS_LABEL[rc] }}</option>
                    </select></td>
                  <td></td>
                  <td></td>
                  <td class="actions-col"><button type="button" class="hide-toggle" @click="toggleHidden(acc)">{{ acc.isHidden ? 'Unhide' : 'Hide' }}</button></td>
                </tr>
                <tr v-for="(slot, i) in acc.slots" :key="i" class="person-row">
                  <td><input type="text" v-model="slot.employeeName" :placeholder="`Person ${i + 1}`" class="name-input" /></td>
                  <td class="num">
                    <NumberStepper v-model="slot.hourlyRate" :step="RATE_STEP" :min="0" :decimals="2" width="72px" />
                  </td>
                  <td class="num">
                    <NumberStepper v-model="slot.weeklyHours" :step="HOURS_STEP" :min="0" width="64px" />
                    <div v-if="acc.slots.length === 1 && impliedWeeklyHours(acc) !== null" class="cell-hint">
                      &asymp;{{ impliedWeeklyHours(acc)!.toFixed(1) }} hrs/wk trailing
                    </div>
                  </td>
                  <td class="num muted">
                    <span>{{ fmt(slotWeeklyDollars(acc, slot, asOfMonth)) }}</span>
                    <div v-if="acc.slots.length === 1 && trailingActuals[acc.accountId]?.weeklyAvg != null" class="cell-hint">trailing {{ trailingWindowLabel }}: {{ fmt(trailingActuals[acc.accountId].weeklyAvg!) }}/wk</div>
                  </td>
                  <td class="num">
                    <strong class="trend-num" :class="acc.slots.length === 1 ? trendClass(projectedMonthDollars(acc), trailingProjectedMonthDollars(acc.accountId)!) : ''">{{ fmt(acc.slots.length === 1 ? projectedMonthDollars(acc) : slotMonthlyDollars(acc, slot, asOfMonth)) }}</strong>
                    <div v-if="acc.slots.length === 1 && trailingProjectedMonthDollars(acc.accountId) != null" class="cell-hint">{{ fmt(trailingProjectedMonthDollars(acc.accountId)!) }} projected from {{ trailingWindowLabel }} average</div>
                  </td>
                  <td class="trend-col"><span v-if="acc.slots.length === 1 && trailingProjectedMonthDollars(acc.accountId) != null" class="trend" :class="trendClass(projectedMonthDollars(acc), trailingProjectedMonthDollars(acc.accountId)!)">{{ trendText(projectedMonthDollars(acc), trailingProjectedMonthDollars(acc.accountId)!) }}</span></td>
                  <td class="actions-col"><button type="button" class="remove-slot" title="Remove person" @click="removePerson(acc, i)">×</button></td>
                </tr>
                <tr v-if="acc.slots.length > 1" class="total-row">
                  <td>Total</td>
                  <td class="num muted num-inset">—</td>
                  <td class="num num-inset">
                    {{ accountEffectiveHours(acc, asOfMonth).toFixed(1) }}
                    <div v-if="impliedWeeklyHours(acc) !== null" class="cell-hint">
                      &asymp;{{ impliedWeeklyHours(acc)!.toFixed(1) }} hrs/wk trailing
                    </div>
                  </td>
                  <td class="num muted">
                    <span>{{ fmt(accountWeeklyDollars(acc, asOfMonth)) }}</span>
                    <div v-if="trailingActuals[acc.accountId]?.weeklyAvg != null" class="cell-hint">trailing {{ trailingWindowLabel }}: {{ fmt(trailingActuals[acc.accountId].weeklyAvg!) }}/wk</div>
                  </td>
                  <td class="num">
                    <strong class="trend-num" :class="trendClass(projectedMonthDollars(acc), trailingProjectedMonthDollars(acc.accountId)!)">{{ fmt(projectedMonthDollars(acc)) }}</strong>
                    <div v-if="trailingProjectedMonthDollars(acc.accountId) != null" class="cell-hint">{{ fmt(trailingProjectedMonthDollars(acc.accountId)!) }} projected from {{ trailingWindowLabel }} average</div>
                  </td>
                  <td class="trend-col"><span v-if="trailingProjectedMonthDollars(acc.accountId) != null" class="trend" :class="trendClass(projectedMonthDollars(acc), trailingProjectedMonthDollars(acc.accountId)!)">{{ trendText(projectedMonthDollars(acc), trailingProjectedMonthDollars(acc.accountId)!) }}</span></td>
                  <td class="actions-col"></td>
                </tr>
                <tr class="add-row">
                  <td colspan="7"><button type="button" class="add-person" @click="addPerson(acc)">+ Add person to {{ acc.name }}</button></td>
                </tr>
              </template>

              <template v-if="overtimeAccountIn(group)">
                <tr class="ot-row">
                  <td>
                    <strong>{{ overtimeAccountIn(group)!.name }}</strong>
                    <span class="ot-note">1.5&times; ${{ blendedRate(group as 'boh' | 'foh').toFixed(2) }}/hr blended</span>
                    <select v-model="overtimeAccountIn(group)!.roleClass" class="class-select" title="Role class — how this role's cost behaves">
                      <option :value="null">Unclassified</option>
                      <option v-for="rc in ROLE_CLASS_ORDER" :key="rc" :value="rc">{{ ROLE_CLASS_LABEL[rc] }}</option>
                    </select>
                  </td>
                  <td class="num muted num-inset">—</td>
                  <td class="num">
                    <NumberStepper v-model="overtimeAccountIn(group)!.otHours" :step="HOURS_STEP" :min="0" width="64px" />
                    <div v-if="impliedOtHours(group as 'boh' | 'foh') !== null" class="cell-hint">
                      &asymp;{{ impliedOtHours(group as 'boh' | 'foh')!.toFixed(1) }} hrs trailing
                    </div>
                  </td>
                  <td class="num muted">
                    <span>{{ fmt(accountWeeklyDollars(overtimeAccountIn(group)!, asOfMonth)) }}</span>
                    <div v-if="trailingActuals[overtimeAccountIn(group)!.accountId]?.weeklyAvg != null" class="cell-hint">trailing {{ trailingWindowLabel }}: {{ fmt(trailingActuals[overtimeAccountIn(group)!.accountId].weeklyAvg!) }}/wk</div>
                  </td>
                  <td class="num">
                    <strong class="trend-num" :class="trendClass(projectedMonthDollars(overtimeAccountIn(group)!), trailingProjectedMonthDollars(overtimeAccountIn(group)!.accountId)!)">{{ fmt(projectedMonthDollars(overtimeAccountIn(group)!)) }}</strong>
                    <div v-if="trailingProjectedMonthDollars(overtimeAccountIn(group)!.accountId) != null" class="cell-hint">{{ fmt(trailingProjectedMonthDollars(overtimeAccountIn(group)!.accountId)!) }} projected from {{ trailingWindowLabel }} average</div>
                  </td>
                  <td class="trend-col"><span v-if="trailingProjectedMonthDollars(overtimeAccountIn(group)!.accountId) != null" class="trend" :class="trendClass(projectedMonthDollars(overtimeAccountIn(group)!), trailingProjectedMonthDollars(overtimeAccountIn(group)!.accountId)!)">{{ trendText(projectedMonthDollars(overtimeAccountIn(group)!), trailingProjectedMonthDollars(overtimeAccountIn(group)!.accountId)!) }}</span></td>
                  <td class="actions-col"></td>
                </tr>
              </template>
            </tbody>
          </table>
          <table v-else-if="group === 'management'" class="labor-table">
            <thead>
              <tr class="col-labels">
                <td>role</td><td>class</td><td class="num">salary $/yr</td><td class="num">this month</td><td class="actions-col"></td>
              </tr>
            </thead>
            <tbody>
              <tr v-for="acc in visibleAccountsIn('management')" :key="acc.accountId" class="person-row" :class="{ 'is-hidden-row': acc.isHidden }">
                <td><strong>{{ acc.name }}</strong><span v-if="acc.isHidden" class="hidden-tag">hidden</span></td>
                <td>
                  <select v-model="acc.roleClass" class="class-select" title="Role class — how this role's cost behaves">
                    <option :value="null">Unclassified</option>
                    <option v-for="rc in ROLE_CLASS_ORDER" :key="rc" :value="rc">{{ ROLE_CLASS_LABEL[rc] }}</option>
                  </select>
                </td>
                <td class="num">
                  <NumberStepper
                    :model-value="Math.round(annualSalary(acc))"
                    @update:model-value="v => setAnnualSalary(acc, v)"
                    :step="SALARY_STEP" :min="0" width="96px"
                  />
                </td>
                <td class="num">
                  <strong>{{ fmt(accountMonthlyDollars(acc, asOfMonth)) }}</strong>
                </td>
                <td class="actions-col"><button type="button" class="hide-toggle" @click="toggleHidden(acc)">{{ acc.isHidden ? 'Unhide' : 'Hide' }}</button></td>
              </tr>
            </tbody>
          </table>

          <div v-else-if="group === 'other' || group === 'benefits'" class="simple-grid">
            <div v-for="acc in visibleAccountsIn(group)" :key="acc.accountId" class="simple-row-wrap" :class="{ 'is-hidden-row': acc.isHidden }">
              <div class="simple-row">
                <span class="label">{{ acc.name }}<span v-if="acc.isHidden" class="hidden-tag">hidden</span></span>
                <NumberStepper v-model="acc.flatAmount" :step="1" :min="0" width="80px" />
                <span class="unit">/mo</span>
                <button type="button" class="hide-toggle" @click="toggleHidden(acc)">{{ acc.isHidden ? 'Unhide' : 'Hide' }}</button>
              </div>
              <div v-if="trailingActuals[acc.accountId] !== undefined" class="simple-hint">trailing {{ trailingWindowLabel }} avg: {{ fmt(trailingActuals[acc.accountId].avgMonthlyDollars) }}/mo</div>
            </div>
          </div>

          <div v-else-if="group === 'tax'" class="simple-grid">
            <div v-for="acc in accountsIn('tax')" :key="acc.accountId" class="simple-row-wrap">
              <div class="simple-row">
              <span class="label">{{ acc.name }}</span>
              <template v-if="isFixedRateTax(acc.taxKey)">
                <span class="fixed-rate" title="Set by federal law — not editable">{{ (taxRateFor(acc.taxKey!) * 100).toFixed(2) }}%</span>
              </template>
              <template v-else>
                <NumberStepper
                  :model-value="taxRateFor(acc.taxKey!) * 100"
                  @update:model-value="v => setTaxRate(acc.taxKey!, v)"
                  :step="0.01" :min="0" :decimals="2" width="64px"
                />
                <span class="unit">%</span>
              </template>
              <span class="value">{{ fmt(accountMonthlyDollars(acc, asOfMonth)) }}</span>
              </div>
              <div v-if="isFixedRateTax(acc.taxKey)" class="simple-hint">fixed federal rate — never changes, not computed from actuals</div>
              <div v-else-if="acc.taxKey && trailingTaxRates[acc.taxKey] !== null && trailingTaxRates[acc.taxKey] !== undefined" class="simple-hint">
                trailing {{ trailingWindowLabel }} effective rate: {{ (trailingTaxRates[acc.taxKey]! * 100).toFixed(2) }}%
              </div>
            </div>
            <div class="simple-note quiet-note small">&times; {{ fmt(wageSubjectTotal(asOfMonth)) }} modeled wages ({{ MONTH_NAMES[asOfMonth - 1] }})</div>
          </div>
        </div>
      </template>

      <!-- Mirrors the top scope-row's Save button — this page can run long once every
           group is expanded, and scrolling back to the top just to save was the user's
           own complaint. Same saveStatus/saveMessage state as the top button, so a click
           on either one shows the same result. -->
      <div class="scope-row bottom-save-row">
        <span class="quiet-note">Applies to <strong>{{ MONTH_NAMES[asOfMonth - 1] }}–Dec {{ YEAR }}</strong> — already-closed months stay as budgeted.</span>
        <button class="action-btn primary" :disabled="saveStatus === 'saving'" @click="save">Save</button>
      </div>
      <div v-if="saveStatus === 'done'" class="chip good">{{ saveMessage }}</div>
      <div v-if="saveStatus === 'error'" class="chip critical">{{ saveMessage }}</div>
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
.bottom-save-row { margin-top: 4px; }
.action-btn {
  font-size: 13px; border: 1px solid var(--border); background: var(--surface);
  border-radius: 8px; padding: 8px 14px; color: var(--ink); cursor: pointer;
}
.action-btn.primary { background: var(--ink); color: var(--surface); border-color: var(--ink); }

/* Labels the two stat-grid rows below by what they represent (trailing real-world
   average vs. the editable modeled budget) — same color-mix-toward-ink tint as each
   row's own tiles, so the heading visually pairs with the row it introduces. */
.stat-row-heading {
  font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
  margin: 14px 0 6px;
}
.stat-row-heading.trailing { color: color-mix(in srgb, var(--accent) 70%, var(--ink-3)); }
.stat-row-heading.modeled { color: color-mix(in srgb, var(--good) 70%, var(--ink-3)); }
.stat-row-heading.class { color: var(--ink-2); margin: 0; }

.stat-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;
  margin: 14px 0 24px;
}
/* Tighter gap under the comparison row specifically, so its 5 cards read as paired with
   the modeled row directly beneath rather than as two independent, evenly-spaced grids. */
.stat-grid.comparison-row { margin-bottom: 8px; }
/* Light green (blended toward --good, not a flat hex — same color-mix-toward-surface
   technique this file already uses for the group headers below and the comparison row's
   own blue tint) so this modeled row reads as its own distinct color in both light and
   dark mode without a separate dark-mode override. */
.stat-tile { background: color-mix(in srgb, var(--good) 14%, var(--surface-alt)); border-radius: 10px; padding: 10px 14px; }
.stat-tile.trailing { background: color-mix(in srgb, var(--accent) 14%, var(--surface-alt)); }
.stat-label { font-size: 11px; color: var(--ink-3); }
.stat-value { font-size: 19px; font-weight: 500; }
.stat-subnote { font-size: 10px; color: var(--ink-3); margin-top: 2px; }

/* Each group is its own card with a colored header row (the user's own request, after
   finding the earlier one-card-per-role grid "visually overwhelming") — margin-bottom on
   the card itself is the "vertical space between groupings" the user asked for, rather
   than relying on the browser's default table spacing. */
/* No overflow: hidden here (removed — it used to clip the table to the card's rounded
   corners, but an overflow:hidden ancestor also breaks position: sticky for any
   descendant, which is what the sticky column-header row below needs). Rounded corners
   are recreated by hand on .group-header/.labor-table below instead. */
.group-block {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 14px;
  box-shadow: var(--card-shadow); margin-bottom: 26px;
}
.labor-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.labor-table .num { text-align: right; }
.labor-table .muted { color: var(--ink-3); }

/* Blended toward the surface (not a flat hex) so every group's header stays legible and
   on-brand in both light and dark mode without a separate dark-mode override block —
   same color-mix technique this app already uses elsewhere for mode-safe tints. */
.group-header {
  text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
  color: var(--ink); border-radius: 14px 14px 0 0;
}
.group-header.boh { background: color-mix(in srgb, var(--accent) 16%, var(--surface)); }
.group-header.foh { background: color-mix(in srgb, var(--good) 16%, var(--surface)); }
.group-header.management { background: color-mix(in srgb, #7c5cbf 18%, var(--surface)); }
.group-header.other { background: var(--surface-alt); }
.group-header.benefits { background: color-mix(in srgb, #c15990 16%, var(--surface)); }
.group-header.tax { background: color-mix(in srgb, var(--warning) 16%, var(--surface)); }

/* Sticky, not just visually pinned-looking — position: sticky on the thead itself (not
   the tr/td) is what keeps it in place as the page scrolls, since each group's table has
   no scroll container of its own to hang a sticky row off of. Dark-gray + white per the
   user's own request, so it reads as a real fixed header bar rather than blending into
   the group's own colored header directly above it. */
.labor-table thead { position: sticky; top: 0; z-index: 2; }
.col-labels td { font-size: 12.5px; font-weight: 600; color: #fff; background: #3a3a3a; padding: 9px 12px; }
.role-row td { padding: 10px 12px 4px; }
.person-row td { padding: 6px 12px; border-top: 1px solid var(--hair); vertical-align: middle; }
.role-row + .person-row td { border-top: none; }
.total-row td { padding: 6px 12px; border-top: 1px solid var(--hair); font-weight: 600; }
.add-row td { padding: 2px 12px 12px; }
.ot-row td { padding: 10px 12px; border-top: 1px solid var(--hair); vertical-align: middle; }

/* Real-data comparisons (trailing avg, actual-vs-expected) sit directly under the column
   total they explain — hrs/wk, weekly, and this-month respectively — rather than as a
   separate full-width note line below the row, so each figure's own reference sits right
   next to it instead of requiring a mental jump across the table. font-weight is reset to
   normal since .total-row td bolds everything by default. */
.cell-hint { font-size: 10.5px; font-weight: 400; color: var(--ink-3); margin-top: 2px; white-space: nowrap; }
/* Trend indicator (▲ N% / ▼ N% / ✓) sits right after the "trailing" hint text. */
.trend-col { width: 64px; text-align: left; white-space: nowrap; padding-left: 4px; }
.trend { font-weight: 700; color: var(--good); }
.trend.over { color: var(--critical); }
strong.trend-num.ok { color: var(--good); }
strong.trend-num.over { color: var(--critical); }

.name-input {
  font-size: 12.5px; border: 1px solid var(--hair); border-radius: 5px; padding: 4px 6px;
  background: var(--surface); color: var(--ink); width: 100%;
}
.unit { font-size: 11px; color: var(--ink-3); }
.fixed-rate {
  font-size: 14px; font-weight: 500; padding: 6px 8px; color: var(--ink-3);
  border: 1px solid transparent; cursor: default;
}

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
.simple-note { grid-column: 1 / -1; padding-top: 6px; }

/* A dedicated, narrow column for Hide/Unhide and the person-row × button — previously
   these sat inline with the "projected this month" total, which pushed that column's own
   alignment around depending on whether a given row happened to carry a button. Fixed
   width (not flex/auto) so it can't grow the table just because "Unhide" is a few
   characters wider than "Hide" or "×". */
.actions-col { width: 56px; text-align: center; }
/* $/hr and hrs/wk cells with no NumberStepper of their own (the header label, the Total
   row's plain figure, OT's "—" placeholder rate) would otherwise right-align flush with
   the cell's far edge — which, because those columns also hold a NumberStepper with its
   own up/down arrow box, is the arrows' edge, not the input's. This offsets by exactly
   NumberStepper's arrow-box width + gap (22px + 6px, see NumberStepper.vue) so the text
   lines up with the input's own digits instead. */
/* td.num-inset (not just .num-inset) to match the specificity of .col-labels td /
   .total-row td / .ot-row td above, whose own padding shorthand would otherwise win over
   a lower-specificity class-only rule regardless of source order. 40px, not 28px — this
   REPLACES those rules' own 12px right padding rather than adding to it, so the offset
   needs to be the full 12px base padding plus NumberStepper's 28px arrow-box+gap width
   (verified against real computed positions: without the +12, the text landed 12px right
   of the input's own right edge, not flush with it). */
td.num-inset { padding-right: 40px; }
.remove-slot {
  font-size: 14px; color: var(--ink-3); background: none; border: none; cursor: pointer;
}
.remove-slot:hover { color: var(--critical); }
.add-person { font-size: 11px; color: var(--accent); background: none; border: none; cursor: pointer; padding: 0; }

.hide-toggle {
  font-size: 10.5px; color: var(--ink-3); background: none; border: none;
  cursor: pointer; text-decoration: underline; white-space: nowrap;
}
.hide-toggle:hover { color: var(--accent); }
.hidden-tag {
  margin-left: 6px; font-size: 10px; font-weight: 500; color: var(--ink-3);
  background: var(--surface-alt); border-radius: 4px; padding: 1px 5px;
}
.is-hidden-row { opacity: 0.55; }
.hidden-toggle-row { margin: -8px 0 18px; }

.seasonality-panel { padding: 12px 16px; margin-bottom: 22px; gap: 4px; }

/* Labor by Role Class card. Neutral ink on purpose: the four classes are a cost-behavior
   taxonomy, not good/bad statuses, so no status colors (and no color-keyed legend) — each row
   is identified by its text label, the share bar is a single neutral hue. */
.class-card { margin: 0 0 22px; gap: 8px; }
.class-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.class-headline { font-size: 12.5px; color: var(--ink-2); }
.class-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.class-table thead td { font-size: 11px; color: var(--ink-3); padding: 4px 8px; }
.class-table tbody td { padding: 7px 8px; border-top: 1px solid var(--hair); vertical-align: middle; }
.class-table .num { text-align: right; white-space: nowrap; }
.class-sub { font-size: 10.5px; color: var(--ink-3); font-weight: 400; margin-top: 1px; }
.class-other td { color: var(--ink-2); }
.class-total td { font-weight: 700; border-top: 2px solid var(--hair); }
.bar-col { width: 22%; min-width: 80px; }
.share-track { height: 8px; background: var(--surface-alt); border-radius: 4px; overflow: hidden; }
.share-fill { height: 100%; background: var(--ink-3); border-radius: 4px; }
.class-select {
  font-size: 11px; margin-left: 10px; padding: 2px 4px; border: 1px solid var(--hair);
  border-radius: 5px; background: var(--surface); color: var(--ink-2);
}
.seasonal-toggle-lg { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; }
.seasonal-toggle-lg input { margin: 0; }
.ot-note { font-size: 10.5px; color: var(--ink-3); margin-left: 8px; font-weight: 400; }

</style>
