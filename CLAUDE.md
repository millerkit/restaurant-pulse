# Restaurant Pulse

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

**Split into two tabs 2026-07-22** (same day, after the user pointed out it
was confusing to have a Month/Year pace toggle at the top of the page while
Edit Monthly Budget below it was always month-scoped): Budget Pace and
Overspending are now [`app/pages/budget/index.vue`](app/pages/budget/index.vue)
(route `/budget`), and Edit Monthly Budget is
[`app/pages/budget/edit.vue`](app/pages/budget/edit.vue) (route
`/budget/edit`), each its own top-level tab in
[`app/layouts/default.vue`](app/layouts/default.vue). Shared types/constants
and the `budget_targets` fetch live in
[`app/composables/useBudgetData.ts`](app/composables/useBudgetData.ts) so
both pages load their own copy of the year's data independently — there's no
cross-page live state, since a full sync would mostly show meaningless
numbers (there's no pace to compute for a future month with no actuals yet).
The one exception: the Edit Budget page shows a "live preview" mini pace
card, recomputed from the in-progress *unsaved* edits, but only while
editing the current as-of month specifically — the one case where "does
this edit change our pace" has a real answer.

See [`server/api/budget/`](server/api/budget/) for the four routes
(`targets.get`, `targets.post`, `copy-actuals.post`, `export.get`) both pages
share.

**Edit Budget's account rows render as an indented tree, matching the COA
layout QBO's own budget UI/export uses** (added 2026-07-22, after the user
pointed at a QBO budget screenshot showing indentation and asked whether
that was a reason to keep budgets in QBO rather than this app). It isn't:
QBO's Budget API (`BudgetDetail`: `budgetDate`, `amount`, `accountRef`,
`customerRef`, `classRef`, `departmentRef` — confirmed via Intuit's SDK
reference) returns a flat list with no hierarchy field of its own: QBO's UI
renders the indented tree by joining each `BudgetDetail.accountRef` against
the separate `Account` entity's own parent/sub-account relationship,
exactly the technique this app already uses via `accounts.parent_account_id`
(see above). Since that data is already imported, [`app/pages/budget/edit.vue`](app/pages/budget/edit.vue)
sorts each category's accounts by `account_number` (which already matches
parent-before-children chart-of-accounts order — verified against the real
import, no separate tree-building pass needed) and indents each row by
walking the `parent_account_id` chain. On budget *write* access: still
unconfirmed either way (see "QBO 'sync' means export-for-reimport" above) —
this doesn't change that.

## QBO OAuth hardening — 2026-07-22

Prompted by Intuit's own "Security requirements" doc and its App assessment
questionnaire's Authorization and Authentication section (both shared by the
user), reviewed against the OAuth flow already built in
[`server/utils/qbo.ts`](server/utils/qbo.ts) and
[`server/api/qbo/`](server/api/qbo/). The questionnaire's questions turned
out to be more than a form to fill out — auditing the code against each one
surfaced real gaps, most notably a genuine CSRF vulnerability:

- **CSRF on the OAuth callback (real bug, not just a questionnaire item)**:
  `connect.get.ts` generated a `state` value but never stored it, and
  `callback.get.ts` never checked the `state` query param Intuit echoes
  back — meaning an attacker could get a victim to load a crafted callback
  URL and bind an arbitrary QBO company to this app's stored tokens. Fixed
  by storing `state` in a short-lived `httpOnly` cookie set in
  `connect.get.ts` and validated in `callback.get.ts` before any code
  exchange happens. `sameSite: 'lax'`, not `'strict'` — the callback is a
  cross-site top-level GET navigation from Intuit's domain, and `Strict`
  cookies aren't sent on those.
- **Intuit's OAuth discovery document** (the questionnaire asks directly
  whether an app uses it) now backs `authorization_endpoint` /
  `token_endpoint` / `revocation_endpoint` instead of hardcoded URLs,
  cached in-memory for 24h per environment. Falls back to the previous
  hardcoded constants if the discovery fetch itself fails, so a network
  hiccup reaching Intuit's discovery endpoint can't block login.
- **Real vs. transient auth failures are now distinguished.** `QboAuthError`
  (a 4xx from the token endpoint — bad code, `invalid_grant`, etc.) is never
  retried; network errors and 5xx responses get up to 2 retries with short
  backoff via `withRetry`. On a `QboAuthError` during token refresh, the
  dead `qbo_tokens` row is cleared (`clearTokens()`) rather than left stale.
