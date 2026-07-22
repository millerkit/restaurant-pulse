<script setup lang="ts">
import site from '~/config/site.json'
import { AS_OF_DAY, AS_OF_MONTH, CATEGORIES, CATEGORY_DIRECTION, CATEGORY_LABEL, MONTH_NAMES, YEAR, type BudgetAccount, type Category, daysInMonth, netIncome, paceStatus, sampleActuals, useBudgetYear, useSyncStatus } from '~/composables/useBudgetData'

useHead({ title: `${site.restaurantName} — Edit Budget` })

const { lastSync, syncFailed } = useSyncStatus()
const { monthlyData, loadError, loadYear } = useBudgetYear()

function monthHasBudget(month: number) {
  const data = monthlyData.value[month - 1]
  return !!data && data.accounts.some(a => a.amount !== null)
}

// ---- Edit Monthly Budget ------------------------------------------------
const editMonth = ref(AS_OF_MONTH)
const editMonthData = computed(() => monthlyData.value[editMonth.value - 1])
const expandedCategory = ref<Category | null>(null)
const editableAccountAmounts = ref<Record<number, string>>({})

watch(editMonthData, (data) => {
  if (!data) return
  editableAccountAmounts.value = {}
  for (const acc of data.accounts) {
    if (acc.amount !== null) editableAccountAmounts.value[acc.accountId] = acc.amount.toFixed(2)
  }
}, { immediate: true })

// Chart-of-accounts order: account numbers are assigned so that sorting
// numerically already puts every account directly after its parent and
// before its siblings' children (verified against the real xlsx import —
// see CLAUDE.md's Budget tab section), so no separate tree-building pass
// is needed to get the QBO ordering shown in its own budget UI/export.
// Accounts without a number (QBO system accounts like "Uncategorized
// Income") sort to the end.
function accountsForCategory(cat: Category) {
  return (editMonthData.value?.accounts || [])
    .filter(a => a.category === cat && accountVisible(a))
    .sort((a, b) => {
      const an = a.accountNumber !== null ? Number(a.accountNumber) : Infinity
      const bn = b.accountNumber !== null ? Number(b.accountNumber) : Infinity
      return an !== bn ? an - bn : a.name.localeCompare(b.name)
    })
}

const editMonthAccountsById = computed(() => {
  const map = new Map<number, BudgetAccount>()
  for (const acc of editMonthData.value?.accounts || []) map.set(acc.accountId, acc)
  return map
})

// Indentation depth for the hierarchical display below — walks the
// parent_account_id chain (same data QBO's own budget UI uses to render
// its indented tree) rather than any depth stored on the account itself.
function accountDepth(acc: BudgetAccount): number {
  let depth = 0
  let current: BudgetAccount | undefined = acc
  const seen = new Set<number>()
  while (current?.parentAccountId != null && !seen.has(current.parentAccountId)) {
    seen.add(current.parentAccountId)
    current = editMonthAccountsById.value.get(current.parentAccountId)
    if (!current) break
    depth++
  }
  return depth
}

// Only leaf accounts (no children) are directly editable. Every account
// that has children — including the category row itself, treated as the
// implicit parent of that category's root accounts — is read-only and
// always shows the sum of its *direct* children, recursively: a mid-tree
// subtotal is itself just its own children's sum, so the number at any
// level is never independently entered or capable of disagreeing with
// what's below it (matching how QBO's own budget UI displays it — see
// CLAUDE.md's Budget tab section).
function directChildren(accountId: number): BudgetAccount[] {
  return (editMonthData.value?.accounts || []).filter(a => a.parentAccountId === accountId)
}

function isLeafAccount(acc: BudgetAccount): boolean {
  return directChildren(acc.accountId).length === 0
}

function computedAccountAmount(acc: BudgetAccount): number {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return Number(editableAccountAmounts.value[acc.accountId] || 0)
  return children.reduce((sum, c) => sum + computedAccountAmount(c), 0)
}

function categoryComputedTotal(cat: Category): number {
  const roots = (editMonthData.value?.accounts || []).filter(a => a.category === cat && a.parentAccountId === null)
  return roots.reduce((sum, a) => sum + computedAccountAmount(a), 0)
}

