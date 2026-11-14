// Nights one area shouldn't count in the Covers & Spend trend (Settings › Restaurant Setup).
export default defineEventHandler(() => {
  const db = useDb()
  const exclusions = db.prepare(`
    SELECT e.area_id AS areaId, a.name AS areaName, e.date, e.note
    FROM area_night_exclusions e JOIN capacity_areas a ON a.id = e.area_id
    ORDER BY e.date DESC, a.id
  `).all()
  const areas = db.prepare('SELECT id, name FROM capacity_areas ORDER BY id').all()
  return { exclusions, areas }
})
