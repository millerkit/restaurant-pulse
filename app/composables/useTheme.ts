// Manual light/dark/system theme toggle (added 2026-09-14, at the user's
// request) — until now this app only ever followed the OS's own
// prefers-color-scheme (see main.css). The CSS already had a `data-theme`
// override mechanism wired up for this (main.css's `:not([data-theme=
// "light"])`/`[data-theme="dark"]` rules) but nothing in the app ever set
// that attribute — this composable is what does, plus persists the choice.
//
// A blocking inline script in nuxt.config.ts's app.head.script sets the
// same attribute from localStorage before first paint, so there's no
// flash of the wrong theme while Vue boots — this composable's job is to
// keep reactive state in sync with that and apply any *future* change the
// user makes via the toggle.
export type ThemePreference = 'light' | 'dark' | 'system'

const THEME_STORAGE_KEY = 'theme-preference'

function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system'
}

function applyThemeAttr(pref: ThemePreference) {
  const root = document.documentElement
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
}

// Module-level singleton, not a per-call ref — every component that calls
// useTheme() (the toggle itself, and potentially others later) needs to
// read/write the *same* current preference, not its own independent copy.
const themeState = ref<ThemePreference>('system')
let initialized = false

export function useTheme() {
  if (import.meta.client && !initialized) {
    initialized = true
    let stored: string | null = null
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY)
    } catch {
      // Private-browsing/storage-blocked: fall back to 'system' silently —
      // the blocking head script already no-ops the same way.
    }
    themeState.value = isThemePreference(stored) ? stored : 'system'
  }

  function setTheme(pref: ThemePreference) {
    themeState.value = pref
    if (!import.meta.client) return
    applyThemeAttr(pref)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref)
    } catch {
      // Nothing to persist to — the in-memory/DOM change above still takes
      // effect for the rest of this session.
    }
  }

  return { theme: themeState, setTheme }
}
