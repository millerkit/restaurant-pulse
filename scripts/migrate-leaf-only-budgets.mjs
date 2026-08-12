// One-time cleanup: budget entry is now restricted to leaf accounts (see
// server/utils/accounts.ts and CLAUDE.md's Budget tab section) — a parent
// account's own stored budget_targets row was silently double-counted by
// useBudgetData.ts's categoryTotals()/hybridYearTotals() (which sum every
// account's raw amount) while budget/edit.vue's account tree ignored it
// entirely (always recomputing a parent's amount as the sum of its
// children), so the two pages disagreed on category/year totals.
//
// This finds every (year, month, account) row where the account is a
// parent (has children) and the amount is nonzero, and folds that amount
// into the parent's leaf descendants for the same month — weighted by each
// leaf's own existing amount that month (equal split if all leaves are
// $0/unbudgeted that month), the same proportional-redistribution technique
// budget/edit.vue's own recompute buttons already use — then deletes the
// parent's row so it reads as unbudgeted (matching every other leaf-only
// account), not a real $0.
//
// Matches accounts generically (any parent with a nonzero own amount, not a
// hardcoded id list), so this is safe to run in any environment (local dev
// or production) without adjustment for that environment's own account ids
// — see CLAUDE.md's standing "never key a script touching accounts/
// budget_targets on raw id across environments" rule.
//
//   node scripts/migrate-leaf-only-budgets.mjs [path/to/restaurant.sqlite]
//
// Idempotent: once every parent's own budget_targets rows are gone, a
// re-run finds nothing to do.
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

const db = new Database(dbPath)

const allAccounts = db.prepare('SELECT id, parent_account_id, name FROM accounts').all()
const childrenByParent = new Map()
for (const a of allAccounts) {
  if (a.parent_account_id == null) continue
  if (!childrenByParent.has(a.parent_account_id)) childrenByParent.set(a.parent_account_id, [])
  childrenByParent.get(a.parent_account_id).push(a.id)
}
const accountById = new Map(allAccounts.map(a => [a.id, a]))

function leafDescendants(accountId) {
  const children = childrenByParent.get(accountId)
  if (!children || children.length === 0) return [accountId]
  return children.flatMap(leafDescendants)
}

const violatingRows = db.prepare(`
  SELECT bt.year, bt.month, bt.account_id AS accountId, bt.amount
  FROM budget_targets bt
  WHERE bt.amount != 0 AND bt.account_id IN (SELECT DISTINCT parent_account_id FROM accounts WHERE parent_account_id IS NOT NULL)
`).all()

if (violatingRows.length === 0) {
  console.log('No parent accounts carry their own nonzero budget_targets rows — nothing to do.')
  process.exit(0)
}

const getLeafAmount = db.prepare('SELECT amount FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?')
const upsertLeaf = db.prepare(`
  INSERT INTO budget_targets (year, month, account_id, amount)
  VALUES (@year, @month, @accountId, @amount)
  ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount
`)
const deleteParentRow = db.prepare('DELETE FROM budget_targets WHERE year = ? AND month = ? AND account_id = ?')

const redistribute = db.transaction(() => {
  for (const row of violatingRows) {
    const parent = accountById.get(row.accountId)
    const leaves = leafDescendants(row.accountId)
    const leafAmounts = leaves.map(id => getLeafAmount.get(row.year, row.month, id)?.amount ?? 0)
    const total = leafAmounts.reduce((s, v) => s + v, 0)
    const weights = total > 0 ? leafAmounts.map(v => v / total) : leaves.map(() => 1 / leaves.length)

    console.log(`${row.year}-${String(row.month).padStart(2, '0')} ${parent.name} (id ${row.accountId}): redistributing $${row.amount.toFixed(2)} across ${leaves.length} leaf account(s)`)
    for (let i = 0; i < leaves.length; i++) {
      const leafId = leaves[i]
      const share = Math.round(row.amount * weights[i] * 100) / 100
      const newAmount = Math.round((leafAmounts[i] + share) * 100) / 100
      upsertLeaf.run({ year: row.year, month: row.month, accountId: leafId, amount: newAmount })
      console.log(`  -> ${accountById.get(leafId).name} (id ${leafId}): $${leafAmounts[i].toFixed(2)} + $${share.toFixed(2)} = $${newAmount.toFixed(2)}`)
    }
    deleteParentRow.run(row.year, row.month, row.accountId)
  }
})
redistribute()

console.log(`\nDone. Redistributed and removed ${violatingRows.length} parent-level budget_targets row(s).`)
