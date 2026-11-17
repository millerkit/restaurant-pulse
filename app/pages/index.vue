<script setup lang="ts">
import site from '~/config/site.json'

// Home › Summary (2026-11-17): how the restaurant has been doing, in a few plain sentences.
// The first page for every role. All wording and every role decision happens server-side
// (server/utils/home-summary.ts via /api/home-summary): this page only lays out what it's given.
// Good news comes first in each section; the tone markers pair an icon with color, never color alone.
useHead({ title: `${site.restaurantName} — Summary` })

type Tone = 'good' | 'neutral' | 'concern'
type Night = { date: string, short: string, status: 'up' | 'on' | 'down' | 'event' | 'closed' | 'none', value: string, detail: string }
type Payload = {
  today: string
  toastThrough: string | null
  salesThrough: string | null
  week: { start: string, end: string } | null
  headline: string
  notices: string[]
  sections: { key: string, title: string, link: { to: string, label: string } | null, items: { tone: Tone, text: string }[] }[]
  nights: { basis: 'sales' | 'covers', items: Night[] } | null
  progress: { label: string, actual: number, target: number, status: 'up' | 'on' | 'down', note: string } | null
  note: { body: string, updatedAt: string, updatedBy: string | null } | null
  canEditNote: boolean
  role: 'owner' | 'gm' | 'kitchen'
}
const { data, pending, error, refresh } = await useFetch<Payload>('/api/home-summary', { lazy: true })

function longDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}
function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const TONE_MARK: Record<Tone, { icon: string, label: string }> = {
  good: { icon: '✓', label: 'Good news' },
  neutral: { icon: '•', label: 'For information' },
  concern: { icon: '⚠', label: 'Worth a look' }
}
const NIGHT_MARK: Record<Night['status'], { icon: string, cls: string }> = {
  up: { icon: '▲', cls: 'good' },
  on: { icon: '✓', cls: 'good' },
  down: { icon: '▼', cls: 'warning' },
  event: { icon: '★', cls: 'event' },
  closed: { icon: '◦', cls: 'neutral' },
  none: { icon: '–', cls: 'neutral' }
}
const PROGRESS_MARK = { up: '▲ Ahead', on: '✓ On pace', down: '▼ Behind' } as const

// Bar runs to 125% of the target so "ahead" has room to show; the tick marks the target.
const BAR_MAX = 1.25
const progressWidth = computed(() => {
  const p = data.value?.progress
  if (!p || !(p.target > 0)) return 0
  return Math.min(p.actual / p.target, BAR_MAX) / BAR_MAX * 100
})

