// Taxable tips per payroll and per-person first paycheck dates (2026-10-07).
export function up(db, log) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
  if (!has('labor_tax_rates', 'taxable_tips_per_payroll')) {
    db.exec('ALTER TABLE labor_tax_rates ADD COLUMN taxable_tips_per_payroll REAL NOT NULL DEFAULT 0')
    log('added labor_tax_rates.taxable_tips_per_payroll')
  }
  if (!has('labor_position_slots', 'first_paycheck_date')) {
    db.exec('ALTER TABLE labor_position_slots ADD COLUMN first_paycheck_date TEXT')
    log('added labor_position_slots.first_paycheck_date')
  }
}
