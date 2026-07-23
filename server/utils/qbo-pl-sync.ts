// Pulls a ProfitAndLoss report (summarize_column_by=Days) for one date
// range and upserts the resulting daily figures into daily_line_items.
// Report-JSON parsing itself lives in qbo-pl-parse.mjs (plain JS, shared
// with the standalone backfill script) — this file is just the QBO call
// plus the DB write. Imported explicitly (not relying on Nitro auto-import)
// since auto-import coverage of a plain .mjs util file alongside .ts ones
// isn't something to assume without checking.
import { reportToLineItems } from './qbo-pl-parse.mjs'

export async function syncPlForDateRange(startDate: string, endDate: string): Promise<{ rowsSynced: number, unmatchedQboAccountIds: string[] }> {
  const { qbo } = useRuntimeConfig()
  const db = useDb()

  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, summarize_column_by: 'Days' })
  const { res, intuitTid } = await qboFetch(qbo.environment, qbo.clientId, qbo.clientSecret, (realmId) => `/v3/company/${realmId}/reports/ProfitAndLoss?${params}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || qboFaultType(body)) {
    throw logAndWrapQboError('QBO ProfitAndLoss request', res, body, intuitTid)
  }

  const items = reportToLineItems(body)

  // Not filtered by is_active — a historical report row for a
  // since-deactivated account still needs to land against its (never
  // deleted) accounts.id.
  const accountsByQboId = new Map(
    (db.prepare('SELECT id, qbo_account_id FROM accounts WHERE qbo_account_id IS NOT NULL').all() as { id: number, qbo_account_id: string }[])
      .map(r => [r.qbo_account_id, r.id])
  )

  const upsert = db.prepare(`
    INSERT INTO daily_line_items (date, account_id, amount) VALUES (@date, @accountId, @amount)
    ON CONFLICT(date, account_id) DO UPDATE SET amount = excluded.amount
  `)

  const unmatched = new Set<string>()
  const rowsSynced = db.transaction((rows: typeof items) => {
    let n = 0
    for (const item of rows) {
      const accountId = accountsByQboId.get(item.qboAccountId)
      if (!accountId) {
        unmatched.add(item.qboAccountId)
        continue
      }
      upsert.run({ date: item.date, accountId, amount: item.amount })
      n++
    }
    return n
  })(items)

  if (unmatched.size > 0) {
    // Most likely cause: a brand-new QBO account hasn't been picked up by
    // the account sync yet. runNightlySync always runs the account sync
    // first for exactly this reason, but a same-run race (a transaction
    // posted to a new account between the two calls) can still leave a
    // one-night gap that resolves itself the next run.
    console.warn(`syncPlForDateRange(${startDate}..${endDate}): ${unmatched.size} unmatched QBO account id(s), skipped: ${[...unmatched].join(', ')}`)
  }

  return { rowsSynced, unmatchedQboAccountIds: [...unmatched] }
}
