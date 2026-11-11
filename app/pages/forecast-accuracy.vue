<script setup lang="ts">
import site from '~/config/site.json'

useHead({ title: `${site.restaurantName} — Forecast Accuracy` })

type Err = { forecast: number, errorPct: number | null }
type Row = { bucket: string, label: string, snapshotDate: string, kind: string, source: string, leadWeeks: number, forecasts: Record<string, Err> }
type Month = { year: number, month: number, actuals: Record<string, number | null>, rows: Row[] }
type Summary = { bucket: string, label: string, mape: Record<string, { meanAbsPct: number, n: number } | null> }
type Accuracy = { months: Month[], summary: Summary[], snapshotCount: number, firstSnapshot: string | null, lastSnapshot: string | null }

const { data, pending, error, refresh } = await useFetch<Accuracy>('/api/forecast/accuracy', { lazy: true })

const COLUMNS = [
  { key: 'month_start', label: 'Month-start plan' },
  { key: 'w1', label: '1 week out' },
  { key: 'w4', label: '4 weeks out' },
  { key: 'w8', label: '8 weeks out' }
]
const METRICS: { key: string, label: string, kind: 'money' | 'count', live?: boolean }[] = [
  { key: 'sales', label: 'Total sales', kind: 'money' },
  { key: 'core_sales', label: 'Dine-in sales', kind: 'money', live: true },
  { key: 'covers', label: 'Covers', kind: 'count' },
  { key: 'food_drink_cost', label: 'Food & drink cost', kind: 'money' },
  { key: 'labor', label: 'Labor', kind: 'money' },
  { key: 'opex', label: 'Operating expenses', kind: 'money' },
  { key: 'other_income', label: 'Other income', kind: 'money' },
  { key: 'other_expense', label: 'Other expense', kind: 'money' },
  { key: 'net_income', label: 'Net income', kind: 'money' }
]
const SUMMARY_METRICS = [
  { key: 'sales', label: 'Total sales' },
  { key: 'core_sales', label: 'Dine-in sales' },
  { key: 'covers', label: 'Covers' },
  { key: 'net_income', label: 'Net income' }
]

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const fmtMoney = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`
const fmt = (kind: 'money' | 'count', v: number | null | undefined) => v == null ? '—' : kind === 'money' ? fmtMoney(v) : Math.round(v).toLocaleString()
const fmtDate = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// Status is always icon + words, never color alone. Positive = forecast was too high.
function errChip(e: number | null | undefined) {
  if (e == null) return null
  const pct = Math.abs(e) * 100
  const text = `${e > 0 ? '+' : e < 0 ? '−' : ''}${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`
  if (pct <= 5) return { cls: 'good', text: `✓ ${text}` }
  if (pct <= 15) return { cls: 'warning', text: `▲ ${text}` }
  return { cls: 'critical', text: `⚠ ${text}` }
}
// Average size of miss: no direction, so no sign.
function missChip(v: number) {
  const c = errChip(v)!
  return { cls: c.cls, text: c.text.replace('+', '') }
}

function cell(m: Month, bucket: string, metric: string) {
  const r = m.rows.find(x => x.bucket === bucket)
  return r?.forecasts[metric] ?? null
}
function columnNote(m: Month, bucket: string) {
  const r = m.rows.find(x => x.bucket === bucket)
  if (!r) return ''
  return bucket === 'month_start' ? fmtDate(r.snapshotDate) : `${r.leadWeeks} wk${r.leadWeeks === 1 ? '' : 's'} out (${fmtDate(r.snapshotDate)})`
}
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading forecast accuracy…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load forecast accuracy</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>

    <template v-else-if="data">
      <PageHeader
        page-name="Forecast Accuracy"
        description="How far the saved forecasts were from what actually happened, by how far ahead they were made"
        @synced="refresh()"
      />

      <section class="drill-card">
        <span class="chip warning">Fills in over time</span>
        <span class="quiet-note">
          The forecast rewrites itself every night, so the app saves a copy every Monday and on the 1st of each month.
          A month shows up here once it has closed and finished syncing. Nothing can be filled in for the past, so this page gets more useful as months close.
          <template v-if="data.snapshotCount > 0">
            {{ data.snapshotCount }} snapshot{{ data.snapshotCount === 1 ? '' : 's' }} saved so far, {{ fmtDate(data.firstSnapshot!) }} – {{ fmtDate(data.lastSnapshot!) }}.
          </template>
          <template v-else>No snapshots saved yet; the first is taken after the next nightly sync.</template>
          Errors compare the forecast to the actual: ▲ / + means the forecast was too high, − means too low.
        </span>
      </section>

      <section v-if="data.summary.length">
        <div class="section-head">
          <div class="section-label">Average miss by how far ahead</div>
          <div class="section-note">Average size of the error (ignoring direction) across every closed month and snapshot in that group.</div>
        </div>
        <div class="pl-table-card">
          <table class="pl-table">
            <caption>Mean absolute percent error by lead time</caption>
            <thead>
              <tr>
                <th scope="col">Forecast made</th>
                <th v-for="m in SUMMARY_METRICS" :key="m.key" scope="col">{{ m.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in data.summary" :key="s.bucket">
                <th scope="row">{{ s.label }}</th>
                <td v-for="m in SUMMARY_METRICS" :key="m.key" class="amount">
                  <template v-if="s.mape[m.key]">
                    <span :class="['chip', missChip(s.mape[m.key]!.meanAbsPct).cls]">{{ missChip(s.mape[m.key]!.meanAbsPct).text }}</span>
                    <span class="hint">{{ s.mape[m.key]!.n }} forecast{{ s.mape[m.key]!.n === 1 ? '' : 's' }}</span>
                  </template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="data.months.length === 0" class="drill-card">
        <span class="chip warning">No closed months with snapshots yet</span>
        <span class="quiet-note">The first month to appear is the first one that was snapshotted and then closed and synced.</span>
      </section>

      <section v-for="m in [...data.months].reverse()" :key="`${m.year}-${m.month}`">
        <div class="section-head">
          <div class="section-label">{{ MONTH_NAMES[m.month - 1] }} {{ m.year }}</div>
        </div>
        <div class="pl-table-card">
          <table class="pl-table">
            <caption>{{ MONTH_NAMES[m.month - 1] }} {{ m.year }}: forecasts versus actual</caption>
            <thead>
              <tr>
                <th scope="col">&nbsp;</th>
                <th scope="col">Actual</th>
                <th v-for="c in COLUMNS" :key="c.key" scope="col">
                  {{ c.label }}
                  <span v-if="columnNote(m, c.key)" class="hint">{{ columnNote(m, c.key) }}</span>
                </th>
                <th scope="col">Live, during month</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in METRICS" :key="metric.key">
                <th scope="row">{{ metric.label }}</th>
                <td class="amount">{{ fmt(metric.kind, m.actuals[metric.key]) }}</td>
                <td v-for="c in COLUMNS" :key="c.key" class="amount">
                  <template v-if="cell(m, c.key, metric.key)">
                    {{ fmt(metric.kind, cell(m, c.key, metric.key)!.forecast) }}
                    <span v-if="errChip(cell(m, c.key, metric.key)!.errorPct)" :class="['chip', errChip(cell(m, c.key, metric.key)!.errorPct)!.cls]">{{ errChip(cell(m, c.key, metric.key)!.errorPct)!.text }}</span>
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="amount">
                  <template v-if="metric.live && cell(m, 'live', metric.key)">
                    {{ fmt(metric.kind, cell(m, 'live', metric.key)!.forecast) }}
                    <span v-if="errChip(cell(m, 'live', metric.key)!.errorPct)" :class="['chip', errChip(cell(m, 'live', metric.key)!.errorPct)!.cls]">{{ errChip(cell(m, 'live', metric.key)!.errorPct)!.text }}</span>
                  </template>
                  <template v-else>—</template>
                </td>
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
.pl-table .chip { margin-left: 6px; }
.hint { display: block; font-size: 11px; font-weight: 400; color: var(--ink-3); }
</style>
