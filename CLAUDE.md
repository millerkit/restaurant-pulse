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

A third view, the **Budget tab** (added 2026-07-22, after the user moved
into a new, more expensive space and took on debt, making "will we earn
enough to hit budget" the most urgent question), answers:

8. Budget vs. actual by category (Revenue/COGS/Labor/Opex), paced against
   how far through the month/year we are, plus a derived Net Income figure.
9. Which cost categories are running ahead of budget pace ("overspending"),
   flagged/collapsed the same way as the P&L tab's drill-downs.
10. Editing next month's (or any month's) budget, at the macro category
    level for convenience, with an optional expand into the underlying QBO
    accounts for precise edits — see the Budget tab section below.
11. Updating a month's budget from that month's actuals, or projecting
    unbudgeted future months forward from a recent actual month.
12. Exporting a budget as an Excel file shaped exactly like QuickBooks's own
    budget import template, for manual re-import into QBO.

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
    As of 2026-07-22 also carries `account_number` and `parent_account_id`,
    reconstructing the real QBO chart of accounts hierarchy, and
    `is_owner_compensation` (meaningful only for category='labor') — see
    Budget tab below for both.
  - `daily_line_items` — the single fact table: one row per (date, account).
  - `budget_targets` — monthly budget **per account** (changed from
    per-category 2026-07-22 — see Budget tab below), entered manually or
    imported from a QBO budget export (QBO's Budget API is believed to be
    query-only, so there's no live write path).
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

## Budget tab — 2026-07-22

Added after the user moved into a new, more expensive space and took on
debt, making "are we going to earn enough to hit budget" the single most
urgent question — sharper than the cost-ratio focus the Dashboard/P&L tabs
were built around. The user also shared a real file, their QBO-exported
`Budget_FY26_P&L_1.xlsx` for their actual restaurant (Urban Hearth), which
changed the shape of this feature significantly:

- **Budgets moved from per-category to per-account.** The original
  `budget_targets` design (one dollar figure per `year, month, category`)
  can't reconstruct a file QBO would accept back on re-import, and can't
  project "next month's budget" per line item — QBO's own budget object is
  fundamentally per-account (~150-220 real accounts for this restaurant,
  nested up to 4 levels: `6000 Labor` → `6010 BOH Wages` → `6012 Garde
  Manger Cook`). `budget_targets` is now `(year, month, account_id, amount)`;
  the Budget tab's macro view (and the Dashboard/P&L tabs' category
  rollups) aggregate through `accounts.category` at query time. **Net income
  is never entered directly** — there's no real "Net Income" QBO account
  (a QBO budget export's "Total Net Income" row is a computed subtotal, not
  an account) — it's always derived as revenue − cogs − labor − opex, so it
  can't drift out of sync with the category budgets it's made of.
- **QBO "sync" means export-for-reimport, not a live API push.** QBO's
  Budget API entity is believed to be query-only (no confirmed live
  Create/Update endpoint) — presumably why QBO built this Excel-import
  workflow as a separate product feature in the first place. The Budget
  tab's "Export for QuickBooks" button generates a file shaped exactly like
  the user's real export (same `Guidelines` sheet, same `Consolidated`
  sheet structure/indentation/formatting) for manual re-import in QBO's own
  UI, editing `data/qbo-budget-template.xlsx` (a value-blanked copy of the
  real file, safe to commit) in place rather than rebuilding a workbook from
  scratch.
- **One-time seed from the real xlsx**, via
  [`scripts/import-budget-xlsx.mjs`](scripts/import-budget-xlsx.mjs): parses
  the real chart of accounts and Jan–Jul 2026 budget out of the file (run
  once against the user's own export — the original file is never checked
  in, only the sanitized template it produces). Category and
  fixed/variable `cost_behavior` are assigned by a first-pass rule (top-level
  section + a `6000 Labor` vs. everything-else-in-Expense split for
  labor/opex, and an Occupancy/Insurance/Interest subtree list for
  fixed opex) — editable afterward in the UI, not a definitive
  classification. A month is only imported as budgeted if the file actually
  has non-zero numbers for it (detected generically, not hardcoded to
  Jan–Jul) — Aug–Dec are left with no `budget_targets` rows at all, so the
  "project remaining months" feature has genuinely empty months to fill
  rather than fighting existing zero rows.
