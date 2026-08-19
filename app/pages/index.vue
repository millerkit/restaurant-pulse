<script setup lang="ts">
import site from '~/config/site.json'
import { CATEGORY_DIRECTION, benchmarkStatus, daysInMonth, daysInYear, dayOfYear, netIncome, paceStatus } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Weekly Performance` })

const { data, pending, error, refresh } = await useFetch('/api/dashboard')

// ---- date/time formatting (all daily_line_items dates are UTC-anchored
// ISO strings, e.g. '2026-07-27' — parsed/formatted in UTC throughout so a
// browser west of UTC doesn't roll the displayed date back a day) --------
function parseIsoDate(s: string) {
  return new Date(`${s}T00:00:00Z`)
}
function formatLongDate(s: string) {
  return parseIsoDate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
function formatWeekdayDate(s: string, includeYear = false) {
  const d = parseIsoDate(s)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${weekday}, ${month} ${d.getUTCDate()}${includeYear ? ` ${d.getUTCFullYear()}` : ''}`
}
// ---- month / year net income + revenue pace -----------------------------
// Pace/status math deliberately mirrors the Budget Pace page (paceStatus,
// netIncome, CATEGORY_DIRECTION from useBudgetData.ts) rather than
// reinventing it — the API route only hands back raw actuals/budget
// totals, same split as /api/budget/actuals + /api/budget/targets.
const monthDayFraction = computed(() => data.value ? data.value.asOfDay / daysInMonth(data.value.asOfYear, data.value.asOfMonth) : 0)
const yearDayFraction = computed(() => data.value ? dayOfYear(data.value.asOfYear, data.value.asOfMonth, data.value.asOfDay) / daysInYear(data.value.asOfYear) : 0)

const EMPTY_CATEGORY_TOTALS = { revenue: 0, cogs: 0, labor: 0, opex: 0, other_income: 0, other_expense: 0 }
type CategoryTotals = typeof EMPTY_CATEGORY_TOTALS

// Cumulative per-category target through today, built from each month's own
// figure (server/api/dashboard.get.ts's monthlyCategoryBudget) rather than
// a flat dayOfYear/daysInYear share of the annual total — a flat line
// assumes a category accrues evenly across all 12 months, which misjudges
// pace whenever a month (e.g. a much higher October) is budgeted
// seasonally. Each month's figure is its budget where one was set, or its
// own actual for a fully-elapsed month that was never budgeted (e.g.
// Jan-Jun 2026, the old location, budgeted only from Jul onward) — using
// real actuals there instead of fabricating a target for months nobody
// ever planned. A still-in-progress or future unbudgeted month contributes
// 0, same as before. Originally revenue-only; generalized so the Net
// Income cards' pace status can be built from an expected net income
// figure instead of borrowing revenue's pace (see below).
const yearExpectedToDate = computed<CategoryTotals>(() => {
  if (!data.value) return { ...EMPTY_CATEGORY_TOTALS }
  const monthlyBudgets = data.value.yearToDate.monthlyCategoryBudget
  const { asOfYear, asOfMonth, asOfDay } = data.value
  const result = { ...EMPTY_CATEGORY_TOTALS }
  for (const cat of Object.keys(EMPTY_CATEGORY_TOTALS) as (keyof CategoryTotals)[]) {
    const budgets = monthlyBudgets?.[cat] ?? []
    let expected = 0
    for (let m = 1; m < asOfMonth; m++) {
      expected += budgets[m - 1] ?? 0
    }
    expected += (budgets[asOfMonth - 1] ?? 0) * (asOfDay / daysInMonth(asOfYear, asOfMonth))
    result[cat] = expected
  }
  return result
})
const yearExpectedRevenueToDate = computed(() => yearExpectedToDate.value.revenue)

