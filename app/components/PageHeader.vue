<script setup lang="ts">
// Shared page header — title, description, and the sync-status chip/"Sync
// now" button — used by every top-level page (Dashboard, P&L, Drill-Downs,
// Budget Pace, Edit Budget). Previously each page duplicated this markup,
// and two of them (Budget Pace, Edit Budget) showed a hardcoded sample sync
// time via useSyncStatus() in useBudgetData.ts instead of the real thing.
// This component owns its own fetch of the real status (server/api/
// sync-status.get.ts) so every page gets the same real data for free,
// rather than each page needing to fold sync_runs into its own bigger API
// response just for the header.
const props = defineProps<{
  pageName: string
  description: string
  // Fallback "as of" date shown in the Sync failed / Never synced message
  // ("...showing data through <asOfLabel>") — each page formats this from
  // whatever "last real data" concept it has (Dashboard/P&L: the latest
  // daily_line_items date; Budget pages: the current as-of month/day).
  // Omit entirely on a page with no such concept; the message just drops
  // that clause.
  asOfLabel?: string
}>()

// Lets the parent page refresh its own displayed data after a manual sync
// completes — the header doesn't know what data each page shows, so it
// only reports that a sync finished, not what changed.
const emit = defineEmits<{ synced: [] }>()

type SyncStatus = { status: 'running' | 'success' | 'error', finishedAt: string | null } | null
const { data: syncData, refresh: refreshSyncStatus } = await useFetch<SyncStatus>('/api/sync-status')

const syncFailed = computed(() => syncData.value?.status === 'error')
const neverSynced = computed(() => !syncData.value)

// Re-evaluated periodically (not just once at page load) so "45 minutes
// ago" style displays and the 1-hour Sync-now cooldown stay accurate on a
// long-lived tab without needing a reload.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => { nowTimer = setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => { if (nowTimer) clearInterval(nowTimer) })

function formatSyncTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const nowDate = new Date(now.value)
  const yesterday = new Date(nowDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === nowDate.toDateString()) return `today, ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `yesterday, ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}
const lastSyncLabel = computed(() => formatSyncTime(syncData.value?.finishedAt ?? null))

// "Sync now" is disabled (not hidden) inside 15 minutes of the last sync —
// visible-but-disabled communicates "this already ran recently" rather
// than looking like the feature is missing, and a countdown label
// explains why rather than leaving the user guessing. 15 min (not the
// original 60) since a real sync run takes only a few seconds
// (server/utils/qbo-sync-runner.ts's own sync_runs history shows ~3-5s) and
// qbo-sync-runner.ts already has its own overlap guard (409 if a sync is
// already running) — this cooldown is only about not hammering Intuit's/
// Toast's API on repeated manual clicks, not a correctness requirement.
const SYNC_COOLDOWN_MS = 15 * 60 * 1000
const msSinceLastSync = computed(() => {
  const finishedAt = syncData.value?.finishedAt
  if (!finishedAt) return null
  return now.value - new Date(finishedAt).getTime()
})
const cooldownRemainingMin = computed(() => {
  if (msSinceLastSync.value === null) return 0
  return Math.max(0, Math.ceil((SYNC_COOLDOWN_MS - msSinceLastSync.value) / 60_000))
})
const onCooldown = computed(() => cooldownRemainingMin.value > 0)

const triggerState = ref<'idle' | 'syncing' | 'error'>('idle')
const triggerError = ref('')
async function syncNow() {
  if (onCooldown.value || triggerState.value === 'syncing') return
  triggerState.value = 'syncing'
  triggerError.value = ''
  try {
    await $fetch('/api/qbo/sync', { method: 'POST' })
    await refreshSyncStatus()
    triggerState.value = 'idle'
    emit('synced')
  } catch (err: any) {
    triggerState.value = 'error'
    triggerError.value = err?.data?.statusMessage || err?.message || 'Sync failed'
  }
}
</script>

<template>
  <header>
    <div>
      <h1>{{ props.pageName }}</h1>
      <div class="sub">{{ props.description }}</div>
    </div>
    <div class="as-of">
      <span :class="['chip', syncFailed ? 'critical' : neverSynced ? 'warning' : 'good']">
        {{ syncFailed ? 'Sync failed' : neverSynced ? 'Never synced' : 'Sync healthy' }}
      </span>
      <div class="sync-line">
        <template v-if="syncFailed">
          Sync failed<template v-if="props.asOfLabel"> — showing data through <strong>{{ props.asOfLabel }}</strong></template>
        </template>
        <template v-else-if="lastSyncLabel">Last synced from QuickBooks: <strong>{{ lastSyncLabel }}</strong></template>
        <template v-else-if="props.asOfLabel">Data through <strong>{{ props.asOfLabel }}</strong></template>
        <template v-else>Never synced</template>
      </div>
      <div class="sync-now-row">
        <button class="mini-btn" :disabled="onCooldown || triggerState === 'syncing'" :title="onCooldown ? `Synced recently — available again in ${cooldownRemainingMin}m` : 'Trigger a sync from QuickBooks/Toast now'" @click="syncNow">
          {{ triggerState === 'syncing' ? 'Syncing…' : 'Sync now' }}
        </button>
        <span v-if="onCooldown && triggerState !== 'syncing'" class="cooldown-note">available in {{ cooldownRemainingMin }}m</span>
        <span v-if="triggerState === 'error'" class="cooldown-note error">{{ triggerError }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.sync-now-row {
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
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
.cooldown-note { font-size: 11px; color: var(--ink-3); }
.cooldown-note.error { color: var(--critical); }
</style>