- **Answering "what happens when the COA changes or new accounts are
  added?"**: new accounts get inserted with `is_active=1` and no budget row
  (surfaced as needing a budget, not silently $0) once a real QBO account
  sync exists (not yet built — `qbo_account_id` is null for every
  xlsx-seeded account today, to be filled in by matching `account_number`
  when it is). Removed/renamed accounts get `is_active=0`, never deleted, so
  historical `daily_line_items`/`budget_targets` rows stay intact. On
  export, a DB account missing from the template gets appended as a new row
  (QBO's own Guidelines sheet explicitly permits this) rather than dropped.
- **The Overspending drill-down stays category-level, on purpose** — unlike
  the P&L tab's labor/opex drill-downs, it doesn't expand into "which
  accounts are driving it." Per-account *actuals* don't exist yet
  (`daily_line_items` is empty until the QBO sync is wired to the UI), and
  fabricating illustrative per-account numbers against this restaurant's
  *real* chart of accounts (unlike the placeholder "Main & Vine" sample data
  elsewhere) seemed like the wrong call. Revisit once real actuals flow in.
- **A known simplification worth remembering**: `category='other'` collapses
  QBO's separate "Other Income" and "Other Expense" report sections into one
  bucket, so there's no reliable sign to net an "other" account against
  revenue yet, and a brand-new `other` account can't be placed back into the
  right template section on export (it gets appended at the very end
  instead). Fine for now since this restaurant's Other Income/Expense
  accounts are minor, but worth splitting into two categories if that stops
  being true.
- **Sanity-check flag from the real import, not a bug**: imported July 2026
  budget shows Labor at ~80% of Revenue ($102,089 vs. $127,469) — verified
  independently against the raw xlsx cells, so it's a property of the
  source file, not an import error, but that ratio is unusually high for a
  restaurant (industry norm is closer to 30%) and worth the user
  double-checking against the real QuickBooks budget. Partly explained by
  the owner-compensation carve-out below — see that section for the rest of
  the story (this is the restaurant's first full month open, and BOH labor
  is genuinely running hot on top of it).
- **Owner-compensation carve-out** (added 2026-07-22, same day, after the
  user flagged that Labor's real-world overrun this month is partly BOH
  running hot on a first full month open, and partly that the Labor budget
  itself includes the two owners' own salaries — Executive Chef is the
  user's wife, Business Manager is the user). A hired-staff industry
  benchmark (the ~30% rule of thumb) was never built assuming the owners
  are on payroll, so comparing raw Labor% against it can flag "overstaffed"
  when some of it is really owner compensation, not operating labor. But
  the fix isn't to exclude owner pay from Labor entirely — that's real cash
  cost and needs to stay in total labor $ and net income, or those numbers
  stop meaning what they say. Landed on: `accounts.is_owner_compensation`
  (boolean, meaningful only for `category='labor'`), currently set by hand
  on exactly two accounts (Executive Chef, Business Manager) — **not**
  modeled as `cost_behavior='fixed'`, since owner pay is controllable (you
  set your own number) unlike rent/insurance, so it isn't "fixed" in the
  sense that field already means; conflating the two would blur a field
  that's doing clear, separate work for opex. This restaurant also has a
  real hired General Manager ($90K/year) — a market-rate role, correctly
  *not* flagged, and the reason the carve-out only applies to genuine
  owner-operator roles rather than "Management Salaries" as a whole. The
  Budget tab's Labor pace card and Overspending flag now show labor %
  **both ways** (with and without owner comp) rather than picking one
  silently — but only on the budget side: actual labor is still a single
  lump sample figure (`daily_line_items` is empty), so there's no way yet
  to split *actual* labor by account the same way. That becomes possible
  automatically once the real nightly sync lands, with no further schema
  work. There's also no UI yet to toggle this flag for other accounts — set
  directly via SQL for now, matching how `cost_behavior`'s classifications
  are similarly "first-pass, editable later" rather than a full settings UI.
- **COGS budgeted as % of revenue, not a fixed dollar guess** (added
  2026-07-22, same day, after the user pushed back on setting fixed COGS
  dollar figures for August–December: COGS moves with how busy the
  restaurant is, the menu, and month-to-month inventory timing, unlike rent
  or a salary, so a dollar guess months out is closer to a coin flip). Split
  `accounts.subcategory` into `'Food'` / `'Beverage'` / `'Other'` for
  category='cogs' (matching the schema.sql doc comment's own original
  example values, and matching how MarginEdge already budgets this — see
  `product-strategy-notes.md`) instead of the generic parent-account-name
  default used elsewhere. The Budget tab's Edit Monthly Budget section shows
  a trailing-3-month average Food% and Beverage% of revenue (deliberately a
  multi-month average, not the single most recent month, so one lumpy
  ingredient delivery doesn't single-handedly reset the target — same
  reasoning as the owner-comp carve-out: don't let one distortion masquerade
  as the steady-state number) and a one-click "recompute this month's COGS
  from that average" action that sets Food/Beverage budget $ = trailing
  average % × that month's *own* revenue budget, redistributed across each
  group's accounts. Requires a revenue budget to already exist for the
  target month (surfaced as a clear error if not — recompute a dollar
  figure from a percentage of nothing isn't meaningful). Uses the real
  `budget_targets` figures for past months as the average's input, not the
  sample actuals figure used elsewhere on this page — this restaurant has
  been updating its QBO "budget" with real numbers as each month closed
  (see the sanity-check note above), so those rows are the closest thing to
  real actuals this app has pre-sync. 'Other' COGS (packaging, catering
  equipment/supplies, retail) is deliberately excluded from this — those
  don't scale with revenue the same way and stay manually edited.
  **Explicitly out of scope, on purpose**: MarginEdge already tracks COGS
  at real ingredient-category granularity (Produce, Seafood, Dairy, etc.)
  against a live sales-forecast engine, powered by their vendor
  invoice-capture pipeline — a materially heavier data pipeline than QBO's
  GL, and exactly the territory this project already decided not to compete
  in (see `product-strategy-notes.md`). Building a shallower clone of that
  here would be reinventing something MarginEdge already does better with
  data this app doesn't have. This feature stays at QBO's own GL-account
  grain (Food Costs, Beer/Liquor/Wine/Non-Alcoholic Costs) — good enough to
  keep the QBO budget sane, not a substitute for MarginEdge's operational
  COGS tracking.

See [`app/pages/budget.vue`](app/pages/budget.vue) for the three sections
(Budget Pace, Overspending, Edit Monthly Budget) and
[`server/api/budget/`](server/api/budget/) for the four routes
(`targets.get`, `targets.post`, `copy-actuals.post`, `export.get`).

## Running it

- `npm install`
- `npm run db:init` — creates `data/restaurant.sqlite` from `schema.sql`
  (destructive re-run: drops and recreates the file). **As of 2026-07-22
  this now also destroys real data** — the connected QBO OAuth token and any
  imported/edited budget data — not just placeholder sample rows, so don't
  re-run this casually against a dev database that's already been used for
  real. Migrating just the `accounts`/`budget_targets` tables in place (drop
  + recreate those two only) is the safer path once real data exists.
- `npm run db:import-budget -- /path/to/a/QBO/budget/export.xlsx` — one-time
  seed of `accounts` + `budget_targets` from a real QuickBooks budget Excel
  export; also writes the sanitized `data/qbo-budget-template.xlsx` used by
  the Budget tab's export feature. See Budget tab below.
- `npm run dev` — all three pages are the real app now, not the static
  mockup files (which still exist under `design/` for reference)

## Not yet done

- QuickBooks Online OAuth + nightly sync job (Nitro server route) that
  populates `daily_line_items`
- Wiring the dashboard UI to the real schema — the Dashboard and P&L pages
  currently render the same static sample data as the approved mockups, not
  `useDb()` queries (the Budget tab is the exception — its budget numbers
  are real, only its actuals are still sample data)
- A real QBO Account sync to fill in `qbo_account_id` on the xlsx-seeded
  `accounts` rows and keep the chart of accounts current (new accounts,
  renames, deactivations) — see "what happens when the COA changes" in the
  Budget tab section above
- A manual entry flow for `category_benchmarks`
- Auto-recalculating expense budgets when a revenue estimate is revised
  mid-month (raised, deliberately deferred — the Budget tab ships manual
  editing + category-level flagging first)
- Per-account actuals in the Overspending drill-down (needs real
  `daily_line_items`, not sample data — see Budget tab above)
- A UI to toggle `accounts.is_owner_compensation` (currently set by hand via
  SQL on the two owner accounts) and to split *actual* labor by owner-comp
  the same way the budget side already is (needs real per-account actuals)

## Where to look

- [`schema.sql`](schema.sql) — data model
- [`design/dashboard-mockup.html`](design/dashboard-mockup.html) — approved static mockup (reference only)
- [`design/pl-mockup.html`](design/pl-mockup.html) — tentatively approved P&L tab mockup (reference only)
- [`app/pages/index.vue`](app/pages/index.vue) — the real Dashboard page
- [`app/pages/pl.vue`](app/pages/pl.vue) — the real P&L page
- [`app/pages/budget.vue`](app/pages/budget.vue) — the real Budget page
- [`app/layouts/default.vue`](app/layouts/default.vue) — shared tab nav
- [`app/assets/css/main.css`](app/assets/css/main.css) — shared design tokens (colors, chips, header) used by all three pages
- [`server/utils/db.ts`](server/utils/db.ts) — `useDb()` helper for server routes/API endpoints
- [`server/api/budget/`](server/api/budget/) — budget read/write, copy-actuals, and QBO export routes
- [`scripts/init-db.mjs`](scripts/init-db.mjs) — creates the SQLite file from `schema.sql`
- [`scripts/import-budget-xlsx.mjs`](scripts/import-budget-xlsx.mjs) — one-time seed of accounts + budget from a real QBO budget export
- `data/qbo-budget-template.xlsx` — sanitized export template (checked in; the real xlsx it came from is not)
