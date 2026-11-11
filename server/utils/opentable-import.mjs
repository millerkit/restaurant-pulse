// OpenTable GuestCenter CSV importer (plain JS so it can be tested with `node`
// and shared with the upload route; same reason as qbo-pl-parse.mjs).
//
// Privacy: only the columns in COLUMN_MAP are read. Guest name, phone, email,
// notes, tags and the "Private Dining Title" (which is just "<first name>'s
// Event") are never copied anywhere.
//
// Handles both OpenTable formats seen so far: the emailed CSV ("2026-12-03" +
// "08:15 PM" in a separate Visit Time column) and the on-screen table style
// ("Jun 20, 2026 9:54 pm" in one cell). Header names are matched
// case-insensitively; unknown columns are ignored.

const COLUMN_MAP = {
  'visit date': 'visitDate',
  'visit time': 'visitTime',
  'created date': 'createdAt',
  'created time': 'createdTime',
  'canceled date': 'canceledAt',
  'cancelled date': 'canceledAt',
  'no-show date': 'noShowAt',
  'seated date': 'seatedAt',
  'size': 'size',
  'status': 'status',
  'table': 'tables',
  'dining area assigned': 'areaAssigned',
  'dining area booked': 'areaBooked',
  'source': 'source',
  'online waitlist': 'onlineWaitlist',
  'experience title': 'experienceTitle',
  'prepayment status': 'prepaymentStatus'
}
const REQUIRED = ['visitDate', 'size', 'status']
// Not required, but without these the booking curve can't be built. (No-show
// Date is deliberately not here: nothing reads it, and no-shows are ~0.3%.)
const IMPORTANT = ['createdAt', 'canceledAt']

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** RFC-4180-ish CSV parse (quotes, escaped quotes, embedded newlines). */
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(f => f !== '')) rows.push(row)
  return rows
}

const pad = n => String(n).padStart(2, '0')

/** "08:15 PM" / "9:54 pm" / "20:15" -> { h, m } or null. */
function parseClock(s) {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?/i.exec(s)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = m[3]?.toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return { h, m: min }
}

/** Any supported date string -> { date: 'YYYY-MM-DD', time: 'HH:MM' | null } or null. */
export function parseDateTime(raw) {
  const s = (raw ?? '').trim()
  if (!s) return null
  let y, mo, d
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3] }
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s))) {
    mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = +m[3]
  } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s))) {
    mo = +m[1]; d = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
  } else return null
  if (!mo || !d || mo > 12 || d > 31) return null
  const rest = s.slice(m[0].length)
  const clock = parseClock(rest)
  return { date: `${y}-${pad(mo)}-${pad(d)}`, time: clock ? `${pad(clock.h)}:${pad(clock.m)}` : null }
}

const stamp = (p) => (p ? `${p.date} ${p.time ?? '00:00'}` : null)
const clean = (s) => { const t = (s ?? '').trim(); return t === '' ? null : t }

/**
 * Parses CSV text into reservation records. Never throws on bad rows: they're
 * counted in `skipped` with a reason so the page can show what was dropped.
 */