// ---- Row filters: hide accounts with no budget history --------------------
// Pure declutter toggles — they only affect which rows are drawn, never
// what's summed into a total (categoryComputedTotal/computedAccountAmount
// above always include every account regardless of visibility) or what's
// saved. Both compare against *stored* amounts, not live unsaved edits, so
// a row never vanishes mid-edit just because you cleared it to retype a
// number.
const hideNoPriorMonthBudget = ref(false)
const hideNoCurrentMonthBudget = ref(false)
const previousMonthLabel = computed(() => editMonth.value > 1 ? MONTH_NAMES[editMonth.value - 2] : null)
const previousMonthAccountsById = computed(() => {
  const map = new Map<number, BudgetAccount>()
  const prevData = editMonth.value > 1 ? monthlyData.value[editMonth.value - 2] : null
  if (!prevData) return map
  for (const acc of prevData.accounts) map.set(acc.accountId, acc)
  return map
})

function hasNoStoredAmount(amount: number | null): boolean {
  return amount === null || amount === 0
}

function leafVisible(acc: BudgetAccount): boolean {
  if (hideNoPriorMonthBudget.value && previousMonthAccountsById.value.size > 0) {
    const prevAmount = previousMonthAccountsById.value.get(acc.accountId)?.amount ?? null
    if (hasNoStoredAmount(prevAmount)) return false
  }
  if (hideNoCurrentMonthBudget.value && hasNoStoredAmount(acc.amount)) return false
  return true
}

// A parent account stays visible as long as at least one descendant leaf
// is still visible — otherwise its own bold subtotal would be showing a
// tree with nothing left under it.
function accountVisible(acc: BudgetAccount): boolean {
  const children = directChildren(acc.accountId)
  if (children.length === 0) return leafVisible(acc)
  return children.some(accountVisible)
}

// ---- Live pace preview ---------------------------------------------------
// The Budget Pace tab's Month/Year toggle only ever answers "how's *now*
// pacing" — there's no actuals to pace a future month against, so a full
// live sync between this page and that one would mostly show meaningless
// numbers. But when you're editing the current as-of month specifically,
// showing the effect of an in-progress (unsaved) edit is genuinely useful,
// so this recomputes a compact version of that page's pace cards straight
// from the draft values above, gated to only the one month where it means
// anything.
const showLivePace = computed(() => editMonth.value === AS_OF_MONTH)
const livePaceExpectedPct = computed(() => (AS_OF_DAY / daysInMonth(YEAR, AS_OF_MONTH)) * 100)
const livePaceCards = computed(() => (['revenue', 'cogs', 'labor', 'opex'] as const).map(cat => {
  const actual = sampleActuals.month[cat]
  const budget = categoryComputedTotal(cat)
  if (!budget) return { category: cat, label: CATEGORY_LABEL[cat], noBudget: true as const, actual, budget }
  const actualPct = (actual / budget) * 100
  const status = paceStatus(actualPct, livePaceExpectedPct.value, CATEGORY_DIRECTION[cat])
  return { category: cat, label: CATEGORY_LABEL[cat], noBudget: false as const, actual, budget, actualPct, status }
}))
const liveDraftNetIncome = computed(() => netIncome({
  revenue: categoryComputedTotal('revenue'),
  cogs: categoryComputedTotal('cogs'),
  labor: categoryComputedTotal('labor'),
  opex: categoryComputedTotal('opex')
}))

// ---- COGS % of revenue (Food/Beverage trailing average) ----------------
// COGS is fundamentally a variable cost — it scales with revenue, the
// menu, and month-to-month inventory timing, unlike rent or a salary — so
// a fixed dollar guess for a future month is closer to a coin flip than a
// real budget (raised by the user, not an assumption baked in unasked).
// Instead: track Food and Beverage COGS as a % of revenue (matching
// accounts.subcategory — see schema.sql — and matching how MarginEdge
// already budgets this, per product-strategy-notes.md), based on a
// trailing average of *past* months rather than any single month, so one
// lumpy ingredient delivery doesn't single-handedly reset the target.
// Deliberately excludes 'Other' COGS (packaging, catering equipment,
// retail) — those don't scale with revenue the same way and stay
// manually edited via the category/account rows above.
//
// This uses real budget_targets figures for past months, not the sample
// actuals figure used elsewhere on this page — this restaurant has been
// updating its QBO "budget" with real numbers as each month closed (see
// CLAUDE.md), so those rows are the closest thing to real actuals this
// app has for a past month.
const COGS_TRAILING_WINDOW = 3

