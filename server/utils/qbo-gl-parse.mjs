// Pure QBO GeneralLedger-report-JSON transform (no imports, plain JS, same
// reasoning as qbo-pl-parse.mjs). Used for the gift card liability account
// (2440): every posting line to the account is one Data row; columns are
// found by their MetaData ColKey, never by position, because QBO orders
// them by the `columns` request param and may add or drop some.
//
// Returns per-date totals: credits (cards sold, the liability goes up) and
// debits (cards redeemed, it goes down). Rows without a real yyyy-mm-dd
// tx_date ("Beginning Balance", totals) are skipped. If a report comes back
// without debit/credit columns, falls back to the signed amount column
// (positive = credit for a liability account).

function colKeys(report) {
  const cols = report?.Columns?.Column ?? []
  return cols.map(c => (c.MetaData ?? []).find(m => m.Name === 'ColKey')?.Value ?? null)
}

function collectDataRows(rows, out) {
  for (const row of rows ?? []) {
    if (row.type === 'Section' || row.Rows) collectDataRows(row.Rows?.Row, out)
    if (row.ColData && row.type !== 'Section') out.push(row.ColData)
  }
  return out
}

const num = (v) => {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function generalLedgerToDailyActivity(report) {
  const keys = colKeys(report)
  const idx = (k) => keys.indexOf(k)
  const dateIdx = idx('tx_date')
  const debitIdx = idx('debt_amt')
  const creditIdx = idx('credt_amt')
  const amountIdx = ['subt_nat_amount', 'nat_amount', 'amount'].map(idx).find(i => i >= 0) ?? -1
  if (dateIdx < 0) throw new Error(`GeneralLedger report has no tx_date column (columns: ${keys.join(', ')})`)
  if ((debitIdx < 0 || creditIdx < 0) && amountIdx < 0) {
    throw new Error(`GeneralLedger report has neither debit/credit nor amount columns (columns: ${keys.join(', ')})`)
  }

  const byDate = new Map()
  for (const cols of collectDataRows(report?.Rows?.Row, [])) {
    const date = cols[dateIdx]?.value
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) continue
    let credit, debit
    if (debitIdx >= 0 && creditIdx >= 0) {
      credit = num(cols[creditIdx]?.value)
      debit = num(cols[debitIdx]?.value)
    } else {
      const a = num(cols[amountIdx]?.value)
      credit = a > 0 ? a : 0
      debit = a < 0 ? -a : 0
    }
    if (credit === 0 && debit === 0) continue
    const d = byDate.get(date) ?? { date, credits: 0, debits: 0, lines: 0 }
    d.credits += credit
    d.debits += debit
    d.lines++
    byDate.set(date, d)
  }
  return [...byDate.values()]
    .map(d => ({ ...d, credits: Math.round(d.credits * 100) / 100, debits: Math.round(d.debits * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
