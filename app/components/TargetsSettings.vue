<script setup lang="ts">
// Settings › Targets & alert levels (2026-11-08): the weekly sales goal (moved
// from This Week), the overspending alert levels (moved from Budget Check) and
// the cost benchmarks, which had no screen before.

type Benchmark = { category: string, targetPct: number | null, warningPct: number | null, seriousPct: number | null }
type Targets = { weeklyGoal: number | null, thresholds: { month: number, year: number }, benchmarks: Benchmark[] }
const { data, refresh } = await useFetch<Targets>('/api/settings/targets')

// The data-driven suggestion lives in the dashboard route's weekly targets.
type Suggestion = { amount: number | null, laborMonthEstimate: number, opexMonthEstimate: number, principalDueThisMonth: number, cogsPct: number, cogsPctSource: 'benchmark' | 'trailing' }
const { data: dash } = await useFetch<{ weeklyTargets?: { suggestedWeeklyGoal: Suggestion } }>('/api/dashboard', { server: false })
const suggestion = computed(() => dash.value?.weeklyTargets?.suggestedWeeklyGoal ?? null)
const money = (n: number) => `$${Math.round(n).toLocaleString()}`

// ---- Weekly sales goal
const goal = ref('')
watch(() => data.value?.weeklyGoal, (v) => { goal.value = v == null ? '' : String(v) }, { immediate: true })
const goalState = ref<{ status: 'idle' | 'saving' | 'saved' | 'error', msg: string }>({ status: 'idle', msg: '' })
const goalDirty = computed(() => goal.value !== (data.value?.weeklyGoal == null ? '' : String(data.value.weeklyGoal)))
async function saveGoal() {
  const n = Number(goal.value)
  if (!Number.isFinite(n) || n <= 0) { goalState.value = { status: 'error', msg: 'Enter a positive weekly amount' }; return }
  goalState.value = { status: 'saving', msg: '' }
  try {
    await $fetch('/api/dashboard/weekly-benchmark', { method: 'POST', body: { weeklyAmount: n } })
    await refresh()
    goalState.value = { status: 'saved', msg: '' }
  } catch (err: any) {
    goalState.value = { status: 'error', msg: err?.data?.statusMessage || err?.message || 'Save failed' }
  }
}

// ---- Overspending alert levels
const monthThreshold = ref('')
const yearThreshold = ref('')
watch(() => data.value?.thresholds, (t) => { if (t) { monthThreshold.value = String(t.month); yearThreshold.value = String(t.year) } }, { immediate: true })
const thresholdDirty = computed(() => !!data.value && (monthThreshold.value !== String(data.value.thresholds.month) || yearThreshold.value !== String(data.value.thresholds.year)))
const thresholdState = ref<{ status: 'idle' | 'saving' | 'saved' | 'error', msg: string }>({ status: 'idle', msg: '' })
async function saveThresholds() {
  const m = Number(monthThreshold.value), y = Number(yearThreshold.value)
  if (![m, y].every(v => Number.isFinite(v) && v >= 0)) { thresholdState.value = { status: 'error', msg: 'Enter dollar amounts of 0 or more' }; return }
  thresholdState.value = { status: 'saving', msg: '' }
  try {
    await $fetch('/api/budget/drilldown-thresholds', { method: 'POST', body: { monthThreshold: m, yearThreshold: y } })
    await refresh()
    thresholdState.value = { status: 'saved', msg: '' }
  } catch (err: any) {
    thresholdState.value = { status: 'error', msg: err?.data?.statusMessage || err?.message || 'Save failed' }
  }
}

