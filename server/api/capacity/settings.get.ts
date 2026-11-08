// Loads the current capacity_areas + capacity_seasonality (holiday
// closures) + capacity_area_seasonality (per-area, per-month expected
// covers) rows for the Edit Capacity page (app/pages/capacity/index.vue (Edit tab)) —
// the same tables server/api/capacity.get.ts reads, just without the
// projection math, since this route only needs to populate an editable
// form.
export default defineEventHandler((event) => {
  const db = useDb()
  // Nights replacing normal dinner service in ?year= (holidays + special nights
  // other than buyouts), so the Capacity grid's projection matches the server's.
  const year = Number(getQuery(event).year)
  const replacedNights = Number.isInteger(year) && year >= 2000 && year <= 2100
    ? [...loadReplacedNights(db, `${year}-01-01`, `${year}-12-31`).values()].map(n => ({ date: n.date, kind: n.kind, expectedRevenue: n.expectedRevenue, name: n.holiday ?? n.note }))
    : []
  const areas = db.prepare('SELECT * FROM capacity_areas ORDER BY id').all()
  const seasonality = db.prepare('SELECT * FROM capacity_seasonality ORDER BY month').all()
  const areaSeasonality = db.prepare('SELECT * FROM capacity_area_seasonality ORDER BY area_id, month').all()
  return { areas, seasonality, areaSeasonality, replacedNights }
})