- **"Ask the customer to reconnect" now has a real signal to hang a UI off
  of**, without a new DB column: `status.get.ts` catches
  `QboNotConnectedError` (never connected / already disconnected) and
  `QboAuthError` (refresh token died — expired, revoked, or invalid) and
  returns `{ connected: false, reason: 'not_connected' | 'reconnect_required' }`
  instead of a raw 500. "No `qbo_tokens` row" was already the
  not-connected signal; clearing it on `QboAuthError` collapses the
  expired/invalid-refresh-token case into that same signal rather than
  adding new state to track.
- **`qboFetch`** (`server/utils/qbo.ts`) wraps actual QBO API calls: if a
  token dies between the proactive expiry check and the request itself
  (clock drift, early revocation), it forces one refresh and retries once
  before giving up. Replaces the near-identical fetch blocks that used to
  live separately in `status.get.ts` and `pl-report.get.ts`.

## QBO error handling — 2026-07-23

Same questionnaire, its Error Handling section — reviewed after reconnecting
a real sandbox company (Intuit's OAuth consent screen requires the user's
own login, so this step needed the user to sign in; the app-side plumbing
that followed was done as usual). Auditing against these questions live,
not just by reading the code, surfaced a real bug:

- **QBO's Reports API can return HTTP 200 with an error body** — verified
  directly against the sandbox: an intentionally malformed report date
  (`start_date=not-a-date`) came back as `200 OK` with
  `{ "Fault": { "type": "SystemFault", ... } }` in the JSON, not a 4xx/5xx.
  The existing `!res.ok` check in `pl-report.get.ts`/`status.get.ts` missed
  this entirely — a malformed request would have silently returned the
  Fault object to the caller as if it were a valid report. Fixed with
  `qboFaultType()` (`server/utils/qbo.ts`): both routes now check
  `!res.ok || qboFaultType(body)`, and `logAndWrapQboError` reports a
  Fault-with-2xx as a 502 rather than passing QBO's misleading 200 through.
  A genuinely valid request was re-verified afterward to confirm no
  regression.
- **`intuit_tid` (Intuit's own request-tracing header, which their support
  team asks for when troubleshooting) is now captured on every QBO API
  call** via `qboFetch`, and included in both the server-side log line and
  the `data` field of any thrown error, so it's available to hand to
  support without needing to reproduce the failure.
- **Structured error logging**: `logAndWrapQboError` logs every QBO API
  failure (`intuit_tid`, endpoint, status, fault type, response body) via
  `console.error` — captured by Fly's log platform (`fly logs`) for the
  deployed app, which is the "mechanism for storing error info that can be
  shared for troubleshooting" the questionnaire asks about. No new log
  storage was built — the platform's own log aggregation already covers
  this, and a bespoke log table would be solving an already-solved problem.
- **In-app support contact**: the shared tab nav
  ([`app/layouts/default.vue`](app/layouts/default.vue)) had no link to the
  Contact info that already existed on `privacy.vue`/`terms.vue` — someone
  using the actual dashboard had no way to find it. Added a footer with
  Contact/Privacy/Terms links to the shared layout so it's reachable from
  every tab.

## Cloudflare Access — 2026-07-23, live in production

Prompted by the security questionnaire's "does your app use multi-factor
authentication?" (answered "No" — the deployed app only had one shared
Basic Auth password). Per-person login was already a standing to-do (the
user found the shared password annoying) — this closes both at once. Fully
rolled out and verified: kmiller logged in via `pulse.urbanhearth.net`
with a real one-time-PIN email and landed in the app with no Basic Auth
prompt; the raw `restaurant-pulse.fly.dev` backstop still works.

**Design**: `server/middleware/auth.ts` now branches on the request's
`Host` header. The custom domain (`pulse.urbanhearth.net`, carved out from
the user's existing `urbanhearth.net` — their business website's own DNS
records are untouched) is gated by Cloudflare Access at the edge, using
email one-time-code login so kmiller and his wife each get their own
credential instead of a shared password. Everything else — notably the raw
`restaurant-pulse.fly.dev` hostname, which stays publicly resolvable
because Fly owns that DNS zone, not the user, and would otherwise bypass
Cloudflare entirely — keeps the original shared Basic Auth as a backstop,
per the user's explicit choice over blocking that hostname outright.

