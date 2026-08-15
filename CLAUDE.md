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

## Capacity Nov–Apr/May–Oct calculated from Seats × Max Turns/Night — 2026-08-08

The two `capacity_areas` seasonal capacity columns were free-typed inputs
on the Edit Capacity page until now, independent of Seats/Max Turns/Night —
which had let them silently drift: Salon's stored `capacity_nov_apr`/
`capacity_may_oct` was 80/80, but 20 seats × 3.0 turns/night is 60, a real
mismatch caught while making this change, not a hypothetical one. At the
user's request, both columns are now calculated, not editable —
`computedCapacity()` in
[`app/pages/capacity/edit.vue`](app/pages/capacity/edit.vue) derives them
from the Seats/Max Turns/Night drafts (`Math.round(seats *
maxTurnsPerNight)`), rendered as read-only cells alongside the page's other
derived columns (Fill %/Per-Cover $). Outdoor is the one exception, per the
user's instruction: it has no Nov–Apr season at all (stays closed through
winter) regardless of what Seats × Turns would compute, matched by name
(`isOutdoor()`, case-insensitive) rather than a stored flag, since it's the
only area this applies to today.

`capacity_areas.capacity_nov_apr`/`capacity_may_oct` stay real stored
columns — `server/api/capacity.get.ts`, `capacity/index.vue`'s reference
table, and `scripts/import-capacity-projections.mjs` all still read them
directly, unchanged — only how the Edit Capacity page produces the values
written into them changed. Since a stale stored value (like Salon's) no
longer has a corresponding editable field for the user to "touch" to make
the Save button notice it, `hasUnsavedChanges` now also flags a
`capacityMismatch`: any area whose calculated capacity differs from what's
currently stored counts as an unsaved change on its own, so a load-time
mismatch is immediately savable rather than stuck until the user happens to
edit that row's Seats or Max Turns/Night for an unrelated reason. Verified
in the browser: Salon showed 60/60 (not the stale 80/80) with the page
already flagging "Unsaved changes" on load; clicking Save persisted 60/60
to local `data/restaurant.sqlite` and the mismatch flag cleared on reload.
Production's `capacity_areas` table has the same stale Salon values and
hasn't been corrected yet — this only shipped to local dev in this pass.

## "Set %" — bidirectional Fill % on the Edit Capacity page — 2026-08-09

Added at the user's request, after asking whether editing a blended Fill %
could drive each area's expected covers instead of only the other way
around. Flagged one real risk before building it: this is the same
blended-% assumption the 2026-08-07 change deliberately moved away from
(see "Per-area expected covers replace the blended fill %" above) — bar,
salon, chef's counter etc. don't really fill at the same rate, and a live
two-way-bound % field would silently clobber any differentiated per-area
figures the moment it recalculated. Landed on a middle ground: **"Set %" is
an explicit one-shot action (a button), not a persistent editable field**,
so overwriting a row's per-area assumptions is something the user chooses
to do, not an ambient side effect of the derived Fill % column existing.

- **`applySetPct(s)`** in
  [`app/pages/capacity/edit.vue`](app/pages/capacity/edit.vue) writes into
  every area's covers input for that month row, reusing the same
  `areaCapacityForMonth` helper the derived Fill %/Per-Cover $ columns
  already use — so a closed season (Outdoor Nov–Apr, capacity 0) naturally
  lands on 0 covers with no special-casing needed.
- **Kept out of the unsaved-changes diff until applied**: the scratch `%`
  input lives in its own `setPctInputs` ref, not on `MonthlyDraft`/
  `draftSnapshot`, so typing into it doesn't flag "Unsaved changes" —
  only clicking "Set" does (by writing into `areaCoversInput`, which was
  already tracked). The input clears itself after a successful apply.
  "Set" is disabled until the typed value parses as a finite number ≥ 0.
- **Verified in the browser**: typing 50 and clicking "Set" on the January
  row (Nov–Apr season, Dining 80/Bar 40/Salon 60/Chef's Counter 12/Outdoor
  closed) correctly wrote Dining 40, Bar 20, Salon 30, Chef's Counter 6,
  Outdoor 0 — Fill % updated to 50.0% and Per-Cover $ recalculated
  accordingly, all before saving.

**Repositioned + rounding fixed, same day**, after the user tried it with
their own real (non-round) Seats/Turns numbers and got 50.3% back from a
typed 50%. Two follow-up changes:

- **Moved the Set % input/button (plus a `→` between it and the area
  columns) into its own column right after Month**, ahead of Dining Room —
  at the user's request, so the control that drives the row reads
  left-to-right before the values it's about to overwrite, rather than
  sitting after them next to the now-purely-derived Fill % column. Fill %
  went back to being a plain read-only `.derived` cell, same as
  Per-Cover $.
- **`applySetPct` now rounds by largest remainder, not independently per
  area** — the real bug behind the 50% → 50.3% report. The original
  `Math.round(pct × areaCapacity)` per area let up to five independent
  0.5-cover roundings drift in the *same* direction (`Math.round` always
  rounds a `.5` up), compounding into a visibly-off blended Fill %.
  The fix computes each area's exact (unrounded) share, floors all of
  them, computes the *total's* own rounding once
  (`Math.round(pct × totalCapacity)`), and hands out just that many
  leftover whole covers to the areas with the largest fractional
  remainder. This bounds the drift to at most the total's own rounding
  (well under a tenth of a point in practice) instead of letting per-area
  roundings stack. Verified against a deliberately fractional test case
  (Bar 10 seats × 1.7 turns = 17, Salon 15 × 1 = 15, Chef's Counter 6 ×
  1.5 = 9, alongside Dining 80/Outdoor closed — total capacity 121, not
  evenly divisible by 2): typing 50% now produces Dining 40/Bar 9/Salon
  8/Chef's Counter 4 (61 covers, matching `round(0.5 × 121) = 61` exactly)
  and displays 50.4% — the closest any integer split of 121 covers can get
  to 50%, not the old method's larger, avoidable drift.

**Column alignment, same day** — the user flagged that right-aligned
header text sitting above narrow, right-aligned input boxes read as
misaligned, and that wide headers like "Chefs Counter"/"Holiday Closures"
were forcing extra column width they didn't need. Both `.pl-table`s now
center every column except the leftmost (Area/Month, still left-aligned) —
`.pl-table th, .pl-table td { text-align: center }`, with `.money-cell`/
`.setpct-cell`'s flex rows switched from `justify-content: flex-end` to
`center` so the input(s) inside them center too, not just plain-text cells.
Header labels now wrap (`.pl-table thead th { white-space: normal }`,
overriding the general `nowrap` every other cell keeps) instead of forcing
their column to their own single-line width, so a narrow input column can
sit under a 2-line header instead of stretching to fit it.

## Historical seasonality — "Set by History" + weekly chart — 2026-08-10

Prompted by the user asking how real historical Toast/QBO data could inform
the monthly capacity assumptions (e.g. "is early August actually one of the
slowest weeks of the year, or does it just feel that way"), rather than
guessing at seasonal fluctuations by hand. Investigated live before building
anything — pulled real production data over `fly ssh console` (same
disposable-script pattern as the QBO net-income investigation above) and
found two real gotchas that reshaped the design before a line of app code
was written:

- **Total revenue is the wrong input — it has to be core dine-in sales
  only.** A first pass using total revenue showed a real-looking dip in
  early August across 2024/2025, but the user pointed out Urban Hearth's
  event/catering revenue is sporadic (clients go on vacation too, so
  private events dry up in early August) and would contaminate a read on
  regular walk-in demand. Restricting to account_number IN ('4000'
  Restaurant Sales, '4010' Food, '4020' Beverage, '4022'/'4024'/'4026'/
  '4028' Beer/Liquor/Wine/Non-Alcoholic) — excluding Event Sales (4100s),
  Catering (4200s), Retail (4300s), Other Service Income (4400) — actually
  *reversed* the finding: core dine-in revenue in early August runs at or
  slightly above each year's own average; the apparent dip was almost
  entirely the events/catering line dropping off.
- **Weekly totals silently conflate real closures with slow demand.** The
  user caught this from a screenshot of Toast's own Sales Category Summary
  for 2025-08-23 (a Saturday) showing $9,530 in "Special Events Offsite"
  and nothing else — the restaurant was fully closed for an offsite buyout
  that night, which a naive weekly-revenue aggregate reads as "a slow
  week" rather than "a night with zero regular covers by design." Verified
  this generalizes: the old location's non-Monday, non-Sunday closures
  (holidays, staff events, buyouts) show up as clean $0 days against a
  real per-day distribution with a sharp gap between "closed" (≤$252) and
  the lowest real service night ($585) — see `CLOSED_DAY_THRESHOLD` in
  `server/api/capacity/history.get.ts`. Also surfaced, as a side effect of
  checking day-of-week closure rates directly rather than assuming: the old
  location was closed **Sundays and Mondays** (94%/98% closed in 2025), not
  just the new location's single standing Monday closure — a real
  operating-calendar difference between the two locations, not a data bug.
- **Per-open-day average, not weekly sum, is the right unit.** Both fixes
  land in the same place: `history.get.ts` sums each *open* day's core
  revenue and divides by open-day count (never dividing by 7, or by
  whatever days happen to have a row), indexed to that year's own annual
  per-open-day average — so a closure day is excluded entirely rather than
  averaged in as a zero, and the 2026 location move's higher revenue level
  never has to be compared directly against 2024/2025's.

**Design fork, resolved with the user before building**: should the
historical data stay a read-only reference, or actually drive the monthly
covers numbers? Landed on both, via a specific mechanic the user proposed
directly — replace Edit Capacity's old manually-typed "Set %" button
outright with **"Set by History"**, which needs no typed input at all:

- `monthlyIndex` (`server/api/capacity/history.get.ts`) is each calendar
  month's per-open-day core revenue as a % of that year's own average,
  equal-weighted across whichever of 2024/2025 have a trustworthy reading
  for that month (≥3 open days — 2024's history only starts late July, so
  Jan–Jun 2024 contribute nothing). The current year is deliberately
  excluded from this average (both because it's the year being forecast,
  and because 2026 specifically spans the location move) but still flows
  into the chart below as its own "to date" line.
- The one remaining judgment call — what absolute fill % the historical
  *shape* scales against — was also put to the user directly rather than
  assumed: derive the baseline from whatever's already typed into the
  covers grid (`currentAnnualFillPct` in `app/pages/capacity/edit.vue`, a
  live computed off the in-progress drafts) rather than a separate
  target-% input to maintain. `historyTargetFraction(s) = baseline ×
  (monthlyIndex/100)`, then the same largest-remainder area distribution
  the old Set % already used. A real, expected consequence of this choice
  worth remembering: because the baseline is derived from *all* months'
  current drafts, clicking "Set by History" on one month shifts every
  other month's preview % slightly (the annual average moved) — clicking
  through all 12 months once gets close, not exactly, to a stable
  self-consistent state; a second pass would converge tighter. Not
  considered worth solving with iteration/convergence logic for a one-shot
  manual action.
- The button disables with an explanatory tooltip in the two cases where it
  can't compute a number: no historical reading for that month (a gap in
  the 2024/2025 data), or nothing entered anywhere on the page yet to
  anchor the baseline to.

**The weekly chart** (`app/components/SeasonalityChart.vue`, on
`app/pages/capacity/index.vue`) shows the same underlying weekly index (not
just the monthly-grain number the button uses) so the button's math isn't a
black box — one line per year, current year overlaid against history, per
the user's own framing ("this year's number compared to last year's"). Per
the `dataviz` skill: this is an **ordinal**, not categorical, palette —
years have a real order (recency), so the fixed-hue-per-category rule
doesn't apply; one hue, light→dark by recency in light mode, flipped
light-on-dark in dark mode (same reasoning a sequential ramp flips its
anchor) so the current year — the one that matters most — stays the most
visible line against a dark surface either way. Validated via
`validate_palette.js --ordinal` for both modes (light: light-end contrast
2.10:1, dark: 2.45:1; both pass monotone-L and adjacent-ΔL). Ships a
crosshair + one-tooltip-for-all-series on hover (per the skill's
interaction defaults for a line chart) and a "Show as table" toggle as the
accessibility fallback. First chart of any kind in this app — the Design
direction section above rules out traditional line/bar time-series charts
for the Dashboard specifically; this is a different, explicitly-requested
reference view on a different page, not a reversal of that call.

**Verification note**: local dev's `daily_line_items` only covers
2026-05-01 onward (never backfilled further locally), so the button and
chart can't be exercised against real multi-year data in local dev — the
button correctly disables (verified) and the chart correctly renders a
single 2026-only line (verified) in that state. The actual monthlyIndex
math was verified against real production data instead, via the same
disposable-script-over-`fly ssh console` pattern used throughout this file
(August: 97.7%, blended from both 2024 and 2025 — consistent with, though
smoother than, the sharper week-31/32 dip found during the investigation
above, since the monthly grain averages over the mid-August recovery
weeks). End-to-end button behavior (distribution math, live Fill %/
Per-Cover $ update, unsaved-changes tracking) was verified by temporarily
seeding synthetic 2024/2025 rows into local dev, clicking through, then
deleting them — never saved, and local dev's `daily_line_items` was
confirmed back to its original 76-row state afterward.

**Three refinements, same day, after the user reviewed the real chart in
production** (deployed themselves, separate from local dev/production
verification above):

- **Single most-recent prior year, not a multi-year average.** The user
  found the original 2024+2025+2026 chart cluttered and asked to drop 2024
  — `historicalYears` (`server/api/capacity/history.get.ts`) now returns
  just the single most recent prior year (2025) instead of every year with
  data. `monthlyIndex`'s "average across historical years" logic was left
  in place unchanged (it degrades to a one-element average automatically)
  rather than special-cased, so both it and the chart's `weeklySeries`
  stay derived from the same `historicalYears` list and can't drift apart.
  The hardcoded "2024/2025" text on Edit Capacity's tooltip/section-note is
  now built from the API's own `historicalYears` (`historyYearsLabel` in
  `app/pages/capacity/edit.vue`) instead, so it can't go stale as years
  roll forward.
