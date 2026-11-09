// App navigation: a handful of sections, each with its own pages (shown as
// sub-tabs under the section bar). One place to rename a page or move it
// between sections; the layout (app/layouts/default.vue) renders from this.
// Phase 1 of the 2026-11 UI cleanup — roles/permissions will later filter
// these lists per person, so keep labels plain-language and generic (no
// restaurant-specific names) since the app may be reused elsewhere.

export type NavPage = {
  label: string
  to: string
  // Path match plus, optionally, a required ?tab= value. `tab: null` means
  // "this path with no tab, or any tab other than the ones claimed by a
  // sibling entry" — used for /capacity, where one page serves two entries.
  path: string
  tab?: string | null
}

export type NavSection = {
  key: string
  label: string
  icon: 'home' | 'sales' | 'team' | 'money' | 'planning'
  pages: NavPage[]
}

import { roleCanViewPage, type Role } from '#shared/utils/access'

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'home',
    label: 'Home',
    icon: 'home',
    pages: [{ label: 'This Week', to: '/', path: '/' }]
  },
  {
    key: 'sales',
    label: 'Sales',
    icon: 'sales',
    pages: [
      { label: 'Daily Results', to: '/pl/revenue-calendar', path: '/pl/revenue-calendar' },
      { label: 'Covers & Spend', to: '/capacity', path: '/capacity', tab: null },
      { label: 'Seasonal Trends', to: '/historical', path: '/historical' }
    ]
  },
  {
    key: 'team',
    label: 'Team',
    icon: 'team',
    pages: [
      { label: 'Kitchen Hours', to: '/kitchen-labor', path: '/kitchen-labor' },
      { label: 'Benefits Eligibility', to: '/staff-hours', path: '/staff-hours' }
    ]
  },
  {
    key: 'money',
    label: 'Money',
    icon: 'money',
    pages: [
      { label: 'Profit & Loss', to: '/pl', path: '/pl' },
      { label: 'Budget Check', to: '/budget', path: '/budget' },
      { label: 'Cash & Loans', to: '/cashflow', path: '/cashflow' }
    ]
  },
  {
    key: 'planning',
    label: 'Planning',
    icon: 'planning',
    pages: [
      { label: 'Budget', to: '/budget/edit', path: '/budget/edit' },
      { label: 'Sales Plan', to: '/budget/revenue', path: '/budget/revenue' },
      { label: 'Staffing Plan', to: '/budget/labor', path: '/budget/labor' },
      { label: 'Capacity', to: '/capacity?tab=edit', path: '/capacity', tab: 'edit' },
      { label: 'What-If', to: '/revenue-modeling', path: '/revenue-modeling' }
    ]
  }
]

// Pages reached from the gear menu rather than a section.
export const SETTINGS_PATHS = ['/settings', '/reservations']

function normPath(p: string) {
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

export function isPageActive(page: NavPage, path: string, tab: string | undefined): boolean {
  if (normPath(path) !== page.path) return false
  if (page.tab === undefined) return true
  if (page.tab === null) return tab !== 'edit'
  return tab === page.tab
}

export function findActive(path: string, tab: string | undefined): { section: NavSection, page: NavPage } | null {
  for (const section of NAV_SECTIONS) {
    for (const page of section.pages) {
      if (isPageActive(page, path, tab)) return { section, page }
    }
  }
  return null
}

// The sections and pages a role can see (same rules the server enforces, shared/utils/access.ts).
export function visibleNav(role: Role): NavSection[] {
  return NAV_SECTIONS
    .map(s => ({ ...s, pages: s.pages.filter(p => roleCanViewPage(role, p.path, p.tab ?? null)) }))
    .filter(s => s.pages.length > 0)
}
