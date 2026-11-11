// Imports the QuickBooks bank register for the 1002 Loan Reserve account (an .xls/.xlsx export)
// into reserve_transfers, making the bank the source of truth for the reserve balance.
//
// Flow (see CLAUDE.md "Bank register import"): parseRegister() reads the file, planImport()
// compares it with what's recorded (no writes), applyImport() replaces it. Plain .mjs with no
// Nitro imports so scripts and tests can use it directly.
import * as XLSX from 'xlsx'

// Rows before this date are folded into one opening-balance row; the app's reserve history
// starts with the first real transfer (2026-07-13).
export const BANK_IMPORT_START = '2026-07-13'

const MATCH_WINDOW_DAYS = 7
const MATCH_AMOUNT_TOLERANCE = 1.0 // hand-entered amounts are rounded to whole dollars
const cents = n => Math.round(n * 100) / 100

function toIso(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // SheetJS date cells are UTC-midnight-ish; use local parts of the UTC date to avoid a day shift.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v)
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function toNumber(v) {
  if (v === '' || v == null) return 0
  if (typeof v === 'number') return v
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

function cleanAccount(a) {
  return String(a ?? '').replace(/^\d+\s+Bank & Physical Cash:/, '').replace(/^\d+\s+/, '').trim()
}

export function parseRegister(buffer) {
  let wb
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch {
    throw new Error('Could not read that file. Upload the register exported from QuickBooks (.xls or .xlsx).')
  }
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('The file has no worksheet.')
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })

  const title = String(grid[0]?.[0] ?? '')
  if (!/loan reserve/i.test(title)) {
    throw new Error(`This doesn't look like the Loan Reserve register (the file's account is "${title || 'unknown'}").`)
  }
  let endingBalance = null
  for (const cell of grid[0] ?? []) {
    const m = String(cell).match(/Ending Balance:\s*\$?\s*(-?[\d,]+(?:\.\d+)?)/i)
    if (m) endingBalance = cents(Number(m[1].replace(/,/g, '')))
  }

  const headerIdx = grid.findIndex(r => r.some(c => String(c).trim() === 'Payment') && r.some(c => String(c).trim() === 'Deposit'))
  if (headerIdx < 0) throw new Error('Could not find the Date / Payment / Deposit columns.')
  const col = {}
  grid[headerIdx].forEach((c, i) => { col[String(c).trim()] = i })
  for (const need of ['Date', 'Payment', 'Deposit']) {
    if (col[need] === undefined) throw new Error(`The file has no "${need}" column.`)
  }

  const rows = []
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const g = grid[r]
    const date = toIso(g[col.Date])
    if (!date) continue // blank or footer row
    const payment = toNumber(g[col.Payment])
    const deposit = toNumber(g[col.Deposit])
    if (Number.isNaN(payment) || Number.isNaN(deposit)) throw new Error(`Row ${r + 1}: could not read the amount.`)
    const amount = cents(deposit - payment)
    if (amount === 0) continue
    const get = k => (col[k] === undefined ? '' : String(g[col[k]] ?? '').trim())
    const payee = get('Payee')
    const memo = get('Memo')
    const account = cleanAccount(get('Account'))
    const type = get('Type')
    const described = [payee, memo].filter(Boolean).join(' — ')
    const note = described || (type === 'Transfer' && account ? `Transfer ${amount > 0 ? 'from' : 'to'} ${account}` : (account || type || null))
    rows.push({ date, amount, note, text: `${payee} ${memo} ${account}`.toLowerCase() })
  }
  if (!rows.length) throw new Error('The register has no transactions.')
  rows.sort((a, b) => a.date.localeCompare(b.date))
  return { title, endingBalance, rows, throughDate: rows[rows.length - 1].date }
}

const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000)
const words = s => new Set(String(s ?? '').toLowerCase().match(/[a-z]{5,}/g) ?? [])

