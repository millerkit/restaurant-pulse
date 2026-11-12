// Pay changes are dated by year (2026-11-12). A person's rate/salary used to be one value shared
// by every budget year, so changing 2027 pay on the Staffing Plan also repriced Dec 2026.
// labor_position_slots now keeps the pay in force BEFORE a change (prior_hourly_rate,
// prior_weekly_salary) and the first year the current pay applies (pay_change_year). NULL
// pay_change_year = one pay for all years (every existing row). Safe to re-run.
function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
}

export function up(db, log) {
  for (const [col, type] of [['prior_hourly_rate', 'REAL'], ['prior_weekly_salary', 'REAL'], ['pay_change_year', 'INTEGER']]) {
    if (!hasColumn(db, 'labor_position_slots', col)) db.exec(`ALTER TABLE labor_position_slots ADD COLUMN ${col} ${type}`)
  }
  log('added dated pay columns to labor_position_slots')
}
