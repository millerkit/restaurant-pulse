<script setup lang="ts">
// Settings › Benefits eligibility rules and Owner pay accounts (2026-11-09), moved out of code
// (server/api/staff-hours.get.ts constants) and hand-run SQL (accounts.is_owner_compensation).
type Kind = 'salaried' | 'grandfathered' | 'excluded'
const KIND_LABELS: Record<Kind, string> = {
  salaried: 'Salaried: always eligible, listed by name only',
  grandfathered: 'Grandfathered: eligible whatever their hours',
  excluded: 'Shared login, not a person: leave out of the report'
}
type Override = { nameKey: string, kind: Kind, name: string | null }
const { data, refresh } = await useFetch<{ overrides: Override[], employees: { guid: string, name: string }[] }>('/api/settings/staff-overrides')
type OwnerAcct = { id: number, accountNumber: string | null, name: string, isOwnerPay: boolean }
const { data: pay, refresh: refreshPay } = await useFetch<{ accounts: OwnerAcct[] }>('/api/settings/owner-pay')

const guid = ref('')
const kind = ref<Kind>('salaried')
const message = ref<{ kind: 'ok' | 'error', text: string } | null>(null)
const busy = ref(false)

async function run(fn: () => Promise<unknown>, ok: string) {
  busy.value = true
  message.value = null
  try { await fn(); message.value = { kind: 'ok', text: ok } }
  catch (err: any) { message.value = { kind: 'error', text: err?.data?.statusMessage || err?.message || 'Could not save.' } }
  finally { busy.value = false }
}
const add = () => run(async () => {
  await $fetch('/api/settings/staff-overrides', { method: 'POST', body: { guid: guid.value, kind: kind.value } })
  guid.value = ''
  await refresh()
}, 'Saved.')
const remove = (o: Override) => run(async () => {
  await $fetch('/api/settings/staff-overrides', { method: 'DELETE', query: { nameKey: o.nameKey } })
  await refresh()
}, 'Removed.')
const toggleOwnerPay = (a: OwnerAcct, value: boolean) => run(async () => {
  await $fetch('/api/settings/owner-pay', { method: 'POST', body: { accountId: a.id, value } })
  await refreshPay()
}, 'Saved.')

const flagged = computed(() => (pay.value?.accounts ?? []).filter(a => a.isOwnerPay))
const unflagged = computed(() => (pay.value?.accounts ?? []).filter(a => !a.isOwnerPay))
const addAcct = ref<number | ''>('')

// ---- Toast jobs -> budget roles (dynamic budgeting step 4, 2026-11-12) ----
// Staffing Plan hours follow each mapped person's real Toast hours on jobs mapped to their role.
// A suggestion (title matches a role name) is preselected but only saved when "Save job mapping"
// is pressed; "Salaried / fixed pay" is a deliberate no: the job is paid a fixed salary (already in the budget), so its hours don't drive anything.
type MapAccount = { accountId: number, accountNumber: string | null, name: string, groupKey: string }
type MapJob = { guid: string, title: string, isBoh: boolean, isSaved: boolean, savedAccountId?: number | null, suggestedAccountId: number | null, recentHours: number, recentPeople: number }
const { data: mapping, refresh: refreshMapping } = await useFetch<{ accounts: MapAccount[], jobs: MapJob[] }>('/api/budget/labor-mapping')
const jobChoice = reactive<Record<string, number | 'none' | ''>>({})
watchEffect(() => {
  for (const j of mapping.value?.jobs ?? []) {
    if (j.guid in jobChoice) continue
    jobChoice[j.guid] = j.isSaved ? (j.savedAccountId ?? 'none') : (j.suggestedAccountId ?? '')
  }
})
const jobRows = computed(() => (mapping.value?.jobs ?? []).filter(j => j.recentHours > 0 || j.isSaved))
const mapAccountsFor = (isBoh: boolean) => [...(mapping.value?.accounts ?? [])].sort((a, b) => {
  const rank = (x: MapAccount) => (x.groupKey === (isBoh ? 'boh' : 'foh') ? 0 : 1)
  return rank(a) - rank(b) || (a.accountNumber ?? '').localeCompare(b.accountNumber ?? '', undefined, { numeric: true })
})
const isSuggestionOnly = (j: MapJob) => !j.isSaved && jobChoice[j.guid] !== '' && jobChoice[j.guid] === j.suggestedAccountId
const saveJobMapping = () => run(async () => {
  const jobs = jobRows.value
    .filter(j => jobChoice[j.guid] !== '')
    .map(j => ({ guid: j.guid, accountId: jobChoice[j.guid] === 'none' ? null : (jobChoice[j.guid] as number) }))
  await $fetch('/api/budget/labor-mapping', { method: 'POST', body: { jobs } })
  await refreshMapping()
}, 'Saved. The Staffing Plan hours will use these jobs.')
</script>