function buildPeriod(period: 'month' | 'year') {
  if (!data.value) return null
  const p = period === 'month' ? data.value.month : data.value.yearToDate
  const dayFraction = period === 'month' ? monthDayFraction.value : yearDayFraction.value
  const actualNet = netIncome(p.actuals as any)
  if (!p.budget || !p.budget.revenue) {
    return { actualNet, hasBudget: false as const, dayFraction }
  }
  const budgetNet = netIncome(p.budget as any)
  const actualPct = (p.actuals.revenue / p.budget.revenue) * 100
  const expectedPct = period === 'year'
    ? (yearExpectedRevenueToDate.value / p.budget.revenue) * 100
    : dayFraction * 100
  const status = paceStatus(actualPct, expectedPct, CATEGORY_DIRECTION.revenue)

  // Net income's own pace — deliberately its own comparison, not borrowed
  // from revenue.status above. A month can be profitable and still behind
  // budget on net income even while revenue itself is right on pace (or
  // ahead), if costs are overrunning — see the Design direction section in
  // CLAUDE.md ("a month can be profitable and still be behind budget").
  // Expressed as a % of the period's budgeted revenue — a stable,
  // always-positive denominator — rather than a % of budgeted net income
  // itself, which can be near-zero or negative and make a percentage swing
  // wildly for a small dollar difference.
  const budget = p.budget as CategoryTotals
  const expectedTotals: CategoryTotals = period === 'year'
    ? yearExpectedToDate.value
    : {
        revenue: budget.revenue * dayFraction,
        cogs: budget.cogs * dayFraction,
        labor: budget.labor * dayFraction,
        opex: budget.opex * dayFraction,
        other_income: budget.other_income * dayFraction,
        other_expense: budget.other_expense * dayFraction
      }
  const expectedNet = netIncome(expectedTotals)
  const netActualPct = (actualNet / p.budget.revenue) * 100
  const netExpectedPct = (expectedNet / p.budget.revenue) * 100
  const netStatus = paceStatus(netActualPct, netExpectedPct, 'higher-is-better')

  return {
    actualNet, budgetNet, expectedNet, netStatus, hasBudget: true as const, dayFraction,
    revenue: {
      actual: p.actuals.revenue,
      target: p.budget.revenue,
      fillPct: Math.min(100, actualPct),
      expectedPct,
      status,
      paceOfExpectedPct: expectedPct > 0 ? (actualPct / expectedPct) * 100 : null
    }
  }
}
const monthView = computed(() => buildPeriod('month'))
const yearView = computed(() => buildPeriod('year'))
const paceLabel = (status: string) => status === 'good' ? 'Ahead of pace' : 'Behind pace'

// ---- last night: still needed for Sales / Labor Hour, moved lower on the
// page 2026-08-19 when Net Income / Last Night vs. History / Covers / Avg
// Check were replaced by the Weekly Performance section below. ------------
const lastNightRevenue = computed(() => data.value?.lastNight.revenue ?? 0)

// Toast POS metrics (covers, labor hours) — real data as of the nightly
// sync's Toast step (server/utils/toast-metrics-sync.ts), null if last
// night's date hasn't synced yet (Toast not configured, or the sync ran
// before it was). Revenue still comes from QBO, not Toast, matching how
// this app treats Toast as a guest-count/labor-hours source only, not a
// second revenue feed.
const toastSynced = computed(() => data.value?.toast != null)
const lastNightLaborHours = computed(() => data.value?.toast?.laborHours ?? null)
const salesPerLaborHour = computed(() => lastNightLaborHours.value ? lastNightRevenue.value / lastNightLaborHours.value : null)

// ---- Weekly Performance: day-specific targets scaled from a single
// editable weekly benchmark by the real weekday revenue pattern — see
// server/api/dashboard.get.ts's weeklyTargets computation. Added 2026-08-19,
// replacing the old Net Income / Last Night vs. History / Covers / Avg
// Check cards at the user's request.
const weeklyTargets = computed(() => data.value?.weeklyTargets ?? null)

