// Gift card activity from QBO (added 2026-11-15). Gift card sales are a
// balance-sheet liability (2440 Customer Deposits & Deferred Revenue:Gift
// Cards Outstanding), so they never appear in the P&L sync. Toast's nightly
// POS journal entry credits 2440 for cards sold and debits it for cards
// redeemed (that redemption revenue is in the P&L with no new cash).
//
// Each run re-pulls the whole tracking window (GIFT_CARD_TRACKING_START →
// endDate) from the GeneralLedger report and replaces it, so a backdated or
// corrected entry is picked up the next night (unlike the forward-only P&L
// sync). The window is a couple of months: one small report call.
import { generalLedgerToDailyActivity } from './qbo-gl-parse.mjs'

export const GIFT_CARD_ACCOUNT_NUMBER = '2440'
// Start of the holiday-season tracking window. Change it (and re-sync) to
// track a different season; rows before it are left alone.
export const GIFT_CARD_TRACKING_START = '2026-11-01'

type QboAccount = { Id: string, AcctNum?: string, Name: string, FullyQualifiedName?: string, Active: boolean }

export async function syncGiftCardActivity(endDate: string, startDate = GIFT_CARD_TRACKING_START) {
  if (endDate < startDate) return { skipped: true as const, days: 0, sold: 0, redeemed: 0 }
  const { qbo } = useRuntimeConfig()
  const db = useDb()

  // Balance-sheet accounts aren't in the local accounts table (P&L only), so
  // look 2440 up by number in QBO itself. Refuse anything but one match.
  const query = 'SELECT * FROM Account MAXRESULTS 1000'
  const acctRes = await qboFetch(qbo.environment, qbo.clientId, qbo.clientSecret, (realmId) => `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`)
  const acctBody = await acctRes.res.json().catch(() => ({}))
  if (!acctRes.res.ok || qboFaultType(acctBody)) throw logAndWrapQboError('QBO Account query (gift cards)', acctRes.res, acctBody, acctRes.intuitTid)
  const matches = ((acctBody?.QueryResponse?.Account ?? []) as QboAccount[]).filter(a => a.AcctNum === GIFT_CARD_ACCOUNT_NUMBER)
  if (matches.length !== 1) throw new Error(`gift card account ${GIFT_CARD_ACCOUNT_NUMBER}: ${matches.length} QBO accounts match`)
  const account = matches[0]!

  // Accrual: this is a balance-sheet account; the journal entries are the
  // same either way, but cash basis can hide balance-sheet lines.
  const params = new URLSearchParams({
    account: account.Id,
    start_date: startDate,
    end_date: endDate,
    accounting_method: 'Accrual',
    columns: 'tx_date,txn_type,doc_num,memo,debt_amt,credt_amt,subt_nat_amount'
  })
  const { res, intuitTid } = await qboFetch(qbo.environment, qbo.clientId, qbo.clientSecret, (realmId) => `/v3/company/${realmId}/reports/GeneralLedger?${params}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || qboFaultType(body)) throw logAndWrapQboError('QBO GeneralLedger request (gift cards)', res, body, intuitTid)

  const days = generalLedgerToDailyActivity(body) as { date: string, credits: number, debits: number, lines: number }[]

  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare('DELETE FROM gift_card_activity WHERE date >= ? AND date <= ?').run(startDate, endDate)
    const ins = db.prepare('INSERT INTO gift_card_activity (date, sold, redeemed, lines) VALUES (?, ?, ?, ?)')
    for (const d of days) ins.run(d.date, d.credits, d.debits, d.lines)
    db.prepare(`
      INSERT INTO gift_card_sync (id, qbo_account_id, account_name, start_date, through_date, synced_at) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET qbo_account_id = excluded.qbo_account_id, account_name = excluded.account_name,
        start_date = excluded.start_date, through_date = excluded.through_date, synced_at = excluded.synced_at
    `).run(account.Id, account.FullyQualifiedName ?? account.Name, startDate, endDate, now)
  })()

  return {
    skipped: false as const,
    days: days.length,
    sold: Math.round(days.reduce((t, d) => t + d.credits, 0) * 100) / 100,
    redeemed: Math.round(days.reduce((t, d) => t + d.debits, 0) * 100) / 100
  }
}
