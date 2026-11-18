// special_nights gets booked_on (2026-11-18): the date an event, buyout or catering job was booked (deposit
// paid or agreement signed), so Sales Strategy can measure how far ahead those actually book instead of
// borrowing large-party reservation lead times. Nullable: existing rows stay unknown until filled in on the
// Sales Plan. Safe to re-run.
export function up(db, log) {
  const cols = db.prepare("PRAGMA table_info('special_nights')").all()
  if (cols.length === 0) return log('special_nights does not exist; nothing to do')
  if (cols.some(c => c.name === 'booked_on')) return log('booked_on already present')
  db.exec('ALTER TABLE special_nights ADD COLUMN booked_on TEXT')
  log('special_nights.booked_on added')
}