export function planImport(db, parsed) {
  const { rows, throughDate, endingBalance } = parsed
  const opening = cents(rows.filter(r => r.date < BANK_IMPORT_START).reduce((s, r) => s + r.amount, 0))
  const incoming = rows.filter(r => r.date >= BANK_IMPORT_START)
  if (opening !== 0) {
    const d = new Date(Date.parse(BANK_IMPORT_START) - 86400000).toISOString().slice(0, 10)
    incoming.unshift({ date: d, amount: opening, note: 'Opening balance (from bank register)', text: '', opening: true })
  }
  const importedTotal = cents(incoming.reduce((s, r) => s + r.amount, 0))

  const all = db.prepare('SELECT id, transfer_date AS date, amount, note, source FROM reserve_transfers ORDER BY transfer_date, id').all()
  const pool = all.filter(t => t.source === 'bank' || (t.date >= BANK_IMPORT_START && t.date <= throughDate))
  const kept = all.filter(t => !pool.includes(t))

  // Pair each incoming bank row with at most one existing row: same-ish amount (the sign may be
  // flipped, which is the error this exists to catch), nearby date, best text/date fit first.
  const pairs = []
  incoming.forEach((row, i) => {
    if (row.opening) return
    pool.forEach((t, j) => {
      if (dayDiff(row.date, t.date) > MATCH_WINDOW_DAYS) return
      const absGap = Math.abs(Math.abs(row.amount) - Math.abs(t.amount))
      if (absGap > MATCH_AMOUNT_TOLERANCE) return
      const bankWords = words(row.text + ' ' + row.note)
      const shared = [...words(t.note)].some(w => bankWords.has(w)) ? 1 : 0
      const exactSign = Math.sign(row.amount) === Math.sign(t.amount) ? 1 : 0
      pairs.push({ i, j, shared, exactSign, absGap, dist: dayDiff(row.date, t.date) })
    })
  })
  pairs.sort((a, b) => b.exactSign - a.exactSign || b.shared - a.shared || a.dist - b.dist || a.absGap - b.absGap)
  const usedI = new Set(); const usedJ = new Set(); const matchOf = new Map()
  for (const p of pairs) {
    if (usedI.has(p.i) || usedJ.has(p.j)) continue
    usedI.add(p.i); usedJ.add(p.j); matchOf.set(p.i, p.j)
  }

  const changes = incoming.map((row, i) => {
    const t = matchOf.has(i) ? pool[matchOf.get(i)] : null
    const genericNote = t && t.source === 'manual' && t.note ? t.note : null
    const note = genericNote ?? (t?.source === 'bank' ? t.note : null) ?? row.note
    const out = { date: row.date, amount: row.amount, note, bankNote: row.note, kind: 'new' }
    if (t) {
      const why = []
      if (Math.sign(t.amount) !== Math.sign(row.amount)) why.push(`sign was wrong (recorded ${t.amount})`)
      else if (cents(t.amount) !== row.amount) why.push(`amount ${t.amount} → ${row.amount}`)
      if (t.date !== row.date) why.push(`date ${t.date} → ${row.date}`)
      out.kind = why.length ? 'changed' : 'same'
      out.why = why
    }
    if (row.opening) out.kind = 'opening'
    return out
  })
  const removed = pool.filter((t, j) => !usedJ.has(j) && t.source !== 'bank')
  const bankReplaced = pool.filter((t, j) => !usedJ.has(j) && t.source === 'bank').length

  const savedBefore = cents(all.reduce((s, t) => s + t.amount, 0))
  const savedAfter = cents(importedTotal + kept.reduce((s, t) => s + t.amount, 0))
  return {
    endingBalance,
    throughDate,
    importedTotal,
    tie: endingBalance == null ? null : { ok: Math.abs(importedTotal - endingBalance) < 0.005, diff: cents(importedTotal - endingBalance) },
    savedBefore,
    savedAfter,
    changes,
    removed: removed.map(t => ({ id: t.id, date: t.date, amount: t.amount, note: t.note })),
    replaceIds: pool.map(t => t.id), // every existing row the incoming register supersedes (matched or not)
    bankReplaced,
    kept: kept.filter(t => t.date > throughDate).map(t => ({ id: t.id, date: t.date, amount: t.amount, note: t.note })),
    counts: {
      same: changes.filter(c => c.kind === 'same').length,
      changed: changes.filter(c => c.kind === 'changed').length,
      new: changes.filter(c => c.kind === 'new').length,
      removed: removed.length
    }
  }
}

export function applyImport(db, plan) {
  if (plan.tie && !plan.tie.ok) {
    throw new Error(`The imported rows total ${plan.importedTotal.toFixed(2)} but the register's ending balance is ${plan.endingBalance.toFixed(2)}. Nothing was imported.`)
  }
  const tx = db.transaction(() => {
    const del = db.prepare('DELETE FROM reserve_transfers WHERE id = ?')
    for (const id of plan.replaceIds) del.run(id)
    const ins = db.prepare("INSERT INTO reserve_transfers (transfer_date, amount, note, source) VALUES (?, ?, ?, 'bank')")
    for (const c of plan.changes) ins.run(c.date, c.amount, c.note)
    db.prepare(`
      INSERT INTO reserve_bank_sync (id, through_date, ending_balance, row_count, imported_at) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET through_date = excluded.through_date, ending_balance = excluded.ending_balance,
        row_count = excluded.row_count, imported_at = excluded.imported_at
    `).run(plan.throughDate, plan.endingBalance ?? plan.importedTotal, plan.changes.length, new Date().toISOString())
  })
  tx()
}