// ---- Cost benchmarks (entered as whole percents, stored as fractions)
const LABELS: Record<string, { label: string, hint: string }> = {
  cogs: { label: 'Food & drink cost', hint: 'Cost of goods, as a share of sales' },
  labor: { label: 'Labor', hint: 'All wages, taxes and benefits' },
  prime_cost: { label: 'Prime cost', hint: 'Food & drink cost + labor' },
  opex_variable: { label: 'Variable operating costs', hint: 'Marketing, repairs, supplies, admin' }
}
type BenchDraft = { category: string, target: string, warning: string, serious: string }
const toPct = (v: number | null) => (v == null ? '' : String(Math.round(v * 1000) / 10))
const benchDrafts = ref<BenchDraft[]>([])
const benchFrom = (rows: Benchmark[] | undefined) => (rows ?? []).map(b => ({ category: b.category, target: toPct(b.targetPct), warning: toPct(b.warningPct), serious: toPct(b.seriousPct) }))
watch(() => data.value?.benchmarks, (rows) => { benchDrafts.value = benchFrom(rows) }, { immediate: true })
const benchDirty = computed(() => JSON.stringify(benchDrafts.value) !== JSON.stringify(benchFrom(data.value?.benchmarks)))
const benchState = ref<{ status: 'idle' | 'saving' | 'saved' | 'error', msg: string }>({ status: 'idle', msg: '' })
async function saveBenchmarks() {
  benchState.value = { status: 'saving', msg: '' }
  try {
    const rows = benchDrafts.value
      .filter(b => b.target !== '' || b.warning !== '' || b.serious !== '')
      .map((b) => {
        const t = Number(b.target), w = Number(b.warning), s = Number(b.serious)
        const name = LABELS[b.category]?.label ?? b.category
        if (![t, w, s].every(v => Number.isFinite(v) && v > 0)) throw new Error(`Fill in all three percentages for ${name}`)
        if (!(t <= w && w <= s)) throw new Error(`For ${name}, each level must be at least the one before it`)
        return { category: b.category, targetPct: t / 100, warningPct: w / 100, seriousPct: s / 100 }
      })
    if (rows.length === 0) throw new Error('Nothing to save')
    await $fetch('/api/settings/benchmarks', { method: 'POST', body: { benchmarks: rows } })
    await refresh()
    benchState.value = { status: 'saved', msg: '' }
  } catch (err: any) {
    benchState.value = { status: 'error', msg: err?.data?.statusMessage || err?.message || 'Save failed' }
  }
}
</script>

