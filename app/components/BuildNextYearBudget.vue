<script setup lang="ts">
// "Build {year} budget" — seeds a not-yet-started year's budget_targets from three sources, so
// next year starts from real numbers instead of a blank page:
//   1. Fixed operating expenses: December of the prior year's budgeted amount for every fixed
//      opex account (rent, utilities, insurance, loan interest — accounts.cost_behavior =
//      'fixed'), repeated in each month. 7020 Loan Interest is the one exception, on by
//      default: December's figure includes the one-time Dec 20 catch-up interest, so it is
//      budgeted from the loan schedule's real monthly interest instead (a checkbox flips this).
//   2. Revenue: the Capacity tab's per-area covers x per-cover Food/Beverage assumptions for
//      each month of {year} (its own operating-day calendar and holiday closures), split across
//      the Food and Beverage revenue accounts exactly the way the Revenue tab's "Recompute
//      Revenue from Capacity" does.
//   3. Labor: the Labor tab's saved rates/hours/salaries run through the same payroll model
//      (app/utils/laborModel.ts) for each month of {year}. Payroll posts on Fridays, so a month
//      with five Fridays gets five paychecks of every role — 2027 has 53 Fridays, so five in Jan/Apr/Jul/Oct/Dec.
// Nothing else is touched: COGS, variable opex, event/catering/retail revenue and buyouts for
// the new year are left for the user. Nothing is written until Apply, and a Preview shows
// exactly what would be.
import type { BudgetAccount, MonthData } from '~/composables/useBudgetData'
import { MONTH_NAMES, fridaysInMonth } from '~/composables/useBudgetData'
import { createLaborModel } from '~/utils/laborModel'
import type { LaborAccount, LaborTaxRates } from '~/utils/laborModel'

const props = defineProps<{ year: number, monthlyData: MonthData[] }>()
const emit = defineEmits<{ applied: [] }>()

type Kind = 'fixed' | 'revenue' | 'labor'
type PlannedRow = { accountId: number, accountNumber: string | null, name: string, kind: Kind, values: number[], note?: string }
type Plan = {
  rows: PlannedRow[]
  sourceMonthLabel: string
  warnings: string[]
  fridays: number[]
  sutaRatePct: number | null
  usedLoanSchedule: boolean
  overwriteCount: number
}

const status = ref<'idle' | 'loading' | 'ready' | 'applying' | 'done' | 'error'>('idle')
const message = ref('')
const plan = ref<Plan | null>(null)
const useLoanSchedule = ref(true)

const sourceYear = computed(() => props.year - 1)
const round2 = (n: number) => Math.round(n * 100) / 100