- **2026 needs two averages, not one — a real location move, not a
  hypothetical edge case.** The user confirmed the exact dates directly:
  old location closed 2026-05-30, new location's real opening was
  2026-06-20 (a Jun 16-19 friends & family preview generated real, if
  atypical, revenue — $5-8k/day — that doesn't represent either steady
  state). A single whole-year per-open-day average for 2026 blended two
  operationally different revenue levels, which is what produced a
  misleading "sudden steep increase" in the first version of the chart —
  not organic growth, just the location switch. `LOCATION_MOVE_PERIODS`
  (`history.get.ts`) hardcodes the two windows (Jan 1–May 31, Jun 20–Dec
  31) as a one-off, hand-verified constant — deliberately not a generic
  multi-segment mechanism, since no other year has this problem.
  `periodAvgFor(year, date)` returns the right period's average for 2026,
  or the plain whole-year average for every other year unchanged. A
  week/month whose earliest open day falls in the Jun 1-19 gap (neither
  period) is dropped entirely rather than misattributed — including the
  real Jun 20-21 revenue that happened to share an ISO week with the F&F
  preview days, since a 2-day fragment isn't a meaningful week on its own
  either. This is also what creates the chart's visual break across the
  move — `SeasonalityChart.vue`'s `pathFor` was changed to start a fresh
  SVG subpath (`M`) instead of connecting (`L`) whenever consecutive
  points aren't adjacent, a general fix (any missing week/month breaks the
  line) rather than a special case hardcoded to this one gap.
- **Monthly view added, now the default — the weekly line was too jagged
  to read.** The user's own read on the deployed weekly-only chart: real
  week-to-week noise (this restaurant is only open ~5-6 nights/week, so a
  swing of +/-20pts is mostly sampling noise, not seasonal signal) made
  the chart "unsatisfying" without being clearly wrong. Considered and
  rejected switching to a bar chart — that doesn't address a data-grain
  problem, and 52 thin bars/year would look busier, not clearer. Landed on
  a Weekly/Monthly toggle instead, monthly as the default (steadier, since
  it averages 20+ days instead of 5-6), same "smoother default, detail on
  request" reasoning as the table-view toggle next to it. `monthlySeries`
  (`history.get.ts`) is a new, separate field from `monthlyIndex` — the
  same per-year raw-value shape as `weeklySeries` at month grain (reusing
  `periodAvgFor` and the same "drop, don't misattribute, an ambiguous
  period" rule, so June 2026 is expected to be absent here too), not a
  reuse of `monthlyIndex`'s already-averaged-for-the-button shape.
  `SeasonalityChart.vue` was refactored to normalize weekly/monthly data
  into one shared `{year, x, indexPct, label}` point shape so the
  geometry/hover/table code doesn't fork per grain. Verified against real
  production data via the same disposable-script pattern: 2025 now shows a
  steady 86-115% range across all 12 months (vs. the old chart's
  week-to-week swings into the 60s/160s), and 2026 correctly shows Jan-May
  (old location, 91-113%) and Jul-Aug (new location, ~98-103%) with June
  cleanly absent — no artificial spike.

**Monthly view superseded by a smoothed weekly line, same day** — the user
tried the monthly chart above and wasn't sold on it ("not sure about the
month display now"), and asked to try a rolling average over the weekly
data instead. `SeasonalityChart.vue`'s mode toggle is now **Smoothed**
(default) / **Raw weekly** — same weekly x-axis/grain either way, so
week-to-week movement is still visible, just averaged over a centered
5-week window (`SMOOTHING_WINDOW_HALF = 2`) to separate the seasonal shape
from the sampling noise instead of collapsing to a coarser calendar unit.
The window walk stops the moment the next week isn't actually adjacent (an
x-value check, not just array-adjacent), so it never averages across the
real location-move gap — a week right next to the gap naturally smooths
over fewer than 5 weeks rather than reaching past what's really there.
Verified against real production data: week 1's raw 62.7% (a single-day,
noisy week) smooths to 109.4%, and the two weeks flanking the gap (22 and
26) each smooth from only 3 real neighbors, not 5, confirming the gap
isn't bridged. `monthlySeries` (`history.get.ts`) and the `MonthPoint`
type/prop were removed entirely rather than left dormant, since this was a
genuine pivot away from monthly, not an additional option alongside it —
consistent with this file's own "delete rather than half-finish" posture;
easy to reconstruct from this section's history if monthly ever comes back
into consideration.

