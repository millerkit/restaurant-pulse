<script setup lang="ts">
import site from '~/config/site.json'

useHead({ title: `${site.restaurantName} — Staff Hours` })

type EmployeeRow = {
  guid: string
  name: string
  nameMissing: boolean
  eligibility: 'hours' | 'grandfathered'
  totalHours: number
  avgPerWeek: number
  daysWorked: number
  firstShift: string | null
  lastShift: string | null
  partialWindow: boolean
  avgPerWeekSinceFirstShift: number | null
  recentAutoClockOutShifts: number
  recentAutoClockOutHours: number
}
type Status = 'tbd' | 'enrolled' | 'declined' | 'canceled'
type SalariedEligible = { guid: string, name: string, eligibility: 'salaried', status: Status, note: string | null }
type HourlyEligible = EmployeeRow & { status: Status, note: string | null }
type EligibleRow = SalariedEligible | HourlyEligible
type StaffHours =
  | { hasData: false, threshold: number, windowDays: number }
  | {
    hasData: true
    threshold: number
    windowDays: number
    windowStart: string
    windowEnd: string
    coverageDays: number
    dataGap: boolean
    fullTime: EmployeeRow[]
    tbd: EligibleRow[]
    enrolled: EligibleRow[]
    notEnrolled: EligibleRow[]
    partTime: EmployeeRow[]
    excludedLogins: { name: string, totalHours: number }[]
    unmatchedSalaried: string[]
  }

const { data, pending, error, refresh } = await useFetch<StaffHours>('/api/staff-hours')

// Dates are UTC-anchored ISO strings, parsed/formatted in UTC throughout —
// same convention as the other pages.
function formatDate(s: string, withYear = false) {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC'
  })
}

// One decimal, except for someone a hair under the line: 29.96 must not read
// as "30.0" while sitting in the part-time group.
function fmtHours(v: number) {
  const s = v.toFixed(1)
  return v < 30 && s === '30.0' ? v.toFixed(2) : s
}
function fmtTotal(v: number) {
  return Math.round(v).toLocaleString()
}
function fmtVsLine(v: number, threshold: number) {
  const diff = v - threshold
  const s = Math.abs(diff).toFixed(1)
  return diff >= 0 ? `+${s}` : `−${s}`
}

// Enrollment decisions. Eligible people with no decision are TBD (shown at the
// top); marking them Enrolled, Declined or Canceled moves them, and setting a
// row back to TBD clears the mark.
const saving = ref(false)
const saveError = ref('')
async function saveEnrollment(guid: string, status: Exclude<Status, 'tbd'> | null, note?: string) {
  saving.value = true
  saveError.value = ''
  try {
    await $fetch('/api/staff-hours/enrollment', { method: 'POST', body: { guid, status, ...(note === undefined ? {} : { note }) } })
    await refresh()
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || err?.message || "Couldn't save"
    // The dropdown already shows the choice that just failed; reload so it
    // goes back to what's actually stored.
    await refresh().catch(() => {})
  } finally {
    saving.value = false
  }
}
function onEnrollmentChange(guid: string, ev: Event) {
  const v = (ev.target as HTMLSelectElement).value as Status
  return saveEnrollment(guid, v === 'tbd' ? null : v)
}
function onNoteChange(row: EligibleRow, ev: Event) {
  const v = (ev.target as HTMLInputElement).value
  if (row.status === 'tbd' || v.trim() === (row.note ?? '')) return
  return saveEnrollment(row.guid, row.status, v)
}
function basisLabel(r: EligibleRow) {
  if (r.eligibility === 'salaried') return 'Salaried'
  if (r.eligibility === 'grandfathered') return 'Grandfathered'
  return `Full-time · ${fmtHours(r.avgPerWeek)} hrs/week`
}
const notEnrolledNote = computed(() => {
  const rows = data.value && data.value.hasData ? data.value.notEnrolled : []
  const declined = rows.filter(r => r.status === 'declined').length
  const canceled = rows.length - declined
  return `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${declined} declined, ${canceled} canceled`
})

