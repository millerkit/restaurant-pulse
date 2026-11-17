// daily_toast_server_sales gets an is_counter flag in its key (2026-11-17): Chef's Counter orders are kept
// apart from main-floor / bar service (the prix fixe includes the gratuity and swamps a server's sales).
// SQLite can't change a primary key in place, so the table is rebuilt and existing rows copied as
// is_counter = 0; they are still the old mixed figures until the history backfill is re-run
// (scripts/backfill-toast-server-sales.mjs replaces each day with the split rows). Safe to re-run.
export function up(db, log) {
  const cols = db.prepare("PRAGMA table_info('daily_toast_server_sales')").all()
  if (cols.length === 0) return log('daily_toast_server_sales does not exist; nothing to do')
  if (cols.some(c => c.name === 'is_counter')) return log('is_counter already present')
  db.exec(`
    CREATE TABLE daily_toast_server_sales_new (
      date           TEXT NOT NULL,
      employee_guid  TEXT NOT NULL,
      is_counter     INTEGER NOT NULL DEFAULT 0,
      orders         INTEGER NOT NULL,
      guests         INTEGER NOT NULL,
      net_sales      REAL NOT NULL,
      tax            REAL NOT NULL,
      non_cash_tips  REAL NOT NULL,
      void_count     INTEGER NOT NULL,
      turn_seconds   REAL NOT NULL,
      turn_orders    INTEGER NOT NULL,
      synced_at      TEXT NOT NULL,
      PRIMARY KEY (date, employee_guid, is_counter)
    );
    INSERT INTO daily_toast_server_sales_new (date, employee_guid, is_counter, orders, guests, net_sales, tax, non_cash_tips, void_count, turn_seconds, turn_orders, synced_at)
      SELECT date, employee_guid, 0, orders, guests, net_sales, tax, non_cash_tips, void_count, turn_seconds, turn_orders, synced_at FROM daily_toast_server_sales;
    DROP TABLE daily_toast_server_sales;
    ALTER TABLE daily_toast_server_sales_new RENAME TO daily_toast_server_sales;
  `)
  log('daily_toast_server_sales rebuilt with is_counter (re-run the server-sales backfill to split history)')
}