function trailingMonthsWithData(targetMonth: number, count = COGS_TRAILING_WINDOW): number[] {
  const months: number[] = []
  for (let m = targetMonth - 1; m >= 1 && months.length < count; m--) {
    const data = monthlyData.value[m - 1]
    if (data && data.accounts.some(a => a.category === 'revenue' && a.amount !== null)) months.push(m)
  }
  return months.reverse()
}

function cogsGroupPctOverMonths(monthNumbers: number[], group: 'Food' | 'Beverage'): number | null {
  let groupTotal = 0
  let revenueTotal = 0
  for (const m of monthNumbers) {
    const data = monthlyData.value[m - 1]
    if (!data) continue
    for (const acc of data.accounts) {
      if (acc.amount === null) continue
      if (acc.category === 'revenue') revenueTotal += acc.amount
      if (acc.category === 'cogs' && acc.subcategory === group) groupTotal += acc.amount
    }
  }
  return revenueTotal > 0 ? groupTotal / revenueTotal : null
}

const cogsTrailingMonths = computed(() => trailingMonthsWithData(editMonth.value))
const cogsTrailingLabel = computed(() => cogsTrailingMonths.value.map(m => MONTH_NAMES[m - 1]).join('–'))
const cogsTrailingFoodPct = computed(() => cogsGroupPctOverMonths(cogsTrailingMonths.value, 'Food'))
const cogsTrailingBeveragePct = computed(() => cogsGroupPctOverMonths(cogsTrailingMonths.value, 'Beverage'))

const cogsRecomputeStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const cogsRecomputeMessage = ref('')

async function recomputeCogsFromTrailingAverage() {
  cogsRecomputeStatus.value = 'running'
  try {
    const data = editMonthData.value
    if (!data) throw new Error('Budget data not loaded yet')
    const revenueBudget = data.accounts
      .filter(a => a.category === 'revenue' && a.amount !== null)
      .reduce((sum, a) => sum + (a.amount || 0), 0)
    if (!revenueBudget) throw new Error(`Set a Revenue budget for ${MONTH_NAMES[editMonth.value - 1]} first`)

    const months = cogsTrailingMonths.value
    if (months.length === 0) throw new Error('No prior months with revenue and COGS data to average from')

    const targets: { year: number, month: number, accountId: number, amount: number }[] = []
    const summary: string[] = []
    for (const group of ['Food', 'Beverage'] as const) {
      const pct = group === 'Food' ? cogsTrailingFoodPct.value : cogsTrailingBeveragePct.value
      if (pct === null) continue
      const groupBudget = pct * revenueBudget
      const accounts = data.accounts.filter(a => a.category === 'cogs' && a.subcategory === group)
      if (accounts.length === 0) continue
      const oldTotal = accounts.reduce((sum, a) => sum + (a.amount || 0), 0)
      for (const a of accounts) {
        const weight = oldTotal > 0 ? (a.amount || 0) / oldTotal : 1 / accounts.length
        targets.push({ year: YEAR, month: editMonth.value, accountId: a.accountId, amount: Math.round(groupBudget * weight * 100) / 100 })
      }
      summary.push(`${group} ${(pct * 100).toFixed(1)}% → $${Math.round(groupBudget).toLocaleString()}`)
    }
    if (targets.length === 0) throw new Error('No Food/Beverage COGS accounts found to recompute')

    await $fetch('/api/budget/targets', { method: 'POST', body: { targets } })
    await loadYear()
    cogsRecomputeMessage.value = `Recomputed ${MONTH_NAMES[editMonth.value - 1]} COGS from trailing average (${cogsTrailingLabel.value}): ${summary.join(', ')}.`
    cogsRecomputeStatus.value = 'done'
  } catch (err: any) {
    cogsRecomputeStatus.value = 'error'
    cogsRecomputeMessage.value = err?.data?.statusMessage || err?.message || 'Recompute failed'
  }
}

const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveMessage = ref('')

async function saveBudgets() {
  saveStatus.value = 'saving'
  try {
    const data = editMonthData.value
    if (!data) throw new Error('Budget data not loaded yet')
    const targets: { year: number, month: number, accountId: number, amount: number }[] = []

    // Only leaf accounts have anything to save — every parent account's
    // number is derived (see computedAccountAmount above), never entered,
    // so there's nothing of its own to write.
    for (const acc of data.accounts) {
      if (!isLeafAccount(acc)) continue
      const raw = editableAccountAmounts.value[acc.accountId]
      const newAmount = raw === undefined || raw === '' ? 0 : Number(raw)
      if (Math.abs(newAmount - (acc.amount ?? 0)) >= 0.005) {
        targets.push({ year: YEAR, month: editMonth.value, accountId: acc.accountId, amount: newAmount })
      }
    }

    if (targets.length === 0) {
      saveStatus.value = 'idle'
      return
    }
    await $fetch('/api/budget/targets', { method: 'POST', body: { targets } })
    await loadYear()
    saveStatus.value = 'saved'
  } catch (err: any) {
    saveStatus.value = 'error'
    saveMessage.value = err?.data?.statusMessage || err?.message || 'Save failed'
  }
}

