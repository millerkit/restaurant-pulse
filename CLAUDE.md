# Restaurant Performance Dashboard

**Status: Nuxt scaffold in place as of 2026-07-20.** Both approved mockups are
now real pages with static sample data (matching the mockups exactly) backed
by a SQLite database initialized from `schema.sql`. QuickBooks sync and
wiring the UI to real data are not yet built — see Not yet done.

## What this is

A daily-use dashboard that pulls P&L data from QuickBooks Online and answers,
at a glance:

1. How did last night compare to the same weekday last week / last month / last year?
2. How do this week's/month's/year's COGS and labor look versus revenue?
3. Are we in the red or the black this month / this year?
4. Are we on pace to hit budget this month and this year?

A later phase adds drill-down (e.g. "which labor category is costing us too
much") but v1 is intentionally just the daily snapshot.

A second view, the **P&L tab** (added to the plan 2026-07-20), answers a
related set of questions at the weekly/monthly/yearly grain rather than the
single-day grain:

5. High-level P&L by week/month/year, with COGS%, labor%, and prime cost
   (COGS% + labor% combined — the single most-watched restaurant metric,
   added 2026-07-20 after a design critique) shown as red/green against
   configurable benchmarks (not the fixed budget dollar amounts in
   `budget_targets` — see `category_benchmarks` in [`schema.sql`](schema.sql)).
6. Drill-down into what's driving a cost percentage up — e.g. isolating
   overtime, which posts to its own GL account in this restaurant's chart of
   accounts, so it's just another `accounts` row (`category='labor',
   subcategory='Overtime'`) rather than new integration work. Opex gets the
   same treatment (added 2026-07-20), split into fixed (rent, insurance,
   loan interest — not benchmarked, not controllable month to month) and
   variable/discretionary (marketing, repairs, supplies, admin — the
   actionable slice, benchmarked as `opex_variable`) via the new
   `accounts.cost_behavior` column.
7. Drill-down into a revenue shortfall for the period — which specific days
   underperformed vs. their same-weekday comparison, or whether the shortfall
   is spread evenly across the period.

This is a genuinely tabular report (line items × periods), which doesn't
conflict with "no traditional charts" below — that rule is about
line/bar/pie time-series visuals, not tables. It'll be a new top-level tab
(e.g. "Dashboard" / "P&L") rather than another section on the single-page
dashboard, since it's a different mode of reading the data, not more of the
same page.

**Mockup tentatively approved by user 2026-07-20** — see
[`design/pl-mockup.html`](design/pl-mockup.html). Both mockup files now have
a top-level tab nav linking to each other. Sample data and layout are
revisitable, not locked in.

Deliberately **not** a traditional BI/line-and-bar-chart dashboard — see
Design direction below.

## Decisions made

- **QuickBooks**: QuickBooks Online (has a REST API). Pull daily figures via
  the Reports API — `ProfitAndLoss` report with `summarize_column_by=Days` —
  rather than the raw transaction endpoints.
- **Stack**: Nuxt 4 + TypeScript + SQLite (`better-sqlite3`). Chosen over
  Next.js/React because the user is a web developer much more fluent in Vue
  than React; Nuxt is the direct analog (file-based routing, Nitro server
  routes for the sync job and API, SSR, one codebase). Originally scoped as
  Nuxt 3; `nuxi` now defaults to Nuxt 4 (current stable, same team, mostly
  compatible — the visible change is the `app/` source directory), and the
  user chose to go with that rather than pin to 3.
- **Data model**: see [`schema.sql`](schema.sql).
  - `accounts` — maps each QBO account to an internal category
    (`revenue` / `cogs` / `labor` / `opex` / `other`) and an optional
    subcategory. This is what makes future drill-down ("which labor category")
    additive rather than a redesign. Also carries `cost_behavior`
    (`fixed` / `variable`, added 2026-07-20), meaningful only for
    category='opex' — the fixed/variable split behind the Opex drill-down.
  - `daily_line_items` — the single fact table: one row per (date, account).
  - `budget_targets` — monthly budget by category, entered manually (QBO's
    Budget object doesn't map cleanly to restaurant-style category budgets).
  - `category_benchmarks` — configurable red/green percentage thresholds for
    COGS%, labor%, prime cost, and variable opex (of revenue), used by the
    P&L tab and the Dashboard's Cost Pace meters. Separate from
    `budget_targets` because these are ratios that don't vary by month/year,
    not dollar amounts that do. `prime_cost` and `opex_variable` each have
    their own row rather than being derived from other categories, since
    each is benchmarked against its own industry-standard target, not a sum
    or subset of another target.
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

## Design critique — 2026-07-20

User asked for a sanity check partway through scaffolding: is this
overloaded, does it follow good visual/design principles, and are there
important restaurant metrics missing? Findings and what was done about them:

- **Overloaded?** Dashboard: no — each section maps 1:1 to one of the four
  daily questions. P&L tab: the table density is fine (P&L statements are
  inherently dense), but the two drill-down sections were *always* fully
  expanded regardless of whether anything was actually off-benchmark, which
  made every day look equally busy. **Fixed**: drill-downs now collapse to a
  one-line "Nothing unusual" state (green chip + a sentence) when nothing's
  flagged, and only expand into the full callout + ranked list when
  something actually crosses a benchmark. See `laborFlagged`/`revenueFlagged`
  in [`app/pages/pl.vue`](app/pages/pl.vue) — computed from the row/day data
  itself (e.g. a labor row's `flagNote`, a day's `actual < comparison`)
  rather than a bare hardcoded boolean, so the logic is the kind that'll
  still make sense once it's wired to real benchmark comparisons.
- **Color-alone violation**: the Design direction section below says status
  colors must always pair with an icon+label, never color alone — but the
  COGS%/labor% figures in the P&L table were bare colored text with no icon
  next to them. **Fixed**: a ✓ prefix marks "within benchmark", a ▲ prefix
  marks any degree of "above benchmark" — the shape distinction survives
  grayscale/colorblindness, color is reinforcement only. See `.pl-table .pct`
  in [`app/pages/pl.vue`](app/pages/pl.vue).
- **Missing metric — Prime Cost**: COGS% + labor% combined is the
  single most-watched number in restaurant management (industry rule of
  thumb: keep it under ~60–65%). It cost nothing to add (just a sum of
  numbers already on hand) and is now a subtotal row in the P&L table plus a
  third meter on the Dashboard's Cost Pace section. See `prime_cost` in
  `category_benchmarks` ([`schema.sql`](schema.sql)).
- **Opex had no benchmark or drill-down** — flagged, then resolved
  2026-07-20. A single lump dollar figure isn't very actionable since opex
  bundles fixed costs (rent, insurance, loan interest — not controllable
  month to month) with variable/discretionary ones (marketing, repairs,
  supplies, admin — the actionable slice). Rather than one blunt benchmark
  on the total, Opex got the same subcategory drill-down treatment as
  labor: split fixed from variable via `accounts.cost_behavior`, and only
  the variable subtotal is compared against a benchmark
  (`opex_variable` in `category_benchmarks`). See the Opex Drill-Down
  section in [`app/pages/pl.vue`](app/pages/pl.vue).
- **Other real restaurant KPIs, deliberately out of scope**: comps/discounts
  %, covers and average check (splits "fewer guests" from "lower spend per
  guest" as the cause of a revenue miss), sales per labor hour, theoretical
  vs. actual food cost. All need POS or scheduling data beyond what QBO's
  `ProfitAndLoss` report provides — a real boundary of the QBO-only design,
  not an oversight, unless the data source decision changes.

## Running it

- `npm install`
- `npm run db:init` — creates `data/restaurant.sqlite` from `schema.sql`
  (destructive re-run: drops and recreates the file, since there's no real
  data yet)
- `npm run dev` — both pages are the real app now, not the static mockup
  files (which still exist under `design/` for reference)

## Not yet done

- QuickBooks Online OAuth + nightly sync job (Nitro server route) that
  populates `daily_line_items`
- Wiring the dashboard UI to the real schema — both pages currently render
  the same static sample data as the approved mockups, not `useDb()` queries
- A manual budget-entry flow for `budget_targets`
- A manual entry flow for `category_benchmarks`

## Where to look

- [`schema.sql`](schema.sql) — data model
- [`design/dashboard-mockup.html`](design/dashboard-mockup.html) — approved static mockup (reference only)
- [`design/pl-mockup.html`](design/pl-mockup.html) — tentatively approved P&L tab mockup (reference only)
- [`app/pages/index.vue`](app/pages/index.vue) — the real Dashboard page
- [`app/pages/pl.vue`](app/pages/pl.vue) — the real P&L page
- [`app/layouts/default.vue`](app/layouts/default.vue) — shared tab nav
- [`app/assets/css/main.css`](app/assets/css/main.css) — shared design tokens (colors, chips, header) used by both pages
- [`server/utils/db.ts`](server/utils/db.ts) — `useDb()` helper for future server routes/API endpoints
- [`scripts/init-db.mjs`](scripts/init-db.mjs) — creates the SQLite file from `schema.sql`
