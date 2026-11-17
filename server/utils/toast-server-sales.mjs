// Pure transform (no imports, plain JS, so the nightly sync and
// scripts/backfill-toast-server-sales.mjs share it, same reasoning as qbo-pl-parse.mjs):
// one business date's Toast orders (/orders/v2/ordersBulk) -> one row per server, the figures
// behind Toast's own Employee productivity report (2026-11-17). Checked against that report for
// 2026-11-13 (guests, orders, net sales, per guest, average order, turn time, non-cash tip %,
// void count all matched to the cent / second, except one bar login's tip % off by 0.1 point).
//
// Definitions (Toast's own):
//  - orders: not deleted, not voided; attributed to order.server (orders with no server are skipped);
//  - netSales: sum of non-voided checks' `amount` (after discounts, before tax and tip); tax: their taxAmount;
//  - guests: order.numberOfGuests, an order over MAX_PLAUSIBLE_GUESTS_PER_ORDER counts 0 (data-entry error,
//    same rule as the covers sync);
//  - turn time: order opened -> paid (closed if there's no paid time), summed with a count so it can be
//    averaged across days; orders open over MAX_TURN_SECONDS are left out of it;
//  - nonCashTips: tipAmount on payments that aren't CASH and weren't voided; Toast's "non-cash tips %"
//    divides it by net sales + tax;
//  - voidCount: voided selections (items) on non-voided checks;
//  - one row per (server, isCounter): Chef's Counter orders are separate, see isChefsCounterOrder.
export const MAX_PLAUSIBLE_GUESTS_PER_ORDER = 50
// A tab left open overnight would swamp an average turn time, so an order open longer than this is left
// out of the turn-time figure only (everything else still counts). Toast's own report has no such cap.
export const MAX_TURN_SECONDS = 8 * 3600

// A Chef's Counter order: seated at a counter table (C<n>, via the table->area map) or carrying a Chef's
// Counter prix fixe selection (prepaid tickets and the bulk Stripe check can be rung with no table). Counter
// sales are kept in their own rows (isCounter): the prix fixe includes the gratuity (so tips look tiny) and one
// counter night would swamp a server's sales, so the report shows them apart from main-floor and bar service.
export function isChefsCounterOrder(order, areaByTableGuid) {
  if (order.table && areaByTableGuid && areaByTableGuid.get(order.table.guid) === 'chefs counter') return true
  return (order.checks ?? []).some(c => !c.voided && (c.selections ?? []).some(s => !s.voided && /chef.?s counter/i.test(s.displayName ?? '')))
}

// counterOf(order) -> true for a Chef's Counter order (default: none), see isChefsCounterOrder.
export function aggregateServerSales(orders, counterOf = (_order) => false) {
  const byServer = new Map()
  for (const o of orders) {
    if (o.deleted || o.voided) continue
    const guid = o.server?.guid
    if (!guid) continue
    const isCounter = counterOf(o) ? 1 : 0
    const key = `${guid}|${isCounter}`
    const r = byServer.get(key) ?? { employeeGuid: guid, isCounter, orders: 0, guests: 0, netSales: 0, tax: 0, nonCashTips: 0, voidCount: 0, turnSeconds: 0, turnOrders: 0 }
    r.orders += 1
    const guests = o.numberOfGuests ?? 0
    if (guests <= MAX_PLAUSIBLE_GUESTS_PER_ORDER) r.guests += guests
    const start = Date.parse(o.openedDate ?? '')
    const end = Date.parse(o.paidDate ?? o.closedDate ?? '')
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && (end - start) / 1000 <= MAX_TURN_SECONDS) {
      r.turnSeconds += (end - start) / 1000
      r.turnOrders += 1
    }
    for (const c of o.checks ?? []) {
      if (c.deleted || c.voided) continue
      r.netSales += c.amount ?? 0
      r.tax += c.taxAmount ?? 0
      for (const p of c.payments ?? []) {
        if (p.type === 'CASH' || p.paymentStatus === 'VOIDED' || p.voidInfo) continue
        r.nonCashTips += p.tipAmount ?? 0
      }
      for (const s of c.selections ?? []) if (s.voided) r.voidCount += 1
    }
    byServer.set(key, r)
  }
  return [...byServer.values()]
}
