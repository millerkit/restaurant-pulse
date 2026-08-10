// One-time migration: splits capacity_areas.per_cover_revenue into
// per_cover_revenue_food/per_cover_revenue_beverage (see schema.sql's
// capacity_areas comment and CLAUDE.md's "Capacity revenue feeds the Budget
// tab" section) so each area's projected revenue can be written into the
// real Food (4010)/Beverage (4022/4024/4026/4028) revenue accounts on the
// Budget tab, mirroring accounts.subcategory's existing Food/Beverage split.
//
// No area-level Food-vs-Beverage split ever existed before this, so there's
// no real per-area number to migrate from. Instead, each area's prior
// blended per_cover_revenue is split using this restaurant's own trailing
// actual Food/Beverage revenue ratio (from daily_line_items, core
// dine-in accounts only — 4010/4020/4022/4024/4026/4028, same account list
// CLAUDE.md's historical-seasonality section uses) — a first-pass estimate,
// not real per-area data, editable per area afterward on the Edit Capacity
// page (same "first-pass rule, editable later" posture as
// accounts.cost_behavior/is_owner_compensation). Falls back to a flat 65/35
// Food/Beverage split if there's no real revenue data yet to derive a ratio
// from (e.g. a brand-new environment before any QBO sync/backfill has run).
//
//   node scripts/migrate-capacity-revenue-split.mjs [path/to/restaurant.sqlite]
//
// Idempotent: exits immediately if capacity_areas already has a
// per_cover_revenue_food column (already migrated). SQLite (3.35+) supports
// ALTER TABLE ADD COLUMN/DROP COLUMN directly, so — unlike
// migrate-other-categories.mjs's CHECK-constraint change — this doesn't need
// a full table rebuild.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(rootDir, 'data', 'restaurant.sqlite')

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`)
  process.exit(1)
}

const FALLBACK_FOOD_PCT = 0.65

const db = new Database(dbPath)

const columns = db.prepare("PRAGMA table_info(capacity_areas)").all().map(c => c.name)
if (columns.includes('per_cover_revenue_food')) {
  console.log('capacity_areas already migrated (per_cover_revenue_food column already exists) — nothing to do.')
  db.close()
  process.exit(0)
}

const revenueByGroup = db.prepare(`
  SELECT a.subcategory AS grp, SUM(dli.amount) AS total
  FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
  WHERE a.category = 'revenue' AND a.account_number IN ('4010', '4020', '4022', '4024', '4026', '4028')
  GROUP BY a.subcategory
`).all()
const foodActual = revenueByGroup.find(r => r.grp === 'Food')?.total ?? 0
const beverageActual = revenueByGroup.find(r => r.grp === 'Beverage')?.total ?? 0
const actualTotal = foodActual + beverageActual

const foodPct = actualTotal > 0 ? foodActual / actualTotal : FALLBACK_FOOD_PCT
const beveragePct = 1 - foodPct

if (actualTotal > 0) {
  console.log(`Deriving Food/Beverage split from trailing actuals: Food $${foodActual.toFixed(2)}, Beverage $${beverageActual.toFixed(2)} -> ${(foodPct * 100).toFixed(1)}% / ${(beveragePct * 100).toFixed(1)}%.`)
} else {
  console.log(`No core revenue actuals found yet — falling back to a flat ${(foodPct * 100).toFixed(0)}% / ${(beveragePct * 100).toFixed(0)}% Food/Beverage split.`)
}

const areas = db.prepare('SELECT id, name, per_cover_revenue FROM capacity_areas ORDER BY id').all()

db.exec(`
  ALTER TABLE capacity_areas ADD COLUMN per_cover_revenue_food REAL NOT NULL DEFAULT 0;
  ALTER TABLE capacity_areas ADD COLUMN per_cover_revenue_beverage REAL NOT NULL DEFAULT 0;
`)

const update = db.prepare('UPDATE capacity_areas SET per_cover_revenue_food = ?, per_cover_revenue_beverage = ? WHERE id = ?')
const migrate = db.transaction(() => {
  for (const a of areas) {
    const food = Math.round(a.per_cover_revenue * foodPct * 100) / 100
    const beverage = Math.round((a.per_cover_revenue - food) * 100) / 100
    update.run(food, beverage, a.id)
    console.log(`  ${a.name}: $${a.per_cover_revenue.toFixed(2)} -> Food $${food.toFixed(2)} / Beverage $${beverage.toFixed(2)}`)
  }
  db.exec('ALTER TABLE capacity_areas DROP COLUMN per_cover_revenue')
})
migrate()

console.log(`\nMigrated ${areas.length} capacity_areas row(s). per_cover_revenue is now per_cover_revenue_food + per_cover_revenue_beverage.`)
db.close()
