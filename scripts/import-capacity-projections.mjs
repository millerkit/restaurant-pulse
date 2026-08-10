// One-time/idempotent seed for the Capacity Pace tab's projection model:
// capacity_areas (imported from a real capacity/pricing worksheet — see
// CLAUDE.md's Capacity tab section), capacity_seasonality (holiday closure
// counts by calendar month), and capacity_area_seasonality (expected
// nightly covers per area per month — the real editable projection input
// as of 2026-08-07). The starting per-area covers are derived from the
// user's original blended monthly fill %s (capacity * pct, per area) —
// the same numbers the old single-% model would have produced, so this
// migration doesn't change anything until the user starts editing
// individual areas on the Edit Capacity page.
//
// Run: npm run db:import-capacity -- /path/to/Capacity-And-Per-Cover-Revenue-Projections.csv
// (defaults to data/Capacity-And-Per-Cover-Revenue-Projections.csv if no
// path is given — that's where the source file already lives; data/*.csv
// is gitignored, same "source file not checked in, only the imported rows"
// posture as the budget xlsx / debt schedule imports.)
//
// Idempotent — deletes and re-inserts every row of both tables each run.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')
const csvPath = process.argv[2] ?? join(rootDir, 'data', 'Capacity-And-Per-Cover-Revenue-Projections.csv')

if (!existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`)
  process.exit(1)
}
if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
  process.exit(1)
}

const EXPECTED_HEADER = 'Dining Areas,Seats,Max Turns/Night,Capacity Nov-April,Capacity May-Oct,Per Cover Revenue,Notes'

function parseMoney(s) {
  const n = Number(String(s).replace(/[$,]/g, ''))
  if (Number.isNaN(n)) throw new Error(`Unrecognized money value: ${JSON.stringify(s)}`)
  return n
}
function parseIntOrNull(s) {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  if (Number.isNaN(n)) throw new Error(`Unrecognized integer value: ${JSON.stringify(s)}`)
  return n
}

const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(l => l.length > 0)
if (lines[0] !== EXPECTED_HEADER) {
  throw new Error(`Unexpected CSV header — expected "${EXPECTED_HEADER}", got "${lines[0]}"`)
}

const areas = []
for (const line of lines.slice(1)) {
  const cols = line.split(',')
  const [name] = cols
  if (name.trim().toUpperCase() === 'TOTAL') continue // trailing sanity-check row, not a real area
  const [, seats, maxTurns, capNovApr, capMayOct, perCoverRevenue, ...notesParts] = cols
  areas.push({
    name: name.trim(),
    seats: Number(seats),
    max_turns_per_night: Number(maxTurns),
    capacity_nov_apr: parseIntOrNull(capNovApr),
    capacity_may_oct: parseIntOrNull(capMayOct),
    per_cover_revenue: parseMoney(perCoverRevenue),
    notes: notesParts.join(',').trim() || null
  })
}

// Supplied by the user directly in chat 2026-08-07, not from a file — the
// expected % of total nightly capacity the restaurant is projected to fill
// each calendar month (the starting point every area's expected_covers is
// derived from below), plus known holiday closures beyond the standing
// Monday closure.
const SEASONALITY = [
  { month: 1, expected_pct: 0.35, holiday_closures: 2 },
  { month: 2, expected_pct: 0.39, holiday_closures: 0 },
  { month: 3, expected_pct: 0.35, holiday_closures: 0 },
  { month: 4, expected_pct: 0.47, holiday_closures: 0 },
  { month: 5, expected_pct: 0.58, holiday_closures: 0 },
  { month: 6, expected_pct: 0.52, holiday_closures: 0 },
  { month: 7, expected_pct: 0.47, holiday_closures: 1 },
  { month: 8, expected_pct: 0.47, holiday_closures: 0 },
  { month: 9, expected_pct: 0.52, holiday_closures: 0 },
  { month: 10, expected_pct: 0.55, holiday_closures: 0 },
  { month: 11, expected_pct: 0.52, holiday_closures: 1 },
  { month: 12, expected_pct: 0.58, holiday_closures: 2 }
]

function isMayThroughOct(month) {
  return month >= 5 && month <= 10
}

const db = new Database(dbPath)

// per_cover_revenue was split into per_cover_revenue_food/
// per_cover_revenue_beverage 2026-08-10 (see schema.sql's capacity_areas
// comment) — this worksheet only ever had one blended figure per area, so
// each area's per_cover_revenue is split using this restaurant's own
// trailing actual Food/Beverage revenue ratio (core dine-in accounts only),
// same derivation as scripts/migrate-capacity-revenue-split.mjs. Falls back
// to a flat split if there's no revenue data yet (e.g. a brand-new
// environment running this before any QBO sync/backfill).
const FALLBACK_FOOD_PCT = 0.65
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

for (const a of areas) {
  a.per_cover_revenue_food = Math.round(a.per_cover_revenue * foodPct * 100) / 100
  a.per_cover_revenue_beverage = Math.round((a.per_cover_revenue - a.per_cover_revenue_food) * 100) / 100
}

const insertArea = db.prepare(`
  INSERT INTO capacity_areas (name, seats, max_turns_per_night, capacity_nov_apr, capacity_may_oct, per_cover_revenue_food, per_cover_revenue_beverage, notes)
  VALUES (@name, @seats, @max_turns_per_night, @capacity_nov_apr, @capacity_may_oct, @per_cover_revenue_food, @per_cover_revenue_beverage, @notes)
`)
const insertMonth = db.prepare(`
  INSERT INTO capacity_seasonality (month, holiday_closures) VALUES (@month, @holiday_closures)
`)
const insertAreaMonth = db.prepare(`
  INSERT INTO capacity_area_seasonality (area_id, month, expected_covers) VALUES (@area_id, @month, @expected_covers)
`)
const run = db.transaction(() => {
  db.prepare('DELETE FROM capacity_area_seasonality').run()
  db.prepare('DELETE FROM capacity_areas').run()
  for (const a of areas) insertArea.run(a)
  const areaIds = db.prepare('SELECT id, capacity_nov_apr, capacity_may_oct FROM capacity_areas').all()

  db.prepare('DELETE FROM capacity_seasonality').run()
  for (const m of SEASONALITY) insertMonth.run(m)

  for (const area of areaIds) {
    for (const m of SEASONALITY) {
      const capacity = (isMayThroughOct(m.month) ? area.capacity_may_oct : area.capacity_nov_apr) ?? 0
      insertAreaMonth.run({ area_id: area.id, month: m.month, expected_covers: capacity * m.expected_pct })
    }
  }
})
run()

console.log(`Imported ${areas.length} capacity_areas: ${areas.map(a => a.name).join(', ')}`)
console.log(`Seeded capacity_seasonality (holiday closures) for all 12 months`)
console.log(`Seeded capacity_area_seasonality (expected covers) for ${areas.length} areas x 12 months`)
db.close()
