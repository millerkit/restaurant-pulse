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
- **A known simplification worth remembering — resolved 2026-07-29, see that
  section below**: `category='other'` collapsed QBO's separate "Other
  Income" and "Other Expense" report sections into one bucket, so there was
  no reliable sign to net an "other" account against revenue, and a
  brand-new `other` account couldn't be placed back into the right template
  section on export (it got appended at the very end instead). Assumed fine
  since this restaurant's Other Income/Expense accounts were assumed minor —
  that assumption turned out to be wrong (a real ~$60-70K Grant Income month
  was being silently excluded from net income), which is what prompted the
  split into `other_income`/`other_expense`.
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
- **Was sandbox-only at the time this was written; production reconnect
  completed 2026-07-29** — see the QBO production reconnect + local/prod
  account drift section below. The sandbox's demo chart of accounts had no
  `AcctNum` set on any account at all, so every sandbox account landed via
  the "insert as new" path rather than "match by account_number" — real
  accounts mostly take the latter, and that path is now exercised for real
  in production.
- **Explicitly out of scope, on purpose** — wiring the Dashboard/P&L/Budget
  pages' `sampleActuals` over to real `daily_line_items` queries. That's
  its own separate task; this pass was sync + ingestion only.

## Budget vs Actual on the Edit Budget page — 2026-07-28

Wires the Edit Budget page's account tree to real `daily_line_items`
(previous section) instead of `sampleActuals`, per-line-item, in
[`app/pages/budget/edit.vue`](app/pages/budget/edit.vue). Backed by two new
routes ([`server/api/budget/actuals.get.ts`](server/api/budget/actuals.get.ts)
for per-category year totals, used by the Live preview — Year card;
[`server/api/budget/actuals-by-account.get.ts`](server/api/budget/actuals-by-account.get.ts)
for per-account totals for one month, fetched lazily only for the selected
month — not eagerly for all 12 like `budget_targets`). Behavior differs by
whether the selected month is closed, current, or future:

- **Closed months** are fully read-only — Budget/Actual/Variance columns,
  no input boxes, no COGS-recompute banner. The old "Update this month from
  actuals" button (which overwrote a closed month's budget with its own
  actuals) was removed entirely in favor of this — overwriting would
  destroy the only thing that makes the comparison meaningful. Variance is
  actual vs. the full month's budget (100% reference).
- **The current (in-progress) month** gets "Actual (to date)", "Projected",
  and Variance columns, alongside the still-editable Budget inputs.
  Projected is a straight-line extrapolation of actual-to-date (scaled up
  by how far through the month we are); Variance compares that projection
  against the full month's budget (100% reference), not actual-to-date
  against an expected-to-date figure — revised 2026-07-28 after the user
  pointed out a straight actual-vs-expected-to-date comparison doesn't
  answer "will we land over or under budget," which the Projected column
  makes possible to compare directly instead.
- **Future months** are unchanged — plain editable Budget column, no
  actuals fetch at all (nothing to fetch).

**"How far through the month" uses Tue-Sun operating days, not calendar
days** (`monthExpectedFraction` in edit.vue) — Urban Hearth is closed
Mondays (confirmed by the user, not assumed), so a plain day-count fraction
(e.g. "16 of 31 days elapsed") overstates progress: every closed Monday
counts as elapsed time but contributes zero expected revenue or spend.
Counts operating days only, both for days-elapsed-so-far and days-in-the-
whole-month. This is day-weighted, not hour-weighted — the app has no real
per-day operating-hours data to weight by, so equal weighting across the
six operating days is the closest feasible approximation; revisit if real
hours data ever becomes available.

## QBO production reconnect + local/prod account drift — 2026-07-29

Production connected to the real Urban Hearth QBO company (production OAuth
keys, real redirect URI) — the "still sandbox" note above is now stale.
`qbo-account-sync.ts` has been running nightly against real data since the
reconnect, and production's `accounts` table (220 rows, all with
`qbo_account_id` populated) now reflects the true chart of accounts.

This surfaced two real bugs, both found by trying to write the same set of
budget numbers to local dev and production and comparing results:

- **Local dev and production `accounts` rows had drifted apart, silently.**
  Local was seeded once from a QBO budget xlsx export
  (`scripts/import-budget-xlsx.mjs`) and never touched again; production's
  table has been rebuilt by the live nightly sync since the reconnect.
  Same account names ended up at completely different `id`s in each
  database — e.g. local `id=91` was "Wine Director" while production
  `id=91` was "Employer Group Dental Insurance Expense". A one-off SQL
  script that hardcoded local account `id`s and ran it against production
  wrote wage-shaped budget numbers onto the wrong production accounts
  before this was caught; it was reverted from an on-volume backup taken
  seconds earlier, and the machine was restarted to drop any in-memory
  state from the bad write. No lasting production impact, but the
  takeaway is durable: **never key a script touching `accounts` or
  `budget_targets` on raw `id` across environments — always match by
  `account_number` or `qbo_account_id`.**
- **The nightly sync's boot-time catch-up re-synced on every restart, not
  just a missed window.** `server/plugins/qbo-nightly-sync.ts` only
  tracked "already ran today" in an in-process variable that resets to
  `null` on every restart, so a plain `fly apps restart` (used to recover
  from the incident above) triggered a redundant extra sync. Fixed by
  having the boot check also consult `sync_runs` (which survives
  restarts) before firing — `alreadySucceededToday()` in that file.

Local dev still can't hold its own connection to Urban Hearth's *production*
QBO company — Intuit's production OAuth keys only accept a public HTTPS
redirect URI, so `localhost` was never going to be a viable target for
those, independent of any of the above. **It can and does hold a working
connection to Intuit's sandbox company, though** — a real login, just to a
different, unrelated business (Intuit's own demo data, historically a
landscaping company), not "no connection at all." See "Local dev QBO sync
guard" below for why that distinction matters and what it broke.

Instead, for a real chart of accounts locally, **`npm run db:pull-accounts`**
(`scripts/pull-accounts-from-prod.mjs`)
does a one-way, on-demand pull of just the `accounts` table from the
production Fly volume into local dev over `fly ssh console` (the container
image has no `sqlite3` CLI, so it shells out to a small script using the
app's own `better-sqlite3` dependency, same technique used to diagnose and
repair the incident above). Matches remote to local by `qbo_account_id`
first, `account_number` second, same precedence as `qbo-account-sync.ts`
itself; never touches `budget_targets`/`daily_line_items` (both key off the
local `id`, which existing rows keep); never overwrites
`is_owner_compensation` (hand-set locally, not sourced from QBO); never
deletes, only deactivates a local row whose `qbo_account_id` disappears
from the remote dump.

**A first version of this script re-created the exact bug it was meant to
prevent**, on local dev this time: `findByAccountNumber` didn't restrict to
active rows, so a handful of pre-existing local duplicate-account-number
situations (same root cause as the local/prod drift above, apparently from
an earlier stray import or partial sync attempt — 22 pairs found, one of
them the Wine Director/Tip Wages pair from earlier this session) let the
match land on an already-deactivated empty duplicate instead of the active
row holding real budget/actuals history, silently creating a second active
row per pair. Caught by checking for duplicate active `account_number`s
after running it, before trusting the result. Fixed two ways: the match
query now requires `is_active = 1`, and if more than one active row still
matches an account_number (should no longer happen, but not assumed), the
script skips the auto-match, inserts the remote account as new, and prints
an explicit warning listing the candidate ids for manual review, rather
than picking one silently. The script also prints a warning if any
duplicate active `account_number`s remain after it runs, as a standing
safety net. The 22 pre-existing local duplicates from this run were
resolved by hand (keep whichever row had real `budget_targets`/
`daily_line_items` history, or — where neither side had history — whichever
already carried a `qbo_account_id`; deactivate the other, transferring its
`qbo_account_id` onto the kept row first if needed).

## Splitting 'other' into other_income/other_expense — 2026-07-29

Closes a real gap flagged while wiring the Budget Pace page off real actuals
(previous section): net income everywhere in the app was silently excluding
`category='other'` entirely (the "known simplification" flagged 2026-07-22,
assumed minor). It wasn't minor — June 2026 actual/budgeted `other` is
~$60-70K, almost all "Grant Income," which means Year-to-date net income was
understating the true bottom line by roughly $70K. Verified directly against
the real `accounts` table: `other` was mixing genuinely income-shaped
accounts (Grant Income, Insurance Proceeds, Gain on Asset Sale, Interest
Income, Credit card rewards, Misc Refunds & Credits, Cancellation of Debt
Income) with expense-shaped ones (Depreciation, Penalties & Settlements,
Reconciliation Discrepancies, Miscellaneous) with no sign to tell them apart
— exactly the risk the 2026-07-22 note called out.

