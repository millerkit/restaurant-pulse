<script setup lang="ts">
import site from '~/config/site.json'
useHead({ title: `${site.restaurantName} — Daily Performance` })

// Shaped like a sync_runs row so this collapses into a real useDb() query
// later without changing the template logic — see schema.sql.
const lastSync = { status: 'success' as 'success' | 'error', finishedAt: 'today, 3:04 AM', dataThroughDate: 'Jul 16' }
const syncFailed = computed(() => lastSync.status === 'error')
</script>

<template>
  <div>
    <header>
      <div>
        <h1>{{ site.restaurantName }} — Daily Performance</h1>
        <div class="sub">Friday, July 17, 2026 &middot; reporting through last night's close</div>
      </div>
      <div class="as-of">
        <span :class="['chip', syncFailed ? 'critical' : 'good']"><span class="dot"></span>{{ syncFailed ? 'Sync failed' : 'Sync healthy' }}</span>
        <div class="sync-line">
          <template v-if="!syncFailed">Last synced from QuickBooks: <strong>{{ lastSync.finishedAt }}</strong></template>
          <template v-else>Sync failed — showing data through <strong>{{ lastSync.dataThroughDate }}</strong></template>
        </div>
        <span class="sample-tag">Sample data — for review</span>
      </div>
    </header>

    <!-- Are we in the red or black, and are we on pace? -->
    <section>
      <div class="section-label">Where We Stand</div>
      <div class="hero-row">
        <div class="hero-card">
          <div class="hero-top">
            <span class="period">This Month (Jul 1–16)</span>
            <span class="chip serious"><span class="dot"></span>Behind pace</span>
          </div>
          <div class="figure good">+$9,300</div>
          <div class="caption">Net income, month-to-date — in the black, but running behind the July budget pace (see below)</div>
        </div>
        <div class="hero-card">
          <div class="hero-top">
            <span class="period">This Year (Jan 1–Jul 16)</span>
            <span class="chip good"><span class="dot"></span>Ahead of pace</span>
          </div>
          <div class="figure good">+$61,200</div>
          <div class="caption">Net income, year-to-date — in the black and slightly ahead of the annual budget pace</div>
        </div>
      </div>
    </section>

    <!-- How did we do last night vs. history? -->
    <section>
      <div class="section-label">Last Night vs. History — Same Weekday</div>
      <div class="compare-row">
        <div class="compare-card anchor">
          <div class="date-label">Thu, Jul 16 (last night)</div>
          <div class="amount">$8,420</div>
          <div class="vs-label">Total revenue</div>
        </div>
        <div class="compare-card">
          <div class="date-label">vs. Thu, Jul 9</div>
          <div class="delta up">▲ 6.7%</div>
          <div class="vs-label">Last week &middot; $7,890</div>
        </div>
        <div class="compare-card">
          <div class="date-label">vs. Thu, Jun 18</div>
          <div class="delta down">▼ 8.0%</div>
          <div class="vs-label">Last month, same position &middot; $9,150</div>
        </div>
        <div class="compare-card">
          <div class="date-label">vs. Thu, Jul 17 2025</div>
          <div class="delta up">▲ 10.8%</div>
          <div class="vs-label">Last year, same position &middot; $7,600</div>
        </div>
      </div>
    </section>

    <!-- COGS / labor vs revenue -->
    <section>
      <div class="section-label">Cost Pace — Month to Date</div>
      <div class="meter-row">
        <div class="meter-card" title="Target band 28%–32% of revenue. Actual is above the top of the band.">
          <div class="meter-head">
            <span class="name">COGS</span>
            <span class="value" style="color: var(--critical);">33.1%</span>
          </div>
          <div class="meter-track">
            <div class="meter-band" style="left: 28%; width: 4%;"></div>
            <div class="meter-marker" style="left: 33.1%; background: var(--critical);"></div>
          </div>
          <div class="meter-scale"><span>0%</span><span>20%</span><span>40%</span></div>
          <div class="meter-foot">
            <span>Target: 28–32% of revenue</span>
            <span class="chip critical"><span class="dot"></span>Over target</span>
          </div>
        </div>
        <div class="meter-card" title="Target band 30%–33% of revenue. Actual is within the band.">
          <div class="meter-head">
            <span class="name">Labor</span>
            <span class="value" style="color: var(--good);">31.4%</span>
          </div>
          <div class="meter-track">
            <div class="meter-band" style="left: 30%; width: 3%;"></div>
            <div class="meter-marker" style="left: 31.4%; background: var(--good);"></div>
          </div>
          <div class="meter-scale"><span>0%</span><span>20%</span><span>40%</span></div>
          <div class="meter-foot">
            <span>Target: 30–33% of revenue</span>
            <span class="chip good"><span class="dot"></span>On target</span>
          </div>
        </div>
        <div class="meter-card" title="Target band 58%–62% of revenue (COGS + labor combined). Actual is above the top of the band.">
          <div class="meter-head">
            <span class="name">Prime Cost <span class="hint">COGS + labor</span></span>
            <span class="value" style="color: var(--serious);">64.5%</span>
          </div>
          <div class="meter-track">
            <div class="meter-band" style="left: 58%; width: 4%;"></div>
            <div class="meter-marker" style="left: 64.5%; background: var(--serious);"></div>
          </div>
          <div class="meter-scale"><span>0%</span><span>40%</span><span>80%</span></div>
          <div class="meter-foot">
            <span>Target: 58–62% of revenue</span>
            <span class="chip serious"><span class="dot"></span>Off target</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Are we on target to meet budget? -->
    <section>
      <div class="section-label">Budget Runway — Actual vs. Expected Pace</div>

      <div class="runway-card" title="16 of 31 days elapsed (51.6% of the month). Actual is 89.9% of where the budget pace expects us to be today.">
        <div class="runway-head">
          <span class="name">July revenue</span>
          <span class="nums">$118,400 actual &middot; $255,000 month target</span>
        </div>
        <div class="runway-track">
          <div class="runway-fill serious" style="width: 46.4%;"></div>
          <div class="runway-expected" style="left: 51.6%;"></div>
        </div>
        <div class="runway-foot">
          <span>$0</span>
          <span class="chip serious"><span class="dot"></span>89.9% of expected pace</span>
          <span>$255,000</span>
        </div>
      </div>

      <div class="runway-card" title="197 of 365 days elapsed (54.0% of the year). Actual is slightly ahead of where the budget pace expects us to be today.">
        <div class="runway-head">
          <span class="name">2026 revenue</span>
          <span class="nums">$1,612,000 actual &middot; $2,950,000 annual target</span>
        </div>
        <div class="runway-track">
          <div class="runway-fill good" style="width: 54.6%;"></div>
          <div class="runway-expected" style="left: 54.0%;"></div>
        </div>
        <div class="runway-foot">
          <span>$0</span>
          <span class="chip good"><span class="dot"></span>101.2% of expected pace</span>
          <span>$2,950,000</span>
        </div>
      </div>
    </section>

    <div class="legend">
      <span class="chip good"><span class="dot"></span>On / ahead of target</span>
      <span class="chip warning"><span class="dot"></span>Watch</span>
      <span class="chip serious"><span class="dot"></span>Off pace</span>
      <span class="chip critical"><span class="dot"></span>Over / under target</span>
    </div>

    <footer>
      <span>Data source: QuickBooks Online, synced nightly &middot; figures shown are illustrative sample data</span>
      <span>{{ site.restaurantName }} Performance Dashboard — v0 mockup</span>
    </footer>
  </div>
