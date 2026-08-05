// Defense-in-depth response headers, applied to every request regardless of
// auth outcome (named with a numeric prefix so it runs before auth.ts).
// Deliberately no script-src/style-src CSP directives — locking those down
// needs nonce support this app's SSR hydration script hasn't been tested
// against, and getting that wrong breaks the live site rather than just
// failing to protect it. frame-ancestors is zero-risk since this app never
// expects to be framed, so it's included outright.
export default defineEventHandler((event) => {
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'X-Frame-Options', 'DENY')
  setResponseHeader(event, 'Content-Security-Policy', "frame-ancestors 'none'")
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  if (!import.meta.dev) {
    setResponseHeader(event, 'Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  }
})