// ---- Update/project from actuals ---------------------------------------
const actionStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const actionMessage = ref('')

async function updateThisMonthFromActuals() {
  actionStatus.value = 'running'
  try {
    const result = await $fetch('/api/budget/copy-actuals', {
      method: 'POST',
      body: { sourceYear: YEAR, sourceMonth: editMonth.value, targetMonths: [{ year: YEAR, month: editMonth.value }] }
    })
    actionMessage.value = `Updated ${result.accountsCopied} accounts for ${MONTH_NAMES[editMonth.value - 1]} from actuals.`
    actionStatus.value = 'done'
    await loadYear()
  } catch (err: any) {
    actionStatus.value = 'error'
    actionMessage.value = err?.data?.statusMessage || err?.message || 'No actuals available yet'
  }
}

async function projectRemainingMonths() {
  actionStatus.value = 'running'
  try {
    const targetMonths = Array.from({ length: 12 - AS_OF_MONTH }, (_, i) => ({ year: YEAR, month: AS_OF_MONTH + 1 + i }))
    const result = await $fetch('/api/budget/copy-actuals', {
      method: 'POST',
      body: { sourceYear: YEAR, sourceMonth: AS_OF_MONTH, targetMonths }
    })
    actionMessage.value = `Projected ${result.accountsCopied} accounts across ${targetMonths.length} remaining months from ${MONTH_NAMES[AS_OF_MONTH - 1]} actuals.`
    actionStatus.value = 'done'
    await loadYear()
  } catch (err: any) {
    actionStatus.value = 'error'
    actionMessage.value = err?.data?.statusMessage || err?.message || 'No actuals available yet'
  }
}

function exportForQuickBooks() {
  window.open(`/api/budget/export?year=${YEAR}`, '_blank')
}
</script>

