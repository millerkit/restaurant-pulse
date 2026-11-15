// Gift card activity synced from QBO account 2440 (2026-11-15): per-day cards sold (credits) and
// redeemed (debits) since the tracking start, plus a single-row sync status. Replaces the
// hand-typed gift_card_plan.expected_cash on Cash & Loans. Safe to re-run.
export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gift_card_activity (
      date      TEXT PRIMARY KEY,
      sold      REAL NOT NULL DEFAULT 0,
      redeemed  REAL NOT NULL DEFAULT 0,
      lines     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS gift_card_sync (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      qbo_account_id  TEXT NOT NULL,
      account_name    TEXT,
      start_date      TEXT NOT NULL,
      through_date    TEXT NOT NULL,
      synced_at       TEXT NOT NULL
    );
  `)
  log('gift_card_activity and gift_card_sync ready')
}
