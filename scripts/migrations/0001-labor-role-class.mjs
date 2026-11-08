// labor_position_settings.role_class, seeded by account number (2026-10-02).
// Only fills NULLs, so it never overwrites a class edited in the Staffing Plan.
const SUPERVISION_NUMBERS = new Set(['6025', '6051', '6054', '6058']) // Sous Chef, GM, Exec Chef, Floor Manager
const OVERHEAD_NUMBERS = new Set(['6056', '6057']) // Assistant to the GM, Business Manager
const GROWTH_NUMBERS = new Set(['6059']) // Wine Director

export function up(db, log) {
  const hasColumn = db.prepare('PRAGMA table_info(labor_position_settings)').all().some(c => c.name === 'role_class')
  if (!hasColumn) {
    db.exec(`ALTER TABLE labor_position_settings ADD COLUMN role_class TEXT CHECK (role_class IN ('direct', 'supervision', 'overhead', 'growth'))`)
    log('added labor_position_settings.role_class')
  }
  const rows = db.prepare(`
    SELECT a.id, a.account_number AS accountNumber
    FROM labor_position_settings lps JOIN accounts a ON a.id = lps.account_id
    WHERE lps.pay_type IN ('hourly', 'salary', 'overtime') AND lps.role_class IS NULL
  `).all()
  const update = db.prepare('UPDATE labor_position_settings SET role_class = ? WHERE account_id = ?')
  for (const r of rows) {
    const n = r.accountNumber
    // No account number: a legacy/hidden role, defaulted to overhead for review.
    const cls = !n ? 'overhead'
      : SUPERVISION_NUMBERS.has(n) ? 'supervision'
      : OVERHEAD_NUMBERS.has(n) ? 'overhead'
      : GROWTH_NUMBERS.has(n) ? 'growth'
      : 'direct'
    update.run(cls, r.id)
  }
  if (rows.length) log(`classified ${rows.length} labor account(s)`)
}
