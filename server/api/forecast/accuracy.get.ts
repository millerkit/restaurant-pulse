// Forecast Accuracy report data (dynamic budgeting step 3). For each closed, fully synced month
// that has forecast snapshots: actuals per metric, and each snapshot's error
// = (forecast - actual) / |actual|, with lead time = weeks from snapshot_date to the month's 1st
// (negative = taken during the month). Positive error = the forecast was too high.
import { CORE_REVENUE_ACCOUNT_NUMBERS } from '../../utils/core-revenue'
import { netIncomeOf } from '../../utils/forecast-snapshots'

const pad = (n: number) => String(n).padStart(2, '0')
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
const DAY = 86400000

// Metrics that have an actual to compare with (max_covers and capacity_sales don't).
const ACCURACY_METRICS = ['sales', 'core_sales', 'food_drink_cost', 'labor', 'opex', 'other_income', 'other_expense', 'net_income', 'covers'] as const
const SUMMARY_METRICS = ['sales', 'core_sales', 'covers', 'net_income'] as const

// Lead buckets for the summary (weekly plan snapshots by weeks out; month_start and live on their own).
const BUCKETS = [
  { key: 'month_start', label: 'Month-start plan', target: 0 },
  { key: 'w1', label: '1 week out', target: 1, min: 0, max: 2 },
  { key: 'w4', label: '4 weeks out', target: 4, min: 3, max: 5 },
  { key: 'w8', label: '8 weeks out', target: 8, min: 6, max: 10 },
  { key: 'w12', label: '11+ weeks out', target: 12, min: 11, max: 99 },
  { key: 'live', label: 'Live, during the month', target: -1 }
] as const

type Snap = { snapshot_date: string, kind: string, year: number, month: number, source: string, metric: string, value: number }

export default defineEventHandler(() => {
  const db = useDb()
  const lineThrough = (db.prepare('SELECT MAX(date) AS d FROM daily_line_items').get() as { d: string | null }).d ?? ''
  const toastThrough = (db.prepare('SELECT MAX(date) AS d FROM daily_toast_metrics').get() as { d: string | null }).d ?? ''

  const snapMonths = db.prepare('SELECT DISTINCT year, month FROM forecast_snapshots ORDER BY year, month').all() as { year: number, month: number }[]
  const closed = snapMonths.filter(m => lineThrough >= monthEnd(m.year, m.month))

  const placeholders = CORE_REVENUE_ACCOUNT_NUMBERS.map(() => '?').join(',')
  const byCat = db.prepare(`
    SELECT a.category, COALESCE(SUM(dli.amount), 0) AS total
    FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE dli.date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id)
    GROUP BY a.category
  `)
  const coreSum = db.prepare(`
    SELECT COALESCE(SUM(dli.amount), 0) AS total FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
    WHERE a.account_number IN (${placeholders}) AND dli.date BETWEEN ? AND ?
  `)
  const covSum = db.prepare('SELECT SUM(covers) AS covers FROM daily_toast_metrics WHERE date BETWEEN ? AND ?')
  const snapRows = db.prepare('SELECT * FROM forecast_snapshots WHERE year = ? AND month = ?')

  type Err = { forecast: number, errorPct: number | null }
  const bucketStats = new Map<string, Map<string, number[]>>() // bucket -> metric -> |error| list

  const months = closed.map(({ year, month }) => {
    const start = `${year}-${pad(month)}-01`
    const end = monthEnd(year, month)
    const cats = Object.fromEntries((byCat.all(start, end) as { category: string, total: number }[]).map(r => [r.category, r.total]))
    const v = {
      sales: cats.revenue ?? 0, food_drink_cost: cats.cogs ?? 0, labor: cats.labor ?? 0,
      opex: cats.opex ?? 0, other_income: cats.other_income ?? 0, other_expense: cats.other_expense ?? 0
    }
    const actuals: Record<string, number | null> = {
      ...v,
      core_sales: (coreSum.get(...CORE_REVENUE_ACCOUNT_NUMBERS, start, end) as { total: number }).total,
      net_income: netIncomeOf(v),
      covers: toastThrough >= end ? ((covSum.get(start, end) as { covers: number | null }).covers ?? null) : null
    }
    const bySnap = new Map<string, { snapshotDate: string, kind: string, source: string, leadWeeks: number, forecasts: Record<string, Err> }>()
    for (const r of snapRows.all(year, month) as Snap[]) {
      const key = `${r.snapshot_date}|${r.kind}|${r.source}`
      let s = bySnap.get(key)
      if (!s) {
        const leadDays = (Date.parse(`${start}T00:00:00Z`) - Date.parse(`${r.snapshot_date}T00:00:00Z`)) / DAY
        s = { snapshotDate: r.snapshot_date, kind: r.kind, source: r.source, leadWeeks: Math.round(leadDays / 7), forecasts: {} }
        bySnap.set(key, s)
      }
      if (!(ACCURACY_METRICS as readonly string[]).includes(r.metric)) continue
      const actual = actuals[r.metric]
      s.forecasts[r.metric] = { forecast: r.value, errorPct: actual != null && actual !== 0 ? (r.value - actual) / Math.abs(actual) : null }
    }
    const snapshots = [...bySnap.values()].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))

    // Bucket every snapshot, keep the one nearest each bucket's target for the month table,
    // and feed every snapshot's error into the summary.
    const bucketOf = (s: typeof snapshots[number]) => {
      if (s.source === 'live') return 'live'
      // Only the snapshot taken on the month's own 1st is its frozen plan; an earlier month's
      // month_start also covers this month and is bucketed by lead time like a weekly one.
      if (s.kind === 'month_start' && s.snapshotDate === start) return 'month_start'
      return BUCKETS.find(b => 'min' in b && s.leadWeeks >= b.min && s.leadWeeks <= b.max)?.key ?? null
    }
    const picks: Record<string, typeof snapshots[number]> = {}
    for (const s of snapshots) {
      const key = bucketOf(s)
      if (!key) continue
      const target = BUCKETS.find(b => b.key === key)!.target
      const cur = picks[key]
      if (!cur || Math.abs(s.leadWeeks - target) < Math.abs(cur.leadWeeks - target)) picks[key] = s
      const stats = bucketStats.get(key) ?? new Map<string, number[]>()
      bucketStats.set(key, stats)
      for (const [metric, e] of Object.entries(s.forecasts)) {
        if (e.errorPct == null) continue
        const list = stats.get(metric) ?? []
        list.push(Math.abs(e.errorPct))
        stats.set(metric, list)
      }
    }
    return {
      year, month, actuals,
      rows: BUCKETS.filter(b => picks[b.key]).map(b => ({ bucket: b.key, label: b.label, ...picks[b.key]! }))
    }
  })

  const summary = BUCKETS.map(b => {
    const stats = bucketStats.get(b.key)
    const mape: Record<string, { meanAbsPct: number, n: number } | null> = {}
    for (const m of SUMMARY_METRICS) {
      const list = stats?.get(m)
      mape[m] = list && list.length > 0 ? { meanAbsPct: list.reduce((s, x) => s + x, 0) / list.length, n: list.length } : null
    }
    return { bucket: b.key, label: b.label, mape }
  }).filter(r => Object.values(r.mape).some(Boolean))

  const counts = db.prepare('SELECT COUNT(DISTINCT snapshot_date || kind) AS n, MIN(snapshot_date) AS first, MAX(snapshot_date) AS last FROM forecast_snapshots').get() as { n: number, first: string | null, last: string | null }
  return { months, summary, snapshotCount: counts.n, firstSnapshot: counts.first, lastSnapshot: counts.last }
})
