// What reservation data is loaded: totals, date range, status mix, recent uploads.
export default defineEventHandler(() => {
  const db = useDb()
  const total = db.prepare(`
    SELECT COUNT(*) AS rows, MIN(visit_date) AS dateFrom, MAX(visit_date) AS dateTo,
           SUM(created_at IS NOT NULL) AS withCreated, SUM(canceled_at IS NOT NULL) AS withCanceled
    FROM reservations
  `).get() as { rows: number, dateFrom: string | null, dateTo: string | null, withCreated: number | null, withCanceled: number | null }
  if (!total.rows) return { hasData: false as const }

  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM reservations GROUP BY status ORDER BY n DESC').all()
  const bySource = db.prepare('SELECT COALESCE(source, \'Unknown\') AS source, COUNT(*) AS n FROM reservations GROUP BY source ORDER BY n DESC').all()
  const imports = db.prepare('SELECT imported_at AS importedAt, rows, date_from AS dateFrom, date_to AS dateTo, replaced_rows AS replacedRows FROM reservation_imports ORDER BY id DESC LIMIT 5').all()
  return {
    hasData: true as const,
    ...total,
    withCreated: total.withCreated ?? 0,
    withCanceled: total.withCanceled ?? 0,
    byStatus,
    bySource,
    imports
  }
})
