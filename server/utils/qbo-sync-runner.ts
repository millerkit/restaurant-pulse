// Single entry point for "run a sync" — called identically by the nightly
// scheduler plugin (server/plugins/qbo-nightly-sync.ts) and the manual
// trigger route (server/api/qbo/sync.post.ts), so there's exactly one
// place that decides what a sync run does and how sync_runs bookkeeping
// works.
function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// Cheap overlap guard — sufficient for this single-process Fly app
// (fly.toml: min_machines_running=1), so a manual trigger firing while the
// nightly scheduler is mid-run can't run two syncs concurrently against
// the same sqlite file.
let syncInProgress = false

export async function runNightlySync(dateOverride?: string) {
  if (syncInProgress) {
    throw createError({ statusCode: 409, statusMessage: 'A sync is already running' })
  }
  syncInProgress = true

  const db = useDb()
  const startedAt = new Date().toISOString()
  const { lastInsertRowid: runId } = db.prepare(
    `INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')`
  ).run(startedAt)

  try {
    // Accounts before P&L, every time: a brand-new QBO account needs a
    // local accounts row (and thus a valid qbo_account_id match target)
    // before its own P&L data is processed.
    const accountResult = await syncQboAccounts()
    const targetDate = dateOverride ?? isoDateNDaysAgo(1)
    const plResult = await syncPlForDateRange(targetDate, targetDate)

    const rowsSynced = accountResult.inserted + accountResult.updated + accountResult.deactivated + accountResult.reactivated + plResult.rowsSynced
    db.prepare(`UPDATE sync_runs SET finished_at = ?, status = 'success', rows_synced = ? WHERE id = ?`)
      .run(new Date().toISOString(), rowsSynced, runId)

    return { accountResult, plResult, rowsSynced }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.prepare(`UPDATE sync_runs SET finished_at = ?, status = 'error', error_message = ? WHERE id = ?`)
      .run(new Date().toISOString(), message, runId)
    throw err
  } finally {
    syncInProgress = false
  }
}