// Owners' note (owner-only editing; everyone sees it).
const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const saveError = ref('')
function startEdit() {
  draft.value = data.value?.note?.body ?? ''
  saveError.value = ''
  editing.value = true
}
async function saveNote() {
  saving.value = true
  saveError.value = ''
  try {
    await $fetch('/api/home-summary/note', { method: 'POST', body: { body: draft.value } })
    editing.value = false
    await refresh()
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || err?.message || 'Couldn’t save the note.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="pending && !data" class="state-note">Loading…</div>
    <div v-else-if="error" class="card">
      <span class="chip critical">Couldn't load the summary</span>
      <span class="quiet">{{ error.message }}</span>
    </div>

    <template v-else-if="data">
      <PageHeader page-name="Summary" :description="`How we've been doing · ${longDate(data.today)}`" :as-of-label="data.toastThrough ? shortDate(data.toastThrough) : undefined" @synced="refresh()" />

      <div class="summary">
        <p class="headline">{{ data.headline }}</p>

        <div v-for="n in data.notices" :key="n" class="notice">
          <span class="chip warning">⚠ Data note</span>
          <span>{{ n }}</span>
        </div>

        <!-- Owners' note -->
        <div v-if="data.note && !editing" class="card owners-note">
          <div class="note-head">
            <span class="note-label">From the owners</span>
            <button v-if="data.canEditNote" type="button" class="link-btn" @click="startEdit">Edit</button>
          </div>
          <p class="note-body">{{ data.note.body }}</p>
        </div>
        <div v-else-if="data.canEditNote && !editing" class="add-note">
          <button type="button" class="link-btn" @click="startEdit">+ Add a note for the team</button>
          <span class="quiet">Shown to everyone at the top of this page.</span>
        </div>
        <div v-if="editing" class="card owners-note">
          <label class="note-label" for="owners-note">From the owners (shown to everyone)</label>
          <textarea id="owners-note" v-model="draft" rows="3" maxlength="600" placeholder="Great push on Saturday. This week, let's offer dessert at every table midweek." />
          <div class="note-actions">
            <button type="button" class="btn primary" :disabled="saving" @click="saveNote">{{ saving ? 'Saving…' : 'Save' }}</button>
            <button type="button" class="btn" :disabled="saving" @click="editing = false">Cancel</button>
            <span class="quiet">Leave it blank and save to remove the note.</span>
            <span v-if="saveError" class="error">{{ saveError }}</span>
          </div>
        </div>

        <!-- Last week, night by night -->
        <div v-if="data.nights" class="nights" role="list" :aria-label="data.nights.basis === 'sales' ? 'Last week, sales against each night’s goal' : 'Last week, guests each night against expected'">
          <div v-for="n in data.nights.items" :key="n.date" class="night" role="listitem" :title="n.detail" :aria-label="n.detail">
            <span class="night-day">{{ n.short }}</span>
            <span :class="['night-value', NIGHT_MARK[n.status].cls]"><span aria-hidden="true">{{ NIGHT_MARK[n.status].icon }}</span> {{ n.value }}</span>
          </div>
        </div>
        <div v-if="data.nights" class="strip-note">
          {{ data.nights.basis === 'sales' ? 'Each night’s dine-in sales against its goal.' : 'Guests each night; ▲ ✓ ▼ against what’s expected for that weekday.' }}
          ★ special night · ◦ closed.
        </div>

        <section v-for="s in data.sections" :key="s.key" class="block">
          <div class="block-head">
            <h2>{{ s.title }}</h2>
            <NuxtLink v-if="s.link" :to="s.link.to" class="more">{{ s.link.label }} →</NuxtLink>
          </div>

          <div v-if="s.key === 'month' && data.progress" class="progress">
            <div class="progress-top">
              <span>{{ data.progress.label }}</span>
              <span :class="['chip', data.progress.status === 'down' ? 'warning' : 'good']">{{ PROGRESS_MARK[data.progress.status] }}</span>
            </div>
            <div class="bar" role="img" :aria-label="`${data.progress.label}: ${Math.round(data.progress.actual / data.progress.target * 100)}% of target`">
              <div class="fill" :style="{ width: `${progressWidth}%` }" />
              <div class="tick" :style="{ left: `${100 / BAR_MAX}%` }" />
            </div>
            <div class="strip-note">{{ data.progress.note }} The tick marks the target.</div>
          </div>

          <ul class="items">
            <li v-for="(it, i) in s.items" :key="i" :class="['item', it.tone]">
              <span class="mark" :title="TONE_MARK[it.tone].label" aria-hidden="true">{{ TONE_MARK[it.tone].icon }}</span>
              <span class="sr-only">{{ TONE_MARK[it.tone].label }}: </span>
              <span>{{ it.text }}</span>
            </li>
          </ul>
        </section>

        <p class="footnote">
          Written automatically each night from QuickBooks, Toast and OpenTable.
          {{ data.role === 'kitchen' ? 'Food cost' : 'Profit and cost percentages' }} use{{ data.role === 'kitchen' ? 's' : '' }} the last closed month,
          since this month's bills haven't all landed yet.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.state-note { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 14px; }
.summary { max-width: 760px; }
.card {
  background: var(--surface); border: 1px solid var(--hair); border-radius: 18px;
  box-shadow: var(--card-shadow); padding: 14px 18px; display: flex; flex-direction: column; gap: 8px;
}
.quiet { font-size: 12.5px; color: var(--ink-3); }
.error { font-size: 12.5px; color: var(--critical-text); }
.headline { font-size: 21px; line-height: 1.4; font-weight: 600; color: var(--ink); margin: 18px 0 14px; }
.notice { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--ink-2); margin-bottom: 10px; }

.owners-note { margin: 4px 0 16px; border-left: 4px solid var(--accent); border-radius: 0 18px 18px 0; }
.note-head { display: flex; justify-content: space-between; align-items: baseline; }
.note-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
.note-body { margin: 0; font-size: 15px; line-height: 1.55; color: var(--ink); white-space: pre-line; }
.add-note { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 0 0 16px; }
.owners-note textarea {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; padding: 10px 12px;
  border: 1px solid var(--hair); border-radius: 10px; background: var(--page); color: var(--ink); resize: vertical;
}
.note-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.link-btn { background: none; border: none; padding: 0; font: inherit; font-size: 13px; font-weight: 600; color: var(--accent-text); cursor: pointer; }
.btn { font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--hair); background: var(--surface); color: var(--ink); cursor: pointer; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: white; }
.btn:disabled { opacity: 0.6; cursor: default; }

.nights { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.night { background: var(--surface-alt); border-radius: 12px; padding: 8px 6px; text-align: center; display: flex; flex-direction: column; gap: 2px; }
.night-day { font-size: 11px; font-weight: 700; color: var(--ink-3); letter-spacing: 0.02em; }
.night-value { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
.night-value.good { color: var(--good-text); }
.night-value.warning { color: var(--warning-text); }
.night-value.event, .night-value.neutral { color: var(--ink-2); }
.strip-note { font-size: 11.5px; color: var(--ink-3); margin-top: 6px; }

.block { margin: 22px 0 0; gap: 8px; }
.block-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-top: 1px solid var(--hair); padding-top: 14px; }
.block-head h2 { font-size: 15px; font-weight: 700; margin: 0; color: var(--ink); }
.more { font-size: 12.5px; font-weight: 600; color: var(--accent-text); text-decoration: none; white-space: nowrap; }
.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.item { display: grid; grid-template-columns: 18px 1fr; gap: 6px; font-size: 15px; line-height: 1.55; color: var(--ink); }
.mark { font-weight: 700; text-align: center; }
.item.good .mark { color: var(--good-text); }
.item.neutral .mark { color: var(--ink-3); }
.item.concern .mark { color: var(--warning-text); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.progress { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
.progress-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 13px; color: var(--ink-2); }
.bar { position: relative; height: 10px; border-radius: 6px; background: var(--surface-alt); }
.fill { height: 10px; border-radius: 6px; background: var(--accent); }
.tick { position: absolute; top: -4px; width: 2px; height: 18px; background: var(--ink); }

.footnote { font-size: 12px; color: var(--ink-3); margin: 28px 0 0; line-height: 1.5; }
@media (max-width: 760px) {
  .nights { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .headline { font-size: 19px; }
  .item { font-size: 14.5px; }
}
</style>