**Smoothing itself dropped, same day — the user caught a real structural
problem with it, not just a taste call.** Looking at the deployed smoothed
chart against the raw one side by side, the smoothed line showed the most
recent week (Aug 3-9) at 107%, while raw showed 94% — a real trough the
smoothed line was hiding. Root cause: a *centered* moving average has no
future data to center against at the live edge of a still-accumulating
series, so its most recent points silently become backward-only averages
biased toward whatever came *before* a real recent move — exactly the
worst moment for a dashboard to be quietly optimistic. This isn't a tuning
problem (a different window size doesn't fix it, the bias is structural to
centering); simplified back to a single raw weekly line, no toggle,
`viewMode`/`SMOOTHING_WINDOW_HALF`/`smoothedYear` all removed rather than
left dormant.

**Two follow-up legibility fixes to the now-single raw line, same day**:
1. **Curved (Catmull-Rom) line interpolation** instead of straight
   segments between points — a pure rendering choice (`curvedPath()` in
   `SeasonalityChart.vue`), each real data point still sits at its exact
   plotted position, only how the line travels *between* points changed.
   Still split into contiguous runs at any real data gap first (same as
   before), so a run's curve never reaches across missing weeks.
2. **Fixed y-axis domain (65-145%)** replacing the previous auto-padded
   range (which stretched well past the data on both ends), at the user's
   specific request — verified this almost exactly matches the real data's
   own min/max (62.7-145.3%, confirmed against production).
3. **Categorical color pair, not an ordinal ramp** — with the chart now
   showing exactly two concrete years ("this year vs. last year," not a
   multi-year recency series), two genuinely distinct, validated
   categorical hues read better than shades of one hue: the current year
   reuses the app's own `--accent` blue (dataviz categorical slot 1), the
   prior year gets slot 2's orange. Re-validated via
   `validate_palette.js` (categorical, 2 slots this time, not
   `--ordinal`): worst-pair ΔE 24.7/26.8 (CVD) and 33.6/31.8 (normal
   vision) in light/dark — well past the >=8 target.

