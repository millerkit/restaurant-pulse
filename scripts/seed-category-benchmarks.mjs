// One-time/idempotent seed for category_benchmarks — this table has never
// been populated (see schema.sql). Values below reproduce the target bands
// that were hardcoded into the Dashboard mockup (COGS 28-32%, Labor 30-33%,
// Prime Cost 58-62%), reinterpreted for this table's shape: target_pct is
// the ceiling of "on target" (the mockup band's upper edge), and
// warning_pct/serious_pct/critical_pct are ascending pct-of-revenue cutoffs
// picked so the mockup's own worked examples land in the same status the
// mockup showed them in:
//   - COGS 33.1% (target ceiling 32%) -> critical, same as the mockup
//   - Labor 31.4% (target ceiling 33%) -> good, same as the mockup
//   - Prime cost 64.5% (target ceiling 62%) -> serious, same as the mockup
// opex_variable has no mockup precedent (the Dashboard never showed an
// opex meter) — seeded with an industry-typical 6% variable-opex-of-revenue
// target as a starting point, not a number the user confirmed.
// Run: node scripts/seed-category-benchmarks.mjs (locally, or via
// `fly ssh console` against the production Fly volume, same as the other
// one-off scripts in this directory).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
  process.exit(1)
}

const BENCHMARKS = [
  { category: 'cogs', target_pct: 0.32, warning_pct: 0.325, serious_pct: 0.33, critical_pct: 0.34 },
  { category: 'labor', target_pct: 0.33, warning_pct: 0.345, serious_pct: 0.36, critical_pct: 0.38 },
  { category: 'prime_cost', target_pct: 0.62, warning_pct: 0.635, serious_pct: 0.66, critical_pct: 0.70 },
  { category: 'opex_variable', target_pct: 0.06, warning_pct: 0.07, serious_pct: 0.08, critical_pct: 0.10 }
]

const db = new Database(dbPath)
const upsert = db.prepare(`
  INSERT INTO category_benchmarks (category, target_pct, warning_pct, serious_pct, critical_pct)
  VALUES (@category, @target_pct, @warning_pct, @serious_pct, @critical_pct)
  ON CONFLICT(category) DO UPDATE SET
    target_pct = excluded.target_pct, warning_pct = excluded.warning_pct,
    serious_pct = excluded.serious_pct, critical_pct = excluded.critical_pct
`)
const upsertAll = db.transaction((rows) => { for (const b of rows) upsert.run(b) })
upsertAll(BENCHMARKS)

console.log(`Seeded category_benchmarks: ${BENCHMARKS.map(b => b.category).join(', ')}`)
db.close()