async function buildPlan() {
  status.value = 'loading'
  message.value = ''
  try {
    const [decRes, capRes, mixRes, laborRes, interestRes] = await Promise.all([
      $fetch<MonthData>('/api/budget/targets', { query: { year: sourceYear.value, month: 12 } }),
      $fetch<{ months: { month: number, assumed: { expectedRevenueFood: number, expectedRevenueBeverage: number } }[] }>('/api/capacity', { query: { year: props.year } }).catch(() => null),
      $fetch<{ hasData: boolean, accounts: { accountId: number, pct: number | null }[] }>('/api/budget/beverage-revenue-mix').catch(() => null),
      $fetch<{ accounts: any[], taxRates: LaborTaxRates | null, coversRatioByMonth?: Record<string, { ratio: number }> }>('/api/budget/labor-settings'),
      $fetch<{ hasSchedule: boolean, months: (number | null)[], accrued?: (number | null)[] }>('/api/budget/loan-interest', { query: { year: props.year } }).catch(() => null)
    ])

    const accounts = decRes.accounts
    const parentIds = new Set(accounts.filter(a => a.parentAccountId != null).map(a => a.parentAccountId))
    const isLeaf = (a: BudgetAccount) => !parentIds.has(a.accountId)
    const rows: PlannedRow[] = []
    const warnings: string[] = []
    const months = Array.from({ length: 12 }, (_, i) => i + 1)
    const dec = MONTH_NAMES[11]
    let usedLoanSchedule = false

    // 1. Fixed opex ---------------------------------------------------------
    for (const a of accounts) {
      if (a.category !== 'opex' || a.costBehavior !== 'fixed' || !isLeaf(a) || a.amount == null) continue
      let values = months.map(() => a.amount as number)
      let note: string | undefined
      if (a.accountNumber === '7020' && useLoanSchedule.value && interestRes?.hasSchedule) {
        values = months.map(m => interestRes.months[m - 1] ?? (a.amount as number))
        usedLoanSchedule = true
        const accruedMonths = (interestRes.accrued ?? []).filter(v => v != null).length
        note = `from the loan schedule (${dec} ${sourceYear.value} includes the one-time Dec 20 catch-up)${accruedMonths > 0 ? `, including ${accruedMonths} months of accrued interest on the deferred Miller note` : ''}`
      }
      rows.push({ accountId: a.accountId, accountNumber: a.accountNumber, name: a.name, kind: 'fixed', values: values.map(round2), note })
    }
    if (rows.length === 0) warnings.push(`No fixed operating expenses are budgeted for ${dec} ${sourceYear.value}, so nothing was carried over.`)

    // 2. Revenue from Capacity ---------------------------------------------
    const capByMonth = new Map((capRes?.months ?? []).map(m => [m.month, m.assumed]))
    if (capByMonth.size === 0) {
      warnings.push('No Capacity assumptions found — set expected covers by area on the Capacity planning page. Revenue was not carried over.')
    } else {
      const mixById = new Map((mixRes?.hasData ? mixRes.accounts : []).map(m => [m.accountId, m.pct]))
      for (const group of ['Food', 'Beverage'] as const) {
        const groupAccounts = accounts.filter(a => a.category === 'revenue' && a.subcategory === group && isLeaf(a))
        if (groupAccounts.length === 0) continue
        const realMix = group === 'Beverage' && groupAccounts.every(a => mixById.get(a.accountId) != null)
        const oldTotal = groupAccounts.reduce((s, a) => s + (a.amount || 0), 0)
        for (const a of groupAccounts) {
          const weight = realMix ? (mixById.get(a.accountId) ?? 0) : (oldTotal > 0 ? (a.amount || 0) / oldTotal : 1 / groupAccounts.length)
          const values = months.map((m) => {
            const target = capByMonth.get(m)
            if (!target) return 0
            return round2((group === 'Food' ? target.expectedRevenueFood : target.expectedRevenueBeverage) * weight)
          })
          rows.push({ accountId: a.accountId, accountNumber: a.accountNumber, name: a.name, kind: 'revenue', values, note: group === 'Beverage' && !realMix ? 'no sales-mix data yet — split by existing weights' : undefined })
        }
      }
    }

    // 3. Labor from the Labor tab's model ---------------------------------
    const laborAccounts: LaborAccount[] = laborRes.accounts.map((a: any) => ({
      ...a,
      slots: (a.slots ?? []).map((s: any) => ({ id: s.id, slotIndex: s.slotIndex, employeeName: s.employeeName ?? '', hourlyRate: s.hourlyRate, weeklyHours: s.weeklyHours, weeklySalary: s.weeklySalary, firstPaycheckDate: s.firstPaycheckDate ?? '' }))
    }))
    const taxRates: LaborTaxRates = laborRes.taxRates
      ? { ...laborRes.taxRates, taxableTipsPerPayroll: laborRes.taxRates.taxableTipsPerPayroll ?? 0 }
      : { medicareRate: 0, socialSecurityRate: 0, futaRate: 0, sutaMaRate: 0, pfmlMaRate: 0, taxableTipsPerPayroll: 0 }
    const model = createLaborModel({
      year: props.year,
      accounts: () => laborAccounts,
      taxRates: () => taxRates,
      // Direct roles scale with forecast covers (server/utils/labor-forecast.ts), not last year's index.
      seasonalPct: m => (laborRes.coversRatioByMonth?.[`${props.year}-${String(m).padStart(2, '0')}`]?.ratio ?? 1) * 100
    })
    for (const a of laborAccounts) {
      rows.push({ accountId: a.accountId, accountNumber: a.accountNumber, name: a.name, kind: 'labor', values: months.map(m => round2(model.accountMonthlyDollars(a, m))) })
    }
    if (laborAccounts.length === 0) warnings.push('The Staffing Plan has no accounts set up, so labor was not carried over.')

    // Existing entries this will replace in the new year.
    let overwriteCount = 0
    for (const r of rows) {
      for (const m of months) {
        const existing = props.monthlyData[m - 1]?.accounts.find(x => x.accountId === r.accountId)?.amount
        if (existing != null && Math.round(existing) !== Math.round(r.values[m - 1]!)) overwriteCount++
      }
    }

    plan.value = {
      rows,
      sourceMonthLabel: `${dec} ${sourceYear.value}`,
      warnings,
      fridays: months.map(m => fridaysInMonth(props.year, m)),
      sutaRatePct: laborRes.taxRates ? laborRes.taxRates.sutaMaRate * 100 : null,
      usedLoanSchedule,
      overwriteCount
    }
    status.value = 'ready'
  } catch (err: any) {
    status.value = 'error'
    message.value = err?.data?.statusMessage || err?.message || 'Could not build the preview'
  }
}

