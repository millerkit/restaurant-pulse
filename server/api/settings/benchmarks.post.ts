// Saves the cost benchmarks (category_benchmarks): each category's target and
// the levels above it that turn a figure from good to warning to serious.
// Fractions of revenue (0.30 = 30%). Above "serious" is critical; critical_pct
// is kept at least as high as serious_pct but isn't used to set a status.
const CATEGORIES = new Set(['cogs', 'labor', 'prime_cost', 'opex_variable'])
type Row = { category: string, targetPct: number, warningPct: number, seriousPct: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<{ benchmarks: Row[] }>(event)
  const rows = body?.benchmarks ?? []
  if (!Array.isArray(rows) || rows.length === 0) throw createError({ statusCode: 400, statusMessage: 'Expected "benchmarks"' })
  for (const r of rows) {
    if (!CATEGORIES.has(r.category)) throw createError({ statusCode: 400, statusMessage: `Unknown category ${r.category}` })
    const vals = [r.targetPct, r.warningPct, r.seriousPct]
    if (vals.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= 1.5)) {
      throw createError({ statusCode: 400, statusMessage: `Percentages for ${r.category} must be between 0 and 150` })
    }
    if (!(r.targetPct <= r.warningPct && r.warningPct <= r.seriousPct)) {
      throw createError({ statusCode: 400, statusMessage: `For ${r.category}, target ≤ watch ≤ serious` })
    }
  }
  const db = useDb()
  const upsert = db.prepare(`
    INSERT INTO category_benchmarks (category, target_pct, warning_pct, serious_pct, critical_pct)
    VALUES (@category, @targetPct, @warningPct, @seriousPct, @seriousPct)
    ON CONFLICT (category) DO UPDATE SET
      target_pct = excluded.target_pct, warning_pct = excluded.warning_pct, serious_pct = excluded.serious_pct,
      critical_pct = MAX(category_benchmarks.critical_pct, excluded.serious_pct)
  `)
  db.transaction(() => { for (const r of rows) upsert.run(r) })()
  return { saved: rows.length }
})
