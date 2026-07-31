// Single entry point for "run a sync" — called identically by the nightly
// scheduler plugin (server/plugins/qbo-nightly-sync.ts) and the manual
// trigger route (server/api/qbo/sync.post.ts), so there's exactly one
// place that decides what a sync run does and how sync_runs bookkeeping
// works.

// "Yesterday" needs to be a real IANA-zone-aware local calendar date, not
// a raw UTC one — the container's clock is UTC, and computing "yesterday"
// via plain UTC arithmetic can land on the wrong local day depending on
// what time it is. Mirrors server/plugins/qbo-nightly-sync.ts's own
// toLocalDateParts logic (kept separate rather than shared/imported —
// small enough, and this file has no existing dependency on that plugin).
function localToday(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function addDaysToIsoDate(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// Cheap overlap guard — sufficient for this single-process Fly app
// (fly.toml: min_machines_running=1), so a manual trigger firing while the
// nightly scheduler is mid-run can't run two syncs concurrently against
// the same sqlite file.
let syncInProgress = false

export async function runNightlySync(dateOverride?: string) {
  const { qbo, toast } = useRuntimeConfig()
  // QBO_ENVIRONMENT defaults to 'sandbox' (nuxt.config.ts) and every
  // non-production deploy — including local dev, which can never hold a
  // real production OAuth connection at all (Intuit's production keys only
  // accept a public HTTPS redirect URI) — is left on that default. A
  // sandbox connection is a *different* real QBO company, not "no
  // connection," and it's genuinely harmful to run this against: QBO
  // account IDs are small per-company sequential integers, so a sandbox
  // sync can coincidentally collide with real production qbo_account_id
  // values already in the local accounts table and silently overwrite
  // real account names/numbers with unrelated sandbox data (see CLAUDE.md's
  // "Local dev's QBO connection" section — this refusal is the fix for a
  // real incident, not a hypothetical). Simulating Urban Hearth's data in
  // the sandbox isn't worth the effort, so this is a hard block, not an
  // opt-in toggle — bypass it by changing QBO_ENVIRONMENT locally if you
  // genuinely mean to.
  if (qbo.environment !== 'production') {
    throw createError({
      statusCode: 412,
      statusMessage: `QBO sync refused: this environment's QBO_ENVIRONMENT is "${qbo.environment}", not "production". Syncing against the sandbox can corrupt real account data via ID collisions — see CLAUDE.md.`
    })
  }

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

    // Never syncs "today" itself — the day isn't over yet, same as before
    // this change. Local-timezone-aware (see localToday) rather than raw
    // UTC arithmetic, so this can't land on the wrong calendar day
    // depending on what time it is in UTC.
    const endDate = dateOverride ?? addDaysToIsoDate(localToday(qbo.syncTimeZone), -1)

    // Catch up from the day after whatever's already in daily_line_items,
    // not just "yesterday" — a fixed single-day target meant a missed
    // night (an error, a restart, a gap before the app was even running)
    // silently dropped that day forever, since nothing ever looked
    // further back than exactly one day. dateOverride (an explicit
    // single-date re-sync, e.g. for troubleshooting one day) bypasses this
    // entirely and stays single-day here — but see MIN_QBO_LOOKBACK_DAYS
    // below, which widens the actual QBO request regardless.
    let catchUpStartDate = endDate
    if (!dateOverride) {
      const row = db.prepare(`SELECT MAX(date) as maxDate FROM daily_line_items`).get() as { maxDate: string | null }
      if (row.maxDate) {
        const dayAfter = addDaysToIsoDate(row.maxDate, 1)
        // Never later than endDate: if daily_line_items is already caught
        // up (or somehow ahead), fall back to re-syncing just yesterday
        // rather than passing an inverted range to QBO.
        catchUpStartDate = dayAfter <= endDate ? dayAfter : endDate
      }
    }

    // QBO's ProfitAndLoss Reports API silently omits an account's row
    // entirely (not even a $0 row) when that account has no non-zero
    // activity within the requested date range — confirmed live against
    // production: a 3-day request returned ~15 accounts/day, but the same
    // three days requested as part of a full-month range returned the
    // normal ~99/day. Payroll (posted biweekly, not daily) is the account
    // most exposed to this — it looks "inactive" in almost any short
    // window and vanishes from the response instead of coming back as a
    // real zero. This is exactly what the original catch-up fix above
    // made worse: once caught up, every steady-state night requests just a
    // 1-day window, which is the failure case every single time. Since
    // syncPlForDateRange upserts (ON CONFLICT DO UPDATE), there's no
    // downside to always requesting a wider trailing window than the
    // strict catch-up gap needs — MIN_QBO_LOOKBACK_DAYS is a pragmatic
    // floor picked from what was actually observed to work (3 days:
    // broken; 30 days: correct), not a documented QBO threshold, so it's
    // deliberately generous rather than tuned to the minimum that happened
    // to work in this one test.
    const MIN_QBO_LOOKBACK_DAYS = 30
    const minLookbackStart = addDaysToIsoDate(endDate, -MIN_QBO_LOOKBACK_DAYS)
    const qboStartDate = catchUpStartDate < minLookbackStart ? catchUpStartDate : minLookbackStart

    // One Reports API call for the whole range — fine for the window this
    // covers (30+ days); a gap of months would want
    // scripts/backfill-qbo-pl.mjs's month-chunked approach instead (see its
    // own comment on why one giant range isn't reliable at that size).
    const plResult = await syncPlForDateRange(qboStartDate, endDate)

    // Toast is a separate POS system, not a QBO endpoint, but folded into
    // the same nightly run/sync_runs row rather than a second scheduler —
    // one "as of" freshness signal for the whole dashboard, not two. Only
    // runs if Toast credentials are configured, so an environment without
    // them (e.g. local dev before .env.local is filled in) doesn't fail
    // the whole sync. Toast's own APIs only take a single businessDate
    // (see scripts/backfill-toast-metrics.mjs), so a multi-day catch-up
    // range means one call per day here, same chunking the backfill script
    // already does. Deliberately uses catchUpStartDate, not the wider
    // QBO-padded qboStartDate above — Toast doesn't have QBO's
    // narrow-range row-dropping problem, so padding it would just mean up
    // to 30 redundant single-day API calls every night for no benefit.
    let toastResult: { covers: number; laborHours: number; daysSynced: number } | null = null
    if (toast.clientId && toast.clientSecret && toast.apiHostname && toast.restaurantGuid) {
      toastResult = { covers: 0, laborHours: 0, daysSynced: 0 }
      for (let date = catchUpStartDate; date <= endDate; date = addDaysToIsoDate(date, 1)) {
        const dayResult = await syncToastMetricsForDate(toast, date)
        toastResult.covers += dayResult.covers
        toastResult.laborHours += dayResult.laborHours
        toastResult.daysSynced++
      }
    }

    const rowsSynced = accountResult.inserted + accountResult.updated + accountResult.deactivated + accountResult.reactivated + plResult.rowsSynced + (toastResult?.daysSynced ?? 0)
    db.prepare(`UPDATE sync_runs SET finished_at = ?, status = 'success', rows_synced = ? WHERE id = ?`)
      .run(new Date().toISOString(), rowsSynced, runId)

    return { accountResult, plResult, toastResult, rowsSynced }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.prepare(`UPDATE sync_runs SET finished_at = ?, status = 'error', error_message = ? WHERE id = ?`)
      .run(new Date().toISOString(), message, runId)
    throw err
  } finally {
    syncInProgress = false
  }
}
