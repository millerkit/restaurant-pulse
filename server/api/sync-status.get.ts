// Single source of truth for "when did we last sync from QuickBooks/Toast,
// and did it work" — used by PageHeader.vue's sync-status chip and "Sync
// now" button on every top-level page. Dashboard/P&L already queried
// sync_runs themselves inline for their own header; this is the same query
// factored out so Budget Pace and Edit Budget (which previously showed a
// hardcoded sample timestamp via useSyncStatus() in useBudgetData.ts) get
// the real thing too, from one place.
export default defineEventHandler(() => {
  const db = useDb()
  const row = db.prepare('SELECT status, finished_at AS finishedAt FROM sync_runs ORDER BY id DESC LIMIT 1')
    .get() as { status: 'running' | 'success' | 'error', finishedAt: string | null } | undefined
  return row ?? null
})
