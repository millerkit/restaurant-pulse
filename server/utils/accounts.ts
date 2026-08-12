import type Database from 'better-sqlite3'

// Accounts with at least one child. Budget entry is restricted to leaf
// accounts only (see targets.post.ts/copy-into-month.post.ts) — a parent
// account's own stored budget_targets row was silently double-counted by
// categoryTotals()/hybridYearTotals() (which sum every account's raw
// amount) while budget/edit.vue's account tree ignored it entirely
// (always recomputing a parent's amount as the sum of its children), so
// the two pages disagreed on category/year totals. See CLAUDE.md's Budget
// tab section for the incident this closes.
export function nonLeafAccountIds(db: Database.Database): Set<number> {
  const rows = db.prepare('SELECT DISTINCT parent_account_id AS id FROM accounts WHERE parent_account_id IS NOT NULL').all() as { id: number }[]
  return new Set(rows.map(r => r.id))
}