<template>
  <div>
    <header>
      <div>
        <h1>{{ site.restaurantName }} — Edit Budget</h1>
        <div class="sub">Edit any month's budget, update from actuals, or export for QuickBooks &middot; {{ YEAR }}</div>
      </div>
      <div class="as-of">
        <span :class="['chip', syncFailed ? 'critical' : 'good']"><span class="dot"></span>{{ syncFailed ? 'Sync failed' : 'Sync healthy' }}</span>
        <div class="sync-line">
          <template v-if="!syncFailed">Last synced from QuickBooks: <strong>{{ lastSync.finishedAt }}</strong></template>
          <template v-else>Sync failed — showing data through <strong>{{ lastSync.dataThroughDate }}</strong></template>
        </div>
        <span class="sample-tag">Actuals are sample data — budgets are real</span>
      </div>
    </header>

    <div v-if="loadError" class="drill-card">
      <span class="chip critical"><span class="dot"></span>Couldn't load budget data</span>
      <span class="quiet-note">{{ loadError }}</span>
    </div>

    <template v-else>
      <section>
        <div class="section-head">
          <div class="section-label">Edit Monthly Budget</div>
          <div class="filter-tabs">
            <button
              type="button" class="filter-tab" :class="{ active: hideNoPriorMonthBudget }"
              :disabled="!previousMonthLabel" :title="previousMonthLabel ? undefined : 'No prior month to compare'"
              @click="hideNoPriorMonthBudget = !hideNoPriorMonthBudget"
            >Hide $0 in {{ previousMonthLabel || '—' }}</button>
            <button
              type="button" class="filter-tab" :class="{ active: hideNoCurrentMonthBudget }"
              @click="hideNoCurrentMonthBudget = !hideNoCurrentMonthBudget"
            >Hide $0 in {{ MONTH_NAMES[editMonth - 1] }}</button>
          </div>
        </div>

        <div v-if="showLivePace" class="live-pace-card">
          <div class="live-pace-head">
            <span class="chip accent"><span class="dot"></span>Live preview</span>
            <span class="quiet-note">How {{ MONTH_NAMES[editMonth - 1] }}'s pace looks with your unsaved edits below — the only month with actuals to pace against.</span>
          </div>
          <div class="live-pace-grid">
            <div v-for="card in livePaceCards" :key="card.category" class="live-pace-item">
              <span class="name">{{ card.label }}</span>
              <span v-if="card.noBudget" class="chip warning"><span class="dot"></span>No budget</span>
              <span v-else :class="['chip', card.status]"><span class="dot"></span>{{ card.actualPct.toFixed(1) }}% of budget</span>
            </div>
          </div>
          <div class="live-pace-net">
            Net income (draft): <strong :class="liveDraftNetIncome >= 0 ? 'good' : 'critical'">{{ liveDraftNetIncome >= 0 ? '+' : '' }}${{ Math.round(liveDraftNetIncome).toLocaleString() }}</strong>
          </div>
        </div>

        <div class="pl-table-card">
          <div class="month-tabs">
            <button
              v-for="(name, i) in MONTH_NAMES" :key="name"
              type="button"
              :class="['month-tab', editMonth === i + 1 && 'active', !monthHasBudget(i + 1) && 'unbudgeted']"
              @click="editMonth = i + 1"
            >{{ name }}</button>
          </div>
          <table class="pl-table edit-table">
            <tbody>
              <template v-for="cat in CATEGORIES" :key="cat">
                <tr>
                  <th scope="row">
                    <button class="expand-toggle" @click="expandedCategory = expandedCategory === cat ? null : cat">
                      {{ expandedCategory === cat ? '▾' : '▸' }} {{ CATEGORY_LABEL[cat] }}
                    </button>
                  </th>
                  <td><span class="amount-input readonly">{{ categoryComputedTotal(cat).toFixed(2) }}</span></td>
                </tr>
                <template v-if="expandedCategory === cat">
                  <tr v-for="acc in accountsForCategory(cat)" :key="acc.accountId" class="account-row" :class="{ 'group-header': !isLeafAccount(acc) }">
                    <th scope="row" :style="{ paddingLeft: (28 + accountDepth(acc) * 16) + 'px' }">
                      <span class="account-label">{{ acc.accountNumber ? `${acc.accountNumber} ` : '' }}{{ acc.name }}</span>
                    </th>
                    <td>
                      <input v-if="isLeafAccount(acc)" type="number" step="0.01" class="amount-input" v-model="editableAccountAmounts[acc.accountId]" placeholder="0.00" />
                      <span v-else class="amount-input readonly">{{ computedAccountAmount(acc).toFixed(2) }}</span>
                    </td>
                  </tr>
                </template>
                <tr v-if="cat === 'cogs'" class="cogs-avg-row">
                  <td colspan="2">
                    <div class="section-note">
                      COGS is variable — it scales with revenue, not a fixed dollar guess. Trailing
                      {{ cogsTrailingMonths.length || 0 }}-mo avg<template v-if="cogsTrailingLabel"> ({{ cogsTrailingLabel }})</template>:
                      Food <strong>{{ cogsTrailingFoodPct !== null ? (cogsTrailingFoodPct * 100).toFixed(1) + '%' : 'n/a' }}</strong>,
                      Beverage <strong>{{ cogsTrailingBeveragePct !== null ? (cogsTrailingBeveragePct * 100).toFixed(1) + '%' : 'n/a' }}</strong>
                      of revenue.
                      <button class="mini-btn" :disabled="cogsRecomputeStatus === 'running'" @click="recomputeCogsFromTrailingAverage">
                        Recompute {{ MONTH_NAMES[editMonth - 1] }} COGS from this average
                      </button>
                      <span v-if="cogsRecomputeStatus === 'done'" class="chip good"><span class="dot"></span>{{ cogsRecomputeMessage }}</span>
                      <span v-if="cogsRecomputeStatus === 'error'" class="chip warning"><span class="dot"></span>{{ cogsRecomputeMessage }}</span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div class="action-row">
          <button class="action-btn primary" :disabled="saveStatus === 'saving'" @click="saveBudgets">Save budget</button>
          <button class="action-btn" :disabled="actionStatus === 'running'" @click="updateThisMonthFromActuals">Update this month from actuals</button>
          <button class="action-btn" :disabled="actionStatus === 'running'" @click="projectRemainingMonths">Project remaining months from {{ MONTH_NAMES[AS_OF_MONTH - 1] }} actuals</button>
          <button class="action-btn" @click="exportForQuickBooks">Export for QuickBooks</button>
        </div>
        <div v-if="saveStatus === 'saved'" class="chip good"><span class="dot"></span>Saved</div>
        <div v-if="saveStatus === 'error'" class="chip critical"><span class="dot"></span>{{ saveMessage }}</div>
        <div v-if="actionStatus === 'done'" class="chip good"><span class="dot"></span>{{ actionMessage }}</div>
        <div v-if="actionStatus === 'error'" class="chip warning"><span class="dot"></span>{{ actionMessage }}</div>
      </section>
    </template>

    <div class="legend">
      <span class="chip good"><span class="dot"></span>On / ahead of budget</span>
      <span class="chip warning"><span class="dot"></span>Watch</span>
      <span class="chip serious"><span class="dot"></span>Off pace</span>
      <span class="chip critical"><span class="dot"></span>Over / under budget</span>
    </div>

    <footer>
      <span>Actuals: illustrative sample data &middot; Budgets: real data imported from QuickBooks' budget export</span>
      <span>{{ site.restaurantName }} Performance Dashboard — v0 mockup</span>
    </footer>
  </div>
