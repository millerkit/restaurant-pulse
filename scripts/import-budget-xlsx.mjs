// One-time seed: imports the real chart of accounts and a monthly budget
// from a QuickBooks Online "budget Excel" export (Guidelines + Consolidated
// sheets) into accounts/budget_targets, and writes a value-blanked copy of
// the same file to data/qbo-budget-template.xlsx for the export feature to
// edit in place later. Not part of the nightly sync — run by hand once:
//
//   npm run db:import-budget -- /path/to/Budget_FY26_P&L_1.xlsx
//
// Only Jan-Jul (whatever months the source file actually has budget
// numbers for) are imported as budget_targets. Any trailing months where
// every cell in the row is blank are left with no budget_targets row at
// all, rather than inserting zeros, so the projection feature has genuinely
// unplanned months to fill in.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')
const templatePath = join(rootDir, 'data', 'qbo-budget-template.xlsx')

const sourcePath = process.argv[2]
if (!sourcePath) {
  console.error('Usage: npm run db:import-budget -- /path/to/Budget_FYxx_P&L.xlsx')
  process.exit(1)
}
if (!existsSync(sourcePath)) {
  console.error(`File not found: ${sourcePath}`)
  process.exit(1)
}
if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
  process.exit(1)
}

// Top-level QBO report sections this template groups accounts under. Rows
// with these exact names (at indent depth 0) aren't accounts — they're
// section headers — and "Total ..." rows are QBO-computed subtotals, also
// not accounts. 'Expense' maps to a sentinel because it needs a further
// labor/opex split (see currentExpenseCategory below).
const SECTION_CATEGORY = {
  'Income': 'revenue',
  'Cost of Goods Sold': 'cogs',
  'Expense': 'expense',
  'Other Income': 'other',
  'Other Expense': 'other'
}

// First-pass judgment call, editable after import: which top-level opex
// subtrees are "fixed" (not controllable month to month, so not worth
// benchmarking) vs. "variable" (the actionable slice) — same convention
// already documented in schema.sql / CLAUDE.md.
const FIXED_OPEX_TOPLEVEL = new Set(['occupancy costs', 'insurance', 'interest & financing'])

// Within category='cogs', subcategory is Food vs. Beverage vs. Other
// (matching the schema.sql doc comment's own example) rather than the
// generic "parent account name" default used elsewhere — this is what
// lets the Budget tab track a Food COGS% and a Beverage COGS% separately,
// the same split MarginEdge's own budgeting uses. Matched by keyword
// rather than a hardcoded account list so it holds up against a
// differently-named chart of accounts later.
function cogsSubcategory(name) {
  const lower = name.toLowerCase()
  if (lower.includes('food')) return 'Food'
  if (['beer', 'liquor', 'wine', 'beverage', 'non-alcoholic'].some(kw => lower.includes(kw))) return 'Beverage'
  return 'Other'
}

const ACCOUNT_ROW_RE = /^(\d{3,6})\s+(.+)$/

function parseAccountCell(raw) {
  const indent = raw.length - raw.trimStart().length
  const depth = Math.round(indent / 3)
  const trimmed = raw.trim()
  const match = trimmed.match(ACCOUNT_ROW_RE)
  return {
    depth,
    accountNumber: match ? match[1] : null,
    name: match ? match[2] : trimmed
  }
}

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(sourcePath)
const ws = wb.getWorksheet('Consolidated')
if (!ws) {
  console.error('Expected a "Consolidated" sheet — is this a QBO budget export?')
  process.exit(1)
}

// Row 2 holds "Accounts", "Budget totals", then "Jan 2026" .. "Dec 2026".
const monthHeaders = []
for (let col = 3; col <= 14; col++) {
  const header = String(ws.getRow(2).getCell(col).value || '')
  const parsed = header.match(/^([A-Za-z]+)\s+(\d{4})$/)
  monthHeaders.push(parsed ? { month: new Date(`${parsed[1]} 1, 2000`).getMonth() + 1, year: Number(parsed[2]) } : null)
}
if (monthHeaders.some(h => !h)) {
  console.error(`Could not parse month headers from row 2: ${JSON.stringify(ws.getRow(2).values)}`)
  process.exit(1)
}

const accountsToInsert = [] // { accountNumber, name, category, subcategory, costBehavior, parentIndex, monthly }
const stack = [] // stack[depth] = index into accountsToInsert of the most recent row at that depth
let currentSection = null
let currentExpenseCategory = 'opex'
let currentOpexCostBehavior = 'variable'

