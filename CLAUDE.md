# Restaurant Performance Dashboard

**Status: Paused 2026-07-17 — pre-implementation, design direction approved, nothing scaffolded yet.**

## What this is

A daily-use dashboard that pulls P&L data from QuickBooks Online and answers,
at a glance:

1. How did last night compare to the same weekday last week / last month / last year?
2. How do this week's/month's/year's COGS and labor look versus revenue?
3. Are we in the red or the black this month / this year?
4. Are we on pace to hit budget this month and this year?

A later phase adds drill-down (e.g. "which labor category is costing us too
much") but v1 is intentionally just the daily snapshot.

Deliberately **not** a traditional BI/line-and-bar-chart dashboard — see
Design direction below.

## Decisions made

- **QuickBooks**: QuickBooks Online (has a REST API). Pull daily figures via
  the Reports API — `ProfitAndLoss` report with `summarize_column_by=Days` —
  rather than the raw transaction endpoints.
- **Stack**: Nuxt 3 + TypeScript + SQLite. Chosen over Next.js/React because
  the user is a web developer much more fluent in Vue than React; Nuxt is the
  direct analog (file-based routing, Nitro server routes for the sync job and
  API, SSR, one codebase).
- **Data model**: see [`schema.sql`](schema.sql).
  - `accounts` — maps each QBO account to an internal category
    (`revenue` / `cogs` / `labor` / `opex` / `other`) and an optional
    subcategory. This is what makes future drill-down ("which labor category")
    additive rather than a redesign.
  - `daily_line_items` — the single fact table: one row per (date, account).
  - `budget_targets` — monthly budget by category, entered manually (QBO's
    Budget object doesn't map cleanly to restaurant-style category budgets).
  - `sync_runs` — tracks nightly sync freshness/failures.

## Design direction — approved by user 2026-07-17

User's own words on the mockup: **"clean, simple, and quickly readable."**
No traditional business charts (no line/bar time series, no pie charts).

See [`design/dashboard-mockup.html`](design/dashboard-mockup.html) — open
directly in a browser, works in light/dark and on mobile. It has sample data
for a placeholder restaurant ("Main & Vine"), not real data.

Layout, top to bottom:

- **Where We Stand** — big black/red net-income figure for month and year,
  each with its own "on pace / behind pace" status chip. Deliberately kept
  separate from the black/red sign — a month can be profitable and still be
  behind budget.
- **Last Night vs. History** — last night's revenue vs. the *same weekday*
  last week, and the same weekday-position last month/year (e.g. "3rd
  Thursday of July" vs. "3rd Thursday of June" and "3rd Thursday of last
  July"), not a fixed day-count offset.
- **Cost Pace** — COGS and labor shown as horizontal target-band meters
  (shaded acceptable range + a marker), not pie charts.
- **Budget Runway** — a progress bar per period (month, year) with a tick
  mark for "where today's pace expects us to be," colored by status.

Visual system: status colors (good/warning/serious/critical) are reserved
and always paired with an icon+label chip, never color alone. Palette and
mark choices were run through the `dataviz` skill's palette validator.

## Not yet done

- Nuxt project scaffold
- QuickBooks Online OAuth + nightly sync job (Nitro server route) that
  populates `daily_line_items`
- Wiring the dashboard UI to the real schema (currently static sample data)
- A manual budget-entry flow for `budget_targets`
- Repo is not yet a git repository

## Where to look

- [`schema.sql`](schema.sql) — data model
- [`design/dashboard-mockup.html`](design/dashboard-mockup.html) — approved static mockup
