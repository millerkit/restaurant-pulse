<script setup lang="ts">
import site from '~/config/site.json'

useHead({ title: `${site.restaurantName} — Seasonal Trends` })

type MonthPoint = { year: number, month: number, indexPct: number, openDays: number }
type LocationBaselines = { massAve: number | null, cambridgeSt: number | null }
const { data: historyData, pending, error, refresh } = await useFetch<{
  asOfYear: number | null
  historicalYears: number[]
  currentYear: number | null
  coversSeries: MonthPoint[]
  spendSeries: MonthPoint[]
  revenueSeries: MonthPoint[]
  locationBaselines: { covers: LocationBaselines, spend: LocationBaselines, revenue: LocationBaselines }
}>('/api/capacity/history', { lazy: true })

function fmtCoversBaseline(n: number | null | undefined): string | null {
  return n == null ? null : `${Math.round(n)}/night`
}
function fmtSpendBaseline(n: number | null | undefined): string | null {
  return n == null ? null : `$${n.toFixed(0)}/cover`
}
function fmtRevenueBaseline(n: number | null | undefined): string | null {
  return n == null ? null : `$${Math.round(n).toLocaleString()}/day`
}
</script>

<template>
  <div>
    <div v-if="pending" class="state-note">Loading historical data…</div>
    <div v-else-if="error" class="drill-card">
      <span class="chip critical">Couldn't load historical data</span>
      <span class="quiet-note">{{ error.message }}</span>
    </div>

    <template v-else>
      <PageHeader
        page-name="Seasonal Trends"
        description="How does this year's seasonal pattern compare to last year's?"
        @synced="refresh()"
      />

      <template v-if="historyData?.coversSeries?.length || historyData?.spendSeries?.length || historyData?.revenueSeries?.length">
        <section v-if="historyData.revenueSeries.length">
          <div class="section-head">
            <div class="section-label">Revenue Seasonality</div>
            <div class="section-note">Core dine-in revenue per open night (the month's QuickBooks total ÷ nights open), compared with the typical month around it at the same location: the average of the 12 months centered on it. Which months actually made the most money; the Covers and Spend charts below explain why. Cambridge St months are compared with its average so far until it has a full year.</div>
          </div>
          <div class="pl-table-card chart-card">
            <SeasonalityChart
              :monthly-series="historyData.revenueSeries"
              :historical-years="historyData.historicalYears"
              :current-year="historyData.currentYear"
              metric-label="Revenue"
              aria-label="Monthly core dine-in revenue per open day, compared with the typical month around it, current year vs. prior year"
              :mass-ave-baseline-label="fmtRevenueBaseline(historyData.locationBaselines.revenue.massAve)"
              :cambridge-st-baseline-label="fmtRevenueBaseline(historyData.locationBaselines.revenue.cambridgeSt)"
            />
          </div>
        </section>

        <section v-if="historyData.coversSeries.length">
          <div class="section-head">
            <div class="section-label">Covers Seasonality</div>
            <div class="section-note">Covers per regular night (Toast; holidays, buyouts, events, Mass Ave's Sunday private openings and private-party nights left out), compared with the typical month around it at the same location. Was this month busier or slower than a typical month here? This is the seasonal shape the <NuxtLink to="/capacity?tab=edit">Capacity</NuxtLink> forecast uses, with recent years counting double: January–May lean two-thirds on 2026, one-third on 2025.</div>
          </div>
          <div class="pl-table-card chart-card">
            <SeasonalityChart
              :monthly-series="historyData.coversSeries"
              :historical-years="historyData.historicalYears"
              :current-year="historyData.currentYear"
              metric-label="Covers"
              aria-label="Monthly covers per open day, compared with the typical month around it, current year vs. prior year"
              :mass-ave-baseline-label="fmtCoversBaseline(historyData.locationBaselines.covers.massAve)"
              :cambridge-st-baseline-label="fmtCoversBaseline(historyData.locationBaselines.covers.cambridgeSt)"
            />
          </div>
        </section>

        <section v-if="historyData.spendSeries.length">
          <div class="section-head">
            <div class="section-label">Average Spend Per Cover Seasonality</div>
            <div class="section-note">The month's core dine-in revenue (QuickBooks) ÷ its covers (Toast), compared with the typical month around it at the same location. Tracks whether guests spend more or less per visit at different times of year, separate from how many guests come in.</div>
          </div>
          <div class="pl-table-card chart-card">
            <SeasonalityChart
              :monthly-series="historyData.spendSeries"
              :historical-years="historyData.historicalYears"
              :current-year="historyData.currentYear"
              metric-label="Avg Spend/Cover"
              aria-label="Monthly average spend per cover, compared with the typical month around it, current year vs. prior year"
              :mass-ave-baseline-label="fmtSpendBaseline(historyData.locationBaselines.spend.massAve)"
              :cambridge-st-baseline-label="fmtSpendBaseline(historyData.locationBaselines.spend.cambridgeSt)"
            />
          </div>
        </section>
      </template>
      <section v-else class="drill-card">
        <span class="chip warning">No historical data yet</span>
        <span class="quiet-note">Needs at least one prior year of synced Toast covers data.</span>
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
  margin-bottom: 14px;
}
.chart-card { padding: 16px 18px 18px; }

.drill-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 18px;
  box-shadow: var(--card-shadow);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.quiet-note { font-size: 12.5px; color: var(--ink-2); }
</style>