const lastRow = ws.rowCount
for (let r = 3; r <= lastRow; r++) {
  const cellA = ws.getRow(r).getCell(1).value
  if (cellA === null || cellA === undefined || String(cellA).trim() === '') continue
  const raw = String(cellA)
  const { depth, accountNumber, name } = parseAccountCell(raw)

  if (depth === 0) {
    if (name.startsWith('Total ')) continue // computed subtotal, not an account
    if (name in SECTION_CATEGORY) {
      currentSection = SECTION_CATEGORY[name]
      continue
    }
    console.warn(`Skipping unrecognized top-level row ${r}: ${JSON.stringify(name)}`)
    continue
  }

  if (!currentSection) {
    console.warn(`Skipping row ${r} (${JSON.stringify(name)}) — no section header seen yet`)
    continue
  }

  if (depth === 1) {
    if (currentSection === 'expense') {
      currentExpenseCategory = name.toLowerCase() === 'labor' ? 'labor' : 'opex'
      currentOpexCostBehavior = 'variable'
    }
  }
  const category = currentSection === 'expense' ? currentExpenseCategory : currentSection
  if (category === 'opex' && depth === 1) {
    currentOpexCostBehavior = FIXED_OPEX_TOPLEVEL.has(name.toLowerCase()) ? 'fixed' : 'variable'
  }
  const costBehavior = category === 'opex' ? currentOpexCostBehavior : null

  const parentIndex = depth > 1 ? stack[depth - 1] : null
  const subcategory = category === 'cogs'
    ? cogsSubcategory(name)
    : (parentIndex !== null && parentIndex !== undefined ? accountsToInsert[parentIndex].name : null)

  const monthly = monthHeaders.map((h, i) => {
    const cell = ws.getRow(r).getCell(3 + i).value
    return { ...h, amount: typeof cell === 'number' ? cell : null }
  })
  // QBO exports this uniformly per row: either every month is a real number
  // (including legitimate $0 months) or every month is blank. Only import
  // the row's budget if it's actually been entered.
  const hasBudget = monthly.some(m => m.amount !== null)

  const index = accountsToInsert.length
  accountsToInsert.push({ accountNumber, name, category, subcategory, costBehavior, parentIndex, monthly: hasBudget ? monthly : null })
  stack[depth] = index
  stack.length = depth + 1
}

console.log(`Parsed ${accountsToInsert.length} accounts from ${sourcePath}`)

// A month is "unplanned" (not actually budgeted yet) if every account that
// has a budget at all shows exactly $0 for it — that's how QBO's export
// represents months nobody has entered numbers for, as opposed to a
// genuine $0 line item. Detected generically (not hardcoded to Jan-Jul) so
// this script works unmodified against a later export with more months
// filled in.
const budgetedAccounts = accountsToInsert.filter(acc => acc.monthly)
const monthIsUnplanned = monthHeaders.map((_, i) =>
  budgetedAccounts.length > 0 && budgetedAccounts.every(acc => acc.monthly[i].amount === 0)
)
monthHeaders.forEach((h, i) => {
  if (monthIsUnplanned[i]) console.log(`Treating ${h.year}-${String(h.month).padStart(2, '0')} as unplanned (every account is $0) — no budget_targets rows will be created for it`)
})

const db = new Database(dbPath)
const insertAccount = db.prepare(`
  INSERT INTO accounts (account_number, parent_account_id, name, category, subcategory, cost_behavior, is_active)
  VALUES (@accountNumber, @parentAccountId, @name, @category, @subcategory, @costBehavior, 1)
`)
const upsertBudget = db.prepare(`
  INSERT INTO budget_targets (year, month, account_id, amount)
  VALUES (@year, @month, @accountId, @amount)
  ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount
`)

const insertAll = db.transaction(() => {
  const dbIds = []
  for (const acc of accountsToInsert) {
    const parentAccountId = acc.parentIndex !== null && acc.parentIndex !== undefined ? dbIds[acc.parentIndex] : null
    const info = insertAccount.run({
      accountNumber: acc.accountNumber,
      parentAccountId,
      name: acc.name,
      category: acc.category,
      subcategory: acc.subcategory,
      costBehavior: acc.costBehavior
    })
    dbIds.push(info.lastInsertRowid)
  }
  let budgetRows = 0
  accountsToInsert.forEach((acc, i) => {
    if (!acc.monthly) return
    acc.monthly.forEach((m, monthIndex) => {
      if (m.amount === null || monthIsUnplanned[monthIndex]) return
      upsertBudget.run({ year: m.year, month: m.month, accountId: dbIds[i], amount: m.amount })
      budgetRows++
    })
  })
  return budgetRows
})

const budgetRowCount = insertAll()
db.close()
console.log(`Inserted ${accountsToInsert.length} accounts and ${budgetRowCount} budget_targets rows.`)

// Sanitized export template: same structure/formatting, every monthly
// value and the "Budget totals" column blanked, so the export feature can
// edit this in place rather than reconstructing QBO's formatting from
// scratch. Safe to commit — no real dollar figures.
for (let r = 3; r <= lastRow; r++) {
  const cellA = ws.getRow(r).getCell(1).value
  if (cellA === null || cellA === undefined || String(cellA).trim() === '') continue
  for (let col = 2; col <= 14; col++) {
    ws.getRow(r).getCell(col).value = null
  }
}
await wb.xlsx.writeFile(templatePath)
console.log(`Wrote sanitized export template to ${templatePath}`)
