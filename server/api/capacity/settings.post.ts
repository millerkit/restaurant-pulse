// Saves edits from the Edit Capacity page (app/pages/capacity/index.vue (Edit tab)) —
// per the user's explicit 2026-08-07 request to be able to revise
// capacity/turns/per-cover-revenue, holiday closures, and (same day, after
// a follow-up request) each area's own expected nightly covers per month
// directly, rather than one blended fill % standing in for every area.
// Updates capacity_areas rows by id (existing rows only — this route
// doesn't add/remove areas), upserts capacity_seasonality by month (its
// primary key), and upserts capacity_area_seasonality by (area_id, month).
// Every field but id is optional (2026-11-08): Settings saves the room setup
// (seats, turns, capacity, weekly closures) and Planning › Capacity saves the
// forecast (per-cover revenue, auto-update), each sending only its own fields.
// Omitted fields keep their stored value. capacityNovApr: undefined = keep,
// null = closed that season.
type AreaInput = {
  id: number, seats?: number, maxTurnsPerNight?: number,
  capacityNovApr?: number | null, capacityMayOct?: number,
  perCoverRevenueFood?: number, perCoverRevenueBeverage?: number,
  followActuals?: boolean,
  // Weekly closure (see capacity_areas in schema.sql). Omit all three to leave
  // the area's closure untouched; closedDows [] clears it.
  closedDows?: number[], closedFrom?: string | null, closureRecapturePct?: number,
  closureRecaptureWeights?: Record<string, number> | null
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
    const bad = (v: unknown) => v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
    for (const f of ['seats', 'maxTurnsPerNight', 'capacityMayOct', 'perCoverRevenueFood', 'perCoverRevenueBeverage'] as const) {
      if (bad(a[f])) throw createError({ statusCode: 400, statusMessage: `Invalid ${f} for area ${a.id}` })
    }
    if (a.capacityNovApr !== null && bad(a.capacityNovApr)) throw createError({ statusCode: 400, statusMessage: `Invalid capacityNovApr for area ${a.id}` })
    if (a.closedDows != null) {
      if (!Array.isArray(a.closedDows) || a.closedDows.some(d => !Number.isInteger(d) || d < 0 || d > 6 || d === 1)) {
        throw createError({ statusCode: 400, statusMessage: `Invalid closedDows for area ${a.id} (weekday numbers 0-6, not Monday)` })
      }
      if (a.closedDows.length > 0 && !(typeof a.closedFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.closedFrom))) {
        throw createError({ statusCode: 400, statusMessage: `A closure start date (YYYY-MM-DD) is required for area ${a.id}` })
      }
      if (a.closedDows.length >= 6) throw createError({ statusCode: 400, statusMessage: `Area ${a.id} can't be closed every service night` })
      if (a.closureRecapturePct != null && (!Number.isFinite(a.closureRecapturePct) || a.closureRecapturePct < 0 || a.closureRecapturePct > 100)) {
        throw createError({ statusCode: 400, statusMessage: `Invalid closureRecapturePct for area ${a.id} (0-100)` })
      }
      const w = a.closureRecaptureWeights
      if (w != null && (typeof w !== 'object' || Object.entries(w).some(([k, v]) => !Number.isInteger(Number(k)) || Number(k) < 0 || Number(k) > 6 || !Number.isFinite(v) || v < 0))) {
        throw createError({ statusCode: 400, statusMessage: `Invalid closureRecaptureWeights for area ${a.id}` })
      }
    }
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
    SET seats = COALESCE(@seats, seats), max_turns_per_night = COALESCE(@maxTurnsPerNight, max_turns_per_night),
        capacity_nov_apr = CASE WHEN @setNovApr = 1 THEN @capacityNovApr ELSE capacity_nov_apr END,
        capacity_may_oct = COALESCE(@capacityMayOct, capacity_may_oct),
        per_cover_revenue_food = COALESCE(@perCoverRevenueFood, per_cover_revenue_food),
        per_cover_revenue_beverage = COALESCE(@perCoverRevenueBeverage, per_cover_revenue_beverage),
        follow_actuals = COALESCE(@followActuals, follow_actuals),
        -- turning it off clears the marker so a later re-enable catches up on
        -- the latest closed month at the next sync
        follow_actuals_through = CASE WHEN @followActuals = 0 THEN NULL ELSE follow_actuals_through END,
        closed_dows = CASE WHEN @setClosure = 1 THEN @closedDows ELSE closed_dows END,
        closed_from = CASE WHEN @setClosure = 1 THEN @closedFrom ELSE closed_from END,
        closure_recapture_pct = CASE WHEN @setClosure = 1 THEN @closureRecapturePct ELSE closure_recapture_pct END,
        closure_recapture_weights = CASE WHEN @setClosure = 1 THEN @closureRecaptureWeights ELSE closure_recapture_weights END
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
    for (const a of areas) {
      const setClosure = a.closedDows != null
      const dows = setClosure ? [...new Set(a.closedDows)].sort((x, y) => x - y) : []
      updateArea.run({
        id: a.id,
        seats: a.seats ?? null,
        maxTurnsPerNight: a.maxTurnsPerNight ?? null,
        setNovApr: a.capacityNovApr === undefined ? 0 : 1,
        capacityNovApr: a.capacityNovApr ?? null,
        capacityMayOct: a.capacityMayOct ?? null,
        perCoverRevenueFood: a.perCoverRevenueFood ?? null,
        perCoverRevenueBeverage: a.perCoverRevenueBeverage ?? null,
        followActuals: a.followActuals == null ? null : (a.followActuals ? 1 : 0),
        setClosure: setClosure ? 1 : 0,
        closedDows: dows.length > 0 ? dows.join(',') : null,
        closedFrom: dows.length > 0 ? a.closedFrom : null,
        closureRecapturePct: dows.length > 0 ? (a.closureRecapturePct ?? 0) : 0,
        closureRecaptureWeights: dows.length > 0 && a.closureRecaptureWeights ? JSON.stringify(a.closureRecaptureWeights) : null
      })
    }
    for (const s of seasonality) upsertMonth.run(s)
    for (const s of areaSeasonality) upsertAreaMonth.run(s)
  })
  run()

  return { updatedAreas: areas.length, updatedMonths: seasonality.length, updatedAreaMonths: areaSeasonality.length }
})
