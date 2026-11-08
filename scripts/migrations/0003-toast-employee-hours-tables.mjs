// Staff Hours: per-employee hours, Toast employee names, benefits enrollment (2026-10-27).
const ENROLLMENT_DDL = (name) => `
  CREATE TABLE ${name} (
    employee_guid  TEXT PRIMARY KEY,
    status         TEXT NOT NULL CHECK (status IN ('enrolled', 'declined', 'canceled')),
    note           TEXT,
    updated_at     TEXT NOT NULL
  )`

export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_toast_employee_hours (
      date           TEXT NOT NULL,
      employee_guid  TEXT NOT NULL,
      hours          REAL NOT NULL,
      auto_clocked_out_shifts  INTEGER NOT NULL DEFAULT 0,
      auto_clocked_out_hours   REAL NOT NULL DEFAULT 0,
      synced_at      TEXT NOT NULL,
      PRIMARY KEY (date, employee_guid)
    );
    CREATE TABLE IF NOT EXISTS toast_employees (
      guid         TEXT PRIMARY KEY,
      first_name   TEXT,
      last_name    TEXT,
      chosen_name  TEXT,
      deleted      INTEGER NOT NULL DEFAULT 0,
      synced_at    TEXT NOT NULL
    );
  `)
  const current = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'benefits_enrollment_status'`).get()
  if (!current) {
    db.exec(ENROLLMENT_DDL('benefits_enrollment_status'))
    log('created benefits_enrollment_status')
  } else if (!current.sql.includes("'enrolled'")) {
    // The CHECK constraint can't be widened in place: rebuild, keeping rows.
    db.exec('ALTER TABLE benefits_enrollment_status RENAME TO benefits_enrollment_status_old')
    db.exec(ENROLLMENT_DDL('benefits_enrollment_status'))
    db.exec('INSERT INTO benefits_enrollment_status SELECT employee_guid, status, note, updated_at FROM benefits_enrollment_status_old')
    db.exec('DROP TABLE benefits_enrollment_status_old')
    log('rebuilt benefits_enrollment_status to allow status = enrolled')
  }
}
