<script setup lang="ts">
// Upload the QBO bank register for the Loan Reserve account; shows exactly what would change
// (nothing is written until "Apply import"), then replaces the recorded transfers with the bank's.
type Change = { kind: 'same' | 'changed' | 'new' | 'opening', date: string, amount: number, note: string | null, why?: string[] }
type Removed = { id: number, date: string, amount: number, note: string | null }
type Plan = {
  applied: boolean
  endingBalance: number | null
  throughDate: string
  importedTotal: number
  tie: { ok: boolean, diff: number } | null
  savedBefore: number
  savedAfter: number
  changes: Change[]
  removed: Removed[]
  kept: Removed[]
  counts: { same: number, changed: number, new: number, removed: number }
}

const props = defineProps<{ bankSync: { throughDate: string, endingBalance: number, importedAt: string } | null }>()
const emit = defineEmits<{ (e: 'imported'): void }>()

const file = ref<File | null>(null)
const plan = ref<Plan | null>(null)
const busy = ref(false)
const error = ref('')
const done = ref('')

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const day = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const stamp = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const differences = computed(() => (plan.value?.changes ?? []).filter(c => c.kind !== 'same'))

async function send(mode: 'preview' | 'apply') {
  if (!file.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await $fetch<Plan>('/api/cashflow/bank-register', {
      method: 'POST',
      query: { mode },
      body: file.value,
      headers: { 'content-type': 'application/octet-stream' }
    })
    if (mode === 'apply') {
      done.value = `Imported. The reserve now shows ${money(res.savedAfter)}.`
      plan.value = null
      file.value = null
      emit('imported')
    } else {
      plan.value = res
      done.value = ''
    }
  } catch (err: unknown) {
    error.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Import failed.'
  } finally {
    busy.value = false
  }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  plan.value = null
  if (file.value) await send('preview')
  input.value = ''
}

function cancel() {
  plan.value = null
  file.value = null
  error.value = ''
}
</script>

<template>
  <div class="bank-import">
    <div class="bank-head">
      <strong>Import bank register</strong>
      <span class="note">
        <template v-if="props.bankSync">Bank register current through {{ day(props.bankSync.throughDate) }} (imported {{ stamp(props.bankSync.importedAt) }}).</template>
        <template v-else>Not imported yet.</template>
        Export the 1002 Loan Reserve register from QuickBooks and upload it (.xls or .xlsx). It replaces what's recorded from Jul 13 on; transfers dated after the file's last day are kept.
      </span>
    </div>
    <label class="file-pick">
      <input type="file" accept=".xls,.xlsx" :disabled="busy" @change="onFile" />
    </label>
    <span v-if="busy" class="note">Reading…</span>
    <span v-if="error" class="chip critical">{{ error }}</span>
    <span v-if="done" class="chip good">{{ done }}</span>

    <div v-if="plan" class="preview">
      <div class="tie">
        <span v-if="plan.tie?.ok" class="chip good">✓ Ties to the bank: {{ money(plan.importedTotal) }}</span>
        <span v-else-if="plan.tie" class="chip critical">▲ Doesn't tie: rows total {{ money(plan.importedTotal) }}, register says {{ money(plan.endingBalance ?? 0) }}</span>
        <span class="note">Reserve saved: {{ money(plan.savedBefore) }} now → {{ money(plan.savedAfter) }} after import</span>
      </div>
      <div class="note">
        {{ plan.counts.same }} unchanged · {{ plan.counts.changed }} corrected · {{ plan.counts.new }} added from the bank · {{ plan.counts.removed }} hand-entered row{{ plan.counts.removed === 1 ? '' : 's' }} removed
        <template v-if="plan.kept.length"> · {{ plan.kept.length }} newer than the file kept</template>
      </div>
      <table v-if="differences.length || plan.removed.length" class="cf-table transfers">
        <thead><tr><th>What</th><th>Date</th><th>Amount</th><th>Note / detail</th></tr></thead>
        <tbody>
          <tr v-for="(c, i) in differences" :key="'c' + i">
            <td>{{ c.kind === 'changed' ? 'Corrected' : c.kind === 'opening' ? 'Opening' : 'Added' }}</td>
            <td>{{ day(c.date) }}</td>
            <td :class="c.amount < 0 ? 'negative' : ''">{{ money(c.amount) }}</td>
            <td class="note">{{ c.note || '—' }}<template v-if="c.why?.length"> — {{ c.why.join('; ') }}</template></td>
          </tr>
          <tr v-for="r in plan.removed" :key="'r' + r.id">
            <td>Removed</td>
            <td>{{ day(r.date) }}</td>
            <td :class="r.amount < 0 ? 'negative' : ''">{{ money(r.amount) }}</td>
            <td class="note">{{ r.note || '—' }} — not in the bank register</td>
          </tr>
        </tbody>
      </table>
      <div class="actions">
        <button type="button" :disabled="busy || (plan.tie !== null && !plan.tie.ok)" @click="send('apply')">Apply import</button>
        <button type="button" class="secondary" :disabled="busy" @click="cancel">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bank-import { border-top: 1px dashed var(--hair); padding-top: 10px; margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.bank-head { display: flex; flex-direction: column; gap: 2px; }
.note { font-size: 12px; color: var(--ink-3); }
.tie { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.preview { display: flex; flex-direction: column; gap: 8px; }
.actions { display: flex; gap: 10px; }
button { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--hair); background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
button.secondary { background: transparent; color: var(--ink); }
button:disabled { opacity: 0.6; cursor: default; }
.cf-table.transfers { width: 100%; border-collapse: collapse; }
.cf-table.transfers th, .cf-table.transfers td { padding: 6px 10px; font-size: 12px; text-align: left; white-space: normal; border-bottom: 1px solid var(--hair); }
.cf-table.transfers td.negative { color: var(--critical-text); }
.cf-table.transfers td.note { color: var(--ink-3); }
</style>
