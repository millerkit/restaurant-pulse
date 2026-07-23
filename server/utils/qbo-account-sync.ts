// Populates accounts.qbo_account_id (NULL on every xlsx-seeded row until
// this runs) by fetching QBO's real chart of accounts and matching it
// against our accounts table. See CLAUDE.md's Budget tab section for why
// this is a prerequisite for the P&L sync: report rows are matched to
// local accounts by qbo_account_id, not by fragile name text.
//
// AccountType string values below (e.g. "Cost of Goods Sold", with a
// space) were confirmed against a live sandbox Account query before being
// hardcoded — QBO's enum is not the camelCase-no-space form ("Income"/
// "Expense" happen to look the same either way, but "Cost of Goods Sold",
// "Other Income", and "Other Expense" do not). These five strings are
// exactly import-budget-xlsx.mjs's SECTION_CATEGORY keys, which makes
// sense: that script's xlsx section headers come from QBO itself.
const PL_ACCOUNT_TYPES = new Set(['Income', 'Cost of Goods Sold', 'Expense', 'Other Income', 'Other Expense'])

// Same first-pass judgment call as import-budget-xlsx.mjs's
// FIXED_OPEX_TOPLEVEL — duplicated here (not imported) since that script
// is a one-off, not a shared module. Keep these in sync by hand if the
// convention ever changes.
const FIXED_OPEX_TOPLEVEL = new Set(['occupancy costs', 'insurance', 'interest & financing'])

// Identical keyword logic to import-budget-xlsx.mjs's cogsSubcategory.
function cogsSubcategory(name: string): 'Food' | 'Beverage' | 'Other' {
  const lower = name.toLowerCase()
  if (lower.includes('food')) return 'Food'
  if (['beer', 'liquor', 'wine', 'beverage', 'non-alcoholic'].some(kw => lower.includes(kw))) return 'Beverage'
  return 'Other'
}

interface QboAccount {
  Id: string
  Name: string
  AccountType: string
  AcctNum?: string
  Active: boolean
  ParentRef?: { value: string }
  SubAccount?: boolean
}

// Walks ParentRef up to the account with no parent (or whose parent isn't
// in this response), matching import-budget-xlsx.mjs's stateful "which
// depth-1 ancestor am I under" tracking — but driven by ParentRef instead
// of xlsx indentation. Self-inclusive: a true top-level account (no
// ParentRef) returns itself, exactly like the importer classifies the
// depth-1 row itself using its own name.
function walkToTopLevelAncestor(account: QboAccount, byQboId: Map<string, QboAccount>): QboAccount {
  let current = account
  const seen = new Set<string>()
  while (current.ParentRef?.value && byQboId.has(current.ParentRef.value) && !seen.has(current.Id)) {
    seen.add(current.Id)
    current = byQboId.get(current.ParentRef.value)!
  }
  return current
}

interface Categorization {
  category: 'revenue' | 'cogs' | 'labor' | 'opex' | 'other'
  subcategory: string | null
  costBehavior: 'fixed' | 'variable' | null
}

// Only runs for brand-new inserts — an already-matched account's
// classification is never recomputed here (CLAUDE.md: "editable
// afterward, not a definitive classification").
function categorizeNewAccount(qboAccount: QboAccount, byQboId: Map<string, QboAccount>): Categorization | null {
  switch (qboAccount.AccountType) {
    case 'Income':
      return { category: 'revenue', subcategory: null, costBehavior: null }
    case 'Cost of Goods Sold':
      return { category: 'cogs', subcategory: cogsSubcategory(qboAccount.Name), costBehavior: null }
    case 'Other Income':
    case 'Other Expense':
      return { category: 'other', subcategory: null, costBehavior: null }
    case 'Expense': {
      const top = walkToTopLevelAncestor(qboAccount, byQboId)
      const parent = qboAccount.ParentRef ? byQboId.get(qboAccount.ParentRef.value) ?? null : null
      const subcategory = parent?.Name ?? null
      if (top.Name.trim().toLowerCase() === 'labor') {
        return { category: 'labor', subcategory, costBehavior: null }
      }
      const costBehavior = FIXED_OPEX_TOPLEVEL.has(top.Name.trim().toLowerCase()) ? 'fixed' : 'variable'
      return { category: 'opex', subcategory, costBehavior }
    }
    default:
      return null // not a P&L account type
  }
}

interface LocalAccountRow {
  id: number
  qbo_account_id: string | null
  account_number: string | null
  name: string
  is_active: number
}

