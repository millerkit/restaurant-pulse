// Manual trigger for the same sync the nightly scheduler runs (see
// server/utils/qbo-sync-runner.ts and server/plugins/qbo-nightly-sync.ts).
// No bespoke auth here — every route is already gated by
// server/middleware/auth.ts (Basic Auth or Cloudflare Access, by Host).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ date?: string }>(event).catch(() => undefined)
  return await runNightlySync(body?.date)
})
