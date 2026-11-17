// Home › Summary owners' note (2026-11-17): one optional free-text note the owners type on the
// Summary page, shown to every role above the automatic summary. Single row (id is always 1).
// Safe to re-run.
export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_summary_note (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      body        TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      updated_by  TEXT
    );
  `)
  log('home_summary_note ready')
}
