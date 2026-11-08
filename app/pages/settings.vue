<script setup lang="ts">
import site from '~/config/site.json'

useHead({ title: `${site.restaurantName} — Settings` })

// Settings hub (2026-11 UI cleanup, phase 1). Holds the technical pieces
// that don't belong in anyone's day-to-day nav: data connections and the
// reservation upload. The "Where other settings live" list is a directory of
// settings still on their original pages; they move here one at a time in
// later phases (People & Access arrives with roles in phase 2).

type QboStatus =
  | { connected: true, environment: string, realmId: string, companyName?: string }
  | { connected: false, reason: 'not_connected' | 'reconnect_required' }

const { data: qbo, pending: qboPending, error: qboError } = await useFetch<QboStatus>('/api/qbo/status', { server: false })

const elsewhere = [
  { title: 'Weekly sales goal', where: 'This Week', to: '/', note: 'The "good week" target the daily goals are built from.' },
  { title: 'Overspending alert levels', where: 'Budget Check', to: '/budget', note: 'How large a change must be before a cost line is flagged.' },
  { title: 'Labor role classes, tax rates, taxable tips', where: 'Staffing Plan', to: '/budget/labor', note: 'Payroll-tax rates and how each role is classified.' },
  { title: 'Dining areas, seats, closures', where: 'Capacity', to: '/capacity?tab=edit', note: 'Seats, turns, holiday closures and weekly area closures.' },
  { title: 'Loan reserve plan and gift card cash', where: 'Cash & Loans', to: '/cashflow', note: 'Weekly reserve amount and expected gift card sales.' }
]
</script>

<template>
  <div>
    <PageHeader
      page-name="Settings"
      description="Connections, data uploads, and the technical settings behind the rest of the app."
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
          </div>
          <p class="settings-card-body">Upload a reservation export to update the “Next 7 Nights” booking pace on This Week. Weekly at least.</p>
          <NuxtLink class="settings-btn" to="/reservations">Upload reservations</NuxtLink>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="settings-h">Where other settings live</h2>
      <p class="settings-intro">These will move here over time. For now, they're on the pages below.</p>
      <ul class="settings-list">
        <li v-for="item in elsewhere" :key="item.title">
          <NuxtLink :to="item.to" class="settings-row">
            <span>
              <span class="settings-row-title">{{ item.title }}</span>
              <span class="settings-row-note">{{ item.note }}</span>
            </span>
            <span class="settings-row-where">{{ item.where }} →</span>
          </NuxtLink>
        </li>
      </ul>
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
.settings-intro { margin: -4px 0 10px; font-size: 13px; color: var(--ink-3); }
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
.settings-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--hair);
  border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
}
.settings-list li + li { border-top: 1px solid var(--hair); }
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  text-decoration: none;
  color: inherit;
}
.settings-row:hover { background: var(--surface-alt); }
.settings-row-title { display: block; font-size: 14px; font-weight: 700; color: var(--ink); }
.settings-row-note { display: block; font-size: 12.5px; color: var(--ink-3); margin-top: 2px; }
.settings-row-where { font-size: 12.5px; font-weight: 700; color: var(--accent-text); white-space: nowrap; }
</style>