function dayStatus(d: { hasHappened: boolean, dollarTarget: number | null, actualRevenue: number | null }): string | null {
  if (!d.hasHappened || d.dollarTarget == null || !(d.dollarTarget > 0) || d.actualRevenue == null) return null
  return paceStatus((d.actualRevenue / d.dollarTarget) * 100, 100, 'higher-is-better')
}
function dayStatusLabel(status: string | null): string {
  if (status === null) return 'No data yet'
  return status === 'good' ? 'Hit target' : 'Below target'
}
const weekToDateStatus = computed(() => {
  const wt = weeklyTargets.value
  if (!wt || !wt.benchmarkAmount || !(wt.thisWeek.toDate.targetRevenue > 0)) return null
  return paceStatus((wt.thisWeek.toDate.actualRevenue / wt.thisWeek.toDate.targetRevenue) * 100, 100, 'higher-is-better')
})

// ---- Weekly goal edit form (weekly_revenue_benchmark) — same
// watch-once-then-let-the-user-type pattern as Cash Flow's "Planned weekly
// amount" form for reserve_plan (app/pages/cashflow.vue).
const benchmarkAmount = ref<number | null>(null)
watch(() => weeklyTargets.value?.benchmarkAmount ?? null, (v) => { if (benchmarkAmount.value === null) benchmarkAmount.value = v }, { immediate: true })
const benchmarkSubmitting = ref(false)
const benchmarkError = ref<string | null>(null)
const benchmarkSaved = ref(false)
async function submitBenchmark() {
  benchmarkError.value = null
  benchmarkSaved.value = false
  if (benchmarkAmount.value === null || !Number.isFinite(benchmarkAmount.value) || benchmarkAmount.value <= 0) {
    benchmarkError.value = 'Enter a positive weekly amount'
    return
  }
  benchmarkSubmitting.value = true
  try {
    await $fetch('/api/dashboard/weekly-benchmark', { method: 'POST', body: { weeklyAmount: benchmarkAmount.value } })
    benchmarkSaved.value = true
    await refresh()
  } catch (err: any) {
    benchmarkError.value = err?.data?.statusMessage || err?.message || 'Failed to save goal'
  } finally {
    benchmarkSubmitting.value = false
  }
}

