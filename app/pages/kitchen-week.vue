<script setup lang="ts">
import site from '~/config/site.json'
import { paceStatus } from '~/composables/useBudgetData'

// This Week for the Sous Chef (kitchen role): covers and bookings only, no dollars.
// Data: /api/kitchen-week, which selects only guest counts (see that route). The owner/GM
// version of this page is pages/index.vue; the kitchen role can't call its API.
useHead({ title: `${site.restaurantName} — This Week (Kitchen)` })

type Special = { kind: 'buyout' | 'closed' | 'offsite' | 'event', note: string | null, holiday: string | null } | null
type PaceNight = {
  date: string, daysOut: number, inUpload: boolean, booked: number | null, typicalBooked: number | null,
  weekdayAvgCovers: number | null, historyNights: number, pace: number | null, estimate: number | null,
  special: Special
}
type BookingPace =
  | { available: false, reason: string }
  | { available: true, snapshotDate: string, snapshotTime: string, uploadedThrough: string, staleDays: number,
      staleAfterDays: number, estimateMaxDaysOut: number, nights: PaceNight[] }
type Day = { key: string, date: string, hasHappened: boolean, coversTarget: number | null, actualCovers: number | null, special: Special }
type Payload = {
  asOfDate: string | null
  week: null | {
    monday: string, days: Day[], toDate: { actualCovers: number, targetCovers: number },
    fullWeekTargetCovers: number, closureNote: string | null, sampleOpenDays: number, sinceDate: string
  }
  bookingPace: BookingPace | null
}
const { data, pending, error } = await useFetch<Payload>('/api/kitchen-week', { lazy: true })

