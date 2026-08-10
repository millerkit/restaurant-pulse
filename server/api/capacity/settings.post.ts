// Saves edits from the Edit Capacity page (app/pages/capacity/edit.vue) —
// per the user's explicit 2026-08-07 request to be able to revise
// capacity/turns/per-cover-revenue, holiday closures, and (same day, after
// a follow-up request) each area's own expected nightly covers per month
// directly, rather than one blended fill % standing in for every area.
// Updates capacity_areas rows by id (existing rows only — this route
// doesn't add/remove areas), upserts capacity_seasonality by month (its
// primary key), and upserts capacity_area_seasonality by (area_id, month).
type AreaInput = {
  id: number, seats: number, maxTurnsPerNight: number,
  capacityNovApr: number | null, capacityMayOct: number,
  perCoverRevenueFood: number, perCoverRevenueBeverage: number
}
type SeasonalityInput = { month: number, holidayClosures: number }
type AreaSeasonalityInput = { areaId: number, month: number, expectedCovers: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<{ areas: AreaInput[], seasonality: SeasonalityInput[], areaSeasonality: AreaSeasonalityInput[] }>(event)
  const areas = body?.areas ?? []
  const seasonality = body?.seasonality ?? []
  const areaSeasonality = body?.areaSeasonality ?? []
  if (areas.length === 0 && seasonality.length === 0 && areaSeasonality.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Expected "areas", "seasonality", and/or "areaSeasonality" to update' })
  }

  const db = useDb()

  for (const a of areas) {
    if (!Number.isInteger(a.id)) throw createError({ statusCode: 400, statusMessage: `Invalid area id: ${a.id}` })
    if (!db.prepare('SELECT 1 FROM capacity_areas WHERE id = ?').get(a.id)) {
      throw createError({ statusCode: 400, statusMessage: `No capacity_areas row with id ${a.id}` })
    }
    if (!Number.isFinite(a.seats) || a.seats < 0) throw createError({ statusCode: 400, statusMessage: `Invalid seats for area ${a.id}` })
    if (!Number.isFinite(a.maxTurnsPerNight) || a.maxTurnsPerNight < 0) throw createError({ statusCode: 400, statusMessage: `Invalid maxTurnsPerNight for area ${a.id}` })
    if (a.capacityNovApr != null && (!Number.isFinite(a.capacityNovApr) || a.capacityNovApr < 0)) throw createError({ statusCode: 400, statusMessage: `Invalid capacityNovApr for area ${a.id}` })
    if (!Number.isFinite(a.capacityMayOct) || a.capacityMayOct < 0) throw createError({ statusCode: 400, statusMessage: `Invalid capacityMayOct for area ${a.id}` })
    if (!Number.isFinite(a.perCoverRevenueFood) || a.perCoverRevenueFood < 0) throw createError({ statusCode: 400, statusMessage: `Invalid perCoverRevenueFood for area ${a.id}` })
    if (!Number.isFinite(a.perCoverRevenueBeverage) || a.perCoverRevenueBeverage < 0) throw createError({ statusCode: 400, statusMessage: `Invalid perCoverRevenueBeverage for area ${a.id}` })
  }
  for (const s of seasonality) {
    if (!Number.isInteger(s.month) || s.month < 1 || s.month > 12) throw createError({ statusCode: 400, statusMessage: `Invalid month: ${s.month}` })
    if (!Number.isInteger(s.holidayClosures) || s.holidayClosures < 0) throw createError({ statusCode: 400, statusMessage: `Invalid holidayClosures for month ${s.month}` })
  }
  const activeAreaIds = new Set(db.prepare('SELECT id FROM capacity_areas').all().map((r: any) => r.id))
  for (const s of areaSeasonality) {
    if (!activeAreaIds.has(s.areaId)) throw createError({ statusCode: 400, statusMessage: `No capacity_areas row with id ${s.areaId}` })
    if (!Number.isInteger(s.month) || s.month < 1 || s.month > 12) throw createError({ statusCode: 400, statusMessage: `Invalid month: ${s.month}` })
    if (!Number.isFinite(s.expectedCovers) || s.expectedCovers < 0) throw createError({ statusCode: 400, statusMessage: `Invalid expectedCovers for area ${s.areaId}, month ${s.month}` })
  }

  const updateArea = db.prepare(`
    UPDATE capacity_areas
    SET seats = @seats, max_turns_per_night = @maxTurnsPerNight,
        capacity_nov_apr = @capacityNovApr, capacity_may_oct = @capacityMayOct,
        per_cover_revenue_food = @perCoverRevenueFood, per_cover_revenue_beverage = @perCoverRevenueBeverage
    WHERE id = @id
  `)
  const upsertMonth = db.prepare(`
    INSERT INTO capacity_seasonality (month, holiday_closures)
    VALUES (@month, @holidayClosures)
    ON CONFLICT(month) DO UPDATE SET holiday_closures = excluded.holiday_closures
  `)
  const upsertAreaMonth = db.prepare(`
    INSERT INTO capacity_area_seasonality (area_id, month, expected_covers)
    VALUES (@areaId, @month, @expectedCovers)
    ON CONFLICT(area_id, month) DO UPDATE SET expected_covers = excluded.expected_covers
  `)
  const run = db.transaction(() => {
    for (const a of areas) updateArea.run(a)
    for (const s of seasonality) upsertMonth.run(s)
    for (const s of areaSeasonality) upsertAreaMonth.run(s)
  })
  run()

  return { updatedAreas: areas.length, updatedMonths: seasonality.length, updatedAreaMonths: areaSeasonality.length }
})