**Why the app also verifies the Cloudflare Access JWT, not just the
hostname**: Fly apps are reachable directly by IP, not only through
whatever proxy sits in front of the friendly hostname. If the app trusted
`Host: pulse.urbanhearth.net` alone, a request that spoofed that header
while hitting the origin's IP directly would skip Cloudflare — and thus
Access — entirely. So `checkCloudflareAccess` verifies the signed
`Cf-Access-Jwt-Assertion` header against Cloudflare's public JWKS
(`https://<team-domain>/cdn-cgi/access/certs`, via the `jose` package)
before trusting the request, rather than trusting the Host header alone.
If Cloudflare Access isn't configured (`CLOUDFLARE_ACCESS_HOSTNAME` /
`_TEAM_DOMAIN` / `_AUD` unset), this whole path is a no-op and every
request uses Basic Auth — unchanged from before this section.

**Manual setup (can't be done from this codebase — needs the user's own
Cloudflare login)**. Simpler than it first looked: `urbanhearth.net` is
already on Cloudflare's nameservers (confirmed via `dig` — already proxied
for the live business site and root→www redirect, with Google Workspace
handling mail), and the user has their own login to that account. So there's
no nameserver migration or record re-import — just one new record added to
an existing zone, isolated from the site's own root/www/MX records:
1. Add a new DNS record: `pulse` → CNAME → `restaurant-pulse.fly.dev`,
   proxied ("Proxied" / orange cloud).
2. `fly certs add pulse.urbanhearth.net` (Fly CLI, already authenticated
   locally) once the CNAME resolves, so Fly issues a TLS cert for it. If
   Let's Encrypt's validation can't complete while Cloudflare is proxying,
   temporarily flip that one record to "DNS only," let the cert issue, then
   flip it back to "Proxied."
3. In the Cloudflare dashboard, go to Zero Trust → Access → Applications,
   add an application for `pulse.urbanhearth.net`, add "One-time PIN" as
   the login method, and add a policy allowing exactly the two email
   addresses (kmiller's and his wife's). Add a second, unauthenticated
   bypass policy scoped to the `/privacy` and `/terms` paths, matching the
   existing `PUBLIC_PATHS` exception in `auth.ts`.