function parseIsoDate(s: string) { return new Date(`${s}T00:00:00Z`) }
function formatLongDate(s: string) {
  return parseIsoDate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
function formatWeekdayDate(s: string) {
  const d = parseIsoDate(s)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${weekday}, ${month} ${d.getUTCDate()}`
}
function formatSnapshot(date: string, time: string) {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const t = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  return `${formatWeekdayDate(date)}, ${t}`
}

// Icon + label on every chip, never color alone.
function specialChip(s: NonNullable<Special>): { cls: string, label: string } {
  switch (s.kind) {
    case 'buyout': return { cls: 'event', label: '★ Buyout' }
    case 'event': return { cls: 'event', label: '★ Event night' }
    case 'offsite': return { cls: 'neutral', label: '◦ Off-site event — no dinner service' }
    default: return { cls: 'neutral', label: s.holiday ? `◦ Closed — ${s.holiday}` : '◦ Closed' }
  }
}
function paceChip(n: PaceNight): { cls: string, label: string } | null {
  if (n.booked == null) return null
  if (n.booked === 0 && (n.typicalBooked ?? 0) >= 10) return { cls: 'warning', label: '⚠ No bookings — closed?' }
  if (n.pace == null) return null
  if (n.pace >= 1.1) return { cls: 'good', label: '▲ Ahead of pace' }
  if (n.pace >= 0.9) return { cls: 'good', label: '✓ On pace' }
  if (n.pace >= 0.75) return { cls: 'warning', label: '▼ Behind pace' }
  return { cls: 'serious', label: '▼ Well behind pace' }
}
function dayStatus(d: Day): { cls: string, label: string } | null {
  if (!d.hasHappened || d.special || d.actualCovers == null || !(d.coversTarget && d.coversTarget > 0)) return null
  const ok = paceStatus((d.actualCovers / d.coversTarget) * 100, 100, 'higher-is-better') === 'good'
  return ok ? { cls: 'good', label: '✓ Hit expected covers' } : { cls: 'warning', label: '▼ Below expected covers' }
}
const weekStatus = computed(() => {
  const t = data.value?.week?.toDate
  if (!t || !(t.targetCovers > 0)) return null
  const good = paceStatus((t.actualCovers / t.targetCovers) * 100, 100, 'higher-is-better') === 'good'
  return good ? { cls: 'good', label: '✓ On pace' } : { cls: 'warning', label: '▼ Behind pace' }
})
</script>

<template>
  <div>
    <div v-if="pending && !data" class="state-note">Loading…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load this week</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>
    <div v-else-if="!data?.asOfDate || !data.week" class="drill-card">
      <span class="chip warning">No covers synced yet</span>
      <span class="quiet-note">Toast covers haven't synced, so there's nothing to show for this week yet.</span>
    </div>

    <template v-else>
      <PageHeader
        page-name="This Week"
        :description="`${formatLongDate(data.asOfDate)} · covers through last night's close`"
        :as-of-label="formatWeekdayDate(data.asOfDate)"
      />

      <section>
        <div class="section-label">This Week — expected covers per night vs. real covers</div>
        <div class="drill-card hero">
          <div class="hero-top">
            <span class="period">{{ formatWeekdayDate(data.week.days[0]!.date) }} – {{ formatWeekdayDate(data.week.days[5]!.date) }}</span>
            <span v-if="weekStatus" :class="['chip', weekStatus.cls]">{{ weekStatus.label }}</span>
          </div>
          <div class="figure">{{ data.week.toDate.actualCovers.toLocaleString() }} covers</div>
          <div class="quiet-note">
            Week to date<template v-if="data.week.toDate.targetCovers > 0">, vs. about {{ Math.round(data.week.toDate.targetCovers).toLocaleString() }} expected by now (full week: about {{ Math.round(data.week.fullWeekTargetCovers).toLocaleString() }})</template>.
            Buyouts, events and closures are left out of the comparison.
          </div>
        </div>

        <div class="week-day-row">
          <div v-for="d in data.week.days" :key="d.key" :class="['day-card', !d.hasHappened && 'upcoming']">
            <div class="day-label">{{ formatWeekdayDate(d.date) }}</div>
            <div class="day-target">Expected {{ d.coversTarget != null ? Math.round(d.coversTarget) : '—' }} covers</div>
            <template v-if="d.special">
              <div v-if="d.actualCovers" class="day-actual">{{ d.actualCovers }} covers</div>
              <span :class="['chip', specialChip(d.special).cls]">{{ specialChip(d.special).label }}</span>
              <div v-if="d.special.note" class="day-target">{{ d.special.note }}</div>
            </template>
            <template v-else-if="d.hasHappened">
              <div class="day-actual">{{ d.actualCovers != null ? d.actualCovers : '—' }} covers</div>
              <span :class="['chip', (dayStatus(d) ?? { cls: 'warning' }).cls]">{{ dayStatus(d)?.label ?? 'No data yet' }}</span>
            </template>
            <div v-else class="day-actual quiet">Not yet happened</div>
          </div>
        </div>
        <div v-if="data.week.closureNote" class="quiet-note note">{{ data.week.closureNote }}</div>
        <div v-if="data.week.sampleOpenDays < 6" class="quiet-note note">Based on only {{ data.week.sampleOpenDays }} real open day{{ data.week.sampleOpenDays === 1 ? '' : 's' }} since the location move ({{ formatWeekdayDate(data.week.sinceDate) }}); expected covers will sharpen as more data accumulates.</div>
      </section>

      <section v-if="data.bookingPace?.available">
        <div class="section-label">Next 7 Nights — OpenTable bookings vs. what's usually on the book by now</div>
        <div class="week-day-row seven">
          <div v-for="n in data.bookingPace.nights" :key="n.date" class="day-card">
            <div class="day-label">{{ formatWeekdayDate(n.date) }}<span class="days-out"> · {{ n.daysOut === 0 ? 'tonight' : n.daysOut === 1 ? 'tomorrow' : `in ${n.daysOut} days` }}</span></div>
            <template v-if="n.special">
              <div v-if="n.booked" class="day-actual">{{ n.booked }} booked</div>
              <span :class="['chip', specialChip(n.special).cls]">{{ specialChip(n.special).label }}</span>
              <div v-if="n.special.note" class="day-target">{{ n.special.note }}</div>
            </template>
            <template v-else-if="n.booked != null">
              <div class="day-actual">{{ n.booked }} booked</div>
              <div v-if="n.typicalBooked != null" class="day-target">Usually {{ n.typicalBooked }} by now</div>
              <span v-if="paceChip(n)" :class="['chip', paceChip(n)!.cls]">{{ paceChip(n)!.label }}</span>
              <div v-if="n.estimate != null" class="day-target">Estimate <strong>{{ n.estimate }} covers</strong></div>
              <div v-else-if="n.weekdayAvgCovers != null" class="day-target">Usually {{ n.weekdayAvgCovers }} covers total</div>
            </template>
            <div v-else class="day-actual quiet">Not in the last upload</div>
          </div>
        </div>
        <div class="quiet-note note">
          Bookings as of the last OpenTable upload ({{ formatSnapshot(data.bookingPace.snapshotDate, data.bookingPace.snapshotTime) }}), walk-ins excluded.
          "Usually" is the last 6 same-weekday nights at the same number of days out. Total-covers estimates (Toast, including walk-ins) are shown only
          {{ data.bookingPace.estimateMaxDaysOut }} days out or less; further out, the book hasn't predicted final covers better than the weekday average.
        </div>
        <div v-if="data.bookingPace.staleDays >= data.bookingPace.staleAfterDays" class="drill-card quiet">
          <span class="chip warning">⚠ Bookings {{ data.bookingPace.staleDays }} days old</span>
          <span class="quiet-note">Pace and estimates use the book as of the last OpenTable upload; ask the owner for a fresh one.</span>
        </div>
      </section>
      <section v-else-if="data.bookingPace && !data.bookingPace.available">
        <div class="section-label">Next 7 Nights</div>
        <div class="drill-card quiet"><span class="quiet-note">{{ data.bookingPace.reason }}</span></div>
      </section>
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
.quiet-note.note { margin-top: 10px; }
.hero-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.period { font-size: 12px; font-weight: 700; color: var(--ink-3); }
.figure { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink); }
.week-day-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-top: 12px; }
.week-day-row.seven { grid-template-columns: repeat(7, 1fr); }
.day-card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 14px;
  box-shadow: var(--card-shadow); padding: 12px 12px 14px; display: flex; flex-direction: column; gap: 6px;
}
.day-card.upcoming { opacity: 0.85; }
.day-card .day-label { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-3); }
.day-card .day-target { font-size: 11px; color: var(--ink-3); }
.day-card .day-actual { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink); }
.day-card .day-actual.quiet { font-size: 12px; font-weight: 500; color: var(--ink-3); }
.day-card .days-out { font-weight: 500; }
.day-card .chip { align-self: flex-start; }
.chip.event { color: var(--ink); background: color-mix(in srgb, var(--accent) 22%, var(--surface-alt)); }
.chip.neutral { color: var(--ink-2); background: var(--surface-alt); }
@media (max-width: 760px) {
  .week-day-row, .week-day-row.seven { grid-template-columns: 1fr 1fr; }
}
</style>
