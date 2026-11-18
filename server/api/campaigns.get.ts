// Planning › Sales Strategy › Campaigns (owner-only by default deny): every logged marketing campaign with its
// results (server/utils/campaigns.ts), plus the lists the add form needs.
export default defineEventHandler(() => {
  const db = useDb()
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const campaigns = loadCampaigns(db).map(c => ({ ...c, results: computeCampaignResults(db, c, todayIso) }))
  let areas: string[] = []
  try { areas = (db.prepare('SELECT name FROM capacity_areas ORDER BY id').all() as { name: string }[]).map(a => a.name) } catch { /* no areas yet */ }
  return { campaigns, areas, channels: CAMPAIGN_CHANNELS, todayIso, minNights: MIN_CAMPAIGN_NIGHTS, flatBand: FLAT_BAND }
})
