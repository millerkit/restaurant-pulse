// Bank register import for the loan reserve (2026-11-11): reserve_transfers rows now say where they
// came from, and the last import is remembered so the page can show "bank register current through".
export function up(db) {
  const cols = db.prepare("PRAGMA table_info(reserve_transfers)").all().map(c => c.name)
  if (!cols.includes('source')) {
    db.exec("ALTER TABLE reserve_transfers ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bank'))")
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS reserve_bank_sync (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      through_date   TEXT NOT NULL,
      ending_balance REAL NOT NULL,
      row_count      INTEGER NOT NULL,
      imported_at    TEXT NOT NULL
    )
  `)
}
