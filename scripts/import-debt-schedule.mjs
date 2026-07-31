// One-time seed: imports the full per-loan amortization schedule (principal
// + interest split, including each loan's one-time catch-up interest
// payment) for Urban Hearth's 10 loans into loan_schedule, from the two
// source workbooks referenced in CLAUDE.md's Debt Service / Cash Flow tab
// section — neither is checked in, same posture as the real budget xlsx
// scripts/import-budget-xlsx.mjs reads from:
//
//   npm run db:import-debt-schedule -- \
//     /path/to/investor_loans_v6.xlsx \
//     /path/to/Eastern_Bank_Loan_Amortization_Reference.xlsx
//
// Deliberately does NOT use the source brief's own QBO account numbers as
// the join key (loan_key is a plain slug instead) — the brief cited the SBA
// loan's QBO account as 2740, but 2740 is actually the real investor Price
// loan's account (confirmed against this workbook's own "DR 2740 NP ..."
// QBO Entry Notes column), so that one field in the brief is wrong and the
// real SBA sub-account number isn't confirmed yet.
//
// Idempotent — deletes and re-inserts every row each run, since this is a
// full static schedule, not something incrementally appended to.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')

const investorPath = process.argv[2]
const sbaPath = process.argv[3]
if (!investorPath || !sbaPath) {
  console.error('Usage: npm run db:import-debt-schedule -- /path/to/investor_loans_v6.xlsx /path/to/Eastern_Bank_Loan_Amortization_Reference.xlsx')
  process.exit(1)
}
for (const p of [investorPath, sbaPath]) {
  if (!existsSync(p)) {
    console.error(`File not found: ${p}`)
    process.exit(1)
  }
}
if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
  process.exit(1)
}

function toIsoDate(value) {
  if (value instanceof Date) {
    // ExcelJS returns dates in UTC for date-formatted cells; use the UTC
    // components so e.g. Dec 20 2026 doesn't shift to Dec 19 in a
    // west-of-UTC local timezone.
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'string') {
    // MM/DD/YYYY, as used on the SBA "Payment Date" column
    const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  throw new Error(`Unrecognized date value: ${JSON.stringify(value)}`)
}

function cellNum(cell) {
  const v = cell?.value
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && 'result' in v) return v.result // formula cell
  return typeof v === 'number' ? v : null
}

const rows = [] // { loan_key, lender, payment_date, payment_type, interest, principal, total_payment }

// ---- Investor loans (7 original + Jones + Miller = 9 loans) --------------
const investorWb = new ExcelJS.Workbook()
await investorWb.xlsx.readFile(investorPath)

const summarySheet = investorWb.getWorksheet('Summary')
const acctToLender = new Map()
summarySheet.eachRow((row) => {
  const acct = row.getCell(1).value
  const lender = row.getCell(2).value
  if (typeof acct === 'string' && /^\d{4}$/.test(acct) && typeof lender === 'string') {
    acctToLender.set(acct, lender)
  }
})

const skipSheets = new Set(['Summary', 'Accrual Catch-Up'])
for (const ws of investorWb.worksheets) {
  if (skipSheets.has(ws.name)) continue
  const [acctNumber, ...nameParts] = ws.name.split(' ')
  const loanKey = nameParts.join(' ').toLowerCase()
  const lender = acctToLender.get(acctNumber) ?? ws.name

  // Find the header row ("Pmt #", "Date", ...) rather than assuming a fixed
  // row number — every loan sheet has a different-length ASSUMPTIONS block
  // above it.
  let headerRowNum = null
  ws.eachRow((row, rowNumber) => {
    if (headerRowNum === null && row.getCell(1).value === 'Pmt #') headerRowNum = rowNumber
  })
  if (headerRowNum === null) throw new Error(`No "Pmt #" header found in sheet ${ws.name}`)

  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const pmtNum = row.getCell(1).value
    if (pmtNum === null || pmtNum === undefined || pmtNum === '') break
    if (typeof pmtNum !== 'number' && pmtNum !== 'C/U') break // e.g. a trailing "TOTAL" row
    const paymentType = pmtNum === 'C/U' ? 'catch_up' : 'regular'
    const paymentDate = toIsoDate(row.getCell(2).value)
    const payment = cellNum(row.getCell(4))
    const principal = cellNum(row.getCell(5))
    const interest = cellNum(row.getCell(6))
    if (payment === null || principal === null || interest === null) {
      throw new Error(`Missing numeric data in ${ws.name} row ${r}`)
    }
    rows.push({ loan_key: loanKey, lender, payment_date: paymentDate, payment_type: paymentType, interest, principal, total_payment: payment })
  }
}

// ---- SBA loan (Eastern Bank) ----------------------------------------------
const sbaWb = new ExcelJS.Workbook()
await sbaWb.xlsx.readFile(sbaPath)
const sbaSheet = sbaWb.getWorksheet('Amortization Schedule')
const sbaHeader = sbaSheet.getRow(1).values
if (!Array.isArray(sbaHeader) || sbaHeader[1] !== 'Payment #') {
  throw new Error('Unexpected SBA sheet layout — header row 1 does not start with "Payment #"')
}
for (let r = 2; r <= sbaSheet.rowCount; r++) {
  const row = sbaSheet.getRow(r)
  const pmtNum = row.getCell(1).value
  if (pmtNum === null || pmtNum === undefined || pmtNum === '') break
  const paymentDate = toIsoDate(row.getCell(2).value)
  const interest = cellNum(row.getCell(3))
  const principal = cellNum(row.getCell(4))
  const payment = cellNum(row.getCell(5))
  if (interest === null || principal === null || payment === null) {
    throw new Error(`Missing numeric data in SBA sheet row ${r}`)
  }
  rows.push({ loan_key: 'sba', lender: 'SBA Loan – Eastern Bank', payment_date: paymentDate, payment_type: 'regular', interest, principal, total_payment: payment })
}

// ---- Write ------------------------------------------------------------
const db = new Database(dbPath)
const insert = db.prepare(`
  INSERT INTO loan_schedule (loan_key, lender, payment_date, payment_type, interest, principal, total_payment)
  VALUES (@loan_key, @lender, @payment_date, @payment_type, @interest, @principal, @total_payment)
`)
const run = db.transaction((allRows) => {
  db.prepare('DELETE FROM loan_schedule').run()
  for (const r of allRows) insert.run(r)
})
run(rows)

const loanKeys = new Set(rows.map(r => r.loan_key))
console.log(`Imported ${rows.length} loan_schedule rows across ${loanKeys.size} loans: ${[...loanKeys].sort().join(', ')}`)
