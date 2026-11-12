// Saves the Toast job -> Staffing Plan role mapping (Settings › Staff & Pay Rules). accountId null
// = salaried / fixed pay, deliberately not tied to hours (a manager's or owner's job, say). Only hourly Staffing Plan accounts are valid
// targets. Moves the automatic hours, so the forecast refreshes afterwards.
import { refreshForecastsAfterChange } from '../../utils/capacity-forecast'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ jobs?: { guid: string, accountId: number | null }[] }>(event)
  const jobs = body?.jobs
  if (!Array.isArray(jobs)) throw createError({ statusCode: 400, statusMessage: 'Expected a "jobs" array' })
  const db = useDb()
  const hourly = new Set((db.prepare("SELECT account_id FROM labor_position_settings WHERE pay_type = 'hourly'").all() as { account_id: number }[]).map(r => r.account_id))
  const known = new Set((db.prepare('SELECT guid FROM toast_jobs').all() as { guid: string }[]).map(r => r.guid))
  for (const j of jobs) {
    if (typeof j.guid !== 'string' || !known.has(j.guid)) throw createError({ statusCode: 400, statusMessage: `Unknown Toast job ${j.guid}` })
    if (j.accountId != null && !hourly.has(j.accountId)) throw createError({ statusCode: 400, statusMessage: `Account ${j.accountId} is not an hourly Staffing Plan role` })
  }
  const upsert = db.prepare(`
    INSERT INTO toast_job_labor_accounts (job_guid, account_id, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(job_guid) DO UPDATE SET account_id = excluded.account_id, updated_at = excluded.updated_at
  `)
  const now = new Date().toISOString()
  db.transaction(() => { for (const j of jobs) upsert.run(j.guid, j.accountId ?? null, now) })()
  refreshForecastsAfterChange(db, useRuntimeConfig().qbo?.syncTimeZone)
  return { saved: jobs.length }
})