4. From that Access application's Overview tab, copy the **Application
   Audience (AUD) Tag**, and from Zero Trust → Settings → Custom Pages (or
   the org overview), the **team domain** (`<team-name>.cloudflareaccess.com`).
   Set `CLOUDFLARE_ACCESS_HOSTNAME=pulse.urbanhearth.net`,
   `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, and `CLOUDFLARE_ACCESS_AUD` as Fly
   secrets (`fly secrets set ...`), matching how `BASIC_AUTH_USER` etc. are
   already deployed.

**Real bug hit during rollout, worth remembering**: setting only the plain
`CLOUDFLARE_ACCESS_*` secret names deployed successfully but silently did
nothing — every request, including a real authenticated one, fell through
to the Basic Auth backstop. Cause: `nuxt.config.ts`'s
`process.env.CLOUDFLARE_ACCESS_HOSTNAME` (etc.) reads happen at **build
time**, inside the Docker build, before Fly secrets are attached to the
running container — so it always bakes in `undefined` as the default.
`BASIC_AUTH_USER`/`QBO_CLIENT_ID` already worked around this (an earlier,
undocumented fix) by *also* setting a `NUXT_`-prefixed twin of each secret
(e.g. `NUXT_BASIC_AUTH_USER`), which Nitro's own runtime config layer picks
up fresh at actual container runtime, overriding the frozen build-time
default. The new Cloudflare Access secrets were missing that twin. Fixed
by additionally setting `NUXT_CLOUDFLARE_ACCESS_HOSTNAME` /
`_TEAM_DOMAIN` / `_AUD`. **Any future runtimeConfig key sourced from
`process.env` needs both the plain and `NUXT_`-prefixed secret set on
Fly**, or it'll silently read as unset in production despite working fine
in local dev (where `.env.local` is loaded directly, sidestepping this
build-vs-runtime split entirely). Also added logging to
`checkCloudflareAccess`'s failure paths (`server/middleware/auth.ts`) —
it threw with no console output at all before, which is exactly what made
this bug hard to diagnose from `fly logs`.

## QBO Account + P&L sync — 2026-07-23

Closes the two gaps the Budget tab's "Not yet done" list had flagged since
2026-07-22: `accounts.qbo_account_id` was NULL on every xlsx-seeded row, and
nothing populated `daily_line_items` from QBO. Prompted by the user
clarifying that Urban Hearth has been open for years — just at a different
location before the 2026 move — so real multi-year history exists in QBO to
backfill, not just a gap that resolves itself once a sync starts running
forward.

- **QBO Account sync** (`server/utils/qbo-account-sync.ts`) — fetches the
  real chart of accounts (`SELECT * FROM Account`, QBO's Query API — new
  ground, nothing in this repo called it before) and matches each P&L-type
  account (`AccountType` in `Income`/`Cost of Goods Sold`/`Expense`/
  `Other Income`/`Other Expense`) to a local `accounts` row by
  `qbo_account_id` first, then `account_number`. Unmatched accounts are
  inserted, auto-categorized by a heuristic that mirrors
  `scripts/import-budget-xlsx.mjs`'s first-pass rule exactly (same
  `FIXED_OPEX_TOPLEVEL` set, same Food/Beverage/Other COGS keyword match,
  same "walk to the top-level ancestor, check if it's named Labor" split)
  but driven by QBO's own `AccountType`/`ParentRef` instead of xlsx
  indentation. `is_owner_compensation` is always inserted `0` — stays
  hand-set, per the Budget tab section above. Accounts QBO no longer
  returns (or returns inactive) get `is_active=0`; never deleted. Only
  actual state changes are written/counted (not every already-matched
  account on every run), so `rows_synced` stays a meaningful number instead
  of the full account count every single night.
- **Real gotcha caught by verifying against the live sandbox before
  writing the parser** (per the user's own instinct to check rather than
  assume): QBO's `AccountType` values are **not** the camelCase-no-space
  form `CostOfGoodsSold`/`OtherIncome`/`OtherExpense` — they're
  `"Cost of Goods Sold"`, `"Other Income"`, `"Other Expense"`, with spaces
  (`"Income"`/`"Expense"` happen to look the same either way, which would
  have masked this in a spot-check of just those two). Confirmed via a
  temporary inspection route hitting the live sandbox connection, same
  disposable pattern as the one below — trusting the assumed enum strings
  would have silently dropped every COGS and Other account from the sync.
- **P&L ingestion** (`server/utils/qbo-pl-sync.ts` +
  `server/utils/qbo-pl-parse.mjs`) — pulls `ProfitAndLoss`
  (`summarize_column_by=Days`), matches each report row to a local account
  via the row's own `ColData[0].id` (confirmed live: every real Data row
  carries this), and upserts into `daily_line_items`. The parsing logic
  lives in a dependency-free `.mjs` file (not `.ts`) specifically so the
  standalone backfill script below can `import` it directly via plain
  `node` — the production Docker image is `node:22-bookworm-slim`, and
  Node 22 doesn't reliably strip TypeScript without a build step. Another
  live-verified gotcha: the report's trailing "Total" column has no
  `StartDate`/`EndDate` in its `MetaData` at all (only `ColKey: "total"`) —
  recognized and skipped explicitly rather than either crashing on it or
  (worse) silently upserting a bogus day.
- **`runNightlySync()`** (`server/utils/qbo-sync-runner.ts`) always runs
  the account sync before the P&L pull, so a brand-new QBO account has a
  local row to match against before its own transactions are processed.
  Writes `sync_runs` (`running` → `success`/`error`), which nothing in the
  codebase touched before this. Guarded against overlap by a simple
  in-memory flag — sufficient given `fly.toml`'s single always-on machine.
- **Nightly trigger is in-process, not external cron**
  (`server/plugins/qbo-nightly-sync.ts`) — this app has no cron
  infrastructure at all (no node-cron dependency, no Fly scheduled
  machine), but `fly.toml` already runs with `min_machines_running=1` /
  `auto_stop_machines=false`, so a plain `setInterval` inside the
  already-always-on Nitro process is simpler than adding new infra. Uses
  `Intl.DateTimeFormat` with an IANA zone (`America/New_York`, Urban
  Hearth's actual location, confirmed with the user rather than guessed —
  the container's own clock is UTC) to decide "past 3:04am local," matching
  the sample time already in `useSyncStatus()`. Also fires once at boot
  (covers a redeploy that straddled the target time) — `POST /api/qbo/sync`
  triggers the identical function manually, both going through the same
  `runNightlySync()` so there's exactly one definition of what a sync run
  does.
- **Historical backfill is a separate standalone script**
  (`scripts/backfill-qbo-pl.mjs`, `npm run db:backfill-pl`), not the
  nightly job — chunked month-by-month (a multi-year
  `summarize_column_by=Days` request in one call isn't reliable), defaults
  to 2 years back, idempotent so an interrupted run can just be re-invoked.
  Deliberately duplicates (does not import) a small OAuth/fetch helper from
  `server/utils/qbo.ts`, for the same Node-22-can't-run-TypeScript reason
  as the parser module above — keep it in sync by hand if `qbo.ts` changes.
  Deliberately does **not** write `sync_runs` — that table's whole purpose
  is nightly-freshness tracking for the "last synced" UI signal, and a
  one-time bulk load's `rows_synced` (tens of thousands of rows) would
  misrepresent that if a future query ever just does
  `ORDER BY started_at DESC LIMIT 1`. Progress goes to `console.log`
  instead, matching `import-budget-xlsx.mjs`'s style.
- **Verified against the live sandbox connection end-to-end** before
  shipping: account sync (70 accounts matched/inserted with sane
  categorization), P&L sync for a known day (reconciled exactly against
  the raw report), the `sync_runs` error path (temporarily disconnected via
  `/api/qbo/disconnect`, confirmed `running→error` with a real message,
  reconnected and confirmed recovery), and the backfill script's
  idempotency (re-ran an identical range, byte-identical row count/sum) and
  month-chunk boundaries. The two temporary inspection routes used for this
  (`pl-report.get.ts`, and a short-lived `account-query.get.ts` built
  alongside it) are both deleted now that the real sync is verified
  working, matching `pl-report.get.ts`'s own original header comment.
- **Still sandbox, not production** — the connected QBO token is for the
  sandbox environment. Pulling Urban Hearth's real multi-year history needs
  a production OAuth reconnect first (same manual-step pattern as the
  Cloudflare Access rollout above: needs the user's own Intuit login).
  `account_number`-based matching is also only lightly exercised so far —
  the sandbox's demo chart of accounts has no `AcctNum` set on any account
  at all, so every sandbox account landed via the "insert as new" path, not
  the "match by account_number" path real accounts will mostly take.
- **Explicitly out of scope, on purpose** — wiring the Dashboard/P&L/Budget
  pages' `sampleActuals` over to real `daily_line_items` queries. That's
  its own separate task; this pass was sync + ingestion only.

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
- `npm run db:backfill-pl -- [--since=YYYY-MM-DD] [--until=YYYY-MM-DD]` —
  one-time historical backfill of `daily_line_items` from QBO's
  ProfitAndLoss report. See QBO Account + P&L sync below. Needs an account
  sync to have run first (`qbo_account_id` populated) — the nightly
  scheduler or `POST /api/qbo/sync` does this automatically.
- `npm run dev` — all three pages are the real app now, not the static
  mockup files (which still exist under `design/` for reference)

## Not yet done

- Wiring the dashboard UI to the real schema — the Dashboard and P&L pages
  currently render the same static sample data as the approved mockups, not
  `useDb()` queries (the Budget tab is the exception — its budget numbers
  are real, only its actuals are still sample data). `daily_line_items` now
  has a real path in (see QBO Account + P&L sync below) — this is now
  purely a UI-wiring task, no longer blocked on data.
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
- [`app/pages/budget/index.vue`](app/pages/budget/index.vue) — Budget Pace + Overspending (route `/budget`)
- [`app/pages/budget/edit.vue`](app/pages/budget/edit.vue) — Edit Monthly Budget, incl. the live pace preview (route `/budget/edit`)
- [`app/composables/useBudgetData.ts`](app/composables/useBudgetData.ts) — types/constants/fetch shared by both budget pages
- [`app/layouts/default.vue`](app/layouts/default.vue) — shared tab nav
- [`app/assets/css/main.css`](app/assets/css/main.css) — shared design tokens (colors, chips, header) used by all four pages
- [`server/utils/db.ts`](server/utils/db.ts) — `useDb()` helper for server routes/API endpoints
- [`server/api/budget/`](server/api/budget/) — budget read/write, copy-actuals, and QBO export routes
- [`scripts/init-db.mjs`](scripts/init-db.mjs) — creates the SQLite file from `schema.sql`
- [`scripts/import-budget-xlsx.mjs`](scripts/import-budget-xlsx.mjs) — one-time seed of accounts + budget from a real QBO budget export
- `data/qbo-budget-template.xlsx` — sanitized export template (checked in; the real xlsx it came from is not)