**Prior-year line faded to 50% opacity**, at the user's explicit request
after seeing the two-color version deployed — the prior year is reference
context, not the focal series, so it now recedes toward the surface
(line, hover dot, and legend swatch all faded; the tooltip's color key
stays full-opacity, since that's a small precise readout rather than part
of the chart's visual hierarchy).

**Rebuilt as a monthly grouped bar chart, 2026-08-10, superseding the line
chart above.** After using the deployed raw-weekly line for real, the user
concluded the week-to-week noise is likely mostly unavoidable sampling
noise at this restaurant's size (~5-6 open days/week), and that pulling in
more years to average it out "seems like too much effort" for what it
would buy — landing on a monthly grouped bar chart (current year and prior
year side by side per month) instead. This closes the loop on the
smoothing problem from a different angle than smoothing itself: monthly is
steadier by construction (20+ open days per bar) without the moving
average's live-edge bias.
- `server/api/capacity/history.get.ts`'s `weeklySeries`/`isoWeekInfo`
  were removed outright (not left dormant) and replaced with
  `monthlySeries` — the same per-chart-year raw-value shape at month grain,
  reusing the existing `periodAvgFor`/location-move-period logic unchanged
  (May 2026 and earlier index against the old location's average, July
  2026 on against the new location's, June 2026 absent — same as every
  monthly computation earlier in this section).
- Bars start at zero, unlike the old line chart's truncated 65-145% axis —
  called out explicitly per the dataviz skill: bar *length* encodes
  magnitude, so a truncated bar axis misrepresents it in a way a
  truncated line-position axis doesn't. Y-axis headroom is computed from
  the real data (`Math.ceil((max+10)/20)*20`, floor 120%) rather than
  fixed, so it stays sane as new months of data arrive.
- Hover is per-month-group (bars are the hit target, no crosshair — this
  isn't a continuous series) and shows both years in one tooltip, since
  the side-by-side comparison is the entire point of this chart.
- Verified against real production data via the same disposable-script
  pattern used throughout this file: rebuilt `history.get.ts`'s monthly
  numbers exactly reproduce the earlier-verified figures (2025: 86-115%
  across all 12 months; 2026: Jan-May and Jul-Aug present, June cleanly
  absent) — confirming the rewrite didn't silently change the underlying
  math, only the chart form consuming it.

**Real bug, caught by the user from the deployed chart: June 2026 was
missing entirely, not just cleanly absent as intended.** The monthly
version of the location-move gap logic (`monthlySeries` in
`history.get.ts`) had reused the weekly version's "classify by one
representative day" approach unchanged — picking each month's *earliest*
open day to decide which period average applies, then dropping the whole
month if that one day landed in the gap. June's earliest open day is June
16 (the friends & family preview, inside the Jun 1-19 gap), so the whole
month got dropped, silently discarding 11 real, clean post-move days
(June 20-30) that individually belonged to the new-location period just
fine. Fine at weekly grain (only ~2 real days were ever at stake in the
one affected week); a real loss at monthly grain. Fixed by classifying
each *day* individually (skip a day only if that specific day falls in
the gap) before grouping into months, rather than classifying a whole
month by one representative day. Verified against production: June 2026
now shows a real 91.7% from 9 open days (June 20-30 minus its two
Mondays) — in line with the surrounding months instead of blank.

**Bookmarked, not yet resolved: this chart's "%" and the app's other
Fill %/Capacity Pace figures mean two different things**, flagged by the
user directly. This chart's percentage is core revenue relative to that
year's own average (a seasonality index); the Capacity Pace/Edit Capacity
pages' Fill % is real covers ÷ theoretical max seating capacity. Aligning
them for real (rather than just relabeling this chart as a distinct
"seasonality index") would mean expressing historical months as a
*derived* fill % — scaling this chart's revenue index against the
current year's saved covers assumptions, the same transformation "Set by
History" already applies — since there's no real historical covers data
(Toast) or historical seat-configuration data (the old location's actual
layout was never recorded) to compute a truly *measured* historical fill
%. See "Not yet done" below.

## Capacity revenue feeds the Budget tab — 2026-08-10

Closes the bookmark from "Capacity Pace reframed..." above: the user asked
directly how to make the Edit Capacity page's monthly numbers feed the
Budget tab's revenue, rather than the two staying independent projections
of the same thing (Capacity computes covers × per-cover $ per area; the
Budget tab's Revenue line items were manually typed, unrelated numbers).

- **`capacity_areas.per_cover_revenue` (one blended $/guest figure) is now
  split into `per_cover_revenue_food`/`per_cover_revenue_beverage`** — the
  minimum split needed to write into real QBO accounts, since revenue
  accounts split at Food (4010) vs. Beverage (4022/4024/4026/4028
  Beer/Liquor/Wine/Non-Alcoholic), mirroring `accounts.subcategory`'s
  existing Food/Beverage grouping (see "COGS budgeted as % of revenue"
  above). Total per-cover revenue (what Capacity Pace's fill %/avg-check
  math and the Edit Capacity page's derived columns use) is food +
  beverage, computed at query time, not a separately stored column — same
  reasoning as `capacity_nov_apr`/`capacity_may_oct` being derived from
  Seats × Max Turns/Night rather than risking drift between the parts and
  the whole. **Deliberately stops at Food/Beverage, not a further
  beer/liquor/wine/non-alcoholic split** — Capacity's covers × per-cover
  model has no natural way to know how a table's spend divides across
  those four categories, so going further would mean fabricating a split
  Capacity has no real basis for; the Beverage $ is instead distributed
  across those four accounts by each account's own existing budget-dollar
  weight (see below), not projected independently per account.
- **No real per-area Food/Beverage split ever existed to migrate from**, so
  existing `capacity_areas` rows were split
  (`scripts/migrate-capacity-revenue-split.mjs`,
  `npm run db:migrate-capacity-revenue-split`) using this restaurant's own
  trailing actual Food/Beverage revenue ratio from `daily_line_items`
  (68.8%/31.2% at migration time) applied uniformly to every area's prior
  blended figure — a first-pass estimate, not real per-area data, editable
  per area afterward on the Edit Capacity page, same "first-pass rule,
  editable later" posture as `cost_behavior`/`is_owner_compensation`
  elsewhere in this schema. `scripts/import-capacity-projections.mjs` was
  updated the same way, so a fresh-clone `db:init` → `db:import-budget` →
  `db:backfill-pl` → `db:import-capacity` path still produces a sane split
  (falling back to a flat 65/35 if run before any revenue data exists).
- **`server/api/capacity.get.ts`'s per-month `assumed` figure now also
  carries `expectedRevenueFood`/`expectedRevenueBeverage`** (always summing
  to the existing `expectedRevenue`, unchanged for every other consumer) —
  threaded through `nightlyExpectedForMonth`, `dayByDaySum`,
  `holidayAdjustment`, and `assumedForRange` alongside the existing blended
  figure, so a full calendar month's Capacity projection has a real
  Food/Beverage target to hand to the Budget tab.
- **The Edit Budget page's Revenue section got a banner mirroring the
  existing "Recompute COGS from trailing average" one** — shows that
  month's Capacity-projected Food/Beverage revenue and, when it
  meaningfully differs from what's currently budgeted (>$1), a "Recompute
  {month} Revenue from Capacity" button. Mechanically similar to the COGS
  recompute (weighted redistribution across a group's accounts by each
  account's existing dollar share, equal split if the group was
  previously all-zero) but the source is fundamentally different: COGS's
  trailing-average % needs a revenue figure to multiply against, while
  Capacity's covers × per-cover model already **is** a revenue projection,
  not a percentage of something else — so this reads Capacity's number
  directly rather than computing a rate. Food's target writes straight to
  account 4010 (the only Food leaf account); Beverage's target is split
  across the four Beverage leaf accounts (4022/4024/4026/4028) by their
  existing weight. Verified end-to-end against real local data: clicking
  the button for August wrote Capacity's exact $185,781/$84,177 Food/
  Beverage figures to the right leaf accounts, left the 4020 parent
  untouched, and the test write was reverted back to the real prior
  budget afterward.
- **Restricted to leaf accounts (`isLeafAccount`), unlike the existing COGS
  recompute's account filter** — 4020 Restaurant Beverage is a parent
  account that also carries the `subcategory='Beverage'` tag; the COGS
  recompute's own filter (`a.category === 'cogs' && a.subcategory ===
  group`, with no leaf check) happens to work today only because parent
  accounts' own stored budget is conventionally 0. Rather than lean on that
  same convention for a brand-new write path, this feature's account
  lookup explicitly filters to accounts with no children. (While checking
  this, found that convention doesn't actually hold everywhere in the real
  budget data — see the flagged follow-up task, not fixed as part of this
  change.)
- **Real bug caught while building the Edit Capacity page's two new
  columns**: `.money-cell { display: flex }` had been applied directly to
  a `<td>` for the old single Per-Cover Revenue column, which worked fine
  with one such column per row. Adding a second adjacent `<td
  class="money-cell">` (Food next to Beverage) exposed a real CSS gotcha —
  `display: flex` on a table cell changes its outer display away from
  `table-cell`, so the browser's table "fixup" rules folded the two
  adjacent non-cell `<td>`s into a single anonymous cell, stacking them
  vertically instead of side by side. Fixed by moving the flex layout onto
  a `<span>` nested inside a plain `<td>` instead of on the `<td>` itself,
  in both the per-area table's two revenue columns.

**Beverage $ now splits by a real Beer/Liquor/Wine/Non-Alcoholic sales mix,
not by whatever's already budgeted** — same day, follow-up: the user
recalled having worked out this mix before but not what it was, and asked
how much effort a real-data version would take given the existing
weighted-redistribution approach just reused whatever was already
budgeted. `server/api/budget/beverage-revenue-mix.get.ts` sums real
`daily_line_items` for the four Beverage **revenue** accounts (4022 Beer,
4024 Liquor, 4026 Wine, 4028 Non-Alcoholic — never the COGS-side beverage
cost accounts 5110/5120/5125/5130, a distinction called out explicitly
after the user flagged that this section kept citing the COGS recompute as
a reference pattern) since 2026-06-20, the new location's real opening
date (the same boundary `capacity/history.get.ts`'s `LOCATION_MOVE_PERIODS`
already uses, to avoid blending the old location's beverage program into
the mix). Not a rolling trailing window like the COGS recompute's 3-month
average — there's only one continuous stretch of real data since the move
so far, so using all of it is the largest stable sample available, not a
deliberate choice to revisit later. `recomputeRevenueFromCapacity` now
prefers this real mix for Beverage's per-account weighting, falling back to
the previous existing-budget-weight behavior only if no real mix data
exists yet; Food is unaffected (only one account, 4010). The Revenue
banner shows the computed mix (e.g. "split Beer 3%, Liquor 42%, Wine 51%,
Non-Alcoholic 4%, from real sales since the location move") so the number
behind the recompute button is visible before clicking, not just implied.
Verified against real local data: the endpoint returned Beer 2.7% / Liquor
42.3% / Wine 51.1% / Non-Alcoholic 4.0% (wine highest, matching the user's
own recollection), and clicking Recompute wrote dollar amounts matching
that mix applied to Capacity's Beverage target exactly, not the account's
prior budgeted share.

## Historical tab: covers + spend seasonality, replacing the blended revenue index — 2026-08-12

Started as a simple ask (move the Seasonality chart off the Capacity Pace
page onto its own top-level **Historical** tab, `app/pages/historical.vue`
— same reasoning as the original Budget/Capacity tab splits: a reference
view, not a pace-tracking one, belongs on its own page) but grew into a
real redesign of what the chart measures, after the user shared real Toast
order-export CSVs for both locations (`data/orders_cambridge_st/`,
`data/orders_mass_ave/`, gitignored — same "source data not checked in,
only imported/derived rows are" posture as every other real-data import in
this file) and asked how that data could sharpen the app's seasonal
assumptions.

- **The single blended revenue index was replaced with two separate
  indexes — covers, and spend-per-cover** — the user's own framing: "per-
  open-day core dine-in revenue" isn't how a restaurateur thinks about
  seasonality, since it silently conflates how many covers came through the
  door with how much each cover spent. Splitting them also solves a real
  problem raised in the same conversation: a raw fill % isn't transferable
  from the old (smaller) Mass Ave location to the much larger Cambridge St
  space — 95% full in a small room and 75% full in a big room can reflect
  the *same* demand — but an index of covers relative to *that location's
  own* typical night sidesteps the comparison entirely (demand-shape, not
  an absolute occupancy level). Covers come from Toast
  (`daily_toast_metrics`); spend-per-cover divides QBO's own core dine-in
  revenue by those same covers, not Toast's own dollar totals — QBO stays
  the trusted, cash-basis, sign-corrected revenue source everywhere else in
  this app.
  [`server/api/capacity/history.get.ts`](server/api/capacity/history.get.ts)
  now returns `coversSeries`/`spendSeries` (the old single `monthlySeries`
  is gone, not left dormant) and both render on the Historical page via two
  instances of the now-generalized
  [`SeasonalityChart.vue`](app/components/SeasonalityChart.vue) (parameterized
  via `metricLabel`/`ariaLabel` props — bar-chart mechanics unchanged).
  Edit Capacity's **Set by History** button (`app/pages/capacity/edit.vue`)
  now reads the covers index specifically, not revenue — a real accuracy
  improvement, not just a rename, since that button has always been about
  covers.
- **The live Toast connection reaches the entire Mass Ave era, not just
  the new location** — verified directly against the live API (not
  assumed) before building anything: `ordersBulk` returned real order data
  for 2024-12-01, 2025-01-15, and 2025-06-10, all under the same
  `restaurantGuid` (the user renamed the Toast location in place rather
  than creating a new one — see the Toast POS integration section above).
  This meant the user's CSV exports weren't actually needed as an ingestion
  source — a backfill against the same API the nightly sync already uses
  is more consistent, so `scripts/backfill-toast-metrics.mjs` (already
  defaulting to a 2-year lookback) was simply re-run without the
  `--since=2026-06-20` restriction that a previous session deliberately
  added to *avoid* reaching old-location data — now the opposite of what's
  wanted. Per-area (table-level) resolution, by contrast, *is* blocked:
  order objects carry a `table` GUID reference, but resolving it to a
  table name needs Toast's Config API, which 403s under the current
  credentials (confirmed live). Bookmarked for whenever per-area actuals
  get picked up (the user flagged wanting this for Dining Room/Outdoor/
  Chef's Table now, Bar/Salon once Cambridge St has its own year of
  history) — not just a data-availability gap but a credentials-scope one.
- **Two real data-quality bugs found via this backfill, not from the CSV
  export alone** — both confirmed live against the API, so not a CSV-tool
  artifact:
  - A handful of otherwise-normal seated orders carry an implausible
    `numberOfGuests` (repeated exact values like `788`, one `133`) — a
    staff data-entry slip, not a systemic error (real party sizes top out
    at 28 across the full dataset). Fixed with
    `MAX_PLAUSIBLE_GUESTS_PER_ORDER = 50` in both
    [`server/utils/toast-metrics-sync.ts`](server/utils/toast-metrics-sync.ts)
    (the live nightly sync) and `backfill-toast-metrics.mjs` (duplicated,
    same Node-22-can't-strip-TypeScript reason as this file's other
    duplicated Toast/QBO logic) — the order is excluded from the day's
    covers sum entirely (not clamped to a guess) and logged with its GUID.
  - A **closed day with a single stray online order still reads as
    "open."** The original `covers > 0` open-day filter looked sound until
    checked against the real distribution: ~95 local days show covers
    between 1-13, then a clean gap before real service nights start at
    17+. 44 of those low-covers days are Mondays (the standing closure)
    and 24 are Sundays (Mass Ave's *second* closure day — old-location-only,
    per the location-move section above), with most of the remainder
    clustering around known holidays (Thanksgiving, Christmas Eve, New
    Year's). A closed day with one $150 gift-card order isn't a real slow
    night. This wasn't just an accuracy nit — on the **spend** index it was
    actively corrupting the data: 2026-07-04 (a holiday) showed
    `covers=1, revenue=$10,582.24` — a private event whose true guest count
    was never captured, producing a nonsensical $10,582/cover reading that
    swamped July's whole-month average before this was caught (July's spend
    index briefly read 10% in one intermediate build, an obviously-wrong
    number that's what surfaced this in the first place). Fixed with
    `MIN_COVERS_FOR_OPEN_DAY = 15` in `history.get.ts`, same "check the
    real distribution, find the clean gap" methodology as
    `MAX_PLAUSIBLE_GUESTS_PER_ORDER` above and the original
    `CLOSED_DAY_THRESHOLD` this file documents elsewhere.
- **Local dev backfilled 2024-08-01 through today** (741 days,
  `npm run db:backfill-toast -- --since=2024-08-01`, two runs — the first
  hit one transient `fetch failed` partway through and was resumed from
  the failure point rather than restarted, since the script's upserts are
  idempotent) so the two indexes have real data to render against locally.
  Verified in the browser: both charts render with sane values (2025
  covers index ranging 84-134%, no more corrupted outliers after the
  open-day fix), and Set by History's tooltip/behavior confirmed against
  July's real 98% covers index. Local dev still can't show a full
  current-vs-prior-year comparison the way production will — local
  `daily_line_items` (QBO revenue) only reaches back to 2026-05-01 (a
  known, already-documented local dev limitation — see the Historical
  seasonality section above), so the spend index only has real 2026 months
  to show locally; production's QBO history goes back further and should
  show both years once the equivalent Toast backfill runs there.
- **Production Toast backfill run, 2026-08-12** — `npm run db:backfill-toast
  -- --since=2024-07-28` (matching production's own QBO revenue floor,
  found by querying `daily_line_items` directly first rather than guessing
  a date) via `fly ssh console`, after the user confirmed. Hit one
  connection drop partway through (`fly ssh console`'s own SSH session
  ended mid-run, not a script error — "remote command exited without exit
  status or exit signal"), leaving a real gap from 2026-03-23 through
  2026-06-19 (the original narrower backfill had already covered
  2026-06-20 onward). Resumed with `--since=2026-03-23 --until=2026-06-19`
  to close just that gap rather than re-running the whole range — verified
  afterward with a recursive-CTE gap check against `daily_toast_metrics`
  (0 missing days across the full 2024-07-28–2026-08-11 span) rather than
  eyeballing it.

## Historical charts show what "100%" actually is, by location — 2026-08-12

Same day, prompted by the user pointing at the chart legend and asking to
show the real per-cover/per-night average each year's bars are indexed
against — "just to know what the percentages are indexed against." Framed
by *location*, not by calendar year, per the user's own request: "Mass Ave
and Cambridge St," not "2025 and 2026," since that's how a restaurateur
actually thinks about the comparison.

- **`locationBaselines`** (`server/api/capacity/history.get.ts`) exposes
  two real numbers per metric — Mass Ave's and Cambridge St's own average
  (covers/night and $/cover) — computed from data already on hand: Mass
  Ave is 2025's own whole-year average (the only historical year, entirely
  Mass Ave); Cambridge St is the new-location half of the existing
  `LOCATION_MOVE_PERIODS` split. Hardcoded to this specific transition the
  same way `LOCATION_MOVE_PERIODS` itself already is — both page and
  component treat a null baseline as "don't show it," so this simply stops
  rendering once next year rolls around and the pairing no longer applies,
  rather than needing to be revisited by hand.
- Rendered directly in `SeasonalityChart.vue`'s legend line, next to each
  year's color swatch (e.g. "2025 — Mass Ave avg 42/night", "2026 (to
  date) — Cambridge St avg 91/night") — exactly where the user pointed,
  via two new optional props (`massAveBaselineLabel`/
  `cambridgeStBaselineLabel`) rather than the component computing anything
  location-specific itself, keeping the component metric-agnostic (it
  already didn't know whether it was rendering covers or spend).
- Verified in the browser against real local data: Covers legend read
  "2025 — Mass Ave avg 42/night" / "2026 (to date) — Cambridge St avg
  91/night" (the new space's much higher covers/night, as expected from
  its larger capacity); the Spend chart's 2025 label came back with no
  baseline at all, correctly, since local dev has no 2025 QBO revenue to
  compute it from (the already-documented local dev limitation) — the
  null-hides-label behavior working as designed, not a bug.

## Production deploy-timing gap + a second real Toast/QBO mismatch found from a user screenshot — 2026-08-12

Same day, after the user separately deployed a different change ("I
deployed on another thread") mid-way through the backfill above — this
explained a genuine mystery (the *already-deployed* image somehow had this
session's brand-new sanity-cap code in it, confirmed by grepping the
deployed script directly over `fly ssh console`) and, combined with a
screenshot the user sent of the live Historical charts, surfaced two real
data problems:

- **One date's backfill ran against the pre-fix code, because the user's
  deploy landed mid-run.** The first production backfill pass (2024-07-28
  through the SSH-drop above) executed *before* that deploy went live for
  part of its range; the resumed gap-fill pass (2026-03-23–2026-06-19) ran
  *after*. 2025-12-19 fell in the first, unfixed portion and kept its
  corrupted `numberOfGuests=788` (`covers=840` instead of a real ~50-90),
  visibly spiking the Covers chart's December bar in a screenshot the user
  sent. Fixed by re-running the backfill for just that one date
  (`--since=2025-12-19 --until=2025-12-19`) now that the real fix was
  live; verified no other date has a similar outlier via a blanket
  `covers > 200` scan across the whole table (empty result).
- **A second, previously-undiscovered mismatch, found from the same
  screenshot**: the user also flagged January's Average Spend Per Cover
  reading unusually low. Investigated directly against production data
  (not assumed): ~6% of open days (29 of 505, all-time) show real Toast
  covers alongside exactly $0 in *core* QBO revenue — not a missing sync,
  but real $0 rows. Checking a few individually found real money that day,
  just posted to a different GL bucket: 2025-06-22 (171 covers) shows $0
  core revenue but $12,519 to "Off-Site Events – Food Revenue" — a private
  catering event Toast still logged real covers for, correctly excluded
  from *core dine-in* revenue by `CORE_REVENUE_ACCOUNT_NUMBERS` (same
  reasoning as excluding Event Sales/Catering everywhere else in this
  file), but with nothing filtering those covers out the same way on the
  Toast side. Left in, this produces a nonsensical ~$0/cover spend reading
  that corrupts a whole month's spend average, and (for the covers index)
  counts event attendance as regular walk-in demand. **Fixed** in
  `server/api/capacity/history.get.ts`: a day is now excluded from *both*
  indexes — not just spend — unless it has real, positive core revenue
  (`revenue == null || revenue <= 0` is skipped entirely when building
  `byYear`), not just real covers. `revenue == null` (no QBO sync yet for
  that date) gets the same treatment as a confirmed $0, since neither can
  confirm the day was genuine core dine-in. Verified the fix doesn't
  regress anything: local dev's own dataset (2026-05-01 onward) has zero
  days matching this pattern, so it was silently invisible there — this
  bug could only have been caught against real historical production data,
  which is exactly how the user's screenshot surfaced it. Not yet deployed
  to production — see "Not yet done" below.

## Revenue Seasonality restored as a third chart, composed from the other two — 2026-08-13

The user had asked for the original blended revenue index gone (see the
Historical tab section above) but, after seeing the new Covers and Spend
charts live, wanted it back as a third, complementary chart rather than
staying gone — a "which months actually made the most money" headline,
with Covers and Spend underneath explaining *why*. Asked which layout to
use — stacked on one page (revenue first) vs. tabs with revenue as the
default — and recommended stacked: the whole point of splitting revenue
into its two drivers was to let you connect "revenue was up" with "was
that more covers or higher spend," which tabs would undermine by hiding
the components behind a click. The user agreed.

- **`revenueSeries`** (`server/api/capacity/history.get.ts`) uses the exact
  same "index to own average" technique as `coversSeries`/`spendSeries`,
  built directly off each `DayPoint`'s real `revenue` — not derived as
  `coversIndex × spendIndex`, which would drift from a true revenue
  average (averaging two ratios and multiplying isn't the same as
  averaging their product, since covers and spend aren't independent).
  Since `spend := revenue / covers`, `covers × spend` is definitionally
  just `revenue` again — so building the index straight off `d.revenue`
  is both simpler and more correct than multiplying two already-computed
  indexes back together.
  `yearAvg`/`periodAvgFor`/`buildSeries` were generalized from a
  `'covers' | 'spend'` union to a `Metric = 'covers' | 'spend' | 'revenue'`
  one (with a small `metricValue`/`avgOf` helper pair replacing the
  inline ternaries that used to live in each function) rather than adding
  a third near-duplicate function — this is exactly the kind of
  three-times-repeated logic worth collapsing.
- `locationBaselines` (see the section above) gained a matching `revenue`
  entry the same way, via a small `baselinesFor(metric)` helper replacing
  the two hand-written `covers`/`spend` object literals.
- Rendered on [`app/pages/historical.vue`](app/pages/historical.vue) as
  the first section on the page, ahead of Covers and Spend, using the same
  generalized `SeasonalityChart.vue` component (`metric-label="Revenue"`).
- Verified in the browser against real local data: June read 42% and July
  123% on the new Revenue chart, closely tracking the already-verified
  Spend chart's 44%/122% for the same months — expected, since Covers was
  close to its own 100% average both months (96-104%), so
  revenue ≈ spend × (covers ≈ 100%) tracks spend almost directly. Also
  spot-checked that Edit Capacity's "Set by History" (which shares the
  generalized `yearAvg`/`periodAvgFor` helpers but still reads only the
  `covers` metric) still works unchanged.

## Daytime pop-up/market events were inflating covers — 5pm dinner-hour cutoff — 2026-08-13

Found by the user manually cross-checking January 2025 against the real
Toast CSV export in Numbers (grouped by date) after the ranked-months
answer above showed January with an oddly thin 9 open days out of 31 — they
counted ~18 "regular-looking dinner service days" themselves and flagged
the mismatch, then spotted the cause directly in the data: 2025-01-19
shows 39 separate orders between 11:59am-3:48pm, every one a `guests=1`
stub from a single server, no evening orders at all — a daytime pop-up or
winter-market event, not dinner service, but still landing in that day's
Toast covers total. The user's rule: ignore anything before 5pm, on the
reasoning that a real dinner guest couldn't plausibly be seated and have
ordered before then.

- Verified two things live against the API before building anything (same
  discipline as every other fix in this file): pulled 2025-01-19's real
  orders and confirmed all 39 are pre-5pm stubs exactly as described; then
  sampled ~17 other January dates and confirmed normal dinner nights carry
  only 0-3 stray pre-5pm orders (always `guests=1`, e.g. a gift card sale,
  never a real seated party) — so a 5pm cutoff costs a real dinner night
  almost nothing while fully zeroing out an all-daytime day like
  2025-01-19 (which previously inflated its covers to 39, on par with a
  real dinner night, and had been slipping through undetected because its
  core revenue happened to be $0 — not a rule this app enforces, just a
  coincidence of which GL account market-event revenue landed in).
- **Fixed** with `MIN_DINNER_HOUR_LOCAL = 17` in both
  `server/utils/toast-metrics-sync.ts` (the live nightly sync) and
  `scripts/backfill-toast-metrics.mjs` (duplicated, same reasoning as
  `MAX_PLAUSIBLE_GUESTS_PER_ORDER`/`MIN_COVERS_FOR_OPEN_DAY` elsewhere in
  this file) — an order only counts toward a day's covers if its
  `openedDate`, converted to `America/New_York` local time via
  `Intl.DateTimeFormat` (matching `qbo-nightly-sync.ts`'s own
  IANA-zone-aware pattern), falls at or after 5pm.
- **Local dev re-backfilled** (`npm run db:backfill-toast --
  --since=2024-08-01`, all 741 days, idempotent re-write) — verified
  January 2025 now shows exactly 18 days with covers ≥15
  (`MIN_COVERS_FOR_OPEN_DAY`), an exact match to the user's own manual
  count from the CSV, and 2025-01-19 correctly reads `covers=0`.
- **Not yet deployed or re-backfilled in production** — this is a code
  change (not just a data backfill like the earlier production fixes), so
  it needs `fly deploy` first, then the same `--since=2024-07-28` backfill
  re-run via `fly ssh console` used for the earlier production backfills.

## Real per-area covers/revenue on the Edit Capacity page — 2026-08-13

Closes the per-area actuals gap flagged in "Not yet done" below (previously
blocked on Toast's Configuration API 403ing). The user granted the
existing `TOAST_*` credential Configuration API scope in Toast's own
developer console (`orders:read`/`labor:read` plus a new config scope),
which unblocked `/config/v2/tables` live — confirmed before writing any
code, following the same "verify against the live API first" discipline
as every other Toast/QBO integration in this file.

- **Classifies by the restaurant's own table-numbering convention, not
  Toast's `RevenueCenter` field** — confirmed live that `RevenueCenter` is
  a worse signal for this restaurant's real 5-area breakdown: it groups
  Bar and Salon tables into one "Bar" revenue center, and misfiles table
  `C2` under "Dining Room" instead of "Chef's Counter" (a real Toast admin
  misconfiguration, not a bug in this code). The user supplied the real
  naming convention directly (confirmed against the live floor plan and
  `/config/v2/tables`, 44 real tables): banquette 1-7 and 20s → Dining
  Room, 30s/40s → Salon, 50s → Outdoor, `B<n>` → Bar, `C<n>` → Chef's
  Counter. See `classifyTableName()` in
  [`server/utils/toast-table-map.ts`](server/utils/toast-table-map.ts)
  (duplicated into `scripts/backfill-toast-metrics.mjs` for the usual
  Node-22 reason).
- **`daily_toast_area_metrics`** (schema.sql) is a new table — one row per
  (date, area), `covers`/`revenue` summed from each dinner-hour,
  non-deleted order's classified table and non-voided check totals. Reuses
  the exact same order fetch as the existing whole-restaurant
  `daily_toast_metrics` sync (no second API call) —
  [`server/utils/toast-metrics-sync.ts`](server/utils/toast-metrics-sync.ts)'s
  `syncToastMetricsForDate` now writes both tables from one
  `ordersBulk` pull, folded into the same nightly sync
  (`runNightlySync`) with no separate scheduler.
- **Revenue here is necessarily Toast's own check totals, not QBO's** —
  unlike `history.get.ts`'s "core dine-in revenue" concept (which excludes
  event/catering revenue via QBO account numbers), there's no per-check
  revenue-category signal to do the same exclusion at the table level, so
  a day with a private buyout at a given table will read high. Documented
  as a known simplification directly in schema.sql, not silently accepted.
- **[`server/api/capacity/area-actuals.get.ts`](server/api/capacity/area-actuals.get.ts)**
  returns this-month/last-month per-area covers, revenue, and $/cover,
  capped at `MAX(date)` in `daily_toast_area_metrics` (not today's
  calendar date) — mirrors `capacity.get.ts`'s own `asOfDate` pattern,
  since Toast sync freshness can lag the wall clock by a day or two.
  [`app/pages/capacity/edit.vue`](app/pages/capacity/edit.vue)'s
  Per-Area Capacity & Revenue table gained two new read-only "Actual
  (Month)" columns next to the existing aspirational Per-Cover Revenue
  (Total) column — display only, never fed back into the editable covers
  inputs (unlike "Set by History," a $/cover actual has no natural slot in
  the covers-based draft shape, and silently blending "what we assume"
  with "what Toast measured" would be the wrong call here).
- **Verified against real local data**: local dev backfilled for
  2026-07-01 through 2026-08-11 (`npm run db:backfill-toast --
  --since=2026-07-01 --until=2026-08-11`); per-area covers summed across
  Aug 1-11 (727 of 757 whole-restaurant covers — the gap is orders with no
  table or an unclassified table name, e.g. gift cards) and the resulting
  $/cover figures rendered in the browser look directionally sane against
  the assumed targets (Dining Room actual ~$118-123 vs. assumed $110;
  Chef's Counter actual ~$180-191 vs. assumed $258 — a real gap worth the
  user's own follow-up, not investigated further here).
- **Not yet deployed to production** — needs `daily_toast_area_metrics`
  created on the production volume by hand (same manual-migration posture
  as every other schema addition to an existing volume in this file), a
  `fly deploy`, and a production backfill re-run
  (`npm run db:backfill-toast -- --since=2024-07-28`, matching production's
  existing QBO revenue floor) to populate historical per-area rows. The
  Toast credential's new Configuration API scope is shared by both
  environments (same client id/secret), so no separate production
  credential change is needed.

## Chef's Counter's real food revenue isn't reliably in Toast — flat $190/cover assumption — 2026-08-13

The user flagged that production's Chef's Counter actuals (from the section
above) looked off, and explained why: Chef's Counter tickets are sold at a
flat $190/person, but purchased two ways — day-of walk-up (rung directly in
Toast) or prepaid in advance via Stripe, which never touches Toast at all.
Confirmed against a real Toast Product Mix CSV export the user shared
(2026-08-12) and the live Orders API for the same date: a "Day Of Chef's
Counter" selection rings at $190, but "Pre-Paid Chef's Counter" rings at
exactly $0.00 — the real money already moved through Stripe when the
ticket was bought, so summing `check.totalAmount` (the existing per-area
revenue calculation) silently drops that revenue on any day with prepaid
tickets. Per the user's own explicit instruction: assume every Chef's
Counter cover is worth a flat $190 of food regardless of which path it
came through, and only trust Toast for the beverage side (drinks are
always ordered/paid through Toast directly, no Stripe involved there).

- **`daily_toast_area_metrics` gained two new nullable columns**,
  `food_revenue`/`beverage_revenue` — NULL for every area except Chef's
  Counter. For Chef's Counter specifically (only),
  `syncToastMetricsForDate` (`server/utils/toast-metrics-sync.ts`) now
  computes `food_revenue = numberOfGuests × 190` and
  `beverage_revenue` = the sum of every non-voided check selection
  *except* the two known prix-fixe item names ("Day Of Chef's Counter",
  "Pre-Paid Chef's Counter") — confirmed live that every other selection
  on a real Chef's Counter check is a real drink (cocktail/wine/beer/
  zero-proof), so no separate allowlist is needed. `revenue` (the existing
  column) is now `food_revenue + beverage_revenue` for this one area,
  replacing the old check-total sum; every other area's `revenue` is
  unchanged. Duplicated into `scripts/backfill-toast-metrics.mjs` for the
  usual Node-22 reason.
- **`area-actuals.get.ts`'s trailing-two-month blend now prefers this real
  split over the whole-restaurant Food/Beverage mix approximation** — the
  Edit Capacity page's "Set from Actuals" button (see the section above)
  writes Chef's Counter's real `perCoverFood`/`perCoverBeverage` (always
  $190.00 flat for food) directly, only falling back to the mix-based
  split for areas with no real per-area food/beverage signal (everywhere
  else).
- **Verified against real local data**: re-backfilled Jul 1 – Aug 12 2026;
  2026-08-12 shows `covers=4, food_revenue=760` (exactly 4×190) and a real,
  distinct `beverage_revenue=114` — no longer $0-contaminated. The trailing
  two-month blend moved from the old (wrong) ~$190-198/cover blended actual
  to Food $190.00/cover (exactly the assumption, as expected) + Beverage
  ~$50.37/cover — a materially more plausible number than the old
  check-total-based one, and directly comparable to the assumed $190
  Food / $70 Beverage split on the Edit Capacity page.
- **Not yet deployed or re-backfilled in production** — same deploy +
  backfill steps as the section above; this is now bundled into the same
  not-yet-deployed change.

## Per-area revenue was using check.totalAmount (includes tax + tip), not the real subtotal — 2026-08-13

Same day, right after production's first deploy of the per-area actuals
feature: the user flagged that Dining Room's actuals (the largest area,
~1,678 of ~3,179 classified covers over the verification window) looked
too high compared to expectations. Investigated by pulling a handful of
real checks live rather than guessing: `check.totalAmount` is **not** a
revenue figure at all — it's `check.amount` (the real pre-tax, pre-tip
subtotal) **plus** `taxAmount` **plus** the payment's tip, confirmed
exactly against several real checks (e.g. `amount=244, taxAmount=17.08,
tip=52.22` summing to the observed `totalAmount=313.30`). Every per-area
revenue sum except Chef's Counter's (which already summed real selection
prices, never `totalAmount`) had been overstating real revenue by
whatever fraction of each check was tax + gratuity — commonly 20%+.

- **Fixed** in both `syncToastMetricsForDate`
  (`server/utils/toast-metrics-sync.ts`) and
  `scripts/backfill-toast-metrics.mjs`: the non-Chef's-Counter revenue sum
  now uses `check.amount`, not `check.totalAmount`.
  `schema.sql`'s `daily_toast_area_metrics.revenue` comment updated to
  match.
- **Verified against real local data** (re-backfilled Jul 1 – Aug 12
  2026): Dining Room's blended actual dropped from ~$118-123/cover to a
  much more plausible **$91.86/cover**, with no more single-day outliers
  (previously up to $140/cover on some days, now a tight $87-111/cover
  range). Cross-checked against the whole-restaurant blended core avg
  check from QBO (`$76.19/cover` over the same window, via
  `history.get.ts`'s own `CORE_REVENUE_ACCOUNT_NUMBERS`) — Dining Room
  running somewhat above that blended figure, and Chef's Counter well
  above it, both make directional sense (Chef's Counter is a premium
  fixed-price experience; Bar/Salon/Outdoor's lower per-covers pull the
  restaurant-wide blend down). Bar, Salon, and Outdoor all dropped
  similarly (e.g. Bar $88.90→$64.06, Salon $53-59→$43.54).
- **Not yet deployed or re-backfilled in production** — bundled into the
  same not-yet-deployed change as the two sections above; the production
  re-backfill (`--since=2026-07-01`, or wider) will need to run again once
  more after this fix deploys, on top of the Chef's Counter fix's own
  re-backfill.

## "Set by History" now weights per-area splits by a real fill-rate index — 2026-08-13

The user asked how to make the Edit Capacity page's per-area covers more
accurate, now that real per-area Toast data exists. "Set by History"
previously split a month's seasonal covers target equally across every
area's own capacity — a known simplification from when it was built (see
"Per-area expected covers replace the blended fill %" above), not yet
revisited since real per-area actuals existed.

The real per-area data only covers the ~8 weeks since the Cambridge St
move (2026-06-20) — nowhere near a full seasonal year, and Bar/Salon have
*zero* prior-location history (Mass Ave never had those spaces). Discussed
directly with the user whether the per-area split itself should vary by
month given this thin sample; landed on **no** — a flat (non-seasonal)
per-area index, at the user's explicit choice, rather than trying to
extract month-to-month per-area shape from 8 weeks of data for 3 of the
12 months and falling back to equal-split for the other 9 (considered and
rejected as inconsistent). The existing whole-restaurant `monthlyIndex`
(2+ years of real history) still drives the seasonal *total* per month,
unchanged — only how that total splits across the 5 areas changes.

- **`areaFillIndex`** (`server/api/capacity/history.get.ts`) is a flat,
  per-area relative index: each area's own real fill% since the move
  (`covers ÷ capacity_may_oct`) divided by the restaurant-wide blended
  fill% over the same window — dimensionless, so it can be applied
  directly against any month's capacity for that area on the client.
  Deliberately a fill%-*ratio*, not a raw share of total covers — a raw
  share would conflate room size with real demand (a bigger room always
  gets more raw covers) and, more importantly, wouldn't respect a
  seasonally-closed area's 0 capacity the way a ratio applied against that
  month's own capacity does automatically. This is also why outdoor
  seating's real seasonal question (does it ramp up/down slowly in spring/
  fall, does peak-summer heat suppress it) didn't need answering here at
  all: Outdoor's capacity is already 0 in Nov-Apr in the existing model,
  so 0 capacity × any index is still 0 — the flat index doesn't fight that.
  Real local values: Chef's Counter 1.99 (small, reservation-driven,
  effectively always full), Dining Room 1.53, Bar 1.11, Outdoor 0.61,
  Salon 0.28 (confirms the user's own earlier read that Salon is
  underperforming).
- **`applySetByHistory`** (`app/pages/capacity/edit.vue`) now weights each
  area's exact target by `areaFillIndexFor(a.id)` (defaulting to 1 — equal
  weighting, the old behavior — for any area with no real index) before
  the existing largest-remainder rounding, but the *total* target is still
  computed from the unweighted whole-restaurant fraction, so the overall
  seasonal total per month is unchanged — only the mix across areas shifts.
  Each area's exact target is also clamped to its own capacity (a real
  possibility once weighting is uneven, e.g. Chef's Counter's 1.99 index
  combined with an already-high-fill month could otherwise ask for more
  covers than it seats), with the rounding leftover distributed only among
  areas still below their cap.
- **Verified**: `/api/capacity/history` returns the expected index values
  against real local data (matching a hand calculation), and
  `/capacity/edit` still renders (200) with the new weighting live.

## "Set by History"'s baseline is now data-driven, not anchored to whatever's on the page — 2026-08-13

Same day, after the user deployed the section above and asked where the
"blended %" shown under each "Set by History" button actually came from.
Answer at the time: only the *shape* (`monthlyIndex`, which month is
busier/slower) was real Toast history — the *baseline level* it scaled
against (`currentAnnualFillPct`) was just whatever fill % was implied by
the numbers already typed into the covers grid, stale or optimistic or
otherwise. The user said directly they didn't want that dependency; they
want the expected-covers numbers "as data-driven as possible," accepting
today's data limitations.

- **The real complication, discussed with the user before building**: only
  ~8 weeks of real Cambridge St data exist (since the 2026-06-20 move),
  all of it summer — using that raw window's fill % as if it were the
  annual average would just trade one bias (a stale manual guess) for
  another (assuming summer performance is typical). Two options were
  presented: use the raw summer average as-is, or de-seasonalize it using
  the same historical monthly shape `monthlyIndex` already provides. The
  user picked de-seasonalizing.
- **`dataAnnualFillPct`** (`server/api/capacity/history.get.ts`) divides
  real total covers since the move by an "expected capacity contribution"
  that already accounts for each day's own month running historically hot
  or cold (`totalCapacityMayOct × monthlyIndex[month]/100`, summed per real
  open day) — so a summer running exactly at its historically-typical
  elevated level correctly implies an annual baseline *below* the raw
  summer fill %, not equal to it. This does lean on one assumption, stated
  directly to the user rather than hidden: Mass Ave's historical
  month-to-month demand *shape* is assumed to still roughly hold for
  Cambridge St (the room-size-specific part — absolute fill level — is
  already handled separately by `areaFillIndex`/`capacity_areas`, so this
  assumption is narrower than it might first sound). Best available proxy
  until a full year of Cambridge St-only history replaces it.
- **`currentAnnualFillPct` was removed outright**, not left alongside the
  new baseline — `historyTargetFraction`/`historyTooltip` in
  `app/pages/capacity/edit.vue` now read `dataAnnualFillPct` from the
  server exclusively, matching this file's own "delete rather than
  half-finish" posture when a design genuinely pivots rather than gains an
  option.
- **Local dev can't show a real nonzero value for this** — the same
  already-documented gap as the Historical tab's spend index:
  `daily_line_items` (QBO) only reaches back to 2026-05-01 locally, so
  `monthlyIndex` is null for every month in local dev (no 2024/2025 QBO
  data to build `historicalYears` from), which makes `dataAnnualFillPct`
  null too — correctly, not a bug. Verified instead by feeding the same
  real local Toast-covers/capacity data through the formula with
  substituted fake index values (110%/115%/105% for Jun/Jul/Aug), which
  produced a sane, non-NaN baseline (~34.7%) — confirming the arithmetic
  itself is sound; the real number will only be computable once checked
  against production's full history. `/api/capacity/history` and
  `/capacity/edit` were both confirmed to still return 200 locally with
  `dataAnnualFillPct: null` handled gracefully throughout (button stays
  disabled with an explanatory tooltip, same pattern as no historical
  index for a month).
- **Not yet deployed to production.**

## Not yet done

- Running the production Toast covers backfill (`npm run db:backfill-toast`
  extended further back, via `fly ssh console`) so the Historical page's
  two indexes show a real multi-year comparison in production the way
  local dev now does — see the Historical tab section above. Deliberately
  left for the user to confirm before touching production data.
- Per-area (table-level) actuals for the Edit Capacity page's Per-Cover
  Revenue table — unblocked and built 2026-08-13 (see "Real per-area
  covers/revenue on the Edit Capacity page" above), but not yet deployed
  to production. Still open: feeding this into a truly measured historical
  fill % (see the bookmark below), and Bar/Salon's own multi-year history
  once Cambridge St has a full year of real data the way Mass Ave's
  RevenueCenter-based Bar grouping never needed to distinguish from Salon.
- Deploying the Capacity Nov–Apr/May–Oct calculation change (above) to
  production and saving once there to correct Salon's stale stored capacity
  (80/80 vs. the correct 60/60) — done in local dev only so far.
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
- Feeding Capacity's projected revenue further than the Budget tab's
  Revenue section — closed at the Food/Beverage grain 2026-08-10 (see
  "Capacity revenue feeds the Budget tab" above); making Budget's revenue
  line items fully derived/read-only (rather than a one-click "recompute"
  the user can choose to apply or skip) was raised but not built, and a
  further beer/liquor/wine/non-alcoholic split was deliberately ruled out
  since Capacity's covers × per-cover model has no real basis for it — see
  that section for why.
- A real, currently-live inconsistency found while building the above,
  not fixed as part of it (out of scope — see the flagged follow-up task):
  several accounts that are themselves a parent (have children) also carry
  their own nonzero stored `budget_targets` row today — e.g. account 5100
  Beverage COGS has real Sep-Dec 2026 amounts alongside its own children's
  amounts, and the same pattern shows up on at least two opex accounts.
  `useBudgetData.ts`'s flat `categoryTotals()`/`monthCategoryBudget()`
  (Budget Pace page) sum every account's raw amount regardless of
  parent/child, which double-counts these; `budget/edit.vue`'s account-tree
  display (`computedAccountAmount`) does the opposite — it always
  recomputes a parent's amount as the sum of its children and silently
  never shows the parent's own stored figure at all. Same root cause the
  COGS recompute section above already flagged (a filter that doesn't
  check `isLeafAccount`), but reaches further than just that one recompute
  button — it affects any code path that sums `budget_targets` without
  walking the account tree.
- The Historical tab's covers index and the app's other Fill %/Capacity
  Pace figures still mean two different things (covers-relative-to-own-
  average vs. covers ÷ theoretical max seats) — bookmarked by the user
  2026-08-10, partially closed 2026-08-12 (see the Historical tab section
  above: real historical Toast covers data now exists, reaching back
  through the Mass Ave era, which didn't before). What's still missing for
  a truly *measured* historical fill % specifically is the old Mass Ave
  location's actual seat/table capacity per area — never recorded anywhere
  in this app (`capacity_areas` only ever held the current/new location's
  config). Without it, the recommended approach is still the same: a
  derived fill %, reusing "Set by History"'s own baseline-scaling
  transformation, not a directly measured one.

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
- [`server/utils/toast-metrics-sync.ts`](server/utils/toast-metrics-sync.ts) — covers + labor-hours sync, plus per-area covers/revenue
- [`server/utils/toast-table-map.ts`](server/utils/toast-table-map.ts) — resolves a Toast table GUID to a real dining area by table-name convention
- [`server/api/capacity/area-actuals.get.ts`](server/api/capacity/area-actuals.get.ts) — this-month/last-month real per-area covers/revenue, shown on the Edit Capacity page
- [`scripts/backfill-toast-metrics.mjs`](scripts/backfill-toast-metrics.mjs) — one-time historical Toast backfill (whole-restaurant + per-area)
- [`server/api/budget/`](server/api/budget/) — budget read/write, copy-actuals, and QBO export routes
- [`scripts/init-db.mjs`](scripts/init-db.mjs) — creates the SQLite file from `schema.sql`
- [`scripts/import-budget-xlsx.mjs`](scripts/import-budget-xlsx.mjs) — one-time seed of accounts + budget from a real QBO budget export
- `data/qbo-budget-template.xlsx` — sanitized export template (checked in; the real xlsx it came from is not)
- [`app/pages/capacity/index.vue`](app/pages/capacity/index.vue) — Capacity Pace view (route `/capacity`)
- [`app/pages/capacity/edit.vue`](app/pages/capacity/edit.vue) — editable capacity/turns/per-cover-revenue + monthly fill %/holiday closures (route `/capacity/edit`)
- [`server/api/capacity.get.ts`](server/api/capacity.get.ts) — Capacity tab's projection-vs-actual data route
- [`server/api/capacity/settings.get.ts`](server/api/capacity/settings.get.ts) / [`settings.post.ts`](server/api/capacity/settings.post.ts) — load/save capacity assumptions
- [`scripts/import-capacity-projections.mjs`](scripts/import-capacity-projections.mjs) — one-time seed of `capacity_areas`/`capacity_seasonality` from the real capacity worksheet
- [`scripts/migrate-capacity-revenue-split.mjs`](scripts/migrate-capacity-revenue-split.mjs) — one-time migration splitting `capacity_areas.per_cover_revenue` into Food/Beverage
- [`app/pages/historical.vue`](app/pages/historical.vue) — Historical tab: covers + spend-per-cover seasonality charts (route `/historical`)
- [`server/api/capacity/history.get.ts`](server/api/capacity/history.get.ts) — covers + spend-per-cover seasonality indexes, derived from real Toast covers and core-revenue QBO history, backing both "Set by History" and the Historical tab's two charts
- [`app/components/SeasonalityChart.vue`](app/components/SeasonalityChart.vue) — the monthly grouped-bar seasonality chart used twice on the Historical tab (covers, spend-per-cover)
- [`scripts/backfill-toast-metrics.mjs`](scripts/backfill-toast-metrics.mjs) — one-time historical Toast covers/labor-hours backfill (see "Toast POS integration" above); re-run with an extended `--since` 2026-08-12 to reach back through the Mass Ave era for the Historical tab's two indexes
- [`app/pages/budget/edit.vue`](app/pages/budget/edit.vue)'s "Recompute Revenue from Capacity" section — feeds Capacity's projected Food/Beverage revenue into the Budget tab's real revenue accounts (see "Capacity revenue feeds the Budget tab" above)
- [`server/api/budget/beverage-revenue-mix.get.ts`](server/api/budget/beverage-revenue-mix.get.ts) — real Beer/Liquor/Wine/Non-Alcoholic revenue split since the location move, used by the Recompute Revenue action above