// ---- cost pace meters (COGS / labor / prime cost, month-to-date) --------
const benchmarkByCategory = computed(() => Object.fromEntries((data.value?.benchmarks ?? []).map((b: any) => [b.category, b])))
const COST_METERS = [
  { key: 'cogs', label: 'COGS', benchmarkKey: 'cogs', scaleMax: 40 },
  { key: 'labor', label: 'Labor', benchmarkKey: 'labor', scaleMax: 40 },
  { key: 'prime', label: 'Prime Cost', hint: 'COGS + labor', benchmarkKey: 'prime_cost', scaleMax: 80 }
] as const
const costPaceMeters = computed(() => {
  const revenue = data.value?.month.actuals.revenue
  if (!data.value || !revenue) return []
  const { cogs, labor } = data.value.month.actuals
  const pctByKey: Record<string, number> = {
    cogs: (cogs / revenue) * 100,
    labor: (labor / revenue) * 100,
    prime: ((cogs + labor) / revenue) * 100
  }
  return COST_METERS.map((m) => {
    const pct = pctByKey[m.key]
    const benchmark = benchmarkByCategory.value[m.benchmarkKey]
    const status = benchmark ? benchmarkStatus(pct / 100, benchmark) : null
    return { ...m, pct, benchmark, status }
  })
})
function meterStatusLabel(status: string | null) {
  if (status === 'good') return 'On target'
  if (status === 'warning') return 'Watch'
  if (status === 'serious') return 'Off target'
  if (status === 'critical') return 'Over target'
  return 'No benchmark set'
}
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading dashboard…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load dashboard data</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>
    <div v-else-if="!data?.asOfDate" class="drill-card">
      <span class="chip warning">No synced data yet</span>
      <span class="quiet-note">Run a QuickBooks sync (POST /api/qbo/sync) to pull in P&amp;L data before this page has anything to show.</span>
    </div>

    <template v-else>
      <PageHeader
        page-name="Weekly Performance"
        :description="`${formatLongDate(data.asOfDate)} · reporting through last night's close`"
        :as-of-label="formatWeekdayDate(data.asOfDate)"
        @synced="refresh()"
      />

      <!-- Are we tracking toward a real weekly revenue goal, day by day? -->
      <section v-if="weeklyTargets">
        <div class="section-label">This Week's Targets — day-specific goals, scaled from your weekly revenue goal by the real weekday pattern</div>

        <div class="hero-row single">
          <div class="hero-card anchor">
            <div class="hero-top">
              <span class="period">{{ formatWeekdayDate(weeklyTargets.thisWeek.days[0].date) }} – {{ formatWeekdayDate(weeklyTargets.thisWeek.days[5].date) }}</span>
              <span v-if="weekToDateStatus" :class="['chip', weekToDateStatus]">{{ paceLabel(weekToDateStatus) }}</span>
              <span v-else class="chip warning">No goal set</span>
            </div>
            <div class="figure">${{ Math.round(weeklyTargets.thisWeek.toDate.actualRevenue).toLocaleString() }}</div>
            <div class="caption">
              Core dine-in revenue, week-to-date
              <template v-if="weeklyTargets.benchmarkAmount">— vs ${{ Math.round(weeklyTargets.thisWeek.toDate.targetRevenue).toLocaleString() }} expected by now this week (full week goal: ${{ Math.round(weeklyTargets.thisWeek.fullWeekTarget).toLocaleString() }})</template>
              <template v-else>— set a weekly goal below to see a target here</template>
            </div>
          </div>
        </div>

        <div class="week-day-row">
          <div v-for="d in weeklyTargets.thisWeek.days" :key="d.key" :class="['day-card', !d.hasHappened && 'upcoming']">
            <div class="day-label">{{ formatWeekdayDate(d.date) }}</div>
            <div class="day-target">Target ${{ d.dollarTarget != null ? Math.round(d.dollarTarget).toLocaleString() : '—' }}<span v-if="d.coversTarget != null"> &middot; {{ d.coversTarget }} covers</span></div>
            <template v-if="d.hasHappened">
              <div class="day-actual">${{ d.actualRevenue != null ? Math.round(d.actualRevenue).toLocaleString() : '—' }}<span v-if="d.actualCovers != null"> &middot; {{ d.actualCovers }} covers</span></div>
              <span :class="['chip', dayStatus(d) ?? 'warning']">{{ dayStatusLabel(dayStatus(d)) }}</span>
            </template>
            <template v-else>
              <div class="day-actual quiet">Not yet happened</div>
            </template>
          </div>
        </div>

        <div class="quiet-note" v-if="!weeklyTargets.benchmarkAmount">Set a weekly revenue goal below to see day-specific dollar/covers targets.</div>
        <div class="quiet-note" v-else-if="weeklyTargets.sampleOpenDays < 6">Based on only {{ weeklyTargets.sampleOpenDays }} real open day{{ weeklyTargets.sampleOpenDays === 1 ? '' : 's' }} since the location move ({{ formatWeekdayDate(weeklyTargets.sinceDate) }}) — the weekday pattern will sharpen as more data accumulates.</div>

        <form class="benchmark-form" @submit.prevent="submitBenchmark">
          <div class="benchmark-form-row">
            <label>Weekly revenue goal<input type="number" step="1" min="1" v-model.number="benchmarkAmount" placeholder="50000" required /></label>
            <button type="submit" :disabled="benchmarkSubmitting">{{ benchmarkSubmitting ? 'Saving…' : 'Update goal' }}</button>
            <span v-if="benchmarkError" class="chip critical">{{ benchmarkError }}</span>
            <span v-else-if="benchmarkSaved" class="chip good">Goal updated</span>
          </div>
          <div class="section-note" v-if="weeklyTargets.avgSpendPerCover">
            Covers targets use a real avg spend/cover of ${{ weeklyTargets.avgSpendPerCover.toFixed(2) }}, computed the same way, since {{ formatWeekdayDate(weeklyTargets.sinceDate) }}.
          </div>
          <div class="section-note" v-if="weeklyTargets.suggestedWeeklyGoal.amount">
            Data-driven suggestion: to cover this month's Labor (${{ Math.round(weeklyTargets.suggestedWeeklyGoal.laborMonthEstimate).toLocaleString() }}) + Opex (${{ Math.round(weeklyTargets.suggestedWeeklyGoal.opexMonthEstimate).toLocaleString() }}) + loan principal due (${{ Math.round(weeklyTargets.suggestedWeeklyGoal.principalDueThisMonth).toLocaleString() }}) at a {{ (weeklyTargets.suggestedWeeklyGoal.cogsPct * 100).toFixed(0) }}% COGS ratio ({{ weeklyTargets.suggestedWeeklyGoal.cogsPctSource === 'benchmark' ? 'from your COGS benchmark' : 'trailing actual' }}), you'd need at least <strong>${{ Math.round(weeklyTargets.suggestedWeeklyGoal.amount).toLocaleString() }}/week</strong> this month.
          </div>
        </form>
      </section>

      <!-- COGS / labor vs revenue -->
      <section>
        <div class="section-label">Cost Pace — Month to Date</div>
        <div v-if="costPaceMeters.length" class="meter-row">
          <div v-for="m in costPaceMeters" :key="m.key" :class="['meter-card', m.key === 'prime' && 'anchor']">
            <div class="meter-head">
              <span class="name">{{ m.label }}<span v-if="m.hint" class="hint"> {{ m.hint }}</span></span>
              <span class="value" :style="{ color: `var(--${m.status ?? 'ink-3'})` }">{{ m.pct.toFixed(1) }}%</span>
            </div>
            <div class="meter-track">
              <div class="meter-marker" :style="{ left: Math.min(100, (m.pct / m.scaleMax) * 100) + '%', background: `var(--${m.status ?? 'ink-3'})` }"></div>
            </div>
            <div class="meter-scale"><span>0%</span><span>{{ m.scaleMax / 2 }}%</span><span>{{ m.scaleMax }}%</span></div>
            <div class="meter-foot">
              <span v-if="m.benchmark">Target: &le;{{ (m.benchmark.targetPct * 100).toFixed(0) }}% of revenue</span>
              <span v-else>No benchmark set</span>
              <span :class="['chip', m.status ?? 'warning']">{{ meterStatusLabel(m.status) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="quiet-note">No revenue recorded this month yet.</div>
      </section>

      <!-- Are we on target to meet budget? -->
      <section>
        <div class="section-label">Budget Runway — Actual vs. Expected Pace</div>

        <div class="runway-card" v-if="monthView?.hasBudget">
          <div class="runway-head">
            <span class="name">Month revenue</span>
            <span class="nums">${{ Math.round(monthView.revenue!.actual).toLocaleString() }} actual &middot; ${{ Math.round(monthView.revenue!.target).toLocaleString() }} month target</span>
          </div>
          <div class="runway-track">
            <div :class="['runway-fill', monthView.revenue!.status]" :style="{ width: monthView.revenue!.fillPct + '%' }"></div>
            <div class="runway-expected" :style="{ left: monthView.revenue!.expectedPct + '%' }"></div>
          </div>
          <div class="runway-foot">
            <span>$0</span>
            <span :class="['chip', monthView.revenue!.status]">{{ monthView.revenue!.paceOfExpectedPct !== null ? `${monthView.revenue!.paceOfExpectedPct.toFixed(1)}% of expected pace` : '—' }}</span>
            <span>${{ Math.round(monthView.revenue!.target).toLocaleString() }}</span>
          </div>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning">No budget set</span>
          <span class="quiet-note">Enter a revenue target for this month on the Edit Budget tab to see runway here.</span>
        </div>

        <div class="runway-card" v-if="yearView?.hasBudget">
          <div class="runway-head">
            <span class="name">{{ data.asOfYear }} revenue</span>
            <span class="nums">${{ Math.round(yearView.revenue!.actual).toLocaleString() }} actual &middot; ${{ Math.round(yearView.revenue!.target).toLocaleString() }} annual target</span>
          </div>
          <div class="runway-track">
            <div :class="['runway-fill', yearView.revenue!.status]" :style="{ width: yearView.revenue!.fillPct + '%' }"></div>
            <div class="runway-expected" :style="{ left: yearView.revenue!.expectedPct + '%' }"></div>
          </div>
          <div class="runway-foot">
            <span>$0</span>
            <span :class="['chip', yearView.revenue!.status]">{{ yearView.revenue!.paceOfExpectedPct !== null ? `${yearView.revenue!.paceOfExpectedPct.toFixed(1)}% of expected pace` : '—' }}</span>
            <span>${{ Math.round(yearView.revenue!.target).toLocaleString() }}</span>
          </div>
          <div class="quiet-note" v-if="data.yearToDate.unbudgetedPastMonthCount > 0">
            {{ data.yearToDate.unbudgetedPastMonthCount }} month{{ data.yearToDate.unbudgetedPastMonthCount === 1 ? '' : 's' }} this year {{ data.yearToDate.unbudgetedPastMonthCount === 1 ? 'has' : 'have' }} no revenue budget set — the annual target above uses actual revenue for those months instead.
          </div>
        </div>
        <div v-else class="drill-card quiet">
          <span class="chip warning">No budget set</span>
          <span class="quiet-note">Enter revenue targets for {{ data.asOfYear }} on the Edit Budget tab to see runway here.</span>
        </div>
      </section>

      <!-- Sales / Labor Hour — moved down from Last Night 2026-08-19 -->
      <section>
        <div class="section-label">Sales / Labor Hour — Last Night</div>
        <div class="stat-row single">
          <div class="compare-card anchor">
            <div class="date-label">Sales / Labor Hour</div>
            <div class="amount">{{ salesPerLaborHour !== null ? `$${salesPerLaborHour.toFixed(2)}` : '—' }}</div>
            <div class="vs-label">{{ toastSynced ? `${lastNightLaborHours!.toFixed(1)} labor hours worked, ${formatWeekdayDate(data.asOfDate)}` : `No Toast data synced for ${formatWeekdayDate(data.asOfDate)} yet` }}</div>
          </div>
        </div>
      </section>

      <div class="legend">
        <span class="chip good">On / ahead of target</span>
        <span class="chip warning">Watch</span>
        <span class="chip serious">Off pace</span>
        <span class="chip critical">Over / under target</span>
      </div>

      <footer>
        <span>Data source: QuickBooks Online + Toast POS, both synced nightly</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }
.drill-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px;
}
.drill-card.quiet { flex-direction: row; align-items: center; gap: 10px; padding: 12px 16px; margin-top: 10px; }
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
.toast-note { margin-top: 8px; font-size: 11.5px; color: var(--ink-3); font-style: italic; }