function peopleLabel(n: number) {
  return `${n} ${n === 1 ? 'person' : 'people'}`
}
function averageOf(rows: EmployeeRow[]) {
  return rows.reduce((sum, r) => sum + r.avgPerWeek, 0) / (rows.length || 1)
}
const eligibleSections = computed(() => {
  const d = data.value
  if (!d || !d.hasData) return []
  const hourly = d.enrolled.filter((r): r is HourlyEligible => r.eligibility === 'hours')
  return [
    {
      key: 'tbd',
      label: 'Health Benefits Eligible · Enrollment TBD',
      note: `${peopleLabel(d.tbd.length)} · eligible, no enrollment decision recorded yet`,
      rows: d.tbd,
      attention: true
    },
    {
      key: 'enrolled',
      label: 'Health Benefits Eligible · Enrolled',
      note: `${peopleLabel(d.enrolled.length)}${hourly.length ? ` · hourly average ${averageOf(hourly).toFixed(1)} hrs/week (excludes salaried and grandfathered)` : ''}`,
      rows: d.enrolled,
      attention: false
    }
  ]
})
const partTimeNote = computed(() => {
  const d = data.value
  if (!d || !d.hasData || !d.partTime.length) return 'No one in this group'
  return `${peopleLabel(d.partTime.length)} · average ${averageOf(d.partTime).toFixed(1)} hrs/week`
})
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading staff hours…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load staff hours</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>

    <template v-else-if="data">
      <PageHeader
        page-name="Staff Hours"
        :description="data.hasData
          ? `Average hours per week per employee, ${formatDate(data.windowStart)} – ${formatDate(data.windowEnd, true)} (${data.coverageDays} days)`
          : `Average hours per week per employee over the last ${data.windowDays} days`"
        :as-of-label="data.hasData ? formatDate(data.windowEnd) : undefined"
        @synced="refresh()"
      />

      <section v-if="!data.hasData" class="drill-card">
        <span class="chip warning">No employee hours synced yet</span>
        <span class="quiet-note">Run <code>npm run db:backfill-toast-employee-hours</code> once to load the last {{ data.windowDays }} days; the nightly sync keeps it current after that.</span>
      </section>

      <template v-else>
        <section v-if="data.dataGap" class="drill-card">
          <span class="chip serious">Incomplete history</span>
          <span class="quiet-note">Only {{ data.coverageDays }} of the last {{ data.windowDays }} days have synced hours (from {{ formatDate(data.windowStart, true) }}). Averages below cover just those days. Re-run the backfill to fill in the rest.</span>
        </section>

        <section v-if="data.unmatchedSalaried.length" class="drill-card">
          <span class="chip serious">Salaried name not found in Toast</span>
          <span class="quiet-note">No active Toast employee matches: {{ data.unmatchedSalaried.join(', ') }}. Check the spelling in SALARIED_EMPLOYEES (server/api/staff-hours.get.ts).</span>
        </section>

        <div v-if="saveError" class="save-error" role="alert">
          <span class="chip critical">✕ Not saved</span>
          <span class="quiet-note">{{ saveError }}</span>
          <button type="button" class="dismiss" @click="saveError = ''">Dismiss</button>
        </div>

        <template v-for="g in eligibleSections" :key="g.key">
          <section v-if="g.rows.length || !g.attention">
            <div class="section-head">
              <div class="section-label">
                {{ g.label }}
                <span v-if="g.attention" class="chip good tag">● Needs follow-up</span>
              </div>
              <div class="section-note">{{ g.note }}</div>
            </div>
            <div v-if="g.rows.length" class="pl-table-card" :class="{ attention: g.attention }">
              <table class="pl-table">
                <caption>{{ g.label }}</caption>
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col">Avg hrs/week</th>
                    <th scope="col">vs. {{ data.threshold }}</th>
                    <th scope="col">Enrollment</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="e in g.rows" :key="e.guid">
                    <th scope="row">
                      {{ e.name }}
                      <span v-if="e.eligibility === 'grandfathered'" class="chip good tag">✓ Grandfathered</span>
                      <template v-if="e.eligibility === 'hours'">
                        <span v-if="e.partialWindow" class="hint">
                          First shift {{ formatDate(e.firstShift ?? '') }} — pace since then {{ fmtHours(e.avgPerWeekSinceFirstShift ?? 0) }} hrs/week
                        </span>
                        <span v-if="e.recentAutoClockOutShifts" class="hint">
                          ⚠ {{ e.recentAutoClockOutShifts }} auto clock-out{{ e.recentAutoClockOutShifts === 1 ? '' : 's' }} in the last 7 days ({{ fmtTotal(e.recentAutoClockOutHours) }} hrs) — check Toast for a missed clock-out
                        </span>
                      </template>
                    </th>
                    <template v-if="e.eligibility === 'salaried'">
                      <td class="amount">Salaried</td>
                      <td class="vs-line">Salaried</td>
                    </template>
                    <template v-else>
                      <td class="amount">{{ fmtHours(e.avgPerWeek) }}</td>
                      <td class="vs-line">{{ fmtVsLine(e.avgPerWeek, data.threshold) }}</td>
                    </template>
                    <td>
                      <select class="enroll-select" :disabled="saving" :value="e.status" aria-label="Enrollment status" @change="onEnrollmentChange(e.guid, $event)">
                        <option value="tbd">TBD</option>
                        <option value="enrolled">Enrolled</option>
                        <option value="declined">Declined</option>
                        <option value="canceled">Canceled</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="drill-card">
              <span class="chip good">✓ Eligible</span>
              <span class="quiet-note">No one is marked enrolled yet.</span>
            </div>
          </section>
        </template>

        <section v-if="data.notEnrolled.length">
          <div class="section-head">
            <div class="section-label">Health Benefits Eligible · Not Enrolled</div>
            <div class="section-note">{{ notEnrolledNote }}</div>
          </div>
          <div class="pl-table-card">
            <table class="pl-table">
              <caption>Employees eligible for health benefits who are not enrolled</caption>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col" class="text-cell">Status</th>
                  <th scope="col" class="text-cell">Eligible as</th>
                  <th scope="col" class="text-cell">Note</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in data.notEnrolled" :key="e.guid">
                  <th scope="row">{{ e.name }}</th>
                  <td>
                    <select class="enroll-select" :disabled="saving" :value="e.status" aria-label="Enrollment status" @change="onEnrollmentChange(e.guid, $event)">
                      <option value="tbd">TBD</option>
                      <option value="enrolled">Enrolled</option>
                      <option value="declined">Declined</option>
                      <option value="canceled">Canceled</option>
                    </select>
                  </td>
                  <td class="text-cell">{{ basisLabel(e) }}</td>
                  <td class="text-cell">
                    <input class="note-input" type="text" maxlength="500" placeholder="e.g. non-payment, missing documents" :value="e.note ?? ''" :disabled="saving" aria-label="Note" @change="onNoteChange(e, $event)">
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div class="section-head">
            <div class="section-label">Not Health Benefits Eligible · Part-time</div>
            <div class="section-note">{{ partTimeNote }}</div>
          </div>
          <div v-if="data.partTime.length" class="pl-table-card">
            <table class="pl-table">
              <caption>Part-time employees, not eligible for health benefits</caption>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Avg hrs/week</th>
                  <th scope="col">vs. {{ data.threshold }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in data.partTime" :key="e.guid">
                  <th scope="row">
                    {{ e.name }}
                    <span v-if="e.partialWindow" class="hint">
                      First shift {{ formatDate(e.firstShift ?? '') }} — pace since then {{ fmtHours(e.avgPerWeekSinceFirstShift ?? 0) }} hrs/week
                    </span>
                    <span v-if="e.recentAutoClockOutShifts" class="hint">
                      ⚠ {{ e.recentAutoClockOutShifts }} auto clock-out{{ e.recentAutoClockOutShifts === 1 ? '' : 's' }} in the last 7 days ({{ fmtTotal(e.recentAutoClockOutHours) }} hrs) — check Toast for a missed clock-out
                    </span>
                  </th>
                  <td class="amount">{{ fmtHours(e.avgPerWeek) }}</td>
                  <td class="vs-line">{{ fmtVsLine(e.avgPerWeek, data.threshold) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="drill-card">
            <span class="chip warning">Under {{ data.threshold }} hrs/week</span>
            <span class="quiet-note">No one in this group for this window.</span>
          </div>
        </section>

        <div class="method-note">
          <strong>How this is calculated.</strong>
          Hours are Toast time-entry hours (regular + overtime) summed over the {{ data.coverageDays }}-day window, divided by {{ (data.coverageDays / 7).toFixed(1) }} weeks. Full-time means averaging at least {{ data.threshold }} hours a week. Every job counts. Salaried staff are always eligible for health benefits and show "Salaried" instead of hours, since their Toast clock-ins don't reliably reflect hours worked; Katie Janik is grandfathered into full-time. Former employees are left out. Everyone eligible starts as Enrollment TBD (shown at the top, shaded green) until you mark them Enrolled, Declined or Canceled; Declined and Canceled move to "Not Enrolled". A mark on someone who isn't currently eligible is ignored. Anyone else who doesn't clock in won't appear. Auto clock-outs (a forgotten clock-out Toast closes automatically, which can inflate a shift) are only flagged when one happened in the last 7 days; older ones are assumed fixed in payroll. A recent hire's average is measured against the whole window, so the "pace since first shift" line shows where they're running. Employees are listed by their name in Toast.
          <template v-if="data.excludedLogins.length">
            Not listed, because {{ data.excludedLogins.length === 1 ? "it's a shared station login rather than a person" : "they're shared station logins rather than people" }}:
            {{ data.excludedLogins.map(l => `${l.name} (${fmtTotal(l.totalHours)} hrs)`).join(', ') }}.
          </template>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }

.pl-table-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 4px 4px;
  overflow-x: auto;
}
/* "Needs follow-up" table: a green wash so newly eligible people stand out. The
   chip beside the heading carries the same meaning in text. */
.pl-table-card.attention {
  background: color-mix(in srgb, var(--good) 14%, var(--surface));
  border-color: var(--good);
}
.section-label .tag { margin-left: 8px; vertical-align: 1px; text-transform: none; letter-spacing: 0.02em; }
.pl-table .text-cell, .pl-table th.text-cell { text-align: left; white-space: normal; }
.enroll-select, .note-input {
  font: inherit;
  font-size: 12px;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 8px;
  padding: 4px 8px;
}
.note-input { width: 100%; min-width: 200px; }
.save-error {
  position: sticky;
  top: 8px;
  z-index: 5;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--critical);
  border-radius: 12px;
  box-shadow: var(--card-shadow);
  padding: 10px 14px;
}
.save-error .dismiss {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-2);
  background: none;
  border: 1px solid var(--hair);
  border-radius: 8px;
  padding: 3px 9px;
  cursor: pointer;
}
table.pl-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 560px;
}
.pl-table caption { display: none; }
.pl-table th, .pl-table td {
  padding: 12px 16px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pl-table th:first-child, .pl-table td:first-child {
  text-align: left;
  white-space: normal;
}
.pl-table thead th {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-3);
  border-bottom: 1px solid var(--hair);
}
.pl-table tbody th {
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
}
.pl-table tbody tr { border-bottom: 1px solid var(--hair); }
.pl-table tbody tr:last-child { border-bottom: none; }
.pl-table .amount { font-weight: 700; color: var(--ink); }
.pl-table .vs-line { color: var(--ink-2); }
.pl-table .hint {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-3);
}
.pl-table .tag { margin-left: 6px; vertical-align: 1px; }

.drill-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.quiet-note { font-size: 12.5px; color: var(--ink-2); }

.method-note {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-3);
  padding: 0 6px;
}
.method-note strong { color: var(--ink-2); }
</style>
