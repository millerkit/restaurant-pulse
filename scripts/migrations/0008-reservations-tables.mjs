// OpenTable reservation import (2026-11-04).
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_date        TEXT NOT NULL,
      visit_time        TEXT,
      created_at        TEXT,
      canceled_at       TEXT,
      no_show_at        TEXT,
      seated_at         TEXT,
      size              INTEGER NOT NULL,
      status            TEXT NOT NULL,
      tables            TEXT,
      area_assigned     TEXT,
      area_booked       TEXT,
      source            TEXT,
      online_waitlist   INTEGER NOT NULL DEFAULT 0,
      experience_title  TEXT,
      prepayment_status TEXT,
      imported_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reservations_visit_date ON reservations (visit_date);
    CREATE TABLE IF NOT EXISTS reservation_imports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at   TEXT NOT NULL,
      rows          INTEGER NOT NULL,
      date_from     TEXT NOT NULL,
      date_to       TEXT NOT NULL,
      replaced_rows INTEGER NOT NULL
    );
  `)
}