/* ---------- hero row: month / year status ---------- */
.hero-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.hero-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hero-card.anchor { background: var(--accent-wash); border-color: transparent; }
.hero-card .hero-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}
.hero-card .period { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.hero-card .figure {
  font-size: 34px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.hero-card .caption { font-size: 12px; color: var(--ink-3); }

/* ---------- comparison strip ---------- */
.compare-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 12px;
}
.compare-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.compare-card.anchor { background: var(--accent-wash); border-color: transparent; }
.compare-card .date-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.compare-card.anchor .date-label { color: var(--accent); }
.compare-card .amount {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.delta.up { color: var(--good); }
.delta.down { color: var(--critical); }
.compare-card .vs-label { font-size: 12px; color: var(--ink-3); }

/* ---------- guest-economics row (sales per labor hour) ---------- */
.stat-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin-top: 8px;
}
.stat-row.single { grid-template-columns: 1fr; }

/* ---------- Weekly Performance: week-to-date hero + day cards ---------- */
.hero-row.single { grid-template-columns: 1fr; }
.week-day-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
  margin-top: 12px;
}
.day-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 14px;
  box-shadow: var(--card-shadow);
  padding: 12px 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.day-card.upcoming { opacity: 0.7; }
.day-card .day-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-3);
}
.day-card .day-target { font-size: 11px; color: var(--ink-3); }
.day-card .day-actual {
  font-size: 17px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.day-card .day-actual.quiet { font-size: 12px; font-weight: 500; color: var(--ink-3); }

.benchmark-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--hair);
  margin-top: 14px;
  padding-top: 12px;
}
.benchmark-form-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
.benchmark-form label {
  display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 600; color: var(--ink-3);
}
.benchmark-form input[type="number"] {
  font-size: 13px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--hair);
  background: var(--surface); color: var(--ink); width: 150px;
}
.benchmark-form button {
  font-size: 12px; font-weight: 700; padding: 7px 14px; border-radius: 100px; border: none;
  background: var(--accent); color: white; cursor: pointer;
}
.benchmark-form button:disabled { opacity: 0.6; cursor: default; }
.benchmark-form .section-note { font-size: 12px; color: var(--ink-3); line-height: 1.5; }