The fix needed no new heuristic: QBO's own `AccountType` ("Other Income" vs.
"Other Expense") was already being fetched by `qbo-account-sync.ts` and
`import-budget-xlsx.mjs`'s section headers — both scripts were just
collapsing that distinction into one `category='other'` value instead of
keeping it. `accounts.category`'s CHECK constraint now allows
`other_income`/`other_expense` instead of `other`; both scripts assign the
correct one directly from QBO's own signal, so no name-based guessing is
needed for any *future* account. `netIncome()` (`useBudgetData.ts`) is now
`revenue - cogs - labor - opex + other_income - other_expense`, with
`other_income`/`other_expense` optional (default 0) so the Dashboard/P&L
pages' still-sample-data callers don't need to pass them. `CATEGORY_DIRECTION`
now covers all six categories (other_income: higher-is-better, other_expense:
higher-is-worse) — the Edit Budget page's per-row variance coloring
(`budgetActualVariance`) no longer needs a neutral carve-out for `other`,
since both new categories have a real direction like everything else.

**Existing `other` rows were migrated by hand, not re-derived from QBO**:
`scripts/migrate-other-categories.mjs` rebuilds the `accounts` table (SQLite
can't `ALTER` a CHECK constraint in place — rename, recreate with the new
constraint, copy rows, drop old) and reclassifies the ~19 existing `other`
rows using a fixed, hand-verified name list (there's no stored QBO
`AccountType` to re-derive it from after the fact). Idempotent — checks
`sqlite_master`'s stored CHECK constraint text before doing anything. Run
via `npm run db:migrate-other-categories`; verified against local dev
(295 accounts, 0 orphaned `parent_account_id`/`budget_targets`/
`daily_line_items` references after migration) before being run against
production.

The Budget Pace page (`app/pages/budget/index.vue`) surfaces this
transparently rather than adding a new pace card: since `other_income`/
`other_expense` are now already folded into the Net Income figure via
`netIncome()`, a small note under it shows the net other amount only when
it's actually nonzero ("Includes net $X in other income/expense..."),
without cluttering the four existing Revenue/COGS/Labor/Opex cards. The
Overspending drill-down and pace cards deliberately still only cover
cogs/labor/opex — other income/expense isn't a "spending pace" concept the
same way. The Edit Budget page's account tree, by contrast, now shows
"Other Income" and "Other Expense" as two ordinary expandable category
sections (same generic `CATEGORIES`-driven rendering every other category
already used) — real editable budget line items, not just a rolled-up net
figure.

`server/api/budget/export.get.ts`'s QBO export could now, in principle,
place a brand-new `other_income`/`other_expense` account into the correct
template section instead of always appending at the very end — deliberately
not built, since doing that would mean inserting a row mid-sheet and
shifting every row below it, risking the template's own formulas, for what
in practice is a rare edge case (only affects an account added to QBO after
the template was last captured). Left as documented, with the user able to
reposition the row in Excel if it matters to them.

## Toast POS integration — covers and sales/labor-hour — 2026-07-30

Closes the last real gap in the Dashboard's guest-economics row (covers,
average check, sales/labor-hour), which had been sample constants pending a
Toast connection (see `scripts/toast-scope-check.mjs`, deleted now that its
question is answered — the credentials already provisioned for Urban
Hearth's e-commerce site do have Orders and Labor API scope; only the
Employees API is forbidden, and it isn't needed here).

- **Two new real numbers, one new table.** `daily_toast_metrics` (`date`
  PK, `covers`, `labor_hours`, `synced_at`) is deliberately its own table,
  not folded into `daily_line_items` — these are POS-sourced counts with no
  `accounts` row to join against, not GL amounts. Revenue for average check
  still comes from QBO (`daily_line_items`), not Toast — Toast is a
  guest-count/labor-hours source only, not a second revenue feed.
- **`numberOfGuests` lives on the order, not the check** — a real gotcha
  caught by pulling one live day's data before writing the sync (same
  discipline as the QBO `AccountType` string-format check): every check's
  own `numberOfGuests` came back `null` for this restaurant (spot-checked
  against 2026-07-29, 36 checks, 0 with a value), while the *order* object
  that owns those checks had a reliable non-null `numberOfGuests` on all 34
  non-deleted orders that day (summing to 74 covers). `covers` is the sum
  of each non-deleted order's `numberOfGuests`.
- **Labor hours use Toast's own `regularHours`/`overtimeHours` fields on
  each time entry**, not a manual `outDate - inDate` diff — Toast already
  accounts for breaks and rounding in those fields (verified the two
  methods roughly agree, but the computed fields are the more correct
  source of truth, not something this app should re-derive).
- **Auth is a machine-client login, much simpler than QBO's OAuth**
  (`server/utils/toast.ts`): client id/secret in, a short-lived bearer
  token out, cached in memory (no persisted token row — there's no
  refresh-token rotation the way QBO has). Mirrors `qbo.ts`'s retry/error
  patterns (`ToastAuthError` for real 4xx auth failures, transient 5xx
  retried) at a smaller scale.
- **Folded into the same nightly run as QBO**
  (`server/utils/qbo-sync-runner.ts`), not a second scheduler — one
  `sync_runs` row and one "as of" freshness signal for the whole dashboard.
  Only runs if all four `TOAST_*` env vars are set, so an environment
  without Toast configured (e.g. a fresh local dev checkout) doesn't fail
  the QBO half of the sync.
- **Dashboard falls back cleanly when a date hasn't synced yet** — verified
  by testing both states directly against local dev: covers/average
  check/sales-per-labor-hour show `—` with a "Toast data hasn't synced for
  \<date\> yet" note (not a zero, which would misreport), and go back to
  real numbers once `daily_toast_metrics` has that date's row.
- **Historical backfill** (`scripts/backfill-toast-metrics.mjs`,
  `npm run db:backfill-toast`, added 2026-07-30) — same idempotent,
  resumable shape as `scripts/backfill-qbo-pl.mjs`, but chunked one
  business date at a time rather than by month: Toast's `ordersBulk`/
  `timeEntries` endpoints only take a single `businessDate`, unlike QBO's
  Reports API which accepts a date range directly. Tracks the longest run
  of consecutive "no orders, no time entries" days and flags it in the
  final summary (at 14+ days) rather than silently writing what might be a
  meaningless zero — a day with genuinely nothing from Toast could mean a
  real closed day (Urban Hearth is closed Mondays) or a day before this
  Toast account/location had any data at all, and the API response looks
  identical either way. **Only needs to go back to 2026-06-20** — the
  opening day at the new location, confirmed by the user rather than
  defaulting to the script's generic 2-year lookback (which would have
  reached back into the old location's data, or before this Toast account
  existed at all).
