// People & Access (owner only: not in any non-owner allowlist, see shared/utils/access.ts).
export default defineEventHandler(() => {
  const people = useDb().prepare('SELECT email, role, name FROM user_roles ORDER BY CASE role WHEN \'owner\' THEN 0 WHEN \'gm\' THEN 1 WHEN \'kitchen\' THEN 2 ELSE 3 END, email').all()
  return { people }
})
