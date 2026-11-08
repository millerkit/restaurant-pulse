// Expected gift card cash before year end (2026-10-28).
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gift_card_plan (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      expected_cash  REAL NOT NULL,
      updated_at     TEXT NOT NULL
    )
  `)
}