export function parseReservations(text) {
  const table = parseCsv(text)
  if (!table.length) throw new Error('The file is empty.')
  // Some exports put a title line (e.g. "GuestCenter__...") above the header.
  let headerIdx = table.findIndex(r => r.some(h => h.trim().toLowerCase() === 'visit date'))
  if (headerIdx < 0) throw new Error('No "Visit Date" column found. Is this an OpenTable GuestCenter export?')
  const header = table[headerIdx].map(h => h.trim().toLowerCase())
  const idx = {}
  header.forEach((h, i) => { const key = COLUMN_MAP[h]; if (key && !(key in idx)) idx[key] = i })

  const missing = REQUIRED.filter(k => !(k in idx))
  if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')}.`)
  const missingImportant = IMPORTANT.filter(k => !(k in idx))

  const records = []
  const skipped = []
  for (let r = headerIdx + 1; r < table.length; r++) {
    const cells = table[r]
    const get = k => (k in idx ? cells[idx[k]] ?? '' : '')
    const visit = parseDateTime(get('visitDate'))
    const size = Number.parseInt(get('size'), 10)
    const status = clean(get('status'))
    if (!visit) { skipped.push({ line: r + 1, reason: 'unreadable Visit Date' }); continue }
    if (!Number.isFinite(size) || size < 0) { skipped.push({ line: r + 1, reason: 'unreadable Size' }); continue }
    if (!status) { skipped.push({ line: r + 1, reason: 'no Status' }); continue }

    // Created Date may be date-only with a separate Created Time column (seen 2026-11-04).
    const createdParsed = parseDateTime(get('createdAt'))
    if (createdParsed && !createdParsed.time && 'createdTime' in idx) {
      const c = parseClock(get('createdTime'))
      if (c) createdParsed.time = `${pad(c.h)}:${pad(c.m)}`
    }

    // Visit time: its own column if present, else the time inside Visit Date.
    const visitTimeCol = 'visitTime' in idx ? parseClock(get('visitTime')) : null
    const visitTime = visitTimeCol ? `${pad(visitTimeCol.h)}:${pad(visitTimeCol.m)}` : visit.time

    records.push({
      visitDate: visit.date,
      visitTime,
      createdAt: stamp(createdParsed),
      canceledAt: stamp(parseDateTime(get('canceledAt'))),
      noShowAt: stamp(parseDateTime(get('noShowAt'))),
      seatedAt: stamp(parseDateTime(get('seatedAt'))),
      size,
      status,
      tables: clean(get('tables')),
      areaAssigned: clean(get('areaAssigned')),
      areaBooked: clean(get('areaBooked')),
      source: clean(get('source')),
      onlineWaitlist: /^(true|yes|1)$/i.test(get('onlineWaitlist').trim()) ? 1 : 0,
      experienceTitle: clean(get('experienceTitle')),
      prepaymentStatus: clean(get('prepaymentStatus'))
    })
  }
  return { records, skipped, missingImportant }
}

/**
 * Replaces every stored reservation inside the file's visit-date range with the
 * file's rows (one transaction). Replace-by-range, not upsert: the export has no
 * reservation id to match on, and a newer export is the better truth for those
 * dates (cancellations, seated status, size edits).
 */
export function importReservations(db, text, now = new Date().toISOString()) {
  const { records, skipped, missingImportant } = parseReservations(text)
  if (!records.length) throw new Error('No reservation rows could be read from the file.')

  const dates = records.map(r => r.visitDate).sort()
  const dateFrom = dates[0]
  const dateTo = dates[dates.length - 1]

  const del = db.prepare('DELETE FROM reservations WHERE visit_date >= ? AND visit_date <= ?')
  const ins = db.prepare(`
    INSERT INTO reservations (visit_date, visit_time, created_at, canceled_at, no_show_at, seated_at, size, status,
      tables, area_assigned, area_booked, source, online_waitlist, experience_title, prepayment_status, imported_at)
    VALUES (@visitDate, @visitTime, @createdAt, @canceledAt, @noShowAt, @seatedAt, @size, @status,
      @tables, @areaAssigned, @areaBooked, @source, @onlineWaitlist, @experienceTitle, @prepaymentStatus, @importedAt)
  `)
  const log = db.prepare('INSERT INTO reservation_imports (imported_at, rows, date_from, date_to, replaced_rows) VALUES (?, ?, ?, ?, ?)')

  const replaced = db.transaction(() => {
    const replacedRows = del.run(dateFrom, dateTo).changes
    for (const rec of records) ins.run({ ...rec, importedAt: now })
    log.run(now, records.length, dateFrom, dateTo, replacedRows)
    return replacedRows
  })()

  const byStatus = {}
  for (const r of records) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  return {
    rows: records.length,
    dateFrom,
    dateTo,
    replacedRows: replaced,
    byStatus,
    skipped: skipped.length,
    skippedExamples: skipped.slice(0, 5),
    missingColumns: missingImportant
  }
}
