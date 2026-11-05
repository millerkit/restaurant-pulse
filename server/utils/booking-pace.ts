// "Next 7 nights" booking pace (added 2026-11-05), used by the Dashboard panel
// (server/api/booking-pace.get.ts) and the Revenue tab's night-by-night projection
// (server/api/revenue-projection.get.ts). See
// CLAUDE.md's "Booking pace: next 7 nights" section for the backtest behind
// these choices.
//
// For each upcoming operating night: OpenTable covers on the book (walk-ins
// excluded) as of the latest upload, vs. what was typically on the book at the
// same distance out for that weekday (reconstructed from created/canceled
// timestamps of the last few same-weekday nights). Within ESTIMATE_MAX_DAYS_OUT
// it also gives a covers estimate: the weekday's Toast average, nudged by how
// far ahead/behind the book is, with the nudge size fitted on recent nights.
// Further out the book barely predicts covers (backtest 2026-11-05), so only
// the weekday average is shown there.
//
// "Now" is the latest upload's time, not the wall clock: the book is only as
// fresh as the last export.
import type Database from 'better-sqlite3'
import { MIN_COVERS_FOR_OPEN_DAY } from './core-revenue'

const RESTAURANT_TIME_ZONE = 'America/New_York'
const NIGHTS_SHOWN = 7
const ESTIMATE_MAX_DAYS_OUT = 3
const SAME_WEEKDAY_HISTORY = 6
const FIT_NIGHTS = 60
const STALE_AFTER_DAYS = 2

type Res = { visitDate: string, size: number, createdAt: string | null, canceledAt: string | null, status: string }

function localParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: RESTAURANT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

export function computeBookingPace(db: Database.Database) {
  let latest: { importedAt: string, dateFrom: string, dateTo: string } | undefined
  let rows: Res[]
  try {
    latest = db.prepare('SELECT imported_at AS importedAt, date_from AS dateFrom, date_to AS dateTo FROM reservation_imports ORDER BY id DESC LIMIT 1').get() as typeof latest
    rows = db.prepare(`
      SELECT visit_date AS visitDate, size, created_at AS createdAt, canceled_at AS canceledAt, status
      FROM reservations WHERE COALESCE(source, '') <> 'Walk-in'
    `).all() as Res[]
  } catch {
    return { available: false as const, reason: 'Reservation tables are missing on this database.' }
  }
  if (!latest || !rows.length) return { available: false as const, reason: 'No OpenTable export has been uploaded yet.' }

  const snap = localParts(new Date(latest.importedAt))
  const today = localParts(new Date()).date
  const byNight = new Map<string, Res[]>()
  for (const r of rows) {
    const list = byNight.get(r.visitDate)
    if (list) list.push(r)
    else byNight.set(r.visitDate, [r])
  }

  // Covers on the book for `night` as of `daysOut` days before it, at the
  // snapshot's time of day. A row marked Cancelled with no cancel time is
  // treated as never on the book (can't place the cancellation in time).
  function bookedAt(night: string, daysOut: number) {
    const cutoff = `${addDays(night, -daysOut)} ${snap.time}`
    let total = 0
    for (const r of byNight.get(night) ?? []) {
      if (!r.createdAt || r.createdAt > cutoff) continue
      if (r.canceledAt ? r.canceledAt <= cutoff : r.status === 'Cancelled') continue
      total += r.size
    }
    return total
  }

  // Past open nights with real Toast covers, at least a full day before the snapshot.
  const toastRows = db.prepare('SELECT date, covers FROM daily_toast_metrics WHERE date >= ? AND date < ? AND covers >= ? ORDER BY date')
    .all(latest.dateFrom, snap.date, MIN_COVERS_FOR_OPEN_DAY) as { date: string, covers: number }[]
  const covers = new Map(toastRows.map(r => [r.date, r.covers]))
  const pastNights = toastRows.map(r => r.date).filter(d => byNight.has(d))

  function sameWeekdayBefore(night: string, before: string) {
    return pastNights.filter(h => h < before && dow(h) === dow(night)).slice(-SAME_WEEKDAY_HISTORY)
  }
  function typicalFor(night: string, daysOut: number, before: string) {
    const hist = sameWeekdayBefore(night, before)
    if (hist.length < 3) return null
    return {
      booked: mean(hist.map(h => bookedAt(h, daysOut))),
      covers: mean(hist.map(h => covers.get(h)!)),
      nights: hist.length
    }
  }

  // Nudge size per days-out: least squares through the origin of
  // (covers − weekday avg) on (booked − typical booked), over recent nights,
  // each judged only against nights before it. Clamped so a thin sample can't
  // produce a wild multiplier.
  const slope = new Map<number, { k: number, n: number }>()
  for (let L = 0; L <= ESTIMATE_MAX_DAYS_OUT; L++) {
    let sxy = 0, sxx = 0, n = 0
    for (const h of pastNights.slice(-FIT_NIGHTS)) {
      const t = typicalFor(h, L, h)
      if (!t) continue
      const x = bookedAt(h, L) - t.booked
      sxy += x * (covers.get(h)! - t.covers)
      sxx += x * x
      n++
    }
    slope.set(L, { k: sxx > 0 ? Math.min(3, Math.max(0, sxy / sxx)) : 0, n })
  }

  const nights: string[] = []
  for (let d = today; nights.length < NIGHTS_SHOWN; d = addDays(d, 1)) {
    if (dow(d) !== 1) nights.push(d) // closed Mondays
  }

  const out = nights.map((night) => {
    const daysOut = daysBetween(snap.date, night)
    const inUpload = night <= latest!.dateTo && night >= latest!.dateFrom
    const booked = inUpload ? bookedAt(night, daysOut) : null
    const typical = daysOut >= 0 ? typicalFor(night, daysOut, snap.date) : null
    const pace = booked != null && typical && typical.booked > 0 ? booked / typical.booked : null
    let estimate: number | null = null
    if (booked != null && typical && daysOut >= 0 && daysOut <= ESTIMATE_MAX_DAYS_OUT) {
      const k = slope.get(daysOut)!.k
      estimate = Math.max(0, Math.round(typical.covers + k * (booked - typical.booked)))
    }
    return {
      date: night,
      daysOut,
      inUpload,
      booked,
      typicalBooked: typical ? Math.round(typical.booked) : null,
      weekdayAvgCovers: typical ? Math.round(typical.covers) : null,
      historyNights: typical?.nights ?? 0,
      pace,
      estimate
    }
  })

  return {
    available: true as const,
    snapshotDate: snap.date,
    snapshotTime: snap.time,
    uploadedThrough: latest.dateTo,
    staleDays: Math.max(0, daysBetween(snap.date, today)),
    staleAfterDays: STALE_AFTER_DAYS,
    estimateMaxDaysOut: ESTIMATE_MAX_DAYS_OUT,
    nights: out
  }
}
