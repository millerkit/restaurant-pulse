// Generates an .xlsx shaped exactly like QuickBooks's own budget export
// template, for manual re-import into QBO (QBO's Budget API is believed to
// be query-only — no write endpoint — which is presumably why this Excel
// round trip exists as a separate product feature in the first place).
// Edits data/qbo-budget-template.xlsx (a sanitized copy of the real file
// the user exported from QBO, created by scripts/import-budget-xlsx.mjs)
// in place rather than rebuilding a workbook from scratch, to preserve the
// Guidelines sheet and every bit of QBO-specific formatting untouched.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'

const ACCOUNT_ROW_RE = /^(\d{3,6})\s+(.+)$/
const SECTION_NAMES = new Set(['Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense'])

function parseAccountCell(raw: string) {
  const indent = raw.length - raw.trimStart().length
  const depth = Math.round(indent / 3)
  const trimmed = raw.trim()
  const match = trimmed.match(ACCOUNT_ROW_RE)
  return { depth, accountNumber: match ? match[1] : null, name: match ? match[2] : trimmed }
}

export default defineEventHandler(async (event) => {
  const year = Number(getQuery(event).year)
  if (!Number.isInteger(year)) {
    throw createError({ statusCode: 400, statusMessage: 'year query param is required' })
  }

  const templatePath = join(process.cwd(), 'data', 'qbo-budget-template.xlsx')
  if (!existsSync(templatePath)) {
    throw createError({ statusCode: 500, statusMessage: `${templatePath} not found — run "npm run db:import-budget" first to create it.` })
  }

  const db = useDb()
  const accounts = db.prepare(`
    SELECT id, account_number AS accountNumber, parent_account_id AS parentAccountId, name
    FROM accounts WHERE is_active = 1
  `).all() as { id: number, accountNumber: string | null, parentAccountId: number | null, name: string }[]
  const accountsById = new Map(accounts.map(a => [a.id, a]))
  const accountsByNumber = new Map(accounts.filter(a => a.accountNumber).map(a => [a.accountNumber as string, a]))
  // A handful of built-in QBO fallback accounts (Uncategorized Income,
  // Purchases, etc.) have no account number — match those by name instead.
  const accountsByName = new Map(accounts.filter(a => !a.accountNumber).map(a => [a.name, a]))

  const budgetRows = db.prepare('SELECT account_id AS accountId, month, amount FROM budget_targets WHERE year = ?').all(year) as
    { accountId: number, month: number, amount: number }[]
  const amountByAccountMonth = new Map<string, number>()
  for (const row of budgetRows) amountByAccountMonth.set(`${row.accountId}-${row.month}`, row.amount)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(templatePath)
  const ws = wb.getWorksheet('Consolidated')
  if (!ws) {
    throw createError({ statusCode: 500, statusMessage: `${templatePath} has no "Consolidated" sheet — regenerate it with npm run db:import-budget.` })
  }

  const matchedAccountIds = new Set<number>()
  let lastDataRow = 2

  for (let r = 3; r <= ws.rowCount; r++) {
    const cellA = ws.getRow(r).getCell(1).value
    if (cellA === null || cellA === undefined || String(cellA).trim() === '') continue
    lastDataRow = r
    const { depth, accountNumber, name } = parseAccountCell(String(cellA))
    if (depth === 0) continue // section header or "Total ..." row — leave untouched

    const account = accountNumber ? accountsByNumber.get(accountNumber) : accountsByName.get(name)
    if (!account) continue // row in the template with no matching active account — leave blank, unchanged
    matchedAccountIds.add(account.id)

    let total: number | null = null
    for (let month = 1; month <= 12; month++) {
      const amount = amountByAccountMonth.get(`${account.id}-${month}`)
      if (amount === undefined) continue
      ws.getRow(r).getCell(2 + month).value = amount
      total = (total ?? 0) + amount
    }
    if (total !== null) ws.getRow(r).getCell(2).value = total
  }

  // Accounts added since the template was captured (new QBO accounts from a
  // later sync, or edits made only in this app). QBO's own Guidelines sheet
  // explicitly permits adding rows, so append them — at the very end of the
  // sheet rather than trying to re-derive which of "Other Income" vs. "Other
  // Expense" a category='other' account belongs to (that distinction isn't
  // preserved once collapsed into one category — see CLAUDE.md). Good enough
  // to get the numbers into QBO; the user can reposition the row in Excel if
  // the section placement matters to them.
  function depthOf(accountId: number): number {
    let depth = 0
    let current = accountsById.get(accountId)
    while (current?.parentAccountId) {
      depth++
      current = accountsById.get(current.parentAccountId)
    }
    return depth + 1
  }

  let nextRow = lastDataRow + 1
  for (const account of accounts) {
    if (matchedAccountIds.has(account.id)) continue
    const indent = '   '.repeat(depthOf(account.id))
    const label = account.accountNumber ? `${account.accountNumber} ${account.name}` : account.name
    const row = ws.getRow(nextRow)
    row.getCell(1).value = `${indent}${label}`
    let total: number | null = null
    for (let month = 1; month <= 12; month++) {
      const amount = amountByAccountMonth.get(`${account.id}-${month}`)
      if (amount === undefined) continue
      row.getCell(2 + month).value = amount
      total = (total ?? 0) + amount
    }
    if (total !== null) row.getCell(2).value = total
    nextRow++
  }

  const buffer = await wb.xlsx.writeBuffer()
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', `attachment; filename="Budget_${year}_export.xlsx"`)
  return buffer
})
