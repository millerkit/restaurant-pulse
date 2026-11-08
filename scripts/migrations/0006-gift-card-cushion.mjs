// Share of gift card cash held back for next year (2026-10-30). Needs 0004.
export function up(db, log) {
  const cols = db.prepare('PRAGMA table_info(gift_card_plan)').all()
  if (!cols.some(c => c.name === 'cushion_pct')) {
    db.exec('ALTER TABLE gift_card_plan ADD COLUMN cushion_pct REAL NOT NULL DEFAULT 25 CHECK (cushion_pct >= 0 AND cushion_pct <= 100)')
    log('added gift_card_plan.cushion_pct')
  }
}