function monthTotals(kind: Kind): number[] {
  const rows = plan.value?.rows.filter(r => r.kind === kind) ?? []
  return Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r.values[i]!, 0))
}
const summaryRows = computed(() => (['revenue', 'labor', 'fixed'] as Kind[]).map(kind => {
  const values = monthTotals(kind)
  return {
    kind,
    label: { revenue: 'Revenue (Capacity: Food + Beverage)', labor: 'Labor (Staffing Plan model)', fixed: 'Fixed operating expenses' }[kind],
    values,
    total: values.reduce((s, v) => s + v, 0),
    count: plan.value?.rows.filter(r => r.kind === kind).length ?? 0
  }
}))

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`

async function apply() {
  if (!plan.value) return
  status.value = 'applying'
  try {
    const targets = plan.value.rows.flatMap(r => r.values.map((amount, i) => ({ year: props.year, month: i + 1, accountId: r.accountId, amount })))
    await $fetch('/api/budget/targets', { method: 'POST', body: { targets } })
    message.value = `Wrote ${targets.length} budget entries to ${props.year} (${summaryRows.value.map(s => `${s.count} ${s.kind} account${s.count === 1 ? '' : 's'}`).join(', ')}).`
    status.value = 'done'
    emit('applied')
  } catch (err: any) {
    status.value = 'error'
    message.value = err?.data?.statusMessage || err?.message || 'Apply failed'
  }
}
</script>

<template>
  <div class="drill-card build-card">
    <div class="build-head">
      <span class="chip accent">Build {{ year }} budget</span>
      <span class="quiet-note">Starts {{ year }} from existing numbers: fixed expenses from {{ MONTH_NAMES[11] }} {{ sourceYear }}'s budget, revenue from the Capacity planning page, and labor from the Staffing Plan (with its Friday paychecks). food & drink cost, variable expenses, events and retail are left for you.</span>
    </div>

    <div class="build-actions">
      <label class="build-check">
        <input v-model="useLoanSchedule" type="checkbox" :disabled="status === 'loading' || status === 'applying'" @change="plan && buildPlan()">
        Budget 7020 Loan Interest from the loan schedule instead of {{ MONTH_NAMES[11] }}'s figure (December includes the one-time Dec 20 catch-up interest)
      </label>
      <button class="action-btn" :disabled="status === 'loading' || status === 'applying'" @click="buildPlan">{{ plan ? 'Refresh preview' : 'Preview' }}</button>
    </div>

    <div v-if="status === 'loading'" class="quiet-note">Building preview…</div>
    <div v-if="status === 'error'" class="chip critical">{{ message }}</div>
    <div v-if="status === 'done'" class="chip good">{{ message }}</div>

    <template v-if="plan && (status === 'ready' || status === 'applying' || status === 'done')">
      <div v-for="w in plan.warnings" :key="w" class="chip warning build-warning">{{ w }}</div>

      <div class="edit-table-scroll">
        <table class="pl-table build-table">
          <thead>
            <tr class="col-head-row">
              <th scope="col"></th>
              <th v-for="m in 12" :key="m" scope="col">{{ MONTH_NAMES[m - 1] }}</th>
              <th scope="col">{{ year }}</th>
            </tr>
          </thead>
          <tbody>
            <tr class="fridays-row">
              <th scope="row">Payroll Fridays</th>
              <td v-for="(f, i) in plan.fridays" :key="i" :class="{ five: f >= 5 }">{{ f }}</td>
              <td>{{ plan.fridays.reduce((s, f) => s + f, 0) }}</td>
            </tr>
            <tr v-for="s in summaryRows" :key="s.kind">
              <th scope="row">{{ s.label }} <span class="quiet-note">· {{ s.count }} accounts</span></th>
              <td v-for="(v, i) in s.values" :key="i" :class="{ five: s.kind === 'labor' && plan.fridays[i]! >= 5 }">{{ fmt(v) }}</td>
              <td><strong>{{ fmt(s.total) }}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="quiet-note small build-notes">
        <template v-if="plan.usedLoanSchedule">7020 Loan Interest is budgeted from the loan schedule, plus accrued interest on the deferred Miller note in the months it isn't paid. </template>
        Labor uses the Staffing Plan as currently saved<template v-if="plan.sutaRatePct != null"> — including its SUTA rate of {{ plan.sutaRatePct.toFixed(2) }}%</template>. Payroll-tax rates and wage-base caps reset each January, so check the tax rates on the Staffing Plan before relying on early-year labor.
        Fixed utilities (gas, electricity) are carried at {{ MONTH_NAMES[11] }}'s level all year; adjust seasonally on the month tabs if you want. Food & drink cost and variable operating expenses aren't budgeted yet, so the year's Net Income will read far too high until they are (each month tab's food & drink cost recompute can fill food & drink cost from revenue).
      </div>

      <div class="build-actions">
        <span v-if="plan.overwriteCount > 0" class="chip warning">{{ plan.overwriteCount }} existing {{ year }} entries will be replaced</span>
        <span v-else class="quiet-note">No existing {{ year }} entries will be replaced.</span>
        <button class="action-btn primary" :disabled="status === 'applying' || plan.rows.length === 0" @click="apply">{{ status === 'applying' ? 'Applying…' : `Apply to ${year}` }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.quiet-note { font-size: 13px; color: var(--ink-2); }
.quiet-note.small { font-size: 12px; }
.build-card { margin-bottom: 18px; display: flex; flex-direction: column; gap: 10px; }
.build-head { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.build-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: space-between; }
.build-check { display: flex; align-items: flex-start; gap: 7px; font-size: 13px; max-width: 640px; }
.build-check input { margin-top: 3px; }
.build-warning { align-self: flex-start; }
.build-table { font-size: 12.5px; }
.build-table th[scope="row"] { text-align: left; white-space: nowrap; }
.build-table td.five { background: var(--accent-wash); font-weight: 600; }
.fridays-row td, .fridays-row th { color: var(--ink-2); }
.build-notes { line-height: 1.5; }
</style>
