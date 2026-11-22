// special_nights gets ticket_price (2026-11-22): price per guest of a ticketed on-site event (e.g. New Year's
// Eve prix fixe). The Sales Plan multiplies it by the covers booked on the latest OpenTable upload to SUGGEST
// event revenue (display only; event_revenue stays hand-entered). Nullable. Safe to re-run.
export function up(db, log) {
  const cols = db.prepare("PRAGMA table_info('special_nights')").all()
  if (cols.length === 0) return log('special_nights does not exist; nothing to do')
  if (cols.some(c => c.name === 'ticket_price')) return log('ticket_price already present')
  db.exec('ALTER TABLE special_nights ADD COLUMN ticket_price REAL')
  log('special_nights.ticket_price added')
}