</template>

<style scoped>
/* ---------- hero row: month / year status ---------- */
.hero-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.hero-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 14px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hero-card .hero-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.hero-card .period { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.hero-card .figure {
  font-size: 34px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.hero-card .figure.good { color: var(--good); }
.hero-card .figure.critical { color: var(--critical); }
.hero-card .caption { font-size: 12px; color: var(--ink-3); }

/* ---------- comparison strip ---------- */
.compare-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1fr;
  gap: 12px;
}
.compare-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 14px;
  padding: 16px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.compare-card.anchor { background: var(--accent-wash); border-color: transparent; }
.compare-card .date-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.compare-card.anchor .date-label { color: var(--accent); }
.compare-card .amount {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.delta.up { color: var(--good); }
.delta.down { color: var(--critical); }
.compare-card .vs-label { font-size: 12px; color: var(--ink-3); }

/* ---------- pace meters (COGS / labor / prime cost) ---------- */
.meter-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
.meter-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 14px;
  padding: 16px 18px 18px;
}
.meter-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.meter-head .name { font-size: 14px; font-weight: 700; }
.meter-head .name .hint { font-size: 11px; font-weight: 500; color: var(--ink-3); }
.meter-head .value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.meter-track {
  position: relative;
  height: 10px;
  border-radius: 6px;
  background: var(--surface-alt);
  margin: 6px 0 8px;
}
.meter-band {
  position: absolute;
  top: 0; bottom: 0;
  background: var(--good-wash);
  border-radius: 4px;
}
.meter-marker {
  position: absolute;
  top: -3px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--ink);
}
.meter-scale {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.meter-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-2);
}

/* ---------- budget runway bars ---------- */
.runway-card {
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: 14px;
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.runway-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.runway-head .name { font-size: 14px; font-weight: 700; }
.runway-head .nums {
  font-size: 12px;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.runway-track {
  position: relative;
  height: 22px;
  border-radius: 8px;
  background: var(--surface-alt);
  overflow: visible;
}
.runway-fill {
  position: absolute;
  top: 0; bottom: 0; left: 0;
  border-radius: 8px;
}
.runway-fill.good { background: var(--good); }
.runway-fill.warning { background: var(--warning); }
.runway-fill.serious { background: var(--serious); }
.runway-fill.critical { background: var(--critical); }
.runway-expected {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 30px;
  background: var(--ink);
  opacity: 0.55;
}
.runway-expected::after {
  content: "today's pace";
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  white-space: nowrap;
  color: var(--ink-3);
  font-weight: 600;
}
.runway-foot {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ink-3);
}

@media (max-width: 760px) {
  .hero-row, .meter-row { grid-template-columns: 1fr; }
  .compare-row { grid-template-columns: 1fr 1fr; }
}
</style>
