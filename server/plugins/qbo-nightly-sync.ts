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
  function localNow() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: qbo.syncTimeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(new Date())
    const get = (type: string) => parts.find(p => p.type === type)!.value
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) }
  }

  async function checkAndMaybeSync(isBootCheck = false) {
    const { date, hour, minute } = localNow()
    if (date === lastRunLocalDate) return
    const pastTarget = hour > qbo.syncHour || (hour === qbo.syncHour && minute >= qbo.syncMinute)
    if (!pastTarget) return
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
  // a fresh process without needing to read sync_runs.
  checkAndMaybeSync(true)
  const interval = setInterval(() => checkAndMaybeSync(), 60_000)
  nitroApp.hooks.hook('close', async () => clearInterval(interval))
})
