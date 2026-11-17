// Home › Summary data (2026-11-17). Every role may call this (shared/utils/access.ts); the text is
// built separately for each role from only the facts that role may see (server/utils/home-summary.ts),
// so nothing is hidden after the fact on the client.
//
// The owner's Cash and loans sentences reuse the Cash & Loans route's own payload: its handler is
// called directly with this request's event (owner only), so the reserve projection is never
// re-derived here and can't drift from what Cash & Loans shows.
import { buildHomeSummary, type CashInputs } from '../utils/home-summary'
import { ensureForecastsFresh, restaurantToday } from '../utils/capacity-forecast'
import cashflowHandler from './cashflow.get'
import type { Role } from '#shared/utils/access'

type CashflowPayload = {
  reserve?: { target: number, catchUpDate: string | null, onPaceForCatchUp: boolean | null, catchUpShortfall: number | null } | null
  upcomingPayments?: { date: string, total: number }[]
  yearProjection?: { giftCards?: { startDate: string, sold: number, net: number } | null }
}

export default defineEventHandler(async (event) => {
  const db = useDb()
  const tz = useRuntimeConfig().qbo?.syncTimeZone
  ensureForecastsFresh(db, tz)
  const role = ((event.context.auth as { role?: Role } | undefined)?.role ?? 'owner') as Role
  const today = restaurantToday(tz)

  let cash: CashInputs | null = null
  if (role === 'owner') {
    try {
      const cf = await (cashflowHandler as unknown as (e: typeof event) => Promise<CashflowPayload> | CashflowPayload)(event)
      cash = {
        reserve: cf.reserve ?? null,
        upcomingPayments: cf.upcomingPayments ?? [],
        giftCards: cf.yearProjection?.giftCards ?? null
      }
    } catch (err) {
      console.error('home-summary: cash & loans figures unavailable', err)
    }
  }

  const summary = buildHomeSummary(db, role, today, cash)

  let note: { body: string, updatedAt: string, updatedBy: string | null } | null = null
  try {
    const r = db.prepare('SELECT body, updated_at AS updatedAt, updated_by AS updatedBy FROM home_summary_note WHERE id = 1').get() as typeof note | undefined
    note = r ?? null
  } catch { /* migration not applied yet */ }

  return { ...summary, role, note, canEditNote: role === 'owner' }
})
