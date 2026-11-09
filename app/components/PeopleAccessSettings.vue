<script setup lang="ts">
// Settings › People & Access (2026-11-09): who can sign in and what they see. Roles are keyed
// by email, matched against the address Cloudflare Access verifies. Adding someone here is
// not enough on its own: their email must also be on the Cloudflare Access allow-list
// (done in Cloudflare), or they can't sign in at all.
import { ROLES, ROLE_LABELS, type Role } from '../../shared/utils/access'

type Person = { email: string, role: Role, name: string | null }
const { data, refresh } = await useFetch<{ people: Person[] }>('/api/settings/people')
const { me } = useMe()

const newEmail = ref('')
const newRole = ref<Role>('gm')
const newName = ref('')
const message = ref<{ kind: 'ok' | 'error', text: string } | null>(null)
const busy = ref(false)

async function save(p: { email: string, role: Role, name: string | null }) {
  busy.value = true
  message.value = null
  try {
    await $fetch('/api/settings/people', { method: 'POST', body: p })
    message.value = { kind: 'ok', text: `Saved ${p.email}.` }
    await refresh()
  } catch (err: any) {
    message.value = { kind: 'error', text: err?.data?.statusMessage || err?.message || 'Could not save.' }
    await refresh()
  } finally {
    busy.value = false
  }
}
async function add() {
  await save({ email: newEmail.value, role: newRole.value, name: newName.value || null })
  if (message.value?.kind === 'ok') { newEmail.value = ''; newName.value = '' }
}
async function remove(p: Person) {
  if (!confirm(`Remove ${p.email}? They will no longer be able to open the app.`)) return
  busy.value = true
  message.value = null
  try {
    await $fetch('/api/settings/people', { method: 'DELETE', query: { email: p.email } })
    await refresh()
  } catch (err: any) {
    message.value = { kind: 'error', text: err?.data?.statusMessage || err?.message || 'Could not remove.' }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <h3 class="pa-h">People &amp; Access</h3>
    <p class="pa-note">
      Pick what each person can see. <strong>Owner</strong>: everything. <strong>General Manager</strong>: This Week, Daily Results (sales), Covers &amp; Spend,
      Seasonal Trends and Kitchen Hours &amp; Cost with dollars (the Executive Chef's pay is left out). <strong>Kitchen</strong>: Kitchen Hours &amp; Cost with
      percentages and hours only. Everyone except owners is read-only. A new person's email must also be added to the Cloudflare Access allow-list or they can't sign in.
    </p>
    <ul class="pa-list">
      <li v-for="p in data?.people ?? []" :key="p.email">
        <div class="pa-who">
          <span class="pa-email">{{ p.email }}<span v-if="p.email === me?.email" class="pa-you"> (you)</span></span>
          <span v-if="p.name" class="pa-name">{{ p.name }}</span>
        </div>
        <select class="pa-input" :value="p.role" :disabled="busy" :aria-label="`Role for ${p.email}`" @change="save({ email: p.email, role: ($event.target as HTMLSelectElement).value as Role, name: p.name })">
          <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
        </select>
        <button type="button" class="pa-remove" :disabled="busy" @click="remove(p)">Remove</button>
      </li>
    </ul>
    <form class="pa-add" @submit.prevent="add">
      <input v-model="newEmail" type="email" class="pa-input wide" placeholder="Email" aria-label="Email" required>
      <input v-model="newName" type="text" class="pa-input" placeholder="Name (optional)" maxlength="80" aria-label="Name">
      <select v-model="newRole" class="pa-input" aria-label="Role">
        <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
      </select>
      <button type="submit" class="pa-btn" :disabled="busy">Add person</button>
    </form>
    <div v-if="message" :class="['chip', message.kind === 'ok' ? 'good' : 'critical']" class="pa-msg">{{ message.text }}</div>
  </div>
</template>

<style scoped>
.pa-h { font-size: 15px; font-weight: 800; color: var(--ink); margin: 0 0 4px; }
.pa-note { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; margin: 0 0 10px; max-width: 760px; }
.pa-list { list-style: none; margin: 0 0 10px; padding: 0; max-width: 760px; background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; }
.pa-list li { display: flex; align-items: center; gap: 12px; padding: 8px 12px; font-size: 13px; flex-wrap: wrap; }
.pa-list li + li { border-top: 1px solid var(--hair); }
.pa-who { flex: 1; min-width: 200px; display: flex; flex-direction: column; }
.pa-email { font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
.pa-you { font-weight: 500; color: var(--ink-3); }
.pa-name { font-size: 12px; color: var(--ink-3); }
.pa-input { font-size: 13px; padding: 6px 8px; border: 1px solid var(--hair); border-radius: 6px; background: var(--surface-alt); color: var(--ink); }
.pa-input.wide { width: 240px; }
.pa-add { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pa-btn { font-size: 12.5px; font-weight: 700; padding: 7px 14px; border-radius: 8px; border: none; background: var(--accent); color: white; cursor: pointer; }
.pa-remove { font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--hair); background: var(--surface); color: var(--accent-text); cursor: pointer; }
.pa-msg { margin-top: 8px; }
</style>
