<script setup lang="ts">
import site from '~/config/site.json'

useHead({ title: `${site.restaurantName} — Settings` })

// Settings hub (2026-11 UI cleanup, phase 1). Holds the technical pieces
// that don't belong in anyone's day-to-day nav: data connections and the
// reservation upload, database update status, then targets/alert levels and
// the restaurant's room setup (moved here 2026-11-08). People & Access
// arrives with roles in phase 2.

type QboStatus =
  | { connected: true, environment: string, realmId: string, companyName?: string }
  | { connected: false, reason: 'not_connected' | 'reconnect_required' }

const { data: qbo, pending: qboPending, error: qboError } = await useFetch<QboStatus>('/api/qbo/status', { server: false })

type MigrationStatus =
  | { available: false }
  | { available: true, total: number, pending: string[], lastAppliedAt: string | null }
const { data: migrations } = await useFetch<MigrationStatus>('/api/settings/migrations')
const migrationsPending = computed(() => (migrations.value?.available ? migrations.value.pending : []))
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// OpenTable upload freshness. Booking pace on This Week is only as current as
// the last upload, so anything older than this many days is flagged.
const RESERVATIONS_STALE_AFTER_DAYS = 3
type ReservationsStatus =
  | { hasData: false }
  | { hasData: true, rows: number, dateFrom: string, dateTo: string, imports: { importedAt: string }[] }
const { data: reservations, pending: reservationsPending } = await useFetch<ReservationsStatus>('/api/reservations', { server: false })
const reservationsLastUpload = computed(() => (reservations.value?.hasData ? reservations.value.imports[0]?.importedAt ?? null : null))
const reservationsAgeDays = computed(() => {
  if (!reservationsLastUpload.value) return null
  return Math.floor((Date.now() - new Date(reservationsLastUpload.value).getTime()) / 86_400_000)
})
const reservationsStale = computed(() => reservationsAgeDays.value !== null && reservationsAgeDays.value >= RESERVATIONS_STALE_AFTER_DAYS)
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

</script>

<template>
  <div>
    <PageHeader
      page-name="Settings"
      description="Connections, targets, and the restaurant setup behind the rest of the app."
    />

    <section class="settings-section">
      <h2 class="settings-h">Connections &amp; Data</h2>
      <div class="settings-grid">
        <div class="settings-card">
          <div class="settings-card-top">
            <span class="settings-card-title">QuickBooks</span>
            <span v-if="qboPending" class="chip neutral">Checking…</span>
            <span v-else-if="qboError" class="chip warning">Couldn't check</span>
            <span v-else-if="qbo?.connected" class="chip good">✓ Connected</span>
            <span v-else class="chip critical">✕ {{ qbo?.reason === 'reconnect_required' ? 'Needs reconnecting' : 'Not connected' }}</span>
          </div>
          <p class="settings-card-body">
            <template v-if="qbo?.connected">
              Profit &amp; loss figures sync nightly from <strong>{{ qbo.companyName || 'QuickBooks' }}</strong>
              <span v-if="qbo.environment !== 'production'"> ({{ qbo.environment }})</span>.
            </template>
            <template v-else>Sales and cost figures come from QuickBooks. Connect it to keep them current.</template>
          </p>
          <a v-if="!qboPending && !qbo?.connected" class="settings-btn" href="/api/qbo/connect">Connect QuickBooks</a>
        </div>

        <div class="settings-card">
          <div class="settings-card-top">
            <span class="settings-card-title">Toast</span>
          </div>
          <p class="settings-card-body">Guest counts, hours worked and per-area sales sync nightly alongside QuickBooks. Use “Sync now” above to pull the latest.</p>
        </div>

        <div class="settings-card">
          <div class="settings-card-top">
            <span class="settings-card-title">OpenTable reservations</span>
            <span v-if="reservationsPending" class="chip neutral">Checking…</span>
            <span v-else-if="!reservations?.hasData" class="chip warning">▲ No data</span>
            <span v-else-if="reservationsStale" class="chip warning">▲ Upload due</span>
            <span v-else class="chip good">✓ Up to date</span>
          </div>
          <p v-if="reservations?.hasData && reservationsLastUpload" class="settings-card-body">
            Last uploaded {{ fmtDateTime(reservationsLastUpload) }}<template v-if="reservationsAgeDays">
              ({{ reservationsAgeDays }} days ago)</template>. Covers {{ fmtDay(reservations.dateFrom) }} – {{ fmtDay(reservations.dateTo) }}, {{ reservations.rows.toLocaleString() }} reservations.
            <template v-if="reservationsStale"> The “Next 7 Nights” booking pace on This Week is out of date until you upload a fresh export.</template>
          </p>
          <p v-else class="settings-card-body">Upload a reservation export to update the “Next 7 Nights” booking pace on This Week. Every few days at least.</p>
          <NuxtLink class="settings-btn" to="/reservations">Upload reservations</NuxtLink>
        </div>

        <div v-if="migrations?.available" class="settings-card">
          <div class="settings-card-top">
            <span class="settings-card-title">Database updates</span>
            <span v-if="migrationsPending.length" class="chip critical">✕ {{ migrationsPending.length }} not applied</span>
            <span v-else class="chip good">✓ Up to date</span>
          </div>
          <p class="settings-card-body">
            <template v-if="migrationsPending.length">
              These didn't apply when the app last started, so some pages may show errors:
              <strong>{{ migrationsPending.join(', ') }}</strong>. The server log has the reason (search for “[migrate] FAILED”).
            </template>
            <template v-else>
              Applied automatically each time a new version starts.
              <template v-if="migrations.lastAppliedAt"> Last change {{ fmtDateTime(migrations.lastAppliedAt) }}.</template>
            </template>
          </p>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="settings-h">Targets &amp; Alert Levels</h2>
      <TargetsSettings />
    </section>

    <section class="settings-section">
      <h2 class="settings-h">People &amp; Access</h2>
      <PeopleAccessSettings />
    </section>

    <section class="settings-section">
      <h2 class="settings-h">Restaurant Setup</h2>
      <RestaurantSetupSettings />
    </section>
  </div>
</template>

<style scoped>
.settings-section { margin-top: 22px; }
.settings-h {
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin: 0 0 10px;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.settings-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 12px;
  box-shadow: var(--card-shadow);
}
.settings-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.settings-card-top .chip { margin: 0; }
.chip.neutral { color: var(--ink-3); background: var(--surface-alt); }
.settings-card-title { font-size: 15px; font-weight: 800; color: var(--ink); }
.settings-card-body { margin: 0; font-size: 13px; line-height: 1.45; color: var(--ink-2); flex: 1; }
.settings-btn {
  align-self: flex-start;
  font-size: 12.5px;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--hair);
  background: var(--surface-alt);
  color: var(--accent-text);
  text-decoration: none;
}
.settings-btn:hover { background: var(--accent-wash); }
</style>
