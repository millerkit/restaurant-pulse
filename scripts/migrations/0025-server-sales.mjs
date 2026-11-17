// Per-server, per-night sales for the FOH Hours page's productivity table (2026-11-17), the figures
// behind Toast's Employee productivity report. Filled by the nightly Toast sync going forward and by
// scripts/backfill-toast-server-sales.mjs for history (run by hand). Safe to re-run.
export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_toast_server_sales (
      date           TEXT NOT NULL,
      employee_guid  TEXT NOT NULL,
      orders         INTEGER NOT NULL,
      guests         INTEGER NOT NULL,
      net_sales      REAL NOT NULL,
      tax            REAL NOT NULL,
      non_cash_tips  REAL NOT NULL,
      void_count     INTEGER NOT NULL,
      turn_seconds   REAL NOT NULL,
      turn_orders    INTEGER NOT NULL,
      synced_at      TEXT NOT NULL,
      PRIMARY KEY (date, employee_guid)
    );
  `)
  log('daily_toast_server_sales ready')
}
