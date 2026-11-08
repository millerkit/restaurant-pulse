// Database migration status for the Settings page: which migrations in
// scripts/migrations haven't been applied. Migrations run at container start
// (scripts/migrate.mjs); anything still pending here means that run failed —
// check `fly logs` for "[migrate] FAILED".
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(() => {
  let ids: string[] = []
  try {
    ids = readdirSync(join(process.cwd(), 'scripts', 'migrations'))
      .filter(f => /^\d{4}-.+\.mjs$/.test(f))
      .map(f => f.replace(/\.mjs$/, ''))
      .sort()
  } catch {
    return { available: false as const }
  }
  const db = useDb()
  const hasTable = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).get()
  const rows = hasTable
    ? db.prepare('SELECT id, applied_at AS appliedAt FROM schema_migrations ORDER BY applied_at DESC').all() as { id: string, appliedAt: string }[]
    : []
  const applied = new Set(rows.map(r => r.id))
  return {
    available: true as const,
    total: ids.length,
    pending: ids.filter(id => !applied.has(id)),
    lastAppliedAt: rows[0]?.appliedAt ?? null
  }
})
