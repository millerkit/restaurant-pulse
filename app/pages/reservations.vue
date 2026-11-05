<script setup lang="ts">
import site from '~/config/site.json'

useHead({ title: `${site.restaurantName} — Reservations` })

type Summary =
  | { hasData: false }
  | {
    hasData: true
    rows: number
    dateFrom: string
    dateTo: string
    withCreated: number
    withCanceled: number
    byStatus: { status: string, n: number }[]
    bySource: { source: string, n: number }[]
    imports: { importedAt: string, rows: number, dateFrom: string, dateTo: string, replacedRows: number }[]
  }
type ImportResult = {
  rows: number
  dateFrom: string
  dateTo: string
  replacedRows: number
  byStatus: Record<string, number>
  skipped: number
  skippedExamples: { line: number, reason: string }[]
  missingColumns: string[]
}

const { data, error, refresh } = await useFetch<Summary>('/api/reservations')

const uploading = ref(false)
const uploadError = ref('')
const result = ref<ImportResult | null>(null)

const COLUMN_LABEL: Record<string, string> = {
  createdAt: 'Created Date',
  canceledAt: 'Canceled Date',
  noShowAt: 'No-show Date'
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  uploadError.value = ''
  result.value = null
  try {
    const text = await file.text()
    result.value = await $fetch<ImportResult>('/api/reservations/import', {
      method: 'POST',
      body: text,
      headers: { 'content-type': 'text/csv' }
    })
    await refresh()
  } catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    uploadError.value = msg ?? 'Upload failed.'
  } finally {
    uploading.value = false
    input.value = ''
  }
}

function formatDate(s: string) {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
function formatStamp(s: string) {
  return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
</script>

<template>
  <div>
    <PageHeader
      page-name="Reservations"
      description="Upload an OpenTable GuestCenter export. Only dates, party size, status, table/area, source, experience and prepayment status are kept — guest names, phones, emails and notes are never read or stored. An upload replaces every stored reservation inside its date range."
    />

    <section>
      <div class="section-head"><div class="section-label">Upload</div></div>
      <div class="drill-card">
        <input type="file" accept=".csv,text/csv" :disabled="uploading" aria-label="OpenTable CSV export" @change="onFile">
        <span v-if="uploading" class="quiet-note">Importing…</span>
      </div>

      <div v-if="uploadError" class="drill-card">
        <span class="chip critical">▲ Not imported</span>
        <span class="quiet-note">{{ uploadError }}</span>
      </div>

      <div v-if="result" class="drill-card">
        <span class="chip good">✓ Imported</span>
        <span class="quiet-note">
          {{ result.rows }} reservations for {{ formatDate(result.dateFrom) }} – {{ formatDate(result.dateTo) }}
          <template v-if="result.replacedRows">, replacing {{ result.replacedRows }} stored for those dates</template>.
          <template v-if="result.skipped"> {{ result.skipped }} row(s) skipped (e.g. line {{ result.skippedExamples[0]?.line }}: {{ result.skippedExamples[0]?.reason }}).</template>
        </span>
      </div>
      <div v-if="result?.missingColumns.length" class="drill-card">
        <span class="chip warning">▲ Columns missing</span>
        <span class="quiet-note">
          This file has no {{ result.missingColumns.map(c => COLUMN_LABEL[c] ?? c).join(', ') }}. It was imported, but the
          booking curve can't be built from these dates until a re-export includes them.
        </span>
      </div>
    </section>

    <div v-if="error" class="state-note">Couldn't load reservations: {{ error.message }}</div>
    <div v-else-if="data && !data.hasData" class="state-note">No reservations loaded yet.</div>
    <template v-else-if="data && data.hasData">
      <section>
        <div class="section-head"><div class="section-label">What's loaded</div></div>
        <div class="pl-table-card">
          <table class="pl-table">
            <caption>Stored reservations</caption>
            <tbody>
              <tr><th scope="row">Reservations</th><td class="amount">{{ data.rows.toLocaleString() }}</td></tr>
              <tr><th scope="row">Visit dates</th><td class="amount">{{ formatDate(data.dateFrom) }} – {{ formatDate(data.dateTo) }}</td></tr>
              <tr><th scope="row">With a Created Date</th><td class="amount">{{ data.withCreated.toLocaleString() }}</td></tr>
              <tr><th scope="row">With a Canceled Date</th><td class="amount">{{ data.withCanceled.toLocaleString() }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div class="section-head"><div class="section-label">Status and source</div></div>
        <div class="pl-table-card">
          <table class="pl-table">
            <caption>Reservations by status and by source</caption>
            <thead><tr><th scope="col">Status</th><th scope="col">Count</th></tr></thead>
            <tbody>
              <tr v-for="s in data.byStatus" :key="s.status"><th scope="row">{{ s.status }}</th><td class="amount">{{ s.n }}</td></tr>
            </tbody>
            <thead><tr><th scope="col">Source</th><th scope="col">Count</th></tr></thead>
            <tbody>
              <tr v-for="s in data.bySource" :key="s.source"><th scope="row">{{ s.source }}</th><td class="amount">{{ s.n }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div class="section-head"><div class="section-label">Recent uploads</div></div>
        <div class="pl-table-card">
          <table class="pl-table">
            <caption>Recent uploads</caption>
            <thead>
              <tr><th scope="col">Uploaded</th><th scope="col" class="text-cell">Dates</th><th scope="col">Rows</th><th scope="col">Replaced</th></tr>
            </thead>
            <tbody>
              <tr v-for="i in data.imports" :key="i.importedAt">
                <th scope="row">{{ formatStamp(i.importedAt) }}</th>
                <td class="text-cell">{{ formatDate(i.dateFrom) }} – {{ formatDate(i.dateTo) }}</td>
                <td class="amount">{{ i.rows }}</td>
                <td class="amount">{{ i.replacedRows }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
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
.pl-table .text-cell, .pl-table th.text-cell { text-align: left; white-space: normal; }
</style>
