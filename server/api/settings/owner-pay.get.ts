// Labor accounts that hold owner compensation (accounts.is_owner_compensation). Owner pay is real
// cost and stays in labor dollars and net income; the flag only lets labor % be shown with and
// without it, since industry benchmarks assume the owners aren't on payroll.
export default defineEventHandler(() => {
  const accounts = useDb().prepare(`
    SELECT a.id, a.account_number AS accountNumber, a.name, a.is_owner_compensation AS isOwnerPay
    FROM accounts a
    WHERE a.category = 'labor' AND a.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id AND c.is_active = 1)
    ORDER BY a.account_number, a.name
  `).all() as { id: number, accountNumber: string | null, name: string, isOwnerPay: number }[]
  return { accounts: accounts.map(a => ({ ...a, isOwnerPay: a.isOwnerPay === 1 })) }
})