<template>
  <div class="ts">
    <div class="ts-card">
      <h3 class="ts-h">Weekly sales goal</h3>
      <p class="ts-note">The “good week” of core dining sales. This Week and Daily Results split it into a goal for each night, using how each weekday usually sells.</p>
      <div class="ts-row">
        <span class="ts-money">$<input v-model="goal" class="ts-input wide" inputmode="numeric" aria-label="Weekly sales goal" /></span>
        <span class="ts-unit">per week</span>
        <button class="ts-save" :disabled="!goalDirty || goalState.status === 'saving'" @click="saveGoal">{{ goalState.status === 'saving' ? 'Saving…' : 'Save' }}</button>
        <span v-if="goalState.status === 'saved' && !goalDirty" class="chip good">✓ Saved</span>
        <span v-else-if="goalState.status === 'error'" class="chip critical">{{ goalState.msg }}</span>
      </div>
      <p v-if="suggestion?.amount" class="ts-suggest">
        To cover this month's labor ({{ money(suggestion.laborMonthEstimate) }}), operating costs ({{ money(suggestion.opexMonthEstimate) }})
        and loan principal ({{ money(suggestion.principalDueThisMonth) }}) at {{ Math.round(suggestion.cogsPct * 100) }}% food &amp; drink cost,
        the restaurant needs at least <strong>{{ money(suggestion.amount) }} a week</strong> this month.
      </p>
    </div>

    <div class="ts-card">
      <h3 class="ts-h">Cost targets</h3>
      <p class="ts-note">Each cost as a share of sales. At or under the target shows green; up to “watch” is a caution; up to “serious” is a warning; above that is critical. Used on This Week, Profit &amp; Loss and Budget Check.</p>
      <div class="ts-table-wrap">
        <table class="ts-table">
          <thead><tr><th scope="col">Cost</th><th scope="col">Target</th><th scope="col">Watch up to</th><th scope="col">Serious up to</th></tr></thead>
          <tbody>
            <tr v-for="b in benchDrafts" :key="b.category">
              <th scope="row">{{ LABELS[b.category]?.label }}<span class="ts-hint">{{ LABELS[b.category]?.hint }}</span></th>
              <td><span class="ts-pct"><input v-model="b.target" class="ts-input" inputmode="decimal" :aria-label="`${LABELS[b.category]?.label} target percent`" />%</span></td>
              <td><span class="ts-pct"><input v-model="b.warning" class="ts-input" inputmode="decimal" :aria-label="`${LABELS[b.category]?.label} watch percent`" />%</span></td>
              <td><span class="ts-pct"><input v-model="b.serious" class="ts-input" inputmode="decimal" :aria-label="`${LABELS[b.category]?.label} serious percent`" />%</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="ts-row">
        <button class="ts-save" :disabled="!benchDirty || benchState.status === 'saving'" @click="saveBenchmarks">{{ benchState.status === 'saving' ? 'Saving…' : 'Save cost targets' }}</button>
        <span v-if="benchState.status === 'saved' && !benchDirty" class="chip good">✓ Saved</span>
        <span v-else-if="benchState.status === 'error'" class="chip critical">{{ benchState.msg }}</span>
      </div>
    </div>

    <div class="ts-card">
      <h3 class="ts-h">Overspending alerts</h3>
      <p class="ts-note">On Budget Check, a cost line is only listed as a cause of overspending if it's off pace by at least this much.</p>
      <div class="ts-row">
        <label class="ts-field">This month <span class="ts-money">$<input v-model="monthThreshold" class="ts-input" inputmode="numeric" aria-label="Monthly alert level" /></span></label>
        <label class="ts-field">This year <span class="ts-money">$<input v-model="yearThreshold" class="ts-input" inputmode="numeric" aria-label="Yearly alert level" /></span></label>
        <button class="ts-save" :disabled="!thresholdDirty || thresholdState.status === 'saving'" @click="saveThresholds">{{ thresholdState.status === 'saving' ? 'Saving…' : 'Save' }}</button>
        <span v-if="thresholdState.status === 'saved' && !thresholdDirty" class="chip good">✓ Saved</span>
        <span v-else-if="thresholdState.status === 'error'" class="chip critical">{{ thresholdState.msg }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ts { display: flex; flex-direction: column; gap: 12px; }
.ts-card { padding: 16px; background: var(--surface); border: 1px solid var(--hair); border-radius: 12px; box-shadow: var(--card-shadow); }
.ts-h { font-size: 15px; font-weight: 800; color: var(--ink); margin: 0 0 4px; }
.ts-note { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; margin: 0 0 10px; max-width: 760px; }
.ts-suggest { font-size: 12.5px; color: var(--ink-2); line-height: 1.5; margin: 10px 0 0; max-width: 760px; }
.ts-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.ts-row .chip { margin: 0; }
.ts-field { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
.ts-money, .ts-pct { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; color: var(--ink-2); }
.ts-unit { font-size: 13px; color: var(--ink-3); }
.ts-input {
  width: 64px; text-align: right; font-size: 13px; padding: 6px 8px; font-variant-numeric: tabular-nums;
  border: 1px solid var(--hair); border-radius: 6px; background: var(--surface-alt); color: var(--ink);
}
.ts-input.wide { width: 100px; }
.ts-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.ts-save { font-size: 12.5px; font-weight: 700; padding: 7px 14px; border-radius: 8px; border: none; background: var(--accent); color: white; cursor: pointer; }
.ts-save:disabled { opacity: 0.5; cursor: default; }
.ts-table-wrap { border: 1px solid var(--hair); border-radius: 10px; overflow-x: auto; margin-bottom: 10px; }
.ts-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 460px; }
.ts-table th, .ts-table td { padding: 9px 12px; text-align: center; }
.ts-table thead th { font-size: 11.5px; font-weight: 700; color: var(--ink-3); background: var(--surface-alt); border-bottom: 1px solid var(--hair); }
.ts-table tbody th { text-align: left; font-weight: 700; color: var(--ink); }
.ts-table tbody tr + tr { border-top: 1px solid var(--hair); }
.ts-hint { display: block; font-size: 11.5px; font-weight: 500; color: var(--ink-3); }
</style>
