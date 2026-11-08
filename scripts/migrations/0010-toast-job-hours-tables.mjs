// BOH hours report: hours by employee-day-job and Toast job titles (2026-11-06).
export function up(db, log) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_toast_job_hours (
      date            TEXT NOT NULL,
      employee_guid   TEXT NOT NULL,
      job_guid        TEXT NOT NULL,
      regular_hours   REAL NOT NULL,
      overtime_hours  REAL NOT NULL,
      auto_clocked_out_shifts  INTEGER NOT NULL DEFAULT 0,
      auto_clocked_out_hours   REAL NOT NULL DEFAULT 0,
      synced_at       TEXT NOT NULL,
      PRIMARY KEY (date, employee_guid, job_guid)
    );
    CREATE TABLE IF NOT EXISTS toast_jobs (
      guid            TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      wage_frequency  TEXT,
      deleted         INTEGER NOT NULL DEFAULT 0,
      synced_at       TEXT NOT NULL
    );
  `)
  const cols = db.prepare('PRAGMA table_info(daily_toast_job_hours)').all().map(c => c.name)
  for (const [name, ddl] of [['auto_clocked_out_shifts', 'INTEGER NOT NULL DEFAULT 0'], ['auto_clocked_out_hours', 'REAL NOT NULL DEFAULT 0']]) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE daily_toast_job_hours ADD COLUMN ${name} ${ddl}`)
      log(`added daily_toast_job_hours.${name}`)
    }
  }
}
