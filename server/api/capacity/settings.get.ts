// Loads the current capacity_areas + capacity_seasonality (holiday
// closures) + capacity_area_seasonality (per-area, per-month expected
// covers) rows for the Edit Capacity page (app/pages/capacity/edit.vue) —
// the same tables server/api/capacity.get.ts reads, just without the
// projection math, since this route only needs to populate an editable
// form.
export default defineEventHandler(() => {
  const db = useDb()
  const areas = db.prepare('SELECT * FROM capacity_areas ORDER BY id').all()
  const seasonality = db.prepare('SELECT * FROM capacity_seasonality ORDER BY month').all()
  const areaSeasonality = db.prepare('SELECT * FROM capacity_area_seasonality ORDER BY area_id, month').all()
  return { areas, seasonality, areaSeasonality }
})
