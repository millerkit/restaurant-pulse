// annual_sales_plan (2026-11-19, Sales Strategy annual plan): the owners' saved inputs for the full-year
// scenario card (extra event sales, buyouts, retail, extra covers per area, margins), one row per year.
// inputs is JSON, read by server/utils/annual-sales-plan.ts. Safe to re-run.
export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS annual_sales_plan (
      year        INTEGER PRIMARY KEY,
      inputs      TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      updated_by  TEXT
    );
  `)
  log('annual_sales_plan ready')
}
