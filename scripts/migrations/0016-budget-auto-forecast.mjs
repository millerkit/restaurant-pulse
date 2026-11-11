// Automatic budget lines with pins (2026-11-11). See server/utils/budget-forecast.ts.
//
// budget_targets.pinned: 1 = typed by hand and kept; 0 = written by the automatic
// forecast (only for the accounts it manages, and only for months that haven't
// started). auto_amount: what the forecast says, kept even when pinned.
//
// First run only: copies the budget lines the forecast will manage, for every month
// after the current one, to budget_targets_pre_auto so they can be compared or
// restored. Every existing row starts unpinned.
const MANAGED = ['4010', '4022', '4024', '4026', '4028', '5010', '5110', '5120', '5125', '5130']

export function up(db, log) {
  const cols = new Set(db.prepare('PRAGMA table_info(budget_targets)').all().map(c => c.name))
  if (!cols.has('pinned')) {
    const now = new Date()
    const ym = now.getFullYear() * 12 + now.getMonth() + 1
    const placeholders = MANAGED.map(() => '?').join(',')
    db.exec(`
      CREATE TABLE IF NOT EXISTS budget_targets_pre_auto (
        year INTEGER NOT NULL, month INTEGER NOT NULL, account_id INTEGER NOT NULL, amount REAL NOT NULL
      )
    `)
    const copied = db.prepare(`
      INSERT INTO budget_targets_pre_auto (year, month, account_id, amount)
      SELECT bt.year, bt.month, bt.account_id, bt.amount FROM budget_targets bt
      JOIN accounts a ON a.id = bt.account_id
      WHERE a.account_number IN (${placeholders}) AND bt.year * 12 + bt.month > ?
    `).run(...MANAGED, ym).changes
    db.exec('ALTER TABLE budget_targets ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE budget_targets ADD COLUMN auto_amount REAL')
    log(`added automatic/pinned budget lines (${copied} future-month rows saved to budget_targets_pre_auto)`)
  }
}
