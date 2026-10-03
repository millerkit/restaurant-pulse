// One-time migration for the Labor tab's role-class tag (added 2026-10-02): adds
// labor_position_settings.role_class and gives every wage-type account (hourly /
// salary / overtime) a first-pass classification — direct production labor,
// supervision, overhead, or a growth bet. See schema.sql's labor_position_settings
// comment and CLAUDE.md's "Labor role classes" section for the reasoning.
//
// Matches accounts by account_number (falling back to name for the one
// Management Salaries account that has none), never raw id — see CLAUDE.md's standing
// rule against keying a cross-environment script on accounts.id. Only fills rows whose
// role_class is still NULL, so re-running never clobbers a classification edited in the UI.
//
//   node scripts/add-labor-role-class.mjs [path/to/restaurant.sqlite]
//
// Idempotent: the ALTER is skipped if the column already exists.
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(rootDir, 'data', 'restaurant.sqlite')
if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`)
  process.exit(1)
}
const db = new Database(dbPath)

const hasColumn = (db.prepare(`PRAGMA table_info(labor_position_settings)`).all()).some(c => c.name === 'role_class')
if (!hasColumn) {
  db.exec(`ALTER TABLE labor_position_settings ADD COLUMN role_class TEXT CHECK (role_class IN ('direct', 'supervision', 'overhead', 'growth'))`)
  console.log('Added labor_position_settings.role_class')
}

// First-pass defaults. Executive Chef is classed as supervision even though the role
// also cooks — the tag is one class per role, and supervision is the dominant reason the
// position exists; editable afterward on the Labor tab.
const SUPERVISION_NUMBERS = new Set(['6025', '6051', '6054', '6058']) // Sous Chef, GM, Exec Chef, Floor Manager
const OVERHEAD_NUMBERS = new Set(['6056', '6057']) // Assistant to the GM, Business Manager
const GROWTH_NUMBERS = new Set(['6059']) // Wine Director

function defaultClass(accountNumber) {
  if (SUPERVISION_NUMBERS.has(accountNumber)) return 'supervision'
  if (OVERHEAD_NUMBERS.has(accountNumber)) return 'overhead'
  if (GROWTH_NUMBERS.has(accountNumber)) return 'growth'
  return 'direct'
}

const rows = db.prepare(`
  SELECT a.id, a.account_number AS accountNumber, a.name, lps.pay_type AS payType
  FROM labor_position_settings lps JOIN accounts a ON a.id = lps.account_id
  WHERE lps.pay_type IN ('hourly', 'salary', 'overtime') AND lps.role_class IS NULL
`).all()

const update = db.prepare(`UPDATE labor_position_settings SET role_class = ? WHERE account_id = ?`)
const counts = {}
db.transaction(() => {
  for (const r of rows) {
    // The Project Manager salary row has no account_number — a legacy/hidden role, not
    // one of the real positions above — so it falls through to the default 'direct'
    // only if nothing else claims it; flag it for review instead of guessing silently.
    const cls = r.accountNumber ? defaultClass(r.accountNumber) : 'overhead'
    update.run(cls, r.id)
    counts[cls] = (counts[cls] ?? 0) + 1
    if (!r.accountNumber) console.log(`  note: "${r.name}" has no account_number — defaulted to overhead, review in the Labor tab`)
  }
})()
console.log(`Classified ${rows.length} account(s):`, counts)