<template>
  <div class="sr">
    <h3 class="sr-h">Benefits eligibility rules</h3>
    <p class="sr-note">
      Eligibility normally comes from average weekly hours over 90 days. These rules are the exceptions. Pick a Toast employee and a rule; each person gets one rule.
    </p>
    <ul class="sr-list">
      <li v-for="o in data?.overrides ?? []" :key="o.nameKey">
        <div class="sr-who">
          <span class="sr-name">{{ o.name ?? o.nameKey }}</span>
          <span v-if="!o.name" class="sr-warn">No active Toast employee matches this name — check for a rename.</span>
        </div>
        <span class="sr-kind">{{ KIND_LABELS[o.kind] }}</span>
        <button type="button" class="sr-remove" :disabled="busy" @click="remove(o)">Remove</button>
      </li>
      <li v-if="!(data?.overrides?.length)" class="sr-empty">No exceptions set.</li>
    </ul>
    <form class="sr-add" @submit.prevent="add">
      <select v-model="guid" class="sr-input" aria-label="Toast employee" required>
        <option value="" disabled>Choose an employee…</option>
        <option v-for="e in data?.employees ?? []" :key="e.guid" :value="e.guid">{{ e.name }}</option>
      </select>
      <select v-model="kind" class="sr-input" aria-label="Rule">
        <option v-for="(label, k) in KIND_LABELS" :key="k" :value="k">{{ label }}</option>
      </select>
      <button type="submit" class="sr-btn" :disabled="busy || !guid">Save rule</button>
    </form>

    <h3 class="sr-h sr-gap">Owner pay accounts</h3>
    <p class="sr-note">
      Pay for the owners themselves, flagged so labor % can be shown with and without it (typical labor benchmarks assume the owners aren't on payroll).
      It still counts in labor dollars and net income. A market-rate hire, such as a general manager, shouldn't be flagged.
    </p>
    <ul class="sr-list">
      <li v-for="a in flagged" :key="a.id">
        <div class="sr-who"><span class="sr-name">{{ a.name }}</span><span v-if="a.accountNumber" class="sr-sub">{{ a.accountNumber }}</span></div>
        <button type="button" class="sr-remove" :disabled="busy" @click="toggleOwnerPay(a, false)">Unflag</button>
      </li>
      <li v-if="!flagged.length" class="sr-empty">No accounts flagged.</li>
    </ul>
    <form class="sr-add" @submit.prevent="addAcct !== '' && toggleOwnerPay(unflagged.find(a => a.id === addAcct)!, true).then(() => { addAcct = '' })">
      <select v-model="addAcct" class="sr-input" aria-label="Labor account" required>
        <option value="" disabled>Choose a labor account…</option>
        <option v-for="a in unflagged" :key="a.id" :value="a.id">{{ a.accountNumber ? `${a.accountNumber} ` : '' }}{{ a.name }}</option>
      </select>
      <button type="submit" class="sr-btn" :disabled="busy || addAcct === ''">Flag as owner pay</button>
    </form>

    <h3 class="sr-h sr-gap">Toast jobs → budget roles</h3>
    <p class="sr-note">
      The Staffing Plan can follow each person's real Toast hours (their average over the last 6 usable weeks). To do that it needs to know which Toast job
      belongs to which budget role. Pick the role for each job, or "Salaried / fixed pay" for jobs paid a set salary, such as the managers, chef and owners. Their pay is already in the budget; it just isn't tied to hours. Then match each person to their
      Toast name on the Staffing Plan.
    </p>
    <ul class="sr-list">
      <li v-for="j in jobRows" :key="j.guid">
        <div class="sr-who">
          <span class="sr-name">{{ j.title }}</span>
          <span class="sr-sub">{{ j.recentHours }} hrs, {{ j.recentPeople }} {{ j.recentPeople === 1 ? 'person' : 'people' }} in the last 12 weeks<template v-if="isSuggestionOnly(j)"> · ✚ suggested, not saved yet</template></span>
        </div>
        <select v-model="jobChoice[j.guid]" class="sr-input" :aria-label="`Budget role for ${j.title}`">
          <option value="">Not mapped yet</option>
          <option value="none">Salaried / fixed pay (no hours tracking)</option>
          <option v-for="a in mapAccountsFor(j.isBoh)" :key="a.accountId" :value="a.accountId">{{ a.accountNumber ? `${a.accountNumber} ` : '' }}{{ a.name }}</option>
        </select>
      </li>
      <li v-if="!jobRows.length" class="sr-empty">No Toast jobs with recent hours yet.</li>
    </ul>
    <button type="button" class="sr-btn" :disabled="busy || !jobRows.length" @click="saveJobMapping">Save job mapping</button>

    <div v-if="message" :class="['chip', message.kind === 'ok' ? 'good' : 'critical']" class="sr-msg">{{ message.text }}</div>
  </div>
</template>

<style scoped>
.sr-h { font-size: 15px; font-weight: 800; color: var(--ink); margin: 0 0 4px; }
.sr-gap { margin-top: 22px; }
.sr-note { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; margin: 0 0 10px; max-width: 760px; }
.sr-list { list-style: none; margin: 0 0 10px; padding: 0; max-width: 760px; background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; }
.sr-list li { display: flex; align-items: center; gap: 12px; padding: 8px 12px; font-size: 13px; flex-wrap: wrap; }
.sr-list li + li { border-top: 1px solid var(--hair); }
.sr-empty { color: var(--ink-3); }
.sr-who { flex: 1; min-width: 180px; display: flex; flex-direction: column; }
.sr-name { font-weight: 700; color: var(--ink); }
.sr-sub { font-size: 12px; color: var(--ink-3); }
.sr-warn { font-size: 12px; color: var(--ink-2); }
.sr-kind { font-size: 12.5px; color: var(--ink-2); }
.sr-input { font-size: 13px; padding: 6px 8px; border: 1px solid var(--hair); border-radius: 6px; background: var(--surface-alt); color: var(--ink); max-width: 100%; }
.sr-add { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.sr-btn { font-size: 12.5px; font-weight: 700; padding: 7px 14px; border-radius: 8px; border: none; background: var(--accent); color: white; cursor: pointer; }
.sr-btn:disabled { opacity: .5; cursor: default; }
.sr-remove { font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--hair); background: var(--surface); color: var(--accent-text); cursor: pointer; }
.sr-msg { margin-top: 8px; }
</style>
