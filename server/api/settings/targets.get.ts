// Settings › Targets & alert levels: the weekly sales goal, the overspending
// alert levels (drilldown_thresholds) and the cost benchmarks (category_benchmarks).
// Defaults match what the pages use when a row is missing.
const DEFAULT_THRESHOLDS = { month: 250, year: 1000 }
const BENCHMARK_CATEGORIES = ['cogs', 'labor', 'prime_cost', 'opex_variable'] as const

export default defineEventHandler(() => {
  const db = useDb()
  const goal = db.prepare('SELECT weekly_amount AS weeklyAmount FROM weekly_revenue_benchmark WHERE id = 1').get() as { weeklyAmount: number } | undefined
  const t = db.prepare('SELECT month_threshold AS month, year_threshold AS year FROM drilldown_thresholds WHERE id = 1').get() as { month: number, year: number } | undefined
  const rows = db.prepare('SELECT category, target_pct AS targetPct, warning_pct AS warningPct, serious_pct AS seriousPct, critical_pct AS criticalPct FROM category_benchmarks').all() as
    { category: string, targetPct: number, warningPct: number, seriousPct: number, criticalPct: number }[]
  const byCat = new Map(rows.map(r => [r.category, r]))
  return {
    weeklyGoal: goal?.weeklyAmount ?? null,
    thresholds: t ?? DEFAULT_THRESHOLDS,
    benchmarks: BENCHMARK_CATEGORIES.map(category => byCat.get(category) ?? { category, targetPct: null, warningPct: null, seriousPct: null, criticalPct: null })
  }
})