</template>

<style scoped>
.drill-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.quiet-note { font-size: 12.5px; color: var(--ink-2); }

/* ---------- row filter toggles ---------- */
.filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-tab {
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  padding: 4px 11px;
  border-radius: 100px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink-3);
  cursor: pointer;
}
.filter-tab.active { background: var(--accent-wash); color: var(--accent); border-color: transparent; }
.filter-tab:disabled { opacity: 0.4; cursor: default; }

/* ---------- live pace preview ---------- */
.live-pace-card {
  background: var(--accent-wash);
  border-radius: 16px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.live-pace-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 12px; }
.chip.accent { background: var(--surface); color: var(--accent); }
.live-pace-grid { display: flex; flex-wrap: wrap; gap: 10px 22px; }
.live-pace-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; }
.live-pace-net { font-size: 12.5px; color: var(--ink-2); }
.live-pace-net strong.good { color: var(--good); }
.live-pace-net strong.critical { color: var(--critical); }

/* ---------- edit table ---------- */
.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
}
.month-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 8px 0;
  border-bottom: 1px solid var(--hair);
}
.month-tab {
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  padding: 7px 14px;
  border: 1px solid var(--hair);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: var(--surface-alt);
  color: var(--ink-3);
  cursor: pointer;
  position: relative;
  top: 1px;
}
.month-tab.unbudgeted { color: var(--ink-3); opacity: 0.55; }
.month-tab.active {
  background: var(--surface);
  color: var(--ink);
  border-color: var(--hair);
  border-bottom: 1px solid var(--surface);
  opacity: 1;
}
table.edit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.edit-table th, .edit-table td { padding: 10px 16px; text-align: right; }
.edit-table th:first-child, .edit-table td:first-child { text-align: left; }
.edit-table tbody tr { border-bottom: 1px solid var(--hair); }
.edit-table tbody tr:last-child { border-bottom: none; }
.edit-table tr.account-row { background: var(--surface-alt); }
.edit-table tr.account-row th { font-weight: 500; }
.account-label { font-size: 12.5px; color: var(--ink-2); }
.edit-table tr.account-row.group-header .account-label { font-weight: 700; color: var(--ink); }
.edit-table tr.account-row.group-header .amount-input.readonly { color: var(--ink); }
.expand-toggle {
  background: none; border: none; padding: 0; font: inherit; font-weight: 600; color: var(--ink); cursor: pointer;
}
.amount-input {
  width: 120px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  text-align: right;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink);
}
.amount-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.amount-input.readonly {
  display: inline-block;
  border-color: transparent;
  background: transparent;
  color: var(--ink-2);
  font-weight: 700;
}

.edit-table tr.cogs-avg-row td { padding: 10px 16px 14px; }
.edit-table tr.cogs-avg-row .section-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  text-align: left;
  padding-left: 0;
  margin-top: 0;
}
.mini-btn {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--accent);
  cursor: pointer;
}
.mini-btn:disabled { opacity: 0.5; cursor: default; }

.action-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.action-btn {
  font-size: 12.5px;
  font-weight: 700;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--hair);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.action-btn.primary { background: var(--accent); color: white; border-color: transparent; }
.action-btn:disabled { opacity: 0.5; cursor: default; }

@media (max-width: 760px) {
  .month-tabs { overflow-x: auto; }
  .month-tab { padding: 7px 11px; }
}
</style>