export async function syncQboAccounts(): Promise<{ inserted: number, updated: number, deactivated: number, reactivated: number }> {
  const { qbo } = useRuntimeConfig()
  const db = useDb()

  const query = 'SELECT * FROM Account MAXRESULTS 1000'
  const { res, intuitTid } = await qboFetch(qbo.environment, qbo.clientId, qbo.clientSecret, (realmId) => `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || qboFaultType(body)) {
    throw logAndWrapQboError('QBO Account query', res, body, intuitTid)
  }

  const qboAccounts = (body.QueryResponse?.Account ?? []) as QboAccount[]
  const byQboId = new Map(qboAccounts.map(a => [a.Id, a]))

  const localRows = db.prepare('SELECT id, qbo_account_id, account_number, name, is_active FROM accounts').all() as LocalAccountRow[]
  const localByQboId = new Map(localRows.filter(r => r.qbo_account_id !== null).map(r => [r.qbo_account_id as string, r]))
  const localByNumber = new Map(
    localRows
      .filter(r => r.qbo_account_id === null && r.account_number !== null && r.account_number.trim() !== '')
      .map(r => [r.account_number!.trim(), r])
  )

  // is_active is deliberately NOT written here — that's the dedicated
  // deactivation/reactivation pass below, which compares against current
  // state and only writes on an actual transition. Keeping it out of this
  // pass avoids two passes racing to decide the same column.
  const updateMatched = db.prepare('UPDATE accounts SET account_number = ?, name = ? WHERE id = ?')
  const attachQboId = db.prepare('UPDATE accounts SET qbo_account_id = ?, account_number = ?, name = ? WHERE id = ?')
  const insertNew = db.prepare(`
    INSERT INTO accounts (qbo_account_id, account_number, parent_account_id, name, category, subcategory, cost_behavior, is_owner_compensation, is_active)
    VALUES (@qboAccountId, @accountNumber, NULL, @name, @category, @subcategory, @costBehavior, 0, @isActive)
  `)
  const setParent = db.prepare('UPDATE accounts SET parent_account_id = ? WHERE qbo_account_id = ?')
  const deactivate = db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?')
  const reactivate = db.prepare('UPDATE accounts SET is_active = 1 WHERE id = ?')

  let inserted = 0
  let updated = 0

  const touchedQboIds: string[] = []

  // Only a name/account_number change is written/counted here — otherwise
  // every already-matched account would get touched (and counted as
  // "updated") on every single run, inflating rows_synced meaninglessly
  // even when QBO returned exactly the same chart of accounts.
  const runPass1 = db.transaction(() => {
    for (const qboAccount of qboAccounts) {
      if (!PL_ACCOUNT_TYPES.has(qboAccount.AccountType)) continue
      const acctNum = qboAccount.AcctNum?.trim() || null
      const isActive = qboAccount.Active ? 1 : 0

      const existingByQboId = localByQboId.get(qboAccount.Id)
      if (existingByQboId) {
        touchedQboIds.push(qboAccount.Id)
        if (existingByQboId.account_number !== acctNum || existingByQboId.name !== qboAccount.Name) {
          updateMatched.run(acctNum, qboAccount.Name, existingByQboId.id)
          updated++
        }
        continue
      }

      const existingByNumber = acctNum ? localByNumber.get(acctNum) : undefined
      if (existingByNumber) {
        attachQboId.run(qboAccount.Id, acctNum, qboAccount.Name, existingByNumber.id)
        updated++
        touchedQboIds.push(qboAccount.Id)
        continue
      }

      const categorization = categorizeNewAccount(qboAccount, byQboId)
      if (!categorization) continue // shouldn't happen given the PL_ACCOUNT_TYPES filter, but don't insert a mis-categorized row
      insertNew.run({
        qboAccountId: qboAccount.Id,
        accountNumber: acctNum,
        name: qboAccount.Name,
        category: categorization.category,
        subcategory: categorization.subcategory,
        costBehavior: categorization.costBehavior,
        isActive
      })
      inserted++
      touchedQboIds.push(qboAccount.Id)
    }
  })
  runPass1()

  // Pass 2: resolve parent_account_id now that every touched account has a
  // local id. Re-read qbo_account_id -> local id fresh, since Pass 1 may
  // have just inserted or attached rows that weren't in localByQboId yet.
  const refreshedByQboId = new Map(
    (db.prepare('SELECT id, qbo_account_id FROM accounts WHERE qbo_account_id IS NOT NULL').all() as { id: number, qbo_account_id: string }[])
      .map(r => [r.qbo_account_id, r.id])
  )
  const runPass2 = db.transaction(() => {
    for (const qboId of touchedQboIds) {
      const qboAccount = byQboId.get(qboId)
      if (!qboAccount?.ParentRef?.value) continue
      const parentLocalId = refreshedByQboId.get(qboAccount.ParentRef.value) ?? null
      if (parentLocalId === null) continue
      setParent.run(parentLocalId, qboId)
    }
  })
  runPass2()

  // Deactivation/reactivation pass: every local row that already has a
  // qbo_account_id gets its is_active reconciled against what QBO just
  // returned. Never deleted, matching CLAUDE.md's chart-of-accounts-change
  // handling. Only rows whose state actually flips are written/counted —
  // otherwise every already-active matched account would get touched (and
  // counted as "reactivated") on every single run, inflating rows_synced
  // meaninglessly.
  let deactivated = 0
  let reactivated = 0
  const runDeactivationPass = db.transaction(() => {
    for (const row of localRows) {
      if (!row.qbo_account_id) continue
      const qboAccount = byQboId.get(row.qbo_account_id)
      const shouldBeActive = !!qboAccount && qboAccount.Active && PL_ACCOUNT_TYPES.has(qboAccount.AccountType)
      const isActiveNow = row.is_active === 1
      if (shouldBeActive === isActiveNow) continue
      if (shouldBeActive) {
        reactivate.run(row.id)
        reactivated++
      } else {
        deactivate.run(row.id)
        deactivated++
      }
    }
  })
  runDeactivationPass()

  return { inserted, updated, deactivated, reactivated }
}
