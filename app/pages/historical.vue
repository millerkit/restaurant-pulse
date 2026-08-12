<script setup lang="ts">
import site from '~/config/site.json'

useHead({ title: `${site.restaurantName} — Historical` })

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
}>('/api/capacity/history')

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
        page-name="Historical"
        description="How does this year's seasonal pattern compare to last year's?"
        @synced="refresh()"
      />

      <template v-if="historyData?.coversSeries?.length || historyData?.spendSeries?.length || historyData?.revenueSeries?.length">
        <section v-if="historyData.revenueSeries.length">
          <div class="section-head">
            <div class="section-label">Revenue Seasonality</div>
            <div class="section-note">Core dine-in revenue per open day (covers × spend per cover), indexed to each year's own average. The headline number — which months actually made the most money — with the Covers and Spend charts below explaining why.</div>
          </div>
          <div class="pl-table-card chart-card">
            <SeasonalityChart
              :monthly-series="historyData.revenueSeries"
              :historical-years="historyData.historicalYears"
              :current-year="historyData.currentYear"
              metric-label="Revenue"
              aria-label="Monthly core dine-in revenue per open day, indexed to each year's own average, current year vs. prior year"
              :mass-ave-baseline-label="fmtRevenueBaseline(historyData.locationBaselines.revenue.massAve)"
              :cambridge-st-baseline-label="fmtRevenueBaseline(historyData.locationBaselines.revenue.cambridgeSt)"
            />
          </div>
        </section>

        <section v-if="historyData.coversSeries.length">
          <div class="section-head">
            <div class="section-label">Covers Seasonality</div>
            <div class="section-note">Covers per open day (Toast, core dine-in — events/catering excluded, closures excluded), indexed to each year's own average. Answers "was this month busier or slower than a typical month here" without needing to compare against a fixed capacity — same figure that powers Edit Capacity's <NuxtLink to="/capacity/edit">Set by History</NuxtLink> button.</div>
          </div>
          <div class="pl-table-card chart-card">
            <SeasonalityChart
              :monthly-series="historyData.coversSeries"
              :historical-years="historyData.historicalYears"
              :current-year="historyData.currentYear"
              metric-label="Covers"
              aria-label="Monthly covers per open day, indexed to each year's own average, current year vs. prior year"
              :mass-ave-baseline-label="fmtCoversBaseline(historyData.locationBaselines.covers.massAve)"
              :cambridge-st-baseline-label="fmtCoversBaseline(historyData.locationBaselines.covers.cambridgeSt)"
            />
          </div>
        </section>

        <section v-if="historyData.spendSeries.length">
          <div class="section-head">
            <div class="section-label">Average Spend Per Cover Seasonality</div>
            <div class="section-note">Core dine-in revenue (QuickBooks) ÷ covers (Toast) per open day, indexed to each year's own average. Tracks whether guests spend more or less per visit at different times of year, separate from how many guests come in.</div>
          </div>
          <div class="pl-table-card chart-card">
            <SeasonalityChart
              :monthly-series="historyData.spendSeries"
              :historical-years="historyData.historicalYears"
              :current-year="historyData.currentYear"
              metric-label="Avg Spend/Cover"
              aria-label="Monthly average spend per cover, indexed to each year's own average, current year vs. prior year"
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
