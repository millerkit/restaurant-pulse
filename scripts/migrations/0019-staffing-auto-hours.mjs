// Staffing Plan hours follow each person's real Toast hours (dynamic budgeting step 4,
// 2026-11-12). See docs/specs/staffing-auto-hours.md and server/utils/labor-hours.ts.
//
// - toast_job_labor_accounts: Toast job -> budget role (edited in Settings › Staff & Pay Rules).
// - labor_position_slots: toast_employee_guid (who the slot is), hours_pinned (1 = typed by hand,
//   kept; 0 = follows the Toast average), auto_weekly_hours / auto_hours_basis / auto_updated_at.
// - labor_position_settings: the same pin + auto value for an overtime account's weekly hours.
// Every existing slot and overtime row starts pinned, so nothing follows Toast until Kit maps a
// person and accepts the average.
//
// First run only: copies the labor budget lines of every month after the current one to
// budget_targets_labor_pre_auto (the automatic labor forecast will rewrite them), and turns
// "scale with forecast covers" off for hourly/overtime roles whose class isn't 'direct'
// (the scaling now follows covers, which only direct roles do). Safe to re-run.
function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
}

export function up(db, log) {
  const firstRun = !hasColumn(db, 'labor_position_slots', 'hours_pinned')

  db.exec(`
    CREATE TABLE IF NOT EXISTS toast_job_labor_accounts (
      job_guid    TEXT PRIMARY KEY,
      account_id  INTEGER REFERENCES accounts(id),
      updated_at  TEXT NOT NULL
    )
  `)

  if (firstRun) {
    const now = new Date()
    const ym = now.getFullYear() * 12 + now.getMonth() + 1
    db.exec(`
      CREATE TABLE IF NOT EXISTS budget_targets_labor_pre_auto (
        year INTEGER NOT NULL, month INTEGER NOT NULL, account_id INTEGER NOT NULL, amount REAL NOT NULL
      )
    `)
    const copied = db.prepare(`
      INSERT INTO budget_targets_labor_pre_auto (year, month, account_id, amount)
      SELECT bt.year, bt.month, bt.account_id, bt.amount FROM budget_targets bt
      WHERE bt.account_id IN (SELECT account_id FROM labor_position_settings) AND bt.year * 12 + bt.month > ?
    `).run(ym).changes
    log(`saved ${copied} future-month labor budget rows to budget_targets_labor_pre_auto`)
  }

  const slotCols = [
    ['toast_employee_guid', 'TEXT'],
    ['hours_pinned', 'INTEGER NOT NULL DEFAULT 1'],
    ['auto_weekly_hours', 'REAL'],
    ['auto_hours_basis', 'TEXT'],
    ['auto_updated_at', 'TEXT']
  ]
  for (const [col, type] of slotCols) {
    if (!hasColumn(db, 'labor_position_slots', col)) db.exec(`ALTER TABLE labor_position_slots ADD COLUMN ${col} ${type}`)
  }
  const settingCols = [
    ['ot_hours_pinned', 'INTEGER NOT NULL DEFAULT 1'],
    ['auto_ot_hours', 'REAL'],
    ['auto_ot_basis', 'TEXT']
  ]
  for (const [col, type] of settingCols) {
    if (!hasColumn(db, 'labor_position_settings', col)) db.exec(`ALTER TABLE labor_position_settings ADD COLUMN ${col} ${type}`)
  }

  if (firstRun) {
    const rows = db.prepare(`
      SELECT a.account_number AS num, a.name, lps.account_id AS id, lps.pay_type AS payType, lps.role_class AS roleClass
      FROM labor_position_settings lps JOIN accounts a ON a.id = lps.account_id
      WHERE lps.pay_type IN ('hourly', 'overtime') AND lps.scales_with_seasonality = 1 AND COALESCE(lps.role_class, '') != 'direct'
    `).all()
    const off = db.prepare('UPDATE labor_position_settings SET scales_with_seasonality = 0 WHERE account_id = ?')
    for (const r of rows) {
      off.run(r.id)
      log(`${r.num} ${r.name} (${r.payType}, class ${r.roleClass ?? 'none'}): no longer scales with covers`)
    }
    log('added automatic/pinned staffing hours (every existing slot starts pinned)')
  }
}
