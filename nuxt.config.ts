// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    qbo: {
      clientId: process.env.QBO_CLIENT_ID,
      clientSecret: process.env.QBO_CLIENT_SECRET,
      redirectUri: process.env.QBO_REDIRECT_URI,
      environment: process.env.QBO_ENVIRONMENT || 'sandbox',
      // Nightly sync scheduling (see server/plugins/qbo-nightly-sync.ts).
      // Defaults match the sample "Last synced... 3:04 AM" text already in
      // useSyncStatus() (app/composables/useBudgetData.ts). Urban Hearth's
      // actual location is America/New_York — confirmed with the user, not
      // guessed, since the container's own clock is UTC.
      syncEnabled: process.env.QBO_SYNC_ENABLED !== 'false',
      syncTimeZone: process.env.QBO_SYNC_TIMEZONE || 'America/New_York',
      syncHour: Number(process.env.QBO_SYNC_HOUR ?? 3),
      syncMinute: Number(process.env.QBO_SYNC_MINUTE ?? 4)
    },
    basicAuth: {
      user: process.env.BASIC_AUTH_USER,
      pass: process.env.BASIC_AUTH_PASS
    },
    cloudflareAccess: {
      // The custom-domain hostname Cloudflare Access gates (e.g.
      // pulse.urbanhearth.net). Requests to any other Host — including the
      // raw *.fly.dev hostname — fall back to Basic Auth instead. Left
      // unset, this feature is a no-op and everything uses Basic Auth, same
      // as before.
      hostname: process.env.CLOUDFLARE_ACCESS_HOSTNAME,
      teamDomain: process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
      aud: process.env.CLOUDFLARE_ACCESS_AUD
    }
  }
})