- **Production is fully live as of 2026-07-30**: `TOAST_*` and
  `NUXT_TOAST_*` Fly secrets set, code deployed, `daily_toast_metrics`
  table added to the production volume via `fly ssh console` ahead of the
  deploy (schema changes to an existing volume aren't picked up by
  `fly deploy` itself — same manual-migration posture as
  `scripts/migrate-other-categories.mjs`). Verified three ways: a manual
  `POST /api/qbo/sync` returned a real `toastResult` (`covers: 74,
  laborHours: 151.57` for 2026-07-29, matching the local numbers exactly);
  `/api/dashboard` served that same data back; and the historical backfill
  was re-run directly inside the production container (`fly ssh console
  -C "node scripts/backfill-toast-metrics.mjs ..."`, since the script
  resolves its db path relative to its own location and Toast's secrets
  are already in the container's environment) for 2026-06-20 through
  2026-07-29 — all 40 days matched local dev's numbers byte-for-byte,
  including the same Monday-closed pattern (near-zero covers, skeleton
  labor hours).

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
- `npm run db:backfill-toast -- [--since=YYYY-MM-DD] [--until=YYYY-MM-DD]` —
  one-time historical backfill of `daily_toast_metrics` from Toast's Orders
  and Labor APIs, one business date at a time. See Toast POS integration
  below.
- `npm run db:import-debt-schedule -- /path/to/investor_loans_v6.xlsx /path/to/Eastern_Bank_Loan_Amortization_Reference.xlsx` —
  one-time seed of `loan_schedule` from the two debt amortization
  workbooks. See Debt Service / Cash Flow tab below.
- `npm run dev` — all three pages are the real app now, not the static
  mockup files (which still exist under `design/` for reference)

## `fly deploy` warning — known benign, 2026-07-28

Every `fly deploy` prints `WARNING The app is not listening on the expected
address and will not be reachable by fly-proxy` partway through the rolling
update, then the deploy still finishes healthy every time. Investigated via
`fly logs` around an actual deploy rather than assumed away: the new machine
fully reboots (Firecracker VM restart, not just a process restart), and on
this `shared-cpu-1x`/512mb machine there's a real ~5 second gap between the
Node process starting and Nitro logging `Listening on http://[::]:3000` —
normal cold-start time (loading routes, opening the `better-sqlite3` native
binding, runtime config) on this VM size, not something
`server/plugins/qbo-nightly-sync.ts`'s boot-time catch-up check adds, since
that call is fire-and-forget (never awaited) and can't block Nitro's own
startup. Fly's very-early "is anything listening yet" check fires inside
that ~5 second window and misses it; the real health/smoke checks that
actually gate deploy success run afterward with retries and always pass —
confirmed by curling the deployed app immediately after every deploy so far,
always correct. Since `fly.toml` already keeps the machine warm 24/7
(`min_machines_running=1`, `auto_stop_machines=false`), this cold start only
ever happens during a deploy itself, never during normal operation — so
there's no user-facing availability impact to chase here. Safe to ignore.

## Net Income hero card signal overload — resolved 2026-07-30

Raised by the user 2026-07-29, viewing real production numbers: the Net
Income card (Dashboard and Budget Pace both have one) stacked up to four
simultaneous good/bad color signals on one card — actual $ (green/red by
sign), a "Behind budget"/"On pace" chip (red/green by actual-vs-budget),
projected $ (green/red by sign, Budget Pace only), and a "projected to miss
budget"/"on pace" chip (red/green by projected-vs-budget) — and a real case
surfaced where actual was positive (green) but behind budget (red chip),
reading as contradictory rather than nuanced even though each signal was
individually correct (see the Design direction section: "a month can be
profitable and still be behind budget," kept deliberately separate from the
black/red sign).

**Fix**: both dollar figures (actual and, on the Budget Pace page,
projected) now render in neutral ink (`var(--ink)`) always, dropping the
`good`/`critical` sign-based coloring entirely. The pace chip(s) — "Ahead of
pace"/"Behind pace" on the Dashboard, "On/ahead of budget"/"Behind budget"
and "on pace to hit budget"/"projected to miss budget" on the Budget Pace
page — are now the only colored signal on the card, since "are we on pace"
is the more decision-driving question for this restaurant (it's the reason
the Budget tab exists at all — see the Budget tab section above). The raw
positive/negative read is still fully available as text (the `+` prefix and
the number itself), just no longer fighting the pace chip for attention via
a second, independent color axis. Applied identically to
[`app/pages/index.vue`](app/pages/index.vue) and
[`app/pages/budget/index.vue`](app/pages/budget/index.vue) (the dead
`.figure.good`/`.figure.critical`/`.projection-line strong.good`/`.critical`
CSS rules were removed from both, not just left unused). Verified visually
in the browser on both pages after the change — the same real numbers that
prompted this (green dollar figure next to a red "Behind pace" chip) now
read as one clear headline instead of two disagreeing ones.

## Year revenue pace now seasonality-aware, not a flat calendar line — 2026-07-30

Raised by the user viewing the Dashboard's "2026 revenue" runway card
(34.7% of expected pace): does the pace calc account for months with a
much higher budgeted revenue (e.g. October)? It didn't — `yearDayFraction`
(`dayOfYear/daysInYear`) assumed revenue accrues in equal daily slices
across all 12 months, comparing actual-to-date against a flat share of the
**annual** budget total regardless of how unevenly that total is actually
distributed across individual months.

This wasn't a hypothetical edge case for Urban Hearth specifically: the
real monthly revenue budgets jump from ~$75-104K/month (Jan-Jun, the old,
smaller location) to $263K-$320K/month (Jul onward, the new space) — the
flat line was judging July 28 against 57.3% of the *annual* total, which
bakes in six months' worth of small-location revenue as if it were spread
evenly, understating how far ahead the new-location months should already
be pulling the pace. **Fixed**: `server/api/dashboard.get.ts` now also
returns `yearToDate.monthlyRevenueBudget` (a 12-entry array from
`budget_targets`, `null` for an unbudgeted month). The client
(`app/pages/index.vue`'s `yearExpectedRevenueToDate`) sums each
fully-elapsed month's own budget plus a pro-rated slice of the current
month (same elapsed-days-in-month logic the month view already used) to
get a true cumulative-budget-through-today figure, and the year view's
`expectedPct` is now this cumulative figure ÷ the annual total, instead of
the flat day fraction. October's higher budget still isn't counted as
"expected" until October actually arrives — it only changes what counts as
expected *before* then, which is the point: a seasonally back-loaded annual
number shouldn't make the middle of the year look artificially further
behind than it really is. Verified against real local data: this changed
the year card from "34.7% of expected pace" to "54.9%" — matching a
hand-calculated check (cumulative expected revenue through Jul 28 ≈
$767,494 vs. the old flat-line's ≈$1,215,297) — a materially fairer number,
not just a rounding difference. The month view was untouched — it already
compares against that single month's own budget, so it never had this
flattening problem to begin with.

**Extended to the Budget Pace page's year view same day** (revenue, COGS,
labor, opex all four — not just revenue, since none of the four escape the
same flat-day-fraction assumption there). No server change needed here:
`useBudgetYear()` already fetches every month's own per-account budget via
`/api/budget/targets` for the Edit Budget page's account tree, so
[`app/pages/budget/index.vue`](app/pages/budget/index.vue)'s new
`yearExpectedToDate` computed builds the same cumulative-through-today
figure entirely from data already on the client (`categoryTotalsFor` over
the already-elapsed months, plus a pro-rated current month) — no new API
route. `expectedAmountFor(cat, budget)` replaces the flat
`periodDayFraction`-based expected amount in both `paceCards` (the runway
bars + status chips) and `overspendingCategories` (the "$X over expected
pace" figures), for the year view only — month view is untouched, same
reasoning as the Dashboard fix. Verified against real local data down to
the dollar: Opex's "$60,208 over expected pace" and COGS's "$76,106 over
expected pace" both matched a hand-calculation built directly from
`/api/budget/targets`'s raw monthly figures. One real gotcha hit while
verifying: this page's `asOfMonth`/`asOfDay` (`currentAsOfMonth()`/
`currentAsOfDay()` in `useBudgetData.ts`) are the real wall-clock date, not
the Dashboard's last-synced-data date — those two "as of" dates can
genuinely differ (Jul 30 real-world vs. Jul 28 last sync in this session)
and a verification calc using the wrong one was off by ~$750 before
switching to the right one, which is a mismatch between two *already*
intentionally-different "as of" concepts (see `currentAsOfMonth`'s own
comment), not a bug introduced by this fix.

## Debt Service / Cash Flow tab — 2026-07-30

Added after the user shared a "Debt Service & Budget Brief" (10 loans: an
SBA loan via Eastern Bank plus 9 investor notes) explaining that QBO's P&L
has no line for loan *principal* at all — a payment's principal portion
reduces a balance-sheet liability, not an expense account — so even a
budget that correctly includes loan interest (account 7020) still misses
roughly $15,154/month of real cash going out once this restaurant's loans
reach steady state (Jan 2027+), plus a one-time ~$50,562.50 catch-up
interest payment due Dec 20, 2026 and a $2,200/week reserve-transfer plan
funding it. The brief's own Section 7 ("Recommended App Structure: Two
Parallel Views") proposed exactly the fix built here: a P&L view (existing
budget/actuals, interest only) alongside a new Cash Flow view covering full
debt service, with `Free Cash Flow = Net Income + Depreciation − Principal
− Catch-Up Payments − Reserve Transfers`.

- **`loan_schedule`** (schema.sql) is a new table — one row per loan per
  payment date (including each loan's one-time catch-up-interest row),
  with the real principal/interest split. Imported once via
  `npm run db:import-debt-schedule -- /path/to/investor_loans_v6.xlsx
  /path/to/Eastern_Bank_Loan_Amortization_Reference.xlsx`
  (`scripts/import-debt-schedule.mjs`) — neither source file is checked in,
  same posture as the real budget xlsx `scripts/import-budget-xlsx.mjs`
  reads from. Verified against the brief's own summary figures after
  import (e.g. Dec 20, 2026 total due: $61,693.48; Jan 2027+ steady-state
  monthly total: $22,783.98) — exact matches.
- **`loan_key` is a plain slug ('sba', 'chen', 'savage', ...), not a QBO
  liability account number** — a real data conflict was caught while
  building this: the brief's own Section 1 cites the SBA loan's QBO account
  as "2740," but 2740 is actually the investor Price loan's real account
  (confirmed against the investor workbook's own "DR 2740 NP ..." QBO Entry
  Notes column). Rather than guess which citation is right, `loan_schedule`
  sidesteps the ambiguity entirely — the real SBA sub-account number is
  still unconfirmed (see Not yet done).
- **The reserve transfer target ($50,562.50) is computed, not hardcoded** —
  it's the sum of catch-up interest across the 7 original investor loans
  only (`server/api/cashflow.get.ts`), excluding Jones & Miller's separate,
  smaller Aug 2026 catch-up, which the brief's reserve plan doesn't fund.
  Verified this sums to exactly $50,562.50 against the imported schedule.
  The weekly $2,200 transfer schedule itself (every Monday, Jul 13 – Dec
  14 2026, 23 transfers) is a fixed plan from the brief with no
  corresponding source-of-truth table to derive it from, so it's a
  constant in `cashflow.get.ts` — there's no bank-feed signal yet to know
  whether a given week's transfer actually happened, so "transfers done"
  is inferred from today's date being on/after the scheduled date, not a
  confirmed bank transaction.
- **Free Cash Flow caps both sides at today, including for the Year view**
  — a real bug caught before shipping: the Year view's debt service was
  originally summed across the *entire* calendar year (including,
  e.g., the Dec 20 catch-up), while actual Net Income only ever covers
  Jan–today. Subtracting full-year scheduled debt from a partial-year Net
  Income understated cash position for months that hadn't happened yet.
  Fixed by capping both the actuals query and the debt-service sum at
  `min(periodEnd, today)` for both Month and Year views — the Year toggle
  now reads "year-to-date" rather than implying a full-year total.
- **The P&L table's "Loan interest" row uses the real posted 7020 actual,
  not the amortization schedule's computed figure** — another real
  discrepancy caught while verifying: local `daily_line_items` already had
  ~$8,006 and ~$6,160 posted to account 7020 in May and June 2026,
  *before* any of these 10 loans' first payment dates (SBA's first payment
  is Jul 12; every investor loan's first payment is Aug or Dec). That
  account evidently also carries interest from debt outside the scope of
  this brief (plausibly the prior location, before the 2026 move). The P&L
  column therefore queries real `daily_line_items` for account 7020
  directly; the Cash Flow column uses `loan_schedule`'s computed figure
  (the source of truth for actual cash obligations regardless of how
  QBO's books currently reflect it) — shown side by side rather than
  silently picking one, with a note under the table.
- **Nightly sync untouched** — `loan_schedule` is a static one-time import,
  not part of `runNightlySync()`. There's no live source for it to sync
  from (it's not QBO report data); a change to the actual loan terms would
  need a re-run of `db:import-debt-schedule` by hand.
- **Production rollout, 2026-07-31**: `loan_schedule` was created on the
  production volume by hand via `fly ssh console` (same manual-migration
  posture as `daily_toast_metrics` — schema changes to an existing volume
  aren't picked up by `fly deploy` itself). The two source xlsx files were
  uploaded to `/app/data/` via `fly ssh sftp put` just long enough to run
  `db:import-debt-schedule` against them, then deleted from the volume
  immediately after — same "neither source file stays anywhere but the
  imported DB rows" posture as the real budget xlsx. Verified: 663 rows
  across the same 10 loans as local dev, byte-identical totals for every
  spot-checked payment date (e.g. Dec 20, 2026: $61,693.48; reserve
  target: exactly $50,562.50), and a live `/api/cashflow` + `/cashflow`
  request against production both returned 200 with real numbers.

## Reserve transfers are real data, not a schedule assumption — 2026-07-31

The reserve savings section originally assumed every planned Monday
transfer happened at a fixed $2,200/week (Jul 13 – Dec 14 2026, per the
source brief's Section 6). The user reported this was wrong on two counts:
the Jul 13 and Jul 20 transfers were both reversed the same week (the money
was needed for bills), and the weekly amount itself changed to $2,500
starting Jul 27 — so the app's "3 transfers × $2,200 = $6,600 saved" was
overstating reality by $4,100 (actual: $2,500, from the one surviving
Jul 27 transfer). There's no bank feed to detect any of this, so a fixed-
schedule assumption was never going to stay correct.

- **`reserve_transfers`** (schema.sql) is a new table — real, manually
  recorded transfers (and reversals, as a signed negative amount on their
  own row) into QBO's 1005 Loan Payment Reserve account. This replaces the
  old computed-from-a-constant `RESERVE_TRANSFER_DATES`/
  `RESERVE_WEEKLY_AMOUNT` logic in `server/api/cashflow.get.ts` entirely —
  "saved" is now always `SUM(reserve_transfers.amount)`, not an assumption.
  Seeded (both local dev and production) with the real Jul history: +2200/
  -2200 on both 7/13 and 7/20 (net zero, matching the reversals), +2500 on
  7/27 — net $2,500 saved, matching what the user reported.
- **The Cash Flow tab now has a "Record a transfer" form** (date, amount,
  optional reversal checkbox, optional note) posting to the new
  `POST /api/cashflow/reserve-transfer` route — this needs updating weekly
  going forward, unlike everything else on this tab (which is either
  QBO-synced or a one-time schedule import), so a form beats another
  hand-SQL-only field like `is_owner_compensation`.
- **Reserve target widened to include Jones & Miller**, at the user's
  request while fixing this: $52,838.80 (all 10 loans' catch-up interest),
  up from the original 7-loan-only $50,562.50 — the source brief's reserve
  plan never funded Jones & Miller's separate, smaller Aug 2026 catch-up
  ($2,276.30), and the user now wants this reserve to cover it too. Still
  computed from `loan_schedule` (just without the loan_key exclusion), so
  it can't drift from the imported schedule.
- **"Current weekly amount" and the projected completion date are derived
  from the most recent transfer, not a separately hand-set config value**
  — `reserveProgress()`'s `currentWeeklyAmount` is the most recent
  *positive* transfer (a reversal doesn't reset what the ongoing plan is),
  projected forward at that rate every Monday until the target is hit. This
  is a real risk signal worth watching: at $2,500/week from here, the
  projected completion date lands one day *after* the Dec 20 catch-up is
  actually due — the reserve plan is not currently on pace to be ready in
  time at this reduced rate.
- **Not yet done**: no reconciliation against a real bank feed (this is
  still 100% manually entered) and no edit/delete UI for a mis-entered
  transfer — a wrong entry has to be corrected with an offsetting row for
  now, the same reversal mechanism used for a real reversal.

## Declared weekly reserve plan, separate from transfer history — 2026-07-31

Same day as the section above, while working out a new $4,000/week reserve
plan with the user (they're now also funding Jones & Miller's ongoing
monthly loan payments — not just their catch-up — out of the same 1005
Loan Payment Reserve account, considerably raising the weekly amount
needed). This surfaced a real gap in the design from a few hours earlier:
`currentWeeklyAmount` was inferred from the single most recent *positive*
`reserve_transfers` row, which broke the moment the user wanted to declare
a new rate ($4,000/week) *before* the next actual transfer at that rate had
happened — the most recent row at that point was a $400 top-up transfer,
which would have made the projection show $400/week instead.

- **`reserve_plan`** (schema.sql) is a new single-row table holding just the
  currently-declared weekly amount, with its own
  `POST /api/cashflow/reserve-plan` route and a small "Planned weekly
  amount" form on the Cash Flow tab, separate from "Record a transfer."
  `reserveProgress()` in `server/api/cashflow.get.ts` now prefers this
  value for `currentWeeklyAmount`/`projectedCompletionDate`, falling back
  to the old last-positive-transfer inference only if no plan has ever been
  declared. `reserve_transfers` remains the sole source of truth for
  "saved so far" — this table only feeds the forward-looking projection.
- **Real running-balance projection, built same day**: the naive
  "remaining ÷ weekly amount" projection above was replaced within hours —
  see "Real running-balance reserve projection" below.

## Real running-balance reserve projection — 2026-07-31

Closes the gap the section above flagged as "not yet done" — the naive
`remaining ÷ weeklyAmount` projection ignored the Jones & Miller draws
entirely, so it was always too optimistic once those started coming out of
the same reserve account (it showed a projected completion date of Oct 26,
when the hand-verified answer, worked out earlier the same day, was that
$53,014.60 would actually be available by Dec 15).

- **`reserveProgress()` (`server/api/cashflow.get.ts`) now simulates a real
  event timeline** — every Monday deposit at `currentWeeklyAmount` from the
  next Monday through `catchUpDate` (Dec 20, 2026, read from
  `loan_schedule` rather than hardcoded), interleaved chronologically with
  every `loan_schedule` row actually paid from this reserve account
  (`reserveFundedRows`: Jones & Miller's full schedule — catch-up and every
  regular monthly payment, since the user is funding both from here — but
  *not* the original 7 loans' regular monthly payments, which still come
  from normal operating cash). The result is `projectedBalanceAtCatchUp`,
  `onPaceForCatchUp`, and `catchUpShortfall` — verified against the exact
  by-hand figures from earlier the same day ($400 top-up + flat
  $4,000/week → $53,164.60 projected, on pace) and against a deliberately
  under-funded $2,000/week scenario (correctly flagged as $37,397.90 short).
- **`target` reverted from $52,838.80 back to $50,562.50** (7-loan-only
  catch-up) — the earlier widening to include Jones & Miller's own
  catch-up double-counted it once this simulation existed: J&M's catch-up
  is now a scheduled *withdrawal* the simulation accounts for directly
  (money passes through the account around Aug 15, it isn't held until
  December), so folding its dollar amount into a single static "keep this
  much saved" target overstated what actually needs to still be sitting in
  the account specifically on Dec 20.
- **`projectedCompletionDate` was removed rather than fixed** — with
  withdrawals interleaved, the running balance can cross above the target
  and dip back below it more than once (a real oscillation, not a bug: the
  balance passes $50,562.50 after an early December deposit, then drops
  back under it when the Dec 15 Jones & Miller payment goes out), so "the
  date it's done" doesn't have one honest answer the way it did under the
  old non-interleaved assumption. `catchUpDate` + `onPaceForCatchUp` +
  `catchUpShortfall` answer the question the user actually has ("will I be
  ready by Dec 20, and by how much") without that ambiguity.
- **Still a bounded simulation, not a general-purpose one** — it only
  models the window between today and `catchUpDate`. It doesn't project
  what happens to the account after Dec 20, when Jones & Miller's monthly
  payments keep coming out indefinitely — see "Not yet done" below.

## QBO sync catch-up range + local dev sandbox guard — 2026-07-31

Prompted by a user report that a QBO sync run in production was missing
labor costs from that same day's payroll. Two separate real bugs, found in
sequence:

- **`runNightlySync()` only ever synced a single fixed date: "yesterday."**
  (`server/utils/qbo-sync-runner.ts`) `targetDate = dateOverride ??
  isoDateNDaysAgo(1)`, then `syncPlForDateRange(targetDate, targetDate)` —
  called identically by the nightly scheduler and the manual "Sync now"
  button, every single time, regardless of how long it had actually been
  since the last successful sync. A missed night (an error, a restart, any
  gap) meant that day's data was gone for good — nothing ever looked back
  further than exactly one day to catch up. **Fixed**: `runNightlySync` now
  computes `startDate` as the day after `MAX(date)` in `daily_line_items`
  (falling back to the old single-day behavior if the table is empty) and
  `endDate` as yesterday, then syncs that whole range in one
  `syncPlForDateRange` call — Toast's own metrics sync is looped one day at
  a time across the same range, since Toast's APIs only take a single
  `businessDate`. `isoDateNDaysAgo`'s raw-UTC date math was also replaced
  with an IANA-zone-aware `localToday()` (mirroring
  `qbo-nightly-sync.ts`'s own `toLocalDateParts`), so "yesterday" can't land
  on the wrong calendar day depending on what time it is in UTC.
  `dateOverride` (an explicit single-date re-sync) still bypasses the range
  logic entirely and stays single-day, as before. One Reports API call per
  range is fine for the realistic catch-up window this covers (a missed
  night or two) — a gap of months would want
  `scripts/backfill-qbo-pl.mjs`'s month-chunked approach instead.

- **Verifying that fix against local dev corrupted the local `accounts`
  table** — the more serious finding. Local dev's QBO OAuth connection has
  always been able to reach *Intuit's sandbox company* (a real login, just
  to unrelated demo data) even though it can never reach Urban Hearth's
  real production company — a distinction the "Local dev still can't hold
  its own QBO connection" line above didn't make clear enough, and which
  led directly to this incident. Manually triggering a sync locally to test
  the range-catch-up fix ran `syncQboAccounts()` against the sandbox. QBO
  account IDs are small per-company sequential integers, so real Urban
  Hearth `qbo_account_id` values already in the local `accounts` table
  (pulled down earlier via `db:pull-accounts`) coincidentally collided with
  unrelated sandbox account IDs. The account sync's matching logic
  (`server/utils/qbo-account-sync.ts`) then overwrote real accounts'
  `name`/`account_number` with whatever sandbox account happened to share
  that numeric ID, deactivated ~197 real accounts the sandbox didn't
  recognize, and inserted sandbox-only accounts (landscaping-company line
  items — Intuit's stock sandbox demo) as brand-new local rows. This had
  already been happening across earlier local syncs that same day, before
  it was caught — not just the one test run.
- **Recovery**: `npm run db:pull-accounts` (re-matches everything against
  real production truth over `fly ssh console`), followed by hand-resolving
  22 leftover duplicate-`account_number` pairs and 6 duplicate QBO system
  accounts (Uncategorized Expense, Purchases, Reconciliation Discrepancies,
  Unapplied Cash Bill Payment Expense, Uncategorized Income, Billable
  Expense Income — these have no `account_number` at all, so
  `pull-accounts-from-prod.mjs` can't merge them automatically and
  re-inserts them fresh on every pull). Each merge was verified safe first
  (checked that no `budget_targets`/`daily_line_items` row existed only on
  the losing side of the pair) before deactivating the duplicate and
  transferring its `qbo_account_id` onto the kept row — the general
  "match by `account_number`/`qbo_account_id`, never raw `id`, never guess
  on an ambiguous match" discipline this file already documents above,
  applied by hand where the automated script's own account-number
  requirement couldn't reach. `budget_targets`/`daily_line_items` were
  never at risk from this specific failure mode — the account sync doesn't
  touch either table.
- **Guarded against a repeat, not just documented**: simulating Urban
  Hearth's real data in the sandbox isn't worth the effort, so this is a
  hard block rather than something to remember not to do.
  `runNightlySync()` now refuses to run at all — before creating a
  `sync_runs` row, before touching anything — unless
  `qbo.environment === 'production'` (`QBO_ENVIRONMENT`/
  `NUXT_QBO_ENVIRONMENT`, already set correctly in production per the
  `NUXT_`-prefix convention documented in the Cloudflare Access section
  above; defaults to `'sandbox'` everywhere else, including local dev's
  `.env.local`). Since this is the single shared entry point for both the
  nightly scheduler and the manual "Sync now" route, one check covers both.
  `server/plugins/qbo-nightly-sync.ts` also bails out on the same condition
  before its daily timer ever calls in, purely so local dev doesn't write a
  doomed `error` `sync_runs` row and log a stack trace every day at the
  scheduled sync time if `npm run dev` happens to be left running past it.
  No override flag — if the sandbox genuinely needs to be exercised on
  purpose, flip `QBO_ENVIRONMENT` locally by hand.

## Net income mismatch vs. real QuickBooks — 2026-08-05

Prompted by the user comparing production's YTD net income (+$20,040) against
a real QBO P&L export for Urban Hearth and finding it materially different.
Investigated by directly querying production's `daily_line_items` over
`fly ssh console` (same technique as the local/prod account-drift incident
above) and comparing category totals line-by-line against the real export,
rather than guessing from the net figure alone. Found four independent real
issues, only one of which turned out to be an actual bug in this app's own
number once the investigation was done:

- **Contra-revenue accounts had their sign flipped.** `qbo-pl-parse.mjs`'s
  `reportToLineItems` used to `Math.abs()` every value per schema.sql's
  original "positive magnitude, sign handled at query time" convention — but
  that convention never anticipated contra-income accounts like "4910
  Discounts & Comps," which QBO's own report already returns *negative*
  within the Income section so that summing the section nets correctly.
  Forcing it positive made a $13,593.83 deduction add to revenue instead of
  subtracting from it — a $27,410.22 swing (2x the two contra accounts'
  total) that was the entire revenue overstatement. **Fixed**: the parser
  now keeps QBO's own signed value; a normal line item is already positive
  from QBO, so this is a no-op for the common case. `schema.sql`'s
  `daily_line_items.amount` comment updated to match. Every downstream
  consumer (`dashboard.get.ts`, `pl.get.ts`, `cashflow.get.ts`,
  `budget/actuals.get.ts`, `useBudgetData.ts`) already just does
  `SUM(amount)` per category with plain addition, so nothing else needed to
  change. Corrected via a targeted re-backfill (see below).
- **Deleted/inactive QBO accounts are invisible to the account sync, so
  their historical P&L rows silently vanish.**
  `qbo-account-sync.ts`'s `SELECT * FROM Account MAXRESULTS 1000` — QBO's
  Query API only returns `Active=true` rows by default. Three real labor
  accounts (Service Charge Distribution (KA), GM Bonus, Project Manager)
  had been deactivated by the user to save QBO account-count limit
  headroom, and were absent from local `accounts` entirely — so P&L rows
  referencing their QBO account ids had nothing to match against and were
  dropped with only a `console.warn`, no visible failure ($6,780.80 of the
  labor gap). Not fixed in code this round — the user reinstated the three
  accounts directly in QBO instead (deciding it wasn't worth widening the
  account-sync query's `Active` filter given their account-count
  constraints) and a manual `POST /api/qbo/sync` + targeted backfill
  (`--accounts=`, see below) picked them up once real.
- **Switched to Cash basis**, matching how the user already reviews QBO
  reports manually — `qbo-pl-sync.ts` and `backfill-qbo-pl.mjs` now pass
  `accounting_method=Cash` (QBO defaults to Accrual when omitted, which is
  what this sync had used, unnoticed, since it was first built). This
  closed the Other Income gap exactly (a $10,000 "Grant Income" mismatch
  turned out to be pure cash/accrual timing) but had no effect on Labor —
  this restaurant's payroll postings apparently aren't accrual-adjusted in
  QBO at all (likely posted directly as cash transactions by the payroll
  processor), so Labor was identical under both bases. Also moved Opex
  *further* from the reference report at the time, which briefly looked
  like a regression — see below for why.
- **A parent account with sub-accounts can also carry its own direct
  postings, which the parser was silently dropping.** Confirmed live
  against production: a QBO report Section row (e.g. "6300 Marketing &
  Advertising," which has children like "6301 Advertising" underneath it)
  puts the parent's *own* direct-posted amount in `Header.ColData` — same
  `{value, id}` shape as a real Data row's columns — whenever something was
  posted straight to the parent instead of one of its children (confirmed
  by inspecting a real report's raw JSON via a temporary inspection
  script). `flattenDataRows` only ever recursed into `Rows.Row` collecting
  `type:"Data"` rows and completely ignored `Header`, so any parent-direct
  posting vanished whenever the parent also had child activity in the same
  period. When there's no direct posting, `Header.ColData`'s value column
  is just `""`, which already parses to 0 — so capturing it too is a no-op
  for the common case. **Fixed** in `flattenDataRows`: pushes one synthetic
  row from a Section's own `Header` (never from `Summary`, which really is
  just QBO's computed subtotal) alongside the recursion into children.
  Found and fixed four affected accounts this way (Marketing & Advertising
  $4,000, Non-Capital Equipment & Furnishings $845.37, Taxes and Licenses
  $735, Meals & Entertainment $16.31 — $5,596.68 total) plus a bonus
  catch, a −$390.30 direct correction on "Employer Payroll Taxes" that had
  also been silently dropped. This fully explained the post-cash-basis Opex
  regression: it wasn't really a regression, cash basis had just changed
  which of these already-broken parent postings coincided with child
  activity.
- **The real, final "gap" turned out to be a reporting artifact, not a data
  bug at all.** After all the above, Opex matched almost exactly but Labor
  still showed a stubborn ~$26,682 shortfall no theory above explained. The
  user then pointed out — after separately explaining that the $3,606.17
  Interest & Financing gap was a recurring SBA loan-payment journal entry
  QBO creates early as a funding reminder, ahead of its real due date — that
  the *same* mechanism explains Labor: their first QBO export used "This
  Year" (Jan 1 – Dec 31), which includes QBO's own recurring journal
  entries (payroll runs, the SBA reminder) dated ahead of when they
  actually post, not just transactions that have genuinely happened.
  Production's sync only ever pulls through yesterday, so it correctly
  excludes all of that — the mismatch was in what the comparison reference
  was, not in the app. Confirmed against a second QBO export explicitly
  scoped to "Actual YTD" (Jan 1 – Aug 5): Labor ($489,970.56) and Interest &
  Financing ($38,482.84) both matched production **exactly**, and total net
  income landed within $1,941.27 (down from the original $68,869 gap),
  almost entirely attributable to a small, low-priority COGS discrepancy
  (~0.25% of revenue) not investigated further — see Not yet done.
- **`scripts/backfill-qbo-pl.mjs` gained an `--accounts=qboAccountId1,...`
  flag**, used throughout this investigation to re-sync just a known,
  narrow set of affected accounts (by QBO account id, not local `accounts.id`
  — matching every other cross-environment script's `account_number`/
  `qbo_account_id` discipline) without touching every other account's
  already-correct rows. The ProfitAndLoss report itself always returns
  every account for a date range regardless (QBO has no per-account report
  filter) — this only scopes what gets *upserted*. General full backfills
  (no `--accounts` flag) were also re-run twice against production during
  this investigation, once after the cash-basis change and once after the
  parent-posting fix, both deployed via `fly deploy` first (the script runs
  from the deployed image, not a local checkout).
- **Diagnostic technique used throughout**: temporary read-only Node
  scripts uploaded via `fly ssh sftp shell` (`put local.js
  /app/name.cjs` — `.cjs` extension required, since `/app/package.json` has
  `"type": "module"` and plain `.js` would be parsed as ESM), executed via
  `fly ssh console -C "node /app/name.cjs"`, then deleted — same disposable
  pattern as the temporary inspection routes used to verify the original
  QBO Account + P&L sync. Used both for category/account-level SQL
  comparisons against production's live `daily_line_items` and, for the
  parent-posting bug, to fetch and inspect one real `ProfitAndLoss` report's
  raw JSON directly against the live QBO connection.

## Capacity tab — 2026-08-07

Added after the user shared a real capacity/pricing worksheet
(`Capacity-And-Per-Cover-Revenue-Projections.csv` — per-area seats, max
turns/night, seasonal nightly capacity, and assumed per-cover revenue for
the bar, salon, dining room, chef's counter, and outdoor areas) and a set
of monthly capacity-fill-% targets, asking whether real July/August data is
actually meeting the revenue assumptions the business is projecting off of.
A new top-level tab, not a section on an existing page — same reasoning as
the original Budget tab: this answers a different question (is our capacity
model correct) from the existing pages (are we on pace against a dollar
budget), even though both ultimately bear on revenue.

- **The monthly fill % applies to every dining area's own capacity
  independently, not to one blended total** — confirmed explicitly by the
  user rather than assumed: "if we fill 58% one month, that means we fill
  58% of seats across all the spaces." So expected revenue for a month is
  built per-area (`that area's own nightly capacity * this month's fill % *
  that area's own per-cover revenue`) and summed across areas, never
  `total expected covers * one blended per-cover figure` — the two are not
  interchangeable once per-area capacity/pricing differ (e.g. the chef's
  counter's $258.56/cover vs. the bar's $55). See `capacity_areas` /
  `capacity_seasonality` in [`schema.sql`](schema.sql) and the
  `nightlyExpected` function in
  [`server/api/capacity.get.ts`](server/api/capacity.get.ts).
- **Operating days = Tue–Sun (the standing Monday closure, same as every
  other pace calculation in this app) minus a flat monthly holiday-closure
  count** — 2 in January, 1 in July, 1 in November, 2 in December, per the
  user's own figures, 0 elsewhere. Deliberately a count, not specific
  calendar dates: matches the precision of `expected_pct` itself (a rough
  monthly target, not derived from a specific calendar), and the "actual"
  side of every comparison doesn't need the exact date anyway — real
  `daily_toast_metrics`/`daily_line_items` rows are simply absent or zero on
  a day the restaurant was really closed, with no adjustment required. See
  `capacity_seasonality.holiday_closures` in schema.sql.
- **Per-area capacity, turns/night, and per-cover revenue are editable in
  the app**, not a one-shot import left alone — an explicit request from
  the user, unlike the budget xlsx / debt schedule imports this pattern
  otherwise resembles. `app/pages/capacity/edit.vue` (route
  `/capacity/edit`) is a plain editable form (5 area rows + 12 month rows,
  no account-tree complexity needed at this size) backed by
  [`server/api/capacity/settings.get.ts`](server/api/capacity/settings.get.ts)
  /
  [`server/api/capacity/settings.post.ts`](server/api/capacity/settings.post.ts).
  `capacity_areas` rows are updated by id (not delete/re-insert) since
  there's no re-import expected going forward; `capacity_seasonality` is
  upserted by month (its primary key).
- **Seeded once from the real worksheet** via
  `scripts/import-capacity-projections.mjs`
  (`npm run db:import-capacity`) — same "source file not checked in, only
  the imported rows" posture as the budget xlsx / debt schedule imports
  (`data/*.csv` is gitignored); `capacity_seasonality`'s fill %s and
  holiday-closure counts came directly from the user in chat, not a file,
  so they're a hardcoded constant inside the script rather than parsed from
  anything.
- **The Capacity Pace view** (`app/pages/capacity/index.vue`, route
  `/capacity`) leads with the two months the app can actually judge right
  now — the most recently closed month and the current in-progress month
  (Actual-to-date + a straight-line Projected figure, same pattern as the
  Edit Budget page's current-month treatment) — then a full 12-month table
  for trend, plus a read-only reference table of the underlying per-area
  assumptions. Status coloring reuses the exact same good/warning/serious/
  critical `paceStatus` scale (100% of target = good, each 10pts short
  bumps a level) every other pace card in the app already uses, judged
  against revenue specifically (covers alone doesn't say whether the
  per-cover assumption held).
- **A real data-quality gap surfaced immediately on verifying against local
  data, not a bug in this feature**: June 2026 shows real revenue (from
  QBO, full month) far outpacing real covers (from Toast) — Toast's history
  only starts 2026-06-20 (the new location's opening day, per the Toast POS
  integration section above), so June's actual-covers figure only reflects
  ~10 days of real Toast data while June's actual-revenue figure covers the
  whole month. July is the first month clean on both sides. Not fixed here
  — it's a property of when Toast started tracking, not something this
  page's math can correct — but worth remembering when reading any
  pre-July comparison on this tab.
- **Buyout revenue is bookmarked, not modeled** — explicitly deferred at
  the user's own request. Urban Hearth budgets for buyout revenue (a
  private event that buys out a dining area for a guaranteed minimum, in
  exchange for reducing that month's normal service nights by one), but two
  things are unresolved: the guaranteed minimum to charge isn't settled
  (it depends on what a normal night at that capacity/fill-% would
  otherwise make — now estimable via this tab, but not yet turned into a
  number), and a buyout night's real economics (fewer regular nights,
  one bigger guaranteed night) don't fit this table's flat per-night-capacity
  model without a real design pass. See schema.sql's note above
  `capacity_areas` and "Not yet done" below.

## Capacity Pace reframed around fill %/per-cover, not revenue pace — 2026-08-07

Same day, after the user reviewed the first version and redirected it: the
initial build leaned on the same pace/projection framing as Budget
Pace/Cash Flow (dollar totals, projected month-end), but the user pointed
out that overall revenue projection is already covered by those other
tabs. What this page is actually for is narrower and more operational: is
the restaurant filling seats at the % capacity assumed, and are guests
spending the per-cover amount assumed — checked at a tighter, more
frequent grain (last week, this week, last month, this month) than the
other tabs bother with, so the user can tell whether an *assumption* needs
revising, not just whether a dollar target was hit. Renamed **Capacity
Pace** (nav: "Capacity Pace" for the view, "Capacity" for the edit page —
same asymmetric naming as "Budget Pace"/"Budget") per the user's own
choice, over "Revenue Pace" (would read as a duplicate of Budget Pace) or
"Covers & Spend" (loses the pace/goal-tracking framing that's the actual
point).

- **Fill % and per-cover $ are already rate metrics, which turned out to
  simplify the whole page** — unlike a dollar total, a partial period's
  actual-to-date ÷ capacity-to-date is already directly comparable to the
  assumed rate, with no scale-up/projection needed the way the Budget/Cash
  Flow tabs need for an in-progress month. `server/api/capacity.get.ts`
  was rewritten around this: `assumedForRange`/`actualForRange` take an
  arbitrary date range and return both sides' fill %/per-cover directly:
  for a still-in-progress period, `actualForRange` just caps the range at
  `asOfDate` and compares against `assumedForRange` computed over that
  *same* shortened range — both sides shrink together, so the ratio stays
  fair. This is also why there's no "Projected" column here the way Budget
  Pace/Edit Budget have one.
- **Four quick-look periods — last week, this week, last month, this
  month** — the day-to-day/week-to-week grain the user asked for, replacing
  the old two-card (closed month/current month) hero row. Weeks are
  Monday–Sunday (`mondayOf()` in capacity.get.ts); "this week"/"this month"
  use the same actual-to-date-vs-capacity-to-date comparison described
  above, so they're meaningful even a day or two into the period.
- **`holiday_closures` (a flat monthly count, not specific dates — see
  schema.sql) can only be subtracted precisely when a date range is exactly
  one full calendar month** (`holidayAdjustment()` in capacity.get.ts,
  called from a new shared `assumedForRange`/day-by-day
  `dayByDaySum()` helper that replaced the old month-only capacity math).
  Week-level and any partial/to-date range simply doesn't subtract a
  holiday closure, a known small imprecision (a real holiday week will
  show a slightly-overstated assumed fill %) — accepted rather than
  over-engineered, since holidays are rare (6/year) and the *actual* side
  already reflects reality regardless (a real closure shows up as zero
  actual covers that day, whether or not the "expected" side knew to skip
  it).
- **Per-cover $ is the primary, larger figure on every card; fill % is
  secondary** — a direct request ("one thing I definitely want to see is a
  quicker view of that per-cover expenditure"). Both still get their own
  delta chip (dollar delta for per-cover, percentage-point delta for fill
  %) using the same good/warning/serious/critical `paceStatus` scale as
  every other pace card in the app, judged as a ratio of actual-to-assumed
  in both cases (see `ratioStatus` in `app/pages/capacity/index.vue`).
- **The old 12-row "all months" table was replaced with Jan–Dec tabs**,
  mirroring the exact tab pattern already on the Edit Budget page
  (`app/pages/budget/edit.vue`'s `.month-tabs`) — select a month, see one
  detail card, rather than scanning a dense table for the one month that
  matters right now. A future month with no actual data yet still shows
  its assumed target (fill %, per-cover $, expected revenue) so the tab
  isn't just blank.
- **Bookmarked, not built: feeding these micro (per-cover) assumptions
  forward into the Budget tab's revenue projections**, raised by the user
  in the same conversation as a longer-term direction — potentially making
  Budget's revenue line items derived/read-only instead of manually
  entered, once this tab's fill %/per-cover assumptions are trusted. The
  user flagged this would require splitting *revenue* itself by beverage
  category (beer/liquor/wine/non-alcoholic) and food, mirroring the
  `accounts.subcategory` Food/Beverage split COGS already got (see the
  Budget tab section's "COGS budgeted as % of revenue" entry above) — a
  real QBO chart-of-accounts/report-structure change, not something this
  session investigated. Explicitly deferred by the user ("that might also
  be something to bookmark for later"); see "Not yet done" below.

## Per-area expected covers replace the blended fill % — 2026-08-07

Same day, same conversation: reviewing the new Edit Capacity page, the user
said $86.12/cover (the blended per-cover figure) looked low, and asked to
see — and directly edit — each area's own average nightly covers per
month, rather than trust one blended number. Asked explicitly whether
editing that per-area number should become a real per-area override or
stay a read-only sanity check; the user chose the real override.

- **`capacity_seasonality.expected_pct` is gone.** A new table,
  `capacity_area_seasonality` (`area_id`, `month`, `expected_covers`,
  PK on the pair), is now the real editable projection input — one row per
  area per month, holding a raw nightly-covers target directly (not a %).
  Storing covers rather than a % was a deliberate choice: a raw forecast
  number shouldn't silently rescale just because someone edits that area's
  seat count later — if capacity changes, the covers assumption is
  something to reconsider, not something that should drift on its own.
  `capacity_seasonality` still exists, now holding only `holiday_closures`.
  Expected fill % and blended per-cover $ are still shown, but as derived,
  read-only figures (`monthDerived()` in `app/pages/capacity/edit.vue`,
  `nightlyExpectedForMonth()` in `server/api/capacity.get.ts`) computed by
  summing every area's own `expected_covers` — not a stored, independently
  editable number anymore.
- **Migration was a clean re-seed, not a careful in-place migration** —
  this whole feature was built earlier the same session and had nothing
  deployed to production yet, so `scripts/import-capacity-projections.mjs`
  just derives each area's starting `expected_covers` from the original
  blended `expected_pct` (`capacity * pct`, per area) — reproduces the old
  model's numbers exactly as a starting point, until the user edits an
  individual area. Applied locally via a direct `DROP`/`CREATE` on
  `capacity_seasonality` plus a new `CREATE TABLE` for
  `capacity_area_seasonality`, then a re-run of the import script — no
  production volume to worry about yet for these two tables.
- **`server/api/capacity.get.ts`'s per-day math was already structured
  around a `nightlyExpectedForMonth(month)`-shaped helper** (from the
  fill%/per-cover rate-metric rework earlier the same day), so swapping its
  internals from "capacity × one shared pct" to "sum of each area's own
  `expected_covers`" was a small, contained change — everything
  downstream (day-by-day sums, holiday adjustment, week/month periods)
  was already written against that helper's output shape and needed no
  changes at all. Verified via curl: `/api/capacity`'s numbers were
  byte-identical before and after the migration (since the seed
  reproduces the old blended numbers exactly), and editing one area's
  `expected_covers` via `POST /api/capacity/settings` correctly moved
  `/api/capacity`'s `assumedFillPct`/`assumedAvgCheck` by the expected
  amount before being reverted.
- **Fixed a real display bug in the same pass**: `(expected_pct *
  100).toString()` was rendering raw floating-point noise (`57.99999999999
  9996%` for a stored 0.58, `55.00000000000001%` for 0.55) directly into
  editable input fields — caught by the user from a screenshot. The new
  derived Fill %/Per-Cover $ columns are formatted with `.toFixed()`
  instead of raw `.toString()`, and the new `expected_covers` inputs
  (themselves often `capacity * pct` floating-point products, e.g.
  `4.199999999999999`) get rounded before ever reaching an input field —
  see `roundCovers()`/`fmtPct()`/`fmtMoney2()` in edit.vue.
- **Every input on the Edit Capacity page is now integer-only except Max
  Turns/Night and Per-Cover Revenue** — a follow-up simplification request
  from the user, both to narrow the now-9-column monthly table and because
  fractional covers (37.6 covers/night) aren't a meaningful thing to type
  in by hand. Seats/capacity/expected-covers/holiday-closures round via a
  new `intNum()` helper on save (and are pre-rounded on load); Max
  Turns/Night and Per-Cover Revenue stay decimal, since $258.56/cover
  (Chef's Counter) and 2.5 turns/night are real, meaningful fractional
  values.
- **Nav tab renamed "Capacity" → "Edit Capacity"**, at the user's explicit
  request — a deliberate departure from the "Budget Pace"/"Budget"
  asymmetric-naming convention this tab was originally modeled on (see the
  "Capacity Pace reframed..." section above). The view stays "Capacity
  Pace."

## Not yet done

- A small, low-priority COGS discrepancy (~$1,926.79, ~0.25% of revenue)
  surfaced by the net income investigation above, not yet root-caused —
  called closed for now given its size relative to everything else found
  and fixed in that pass.
- Confirming the SBA loan's real QBO liability account number directly
  against QBO (see Debt Service / Cash Flow tab above) — currently
  unconfirmed since the source brief's own citation ("2740") conflicts with
  a real investor loan's account number.
- Wiring the P&L page to the real schema — it still renders the same static
  sample data as the approved mockup, not `useDb()` queries. The Dashboard
  page was wired to real data (`server/api/dashboard.get.ts`) and no longer
  needs this; the Budget tab's budget numbers are also real, only its
  actuals were still sample data (also since resolved — see Budget vs
  Actual on the Edit Budget page above). `daily_line_items` has a real path
  in (see QBO Account + P&L sync below) — this is now purely a UI-wiring
  task, no longer blocked on data.
- A manual entry flow for `category_benchmarks`
- Auto-recalculating expense budgets when a revenue estimate is revised
  mid-month (raised, deliberately deferred — the Budget tab ships manual
  editing + category-level flagging first)
- Per-account actuals in the Overspending drill-down (needs real
  `daily_line_items`, not sample data — see Budget tab above)
- Per-line-item actual-vs-budget on the Edit Budget page (raised by the user
  2026-07-23) — the new "Actual vs Budget" card (see Budget tab above) is
  category-level only, same as the Overspending drill-down above it on this
  list. Extending it into the account tree (one delta per leaf account, not
  just per category) is deliberately deferred rather than built alongside
  the category-level version.
- A UI to toggle `accounts.is_owner_compensation` (currently set by hand via
  SQL on the two owner accounts) and to split *actual* labor by owner-comp
  the same way the budget side already is (needs real per-account actuals)
- Extending the reserve running-balance simulation past `catchUpDate` (Dec
  20, 2026) — it currently only projects through the one-time catch-up
  payment; it doesn't project whether the reserve can keep sustaining
  Jones & Miller's monthly payments indefinitely afterward — see "Real
  running-balance reserve projection" above.
- Buyout revenue modeling on the Capacity Pace tab — bookmarked at the
  user's own request 2026-08-07 until a guaranteed-minimum figure exists to
  model against; see the Capacity tab section above.
- Feeding Capacity Pace's per-cover assumptions forward into the Budget
  tab's revenue projections (potentially making Budget's revenue line
  items derived/read-only) — bookmarked by the user 2026-08-07; would
  require splitting revenue itself by beverage category (beer/liquor/wine/
  non-alcoholic) and food, mirroring COGS's existing Food/Beverage split.
  See "Capacity Pace reframed..." above.

## Where to look

- [`schema.sql`](schema.sql) — data model
- [`design/dashboard-mockup.html`](design/dashboard-mockup.html) — approved static mockup (reference only)
- [`design/pl-mockup.html`](design/pl-mockup.html) — tentatively approved P&L tab mockup (reference only)
- [`app/pages/index.vue`](app/pages/index.vue) — the real Dashboard page
- [`app/pages/pl.vue`](app/pages/pl.vue) — the real P&L page
- [`app/pages/budget/index.vue`](app/pages/budget/index.vue) — Budget Pace + Overspending (route `/budget`)
- [`app/pages/budget/edit.vue`](app/pages/budget/edit.vue) — Edit Monthly Budget, incl. the live pace preview (route `/budget/edit`)
- [`app/pages/cashflow.vue`](app/pages/cashflow.vue) — Cash Flow tab: Free Cash Flow, P&L vs. Cash Flow view, debt service calendar, reserve savings plan (route `/cashflow`)
- [`server/api/cashflow.get.ts`](server/api/cashflow.get.ts) — Cash Flow tab's data route
- [`server/api/cashflow/reserve-transfer.post.ts`](server/api/cashflow/reserve-transfer.post.ts) — records a real reserve transfer (or reversal)
- [`server/api/cashflow/reserve-plan.post.ts`](server/api/cashflow/reserve-plan.post.ts) — declares the current weekly reserve-transfer plan
- [`scripts/import-debt-schedule.mjs`](scripts/import-debt-schedule.mjs) — one-time seed of `loan_schedule` from the debt amortization workbooks
- [`app/composables/useBudgetData.ts`](app/composables/useBudgetData.ts) — types/constants/fetch shared by both budget pages
- [`app/layouts/default.vue`](app/layouts/default.vue) — shared tab nav
- [`app/assets/css/main.css`](app/assets/css/main.css) — shared design tokens (colors, chips, header) used by all four pages
- [`server/utils/db.ts`](server/utils/db.ts) — `useDb()` helper for server routes/API endpoints
- [`server/utils/toast.ts`](server/utils/toast.ts) — Toast POS auth/fetch helper
- [`server/utils/toast-metrics-sync.ts`](server/utils/toast-metrics-sync.ts) — covers + labor-hours sync
- [`scripts/backfill-toast-metrics.mjs`](scripts/backfill-toast-metrics.mjs) — one-time historical Toast backfill
- [`server/api/budget/`](server/api/budget/) — budget read/write, copy-actuals, and QBO export routes
- [`scripts/init-db.mjs`](scripts/init-db.mjs) — creates the SQLite file from `schema.sql`
- [`scripts/import-budget-xlsx.mjs`](scripts/import-budget-xlsx.mjs) — one-time seed of accounts + budget from a real QBO budget export
- `data/qbo-budget-template.xlsx` — sanitized export template (checked in; the real xlsx it came from is not)
- [`app/pages/capacity/index.vue`](app/pages/capacity/index.vue) — Capacity Pace view (route `/capacity`)
- [`app/pages/capacity/edit.vue`](app/pages/capacity/edit.vue) — editable capacity/turns/per-cover-revenue + monthly fill %/holiday closures (route `/capacity/edit`)
- [`server/api/capacity.get.ts`](server/api/capacity.get.ts) — Capacity tab's projection-vs-actual data route
- [`server/api/capacity/settings.get.ts`](server/api/capacity/settings.get.ts) / [`settings.post.ts`](server/api/capacity/settings.post.ts) — load/save capacity assumptions
- [`scripts/import-capacity-projections.mjs`](scripts/import-capacity-projections.mjs) — one-time seed of `capacity_areas`/`capacity_seasonality` from the real capacity worksheet
