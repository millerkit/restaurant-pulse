// In-process nightly scheduler. No cron infra exists anywhere in this app
// (no node-cron dependency, no Fly scheduled machine) — but fly.toml runs
// this app with min_machines_running=1/auto_stop_machines=false, so the
// single Nitro process stays up 24/7 and a plain interval timer is enough.
// Nitro auto-loads every file under server/plugins/ — no registration
// needed elsewhere.
export default defineNitroPlugin((nitroApp) => {
  const { qbo } = useRuntimeConfig()
  if (qbo.syncEnabled === false) return

  let lastRunLocalDate: string | null = null

  // The container's clock is UTC (no TZ set anywhere in this repo), so
  // "3am local" has to be computed via an IANA zone, not
  // new Date().getHours().
  function toLocalDateParts(d: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: qbo.syncTimeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(d)
    const get = (type: string) => parts.find(p => p.type === type)!.value
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) }
  }

  function localNow() {
    return toLocalDateParts(new Date())
  }

  // lastRunLocalDate resets to null on every process restart, so a boot
  // check alone can't tell "never ran today" from "ran today, then the
  // machine restarted" — every deploy/restart was re-triggering a sync
  // it had already done that day (caught 2026-07-29: a plain `fly apps
  // restart` fired an extra live sync). sync_runs is the durable record,
  // so the boot check consults it instead of trusting only the in-memory
  // flag.
  function alreadySucceededToday(date: string): boolean {
    const row = useDb()
      .prepare(`SELECT started_at FROM sync_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1`)
      .get() as { started_at: string } | undefined
    return row !== undefined && toLocalDateParts(new Date(row.started_at)).date === date
  }

  async function checkAndMaybeSync(isBootCheck = false) {
    const { date, hour, minute } = localNow()
    if (date === lastRunLocalDate) return
    const pastTarget = hour > qbo.syncHour || (hour === qbo.syncHour && minute >= qbo.syncMinute)
    if (!pastTarget) return
    if (isBootCheck && alreadySucceededToday(date)) {
      lastRunLocalDate = date
      return
    }
    lastRunLocalDate = date // set before awaiting, so a concurrent tick can't double-fire
    if (isBootCheck) console.log(`QBO nightly sync: catching up a missed window for ${date}`)
    try {
      await runNightlySync()
    } catch (err) {
      console.error('QBO nightly sync failed:', err)
    }
  }

  // Boot-time check covers a redeploy/restart that straddled the target
  // time — lastRunLocalDate starts null, so this always evaluates fully on
  // a fresh process, but alreadySucceededToday() (backed by sync_runs,
  // which survives restarts) still prevents a redundant re-sync.
  checkAndMaybeSync(true)
  const interval = setInterval(() => checkAndMaybeSync(), 60_000)
  nitroApp.hooks.hook('close', async () => clearInterval(interval))
})