/* ---------- pace meters (COGS / labor / prime cost) ---------- */
.meter-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
.meter-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
}
.meter-card.anchor { background: var(--accent-wash); border-color: transparent; }
.meter-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.meter-head .name { font-size: 14px; font-weight: 700; }
.meter-head .name .hint { font-size: 11px; font-weight: 500; color: var(--ink-3); }
.meter-head .value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.meter-track {
  position: relative;
  height: 10px;
  border-radius: 6px;
  background: var(--surface-alt);
  margin: 6px 0 8px;
}
.meter-marker {
  position: absolute;
  top: -3px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--ink);
}
.meter-scale {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.meter-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-2);
}

/* ---------- budget runway bars ---------- */
.runway-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}
.runway-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.runway-head .name { font-size: 14px; font-weight: 700; }
.runway-head .nums {
  font-size: 12px;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
/* margin-top clears room for .runway-expected::after's "today's target"
   label below, which sits 22px above this track's own top (-4px tick
   position + -18px label offset) — the .runway-card flex gap alone (10px)
   wasn't enough, so the label overlapped .runway-head's actual/target text
   above (same bug as budget/index.vue's pace cards). */
.runway-track {
  position: relative;
  height: 22px;
  margin-top: 14px;
  border-radius: 8px;
  background: var(--surface-alt);
  overflow: visible;
}
.runway-fill {
  position: absolute;
  top: 0; bottom: 0; left: 0;
  border-radius: 8px;
}
.runway-fill.good { background: var(--good); }
.runway-fill.warning { background: var(--warning); }
.runway-fill.serious { background: var(--serious); }
.runway-fill.critical { background: var(--critical); }
.runway-expected {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 30px;
  background: var(--ink);
  opacity: 0.55;
}
.runway-expected::after {
  content: "today's target";
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  white-space: nowrap;
  color: var(--ink-3);
  font-weight: 600;
}
.runway-foot {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ink-3);
}

@media (max-width: 760px) {
  .hero-row, .meter-row { grid-template-columns: 1fr; }
  .compare-row, .stat-row { grid-template-columns: 1fr 1fr; }
  .week-day-row { grid-template-columns: 1fr 1fr; }
}
</style>
