# Restaurant Pulse: project history (archive)

Dated working notes moved out of CLAUDE.md on 2026-11-11 so every session doesn't load them. CLAUDE.md
holds the current rules and decisions; this file keeps the full story behind them: why things were built,
incidents, verification details and superseded designs. Newer notes are appended at the end as
CLAUDE.md is trimmed. Section names referenced from CLAUDE.md ("see ...") are headings below.

Read it when you need the reasoning behind a rule, the history of a feature, or the details of a past
incident. Later sections win where they disagree with earlier ones.

---

# Snapshot of CLAUDE.md as of 2026-11-11 (complete, verbatim)

## (Original title: Restaurant Pulse)

**Status (updated 2026-11-09): live in production.** The app is wired to real QuickBooks and
Toast data, runs a nightly sync, has per-person roles behind Cloudflare Access, and is organized
into five sections (Home, Sales, Team, Money, Planning). Most sections below are dated working
notes written as features were built; read them as history, and trust the later ones where they
disagree with an earlier one.

**Terminology (2026-11-09).** The app's wording was made plainer; older sections of this file,
`schema.sql` and the code still use the old names:
COGS = "Food & drink cost"; Opex = "operating expenses"; benchmark = "target" (on screen);
Free Cash Flow = "cash left after loans"; Debt Service = "loan payments"; DSCR = "loan coverage
ratio"; EBITDA = "operating profit before interest & depreciation". Page names changed in the
2026-11-08 navigation cleanup (see that section). Net Income and Prime cost are unchanged.

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
   **Also add two DNS-only (grey cloud) records, or the cert silently
   fails to renew ~90 days later** (found 2026-10-21 — the cert expired and
   Cloudflare served error 525 "SSL handshake failed"; Fly can't validate a
   proxied domain on its own): `CNAME _acme-challenge.pulse` →
   `pulse.urbanhearth.net.93gxm22.flydns.net`, and `TXT
   _fly-ownership.pulse` → `app-93gxm22` (exact values come from `fly certs
   setup pulse.urbanhearth.net`). Both are now in place; Fly renews via DNS
   validation and `fly certs show` should read "Issued" with a future expiry.
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
- `npm run db:migrate` — applies pending schema migrations (also runs automatically before `npm run dev`
  and on every production start); see "Database migrations run automatically on deploy"
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
  as "2740," which conflicted with a "DR 2740 NP ..." note in the investor
  workbook. **Resolved 2026-11-09 by the user: the SBA loan is QBO account
  2740 and the investor Price loan is 2702** (the workbook note was
  wrong). `loan_schedule` still uses slugs, so nothing in the code depends
  on either number.
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

## Reserve target and reserve-funded loans widened to all 9 investor notes — 2026-08-15

A SaasAnt Expense import built this day changed how Chen/Savage/Schaefer/
Gilreath/Mis/Price/Reid's loan payments actually post in QBO — not just
Jones & Miller's, as assumed above — so all 9 investor loans' payments,
including each of the 7 original loans' Dec 20, 2026 catch-up interest
**and** first regular installment together, now draw from the 1005 reserve
account, rather than the 7 loans' regular installment coming from separate
operating cash as the section above assumed. Two related updates in
`server/api/cashflow.get.ts`, both driven by that same underlying fact:

- **`reserveFundedRows`** widened from `loan_key === 'jones' ||
  loan_key === 'miller'` to `loan_key !== 'sba'` — every loan except the
  Eastern Bank SBA loan (still paid directly from operating cash, unchanged)
  now counts as a withdrawal from this account in `reserveProgress()`'s
  running-balance simulation.
- **`reserveTarget`** widened from $50,562.50 (pure catch-up interest across
  the 7 original loans) to $61,693.48 — the full Dec 20 cash payment across
  those same 7 loans (catch-up interest + first regular installment
  combined), since the target has always meant "how much needs to be
  sitting in the account right before Dec 20," and now the whole payment,
  not just its catch-up portion, comes out of it. (This is a separate
  widening from the one reverted 2026-07-31 above, which was about folding
  Jones & Miller's own catch-up into this static target — that reasoning
  still holds unchanged: their catch-up stays modeled as an ordinary
  scheduled withdrawal in the simulation, never folded into the target
  itself.)

**A related double-count caught the next day, 2026-08-16**: `freeCashFlow()`'s
"profit needed to cover the loans" figure was still subtracting all
reserve-funded loans' debt service directly, on top of the reserve transfers
already subtracted for the same cash — a minor discrepancy back when only
Jones/Miller drew from reserve, but a real double-count once
`reserveFundedRows` covered all 9 loans (the same cash counted twice: once
when it left operating cash as a reserve transfer, again when it left the
reserve to pay a lender). Found after the user pointed out the reserve
transfers exist specifically to cover these loan payments, which made
subtracting both confusing — and, on inspection, wrong. Fixed by scoping
that subtraction to SBA's debt service only (the one loan still paid
directly from operating cash); the other loans' debt service is still
summarized in full for display elsewhere (`thisYear.debtService`,
`fullYearReserveFunded`) — only the Free Cash Flow subtraction itself is
scoped to SBA.

**Confirmed still accurate, 2026-09-28** — raised after the user found (from
a real QBO register screenshot) that the SBA loan specifically is paid via a
direct transfer from Amex Checking that bypasses the reserve entirely, and
asked whether that explained why the reserve was running ahead of pace. It
wasn't the cause — SBA was already excluded from `reserveFundedRows`, per
this section — but it prompted confirming directly with the user whether the
other 7 investor loans' payments (including their Dec 20 catch-up + first
installment, which the $61,693.48 target above is built from) still really
draw from the 1005 reserve the way this section assumes, rather than having
also since moved to a direct-from-checking setup like SBA's. Confirmed yes —
no code change needed.

This section documents code that's been live since 2026-08-15/16 but was
never written up here until now — a real gap between the code and this file,
caught 2026-09-28 while investigating the reserve-ahead-of-pace question
above.

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
    `covers=1, revenue=$10,582.24` — a nonsensical $10,582/cover reading that
    swamped July's whole-month average before this was caught (July's spend
    index briefly read 10% in one intermediate build, an obviously-wrong
    number that's what surfaced this in the first place). **Corrected
    2026-11-08: this was not a private event.** Toast shows 1 cover and 0.0
    labor hours that day, so the restaurant was closed; the $10.6K of core
    revenue QBO carries on that date is probably a posting-date artifact
    (Jul 2 through Jul 5 all show $9.6K to $10.6K). Fixed with
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

## Chef's Counter revenue now follows Toast's real checks — 2026-10-30

Prompted by the user asking what Chef's Counter makes on a Tuesday. The counter seats 6
(C1-C6 are seat numbers) with 2 turns, so at most **12 covers a night**; the $190 prix fixe
runs **Tue-Sat only** (the counter seats a la carte guests on other nights, or on
one-turn nights). The old sync set food to `guests x $190` for every night, which
invented Sunday revenue, and a first fix (`$190 x prix fixe selections`) still showed
~24 tickets on most Fridays. Root cause, verified live and against Toast's own Sales Summary
for 2026-10-29 (Chef's Counter revenue center = **$3,337 net**):

- **Prepaid guests are rung twice.** Each seat's check carries "Pre-Paid Chef's Counter xN"
  at **$0** (just to open the order). The real money is rung separately, in bulk, as one
  "Day Of Chef's Counter xN" check at $190 each, paid with the **Stripe** alternate payment
  type (payment `type = OTHER`), rung in ~30 seconds at odd times (sometimes 11pm), on
  whatever table is handy (table 51/outdoor, or no table). On Oct 29: 12 prepaid + a
  Stripe bulk check of 12 ($2,280) + $1,057 of seat-check drinks/pairings = $3,337.
- **Fixed** in `syncToastMetricsForDate` and `scripts/backfill-toast-metrics.mjs`
  (`isBulkPrixFixeCheck`, `chefsCounterCheckSplit`): Chef's Counter `revenue` = real check
  subtotals (`check.amount`, which includes multi-quantity drinks and modifiers);
  `food_revenue` = dollars rung on "Day Of" selections (the Stripe bulk check plus genuine
  walk-up tickets); `beverage_revenue` = the rest (drinks, pairings, and on a la carte
  nights a la carte food). **Covers** = Pre-Paid selections + Day Of selections not on a
  bulk-paid check; on a night with none, covers = seated guests. Bulk checks are routed to
  Chef's Counter by content, not table (they used to land in Outdoor or be dropped).
  No `$190` constant remains; no schema change.
- **Result**: no night exceeds 12 covers on prix fixe nights; Oct 29 ties to Toast's
  $3,337 exactly. Weekday prix fixe dollars for Aug 1-Oct 17 land within ~2% of the
  colleague's OpenTable totals (Tue $9,690 / Wed $12,160 / Thu $14,820 / Fri $25,080 /
  Sat $19,380 over ~the same window; ours $79,420 vs $81,130 overall).
- **Local dev re-backfilled** from 2026-06-20. **Production is not yet fixed**: needs
  `fly deploy`, then re-run the backfill in the container (`fly ssh console -C "node
  scripts/backfill-toast-metrics.mjs --since=2026-06-20"`). Production's Edit Capacity
  Chef's Counter per-cover figures (and `follow_actuals` month-close blends) read these rows.
- **Known gaps**: a bulk check's tickets can exceed the prepaid seats rung (no-shows who
  paid, or a buyout, e.g. 2026-09-29's 19-ticket check) - that revenue counts but not
  covers. Ticketed event dinners (2026-10-20 "Prepaid Mushroom Dinner") aren't prix fixes
  and read ~$0. The sync only sees dinner-hour (5pm+) orders, so a bulk check rung earlier
  would be missed. Whole-restaurant `daily_toast_metrics.covers` is unchanged.

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

## P&L Drill-Downs page — week-only Wages view, per-period revenue comparison basis, materiality thresholds — 2026-08-17

Three related changes to [`app/pages/pl/drilldowns.vue`](app/pages/pl/drilldowns.vue) /
[`server/api/pl.get.ts`](server/api/pl.get.ts) (the page behind the P&L tab's
"Drill-Downs" nav link — not yet listed in Where to look below until this
section, an existing gap), all from the same conversation:

- **Week now gets a purpose-built Wages Drill-Down instead of the
  anomaly-flagged Labor Drill-Down, and the Opex section is hidden
  entirely** — per the user's own framing: wages (specifically everything
  under 6010 BOH Wages, 6030 FOH Wages, 6050 Management Salaries) and income
  are the only things worth a week-over-week look; Employee Benefits/
  Employer Payroll Taxes and opex don't move meaningfully at weekly grain.
  `pl.get.ts` narrows Week's `labor` rows server-side to exactly these three
  subcategories (`WEEKLY_WAGE_SUBCATEGORIES`), always all three even at $0,
  in a fixed order — the client renders a stable Total + 3-tile grid
  (`isWeeklyWagesView` in drilldowns.vue) rather than an anomaly list, so
  every row is always visible instead of being flag-gated. Comparison basis
  is the prior week (not budget — budget targets have no weekly resolution,
  and prorating one down to a week would need new approximation logic; the
  user chose prior-week for consistency with the rest of this page). The
  Revenue Calendar section is unchanged for Week — it was already the
  income comparison the user wanted.
- **The Revenue Calendar's per-day comparison basis now matches the
  selected period, instead of always being a fixed 7-days-back shift.** A
  real bug: previously Month and Year views' shortfall-day "gap" figure was
  actually a week-over-week gap (each day compared to the same weekday
  exactly 7 days earlier, even inside a Month/Year view), not a month- or
  year-over-year one — easy to misread as "this month's shortfall vs. last
  month." Fixed with real Nth-weekday-of-month matching
  (`sameWeekdayPositionInMonth` in pl.get.ts) — Week still uses the plain
  7-day shift (already same-weekday by construction); Month compares each
  day to the same weekday-position last month (e.g. "3rd Thursday of July"
  vs. "3rd Thursday of June"); Year compares to the same weekday-position,
  same month, last year. Matches the Dashboard's own documented "same
  weekday-position, not a fixed day-count offset" design (see the Design
  direction section above) — applied here to a whole period instead of a
  single day. The comparison-basis wording shown to the user ("the same
  weekday last month", legend chips like "Beat last month") is computed
  server-side (`revenueComparisonLabel`/`revenueComparisonShortLabel`) so
  the copy can't drift from the calculation.
- **Materiality threshold for flagging a Labor/Opex subcategory raised from
  a flat $200, and made period-specific**: $250 for Week/Month, **$1,000
  for Year** (`MATERIALITY_THRESHOLD_BY_PERIOD` in pl.get.ts) — a year's
  dollar totals run much larger, so $250 flagged almost every subcategory.
  Also fixed a real display issue while raising this: the threshold used to
  gate only the dollar *delta*, so a steep % drop off a much larger
  prior-period base (e.g. "Repairs & maintenance: $18, -99% vs. prior
  month") could clear the delta threshold easily even though the resulting
  figure was trivial and not worth a tile. `flagRows` now also requires the
  *current-period* amount itself to clear the threshold. Verified against
  real local data: this correctly dropped small-current-amount rows like
  "Insurance $207"/"Meals – 50% Deductible $96" (Month) and "Labor $884"/
  "Travel $799"/"Car Expenses $348" (Year) that were previously showing
  despite being visual noise.
- **Known, deliberately unaddressed caveat**: the Year drill-down's
  year-over-year comparison logic itself is correct (calendar-accurate
  `addMonthsClamped(-12)`, not a fixed-day-offset trick — verified while
  investigating this), but doesn't correct for the 2026 location move (old,
  smaller location through May vs. the new, larger, more expensive space
  from Jun 20 — see the Historical tab / capacity sections above for the
  same distortion documented elsewhere). A 2026-vs-2025 comparison on this
  page will show large increases across nearly every Labor/Opex
  subcategory that reflect the bigger space, not overspending — the same
  kind of distortion the Dashboard's year revenue pace and the Historical
  tab's charts already correct for, but this page does not. Flagged to the
  user 2026-08-17; they chose to leave it as-is for now rather than build a
  location-move correction here.

## Dashboard reframed as "Weekly Performance" — 2026-08-19

Replaces the Dashboard's Net Income (This Month/This Year) hero cards, Last
Night vs. History compare row, and Covers/Average Check stat cards with a
new **This Week's Targets** section: real, day-specific revenue/covers
targets for each operating night (Tue-Sun), scaled from a single editable
weekly "good week" revenue goal by the *real* weekday revenue pattern —
rather than one flat nightly number, which understates a slow Tuesday and
understates what Friday/Saturday should be (Fri/Sat reliably pull the
weekly average up). Sales/Labor Hour is the one card kept from the old
top-of-page layout, moved lower (its own small section, just above the
legend/footer) — the user's own explicit scope, confirmed via
`AskUserQuestion` before touching anything, since removing Net Income pace
and Last Night vs. History conflicts with CLAUDE.md's original "four daily
questions" framing (see "What this is" above) and felt too consequential to
assume. Net Income pace itself isn't gone from the app — Budget Runway
(unchanged, further down this same page) and Budget Pace already answer
"are we on pace to hit budget," which is what those cards were showing.

Started from a one-off hand-run analysis (not this codebase) the user had
already worked out in a prior chat: pull real core dine-in revenue by
weekday since the location move, find each weekday's share of a typical
week, and scale those shares to a benchmark instead of dividing evenly by
6. This session turned that into a live, dynamically-recalculated feature:

- **`weekly_revenue_benchmark`** (schema.sql) is a new single-row config
  table — same shape as `reserve_plan`, chosen over folding into
  `category_benchmarks` (wrong shape — that table is %-of-revenue cost
  ratios, not a revenue dollar target) or a hardcoded constant (this is a
  real number the user expects to revise). Edited inline on the Dashboard
  itself via a small form (`POST /api/dashboard/weekly-benchmark`), same
  pattern as Cash Flow's "Planned weekly amount" form for `reserve_plan` —
  the user's own choice over a separate settings page, since one editable
  number doesn't need its own route. Seeded locally at $50,000 (the user's
  own "memorable" figure from the prior chat); production still needs the
  same manual table creation + seed (see "Not yet done").
- **`CORE_REVENUE_ACCOUNT_NUMBERS` and `MIN_COVERS_FOR_OPEN_DAY`**,
  previously local consts in `server/api/capacity/history.get.ts`, were
  extracted to [`server/utils/core-revenue.ts`](server/utils/core-revenue.ts)
  so this feature reuses the exact same core-dine-in-revenue definition and
  open-day filter instead of re-deriving them — `history.get.ts` now
  imports both rather than defining its own copies.
- **Window: "everything since the move" (2026-06-20), not a rolling
  window** — still only ~9 weeks of real Cambridge St data as of this
  writing, the same "not yet enough to safely restrict further" reasoning
  `history.get.ts`'s own historical-years choice already documents.
  Revisit for a rolling 10-12 week window once substantially more history
  has accumulated.
- **Avg spend/cover is now real and dynamic** (`weeklyTargets.avgSpendPerCover`
  in `server/api/dashboard.get.ts`), replacing the prior chat's hand-typed
  $89 — blended real core revenue ÷ real covers across every open day
  since the move, the same window/filter as the weekday pattern itself.
  Covers targets per day are `dollarTarget ÷ avgSpendPerCover`.
- **Actual-vs-target for "this week" uses the same core-revenue definition
  the targets themselves are built from** (not total revenue, which would
  pull in event/catering swings the target deliberately excludes), and
  caps at `asOfDate` so a day that hasn't happened yet just shows its
  target with no actual — same actual/target-both-cut-off-at-the-same-point
  fairness pattern as `capacity.get.ts`'s `actualForRange`.
- **Suggested weekly goal, added mid-build at the user's request**: "the
  $50K benchmark is memorable, but can we dynamically calculate how much is
  needed each week to cover expenses and required loan principal
  payments?" Answered with a real breakeven-revenue formula —
  `Revenue × (1 − COGS%) = Labor + Opex + Principal`, solved for Revenue —
  since COGS scales with revenue rather than being a flat monthly cost the
  way Labor/Opex roughly are over a short window. Labor/Opex use this
  month's own budget if set, else the most recent past month's real
  actual (the same hybrid fallback `monthlyCategoryTargets` already uses,
  extended one step further back). COGS% prefers the configured
  `category_benchmarks` target (what the rest of the app already judges
  COGS pace against), falling back to a trailing actual ratio only if no
  benchmark is set. Principal comes from `loan_schedule`, summed for the
  current month specifically — QBO's P&L has no principal line at all (see
  the Debt Service / Cash Flow tab section above), so this is the only
  place outside the Cash Flow tab itself that accounts for it. Shown as a
  supplementary line under the goal-edit form ("Data-driven suggestion:
  ...you'd need at least $X/week this month"), not wired into the editable
  benchmark or the day-by-day targets directly — the user can compare it
  against their own goal and decide whether to update it, rather than the
  app silently overriding a deliberately memorable, round number.
- **Verified against real local data** (in the browser, both light and
  dark mode, desktop and mobile widths): day targets sum to the full weekly
  benchmark, editing the goal live-rescales every day's target, and the
  suggested-goal figure reconciled by hand against `budget_targets`/
  `loan_schedule`/`category_benchmarks` for the current month.
- **Real incident, same day: the user ran `fly deploy` directly against
  this session's uncommitted working-tree changes** before the production
  `weekly_revenue_benchmark` table existed — `fly deploy` builds from local
  disk, not git history, so an uncommitted change ships exactly like a
  committed one. `/api/dashboard` 500'd in production
  (`SqliteError: no such table: weekly_revenue_benchmark`, confirmed via
  `fly logs`) until the table was created and seeded at $50,000 the same
  way every other schema addition in this file has been — a disposable
  `.cjs` script (`/app/node_modules/better-sqlite3`, not the `.output`
  bundle's copy — matching `pull-accounts-from-prod.mjs`'s working path)
  uploaded via `fly ssh sftp shell`, run via `fly ssh console`, then
  deleted. Verified fixed via `fly logs` (no further 500s) and a direct
  `curl` against `/api/dashboard` (200, real weekday-pattern data — 50
  real open days in production vs. local dev's 32). Reinforces this file's
  standing rule: **a schema change and its production migration ship
  together, never code-first-migrate-later** — this session's own
  in-progress local dev/prod drift made that concrete rather than
  theoretical.

## Revenue Calendar now compares against the weekday revenue goal, Week drill-down removed — 2026-08-20

The P&L Drill-Downs page's Revenue Calendar previously compared each day to
"the same weekday last week/month/year" (actual vs. actual). At the user's
request, it now compares each day against *that weekday's own
dynamically-calculated revenue goal* instead — the exact same day-specific
target the Dashboard's This Week's Targets section shows, so a day reads
the same way on both pages rather than two independently-derived numbers
that could disagree.

- **`server/utils/weekly-targets.ts`** is a new shared util —
  `computeWeeklyRevenueTargets()` extracts the weekday-share/benchmark math
  that used to live only in `server/api/dashboard.get.ts` (open-day
  filtering, per-weekday averaging, scaling to `weekly_revenue_benchmark`,
  avg spend/cover). `dashboard.get.ts` now calls this for its own
  `weeklyTargets.days`/`avgSpendPerCover`, keeping only what's genuinely
  Dashboard-specific (the "this week" actual-vs-target roll-up, the
  suggested-weekly-goal breakeven calc) — verified byte-identical output
  against the pre-refactor numbers before moving on. `server/api/pl.get.ts`
  calls the same function for the Revenue Calendar.
- **The Revenue Calendar's "actual" side switched from total revenue to
  core dine-in revenue** (`CORE_REVENUE_ACCOUNT_NUMBERS`, matching the
  target's own definition) — comparing a total-revenue actual (which
  includes event/catering swings) against a core-revenue-based target would
  let an event booking masquerade as beating or missing the weekday goal.
- **Days before the location move (2026-06-20) are left blank in the Year
  view**, per the user's explicit instruction — a day before that date has
  no weekday target to compare against (the target itself is only built
  from Cambridge St data), and comparing the old, smaller location's
  actuals against a goal scaled for the new space would be the same
  location-move distortion this file already avoids elsewhere (Historical
  tab, Capacity tab). Implemented as a plain `date < NEW_LOCATION_START`
  skip in `pl.get.ts`'s revenue-day loop — the Month view never actually
  hits this branch today (the current month is always after the move), but
  the guard is general rather than year-specific.
- **A nice side effect, not extra logic**: Mondays (the standing closure)
  are automatically excluded from the calendar too — `WEEKDAYS` in
  `weekly-targets.ts` only ever defines Tue-Sun, so `targetByDow.get(1)`
  (Monday) is always `undefined` and those days fall out of `revenueDays`
  the same way a pre-move day does, with no separate Monday check needed.
- **Week removed entirely from the Drill-Downs page** — the user's own
  call: the Wages Drill-Down (Week's version of the Labor section) wasn't
  worth keeping on its own, and the Revenue Calendar tiles (the genuinely
  useful part of the old Week view) had just moved to the Dashboard's own
  This Week's Targets section, making a third, redundant copy here pointless.
  `Period` narrowed from `'week' | 'month' | 'year'` to `'month' | 'year'`
  in both `pl.get.ts` and `app/pages/pl/drilldowns.vue` (also tightened in
  `app/pages/pl/index.vue`, which never actually used `'week'` but declared
  the wider type). Removed alongside it: `WEEKLY_WAGE_SUBCATEGORIES`,
  `isWeeklyWagesView` and its dedicated template branch/computeds
  (`weeklyWagesCallout`, `weeklyWageTiles`, etc.), the old
  `sameWeekdayPositionInMonth`/`revenueComparisonDate`/
  `revenueComparisonRangeFor` machinery (fully superseded by the weekday-goal
  comparison above), and the calendar view's `week` rendering branch.
- **Verified in the browser**: Month view's calendar shows real ▲/▼
  percentages against the weekday goal (Mondays correctly blank); Year
  view's mini-month grid was inspected directly via a JS snippet counting
  each month's cell statuses — Jan-May came back 100% `no-data` (pre-move),
  June showed a mix of pre-move/Monday `no-data` plus real `critical`
  ramp-up-week days (the location's first ~10 days open), July showed real
  `good` days with exactly its 4 Mondays as `no-data` and its 3
  not-yet-happened days as `future` — every count reconciled by hand
  against the calendar (e.g. July's 4 `no-data` days = its 4 real Mondays,
  exactly). Also re-verified the Dashboard's own `/api/dashboard` response
  was byte-identical to its pre-refactor values after extracting the shared
  util, confirming the refactor didn't change its behavior.

## Revenue Calendar colorblind/legibility fix — 2026-08-20

Same day, right after the change above: the user (who has red-green color
vision deficiency) reported two problems with the new calendar's colors,
both real and both fixed:

- **"Some Sundays don't seem filled in"** — turned out to be a false alarm
  about the *data* (every real Sunday had a genuine, correctly-computed
  status) but a real bug in the *color*: a "neutral" day (within ±5% of
  goal, plain `--surface-alt` at full opacity) and a "no-data" day (the
  same plain `--surface-alt`, just at 45% opacity) were nearly
  indistinguishable, especially at the year view's tiny mini-cell size —
  Sunday days happened to land in the neutral band often enough that the
  user read them as empty. **Fixed** by giving `.calendar-cell.no-data` the
  same transparent + dashed-border treatment `.future` already used
  (shape/pattern, not a color shade, so it can never collide with a real
  status color) — the only remaining plain-gray fill is a genuine neutral
  day.
- **"Below Goal" vs. "Well Below Goal" hard to tell apart** — confirmed
  with `validate_palette.js` (from the `dataviz` skill, the same tool this
  app's other charts were already validated with) before touching any
  code, rather than guessing: the two colors those statuses used,
  `--serious` (`#c1592f`, a rust-orange) and `--critical` (`#d03b3b`, a
  red), measured at just ΔE 1.4 under simulated deuteranopia and ΔE 6.3
  even for *normal* color vision — both well under the 15-ΔE floor the
  skill calls "hard to tell apart even with full color vision." The two
  hues sit close together in the exact red-orange band that collapses
  under red-green CVD, and diluting both to a 32-38% tint against the same
  background (the existing "tinted card" style) compressed them even
  further — confirmed by validating the *actual rendered* diluted colors,
  not just the source hues, which failed even harder (chroma floor and
  normal-vision floor both failed outright once blended toward a shared
  gray). The user's own instinct — widen the gap by stepping the *same*
  hue lighter/darker rather than mixing two different named colors — was
  exactly right and is what the validator confirmed works: two new tokens,
  `--shortfall` (`#f87171` light / `#ef4444` dark) and `--shortfall-deep`
  (`#b91c1c` light / `#ab1a44` dark), added to `app/assets/css/main.css`
  alongside the existing status tokens. Both pass every check against each
  other and against `--good` (ΔE 20.7/20.3 light, 16.2/15.0 dark — all
  above the 15 floor) — see the tokens' own comment in main.css for the
  exact validator commands.
- **Deliberately NOT a change to `--serious`/`--critical` themselves** —
  those are the app-wide status tokens used broadly elsewhere (chips,
  Cost Pace meters, Budget Pace) where they never appear side by side in a
  4-step severity scale the way this calendar's Below/Well-Below-Goal
  pair does, so redesigning them globally would be unrelated scope creep
  with real ripple risk. `--shortfall`/`--shortfall-deep` are scoped to
  the Revenue Calendar (`app/pages/pl/drilldowns.vue`), currently their
  only consumer.
- **Year-view mini-cells use the new colors at full strength, not
  diluted** — a deliberate split from the month view's softer tinted-card
  look. Month-view cells always carry redundant text (▲/▼, %, $) inside
  them, so a color that's merely legible-with-effort is acceptable there
  (and is what the skill calls the "legal only with secondary encoding"
  WARN band); the year view's mini-cells carry **no text at all** — a
  bare colored square — so color has to carry the entire signal on its
  own, which only the full-strength (undiluted) colors were validated to
  do reliably. `.calendar-cell.mini.good/.bad/.critical` override the
  month view's `color-mix(...)` rules with plain `var(--good)` /
  `var(--shortfall)` / `var(--shortfall-deep)` accordingly. The month
  view's own dilution was also bumped from 32-38% to a flat 45% for a
  modest legibility improvement there too, though it wasn't re-validated
  to a hard PASS given the existing text-based mitigation.
- **Verified in the browser**: computed `background-color` read directly
  off real `.calendar-cell.mini.good/.critical` elements matched the new
  tokens exactly in both light (`#0ca30c` / `#b91c1c`) and dark
  (`#1fc21f` / `#ab1a44`) mode; `.calendar-cell.no-data` confirmed
  transparent with a dashed border in both modes, distinct from the plain
  solid `.legend-chip.neutral` swatch.
- **Found mid-verification: a second Claude Code session was concurrently
  editing this exact page** (`app/pages/pl/drilldowns.vue`,
  `server/api/pl.get.ts`) in the same working directory, building a
  separate, unrelated feature (Labor/Opex drill-downs compared against
  prorated `budget_targets` instead of the prior period, plus a new
  editable `drilldown_thresholds` table for the materiality thresholds —
  neither built by this session). Confirmed the two sessions' changes are
  additive, not colliding (this session's Revenue Calendar/weekday-goal
  logic and color fix are both fully intact after the other session's
  edits) — but this was discovered by accident (an unexpectedly different
  page loaded in the browser mid-verification), not by any coordination
  between sessions. Flagged to the user directly rather than silently
  proceeding, since both sessions' changes are still uncommitted and
  sitting in the same working tree together.

## Year-view calendar cells get a day number — 2026-08-20

Same day, small follow-up: the year view's mini-month cells were bare
colored squares with no indication of which date they were — fine for
scanning overall shape, but you couldn't tell "which day was that" without
switching to Month view. Added a day-of-month number (`showMiniDayNum` in
`app/pages/pl/drilldowns.vue`) directly to each mini cell.

- **Only shown for a real result** — good/neutral/bad/critical — not for
  no-data or future cells (a dashed/empty square already reads as "nothing
  here"). This has a free side effect the user explicitly wanted: Mondays
  never carry a number, since Monday never has a weekday revenue target
  (see `weekly-targets.ts`) and is therefore always `no-data` — no separate
  Monday check was needed.
- **White numbers on the three saturated status fills (good/bad/critical),
  ink-colored on the plain neutral gray** — per the user's own request,
  implemented with `var(--ink)` rather than a hardcoded black so it still
  reads correctly in dark mode (where neutral's `--surface-alt` fill is
  dark, not light — literal "black" text would have vanished there).
  White-on-saturated falls short of full WCAG text contrast at 9px for a
  couple of the fills (as low as ~2.4:1 for dark-mode good) — accepted
  rather than reopening the just-validated status colors again, and helped
  with `font-weight: 700` plus a soft dark `text-shadow` that adds real
  effective contrast without touching the fill colors themselves.
- **Verified in the browser**: computed styles read directly off real
  cells — no-data/future cells confirmed to render zero `.mini-day-num`
  elements (176 and 156 respectively, in the current dataset), good/
  critical cells confirmed white text, dark mode confirmed white text
  stays white (not flipped to ink), and the number's own bounding box
  (6×9px) confirmed to fit comfortably inside a 31×31px cell with room to
  spare. The month view (unrelated, untouched) was spot-checked to still
  render its full day-num/delta%/amount stack unchanged.

## Budget Pace / Drill-Downs consolidation — Revenue Calendar split out, Labor/Opex breakdown merged into Overspending — 2026-08-20

Prompted by the user pointing out real convergence between the P&L
Drill-Downs page and the Budget Pace page's Overspending section — both had
grown their own version of "what's driving the cost overrun" — and sharing
three screenshots: the Opex Drill-Down's Fixed section showing Occupancy
Costs "▲ +63% (+$4,423)" and Utilities "▼ −77% (−$2,105)" even though the
section header itself says "not benchmarked"; the Edit Budget page showing
the same month's real Building Rent ($17,588 actual vs. $11,500 budget,
posted as one lump in the first week) and Electricity ($0 actual vs. $4,000
budget, a $4,600 bill about to hit); and Budget Pace's Overspending section,
already flagging COGS "$7,701 over expected pace" with its own note
admitting "per-account drill-down isn't built yet." Investigated the actual
code (not just the screenshots) before proposing anything, which surfaced a
real, structural explanation rather than a taste problem:

- **Month-grain subcategory pacing used flat day-fraction proration with no
  awareness of lump-sum posting timing.** `pl.get.ts`'s
  `budgetSubcategoryTotalsForPeriod` prorated every Month-grain Labor/Opex
  subcategory row by `asOfDay / daysInMonth`, so a fully-posted rent
  payment read as far "ahead of pace" and an unposted utility bill read as
  far "behind pace" — right up until it landed, at which point it would
  snap to wildly ahead. **Year-grain doesn't share this flaw, for a precise
  reason, not just "more data to average over"**: at Year grain, every
  fully-elapsed month contributes its whole budgeted amount *unprorated* —
  only the current stub month gets prorated at all. For a cost that recurs
  monthly as a lump (rent, most utilities), month-counting is the
  structurally correct unit; day-counting is the wrong unit for a
  once-a-month event, which is why Month-grain couldn't be fixed by tuning
  the formula. `useBudgetData.ts`'s own `monthExpectedOpex` had already
  tried to patch this at the category level via `opexLumpSumPostingDays`
  (hand-registering rent's day-1 and loan interest's day-12/15 posting
  pattern) — but Electricity/Gas were never added to it, confirming that
  hand-maintaining a posting-date calendar per account doesn't scale.
- **Decision, confirmed with the user via two clarifying questions**: Fixed
  opex drops the "ahead/behind pace" delta-chip framing entirely, at both
  Month and Year grain — it's already excluded from the `opex_variable`
  benchmark because it isn't controllable month to month, so a pace
  judgment on it was never honest at either grain; it now shows plain
  dollar totals only. Labor and Variable Opex **keep** the full
  pace-comparison detail at both grains — the user's own read that they
  don't share Fixed's single-lump-payment problem badly enough to lose
  Month-grain detail (payroll and discretionary spend don't post as one
  contractual lump the way rent does).
- **The standalone Drill-Downs page is gone.** Its two useful pieces split
  differently:
  - **Revenue Calendar** (the day-vs-weekday-goal comparison — never had
    the proration problem, since it compares real days to real per-day
    targets, not a within-period smoothing) got its own top-level page,
    [`app/pages/pl/revenue-calendar.vue`](app/pages/pl/revenue-calendar.vue)
    (route `/pl/revenue-calendar`), replacing "Drill-Downs" in
    [`app/layouts/default.vue`](app/layouts/default.vue)'s nav. Unchanged
    behavior/markup, just its own page with just the period toggle +
    calendar section (Materiality Threshold form and Labor/Opex sections
    removed — moved below).
  - **Labor/Opex subcategory breakdown** became an inline expand
    ("▸ What's driving it?") under a flagged category row in Budget Pace's
    existing Overspending section
    ([`app/pages/budget/index.vue`](app/pages/budget/index.vue)) — closing
    the exact gap that section's own code comment had flagged since
    2026-07-22 ("that drill-down already exists on the P&L tab"). Only
    shown for Labor/Opex (COGS still has no subcategory breakdown — same as
    before, per-account actuals don't exist yet). Reuses Budget Pace's
    *existing* Month/Year toggle and its *existing* dollar-pace-based
    Overspending gate — a category only gets an expand button if it's
    already flagged as overspending by that section's own established
    logic, rather than inventing a second gate.
- **New server route**:
  [`server/api/budget/overspending-detail.get.ts`](server/api/budget/overspending-detail.get.ts)
  holds the moved subcategory logic (`subcategoryTotalsForRange`,
  `budgetSubcategoryTotalsForPeriod`, `flagRows`, the materiality
  threshold table read) — `opexFixed` now returns plain `{label, amount}`
  rows with no expected/flagged/pctChange fields, matching the framing
  decision above. The materiality-threshold POST route moved with it, from
  `server/api/pl/drilldown-thresholds.post.ts` to
  [`server/api/budget/drilldown-thresholds.post.ts`](server/api/budget/drilldown-thresholds.post.ts)
  (the now-empty `server/api/pl/` directory was removed).
  [`server/api/pl.get.ts`](server/api/pl.get.ts) was trimmed to just what
  the P&L summary page and Revenue Calendar need (`periods`, `benchmarks`,
  `revenue` day-by-day data) — the Labor/Opex drilldown fields are gone
  from its response entirely, not left dormant.
- **Real bug caught while moving this, not present on the old page**: the
  old Drill-Downs page computed its own "as of" date as
  `MAX(daily_line_items.date)` (the last actually-synced day) — a
  reasonable choice for a page about analyzing synced data on its own. But
  this logic now sits *underneath* Budget Pace's Overspending section,
  which paces against `currentAsOfMonth()`/`currentAsOfDay()` — the real
  wall-clock date (see `useBudgetData.ts`). Those two "as of" concepts can
  genuinely disagree (confirmed locally: last sync Jul 31, real today Aug
  20) — left as `MAX(date)`, the new endpoint would have expanded a
  same-named "Month" detail panel showing July's numbers underneath an
  August-labeled Overspending row. Fixed by computing `asOfDate` from a
  real IANA-zone-aware "today" instead
  (`RESTAURANT_TIME_ZONE = 'America/New_York'`, a small local `localToday`
  duplicate — same pattern `qbo-sync-runner.ts`'s own copy already
  documents, kept separate rather than shared/imported), matching what
  `currentAsOfMonth()` represents. A separate `MAX(date)` check is kept
  only as the "no data synced at all yet" empty-state guard.
- **Cross-links updated**: [`app/pages/pl/index.vue`](app/pages/pl/index.vue)'s
  P&L table now points "what's driving these costs" at Budget Pace's
  Overspending section and the day-by-day picture at Revenue Calendar,
  replacing the old single "see Drill-Downs" link.
- **Verified in the browser** against real local data: confirmed the new
  Revenue Calendar page renders identically to the old page's calendar
  section (Month and Year, including the location-move gap and day
  numbers); confirmed `/api/budget/overspending-detail` returns
  `asOfDate: "2026-08-20"` (real today) with Month empty (no August data
  synced locally yet) and Year populated with real, correctly-unflagged
  subcategory rows; confirmed the Materiality Threshold form's save
  round-trip against the new route. The expand/collapse mechanism itself
  couldn't be exercised against real *flagged* local data (nothing is
  currently over pace locally), so it was verified by temporarily loosening
  the flagging thresholds in both files, confirming Labor's panel rendered
  5 real ranked tiles with correct delta chips and Opex's panel rendered a
  chip-free Fixed group (Interest & Financing, Occupancy Costs, Utilities,
  Insurance) alongside a chip-bearing Variable group, and only one category
  panel open at a time — then reverting both temporary changes and
  re-confirming the page returned to its real "Nothing unusual" state.

## Overspending section always shows all 3 cost categories, spelled out — 2026-08-20

Same day, immediate follow-up: the user asked what "1 of 3 cost categories"
in the Overspending callout actually referred to — nothing on the page
named the three (COGS, Labor, Operating Expenses; Revenue is deliberately
excluded, see the comment above `COST_CATEGORIES` in
[`app/pages/budget/index.vue`](app/pages/budget/index.vue)), so a reader
had to infer the set rather than being told. Asked to also show all 3
categories, even the ones on target, not just the ones running over pace.

- **`costCategoryRows`** replaces the old `overspendingCategories` — always
  maps all 3 `COST_CATEGORIES`, not a filtered subset, so a category
  running on/under pace gets its own row instead of silently dropping out
  of the list. Fixed category order (COGS, Labor, Opex — matching the pace
  cards' own Revenue/COGS/Labor/Opex order directly above, minus Revenue),
  not sorted by how over/under pace each one is, so the three rows stay in
  the same place every time rather than reshuffling as pace changes. A
  separate `overCategories` computed (filtered + sorted by `overAmount`)
  exists solely to drive the callout's "led by X" — it doesn't affect the
  visual row order.
- **Each row now has a real on-pace state, not just an over-pace one** —
  `row.overPace` picks between a red "▲ X.Xpts ahead of pace" / `serious`
  fill (unchanged from before) and a new green "✓ X.Xpts under pace" /
  `good` fill, mirroring the exact icon+color convention (✓ for good, ▲ for
  serious) already used elsewhere on this page (e.g. the projection chips).
  New `.flag.good`/`.rank-fill.good` CSS rules were added alongside the
  existing `.serious` ones. The dollar figure is now unsigned with the
  direction carried entirely by the "over"/"under expected pace" label
  text, rather than a `+`/`−` prefix that would have doubled up
  confusingly with "under" (e.g. "−$X under pace" reads like a double
  negative).
- **The callout now names the three categories directly** —
  `costCategoryLabelList`, built from `CATEGORY_LABEL` rather than a
  hardcoded string (so it can't drift if a label ever changes), joins them
  as "COGS, Labor, and Operating Expenses." Two forms: "N of 3 cost
  categories (...) is/are running ahead of budget pace..., led by X" when
  at least one is over, or "All 3 cost categories (...) are on pace or
  under budget this month/year" when none are — replacing the old binary
  toggle between a full breakdown card and a one-line "Nothing unusual"
  card, since the list itself is now always visible either way.
- **The Labor/Opex "What's driving it?" expand is now available on every
  row, not just over-pace ones** — a natural consequence of always
  rendering all 3 rows, and arguably more useful than before: a
  subcategory can be genuinely flagged (see the materiality-threshold
  logic in `overspending-detail.get.ts`) even when the parent category
  nets out on pace overall, because other subcategories under the same
  category are running correspondingly under.
- **Verified in the browser** against real local data (Month and Year):
  confirmed the callout reads "All 3 cost categories (COGS, Labor, and
  Operating Expenses) are on pace or under budget this year," all three
  rows render with the real `--good` green (`rgb(12, 163, 12)`, confirmed
  via computed styles) fill/flag, and the Labor expand toggle still opens
  correctly (showing the real "no single subcategory stands out" fallback
  message, since nothing is flagged in the current real dataset).

## COGS gets the same subcategory breakdown as Labor/Opex — 2026-08-20

Same day, immediate follow-up: the user asked to see what's driving the
COGS row too. The old P&L Drill-Downs page never had a COGS section (see
the "Budget Pace / Drill-Downs consolidation" section above), but nothing
about COGS structurally prevents one — it has real per-account
`daily_line_items` actuals and real `budget_targets` the same way
Labor/Opex do, split into Food/Beverage/Other via `accounts.subcategory`
(see the Budget tab's "COGS budgeted as % of revenue" section). COGS also
doesn't share Fixed opex's single-lump-monthly-payment proration problem —
food/beverage costs accrue continuously as vendor invoices/inventory move,
not as one contractual lump the way rent does — so it gets the full
pace-comparison treatment (flagged delta-chip tiles) at both Month and
Year, same as Labor and Variable Opex, not the Fixed-style plain-totals
treatment.

- [`server/api/budget/overspending-detail.get.ts`](server/api/budget/overspending-detail.get.ts):
  `subcategoryTotalsForRange`/`budgetSubcategoryTotalsForMonth`/
  `budgetSubcategoryTotalsForPeriod`'s `category` param widened from
  `'labor' | 'opex'` to `'cogs' | 'labor' | 'opex'`; `detail` gained a
  `cogs` field computed the same way as `labor` (full `flagRows` pace
  comparison, no Fixed/Variable split — COGS has no `cost_behavior`
  column, that's opex-only).
- [`app/pages/budget/index.vue`](app/pages/budget/index.vue): `hasDetail()`
  now includes `'cogs'`; a new `cogsDetailRows` computed and detail-panel
  template branch mirror Labor's exactly (single `anomaly-grid` of flagged
  subcategory tiles, or a "no single COGS subcategory stands out" fallback
  note). Section-note copy updated from "for Labor/Opex" to "for
  COGS/Labor/Opex."
- **Verified in the browser** against real local data: `/api/budget/
  overspending-detail`'s Year response now includes real `cogs` rows (Food
  −23.5%, Beverage −32.8%, Other −32.8% vs. expected pace, all correctly
  unflagged); the COGS row's new "What's driving it?" toggle opens and
  shows the real "no single subcategory stands out" fallback. Same
  temporary-threshold-loosening technique as before confirmed real tiles
  render correctly (Food/Beverage with correct delta chips) before
  reverting the temporary change and re-confirming the page's real
  unflagged state.

## "not budgeted" mislabel + wrong direction/color on a real negative-actual subcategory — 2026-08-20

Found from a real production screenshot: a Marketing & Advertising tile
read "▲ not budgeted (−$569)" over a red/serious card with a "Total this
month" of **−$955**. The user explained the real cause directly, with a
screenshot of the underlying QBO journal entry: Urban Hearth received a
**$60K incentive from OpenTable** for signing a 2-year agreement, booked to
`2355 Other Current Liabilities: Deferred Vendor Incentive - OpenTable` and
recognized as a **$5,000/month credit to `6305 Marketing & Advertising:
Reservation Platform Fees`** for the next year — so a negative Marketing &
Advertising actual is real, intentional, and will keep recurring monthly
for roughly a year, not a data error.

That made the display bug worth fixing for real, not just explaining away.
Two separate, stacked bugs in the "no meaningful expected %" fallback path
(`flagRows`'s `expectedAmount <= 0` branch and `buildDeltaRow`'s matching
`pctChange === null` branch):

- **The "not budgeted" label was wrong.** `flagRows`
  (`server/api/budget/overspending-detail.get.ts`) used
  `expected.get(r.label) ?? 0` then checked `<= 0` to decide "no budget
  exists" — which conflates two real, different states: a subcategory with
  genuinely no `budget_targets` row (defaults to $0 via `?? 0`), and a
  subcategory with a real budget row that just sums to $0 or negative
  (exactly this case — a real, if unusual, budgeted net credit). **Fixed**
  with a new `hasBudget: boolean` field (`expected.has(r.label)`,
  independent of what the value defaults to), threaded through `detail`'s
  type for `cogs`/`labor`/`opexVariable` — a percentage-vs-expected still
  isn't shown either way (dividing by a non-positive comparison figure can
  flip sign confusingly — verified directly: a large negative comparison
  produced a nonsensical positive %), but the client-facing label now
  distinguishes "not budgeted" (no row at all) from "no positive budget to
  compare" (a real row, non-positive).
- **The direction/color was hardcoded wrong.** `buildDeltaRow`
  (`app/pages/budget/index.vue`) always set `direction: 'up'` (the red
  "overspending" tile) for this fallback path, regardless of the actual
  delta's sign — so a subcategory that came in *below* its (near-zero)
  comparison, like this one, was shown as if it were a red overspending
  flag. **Fixed**: direction now follows `deltaAmount`'s own sign (up/down/
  flat), matching how the normal (non-null `pctChange`) branch already
  worked. Confirmed this specific case (a negative delta) now renders
  green/`down`.
- **Verified both directions**, since local dev's real August data has no
  activity for this account yet (production is ahead of local dev here —
  this OpenTable credit isn't in local dev's synced data at all): temporarily
  edited `budget_targets`/`daily_line_items` directly in local dev's sqlite
  file for a real Marketing & Advertising account (id 117, "Advertising")
  to reproduce both a non-positive-comparison-with-negative-delta case
  (rendered "▼ no positive budget to compare (−$X)" in green, correctly)
  and a non-positive-comparison-with-positive-delta case (rendered "▲ no
  positive budget to compare (+$X)" in red, correctly) — then reverted
  every edited row back to its exact original value (`budget_targets` for
  accounts 117/118 back to 0/1500, `daily_line_items` test row deleted) and
  re-confirmed the page shows no leftover trace of the test.
- **Not fixed here, and not this app's call to make**: whether the Edit
  Budget page's Marketing & Advertising budget for the next ~year should be
  updated to actually reflect the expected $5,000/month OpenTable credit
  (netted against real platform-fee spend), so the comparison figure itself
  is accurate rather than just correctly *labeled* when it happens to be
  non-positive. That's a real budgeting decision for the user, not a bug —
  flagged here as a natural next step, not queued as "Not yet done" since
  it isn't something to build, just something to enter.

## "no positive budget to compare" was itself still misleading — 2026-08-20

Same day, immediate follow-up: the user updated Edit Budget's real
per-account Marketing & Advertising figures to reflect the OpenTable
credit (per the section above), then flagged that the Overspending tile
still read "▼ no positive budget to compare (−$569)" — even though a real,
complete budget existed for every one of the subcategory's 5 accounts
(Advertising $110, Creative & Branding $200, Marketing – PR $4,000,
Marketing – Website $100, Reservation Platform Fees −$5,000 — visible
directly on Edit Budget's own account tree). The prior section's fix had
correctly distinguished "no budget row" from "a real non-positive budget,"
but the wording for the latter case still implied absence rather than
stating the real number — a real, if not fully-resolved, follow-on gap
from the same fix, not a new bug.

- [`app/pages/budget/index.vue`](app/pages/budget/index.vue)'s
  `buildDeltaRow`: the `hasBudget` branch now reads
  `vs. $${comparisonAmount} budgeted` — the real (prorated, for the
  in-progress month) group total — instead of the vague "no positive
  budget to compare." Percentage still isn't shown for this branch (same
  reasoning as before: dividing by a non-positive comparison figure can
  flip sign confusingly), but the real dollar comparison now is, which is
  what the user was actually asking to see.
- **Verified with the same local-dev synthetic-edit technique** as the
  section above (accounts 117/118's `budget_targets` temporarily set
  non-positive, a synthetic `daily_line_items` row added): the tile now
  renders `▲ vs. $-1,304 budgeted (+$349)` — the real prorated group total
  — instead of the old dismissive phrase. Reverted every edited row back to
  its exact original value afterward and re-confirmed no trace remained.

## Capacity Pace per-cover revenue now excludes catering/event income — 2026-09-07

Prompted by the user viewing production's Capacity Pace page: the four
period cards (Last/This Week, Last/This Month) showed per-cover revenue
spiking well above the assumed rate (e.g. This Week $128.27 vs. $96.10
assumed) with nothing in the per-area breakdown below explaining it — the
area cards, being table-classified from `daily_toast_area_metrics`, don't
see catering at all. Cause: `actualCoversRevenue` in
[`server/api/capacity.get.ts`](server/api/capacity.get.ts) summed **every**
`category='revenue'` account for its numerator, so a single ~$24,605
catering booking for the week (real, posted to `4200 Catering Income`
sub-accounts, entered into Toast) landed in the per-cover numerator with no
matching Toast covers in the denominator, inflating the whole page's
$/cover.

- **Fixed** by switching that query from `a.category = 'revenue'` to the
  `CORE_REVENUE_ACCOUNT_NUMBERS` allowlist
  ([`server/utils/core-revenue.ts`](server/utils/core-revenue.ts)) — the
  same "core dine-in food/beverage only, excludes Event Sales 4100s /
  Catering 4200s / Retail 4300s / Other Service Income 4400" definition the
  Dashboard's Weekly Performance section and the Historical tab already
  use. The assumed side (`assumedForRange`/`assumedAvgCheck`, built from
  `capacity_areas`/`capacity_area_seasonality`) was already catering-free
  and is unchanged; the per-area breakdown was already table-scoped and is
  unchanged.
- **Verified in local dev** (asOfDate 2026-07-28 — local synced data has no
  catering activity in-window, so the numeric shift there is tiny: the
  query now also drops a $110 `4035 Late Cancellation & No-Show Fees`
  amount from July). The catering-sized impact only shows against
  production data. `/api/capacity` and `/capacity` both still return 200
  with sane numbers; the mechanism (allowlist vs. category) is the same
  one already proven on the other pages.
- **Not yet deployed to production** — plain code change, needs `fly
  deploy`; no schema or backfill change.

## Nightly Margin's Marginal/Fully-loaded toggle removed — 2026-09-13

The Marginal/Fully-loaded toggle added to
[`app/pages/nightly-margin.vue`](app/pages/nightly-margin.vue) on 2026-08-25
(never previously documented in this file — a pre-existing gap, closed by
adding this page to "Where to look" below) was raised by the user as
unhelpful: Marginal judges a night against variable (hourly) labor + COGS
only, deliberately excluding fixed labor & benefits (paid whether the
restaurant opens or not) — which is *by design* almost always positive ("a
restaurant only opens on nights it expects to clear that low a bar," per
the page's own code comment), so in practice it made every night look
"worth opening" with no real day-to-day discriminating power. Fully-loaded
(judging a night against its full share of costs, including fixed labor &
benefits) was the one actually useful for telling a strong night from a
merely-adequate one.

**The toggle is gone — the page now only shows the fully-loaded view.**
Rather than lose the one thing Marginal's underlying comparison *was* good
for — flagging the rare night that didn't even clear that low a bar — a
night where revenue falls below variable labor + COGS alone now gets its
own darkest calendar status, `severe`, distinct from and worse than the
existing `critical` (a fully-loaded loss of 10%+ of revenue, which mostly
just reflects the normal fixed-cost allocation and isn't nearly as
alarming). Per this app's own "color + icon + label, never color alone"
rule (see Design direction above), `severe` isn't just a darker shade — the
month view prefixes a ⚠ to the cell's dollar figure, the year view's tiny
mini-cells swap their day number for a bare ⚠ (still recoverable via
hover), and the legend gets its own "⚠ Didn't cover variable labor + COGS"
chip. The darker fill itself
(`color-mix(in srgb, var(--shortfall-deep) 80%, black)`) is a darkened
shade of the existing `--shortfall-deep` token rather than a new hue, so it
didn't need a fresh `dataviz` palette validation pass. A dedicated callout
above the usual fully-loaded shortfall callout names these nights by date
explicitly, and the per-day hover tooltip adds an explicit warning line
when it applies.

## Pre-opening rent reclass excluded from Free Cash Flow — 2026-09-26

The user explained a real September 2026 QBO entry: a $60,000 "Pre-opening
Rent Payments" asset was reclassified to expense (debit 6505 Pre-opening
Rent Expense, credit the asset account) — a non-cash journal entry, no cash
moved. This is a real, GAAP-correct new expense on the P&L, but the rent it
represents was actually paid back when the loans were drawn, using loan
proceeds, not out of ongoing operating cash — so letting it reduce Net
Income inside the Cash Flow tab's reserve-building metrics would
double-penalize that one historical cash outflow: once for real, when it
left as part of the loan draw, and again here if left inside Net Income
unadjusted.

Investigated before changing anything, per this file's own standing
discipline: confirmed the real account live against production (`fly ssh
console`, same disposable-script pattern used throughout this file) — id
232, account_number `6505`, category `opex`/`Occupancy Costs`,
`cost_behavior='fixed'` — and found it had no `daily_line_items` rows
posted yet as of this writing, despite the nightly sync being current
through 2026-09-25. So the entry evidently hadn't been booked in QBO at the
time of this session; the fix is built to apply automatically once it
posts, not backfilled by hand.

- **Scoped to exactly one place**: `reserveProgress()`
  (`server/api/cashflow.get.ts`) is untouched — it's driven entirely by
  real `reserve_transfers` bank-transfer rows, never by Net Income, so it
  was never at risk from this entry. The Year-End Projection section's
  client-side `projectedNetIncomeForYear` (`app/pages/cashflow.vue`) was
  also confirmed unaffected: `hybridYearTotalsPastActual` always uses that
  month's *budget*, not actual, for the current in-progress month (see
  `useBudgetData.ts`), and this unbudgeted one-time reclass has no budget
  line — so it only reaches `actualsFor()`'s year-to-date actual query
  inside `freeCashFlow()`, the one spot in this file where Free Cash Flow
  is actually derived from real, already-posted Net Income.
- **Fixed** with a `PRE_OPENING_NONCASH_ADJUSTMENTS` list (generalized the
  same session — see below), matched by `account_number` (not id), per this
  file's own cross-environment discipline. `actualsFor()` returns
  `preOpeningNonCashAddBack` (the real posted amount, summed across the
  list, for the requested range — not a hardcoded dollar figure, so it
  stays correct as the real posted amount comes in), and `freeCashFlow()`'s
  formula adds it back: `netIncome + depreciation +
  preOpeningNonCashAddBack − SBA principal − reserve transfers`.
- **Left inside Net Income everywhere else in the app, on purpose** — the
  Budget Pace/P&L/Edit Budget pages should keep showing the real,
  GAAP-correct $60,000 hit; only this page's cash-flow-specific derived
  metric excludes it.
- **Shown transparently, not silently folded in** — `app/pages/cashflow.vue`'s
  Free Cash Flow breakdown gets a new `+ {label} (non-cash add-back)` line
  per adjustment (only rendered once nonzero, i.e. once the real entry has
  actually synced), plus a note explaining why, matching this file's
  established "show the real number and explain it" pattern (e.g. the
  Depreciation add-back row, or the P&L-vs-schedule loan interest
  side-by-side).
- **A real sync gap discovered while investigating why the entry hadn't
  shown up an hour after the user created it in QBO**: `runNightlySync()`
  only ever moves forward from whatever's already in `daily_line_items`,
  plus a 30-day floor behind yesterday (see `qbo-sync-runner.ts`'s
  `MIN_QBO_LOOKBACK_DAYS`) — it never rescans further back into
  already-synced history. This JE was dated 2026-06-20 (the location-move
  day, ~98 days before this session), so no amount of clicking "Sync now"
  would ever reach it. Not a bug in that sync logic (its whole design is a
  forward-moving catch-up, not a general rescan), but a real operational
  gotcha worth remembering: **a backdated JE into an already-synced
  historical date needs a manual, targeted re-sync** —
  `scripts/backfill-qbo-pl.mjs --since=<date> --until=<date>
  --accounts=<qboAccountId>` via `fly ssh console`, same targeted-account
  pattern already used elsewhere in this file (see the net income mismatch
  investigation above) — not the regular nightly/manual sync path. Applied
  here to re-sync account 6505 for 2026-06-20, confirmed via direct query
  before trusting the fix.
- **Verified end-to-end against real production data**, not just local dev:
  after the targeted re-sync above and deploying this fix, `/api/cashflow`
  and the live `/cashflow` page both correctly showed the $60,000 add-back
  and the corrected Free Cash Flow figure.

## Pre-opening insurance catch-up and serviceware reclass — 2026-09-26

Same day, two more real entries the user flagged for the same treatment —
generalized the single hardcoded rent-reclass field above into a
`PRE_OPENING_NONCASH_ADJUSTMENTS` list
(`server/api/cashflow.get.ts`), each entry an `{ accountNumber, label,
fromDate?, throughDate? }`. The two new entries needed real judgment calls,
not just a copy-paste of the rent reclass:

- **Insurance catch-up (account 6752, "Business insurance")**: a SaasAnt
  import recognizing 2026's annual prepaid insurance policy month by month
  (Feb–Sep JEs, $24,661.50 total), catching up entries the user had
  neglected to create as they came due. The user explicitly scoped this
  themselves: only the **January–May** coverage (the pre-opening months, at
  the old location) should be treated as loan-financed; June onward is real
  ongoing operating expense at the new location and must stay inside Net
  Income/Free Cash Flow unadjusted. Unlike the dedicated rent-reclass
  account, 6752 also carries other real, ongoing insurance premium activity
  in the same window (confirmed live: e.g. a small charge alongside each
  catch-up entry) — a blanket account-wide add-back would have been
  imprecise but was judged acceptable given `daily_line_items`' daily-rollup
  grain (no per-transaction detail to separate them further). Scoped with
  `fromDate: '2026-01-01', throughDate: '2026-05-31'`. Real add-back:
  $13,724.84 (Feb+Jan combined $5,480.33, plus March/April/May at
  ~$2,748.17 each, including the small co-mingled charge).
- **Serviceware reclass (account 6785, "Serviceware (Durable)")**: a
  $15,732.50 "Preopening Smallwares" asset reclassified to expense
  (plates/bowls/misc. FOH serviceware bought before opening), same
  mechanism as the rent reclass. **Checked live before assuming the same
  no-date-window treatment as rent would be safe — and it wasn't**: 6785 is
  an ordinary variable-opex account with real, substantial *ongoing*
  restocking purchases continuing well past opening (confirmed against
  production: e.g. $3,709.34 on Jul 27, $2,204.43 on Jul 18 — thousands of
  dollars/month through at least August 2026). A blanket account-wide
  add-back here would have wrongly excluded real current operating cash
  spend on new serviceware for the larger space, the opposite of what this
  feature is for. Scoped to the JE's own single date,
  `fromDate`/`throughDate` both `'2026-06-20'` — the tightest window
  `daily_line_items`' daily grain allows, same imprecision trade-off as the
  insurance entry (a small amount of that day's ordinary spend, $68.90,
  gets folded in too).
- **Same sync gap as the rent reclass, for both entries** — both JEs
  (dated Feb–Sep 2026 for insurance, 2026-06-20 for serviceware) had
  already been created in QBO but hadn't synced, for the identical
  forward-only-sync reason documented above. Fixed with the same targeted
  `scripts/backfill-qbo-pl.mjs --accounts=<id>` re-syncs (account 93 for
  insurance across Jan–Sep; account 196 for serviceware on just 06-20),
  confirmed via direct query before trusting each fix.
- **Verified end-to-end against real production data**: after both
  targeted re-syncs and deploying, `/api/cashflow`'s `nonCashAdjustments`
  array and the live `/cashflow` page both showed all three entries
  correctly (rent $60,000 + insurance $13,724.84 + serviceware $15,801.40 =
  $89,526.24 total add-back), with the section note listing each by name.

## Debt Service Coverage Ratio covenant tracking — 2026-09-26

Prompted by the user needing to send a P&L/balance sheet to Eastern Bank for
a periodic review and asking whether the recent pre-opening reclass entries
(above) could cause a problem. Investigated by reading Eastern Bank's real
closing documents (`Eastern Bank SBA - Turing Tavern Purchase Closing
Agenda 12-12-2025.pdf`, not checked into this repo) rather than guessing at
loan terms — the Loan Agreement's Covenants section (§5.24, matching the
original commitment letter word for word):

> 1.25x Minimum Debt Service Coverage, tested annually, beginning Fiscal
> Year End 2026, measured as Earnings Before Interest, Depreciation, and
> Amortization (EBITDA) divided by the sum of all annual principal and
> interest payments.

Two real findings from reading the actual document, not just the user's
paraphrase:
- **The "quarterly review" the user assumed doesn't exist in this
  document.** §5.23's actual reporting requirement is annual, due April
  30th (Business Tax Returns + Erin Miller's Personal Financial Statement)
  — the periodic request driving this conversation is either informal
  relationship monitoring or the section's own catch-all ("such other
  information... as the Bank may request from time to time"), not a
  documented quarterly covenant deadline.
- **EBITDA's own definition doesn't add back the three pre-opening reclass
  entries.** It only adds back Interest/Depreciation/Amortization — not
  rent, insurance, or serviceware expense. So unlike this app's internal
  Free Cash Flow metric (which already excludes all three as a judgment
  call), a standard bank-computed EBITDA off the raw P&L will show the full
  $89,526.24 hit, landing right in the covenant's first-ever test year.

Built as a new **Debt Service Coverage Ratio (Eastern Bank Covenant)**
section on the Cash Flow tab
([`app/pages/cashflow.vue`](app/pages/cashflow.vue), data from a new
`covenant` object in
[`server/api/cashflow.get.ts`](server/api/cashflow.get.ts)) — informational
tracking only, not a live compliance check, since the real test doesn't
happen until FY2026 actual year-end financials are in.

- **One real ambiguity the loan documents don't resolve, shown to the user
  rather than silently assumed**: whether "the sum of all annual principal
  and interest payments" means just the $500K Eastern Bank SBA loan or all
  10 loans including the 9 subordinated investor notes — **built against
  all 10** (`fullYearAllLoans = summarizeDebtService(fullYearRows)`,
  unfiltered by `loan_key`), the more conservative reading, per the user's
  own explicit choice.
- **Projected EBITDA = this year's already-established Net Income
  projection** (`projectedNetIncomeForYear`, the same actual-for-elapsed-
  months + budget-for-the-rest figure the Year-End Projection section above
  already computes) **+ Interest, sourced from the loan amortization
  schedule for these 10 loans specifically (not account 7020's real
  postings)** — deliberately, so the interest add-back and the debt-service
  denominator can't drift apart by coming from two different sources (7020
  is already documented elsewhere in this file as carrying interest from
  debt outside these 10 loans) **+ budgeted Depreciation for the year**
  (`budgetedDepreciationForYear`, already computed server-side for the
  existing "profit needed to cover the loans" figure).
- **A real gap surfaced while building this, not previously flagged**:
  Depreciation is showing **$0** both YTD and budgeted for the full year —
  unusual for a restaurant with real leasehold improvements/equipment, and
  a real EBITDA add-back the covenant explicitly allows. Flagged to the
  user directly rather than silently treated as correct; worth confirming
  with the accountant whether depreciation is actually being posted to QBO
  before relying on this ratio for a real conversation with the bank.
- **Verified end-to-end against real production data**: raw DSCR came back
  1.53x, meeting the 1.25x floor, rendered correctly with its pass/fail
  chip on the live `/cashflow` page, and the EBITDA breakdown reconciled by
  hand against `/api/cashflow`'s raw JSON
  (`covenant.annualDebtService.total` = $128,439.96).

**Reclass-adjusted ratio removed, 2026-09-28** — originally built shown
side by side with the raw ratio (two hero cards), since whether Eastern
Bank would accept the pre-opening reclasses as non-recurring add-backs was
a real open question. The user's own call after seeing it live: not
relevant for the bank, so drop it rather than leave a second number that
invites a conversation the bank was never going to have. `covenant.ytd`
(the block feeding that second ratio — `netIncome`/`interest`/
`depreciation`/`preOpeningNonCashAddBack`/`ebitda`) was removed from
`server/api/cashflow.get.ts`'s response entirely, not left dormant, along
with `dscrAdjusted`/`projectedEbitdaForYearAdjusted` in `cashflow.vue` —
it was the only consumer of that block, so nothing else needed touching.
The remaining single DSCR card and EBITDA breakdown are unchanged except
for losing the "(as reported)" qualifier on the `= EBITDA` row, since
there's no longer a second version to distinguish it from.

## DSCR card: only the SBA + 5 original investor loans — 2026-10-26

The Cash Flow tab's all-10-loans DSCR card (the first of the two) was removed
at the user's request; the page now shows only the scoped card (SBA, Chen,
Savage, Schaefer, Gilreath, Mis). `app/pages/cashflow.vue` lost the card and
its `dscrRaw`/`projectedEbitdaForYear` computeds. The server's `covenant`
(all-loans) block in `server/api/cashflow.get.ts` was left in place, unused by
the UI, in case the all-10 reading is wanted again.

## Reserve sustainability past the catch-up: a real 2027+ target and weekly rate — 2026-09-28

Closes the gap flagged in "Real running-balance reserve projection"
above and carried on the "Not yet done" list ever since: that simulation
only ever projected through `catchUpDate` itself (Dec 20, 2026) and had
nothing to say about whether the reserve could keep sustaining every
reserve-funded loan's *ordinary* monthly payment afterward — a real
question once the one-time catch-up stops being the only thing this
account has to cover. Prompted directly by the user asking two tied
questions: what's a more accurate end-of-2026 target once 2027's ongoing
payments are accounted for, and what should the weekly transfer become
once 2027 starts.

- **The 2027 draw pattern turned out to be exactly level**, once pulled
  from the real `loan_schedule`: every reserve-funded loan (`loan_key !=
  'sba'`) posts the same two payments every month of 2027 — $5,500.62 on
  the 15th (Jones + Miller) and $11,130.98 on the 20th (the other 7) —
  totaling $199,579.20 for the year. 2027 has 52 Mondays, so
  $199,579.20 ÷ 52 = $3,838.06/week is the exact break-even rate.
- **Break-even alone isn't safe, because deposits and withdrawals don't
  stay in phase** — withdrawals land on fixed calendar dates (15th/20th)
  while deposits land on Mondays, so simulating the real 2027 dates (not
  just comparing annual totals) shows even a perfect break-even deposit
  needs a real cushion already sitting in the account on Jan 1 to never
  dip negative at some mid-year trough. This is the same technique
  "Real running-balance reserve projection" above already established for
  the catch-up date itself, just run forward across a full ordinary year
  instead of stopping at one lump payment.
- **`server/api/cashflow.get.ts` gained three simulation helpers** —
  `mondaysThrough` (Monday-date generator, factored out of
  `reserveProgress()`'s existing inline loop so both the catch-up
  projection and this new simulation share one definition),
  `simulateReserveBalance` (runs a weekly-deposit-vs-real-withdrawal-dates
  event timeline and returns the ending and minimum balance — the general
  form of the same running-balance technique `reserveProgress()` already
  used just for the catch-up window), and two binary searches built on top
  of it: `minStartingBalanceToSustain` (the smallest Jan 1 balance that
  keeps a given weekly rate non-negative all year) and
  `minWeeklyRateToReachTarget` (the smallest weekly rate that both never
  goes negative and hits a target ending balance).
- **A new `reserve.sustainability` block**, computed inside
  `reserveProgress()` right alongside the existing catch-up projection:
  `sustainYear` (`catchUpDate`'s own year + 1 — not hardcoded to 2027, so
  this stays correct once `catchUpDate` itself rolls to a different
  loan/year), `totalDraws` and `breakEvenWeeklyRate` (both computed from
  `loan_schedule`, not hardcoded), `recommendedWeeklyRate` (break-even
  rounded up to the nearest $500 — a practical, round number with real
  margin, not the bare decimal, which leaves zero room for a late or
  skipped transfer), `bufferNeededForRecommendedRate` (what that rate
  actually needs banked on Jan 1, per the real-dates simulation),
  `projectedYearEndBalance` (where the *current* declared weekly plan
  actually lands by Dec 31 if nothing changes — unlike
  `projectedBalanceAtCatchUp` above, this one includes the catch-up
  payment itself, since it's answering "what's left afterward," not "is
  there enough to make it"), `surplusVsNeeded`/`onTrack`, and
  `suggestedRemainderOfYearRate` — the least that needs to keep moving
  into the reserve for the rest of *this* year to still land at
  `bufferNeededForRecommendedRate`, plus `operatingCashFreedPerWeek`/
  `operatingCashFreedTotal` if the current plan is overshooting that.
- **A real, counter-intuitive finding while verifying
  `suggestedRemainderOfYearRate` against production's actual numbers**:
  simple algebra on the year-end target alone (starting balance + 14 more
  weekly deposits − remaining 2026 withdrawals ≥ buffer) suggested
  ~$3,855/week would be enough, but the binary search (which also enforces
  the balance never dipping negative at any point, not just at year end)
  came back with $4,006.07/week instead — because only 12 of the 14
  remaining Mondays land *before* Dec 20, so the balance right after that
  one big payment clears is the real binding constraint, not the eventual
  Dec 31 total. A good demonstration of why this needed a real
  date-by-date simulation rather than dividing totals.
- **Rendered on the Cash Flow page** (`app/pages/cashflow.vue`) as a
  second card inside the existing Loan Reserve Savings Plan section,
  directly below the catch-up projection, with the same on-track/behind
  chip convention — reads e.g. "the current $5,000/week is overshooting
  what 2027 needs — as little as $4,006/week for the rest of 2026 would
  still get there safely, freeing roughly $13,915 of operating cash
  between now and year end" against real production numbers, or "the
  current $5,000/week isn't quite enough — at least $5,608/week... is
  needed to be 2027-ready" against local dev's smaller real balance —
  verified both phrasings render correctly against each environment's own
  real (very different) `saved`/`currentWeeklyAmount` figures, confirming
  the feature isn't hardcoded to either.

## Labor role classes — 2026-10-02

Prompted by a conversation about whether Urban Hearth's labor is top-heavy
after adding a Floor Manager, Assistant to the GM, and (proposed) salaried Wine
Director in place of cheaper tipped/hourly hours. The useful split isn't
"revenue-producing vs. not" (cooks don't produce revenue either) but **how a
role's cost behaves**: `labor_position_settings.role_class` is `direct`
(scales with volume), `supervision` (sized to shifts/stations/staff, not
covers — GM, Floor Manager, Sous Chef, Executive Chef), `overhead` (Business
Manager, Assistant to the GM), or `growth` (fixed cost justified by a revenue
bet — Wine Director), or NULL (unclassified; always NULL for `flat`/`tax`
accounts). One class per role — a hybrid like the Executive Chef (cooks and
supervises) gets whichever reason dominates; editable, same "first-pass,
revise later" posture as `cost_behavior`/`is_owner_compensation`.

- **Labor tab** ([`app/pages/budget/labor.vue`](app/pages/budget/labor.vue)):
  a class selector on every wage role row (BOH/FOH role rows, the OT rows,
  the Management Salaries table) and a **Labor by Role Class** summary card
  under the modeled row — $/mo, % of labor, % of budgeted revenue per class,
  Oct–Dec average, driven by live (unsaved) inputs like every other modeled
  figure. Payroll taxes are allocated to classes pro rata by wages (exact —
  taxes are a flat % of the same wage-subject total); employee benefits,
  Additional Pay and the taxes on it stay in their own "Benefits & other" row.
  The card headlines the **fixed layer** (supervision + overhead + growth) as %
  of revenue. Neutral ink only — a taxonomy, not a status, so no status colors.
- **Seeded** by `npm run db:add-labor-role-class` (adds the column, classifies
  by `account_number`, only fills NULLs so it never clobbers UI edits;
  idempotent). **Production needs this run by hand** (`fly ssh console`, same
  manual-migration posture as every other schema change to an existing
  volume) **before** `fly deploy`, or `/api/budget/labor-settings` will 500 on
  the missing column — migrate first, then deploy.
- Verified locally against synthetic unsaved inputs (hand-checked card math)
  and an API round-trip (valid class saves, invalid class 400s). Local dev has
  no modeled rates, so the card reads $0 until rates are entered.

## Breakeven covers/night — 2026-10-02

Built straight out of the role-class conversation above: once labor is split
by cost behavior, "how many covers a night do we need" is just fixed cost ÷
(nights × contribution per cover). A card on the Capacity Pace page
([`app/components/BreakevenCard.vue`](app/components/BreakevenCard.vue),
data from [`server/api/breakeven.get.ts`](server/api/breakeven.get.ts)),
month selectable (current month through Dec).

- **Four cumulative tiers**: (1) fixed labor — supervision/overhead/growth
  roles, unclassified wage roles (treated as fixed, deliberately
  conservative), Additional Pay, benefits, and payroll taxes pro rata;
  (2) + kitchen crew — `direct`-class BOH hourly; (3) + fixed opex
  (`cost_behavior='fixed'`) = the **P&L breakeven**; (4) + scheduled loan
  principal from `loan_schedule` = the **cash breakeven** (principal is
  invisible to QBO's P&L; interest is already inside fixed opex via 7020, so
  it isn't added again). Costs come from the *saved* month budget
  (`budget_targets`), so the card only moves when the Labor/Edit Budget tabs
  are saved.
- **FOH hourly is a variable cost, not a tier** — tipped FOH hours flex with
  covers, so it's subtracted per cover at current volume. Contribution per
  cover = spend × (1 − COGS% − variable opex%) − FOH per cover, with COGS%/
  variable opex% from `category_benchmarks` (the app's own standards), not
  recent actuals.
- **Spend and volume are a trailing 8-week window of real data** (Toast
  covers, core dine-in QBO revenue, same open-day filter as
  `weekly-targets.ts`). The weekday table asks what each night needs to
  carry an *equal share* of the selected tier at that weekday's own spend —
  an intentionally simple framing (busy nights realistically carry more).
- **Core dine-in only**: events/catering/retail margin lowers the real
  covers needed and isn't modeled.
- **Outlier nights are excluded, and listed** (2026-10-03, after the user saw
  Tuesday's spend look off in production): two Tuesdays (Aug 25 at
  $156/cover, Sep 29 at $145) posted far more core revenue than their Toast
  covers explain, and alone lifted Tuesday's average from about $86 to $103.
  **They're two different things** (confirmed with the user 2026-10-03):
  Sep 29 was a Chef's Table buyout — 12 covers at roughly $234/cover, real
  dine-in revenue that is simply unrepresentative of a normal night, not a
  miscoding. Aug 25 was the **Chaîne dinner**, a partial buyout (the
  restaurant bought out for the first few hours of service): 28 guests at
  ~$232/guest ($167.28 prix fixe + $65 wine pairing = $6,503.84, plus a 20%
  large-party service charge), real revenue and real covers. Two quirks
  combined to make the night read $156/cover: Toast's guest count on that
  4pm order was 1-2, not 28, and the order opened before the 5pm dinner-hour
  cutoff, so its covers were dropped while its revenue stayed in core Food/
  Wine. The remaining 85 table-service guests ran $80.35/guest, a normal
  Tuesday. **Not a miscoding to fix**: the Revenue tab's buyout planning
  deliberately folds buyout revenue into Restaurant Sales/Food/Beverage (see
  `revenue_buyout_plan` in schema.sql), so actuals landing in core accounts
  match the budget; recoding to Event Sales (4100s) would split actuals from
  plan. (An earlier suggestion here to ring events under a distinct Toast
  category was retracted for that reason.) The outlier filter is the intended
  handling. A pre-5pm-revenue subtraction (new Toast column + backfill) was
  offered and deliberately left undone.
  Checked against the real production distribution first: the other nights
  ran $67-$120/cover, so a band of 0.6x-1.4x the window's median sits
  inside a clean gap. The rule lives in `excludeSpendOutliers()`
  ([`server/utils/core-revenue.ts`](server/utils/core-revenue.ts)) and
  returns the excluded nights, which are named to the user, never dropped
  silently. **Applied the same day to three consumers**: this card, and
  `weekly-targets.ts` (so the Dashboard's This Week's Targets and the Revenue
  Calendar's weekday goals — on production the same two nights are the only
  exclusions since the move, shifting Tuesday's share from 14.7% to 13.6%
  and blended spend from $90.6 to $89.4). The Dashboard's spend note lists
  excluded nights. **Not applied** to `server/api/capacity/history.get.ts`
  (the Historical tab / "Set by History"), which has its own open-day
  filter. Local dev's synthetic opening-week data trips the filter heavily
  (11 exclusions) — production does not; judge it there.
- No schema change and no migration; depends on role classes (see above), so
  run `db:add-labor-role-class` in production first or every direct/fixed
  split reads as unclassified-fixed.

## Oct–Dec 2026 budget recalibration from Aug/Sep actuals — 2026-10-05

Prompted by the user asking whether Aug/Sep budget-vs-actual (Aug net −$2.4K
vs. +$19.3K budgeted; Sep +$52.5K vs. +$87.1K) says anything about how to budget
Oct–Dec. All numbers below came from read-only queries against **production**
(`fly ssh console` + disposable `.cjs` scripts piped in as base64 — local dev
doesn't have Sep data). Sep's actuals were flattered ~$8K by unposted
electricity and Marketing – PR (cash basis).

**What was found**
- **Revenue:** Aug core dining within 1.2% of budget; Sep −5.4% (about −9% on
  regular nights) — a *covers* problem, not spend/cover (Sep ~80 covers/night vs.
  85 modeled, one fewer regular night; Tue/Thu soft; outdoor and salon well
  under). Catering (Sep 5 and 26) landed to the dollar. Beverage budgets are
  accurate; the miss is food.
- **Buyouts are budgeted twice.** The Revenue tab's buyout planner already adds
  the *net* increment (rate − that weekday's normal-night target) to core
  Restaurant Food/Beverage, and actuals ring into core (Sep 30's $10,000 buyout
  posted to 4010/4022–4028, $0 to events). But 4150/4145 (On-Site Events) were
  also hand-budgeted ($10K Sep, $20K Oct, $11K Nov). Oct/Nov event accounts were
  zeroed; a partial buyout (Koepke, Oct 16 Fri dining room, $6K minimum, $3K
  deposit paid Aug 19) was added to core as ~+$1K *net* (it displaces ~$5K of
  normal dining-room revenue). A $7K Sep "Off-Site Events" (4180) line had no
  matching event at all.
- **Payroll posts every Friday** (weekly). Months with five Fridays (Jul, Oct)
  carry ~25% more labor than four-Friday months. The Labor tab already models
  this (`fridaysInMonth`); salaried roles are `weekly_salary × Fridays`, which is
  why Oct's management salaries "jump" — it is the fifth paycheck, not a raise.
  Floor Manager's Sep $3,750 = exactly three paychecks at $65K ($1,250/wk); the
  Labor tab already models her at $75K ($1,442.31/wk).
- **Payroll taxes run well above the statutory rate on posted wages**: SS and
  Medicare each imply the *same* extra taxable base (~$40K Aug / ~$49K Sep, about
  $10–12K per payroll) — almost certainly tips. SUTA/FUTA track the model fine.
- **Opex gaps (recurring, were $0 or low in budget):** Business insurance 6752
  $2,748.17 on the 2nd of every month; Reservation Platform Fees (budget −$5,000
  assumed zero real fees; actual nets ~−$4,350); Stripe (~$42/day baseline plus
  lumps — $2,024.64 on Oct 1); credit card interest, MarginEdge, travel, worker's
  comp, bathroom supplies.
- **Food cost % — revised twice; current guidance is ~26.5% of restaurant food
  sales.** Aug alone looked like 27%, then Jul–Sep blended to ~23%, but July
  (15.6%) is an artifact of June's opening pantry stock-up (cost is purchase-based;
  no inventory accounting), so any window containing July understates steady state.
  Aug (27.4%, no catering) is the only clean month; Sep (27.7%) includes some
  catering food cost — catering purchases are intermingled with regular ones in
  5010 (5220 Catering Food Costs has no postings), while catering *revenue* is
  not in the Food % denominator. Best estimate 26.5% → 5010 of $38,635 / $32,087 /
  $42,469 for Oct / Nov / Dec. Production currently holds Oct at 24% ($34,990)
  and Nov/Dec at 24.6%/23.6%; the user chose to enter the new figures by hand on
  Edit Budget. (Before the button fix below, its Jul–Sep window gave 23.4% for
  Oct — don't trust any recompute done before 2026-10-05's change.) Beverage
  budgets were left alone (Aug–Sep: liquor 21.8%, wine 37.5%).
- **"Recompute COGS from this average" button made more accurate**
  ([`app/pages/budget/edit.vue`](app/pages/budget/edit.vue), `trailingMonthsWithData`,
  `COGS_BASELINE_START_MONTH`, `cateringEventShare`): (1) the trailing window is
  now **closed months only** — it used to also accept months that merely had
  budget rows, so Nov's window averaged Oct's *budgeted* % and each recompute
  fed the next (Nov/Dec drifted up ~2pts); (2) months before
  `COGS_BASELINE_START_MONTH = 8` (Aug 2026) are excluded, since purchase-based
  COGS in June/July reflects the new location's opening stock-up (37% / 15.6%),
  not steady state; (3) a closed month with catering/event revenue (41xx/42xx
  accounts) above 5% of core dining revenue stays in the average but is **flagged
  in the banner** with its percentage, because catering purchases can't be
  separated from 5010 Food Costs. Net effect today: Oct, Nov and Dec all use the
  Aug–Sep window (~27.5% food) until Oct closes; with Sep flagged (catering was
  ~37% of dining sales) it likely reads ~1pt high for a no-catering month. The
  window grows to 3 clean months by itself as months close. Verified in the
  browser against temporary synthetic Aug/Sep rows in local dev (removed
  afterward): 28.5% food / 32.7% wine matched hand calculation and Sep flagged at
  32%. The empty-window message ("No steady-state closed months…") only appears
  for an editable month that has no closed month ≥ Aug before it, so it wasn't
  exercised. Not deployed yet.
- Oct revenue budget was already ~$9.9K above what the Capacity model implies
  (left alone; only the outdoor change below was applied).

**What was applied to production** (67 `budget_targets` rows, plus Labor-tab
settings and one capacity row; **local dev was not changed**; taken after an
on-volume backup; one transaction; every account matched by `account_number`,
asserting exactly one active row): Oct/Nov 4150/4145 → $0; Oct outdoor expected
covers 8 → 3 (`capacity_area_seasonality`) with the matching −$9.5K taken out of
4010/4022–4028 by existing weights; opex edits above for Oct–Dec; **other income
split 75% Oct / 25% Nov** ($100K Gain on Asset Sale and $67K Grant — user judged
them ~75% likely to land in Oct); labor: BOH OT hours 10 → 24/wk, Additional Pay
flat $3,000, PTO $700, ICHRA $2,350 (all saved in `labor_position_settings`, so
they survive a Labor-tab Save). Result: Oct net +$98.6K, Nov +$13.8K, Dec −$1.6K.
**Without the one-time other income Oct is about −$26.7K and Nov about −$28.1K.**

**Labor overrides that a Labor-tab Save will silently revert** (resolved by the 2026-10-07
Labor tips/first-paycheck work; the Floor Manager one was confirmed overwritten 2026-10-28).
Wine Director Oct
($4,112.22: start Oct 12, first salaried paycheck Oct 23), Floor Manager Oct
($6,634.62: raise to $75K on the Oct 23 paycheck), and all of 6083/6084/6086/6087
(payroll taxes, Oct–Dec; SS/Medicare computed on modeled wages **plus an
estimated $11K taxable tips per payroll**) were written straight to
`budget_targets`. The Labor tab recomputes every labor line from its model on
Save, and has no concept of a hire start date or taxable tips; SS/Medicare are
deliberately locked to the statutory 6.2%/1.45% (production's had once been
"calibrated" to the trailing effective rate by mistake — don't repeat that).
If the user saves the Labor tab, re-apply these three. The durable fix (a
taxable-tips input and per-person start dates) is on Not yet done.
Oct labor is still ~$127K vs. a ~$133K run-rate estimate (FOH hourly lines like
Bar Lead/Service Captain are budgeted at $0 but cost ~$1.3K/month).

**Old Mass Ave location (closed May 30; being sold)**
- New QBO account **7920 "Rent – Mass Ave (closed location)"**, type Other
  Expense / Other Miscellaneous Expense (so it hits net income via
  `other_expense` but stays out of operating rent, fixed opex and breakeven).
  Picked up by the account sync as `other_expense`.
- Rent checks are written on the 25th for the *following* month (rent is due
  the 1st). The May 25–Sep 25 checks ($2,950 each, $14,750 total) were
  reclassified from an asset account ("owed from new Mass Ave concept") into
  7920, which put **$11,800 of rent on the P&L that wasn't there before**
  (May–Aug; Sep's was already in opex). Oct is budgeted $0 on purpose — the user
  hopes not to pay November's rent — but cash basis means an Oct 25 check would
  still land in October actuals.
- A $520 posted to 7920 on 5/29 was a **security deposit** on the new Mass Ave
  lease, mistakenly reclassified with the rent; moved to asset account
  1416 "Security Deposit – New 1263 Mass Ave" (balance sheet, not synced here).
- Aug 20's $4,643.45 Eversource bill was recoded Gas (6522) → Electricity (6521).

**Gotcha: a backdated reclass leaves stale duplicates.** The nightly sync only
moves forward (30-day floor), and `scripts/backfill-qbo-pl.mjs` only *upserts
rows QBO still reports* — a line that moved between accounts keeps its old row.
[`scripts/oneoff-resync-energy-rent.cjs`](scripts/oneoff-resync-energy-rent.cjs)
fixes this for a given range: it takes a `VACUUM INTO` backup, deletes the local
`daily_line_items` rows for the listed accounts/dates, re-pulls them via the
backfill script, and restores from the backup if the re-pull fails. Usage and
the exact pipe-into-the-container command are in its header; args are
`<since> <until> <qboAccountId,qboAccountId,...>` (QBO ids, not local ids).
Run for Jul 25–Aug 31 (118,119), Jun 20–Oct 4 and Jan 1–Jun 19 (31,1150040249),
and May 1–31 (1150040249).

**Claude's production writes.** The budget apply ran only after the user gave
explicit approval; the re-sync script was blocked twice by the auto-mode safety
classifier (which is separate from, and not changed by, the `Bash(fly ssh ...)`
allow rules already in `.claude/settings.local.json`), so the user ran it
themselves. Do not try to reach production through another route after a block.
That settings file also holds a plaintext Basic Auth login inside a saved `curl`
rule (gitignored) — worth deleting and rotating.

**DSCR heads-up (unverified):** the 1.53x covenant figure predates these changes.
Projected FY net income fell ~$80K from the budget edits plus ~$12K from the rent
reclass, so the ratio may now sit near or below the 1.25x floor. It also includes
the $167K of one-time other income; whether the bank's EBITDA counts a gain on
asset sale is an open question for the accountant.

**Cleanup due ~2026-10-07:** four production DB copies are on the Fly volume
(`/app/data/backup-pre-oct-edits-*` and three `backup-pre-resync-*`); they contain
the QBO OAuth tokens, so delete them once the numbers are trusted
(`fly ssh console -a restaurant-pulse -C "sh -c 'rm /app/data/backup-pre-*'"`).

## Labor tips and first-paycheck dates — 2026-10-07

Closes the "Labor overrides that a Labor-tab Save will silently revert" gap from the
Oct–Dec recalibration section above, for two of its three causes:

- **`labor_tax_rates.taxable_tips_per_payroll`**: tips per weekly payroll, added to the wage
  base for Social Security and Medicare only (FUTA/SUTA/PFML stay on wages). The 6.2%/1.45%
  rates stay locked. Entered in the Labor tab's Payroll Taxes section, with a hint of what
  trailing actuals imply (`impliedTaxableTipsPerPayroll` in `labor-settings.get.ts`: SS tax ÷
  6.2% − wage-subject pay, per Friday). The hint is never applied automatically. Tax on tips
  has no role to belong to, so the role-class card leaves it in "Benefits & other".
- **`labor_position_slots.first_paycheck_date`**: a PAYCHECK date, not a hire date (payroll
  lags: start Oct 12 → first paycheck Oct 23). Only Fridays on/after it are budgeted for that
  person (`slotFridays` in labor.vue). Date input on each hourly person row and each
  management row.
- **Not modeled**: a raise effective mid-month (Floor Manager's $65K→$75K from the Oct 16
  paycheck). The hand-written October figure for it was overwritten by a later Labor-tab Save
  (confirmed 2026-10-28, see below); don't re-apply it. An effective-dated salary would fix it
  properly. Also, `monthExpectedToDateFraction` still prorates by all Fridays, so a
  current-month new hire's "projected" figure is slightly off.
- **The overrides were not removed from production.** After deploying, enter the real tips
  figure and first-paycheck dates in the UI and confirm a Save reproduces the hand-written
  Oct–Dec numbers before trusting it.
- **Migration**: `node scripts/add-labor-tips-and-start-dates.mjs` (idempotent). Run it on
  production by hand BEFORE `fly deploy`, or `/api/budget/labor-settings` 500s.
- Verified locally: migration (twice), upsert SQL, Friday math (Oct from 10/23 = 2 of 5), and
  typecheck. Not exercised in the browser — local dev needs a Basic Auth login.
- **Production rollout, 2026-10-07**: migration run by hand over `fly ssh console` (script
  uploaded via `fly ssh sftp shell`; that shell only accepts cd/ls/get/put/chmod — leave with
  Ctrl+D), then `fly deploy`. In the Labor tab: taxable tips **$10,100/payroll** (trailing
  actuals implied ~$10,114), Wine Director first paycheck **2026-10-16** (salaried start Oct 5,
  payroll lags ~11 days). A Save then recomputed Oct–Dec payroll taxes (6083/6084/6086/6087)
  and the Wine Director from the model; Oct matched Edit Budget afterward.
- **Floor Manager's raise was a manual override, since overwritten (2026-10-28).** $65K→$75K
  ($1,250→$1,442.31/wk) from the Oct 16 paycheck; Oct has five Fridays, so Oct = 2×$1,250 +
  3×$1,442.31 = $6,826.92, while the Labor tab says $7,211.54. It was written straight to
  `budget_targets` for 6058 (with the Oct tax lines adjusted by the $384.62 difference), but a
  later Labor-tab Save recomputed it: production's Oct 6058 budget is now $7,211.54, matching the
  model, so there is nothing left to re-apply and saving reverts nothing. Net effect: October's
  Floor Manager budget runs about $385 above actual, since the tab applies the new salary to
  all five Fridays. Nov/Dec ($5,769.23) are right as modeled. The effective-dated salary change
  is still unmodeled.
- Backups taken during the rollout contain QBO tokens; delete `/app/data/backup-pre-*` once
  numbers are trusted.

## Revenue Modeling: additional special events and retail — 2026-10-07

Three new what-if sections on [`app/pages/revenue-modeling.vue`](app/pages/revenue-modeling.vue)
for revenue the per-area covers/spend model and the buyout counts don't
capture (see `reports/retail-sales-2025.html` for the 2025 retail history
that motivated it). A first version had one generic retail list; the user
clarified retail is really two things, so it was split the same day:

- **Additional Special Events** — popups, off-site dinners: times/year x
  revenue each.
- **Ongoing Retail: Added Monthly Sales** — a lift to year-round retail
  (biscuits, pantry, bottled cocktails): added $/month x months, with months
  defaulting to the remainder of the year (current month through Dec). Shows
  the already-expected context beside it: budgeted $/month for those months
  and the trailing 3-closed-month actual average, both from the leaf accounts
  under 4300 Retail Sales (`retailBudgetByMonth`/`retailTrailingMonthly` in
  `server/api/revenue-modeling.get.ts`; never reads 4300 itself, avoiding the
  parent-carries-its-own-amount double count noted under Not yet done).
- **One-Time Retail Offerings** — holiday/popup retail (Thanksgiving pickups,
  Nordic popup) that supplements the ongoing sales: a single total revenue
  per offering, no count.

Each line is a name, quantity (where applicable), revenue, and a
**direct-cost %**. Client-side scratch state only (`extraLines`, with a
`kind`), same as the buyout counts — never persisted, cleared by Reset
simulation, no schema change, no migration.

- **Direct-cost % replaces the blended COGS % for these lines** (defaulting to
  the year's blended COGS %, editable per line): retail biscuits and a ticketed
  event have very different margins from dining. Put any extra event labor in
  this %, since these lines add no variable labor (labor still scales with
  covers only). Variable opex still scales with *total* revenue, extras
  included. In `annualImpact` the blended COGS % now applies to
  `coreSimRevenue` (baseline + covers/spend/buyout delta) only, and extras'
  direct cost is added separately — shown as its own "Added events/retail
  direct costs" row in the breakdown table rather than hidden inside COGS.
- These are **on top of** the baseline, which already includes whatever is
  budgeted in the event/catering/retail revenue accounts, so a line should
  only hold the *increment* — the same convention as the buyout "+N more than
  booked" stepper. The DSCR covenant card picks the change up automatically,
  since it layers the simulation's net-income delta on its baseline.
- **Not browser-verified**: local dev is behind Basic Auth, so this was never
  clicked through. Checked by compiling the SFC with `@vue/compiler-sfc` and by
  `npm run`-less `npx nuxi typecheck`: no new type errors (254 before and
  after; all pre-existing, mostly strict-undefined complaints elsewhere).
- **`vue-tsc` + `typescript@5` are now devDependencies** (added 2026-10-07 so
  `nuxi typecheck` works). `typescript` is deliberately pinned to 5.x — `npm
  add` otherwise pulls TypeScript 7, which `vue-tsc` 3 can't load. Compare
  error counts against a baseline rather than expecting zero.

## SBA payments routed through the loan reserve, effective Nov 1 2026 — 2026-10-08

The user's call, to isolate all debt service from the main Amex operating
account: one weekly transfer into the 1005 Loan Reserve funds everything, and
each month the SBA payment ($6,161.18, level through 2035) moves from the
reserve to the SBA account before the 12th. A transfer between two bank
accounts, so no P&L effect in QBO.

- **`SBA_VIA_RESERVE_FROM = '2026-11-01'` / `isReserveFunded()`**
  (`server/api/cashflow.get.ts`) replace the old `loan_key !== 'sba'` test
  everywhere: `reserveFundedRows` (reserve simulation, 2027 sustainability,
  minimum deposits), `freeCashFlow()`'s direct-vs-reserve split, and the
  year-projection direct/reserve-funded totals. SBA payments before Nov 1
  (including Oct 12, already funded in the SBA account) stay "direct" and are
  still subtracted as principal; from Nov 12 they are reserve draws, covered
  by the reserve transfers already subtracted, so they are not subtracted
  twice (same double-count rule as 2026-08-16).
- **Numbers that move** (expected, from `loan_schedule`): Nov 12 and Dec 12
  add $12,322.36 of draws before Dec 20 (the $61,693.48 target is unchanged);
  2027 reserve draws rise from $199,579.20 to $273,513.36 a year, so
  break-even goes from about $3,838 to about $5,260/week and the recommended
  rate from $4,000 to about $5,500/week, with a larger Jan 1 buffer. The "Cash
  still needed" card now carries only the Oct 12 SBA principal directly.
- **Not done**: the DSCR covenant cards still use all loans / the scoped set
  regardless of funding source, which is correct. No schema change.
- Verified by typecheck only (no new errors beyond the pre-existing
  strict-undefined ones in these files); not clicked through in a browser
  (local dev is behind Basic Auth). Check the Cash Flow page after deploy:
  the reserve cards should show the larger 2027 rate and the Nov/Dec draws.

## DSCR covenant EBITDA now adds back all loan interest expense — 2026-10-19

Found while building a covenant report for Erin (`reports/covenant-scenarios-2026-10.*`,
generated from scratchpad scripts, not app code): the covenant's EBITDA added
back only `loan_schedule`'s regular interest for the counted loans ($21.5K for
the 6-loan scope), while the denominator included the one-time catch-up
interest ($43.9K). Standard EBITDA adds back the interest expense actually on
the P&L, which for 2026 is about $80K in account 7020. At the user's direction:

- `server/api/cashflow.get.ts` computes `loanInterestExpenseForYear`: account
  7020 month by month, real posted amount for a closed month that has synced,
  budget for the current and future months (the same rule as the client's
  `hybridYearTotalsPastActual`, so it matches the projected Net Income it's
  added to). Both `covenant` and `covenantScoped` use it; the field replaced
  `scheduledInterestForYear`. Cash Flow and Revenue Modeling read the new name.
- Only 7020 (loan interest). 7010 Credit Card Interest (~$2.7K in 2026) and
  7025 Non-Cash Investor Consideration are not added back; revisit if the bank
  defines EBITDA more broadly.
- Effect on production numbers: the 6-loan ratio moves from 0.93x (short
  $28.6K) to about 1.58x (about $29.9K of cushion). The all-10-loans reading
  is about 1.10x, still short about $19.3K. Without the budgeted $100K Oct
  gain on asset sale, the 6-loan ratio falls to about 0.46x — whether the
  sale lands in 2026 and whether the bank counts a one-time gain is now the
  covenant's main open question.
- Verified by running the new SQL read-only against production ($80,015.30)
  and by typecheck (no new errors); not deployed or clicked through yet.

## Old-location asset sale: catch-up depreciation and the real gain — 2026-10-19

The 2026 budget carries a $100K "Gain on Asset Sale" (8010, Oct) as if book value were $0.
It isn't: the 2263 Mass Ave assets ($215,161 of cost in QBO) had no depreciation booked at
all. Reconstructed from the tax returns' depreciation totals (2016–2021 = $171,386; 2022–23
$0; 2024 $5,181; 2025 $3,317) and the QBO asset registers, with a SaasAnt journal entry prepared in
`reports/depreciation-catch-up/` (README explains the 4 accumulated-depreciation accounts to
create first, the assumptions, and the open question about $11,769 left on the leasehold
interest). Imported into QBO by the user on 2026-10-19 (journal entry
DEP-CATCHUP-12-31-2025, debit Retained Earnings $193,441.67); it has no P&L effect, so nothing in
the app's synced data changes.

- Effect: about $21.7K of book value remains (the old high-temp dishwasher, replaced 8/2025 per
  the 2025 depreciation worksheet, is written off in the same entry, not sold), so the real gain
  is about $78.3K, not $100K. The covenant cushion falls from about $29.9K to about $8.1K (1.34x,
  6-loan scope). EBITDA is
  unaffected by whether the catch-up goes through retained earnings or 2026 expense.
- What the $100K buys (ad dated 2026-08-29, plus Erin's asset list `2263MassAveValuation8.26.26.xlsx`):
  the equipment (original cost $92.9K, estimated resale $39K), the existing 5-year lease (from
  6/1/2026, $2,950/mo) and the Cambridge liquor license, with landlord/City/ABCC approval and fees
  extra. So about $61K of the price is lease + license + goodwill, and the $11,769 left on 1405
  is probably real basis in that intangible: do not write it off (gain stays about $78.3K).
- Revised same day after the user offered to rewrite the 2016 journal entry (no Form 8594
  exists): per the Bill of Sale ($83K personal property) the 2016 split becomes 1405 $2,000 /
  1330 $73,000 / 1320 $10,000 (was 40,000 / 35,000 / 10,000), the catch-up entry uses 3
  accumulated accounts (no amortization account), and the user's CSV import needs MM/DD/YY dates
  and "Debit Amount"/"Credit Amount" headers (the generator now writes that). Total left on the
  books is unchanged ($21,719) until the next item. $9,769.36 of old equipment was never
  depreciated and is 2016 inventory; the accountant agreed to write it off (in the catch-up CSV, or
  `saasant-inventory-writeoff-only.csv` if the revised catch-up was already imported). That leaves
  $11,950 on the books, a gain of about $88.1K and a covenant cushion of about $17.9K (1.45x). The
  price allocation between equipment and intangibles matters for tax character (ordinary
  recapture vs capital gain), not for the covenant. License/lease transfer approvals are a
  closing-timing risk for the 2026 gain.
- Budget (done by the user 2026-10-19): the $100K was removed from Oct and $88K entered for Nov
  (8010), since the lease/license transfers need approvals and closing is unlikely in October.
  Summary for the accountant: `reports/depreciation-catch-up/accountant-summary-2025-amendment-and-2026-return.txt`.
- Section 179 on the 1281 Cambridge St purchase (2026-10-19): the accountant plans to elect it on
  all (or as much as allowed of) the new location's furniture and equipment; the user estimates
  up to about $300K (QBO's new-location furniture/equipment is far larger than the $112,765 appraisal
  list on the worksheet, which covered only the assets conveyed with the property; some conveyed
  assets were also disposed of, disposal records still to do). **On hold:** Section 179 is limited
  to business income for the year (the excess carries forward), and the amount, and whether the
  books mirror it, will be decided at 2026 tax prep in early 2027. Nothing is budgeted on account
  7910 Depreciation (other_expense) and the covenant report assumes $0 depreciation. When it is
  decided: it lowers net income but not EBITDA, since the covenant add-back sums the year's
  budgeted 'Depreciation' (switch it to read actuals if the entry is booked).
- `budgetedDepreciationForYear` (covenant add-back) is budget-only and is $0. If 2026
  depreciation is ever booked in QBO, that add-back must read actuals like
  `loanInterestExpenseForYear` does, or EBITDA will be understated.
- The covenant report for Erin is `reports/covenant-scenarios-2026-10.pdf`, generated by
  `scripts/covenant-report/` (hard-coded production figures as of 2026-10-19; `dep.mjs` also writes the
  SaasAnt CSVs in `reports/depreciation-catch-up/`; the header of `gen.mjs` has the PDF command).

## Revenue Calendar "Event night" status — 2026-10-21

The Mushroom Dinner (Tue 2026-10-20, ticketed on-site event) posted to 4145/4150 (Event Sales), outside
`CORE_REVENUE_ACCOUNT_NUMBERS`, so the calendar read it as core $0 / ▼100% against Tuesday's dine-in goal.
`pl.get.ts` now also sums Event Sales (account_number 4100–4199, `EVENT_REVENUE_RANGE` in
`server/utils/core-revenue.ts`) per day and flags `eventNight` when event revenue is positive and core is under
25% of that weekday's goal (`EVENT_NIGHT_MAX_CORE_SHARE`). Event nights render as a blue "★ Event" cell with the
event dollars, are left out of the shortfall callout and the "N of M days" count (listed separately under it), and
never get a ▲/▼ score. The 25% rule is `isEventNight()` in `server/utils/core-revenue.ts`, shared with the Dashboard: its This Week's Targets day cards show a blue "★ Event night" chip with the event dollars, and the week-to-date hero card counts the event night's event revenue toward progress (its own target stays in the expected-by-now figure; changed from excluding it entirely 2026-10-21, which also left "No goal set" showing when the event night was the only elapsed day). Event income on an ordinary night is not added. Event income alongside a normal service stays an ordinary, core-scored day. The Margin tab
(`nightly-margin.get.ts`) was not changed. Verified against local dev by seeding a synthetic event night
(reverted afterward); not yet deployed.

## Budget row shading — 2026-10-24

The Edit Budget and Revenue tabs' Projected (current month) and closed-month Actual
variance indicators were just colored text plus a ✓/▲/▼ icon, too subtle to scan for the
real divergences. Rows now get a whole-row gradient fill: unshaded = no meaningful delta,
pale pink -> bright red -> deep red = running worse than budget (over on costs, under on
revenue), pale green = running better. Logic is `varianceTint()` in
[`app/composables/useBudgetData.ts`](app/composables/useBudgetData.ts), styles are
`.var-bad`/`.var-good` in [`app/assets/css/main.css`](app/assets/css/main.css).

- **Strength = geometric mean of percent-off and dollars-off**, since neither alone is a
  fair materiality test (a $24 miss on a $100 line, or $2K on a $100K category). Under 3%
  or $50 off is never shaded. Full strength is 30% off and $500 off.
- **Red is a real bright red and darkens as it strengthens; green is deliberately paler
  and capped**, so the two differ in lightness, not just hue (user has red-green CVD). The
  ✓/▲/▼ icon and dollar delta stay on every row; shading is reinforcement. Strong red rows
  flip to white text.
- **Applied to**: category and account rows on Edit Budget (current month with actuals, and
  closed months), account rows and the Total Revenue row on the Revenue tab. Not applied to
  the Year Total tabs or Budget Pace's pace cards (no per-row projection there).
- **Projection rules per account (2026-10-24, Edit Budget only)**: straight-line projection
  only fits steady costs. `projectionRule()` in `app/pages/budget/edit.vue`: COGS, revenue and
  processing fees (6200/6210/6220) project at a constant rate; labor uses the Friday-payroll
  fraction, except ICHRA (6065/6066, monthly charges); everything else (most opex, other
  income/expense) is a *lump*: projected = max(actual to date, budget). So a posted overrun
  flags (rent $17.6K vs $11.5K) but an unposted bill never shows a false underrun/green.
  Parent and category projections sum their children. Account numbers are hand-set, revisit
  if new steady accounts appear (e.g. 6305 reservation fees were left as a lump).
- Verified by rendering the real CSS and the real `varianceTint` output headlessly in light
  and dark; not clicked through in the live app (local dev is behind Basic Auth).

## Oct–Dec 2026 non-labor budget corrections, round 2 — 2026-10-24

Second recalibration pass (after 2026-10-05), from production data synced through 2026-10-23.
Read-only queries via disposable `.cjs` scripts over `fly ssh console`; the write ran only after
the user approved the table. Backup first (`/app/data/backup-pre-octdec-fix-2026-10-24T15-45-31-590Z.sqlite`),
one transaction, accounts matched by `account_number` (asserted exactly one active row), re-read to verify.

- **Applied to `budget_targets` (2026):** 5010 Food Costs Nov $33,570 → $37,270 (27.3% of the $136,511
  Nov food revenue budget; Aug/Sep ran 27.0%/27.8%); 6522 Gas Nov $460 → $900, Dec $460 → $1,300 (no
  winter history at this location, so estimates); 6210 Stripe Fees Nov/Dec $1,500 → $2,000 (~$2.2K/mo
  actual); 7920 Mass Ave closed-location rent Oct $2,950 / Nov $0 / Dec $0 (new rows — 10/22 check
  posted; user does not expect to write Nov 25 or Dec 25 checks). Net income effect: Oct −$2,950,
  Nov −$4,640, Dec −$1,340.
- **Catering Profit Share (6004):** no catering in Nov/Dec, so it stays $0 (budget row and Labor-tab
  flat amount both already 0). The Oct 2 payment ($5,268) is unbudgeted: the Labor tab's `flat_amount`
  is the same every month, so a one-month figure can't live there and a raw write would be reverted by
  the next Labor Save. Left as an explained variance.
- **Labor was edited by the user on the Labor tab, never written by Claude.** They unchecked "scale
  hourly wages & overtime with seasonal demand" and saved (Dec $121.6K → $109.0K = Nov; Oct $128.6K).
  Comparing the modeled rates to the last 8 payrolls surfaced more inputs; what happened to each:
  - **Business Manager:** I suggested $769.23 → $1,153.85/wk (it had been paid $1,154/wk since 9/18),
    but the user then **cut their own salary from $60K to $40K through year end** to help cash flow —
    $769.23/wk, exactly what the tab already had, so no change. Oct still over (first four paychecks
    were at $60K) and the tab can't model a mid-month change.
  - **Wine Director:** the 10/16 first-paycheck date was premature. Start is TBD, assumed Nov 2 → first
    paycheck **Nov 13** (a 10/12 start produced a 10/23 first paycheck, ~11-day payroll lag). Budget
    now Oct $0 / Nov $4,327 / Dec $5,769. She previously worked hourly as Wine Director ($30/hr) and as
    Service Captain ($12/hr plus tips), so the Service Captain line ends when she goes salaried; the
    pre-start hourly pay (~$470, one payroll) isn't modeled.
  - **SUTA rate** 2.19% → ~1.1% (wage-base caps are being hit; last 4 payrolls averaged $255 vs. $510
    modeled; **revert for 2027**). FUTA left alone (~$90/mo).
  - **BOH OT left at 24 hrs/wk** (~$930/wk), since the user is working to lower it. Last 8 payrolls
    (9/4–10/23): $375, $1,808, $608, $385, $2,398, $510, $1,993, $1,029 (avg $1,138, median ~$820).
  - **PTO left at $700/mo.** Oct's $1,971 is an outlier; closed-month actuals in production are
    Apr $1,015, May $864, Jun $0, Jul $880, Aug $360, Sep $1,050 (no rows before April), averaging
    $695, so $700 already is the average.
  - **Result** (read back from production after the saves): labor Oct $123.6K / Nov $107.2K /
    Dec $108.7K. Nov/Dec match the payroll run-rate (~$105–109K); Oct will likely land ~$134K, ~$10K
    over — catering profit share $5.3K, Business Manager at $60K for four paychecks, bonuses/PTO above
    budget, OT, and pre-start hourly pay, none of which the model can express. Left as an explained
    variance.
  - **Hourly-hours check, same day:** comparing each hourly account's modeled $/week to its last 8
    payrolls (QBO posts by account, not person, so only account totals can be checked) found the tab
    mostly accurate. A red Pastry Prep Cook row on Edit Budget was an artifact: the 10/2 payroll was
    $1,860 (~$780 above normal), and the projection scales actual-to-date by 5/4, carrying that spike
    forward; ex-spike the projection (~$5,200) matches the $5,265 budget. The user saved: Prep Cook
    slot 2 30 → 37 hrs/wk (modeled $1,939/wk vs. $1,933 actual mean); Concierge 24 + 24 hrs (was
    21 × 25/33; modeled $1,008/wk vs. $878–$1,102 actual); Mario (Pastry Prep) 39 → 40 hrs; Elijah
    (Line Cook) first paycheck 10/23 → 10/30 (the 10/23 payroll still looked like two cooks).
    Result: labor Oct $122.4K / Nov $107.1K / Dec $108.7K, basically unchanged, since the edits mostly
    shift mix. Modeled BOH hourly is ~3% above recent actual plus Elijah (Sous Chef at full hours is
    the cushion); FOH hourly is within ~4%. Caveats from the user: other cooks may log hours under
    Line Cook, Magdalene works some hours as a server (posts to Server, which is on target), and the
    $25/hr on the anonymous Prep Cook slot is a guess — only the account's weekly dollars matter to the
    budget, but if Elijah's hours are really already in Line Cook actuals, his $1,040/wk double counts.
  - **Open:** the Labor tab still budgets Service Captain (Katie, $12 × 14 hrs) at $672/mo for Nov and
    Dec, which double counts once the Wine Director is salaried (no other captain is being hired).
    Zero the slot's hours on or after Nov 1 — a Save rewrites the current month through December, so
    saving earlier would also zero Oct's $840 against ~$900 of real pay. Employee Bonus left at $500
    (actual $1,500 Sep / $1,700 Oct) — the user's call.
- **Left alone on purpose:** Toast fees (user said fine; Nov $6,400 is ~$900 above 3.0% of Nov core
  sales), electricity, marketing PR, loan interest 7020. Optional, not applied: Dec hood cleaning
  (6610) ~$1,000 (last one was $1,002 in Sep, guessing a quarterly cycle).
- **Cleanup due:** delete the backup above once numbers are trusted — it contains QBO tokens
  (`fly ssh console -a restaurant-pulse -C "sh -c 'rm /app/data/backup-pre-*'"`; the 2026-10-05 backups
  may still be there too).

## Staff Hours report (ICHRA eligibility) — 2026-10-27

New top-level **Staff Hours** tab ([`app/pages/staff-hours.vue`](app/pages/staff-hours.vue), route
`/staff-hours`, data from [`server/api/staff-hours.get.ts`](server/api/staff-hours.get.ts)): average hours
per week per employee over the trailing 90 days, split into **full-time (30+ hrs/week, benefits eligible)**
and **part-time**. Built for the company's ICHRA rule (average at least 30 hrs/week over 90 days).

- **Unblocked by a new Toast scope**: the user added `labor.employees:read` to the `TOAST_*` credential
  in Toast's developer console. That scope is for the Labor API's `GET /labor/v1/employees` (returns
  `firstName`/`lastName`/`chosenName`, a `deleted` flag, and email/phone/passcode we deliberately don't
  store) — separate from the standalone Employees API, which the Toast section above still says is
  forbidden. Verified live before building. Each time entry carries `employeeReference.guid` to join on.
- **Two new tables** ([`schema.sql`](schema.sql)): `daily_toast_employee_hours` (date, employee_guid, hours,
  plus `auto_clocked_out_shifts`/`_hours`) and `toast_employees` (guid, names, `deleted`). Filled by
  [`server/utils/toast-employee-hours.ts`](server/utils/toast-employee-hours.ts) from the same
  `timeEntries` call `syncToastMetricsForDate` already makes (no extra call per day); employee names are
  refreshed once per nightly run in `runNightlySync`. A name-sync failure only logs a warning, it doesn't
  fail the covers/labor-hours sync. Each day's rows are replaced wholesale, so a corrected/deleted Toast
  entry can't leave a stale employee-day behind.
- **Unlike `daily_toast_metrics.labor_hours`, salaried jobs are included** — eligibility is about hours
  worked, not pay type, and salaried staff clock in here (see the Toast section). Staff who never clock in
  won't appear at all.
- **Average = total hours ÷ (window days / 7)**, the policy's literal reading, with the window ending at
  the last *synced* day (not today) so a lagging sync can't dilute everyone by a day of zeros. Classification
  uses that full-window average only. A **recent hire** therefore lands in part-time even if they're
  running 35+/week; rows whose first shift is >14 days into the window show "pace since first shift" as
  context, not as a classification. If synced history starts >6 days after the window start, the page shows
  an "Incomplete history" chip and averages over the days actually present.
- **Revised 2026-10-27 (user's call)**: the **Salaried group is first and names-only** — no hours, shifts or
  clock-in notes, since salaried staff's Toast clock-ins don't reliably reflect hours worked. Auto clock-outs
  are **only flagged when one happened in the last 7 days** (`AUTO_CLOCKOUT_FLAG_DAYS`, counted back from the
  last synced day); older ones are assumed corrected in payroll. The API fields are now
  `recentAutoClockOutShifts`/`recentAutoClockOutHours`.
- **Enrollment marks (2026-10-27, user's request)**: eligible people default to enrolled; each row in the
  Salaried and Full-time groups has an Enrollment dropdown (Enrolled / Declined / Canceled — e.g. non-payment
  or missing documents). Marking someone moves them to a new **"Eligible and not enrolled"** group (status,
  how they're eligible, and an editable note, saved on blur); "Enrolled — remove mark" there clears it. The
  eligible groups are now labeled **"Eligible and Enrolled · Salaried"** / **"· Full-time"**; part-time is
  "Part-time — not eligible". Stored in `benefits_enrollment_status` (employee_guid, status, note), written by
  `POST /api/staff-hours/enrollment`; no row means enrolled. A mark on someone who isn't currently eligible
  (dropped to part-time) is ignored, not deleted. **The third table is in the same migration script**
  (`add-toast-employee-hours-tables.mjs`), so the production rollout below is unchanged — it just creates
  three tables now. Verified in the browser against local data (marks moved people between groups, note
  persisted, clearing worked, bad input returns 400/404) and all test marks were removed afterward.
- **Layout revised 2026-10-27 (user's call, after seeing production)**: the Salaried and Full-time groups are
  **one table**, "Health Benefits Eligible · Enrolled" (salaried first, with "Salaried" in the hours columns);
  "Eligible" is spelled out as health-benefits eligibility everywhere — "Health Benefits Eligible · Not
  Enrolled" and "Not Health Benefits Eligible · Part-time". **Total hrs and Shifts columns are gone** (the API
  still returns them). This supersedes the group names in the enrollment-marks bullet below.
- **Enrollment now defaults to TBD, not enrolled (2026-10-27, user's call)**: every health-benefits-eligible
  person with no recorded decision is **TBD** and shown in a green-shaded "Enrollment TBD · Needs follow-up"
  group at the very top (the way to spot someone who newly qualified, or whom you're waiting to hear back
  from). Status is now `enrolled` / `declined` / `canceled`, or no row = TBD; the per-row dropdown has all
  four options (TBD clears the mark). Enrolled people are in "Health Benefits Eligible · Enrolled". **On
  deploy, everyone currently eligible starts as TBD**, since "enrolled" used to be implicit and was never
  stored — mark each person Enrolled once. `benefits_enrollment_status`'s CHECK had to widen to allow
  `'enrolled'`, which SQLite can't do in place, so `add-toast-employee-hours-tables.mjs` now rebuilds an
  old-shape table (keeping rows; no-op on a new-shape one). **Production already has the old-shape table, so
  re-run that script on the volume BEFORE the next `fly deploy`** (same upload + run steps as before).
  No notes on TBD people (a note needs a row); notes live on Declined/Canceled rows only.
- **Failed saves are loud (2026-10-27)**: if an enrollment save fails, the dropdown reverts to what's stored
  and a sticky red "Not saved" banner shows the reason. The one known cause — production's table still having
  the old CHECK (declined/canceled only) because the migration wasn't re-run before deploy — returns an
  explicit "enrollment table is out of date — run add-toast-employee-hours-tables.mjs" message.
- **Auto clock-outs are flagged, not corrected.** Toast auto-clocks-out a forgotten clock-out, and those
  shifts run long (a 30-day live sample: 10.8h avg vs. 7.4h for manual clock-outs, ~9% of all hours). A row
  with any shows "⚠ N auto clock-outs (X of these hrs) — check Toast". This matters near the line: one
  person at 30.1 hrs/week had 14 of them. Fix the clock-out in Toast and re-sync that date.
- **Eligibility overrides (2026-10-27, from the user)**: former employees (`toast_employees.deleted`) are
  omitted; **salaried** staff are always eligible and get their own "Salaried" group (hours shown for
  reference, no 30-hr comparison) — Abigail Taylor, Shane Allerheiligen, Josh Sokol (listed as "Joshua" by
  the user, "Josh" in Toast); **Katie Janik** is grandfathered into the full-time group whatever her average.
  Names are constants in `staff-hours.get.ts` (`SALARIED_EMPLOYEES`, `GRANDFATHERED_EMPLOYEES`, matched on
  Toast's lowercased "first last"). The salaried list is built from Toast employees, not from hours, because
  Josh Sokol has no time entries at all (he doesn't clock in) and so never appeared in the hours-driven
  report; a configured name that matches nobody shows a warning chip instead of vanishing.
- **"Service Bar" is excluded** (`NON_PERSON_LOGIN_NAMES` in `staff-hours.get.ts`): a shared station login
  (~9 hrs/day over 76 days, 46 auto clock-outs), not a person — it would have shown as a 55 hrs/week
  full-timer. Always reported on the page under "Not listed" so the exclusion is visible. Add other shared
  logins to that set by (lowercased) display name.
- **Not built**: a per-week breakdown per employee, a configurable threshold/window (30 and 90 are
  constants in the API), and any link to the ICHRA enrollment-timing question (eligibility is determined by
  this average, but the MA Health Connector payment cutoff around the 22nd–23rd of the prior month means
  coverage and reimbursement can't start before the following month — that's a policy/timing question this
  page doesn't model).
- **Production rollout (not done yet — migrate first, then deploy, or the nightly sync's employee-hours
  write fails on the missing tables):**
  1. `node scripts/add-toast-employee-hours-tables.mjs` on the production volume via `fly ssh console`
     (idempotent; same upload-via-`fly ssh sftp shell` pattern as the other manual migrations).
  2. `fly deploy`.
  3. Backfill the 90-day window inside the container (the `npm run` wrapper expects `.env.local`, which
     doesn't exist there, but the Toast secrets are already in the environment):
     `fly ssh console -C "node scripts/backfill-toast-employee-hours.mjs"`.
  Local dev already has both tables and the last 90 days backfilled (`npm run
  db:add-toast-employee-hours-tables`, `npm run db:backfill-toast-employee-hours`).
- Verified: live Toast API probe; the helpers against an in-memory DB with a stubbed Toast response
  (multi-shift day, deleted/zero-hour/no-employee entries ignored, correction replaces stale rows, no PII
  stored); the page in the browser at desktop and phone width; typecheck clean for the touched files.
  `runNightlySync` itself wasn't run (it refuses outside production by design).

## Kitchen Labor tab — 2026-10-27

New top-level **Kitchen Labor** tab ([`app/pages/kitchen-labor.vue`](app/pages/kitchen-labor.vue), route
`/kitchen-labor`, data from [`server/api/kitchen-labor.get.ts`](server/api/kitchen-labor.get.ts)): BOH wages as
a percent of food revenue, per Mon–Sun week, with latest week, trailing 4- and 13-week (weighted, not
averaged percents) cards.

- **Alignment**: payroll posts Friday F for the week F−11 to F−5 (10/23 payroll = Oct 12–18), matched against
  that same week's revenue. A labor posting is assigned to the first Friday on/after its date (so an early
  holiday payroll still lands in its own cycle); non-Friday dollars are reported on the page. A week shows
  "Awaiting payroll" until its payroll Friday is in synced data.
- **Labor** = accounts under 6010 BOH Wages (incl. inactive per-role OT accounts, whose history remains on
  them) except names starting "Porter", plus the Executive Chef (6054), which the page toggles (default off;
  salaried owner comp). Wages only: payroll taxes, benefits and bonuses are not allocated.
- **Food revenue** = 4010 restaurant food, 4150 + 4180 event food, 4230 catering food, 4320 retail food.
  Beverage, service/equipment fees, books and contra-income (comps/discounts can't be split food vs. bev) are
  excluded, so revenue is before comps.
- Only the last 4 months of weeks are shown (`HISTORY_MONTHS`), so pre-opening weeks (huge labor, tiny revenue) don't blow out the chart scale.
- No benchmark/status coloring: nothing in `category_benchmarks` covers kitchen labor yet.
- Verified only against local dev, whose labor is posted daily (stale accrual-era data), so the percentages
  there are not meaningful; check against production, where payroll posts on Fridays. No schema change.

## BOH hours report on the Kitchen Labor tab — 2026-11-06

Requested so the Sous Chef (Rebecca) can manage hours: BOH hours worked per person for a
Mon–Sun week, at the top of the Kitchen Labor page
([`app/components/BohHoursReport.vue`](app/components/BohHoursReport.vue)), plus a
**Download report (HTML)** link that returns a standalone page (inline CSS, no scripts, phone-
friendly, light/dark) to send over Slack. First placed on the Staff Hours page, moved to
Kitchen Labor at the user's call.

- **Hours, not dollars**: from Toast time entries, so no payroll lag (the rest of the tab is
  QBO dollars a week behind). Runs through the last synced day (normally yesterday); the week
  nav (‹ ›) defaults to the week containing the latest synced day. Shows total BOH hours, overtime hours,
  vs. the same days last week, last week's full total and the average of the 4 weeks before,
  a per-person Mon–Sun grid, and chips: **In overtime** (Toast logged OT or 40+ hrs) and
  **Near 40** (36+).
- **New tables** (schema.sql): `daily_toast_job_hours` (employee-day-**job** hours, regular and
  overtime kept apart) and `toast_jobs` (titles). `daily_toast_employee_hours` has no job, so it
  can't tell kitchen from floor. Written by `writeEmployeeHoursForDate` /
  `syncToastJobs` ([`server/utils/toast-employee-hours.ts`](server/utils/toast-employee-hours.ts))
  in the nightly sync; a missing table only warns, so it can't fail the covers sync.
  `scripts/backfill-toast-employee-hours.mjs` now fills both too.
- **"BOH" = Toast job title** (`BOH_JOB_PATTERN` in
  [`server/utils/boh-hours-report.ts`](server/utils/boh-hours-report.ts)): line/prep/pastry/sous/
  executive chef/chef de partie/garde manger/dishwasher/porter/culinary intern. Porters are shown
  in their own group (they're in the Labor tab's BOH hourly lines). Bar Prep, Project Manager and
  all FOH jobs are not counted; the report lists them with their hours under "Not counted as BOH"
  so a misclassification is visible. The Executive Chef shows only if they clock in.
- **Auto clock-outs are flagged (added same day)**: `daily_toast_job_hours` also keeps
  `auto_clocked_out_shifts`/`_hours` (Toast clocks out a forgotten shift automatically and those run
  long). The page and the HTML show an "Auto clock-outs" summary card (only when there are any), a
  "⚠ Auto clock-out" chip under the person, and a ⚠ on the day's cell. No BOH shift has been auto
  clocked out since Sep 28 in local data (the recent ones are the Service Bar login and one
  Cater-Waiter), so it was verified by temporarily flagging one local row, then reverting it.
  Unlike the Staff Hours page this flags every one in the week shown, not just the last 7 days.
- **Finding while verifying (local data)**: nearly every cook was over 40 hrs in each of the last
  five weeks (overtime 13–48 hrs/week, 27.8 for the week of Oct 26).
- **Production rollout (migrate first, then deploy)**: run
  `node scripts/add-toast-job-hours-tables.mjs` (also adds the auto clock-out columns to an older table) on the volume (`fly ssh console`) BEFORE
  `fly deploy`, or `/api/kitchen-labor/hours` 500s; then backfill history inside the container:
  `fly ssh console -C "node scripts/backfill-toast-employee-hours.mjs --since=2026-09-28"`.
  Local dev is migrated and backfilled from 2026-09-28.
- Verified in the browser (desktop, phone width, dark mode for the downloaded file, week
  navigation, download link) and the totals against a live Toast pull (251.4 hrs, Nov 2–5).
  The console's 401/hydration warnings also appear on untouched pages (credentials-in-URL
  loading and the shared header). Not deployed.

## Labor-tab hours recalibrated from Toast hours/earnings — 2026-10-28

Toast's "Hours & Earnings by Range" CSV (Sep 1–Oct 26) was compared with production's Labor settings.
It reconciles to QBO within ~2% (BOH regular $9.85K vs $10.0K posted per week; BOH OT $1.27K vs
$1.14K), and **QBO posts labor by Toast job**, so a person's hours land on whichever account their
Toast job maps to. Hourly rates already matched everywhere; only hours changed. Applied to
production `labor_position_slots` / `labor_position_settings` directly (one transaction, after a
backup; `budget_targets` untouched, so the budget only moves on the next Labor-tab Save):
Lauren and Anna Grace 38→40; Jesse 39→38; the anonymous Prep Cook slot 37→0 (Luis moved to Sous
Chef the week of Oct 13); Rebeca 40→38; Porters 23/32/28; Concierge 27/25; Servers
34/28/16/19/15/8/13; Bartenders 30/10/9/27/5; Server Trainee 2→4; **BOH OT 10→32 hrs/wk** (actual
~30 hrs ≈ $1,270/wk; the tab's blended rate is lower than the $42/OT-hr actually paid, hence 32).
Net effect on weekly dollars is roughly zero (prep-cook vacancy offsets the OT increase).
- **Name mapping is assumed**, since Toast exports legal names: Jay = Jason Guo, Mario = Vicente
  Coronado, Coco = Luis Maggiolo, Skye = Savannah Walker, Magdalene = Landon Nethercott.
- Gabriel Peterson (Sous Chef, last shift Oct 11), Ningyin Zhao, Peter Nelson Jr and Jillian
  Osborne have left or dropped off and aren't in the Labor tab. Bar Prep (~4 hrs/wk at $18) and
  Cater-Waiter shifts are not modeled.
- Cleanup: `/app/data/backup-pre-labor-hours-2026-10-28T16-40-53-368Z.sqlite` holds QBO tokens;
  delete it once the numbers are trusted.

## Gift card cash timing — 2026-10-28

The Mass Ave sale won't close in 2026 (the $88K gain was removed from the Nov budget), which makes
cash for the loans tight. Gift card sales (about $27K last year) are cash in the bank but a
balance-sheet liability, so they never reach the P&L or Net Income.

- **`gift_card_plan`** (schema.sql): single-row editable "gift card cash still expected before Dec 31",
  saved via `POST /api/cashflow/gift-card-plan`, entered on the Cash Flow tab under the Year-End
  Projection. It is added to projected year-end Free Cash Flow only (shown as a second figure, "including
  $X of gift card cash"); Net Income, the "Profit needed" card and the DSCR covenant are unchanged,
  since EBITDA never sees gift card cash.
- **Cards updated too (same day):** the "Profit needed to cover the loans" card and the "Profit projected"
  pace chip use `breakevenNetIncomeAfterGiftCards` (server `breakevenNetIncome` minus gift card cash,
  computed client-side), so the cards agree with the Free Cash Flow line. The server value stays
  gift-card-free so the "including gift card cash" line doesn't double count. "Cash still needed" and the
  YTD Free Cash Flow section are deliberately unchanged (YTD could get a "gift card cash sold to date" row).
- It is a timing benefit: redemptions (mostly 2027) bring revenue with no new cash, so it should not be
  counted on for the 2027 reserve plan. The page says so.
- Starts at $0 (nothing assumed until entered). Only the portion still to be sold before Dec 31 belongs
  here; cards already sold are already in the cash balance. No QBO liability balance is shown yet.
- **Production rollout:** run `node scripts/add-gift-card-plan.mjs` on the volume (`fly ssh console`)
  BEFORE `fly deploy`, or `/api/cashflow` 500s on the missing table. Local dev already migrated.
- **New-year cushion (2026-10-30):** `gift_card_plan.cushion_pct` (0-100, default 25) is the share of
  the expected cash held back for next year, since redemptions bring revenue with no cash. Only
  `expected * (1 - pct/100)` counts toward this year (`yearProjection.giftCardCash`, which every
  card already used); the API also returns `giftCardExpected`, `giftCardCushionPct`,
  `giftCardCushion`. Entered beside the amount on the Cash Flow tab. **Run
  `node scripts/add-gift-card-cushion.mjs` on production BEFORE `fly deploy`**, or `/api/cashflow`
  500s on the missing column. Typecheck shows no new errors; not clicked through in a browser.
- Verified: migration, typecheck (no new errors beyond the pre-existing ones). Not clicked through in a
  browser (local dev is behind Basic Auth).

## Per-area per-cover revenue can follow actuals — 2026-10-29

**Superseded 2026-11-11** by "Automatic capacity forecast with pins" below: the checkbox and the
"Set from Actuals" button are gone, and every area follows actuals unless pinned.

Replaces the habit of clicking "Set from Actuals" on the Edit Capacity tab by hand. Fully
automatic updating was rejected: Food/Beverage per cover are *assumptions* the Actual columns
are judged against (and "Recompute Revenue from Capacity" feeds them into the revenue budget),
so a target that chases actuals nightly would zero out the variance and make Budget Pace
circular. Instead:

- **`capacity_areas.follow_actuals`** (0/1, default 0) is a per-area opt-in, set with an
  "Auto-update monthly" checkbox under each row's Set from Actuals button (saved with the
  normal Save). Areas left off stay fully manual; the button still works for any area.
- **Updates only at month close**: `applyMonthCloseActuals()` in
  [`server/utils/capacity-actuals.ts`](server/utils/capacity-actuals.ts), called from
  `runNightlySync()` after the Toast block, writes the real per-cover blend of the two most
  recently *closed* months into `per_cover_revenue_food/_beverage` on the first successful sync
  of a new month. `follow_actuals_through` ('YYYY-MM') makes it idempotent across nights and
  restarts; it's skipped if the sync didn't reach the closed month's last day, and for an area
  with under 30 covers in the window. Turning the box on takes effect at the next sync (it
  applies the latest closed month then); turning it off clears the marker.
- `blendForRange()` in the same util is now also what `area-actuals.get.ts` uses for the
  button, so the manual and automatic paths share one definition (Chef's Counter's real $190
  food split, restaurant-wide Food/Beverage mix for the rest).
- **Production rollout**: run `node scripts/add-capacity-follow-actuals.mjs` on the volume
  (`fly ssh console`) BEFORE `fly deploy`, or `/api/capacity/settings` 500s on the missing
  columns. Local dev already migrated.
- Verified: util against a copy of local data (apply, idempotent re-run, incomplete-data
  no-op, Dining/Chef's blends matching hand SQL), settings POST round-trip, page renders the
  control. Not clicked through in the browser (local dev is behind Basic Auth); the
  month-close path can't run locally (sync refuses outside production) and first fires on the
  first production sync of November.

## Miller loan deferral (Option A agreed 2026-11-09; applied in production 2026-11-01) - 2026-11-01

The user is proposing to the lender (their parents) that Miller's payments pause Nov 15 2026 - Jun 15 2027,
with 3.82% interest accruing and capitalizing, then a level payment Jul 15 2027 - Jan 15 2032.
`scripts/defer-miller-loan.mjs` (dry run by default; `--apply`, `--revert`) rewrites Miller's `loan_schedule`
rows from Nov 2026: 55 payments of $2,913.91, balance at resume $146,805.62 (schedule principal $143,159.82
+ $3,645.80 accrued). Total interest from Nov 2026 rises about $3,497. The original rows are kept in
`loan_schedule_miller_backup` until `--revert`. Cash Flow, the reserve simulation and the Dashboard's
suggested weekly goal all read `loan_schedule`, so they follow automatically: 2027 reserve draws fall
$15,520 ($199,579 to $184,059 excluding SBA), and the weekly goal drops about $800 per deferred month.
- **Budget:** 7020 interest is essentially unchanged (accrual about $455.73/mo vs. $448.42 in Dec): the only
  edit is Dec 2026 +$7.31. Not written; 2027 has no 7020 budget yet. QBO needs a monthly accrual JE for the
  deferred interest, or the P&L understates it.
- **Status (2026-11-09):** the user's parents agreed to this option (pause Nov 15 2026 – Jun 15 2027, resume Jul 15
  2027, level payments to Jan 15 2032). It was applied to production's `loan_schedule` on 2026-11-01, before the
  agreement, so no further run is needed (the script refuses to run twice; the replaced rows are in
  `loan_schedule_miller_backup`). **Balance confirmed 2026-11-09:** QuickBooks's liability register
  (2727 Notes Payable, Steve and Mary) shows $143,159.84, matching the schedule's $143,159.82, so no revert is needed. The
  lender's $142,682 figure (quoted payment $2,909/month) was about $477 low; the correct level payment for the real balance
  is $2,913.91 (about $5/month more). Paying $2,909 instead would leave roughly $295 owing at the end.
  **Amendment drafted 2026-11-09** (`reports/miller-note-amendment/First Amendment to Promissory Note - Miller.docx`, not
  committed, for the user and the lenders to sign): defers Nov 15 2026 – Jun 15 2027, accrues $3,645.80 (8 × $455.73, monthly
  one-twelfth rate, no compounding during the deferral) and adds it to principal on Jun 15 2027 ($146,805.64), then 55
  payments of $2,913.91 from Jul 15 2027 with the last, Jan 15 2032, at $2,913.86. The original Note's maturity (Jun 4 2031)
  is extended to Jan 15 2032; the rate stays 3.82%. The Note requires a written amendment signed by both sides. The monthly interest accrual entry in QuickBooks is still needed.

## 2027 budget: year toggle + "Build 2027 budget" — 2026-11-02

The Budget, Revenue and Labor tabs now have a 2026 / 2027 toggle ([`app/components/BudgetYearToggle.vue`](app/components/BudgetYearToggle.vue)),
so next year can be planned in the same screens. Budget Pace and every other page stay on 2026.

- **Selection is shared state, pages remount on change.** `useBudgetYearSelection()`
  ([`useBudgetData.ts`](app/composables/useBudgetData.ts)) holds the year in `useState` + a `budget-year` cookie;
  [`app/app.vue`](app/app.vue) keys `<NuxtPage>` on it for `/budget/*` (except `/budget`), so each page's setup re-runs with
  the new year and can treat `YEAR` as a local constant. Unsaved edits prompt before switching. `YEAR` the export is
  still the current operating year (2026) and the default for the helpers, which gained optional `year` params
  (`useBudgetYear`, `useActualsYear`, `currentAsOfMonth/Day`, `hybridYearExpectedToDate`, `currentYearDayFraction`).
  For a year that hasn't started, `currentAsOfMonth` is 1 and `currentAsOfDay` is 0: nothing closed, no live pace
  card, all 12 months editable, and the Labor tab models/saves all 12 months.
- **"Build 2027 budget"** ([`BuildNextYearBudget.vue`](app/components/BuildNextYearBudget.vue), top of Edit Budget when the
  selected year hasn't started) previews, then writes, three things to `budget_targets` for every month: (1) **fixed
  opex** = December 2026's budget for every `cost_behavior='fixed'` leaf account; (2) **revenue** = the Capacity tab's
  Food/Beverage projection for each 2027 month, split across the revenue accounts the same way the Revenue tab's
  "Recompute from Capacity" does (`/api/capacity?year=` now accepts a year for its `months` array: operating days
  and holiday closures follow that year's calendar); (3) **labor** = the Labor tab's saved rates/hours/salaries.
  COGS, variable opex, event/catering/retail and buyouts are deliberately not touched, so 2027 net income reads far too
  high until they're budgeted. It runs client-side against whichever DB the app is on (local dev's budget differs from
  production's), and shows how many existing entries it would replace.
- **The starter collapses once the year has a budget (2026-11-05)**: once any month of the planning year has a saved
  budget entry (decided when the page first loads, so applying it to an empty year doesn't collapse the panel),
  Edit Budget shows it only as a "Rebuild 2027 from scratch…" disclosure with a warning. Rebuilding replaces
  Food/Beverage revenue (undoing buyout amounts applied from the Revenue tab's planner, which `revenue_buyout_applied`
  would still think are applied), fixed expenses carried from December (including seasonal gas/electricity), and
  labor. To change labor alone, save it on the Labor tab, which writes all twelve months of a planning year. The
  full starter shows only for an empty year (e.g. 2028, once the year toggle covers it).
- **7020 Loan Interest is the exception to "carry December forward"**: December includes the one-time Dec 20 catch-up
  interest, so by default it is budgeted from `loan_schedule`'s regular monthly interest for 2027
  ([`server/api/budget/loan-interest.get.ts`](server/api/budget/loan-interest.get.ts)); a checkbox restores the plain
  December carry-over.
  Months where the Miller deferral leaves no payment row (Jan–Jun 2027) also get the monthly accrued interest ($455.73,
  read from `loan_schedule_miller_backup`'s first row), matching the QBO accrual entry (added 2026-11-02; the Miller
  deferral is applied in production).
- **Labor math moved to [`app/utils/laborModel.ts`](app/utils/laborModel.ts)** (`createLaborModel`), shared by the Labor tab
  and the Build action, so both price a month identically. Payroll posts every Friday, so a month's cost is weekly $
  x that month's Fridays; **2027 has 53 Fridays: five paychecks in Jan, Apr, Jul, Oct and Dec**. The Labor tab shows
  a payroll calendar with each month's modeled total.
- **Caveats**: payroll-tax rates come from the Labor tab as saved (SUTA is currently the reduced 2026 rate; rates and wage
  bases reset each January, see the SUTA note in the Oct 24 section); fixed utilities (gas, electricity) are flat at
  December's winter level all year; the Labor tab's hand-set 2026 hires/raises carry over as-is.
- Verified in local dev (backed up, restored after): Jan–Dec revenue/fixed totals hand-reconciled to the Capacity API
  and loan schedule; labor 5- vs 4-Friday months matched a hand calculation with synthetic rates (local dev has no saved
  rates, so real labor totals can only be judged in production); 2026 Labor tab output unchanged. Not clicked through
  on production.

## 2027 budget, second pass: COGS, variable opex, utilities, leases — 2026-11-02

[`scripts/seed-2027-budget-extras.mjs`](scripts/seed-2027-budget-extras.mjs) fills what "Build 2027 budget" leaves blank. Run it
AFTER the Build is applied (it needs the 2027 revenue budget); dry run by default, `--apply` writes, `--revert` undoes
(previous values are kept in `budget_targets_backup_2027_extras`, no QBO tokens). Matches accounts by `account_number`.

- **From the user**: 1281 Cambridge St rent (6510) $11,500/mo and Mass Ave rent (7920) $2,950/mo, constant all of 2027; Mass Ave
  sublet income (8030, other income) $5,000/mo assumed all year. **Not budgeted on purpose**: gain on asset sale (8010, timing
  unknown), depreciation (7910, TBD), catering/retail COGS (their revenue isn't budgeted).
- **Electricity (6521)**: a hand-built seasonal profile from the Eversource bill export (Jul $4,643; Aug+Sep two bills $12,503;
  Oct $2,886; pre-opening months ignored; no winter data exists for the open restaurant) plus $450/mo for Mass Ave — the
  constants and reasoning are at the top of the script.
- **Gas (6522)**: seasonal too (added same day) — about $700 summer base from the Jul–Oct bills ($639–$785), $900 Apr, $950 Nov,
  $1,300 Dec, $1,400 Jan/Feb (heating + winter demand pricing; winter is an assumption until this winter's bills exist),
  plus $25 Mass Ave.
- **COGS**: Food = trailing Food COGS % x each month's Food revenue (months with >5% catering/event revenue skipped when a
  cleaner month exists); each beverage COGS account = its own trailing % of its paired revenue account (5110/4022, 5120/4024,
  5125/4026, 5130/4028); 5020 and 5115 = trailing average. **Processing fees** (6210, 6220) = trailing % of total revenue.
  **Every other variable opex account** = trailing monthly average, flat. "Trailing" = newest 3 fully-synced closed months since
  2026-08-01. Reservation Platform Fees (6305) carry the OpenTable $5,000/mo credit, which the user says ends after July 2027: budgeted at the
  trailing net (about -$4,432/mo) Jan-Jul, then gross fees (about $568/mo) from Aug; 6644's one-off amplifier refund is skipped. Any other
  net-credit account is listed, not budgeted;
  lumpy accounts (one month >=70% of the window) are flagged; `--exclude=` skips accounts, `--food-pct=` overrides Food.
- Why a script and not the Edit Budget COGS recompute: that button averages the *selected year's* closed months, so in 2027 it
  finds no window.
- Verified on a scratch copy of local dev (synthetic 2027 revenue; local has no Aug-Oct actuals): dry run, apply, double-apply
  refusal, revert. Not yet run against production.

## Per-area weekly closures: Chef's Counter dark on Tuesdays - 2026-11-02

Trial decided by the user: close Chef's Counter on Tuesdays from **2026-12-01** (fully closed, no a la carte),
assuming an optimistic **85% recapture** of those covers on its other nights (mostly Wed/Thu, some Fri/Sat). The
model had no per-area weekday dimension: `expected_covers` is one per-area, per-month average applied to every
Tue-Sun night (`dayByDaySum`, `revenue-modeling.get.ts`'s `operatingNightsPerYear`, the weekday revenue pattern
in `weekly-targets.ts`). This is step 1 of 3 (Capacity); the rest is below.

- **`capacity_areas.closed_dows` / `closed_from` / `closure_recapture_pct`** (schema.sql). A comma list of weekday
  numbers (Monday ignored), a start date, and a 0-100 recapture %. Dated, so periods before the start are still
  judged on the old schedule, and the trial reverts by clearing the weekdays. Nothing is configured by default.
- **The covers grid still holds the PRE-closure per-Tue-Sun-night baseline.** From `closed_from`, the server
  (`closureOn` / `areaExpectedOn` in `server/api/capacity.get.ts`) zeroes the area's capacity and covers on closed
  weekdays and multiplies its other nights by `(6 - closed*(1-r)) / (6 - closed)`, capped at nightly capacity.
  Baseline stays the stored meaning because the stored values are reused every year, so a closure that starts
  mid-year (Dec 2026 on) cannot be encoded by rewriting them. Chef's Counter, Dec, 85%: x1.17, so a 7 baseline
  becomes 8.19 on Wed-Sun; 0% recapture leaves 7.
- **Everything month-level inherits it**: `months[].assumed` (and so the Revenue tab's "Recompute from Capacity"
  and "Build 2027 budget", which read `/api/capacity`), the fill-% seat denominator, and the area cards'
  `assumedCoversPerNight`, now per night the area is open (the unit of its actual). Holiday-closure nights are
  worth the month's average night (`avgNightlyForMonth`), since nights now differ by weekday.
- **Edit Capacity**: new "Weekly Area Closures" table (weekday chips, start date, recapture %). The covers grid's
  Projected Revenue applies closures night by night; its Total / Fill % / Per-Cover $ stay baseline.
  "Set by Actuals" converts an open-night observation back to the baseline (divides by the uplift) when the
  closure covers the whole target month and the window has no closed-weekday nights. `CHEFS_COUNTER_2027_GOAL`
  values are baselines too.
- **Verified**: against a DB copy through the real handler (Nov unchanged; Dec Chef 8.19/night; hand-checked
  month totals with and without recapture; 85% costs about $2.1K of Dec revenue vs. about $8.4K at 0%), and
  the settings POST validation. The browser was not used (local dev needs Basic Auth). Local dev has the trial set.
- **Production**: run `node scripts/add-capacity-closed-dows.mjs` on the volume BEFORE `fly deploy` (else
  `/api/capacity` 500s), then enter the closure on the Capacity tab.
- **Weekday revenue targets (step 2, same day)**: `computeWeeklyRevenueTargets()` now returns `sets` and
  `forDate(iso)`: the plain pattern (baseline) plus one set per closure start date. A set is MODELED from
  pre-closure history: each closed weekday loses that area's average Toast revenue/covers on it, and
  `closure_recapture_pct` of its covers lands on the open weekdays by `closure_recapture_weights` (JSON, relative;
  Chef's: Wed 35 / Thu 35 / Fri 15 / Sat 15, entered on the Weekly Area Closures table), capped at each night's
  remaining seats (capacity minus its average covers), valued at that night's own per-cover. Once 24 real open
  nights (3+ per weekday) exist since the start date, the set switches to the real post-closure pattern with no
  adjustment, so the model never double counts. The weekly goal (`weekly_revenue_benchmark`) is unchanged; shares
  are renormalized, so the closure only reshapes the days (e.g. Dec Tue $7,784 -> $6,197 on a $50K week, local data).
  Consumers use the set in force on each date: Dashboard This Week's Targets (plus a `closureNote` line),
  Revenue Calendar (`pl.get.ts`), the buyout "normal night displaced" (`buyoutWeekdaysFor(rates, onDate)`, by
  month start on the Revenue tab; latest pattern for Revenue Modeling), and the Edit Budget weekday projection
  weights (pattern at month start). Area revenue is Toast check subtotals while targets are QBO core revenue, so
  the closure's dollar effect is approximate. If the closure columns aren't migrated, targets fall back to the
  plain pattern instead of failing the Dashboard.
- **Migration changed**: `add-capacity-closed-dows.mjs` now also adds `closure_recapture_weights`. Re-run it on
  production BEFORE deploying; the settings POST writes that column, so an old schema fails every Capacity save.
- **Leave prompt hardening**: the "unsaved capacity edits" prompt now fires only for real draft edits (not the
  capacity auto-correction), names what differs, and the page re-baselines its drafts explicitly after a save.
  Prompted by a report of the prompt after a successful save that could not be reproduced locally (round trip
  and UI flow both clean), so the exact cause is unconfirmed.
- **Revenue Modeling scenario (step 3)**: built (a "Close an Area One Night a Week" what-if) but judged overkill
  and never merged; the branch (`close-area-scenario`, commit bcd6032) was deleted 2026-11-08, since the
  real Tuesday closure made it moot. Revenue Modeling still multiplies every area by one `operatingNightsPerYear`.
  The Labor tab's Tuesday Chef's hours must be cut by hand (variable labor scales with covers, not schedules).

## OpenTable reservation importer — 2026-11-04

First step toward forecasting covers from reservations (booking curve: how much of a night is
booked N days out vs. its final covers, plus walk-in and no-show rates). This pass is
ingestion only; no forecast is built yet, deliberately, until a full export with Created/Canceled
dates shows what the data supports. OpenTable's API is partner-only, so this is CSV upload.

- **`reservations` / `reservation_imports`** (schema.sql): one row per reservation or walk-in, with
  visit/created/canceled/no-show/seated timestamps, size, status, tables, area, source, experience
  title and prepayment status. **No guest names, phones, emails, notes, tags or "Private Dining
  Title"** (that column is just "<first name>'s Event"): the importer only reads a whitelist of
  columns (`COLUMN_MAP` in `server/utils/opentable-import.mjs`). Never commit a raw export.
- **Replace-by-range, not upsert**: the export has no reservation id, so an upload deletes every
  stored row whose `visit_date` falls inside the file's date range and inserts the file's rows
  (one transaction). A newer export of the same dates safely supersedes an older one. History of
  past booking states isn't stored; it's reconstructable (booked on day D if `created_at` <= D and
  not canceled by D).
- Accepts both formats seen so far (the emailed CSV with a separate Visit Time column, and the
  on-screen "Jun 20, 2026 9:54 pm" style). Times are restaurant-local; `status` is OpenTable's raw
  text (e.g. "Assumed Finished", "Not Confirmed"). The upload warns if Created/Canceled/No-show
  columns are missing, because the booking curve can't be built without them.
- **Upload page**: `/reservations` (`app/pages/reservations.vue`, nav "Reservations"), routes
  `POST /api/reservations/import` (raw CSV body) and `GET /api/reservations` (what's loaded).
- **Production rollout**: run `node scripts/add-reservations-tables.mjs` on the volume BEFORE
  `fly deploy`, or both routes 500 on the missing tables. Local dev is migrated.
- **Columns to request in GuestCenter** (narrowed 2026-11-11 to what `server/utils/booking-pace.ts`
  actually reads): Visit Date, Size, Status, Source, Created Date (plus Created Time if offered
  separately), Canceled Date; include every status. Everything else the importer can still read
  (Visit Time, No-show Date, Seated Date, Table, Dining Areas, Online Waitlist, Experience Title,
  Prepayment Status) is stored if present but nothing uses it, so it's optional. An upload without
  them nulls those fields for the dates it replaces. The upload page shows the minimum list in a
  collapsed note and a suggested visit-date range (8 weeks back to 8 weeks ahead of today: the
  booking pace compares against the last 6 same-weekday nights and fits on the last 60).
- Verified: parser and replace-on-reimport against the 2026-11-04 export on a scratch DB copy (305
  rows, re-import replaced 305, no PII in stored rows) and typecheck of the new files. Not clicked
  through in a browser (local dev is behind Basic Auth).

## Booking pace: next 7 nights — 2026-11-05

Built from the full OpenTable export (5,176 reservations, Jun 20–Dec 17, with cancellations; uploaded to
production 2026-11-05). **Backtest first** (scratch scripts, 66 nights Aug 11–Oct 29, each forecast using
only data known at the time, scored against Toast covers): the book improves on a trailing 6-same-weekday
Toast average only close in — mean abs error 14.4% → 11.6% same day, 13.1% one day out, 13.5% three days
out — and adds nothing at 7+ days (scaling the book up by the booking curve was far worse: 47% error at 14
days, 137% at 28). Correlation of "booked vs. usual" with "covers vs. usual" is 0.66 same day, 0.44 at 3
days, 0.12 at 14. So no 3–4 week forecast from bookings yet; Capacity/weekday goals stay the long-range
source. Re-run in January, after holiday-party bookings, with more data.

- **Other findings**: median share of the final book in hand — 15% at 28 days, 31% at 21, 53% at 14, 76% at
  7, 94% at 1 (Saturday books earliest, Sunday latest). ~23% of booked covers cancel; no-shows ~0.3%.
  OpenTable booked + walk-in covers ≈ 95% of Toast covers every month. Walk-ins fell from 738 covers (Jul)
  to 473 (Oct) while booked held steady (patio closing, presumably), so Toast/booked fell from ~1.6 to ~1.4.
- **[`server/api/booking-pace.get.ts`](server/api/booking-pace.get.ts)** (own route, so a missing
  reservations table can't break the Dashboard): for the next 7 operating nights from local today, covers
  on the book (walk-ins excluded) as of the **latest upload's time**, vs. the mean booked at the same days
  out for the last 6 same-weekday open nights (reconstructed from `created_at`/`canceled_at`, at the
  upload's time of day). Within 3 days out it adds an estimate: the weekday's Toast-covers average +
  k × (booked − usual booked), k fitted per days-out on the last 60 nights (least squares through the
  origin, clamped 0–3). A `Cancelled` row with no cancel time counts as never booked.
- **Dashboard panel** "Next 7 Nights" ([`app/pages/index.vue`](app/pages/index.vue), under This Week's
  Targets): booked vs. usual, a pace chip (≥110% ahead, 90–110% on pace, 75–90% behind, <75% well behind;
  0 booked when usually ≥10 reads "No bookings — closed?"), and the estimate or the weekday average. Warns
  when the upload is 2+ days old. **The book only refreshes when a new export is uploaded** — weekly at
  least, ideally before staffing/ordering decisions.
- **Known limits**: "usual" comes from the last 6 same-weekday nights, so it lags real changes (e.g. the
  Chef's Counter Tuesday closure from Dec 1 will read as behind pace on Tuesdays for a few weeks); holiday
  closures show as "No bookings"; buyouts/large parties swing the book.
- No schema change. Verified locally against the real export loaded into local dev (route output and SSR
  HTML checked; Nov 12 shows "No bookings — closed?"). Not visually checked in a browser (Basic Auth).

## Night-by-night revenue projection + Special Nights — 2026-11-05

Follow-on to the booking-pace work above. **Backtest first** (scratch scripts; Aug–Oct, projecting the
month-end from days 7, 14 and 21, 9 projections; Toast nightly dinner sales as the revenue measure,
since local QBO revenue stops Jul 28): mean month-end error was 8.1% for the old method (actual ÷ share
of operating days elapsed), 7.1% weekday-weighted, 7.2% night by night, 6.8% night by night + bookings.
With the off-nights known ahead (Sat Sep 26 off-site catering, Wed Sep 30 buyout, Sun Oct 11 closed) it
drops to 4.9% / 3.9% / 4.0% / 3.7%. So **dated special nights are the big win**, weekday shape is worth
~1pt, and bookings under half a point on a month total. September also ran ~10% under its weekday
averages on ordinary nights, which no method foresees.

- **`special_nights`** (schema.sql): date PK, kind (`buyout` / `closed` / `offsite` / `event`),
  `expected_revenue` = **core dine-in** revenue expected that night (a buyout rings into core; $0 for a
  closure or off-site night; a ticketed event's tickets post to Event Sales, projected separately), note.
  Routes: `GET /api/special-nights?from&to`, `POST /api/special-nights` (upsert by date),
  `DELETE /api/special-nights?date=`. Readers (`server/utils/special-nights.ts`) treat a missing table
  as "none", so only saving fails before the migration.
- **Buyouts are entered once, with a date (merged 2026-11-05).** A dated `buyout` special night feeds the
  projection (its full night revenue) AND the budget: the Revenue tab's Buyout Revenue panel counts it as
  (expected revenue − that weekday's normal night) in its Planned/Apply figure, alongside the planner's
  per-weekday counts (`revenue_buyout_plan`), which are now only for buyouts expected but **not yet dated**
  (labelled that way in the panel). A mismatch note used to compare the two; that's gone. Adding a dated
  buyout on a weekday that still has an undated count shows a checkbox (default on) to retire that count:
  `POST /api/special-nights` with `replacesUndated` reduces it by the new buyout's worth in "standard buyout"
  units, (price − normal) / (rate − normal), clamped at 0 (so a same-priced buyout takes it to exactly 0), in
  the same transaction. Removing a dated buyout does not restore a count. **The budget only changes when
  Apply is clicked**; the panel's Apply button lights up when dated buyouts change.
- **[`server/api/revenue-projection.get.ts`](server/api/revenue-projection.get.ts)**: core revenue synced
  so far this month + each remaining Tue–Sun night = its special-night amount, else the weekday's mean core
  revenue over its last 6 ordinary open nights (Toast covers ≥ 15, positive core revenue, special nights
  and `excludeSpendOutliers` nights left out) + the booking-pace covers adjustment × that weekday's
  revenue per cover for nights the booking estimate covers (≤3 days from the upload). Returns
  `missingHistory` (nights with <3 same-weekday history); the client falls back to the old method then.
- **Booking-pace math moved to [`server/utils/booking-pace.ts`](server/utils/booking-pace.ts)**
  (`computeBookingPace`), shared by the Dashboard route and the projection. The Dashboard route now adds
  each night's special night; the panel shows "★ Buyout · $X" / "★ Event night" / "◦ Closed" / "◦ Off-site
  event" instead of a pace chip.
- **Revenue tab** ([`app/pages/budget/revenue.vue`](app/pages/budget/revenue.vue)): a Special Nights panel
  for the selected month (add/replace/remove; buyouts prefill the planner's guaranteed minimum for that
  weekday, closures/off-site prefill $0), and for the current month a collapsible night-by-night
  breakdown. The current month's **Projected** for core leaf accounts (and the Year Total's current-month
  piece) = actual + the remaining-nights total spread across core leaves by month-to-date share (budget
  share before any sync). The **Budget column is untouched**. Projection and special nights load on the
  client, so the server-rendered page shows the fallback note until they arrive.
- **Edit Budget uses the same projection (2026-11-05)**: its Revenue lines for the current month were still
  straight-lined (and projected Event/Retail at $0 until they posted), so the two pages disagreed on
  "Projected" (e.g. $179,895 vs. $215,878) — easy to misread as the Budget figure. The rules now live in
  [`app/utils/revenueProjection.ts`](app/utils/revenueProjection.ts) (`projectRevenueLeaf`, `coreRevenueShares`,
  `budgetFloor`), used by both pages: core dine-in = actual + its share of the night-by-night remaining
  total; Event/Catering/Retail/contra = own budget floored at actual (sign-aware). Edit Budget fetches
  `/api/revenue-projection` once on load, so reload it after changing special nights on the Revenue tab; its
  Total tab's current-month piece follows the same rules. Budget Pace's month projection is still the old one.
- **Production rollout**: run `node scripts/add-special-nights.mjs` on the volume BEFORE `fly deploy`
  (otherwise saving a special night returns an explicit "run add-special-nights.mjs" error). Then enter
  Nov 12 (full buyout) on the Revenue tab. Budget Pace's month projection still uses the old method.
- Verified locally: routes (incl. 400 on a bad kind), a test Nov 12 buyout flowing into the projection
  (+$1,139 vs. a normal Thursday) and the Dashboard panel, then removed; typecheck shows no new errors.
  Local dev's history is stale (QBO through Jul 28), so its numbers are only plumbing checks; the
  Revenue tab was not clicked through in a browser (Basic Auth).

## Year-end outlook on the Cash Flow tab — 2026-11-05

Raised by the user after the OpenTable work: the goal was a more accurate year-end picture (can the year
get close to break-even, and cover the December interest and loan payments?), and the Budget page's Total
Net Income doesn't move with better projections by design (budget for the current/future months, real
actuals for closed ones). Honest sizing: better dine-in projection is worth roughly ±$10K of profit over
Nov–Dec; the year is decided more by one-time items (other income, the Mass Ave sale), costs, and December's
holiday/buyout business.

- **Where**: [`app/pages/cashflow.vue`](app/pages/cashflow.vue), inside Year-End Projection. Layout (reorganized
  2026-11-05 after the Budget outlook card duplicated the old "Profit projected this year" card): top row =
  "Cash still needed for the loans" and "Profit needed to cover the loans"; below it the three outlook cards
  (Budget, Recent pace, Night-by-night), where the **Budget card is the projected profit at budget** with the same
  above/short-of-needed status; then the "At budget, projected year-end Free Cash Flow" line and the gift card
  form. When the outlook can't be built (no closed month since August has actuals), a single "Profit projected this
  year" card is shown instead, so the page never loses the figure. The Budget page's Total tab is unchanged.
- **Three scenarios** ([`app/utils/yearOutlook.ts`](app/utils/yearOutlook.ts), pure functions, tested against
  a hand calculation): (1) budget for the rest of the year, the existing projection; (2) **revenue at recent
  pace**: for the current month through December, revenue = monthly budget × how revenue ran against budget
  over the last up-to-3 closed months from August on (opening months excluded, like the COGS recompute), and
  COGS moves with that same ratio (it's budgeted as a % of food sales); (3) pace with the current month's
  revenue replaced by the Revenue tab's night-by-night projection (special nights, bookings), with that
  month's COGS scaled by the same revenue difference. **Labor and operating expenses stay at budget in every
  scenario, and so does other income/expense.** Each card shows year-end revenue, Net Income, and the gap to
  the profit needed to cover the loans; the ratios are printed under the cards.
- **Why costs are NOT run-rated (changed same day, 2026-11-05)**: the first version applied each category's
  Aug–Oct actual/budget ratio (revenue 96%, COGS 105%, labor 111%, opex 112%) to Nov/Dec, which made "pace"
  $53K worse than budget, only ~$15K of it revenue. But Nov/Dec's cost budgets were already recalibrated from
  Aug–Oct actuals (Oct 24: labor to the payroll run-rate, Food COGS ~27%, missing opex lines), and part of the
  Aug–Oct overrun was one-offs (catering profit share, an owner salary change, bonuses), so applying those
  ratios double counted. The cost ratios are still shown on the page, labelled as not applied. Revisit if
  Nov/Dec cost budgets are ever left stale relative to actuals.
- **Seasonality**: not added by the pace ratio. December's budget already carries the Capacity tab's seasonal
  covers, so "96% of budget" is relative to a seasonal budget. Prior-year Toast covers per open night show no
  consistent December jump at Mass Ave (Dec 2025 ~41 vs. Oct ~36; Dec 2024 ~31 vs. Oct ~39), so holiday
  upside is more likely spend per cover, parties/buyouts and gift cards than extra covers; the Historical
  tab's Revenue Seasonality chart shows the 2025 revenue pattern.
- **Current-month revenue** for scenario 3 comes from `projectMonthRevenue()` in
  [`app/utils/revenueProjection.ts`](app/utils/revenueProjection.ts) (the same rules as the Revenue tab and
  Edit Budget); the row is omitted when the night-by-night projection isn't usable. The whole section is
  hidden when no closed month since August has actuals.
- **Caveats**: three months is a thin sample; the revenue ratio is against budgets as currently saved (a
  closed month's budget edited after the fact changes it); labor and opex are not modeled; no December-specific effects (holiday parties, buyouts) beyond the budget unless entered as
  special nights, which only affect the current month.
- No server change, no schema change, no migration. Verified: the scenario math against a hand calculation
  (including the no-usable-months case), and real local API data through the same functions (an independent
  recomputation of the pace row matched exactly), using temporary synthetic Aug–Oct actuals that were then
  removed. Local dev has no real Aug–Oct actuals, so the section is hidden there; it was not clicked through
  in a browser. Check it on production after deploying.

## Navigation and page names, phase 1 of the UI cleanup — 2026-11-08

Preparing the app to share with the GM, the Sous Chef and the owner (and maybe other restaurants later).
The flat 14-tab row was replaced by **5 sections with sub-tabs**, defined in one place,
[`app/utils/navigation.ts`](app/utils/navigation.ts) and rendered by
[`app/layouts/default.vue`](app/layouts/default.vue): Home (This Week), Sales (Daily Results, Covers & Spend,
Seasonal Trends), Team (Kitchen Hours, Benefits Eligibility), Money (Profit & Loss, Budget Check, Cash & Loans),
Planning (Budget, Sales Plan, Staffing Plan, Capacity, What-If). On phones (≤860px) the sections move to a fixed
bottom bar. A gear opens the new [`app/pages/settings.vue`](app/pages/settings.vue) (QuickBooks connection status,
Toast note, reservation upload, and a directory of settings still on other pages); `/reservations` is no longer a tab.

- **Routes are unchanged**; only labels, page headings and browser titles changed (old → new: Weekly Performance →
  This Week, P&L → Profit & Loss, Revenue/Margin Calendar → Daily Results (its toggle reads Sales/Profit), Budget
  Pace → Budget Check, Edit Budget → Budget, Revenue → Sales Plan, Labor → Staffing Plan, Kitchen Labor → Kitchen
  Hours & Cost, Staff Hours → Benefits Eligibility, Cash Flow → Cash & Loans, Historical → Seasonal Trends, Revenue
  Modeling → What-If). Older sections of this file still use the old names.
- **`/capacity` serves two nav entries**: Covers & Spend (no `?tab`) and Planning › Capacity (`?tab=edit`). Its own
  Pace/Edit buttons were removed; the page watches `route.query.tab` since the nav changes it without remounting.
- **Next phases** (agreed, not built): (2) roles — per-person access from the Cloudflare Access email, enforced on API
  routes too, plus a People & Access section in Settings; (3) consolidation and plain-language wording inside pages
  (COGS, Opex, DSCR…), moving scattered settings (weekly goal, alert thresholds, benchmarks, salaried/grandfathered
  staff lists, owner-pay accounts) into Settings, and splitting Kitchen Hours (Sous Chef) from Kitchen Cost %.
- **Sous Chef's view of Kitchen Hours & Cost (decided 2026-11-08, built ahead of roles)**: percentages and
  hours only. `/api/kitchen-labor?view=kitchen` rescales every dollar figure so the window's total food revenue
  is 1 (each week's %, and the weighted 4/13-week averages, stay exact; no dollar amount is sent), zeroes the
  Executive Chef's pay (owner compensation; the user's call: her weekly salary was readable from the toggle)
  and drops off-cycle labor dollars. The page (`/kitchen-labor?view=kitchen`) and `KitchenLaborChart`
  (`hideDollars`) then hide the revenue/labor/overtime $ columns and tooltip rows, the stream breakdown, the
  Executive Chef toggle and the blended-OT-rate footnote. It's a downgrade only, so a query param is safe;
  **phase 2 must force it server-side for the kitchen role**, not rely on the link. Known, accepted leak:
  estimated OT hours × the (unshown) blended OT rate gives OT dollars. Verified: ratios identical in both
  views, no `$` amounts rendered in the kitchen view, owner view unchanged.
- Verified in Chrome against local dev: desktop nav/sub-tabs across sections, Capacity via both entries, Settings
  (QuickBooks status resolves), and the phone layout + dark mode by applying the ≤860px rules at 390px width (Chrome
  wouldn't resize the window). Typecheck shows no new errors.

## Database migrations run automatically on deploy — 2026-11-08

Replaces the "run `scripts/add-*.mjs` on the volume by hand BEFORE `fly deploy`" step that nearly every
schema change in this file describes (and that went wrong at least once, 2026-08-19). **Those instructions
in older sections are superseded**: the ten `add-*` scripts were moved into
[`scripts/migrations/`](scripts/migrations/) as `0001`–`0010` and deleted, along with their `db:add-*`
npm scripts.

- **[`scripts/migrate.mjs`](scripts/migrate.mjs)** applies pending migrations in order, each in its own
  transaction, recording ids in `schema_migrations`. It runs before the app starts in production (Dockerfile
  `CMD`: `node scripts/migrate.mjs; exec node .output/server/index.mjs`) and before `npm run dev` (`predev`);
  `npm run db:migrate` runs it by hand. So **`fly deploy` alone now applies schema changes**.
- **Writing a migration**: add `scripts/migrations/NNNN-name.mjs` exporting `up(db, log)`; it must be safe to
  re-run (check before adding a column/table), because a database built from `schema.sql` already has
  everything and still gets every migration run once. Also update `schema.sql`. Data backfills that call
  Toast/QBO are deliberately not migrations (slow, external); they stay one-off `fly ssh console` commands.
  The old one-time data migrations (`migrate-*.mjs`) were left as they were.
- **Backups**: before applying anything (never on a no-op start) it saves `data/backups/pre-migrate-<time>.sqlite`
  via `VACUUM INTO` and keeps only the newest 3, since copies include the QuickBooks tokens. Older hand-made
  `/app/data/backup-pre-*` copies on the production volume are a different pattern and still need deleting by hand.
- **A failed migration does not stop the app** (`;` not `&&`): with a single machine, a container that won't
  start is a full outage, while a missing column only breaks the routes that need it. The failed migration's
  transaction rolls back; earlier ones stay applied. The Settings page has a **Database updates** card
  (`/api/settings/migrations`) listing anything not applied; the reason is in `fly logs` ("[migrate] FAILED").
- **First production deploy**: all ten are recorded; 0001–0009 should be no-ops there, and 0010 creates the
  BOH hours tables (replacing that commit's manual step). The BOH history backfill is still manual:
  `fly ssh console -C "node scripts/backfill-toast-employee-hours.mjs --since=2026-09-28"`.
- Verified on scratch copies: up-to-date local copy (no-op, recorded, rerun "up to date"), fresh `schema.sql`
  database, an old-shape copy (missing tables/columns and the old enrollment CHECK: all restored, an existing
  enrollment row kept), a forced failure (rolled back, exit 1, earlier migration kept), backup pruning to 3;
  plus the Settings card in both states. The Docker `CMD` itself wasn't run locally (no Docker build here).

## Settings page: targets and room setup moved in — 2026-11-08

Same day as phase 1. Rule of thumb agreed with the user: values set once in a while that shape several pages
live in Settings (owner-only once roles exist); inputs you change while looking at the numbers they change stay
on their page. The "Where other settings live" list on Settings was removed, since everything on it either moved
or was judged to stay put.

- **Targets & Alert Levels** ([`TargetsSettings.vue`](app/components/TargetsSettings.vue), read by
  `/api/settings/targets`): the weekly sales goal (moved from This Week, which now shows the goal read-only with a
  Settings link) with the data-driven "what the week needs" suggestion beside it (still computed in
  `dashboard.get.ts`); the cost targets (`category_benchmarks`), which had no screen before — saved by the new
  `POST /api/settings/benchmarks` (target ≤ watch ≤ serious; above serious is critical; `critical_pct` is kept ≥
  serious but isn't used for status); and the overspending alert levels (moved from Budget Check, same
  `drilldown_thresholds` route).
- **Restaurant Setup** ([`RestaurantSetupSettings.vue`](app/components/RestaurantSetupSettings.vue)): seats and
  turns per area (capacity derived and saved with them), weekly area closures, and holiday closures per month,
  moved from Planning › Capacity. The rules both pages share (Outdoor closed Nov–Apr, capacity = seats × turns,
  closure uplift, parsing) are in [`app/utils/capacityRules.ts`](app/utils/capacityRules.ts).
  `POST /api/capacity/settings` now takes partial area updates (omitted fields keep their value), so each page
  saves only its own fields. Planning › Capacity shows the setup read-only (closures as a short list, only when
  any exist) and saves only spend per guest, auto-update and the covers grid; the stored-capacity mismatch
  auto-fix moved to Settings with the seats/turns inputs.
- **Stayed put, on purpose**: Staffing Plan rates/taxes/role classes (a model that recomputes and saves the labor
  budget as a whole; tax rates in Settings could drift from the saved budget) and Cash & Loans' reserve plan and
  gift card cash (working inputs used beside the projection).
- Verified in Chrome on local dev: each save round-tripped (room setup changed only Bar's seats/capacity; the
  Capacity save changed only per-cover; benchmark save and an invalid-order rejection), then everything was put
  back via the APIs and confirmed identical to the morning's pre-migrate backup (`capacity_areas` and all 60
  covers rows). One harmless side effect seen: saving closures writes zero weights for open nights (e.g. Sun: 0),
  which means the same as omitting them.

## Named holiday closures; special nights reach the budget — 2026-11-08

The user had been entering full buyouts, special events and a large September off-site catering night as
"holiday closures" (a flat count per month in `capacity_seasonality.holiday_closures`), from before those had
budget treatment of their own. Traced in the code, not assumed: the revenue budget (Sales Plan "Recompute Revenue
from Capacity", and Build next year's budget) came from the Capacity projection minus an average night per count,
and **only buyouts** reached the budget otherwise (as price − normal weekday night, via the Buyout panel).
Closed/off-site/event special nights only affected the current-month projection and Next 7 Nights. So a buyout
also entered as a closure was budgeted one normal night short, and a buyout or event entered only as a closure
lost its whole revenue. (Production's counts couldn't be read from here: the auto-mode safety check blocks
production reads.)

- **`holiday_closures`** (date PK, name; migration `0011`, applied automatically on deploy) replaces the counts.
  Edited in Settings › Restaurant Setup ([`HolidayClosuresSettings.vue`](app/components/HolidayClosuresSettings.vue),
  routes `/api/settings/holidays` GET/POST/DELETE) for this year or next, with quick-add chips for common holidays
  (New Year's Day, Easter, July 4, Thanksgiving, Christmas Eve/Day, New Year's Eve; Mondays left out). The old
  counts column stays but is **no longer read**; Settings lists any nonzero ones with a "Clear old counts" button.
- **One rule for every dated night** ([`server/utils/special-nights.ts`](server/utils/special-nights.ts)):
  `loadPlannedNights` merges holidays (as `closed`, $0, `holiday` = name) with special nights (a special night wins
  on the same date); `loadReplacedNights` = those minus buyouts and Mondays. In the capacity model
  (`capacity.get.ts` `dayByDaySum`) a replaced night has no regular covers or seats and adds its own expected
  dine-in revenue (split food/beverage like a normal night that date). Buyouts stay normal nights there; the Buyout
  panel adds their extra, unchanged. Consumers updated: capacity months/periods (`holidayClosures` now counts
  replaced nights; `replacedNightList` names them), the Capacity grid (`/api/capacity/settings?year=` returns
  `replacedNights`; "Closures" column renamed "Closed nights", hover lists them), breakeven and What-If service
  nights (`replacedNightsByMonth`), and the current-month projection and Next 7 Nights (now also see holidays).
  An event night's expected revenue is dine-in only on top of tickets (tickets are budgeted in Event Sales).
- **What this does and doesn't change on deploy**: the Capacity projection, breakeven and What-If change at once
  (old counts stop subtracting nights). **`budget_targets` don't change** until "Recompute Revenue from Capacity"
  is clicked per month on the Sales Plan. Cleanup for the user: enter real holidays in Settings, enter each buyout/
  event/off-site night as a Special Night (with its expected dine-in revenue), recompute the current and future
  months, check the Buyout panel's Apply, then clear the old counts.
- Verified on local dev with temporary entries (all removed after, December back to $266,941.44): two December
  holidays −$20,556 (2 × a $10,278 night, operating days 27→25); an off-site night −$10,278; an event with $2,000
  expected −$8,278; a dated buyout $0 change; food + beverage still sum to the total; the Capacity grid's December
  projection matched the server ($227,829). Settings editor: quick-add, 2027 dates (Easter Mar 28, Thanksgiving
  Nov 25), remove. No new type errors.

**Cleanup session, 2026-11-08 (done by the user in the UI):**
- Holiday closures entered for 2026 and 2027: Jan 1, Jan 2 (staff break), Jul 4, Thanksgiving, Dec 24, Dec 25.
  Jul 4 is a plain closure, not an event (see the correction in the Historical tab section: Toast shows 1 cover and
  0 labor hours, and QBO's $10.6K that date is likely a posting-date artifact).
- Special Nights for November: Nov 12 Founders Collective buyout ($11,000 minimum, drinks extra) and Nov 17 Wild
  Things ticketed event ($2,000 dine-in expected; $6,500 of tickets budgeted in Event Sales, 4145 $2,000 and 4150
  $4,500). Historical nights (Sep 26 off-site, Oct 20/21 Mushroom Dinners) were deliberately not entered: the panel
  only works from the current month on, and the usual-night averages already exclude them (covers < 15 or no
  positive core revenue).
- **Undated-count remainder:** the Buyout planner's Thursday count was 1.4645. Counts are in standard-buyout units, so
  a fraction like this is what "replace an undated count with a dated buyout" leaves behind when the prices differ
  (how this particular value arose is not recorded here). With Nov 12 now dated, the user set the count to 0 rather
  than let it double count the same night.
- **Sales Plan before/after:** Nov $207,801 → $212,633 (Recompute from Capacity +$2,040, buyout Apply +$2,792, saved).
  Dec $221,501 → $219,581 after Recompute (two closure nights removed). Remaining steps given to the user: Save Dec if
  the button is active, then Settings › Holiday closures › "Clear old counts".

## Roles and per-person access (UI cleanup phase 2) — 2026-11-09

Each person now gets a role, taken from the email Cloudflare Access verifies, and the role is enforced on the
server for pages **and** API routes, not just hidden in the nav.

- **Roles** ([`shared/utils/access.ts`](shared/utils/access.ts), one definition used by server and app; default
  deny): `owner` = everything incl. Settings and all writes. `gm` = read-only: This Week (including cost pace and budget
  runway), Daily Results (sales and profit views), Covers & Spend, Seasonal Trends, Budget Check, Kitchen Hours & Cost
  with dollars (widened 2026-11-09; see below). `kitchen` = read-only Kitchen Hours & Cost, percentages and hours only.
  Non-owners may only GET, plus `POST /api/qbo/sync` for the GM (the header's "Sync now"; **not** the Sous Chef, 2026-11-09).
- **Enforcement**: [`server/middleware/auth.ts`](server/middleware/auth.ts) now returns the verified JWT email, looks
  it up in `user_roles` (migration `0012`), sets `event.context.auth`, then refuses disallowed API calls with 403 and
  redirects disallowed pages to the role's home. A Cloudflare-verified email with **no row is refused (403)**. Basic
  Auth on the raw fly.dev hostname is always owner (kept as the owner backstop, per the user's choice).
- **Server-side redaction** (not just hidden by the page): `/api/dashboard` blanks the month/year actuals and
  budgets, benchmarks and the suggested-goal inputs for non-owners; `/api/pl` blanks period totals and benchmarks
  (the Revenue Calendar's per-day goals stay); `/api/kitchen-labor` forces the percentages-only view for `kitchen`
  whatever the query says, and zeroes the Executive Chef's pay for `gm` (owner compensation). `/api/nightly-margin`,
  `/api/breakeven`, Budget, Cash & Loans, Benefits, Settings, etc. are owner-only. Pages hide the matching pieces
  (Cost Pace, Budget Runway, the Profit toggle, the Breakeven card, the Executive Chef toggle) via `useMe()`.
- **App side**: [`useMe`](app/composables/useMe.ts) (`/api/me`), a global route guard
  ([`role.global.ts`](app/middleware/role.global.ts)), role-filtered nav (`visibleNav` in `navigation.ts`), and
  **Settings › People & Access** ([`PeopleAccessSettings.vue`](app/components/PeopleAccessSettings.vue), routes
  `/api/settings/people` GET/POST/DELETE, owner-only, refuses to remove or demote the last owner).
- **Seeded** by the migration: `kmillercc@gmail.com` owner (a guess at the owner's Access email), `ataylor@urbanhearth.net`
  gm, `rebecca.m.daulton@gmail.com` kitchen. Anyone else on the Cloudflare allow-list (e.g. a second owner) is
  refused until added under People & Access (sign in at restaurant-pulse.fly.dev with Basic Auth to do so). The
  Cloudflare allow-list itself is still edited in Cloudflare.
- **Verified** against the real middleware on a local dev server with a throwaway key standing in for Cloudflare
  (signed tokens for all three roles plus an unknown email): status codes for ~30 page/API combinations, the
  redactions, the forced kitchen view, and the rendered nav per role. Not clicked through in a browser, and not yet
  tried with real Cloudflare logins in production.
- **Not covered**: a GM can see the Home page's weekly goal and the Next 7 Nights booking pace; the GM's Capacity page
  still lists per-area spend assumptions (read-only). (Kitchen's "Sync now" was removed 2026-11-09, see below.)

## Kitchen This Week (Sous Chef Home page) — 2026-11-09

The Sous Chef's role now has a Home page, **This Week (kitchen)** at `/kitchen-week` (`app/pages/kitchen-week.vue`),
the covers-only counterpart of the owner/GM This Week. The user's call, at the Sous Chef's likely need (prep, ordering,
scheduling): covers and bookings, never dollars.

- **What it shows**: this week's expected covers per night (the same day-specific pattern the owner page uses, converted to
  covers) against real Toast covers so far, with a week-to-date chip; and the Next 7 Nights OpenTable booking pace. Buyouts,
  events and closures show as chips and are left out of the week-to-date comparison.
- **Server side, not just hidden**: `GET /api/kitchen-week` selects only counts, dates and labels. It is the only dashboard-like
  API the kitchen role may call. `/api/dashboard` and `/api/booking-pace` stay owner/GM-only (default deny in
  `shared/utils/access.ts`), because they carry the weekly sales goal, per-night dollar targets, budgets and a special
  night's expected revenue. Verified as the Sous Chef preview on local dev: `/api/dashboard`, `/api/booking-pace`,
  `/api/capacity`, `/api/pl` and `/api/budget/*` all 403; `/` redirects to `/kitchen-week`; the kitchen-week response has no
  dollar fields.
- **Navigation**: `NavPage.onlyFor` (`app/utils/navigation.ts`) gives the kitchen role its own "This Week" entry under Home
  (owner/GM keep `/`). `roleHome('kitchen')` is now `/kitchen-week`. Kitchen Hours & Cost is unchanged.
- **Known, accepted**: a special night's free-text note (entered on the Sales Plan) is shown to the kitchen, so avoid putting
  dollar amounts in those notes. Expected covers come from the owner's weekly goal, so with no goal set they show "—".
- Verified on local dev in Chrome (Preview as Sous Chef) and by typecheck (no new errors). Not yet deployed, and not seen
  with the real Sous Chef login.

## UI cleanup phase 3: plainer wording, staff and owner-pay rules in Settings — 2026-11-09

- **Staff & Pay Rules** in Settings ([`StaffRulesSettings.vue`](app/components/StaffRulesSettings.vue)). The salaried /
  grandfathered / shared-login lists that were constants in `staff-hours.get.ts` are now the `staff_overrides` table
  (migration `0013`, seeded with the same five names), read by [`server/utils/staff-overrides.ts`](server/utils/staff-overrides.ts)
  and edited by picking a Toast employee plus a rule (`/api/settings/staff-overrides` GET/POST/DELETE). One rule per
  person; a stored name nobody in Toast matches is shown with a "check for a rename" warning. Keys are Toast's lowercased
  "first last" for salaried/grandfathered and the lowercased display name for shared logins, as before.
- **Owner pay accounts** (same card, `/api/settings/owner-pay`): flag or unflag any active leaf labor account as
  `accounts.is_owner_compensation`, which used to be hand-run SQL. The flag is per database (production's accounts have
  their own flags), so check it in production after deploying.
- **Wording**: COGS now reads "Food & drink cost" everywhere the app shows it (`CATEGORY_LABEL`, tables, notes, buttons,
  messages), Opex as "operating expenses", "benchmark" as "target" in the P&L and Dashboard, Free Cash Flow as "cash left
  after loans", Debt Service as "loan payments". DSCR and EBITDA keep their names but are spelled out beside them (loan
  coverage ratio; operating profit before interest & depreciation). Prime cost, Net Income and the code/schema names are
  unchanged. Code identifiers, `schema.sql` and older sections of this file keep the old names; see the Terminology note at
  the top.
- **Deployed 2026-11-09 and checked in production by the user**: Settings lists nothing pending, the five seeded rules
  and the two owner-pay flags are present, and Benefits Eligibility looks right.
- Verified: production build and typecheck (no new errors), the new routes by round trip against local dev (add, replace,
  remove, owner-pay list, Settings page 200).

## Roles tweaks, budget double-counting and a QuickBooks diff script — 2026-11-09

- **GM sees more** (the user's call): cost pace and budget runway on This Week, Budget Check, and the Daily Results
  profit view. The owners' own pay stays out of reach: `/api/dashboard` and `/api/budget/actuals` zero the owner-pay
  figures for non-owners, and `/api/budget/targets` merges the owner-pay accounts into one unflagged "Owner pay" row
  (totals still add up, individual salaries can't be read, and the "labor without owner pay" view is hidden). Budget
  Edit, Sales Plan, Staffing Plan, Profit & Loss, Cash & Loans, Benefits, What-If and Settings stay owner-only. The
  Sous Chef can no longer press "Sync now" (API refuses it; the button is hidden).
- **Preview as GM / Sous Chef** (owner only): Settings › People & Access has "Preview as General Manager / Sous Chef".
  `POST /api/view-as` sets an httpOnly `view_as` cookie; `applyViewAs` in `server/middleware/auth.ts` honors it only
  when the signed-in person really is an owner and only ever downgrades, keeping `realRole: 'owner'` so the banner's
  "Exit preview" always works. A GM or Sous Chef who sends the cookie gets nothing (verified). The preview runs the same
  server enforcement the real role gets, so what you see is what they see.
- **Budget rows are no longer double-counted.** Budget entry was already leaf-only, but older parent-account rows could
  still be summed by readers. Now a parent account's budget is never counted: `/api/budget/targets` nulls parent amounts
  (the client sums that response), and the server-side sums in `dashboard.get.ts`, `overspending-detail.get.ts` and
  `breakeven.get.ts` skip parents in SQL (`NOT EXISTS` a child). Local dev has no such rows. To see whether production
  has any, run (read-only):
  `fly ssh console -a restaurant-pulse -C "node -e \"const D=require('/app/node_modules/better-sqlite3');const d=new D('/app/data/restaurant.sqlite',{readonly:true});console.log(d.prepare('SELECT a.account_number n,a.name,bt.year y,bt.month m,bt.amount amt FROM budget_targets bt JOIN accounts a ON a.id=bt.account_id WHERE bt.amount<>0 AND a.is_active=1 AND EXISTS(SELECT 1 FROM accounts c WHERE c.parent_account_id=a.id) ORDER BY y,m,n').all())\""`.
  Any rows it lists were being counted in some totals before this change.
- **`scripts/diff-qbo-pl.mjs`**: read-only comparison of `daily_line_items` against QuickBooks's cash-basis P&L for the same
  dates, per account, with category totals (only a refreshed OAuth token is written). Run it in production:
  `fly ssh console -a restaurant-pulse -C "node scripts/diff-qbo-pl.mjs --since=2026-01-01 --category=cogs"`. It can't run
  against local dev (the sync guard and sandbox connection). Written 2026-11-09 to chase the ~$1.9K food & drink cost
  mismatch. **Run 2026-11-09 against production**: food & drink cost, labor, other income and other expense matched to the
  cent (the old $1.9K gap was gone); the only differences were stale rows from entries edited in QuickBooks after they synced
  (Dues & Subscriptions +$402.19, Advertising −$110, Worker's comp −$76.52 / Gas +$76.52, Retail Food +$0.30). The script
  gained `--fix`, which backs up the database (`data/backup-pre-diff-fix-*.sqlite`, contains QuickBooks tokens: delete it
  afterward) and replaces just the differing accounts' rows in the range with QuickBooks's.
  **Applied in production 2026-11-09 and re-checked: all six categories (food & drink cost, labor, operating expenses,
  other income, other expense, revenue) match QuickBooks to the cent for 2026-01-01..2026-11-08, 0 accounts differ.** Re-run
  `node scripts/diff-qbo-pl.mjs --since=<date>` after recoding or deleting entries in QuickBooks, since the nightly sync
  never revisits or removes already-synced rows. Likely causes to look for, from earlier finds: an account QuickBooks has but the app doesn't
  (inactive/renamed), a backdated entry the forward-only sync never reached, or a parent account's own postings.

## Bank register import for the loan reserve — 2026-11-11

Prompted by reconciling `reserve_transfers` against the QBO bank register for 1002 Loan Reserve: the recorded
total ($47,283) was $12,283 over the bank ($35,000), almost all from one hand-typed entry with the wrong sign (the
Nov 9 Eastern Bank payment entered as a deposit), the rest interest and cents. Re-typing bank activity by hand
can't stay in step, so the bank register is now the source of truth for the reserve.

- **Upload**: Cash & Loans › Loan Reserve Savings Plan › "Import bank register"
  ([`BankRegisterImport.vue`](app/components/BankRegisterImport.vue), route
  [`server/api/cashflow/bank-register.post.ts`](server/api/cashflow/bank-register.post.ts), logic in
  [`server/utils/bank-register-import.mjs`](server/utils/bank-register-import.mjs)). Accepts the QBO export as
  `.xls` or `.xlsx` (parsed with SheetJS). The upload previews first (`?mode=preview` writes nothing); "Apply
  import" re-sends the file with `?mode=apply`. Refuses a file whose account isn't "Loan Reserve".
- **Rules**: every register row becomes a `reserve_transfers` row (amount = Deposit − Payment, to the cent; memo/
  payee or the counter-account as the note), marked `source='bank'`. Rows before `BANK_IMPORT_START`
  (2026-07-13) fold into one "Opening balance" row ($102.45 today), so the total always equals the bank balance.
  Loan payments, interest and owner distributions come through too, as they were already recorded by hand.
  **Replace, don't append**: an import deletes every bank-sourced row plus every hand-entered row dated from
  Jul 13 through the file's last day, then inserts the file's rows; hand-entered rows dated after the file stay.
- **Notes survive**: a hand-entered row that matches a bank row (amount within $1 ignoring sign, date within
  7 days, best text/date fit) lends its note, so notes like "Reversal to free-up cash" aren't lost. The sign-
  ignoring match is what flags a wrong-sign entry as "Corrected".
- **Tie-out guard**: the imported rows must total the register's "Ending Balance" header; otherwise the preview
  shows a red mismatch and Apply is refused.
- **Schema**: migration `0014` adds `reserve_transfers.source` and a single-row `reserve_bank_sync` (last import's
  through-date, shown on the page). `cashflow.get.ts` returns `reserve.bankSync` and each transfer's `source`; the
  history table tags bank rows. The "Record a transfer" form is still the way to log something newer than the file.
- **Dependency**: `xlsx` is installed from SheetJS's own CDN (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`),
  not the npm registry, whose last release (0.18.5) has known vulnerabilities. `npm ci` therefore needs to reach
  cdn.sheetjs.com during the Docker build.
- **Free Cash Flow side effect (pre-existing, now more visible)**: `reserveTransferredInRange` sums every row, so
  reserve-funded loan payments, interest and owner distributions recorded here net against "transfers into the
  reserve". That was already true for hand-entered rows; the import just records them exactly.
- **Verified** against the real 2026-11-11 register on an in-memory DB seeded with the screenshots' hand-entered
  rows: 124 register rows parsed, total ties to $35,000.00, 24 unchanged / 9 corrected (incl. the sign error and
  the Oct 26 → Oct 23 owner distribution date) / 6 added / 3 removed; apply gave exactly $35,000.00; re-import was
  a no-op. Route checked on local dev in preview mode (writes nothing); `npm run build` bundles `xlsx`. **Not
  clicked through in a browser** (local dev is behind Basic Auth) and not yet run against production data: the
  first production import is the user's to run after deploying.

## Automatic capacity forecast with pins (dynamic budgeting, step 1) — 2026-11-11

Step 1 of 3 of the move to dynamic budgeting agreed with the user: the forecast updates itself,
and each month's plan freezes when the month starts. The Capacity page's "Set from Actuals",
"Auto-update monthly", "Set by History" and "Set by Actuals" controls were removed. Each value is
now **automatic** or **pinned** (typed by hand, kept until unpinned).

- **[`server/utils/capacity-forecast.ts`](server/utils/capacity-forecast.ts)**
  `refreshCapacityForecast()` runs after every nightly sync (it replaced `applyMonthCloseActuals`
  in `qbo-sync-runner.ts`), after every Capacity/Settings save, and lazily on page load:
  `ensureCapacityForecastFresh` in `capacity.get.ts` and `capacity/settings.get.ts` runs at most once a day, or
  when newer Toast data exists, so local dev (where the sync refuses to run) stays current.
- **Spend per guest**: an area's real Toast blend over the two most recently closed months whose
  data is fully synced (needs 30+ covers, else unchanged). It moves only when a month closes, so the
  current month is judged against a fixed figure. `capacity_areas.follow_actuals` now means
  automatic (1) vs. pinned (0). `auto_per_cover_*` hold the automatic figure even when pinned, and
  `follow_actuals_through` is the later basis month. Food/beverage split: Chef's Counter's real
  split; else QBO's food/beverage mix for the window; else (no QBO revenue for it) the area's
  previous automatic share, kept as-is for the same months so it can't drift by rounding.
- **Expected covers**: for every month that **hasn't started**, the old "Set by History" rule,
  server-side: the history shape × the data-driven baseline (`dataAnnualFillPct`), split by
  `areaFillIndex`, rounded by largest remainder. **The current month is never recomputed** (frozen
  at what the forecast said when it began). Rows are per calendar month and reused every year, so a
  closed month's row becomes next year's forecast. `capacity_area_seasonality.expected_covers` is
  still the value every reader uses; `pinned`, `auto_covers`, `auto_basis` ('history:45.3') and
  `auto_updated_at` were added.
- **Bug fixed in the history baseline** (`server/utils/capacity-history.ts`, the computation moved out
  of `capacity/history.get.ts` so the forecast can share it): `dataAnnualFillPct` and `areaFillIndex`
  measured every day against May–Oct seating, including Outdoor's 40, but the result was applied to
  winter seating without it, so winter months came out roughly a fifth low. On production's figures,
  November read about 45% "by history" against about 55% actual. Both now use each day's own
  season's capacity.
- **Migration `0015`** (automatic on deploy): adds the columns and `capacity_forecast_refresh`. On its
  first run every area and covers row becomes automatic, except Chef's Counter, whose spend per guest
  and covers stay pinned (deliberate price / marketing goal; the hard-coded `CHEFS_COUNTER_2027_GOAL`
  is gone). The covers as they stood are saved in `capacity_area_seasonality_pre_auto`.
- **What changes in production on deploy**: the first refresh rewrites covers for December and
  Jan–Oct (next year's rows) from history, and spend per guest for Dining Room/Bar/Salon/Outdoor
  from Sep–Oct actuals. November (current) is untouched. **`budget_targets` don't change** until the
  Sales Plan's "Recompute from Capacity" is clicked (step 2 automates that).
- **Page**: [`app/pages/capacity/index.vue`](app/pages/capacity/index.vue) Edit tab. Typing into a cell pins it
  (accent outline + ↺ badge, which unpins); a Basis column shows "History ≈45%" or "Frozen this
  month"; "Unpin all covers (N)" sits by Save. Pins are saved with Save (`pinned` per row in
  `POST /api/capacity/settings`; omitted = pinned; unpinned rows take `auto_covers`).
  `area-actuals.get.ts` no longer returns `trailingTwoMonth`.
- **Known limits**: Covers & Spend's closed-month comparisons use that month's row, which is now next
  year's forecast (already true before, since rows were reused, but now it moves automatically).
  Snapshotting each month at its start is part of step 2. The history shape is still Mass Ave 2025.
- **Verified locally** (synthetic 2025 sales added for the history, then removed, and the capacity rows
  restored to post-migration values): recompute and frozen month; spend per guest matched each area's
  Sep–Oct Toast average to the cent; pin/unpin round trip via the API and the page; refresh stable
  across runs; related pages 200; dark-mode styles by computed values. Automatic Sep/Oct covers came
  within ~10% of actual. Not checked on production data.
- **Next**: step 2 (below) is built; step 3 is weekly forecast snapshots and an accuracy report.

## Automatic budget lines (dynamic budgeting, step 2) — 2026-11-11

A month's food/beverage sales and food & drink cost now follow the forecast automatically until the month
starts, then freeze. This removed the Sales Plan's "Recompute [month] Revenue from Capacity" / "Recompute
all", its buyout "Apply to budget", and the Budget page's "Recompute food & drink cost from this average".
Older sections describing those buttons are history.

- **[`server/utils/budget-forecast.ts`](server/utils/budget-forecast.ts)** `refreshBudgetForecast()` writes
  10 lines, matched by account number (`MANAGED_ACCOUNT_NUMBERS`): 4010 food sales; 4022/4024/4026/4028
  beverage sales; 5010 food cost; 5110/5120/5125/5130 drink costs. Months covered: **every month after the
  current one, through December of next year**. The current month and earlier are never written.
  - Sales = the Capacity month projection (`createCapacityModel().dayByDaySum`, so holidays, special
    nights and area closures count exactly as on the Capacity pages) + planned buyouts
    (`plannedBuyoutIncrement`: dated buyouts' expected − a normal night that weekday, plus the undated
    per-weekday counts × (rate − normal night)). Food/beverage share and the beer/liquor/wine/N-A split
    come from real sales since the move.
  - Cost = each line's actual % of its paired sales line (`COST_PAIRS`) over the (up to) three most
    recent closed months from Aug 2026 on whose QBO data is fully synced (`costWindow`). It applies to
    the sales figure actually budgeted, so a pinned sales line drives its cost. No window = cost left as entered.
    Months whose catering/event sales exceed 5% of dining sales are flagged (catering purchases sit in 5010).
- **[`server/utils/capacity-model.ts`](server/utils/capacity-model.ts)**: the night-by-night projection
  moved out of `capacity.get.ts` (output verified byte-identical before/after) so the job uses the same math.
- **Pins**: `budget_targets.pinned` / `auto_amount` (migration `0016`, automatic on deploy; it copies the 10
  lines' future-month rows to `budget_targets_pre_auto` first). `POST /api/budget/targets` takes optional
  `pinned` per row (true = typed by hand; false = back to automatic, uses `auto_amount`; omitted = leave as
  is) and recomputes when a pin changes. `GET /api/budget/targets` adds `autoMonth` and per-account
  `autoManaged` / `pinned` / `autoAmount`. Saving a changed managed line on the Sales Plan or Budget page
  pins it; ↺ next to a pinned line (or "Unpin all") unpins.
- **When it runs**: `refreshForecasts()` (capacity then budget, `server/utils/capacity-forecast.ts`) after
  the nightly sync; `refreshForecastsAfterChange()` after saves on Capacity/Settings room setup, holidays,
  special nights, buyout counts/rates, and pin changes; `ensureForecastsFresh()` (once a day or on newer
  Toast data) on capacity, budget targets, dashboard and cash flow loads.
- **Pages**: Sales Plan shows an "Automatic" / "Frozen plan" banner and a "Save planned buyouts" button
  (counts only; the server adds them to the budget); its Special Nights notes were updated. The Budget page
  shows the server's cost %s (`GET /api/budget/cost-forecast`) for months that haven't started; the old
  client-side trailing-average code was removed. `revenue_buyout_applied` is no longer written or read.
- **What changes in production on deploy**: Dec 2026 and every month of 2027 get these 10 lines rewritten
  from the (step-1-corrected) Capacity forecast and Aug–Oct cost %s. That includes the hand-entered 26.5%
  Dec food cost and the 2027 lines from "Build 2027 budget" / `seed-2027-budget-extras.mjs` (their revenue
  and these cost lines are now redundant; other lines they wrote are untouched). November is untouched.
  Previous values: `budget_targets_pre_auto`. The Cash & Loans Budget outlook card moves with them.
- **Food cost includes catering (2026-11-11, same day, after the first production review)**: catering and
  event food is bought through 5010, so September's catering inflated the restaurant-only food %. Food cost %
  is now (5010 + 5220) ÷ all food sales (4010 + 4150 on-site event food + 4180 off-site event food + 4230
  catering food) over the window. Each month's 5010 = that % × (budgeted restaurant food + those budgeted
  event/catering food lines) − 5220's own budget, so the two food cost lines total right. (`COST_PAIRS`
  `extraCost`/`extraSales`.) Assumes catering runs the dining room's food cost %. Purchase timing (food
  bought the month before an event) is mostly absorbed by the three-month window; catering-heavy months are
  still flagged. Retail food (4320) is not included.
  **5220 leftovers**: the old client-side recompute spread food cost across every Food-tagged cost leaf, so
  some months carry a 5220 budget that isn't catering (local dev had ~$20K/month Sep–Dec). Totals stay right,
  but 5010 shows only the remainder; zero 5220 in those months to see the full figure on 5010.
- **Month tabs moved to the top** of the Sales Plan and Budget pages (under the year toggle, `.page-tabs`),
  since every panel below them is for the selected month.
- **Verified locally** (temporary Aug–Oct sales/costs and buyout counts added, then everything restored from
  a backup and checked to zero differences): Nov frozen; Dec food sales = Capacity food to the cent; a
  2027 Thursday buyout added exactly (rate − normal night) × food share; costs = window % × sales (and ×
  a pinned sales figure); pin survives refresh; unpin restores the automatic figure; buyout save
  recomputes at once; both pages render the banner, pins and ↺ in the browser. Not checked on production data.

## Spec: forecast snapshots and accuracy report (dynamic budgeting step 3) — written 2026-11-11, not built

Written to be built from directly (possibly by a smaller model). Read "Automatic capacity forecast with
pins" and "Automatic budget lines" above first. **Do not change the forecast math** in
`server/utils/capacity-forecast.ts`, `capacity-history.ts`, `capacity-model.ts` or `budget-forecast.ts`;
this step only records and reads what they produce.

**Why**: past forecasts can't be reconstructed later (the forecast overwrites itself nightly), so the app
must save them as it goes, to (a) measure how far off the forecast was at different lead times, (b) give each
month a frozen record of what was planned when it started (Covers & Spend currently compares a closed month
against the reused per-month row, which is now next year's forecast), and (c) answer the bookmarked Cash &
Loans question about budget accuracy. Nothing can be backfilled, so it is only useful after weeks of
snapshots: ship it early.

**Decisions (already made)**
- **Grain: month × metric, not per account.** Metrics: `sales` (all revenue-category leaf lines),
  `core_sales` (`CORE_REVENUE_ACCOUNT_NUMBERS`), `food_drink_cost` (cogs), `labor`, `opex`,
  `other_income`, `other_expense`, `net_income` (= sales − cost − labor − opex + other_income −
  other_expense, same formula as `netIncome()` in `useBudgetData.ts`), `covers` and `max_covers` (from
  `createCapacityModel(...).dayByDaySum` for the month), `capacity_sales` (its `expectedRevenue`).
  Category sums must skip parent accounts (`NOT EXISTS` a child), like every other server-side budget sum.
- **Sources**, stored side by side: `plan` = `budget_targets` for that month (for months that haven't started
  this IS the automatic forecast); `live` = for the current month only, the night-by-night projection's
  core sales (logic in `server/api/revenue-projection.get.ts`; move its body into a util, e.g.
  `server/utils/revenue-projection.ts`, keep the route as a thin wrapper, and confirm the route's JSON is
  byte-identical before and after, as was done for `capacity-model.ts`).
- **Kinds**: `weekly` (every Monday) and `month_start` (the first sync on/after the 1st; this is the frozen
  plan record). Same row shape for both.
- **Months covered per snapshot**: the current month through 12 months ahead.
- **When**: in `runNightlySync()` (`server/utils/qbo-sync-runner.ts`) right after `refreshForecasts()`, inside
  its own try/catch that only logs. Idempotent: `INSERT OR REPLACE` keyed on (snapshot_date, kind, year,
  month, source, metric), where snapshot_date = that week's Monday for `weekly` and the 1st for
  `month_start`; skip if it already exists.
- **Manual trigger** for local testing (the nightly sync refuses outside production):
  `POST /api/forecast/snapshot` (owner-only by default, since access is default-deny), taking an optional
  `{ date }` so a test can take a snapshot "as of" a given day.

**Table (migration `0017-forecast-snapshots.mjs`, plus `schema.sql`)**
```sql
CREATE TABLE forecast_snapshots (
  snapshot_date TEXT NOT NULL,          -- Monday (weekly) or the 1st (month_start)
  kind          TEXT NOT NULL CHECK (kind IN ('weekly', 'month_start')),
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  source        TEXT NOT NULL CHECK (source IN ('plan', 'live')),
  metric        TEXT NOT NULL,
  value         REAL NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (snapshot_date, kind, year, month, source, metric)
);
```

**Accuracy report**: new owner-only page **Money › Forecast Accuracy** (`app/pages/forecast-accuracy.vue`,
route `/forecast-accuracy`, entry in `app/utils/navigation.ts`'s Money section; non-owners are blocked by
`shared/utils/access.ts` default deny, so add nothing there). Data from `GET /api/forecast/accuracy`:
- For each **closed, fully synced** month (QBO `MAX(date)` ≥ month end, same test as `costWindow`), actuals
  per metric from `daily_line_items` (and `daily_toast_metrics` for covers), and each snapshot's error
  = (forecast − actual) ÷ actual, with lead time = weeks from snapshot_date to the month's 1st (negative =
  taken during the month).
- Page: a table per closed month (month-start plan vs. actual, and the forecasts 1, 4 and 8 weeks out),
  plus a summary of mean absolute % error by lead bucket for `sales`, `core_sales`, `covers` and
  `net_income`. Plain tables; no charts needed. Status coloring follows the existing chip conventions
  (icon + label, never color alone). Say clearly on the page that it fills in over time.

**Covers & Spend integration (do after the report works)**: in `server/api/capacity.get.ts`, for a closed
or current month that has a `month_start` snapshot, use its `covers`, `max_covers` and `capacity_sales` as
the month's "assumed" figures, instead of the reused `capacity_area_seasonality` row. Fall back to today's
behavior when no snapshot exists (everything before the deploy). Per-area figures stay as they are (not
snapshotted).

**Verify**: run the migration on a copy of local data; trigger snapshots for two dates via the POST route;
add temporary actuals for a month to a copy (or a backed-up local DB, restored after, as earlier sections
did) and check the report's error figures by hand; confirm `revenue-projection` JSON is unchanged after the
extraction; typecheck (compare error counts, many are pre-existing). In production, after deploy, check `fly
logs` after the next sync for the snapshot line, and the page shows "fills in over time" until a snapshotted
month closes. Document the result as a CLAUDE.md section, and delete this spec section when it's built.

## Staffing Plan save also re-prices next year — 2026-11-11

Labor settings (rates, hours, salaries, tips, tax rates) are not year-specific, so the 2027 view already modeled the
same staff. New: saving the Staffing Plan for 2026 also writes all 12 months of 2027 labor to `budget_targets` using a
second `createLaborModel` bound to the next year (`nextYearModel` in `app/pages/budget/labor.vue`), so 2026 changes flow
into 2027 without a separate save. It overwrites any hand-entered 2027 labor figures. Saving on the 2027 view behaves as
before (no 2028 yet). 2026-only inputs carry into 2027 as-is (Business Manager's reduced salary, reduced SUTA rate); the
page notes this. Typecheck shows no new errors; not clicked through in a browser.

## Not yet done

- **Bookmarked 2026-11-11, to evaluate and propose changes after dynamic budgeting step 2**: simplify
  Cash & Loans' Year-End Outlook (three cards: Budget / Recent pace / Night-by-night) and possibly fold
  "how accurate is the budget" into another page. The user treats Night-by-night as the most accurate
  cash forecast, rarely uses Recent pace, and reads the cards mainly as a budget-accuracy indicator.
  Relevant: once step 2 lands, the Budget card's later months already follow the forecast, so it and
  Night-by-night converge except for the current month; budget accuracy may belong with step 3's
  forecast snapshots/accuracy report instead.

- Confirming with Eastern Bank in writing (a) whether the DSCR covenant's
  "all annual principal and interest payments" counts only the SBA loan or
  all 10 loans (built against all 10 — see the DSCR covenant tracking
  section above), (b) whether "EBITA" in the loan documents is a typo for
  EBITDA, and (c) whether the pre-opening reclass entries will be accepted
  as non-recurring add-backs. Also confirming with the accountant whether
  Depreciation is actually being posted to QBO — it's showing $0 YTD and
  budgeted, which understates the real EBITDA add-back if leasehold
  improvements/equipment exist but aren't being depreciated.
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
- (Resolved 2026-11-09, see below) A small COGS (food & drink cost) discrepancy (~$1,926.79, ~0.25% of revenue)
  surfaced by the net income investigation above, not yet root-caused.
  2026-11-09: `scripts/diff-qbo-pl.mjs` now compares the app against QuickBooks account by
  account (see "Roles tweaks, budget double-counting and a QuickBooks diff script"); run it
  with `--category=cogs` to find the accounts that differ.
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
  SQL on the two owner accounts). Actual labor is now split by owner-comp
  too (`ownerCompLabor` in `server/api/budget/actuals.get.ts`, shown on
  Budget Pace's Labor card) — only the toggle UI remains.
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
- **Account 7020 Loan Interest budget for Dec 2026 ($9,733.33, set
  2026-08-18) depends on the investor-7 loans' Dec 20 catch-up payment
  landing exactly as currently scheduled/pre-loaded in QBO** (the seven
  loans' Dec 20 catch-up-clearing Expense transactions plus the
  `ACCRUED_12-20-2026` accrual true-up JE) — unlike Aug/Sep/Oct/Nov's
  figures, which were independently confirmed directly against real QBO
  data on 2026-08-18 (see the account 7020 investigation earlier this same
  day: a real gap was found where the June J&M accrual JE hadn't synced
  because the nightly sync's `MIN_QBO_LOOKBACK_DAYS` floor is only 30
  days, fixed via a targeted `scripts/backfill-qbo-pl.mjs` re-sync), the
  Dec figure is still a projection built from pre-loaded future
  transactions that haven't actually happened yet. Re-verify against real
  December actuals once Dec 20 passes, the same way Sep/Oct/Nov were
  confirmed via a direct read-only QBO Reports API query rather than
  waiting for the regular sync to reach that date.

## Revenue tab — split out of Edit Budget, like Labor — 2026-09-21

Revenue editing moved off the Edit Budget page onto its own top-level tab,
[`app/pages/budget/revenue.vue`](app/pages/budget/revenue.vue) (route
`/budget/revenue`, nav label "Revenue") — the same move the Labor tab made
2026-09-18, for the same reason: revenue projection is its own distinct
modeling task (now including the Capacity-covers feed below), not just
another category row in a whole-budget editor.

- **Scope is current month + remaining future months only, not
  Jan-Dec + Total** — confirmed directly with the user before building,
  since a past/closed month's revenue is already final and shown read-only
  on the Edit Budget page (unaffected by this change — a closed month's
  Budget/Actual comparison there already covered every category,
  read-only, before this). This is the same `asOfMonth..Dec` scope the
  Labor tab already uses, just rendered as real per-month tabs
  (`app/pages/budget/revenue.vue`'s `targetMonths`) instead of Labor's
  single-view-with-summary-cards approach — the user explicitly asked for
  tabs. No Annual Total tab either, for the same reason: a partial-year sum
  of only the forward months would be a confusing thing to label "Total."
- **Edit Budget's Revenue section is now read-only**, gated simply on
  `acc.category === 'revenue'` (no new settings table needed, unlike
  Labor's `labor_position_settings`-backed `laborManaged` flag — every
  revenue account moved together, so there's no per-account subset to
  track). Each row links to the Revenue tab
  (`<NuxtLink to="/budget/revenue">Edit on Revenue tab</NuxtLink>`), same
  pattern as the existing "Edit on Labor tab" link. `budget_targets` stays
  the single shared table either page writes to — the COGS trailing-average
  recompute on Edit Budget (`groupRevenueBudget`) is unaffected, since it
  just reads whatever revenue figure is currently stored regardless of
  which page saved it.
- **How Capacity's per-area expected-covers feed into this page — asked the
  user directly rather than guessing, since there were three real options**:
  duplicate the Capacity tab's per-area covers grid onto this page for live
  editing, make revenue always-derived (no manual override), or keep the
  existing one-click "Recompute Revenue from Capacity" sync (Food/Beverage
  $ from `capacity_area_seasonality`'s covers × per-cover assumptions,
  weighted by the real Beer/Liquor/Wine/Non-Alcoholic mix — see the Budget
  tab's "Capacity revenue feeds the Budget tab" section above) just
  relocated. The user chose the third — smallest change, and
  `capacity_area_seasonality` stays edited in exactly one place (the Edit
  Capacity page), never two. The banner (capacityMonths/
  beverageRevenueMix/recomputeRevenueFromCapacity, moved verbatim from
  Edit Budget) now sits prominently near the top of the page rather than
  buried as a footnote row in a shared multi-category table, since it's a
  primary feature here, not an aside.
- **"Fill in missing accounts from last month" is scoped to revenue account
  ids** (`copy-into-month.post.ts`'s existing `accountIds` filter, already
  built for this exact purpose) — critical, not cosmetic: without it this
  action would also copy last month's COGS/Labor/Opex figures into the
  current month, categories this page never renders an input for and must
  never touch.
- **A real correctness risk avoided by design, not caught after the
  fact**: every computation on this page (`directChildren`,
  `isLeafAccount`, `changedTargets`, etc.) is built off a `revenueAccounts`
  computed that filters `/api/budget/targets`' response (which returns
  every category, unfiltered) down to `category === 'revenue'` immediately
  — never off the raw response directly. `changedTargets` in particular
  only ever iterates this filtered list, so it can never mistake an
  other-category account with no rendered input (and thus no
  `editableAccountAmounts` entry) for one that was "changed to $0" on Save.
- Verified in the browser end-to-end: real Sep-Dec revenue accounts render
  with correct parent/child sums; "Recompute Sep Revenue from Capacity"
  wrote real Food $202,422/Beverage $91,716 (matching the Capacity tab's
  own numbers) and the total updated correctly; switching to Oct showed a
  Budget-only column (no Actual/Projected, since a future month has no
  actuals) and its own distinct Capacity projection; Edit Budget's Revenue
  section reflected the same recomputed figures read-only with working
  "Edit on Revenue tab" links.

## Revenue tab: read-only Year Total, and an alignment fix — 2026-09-22

Two follow-ups from a real production screenshot, same day the Revenue tab
was deployed:

- **A right-alignment bug, real in production even though it never
  reproduced in local testing.** A future month's table has only one data
  column ("Budget"), which renders far wider under table auto-layout than
  the 120px `.amount-input` box — and the plain `<input>` wasn't reliably
  honoring the parent `<td>`'s `text-align: right` at that width the same
  way the read-only `.amount-input.readonly` `<span>` did, visible as
  editable inputs sitting flush left of a wide empty column while the bold
  parent totals sat flush right. Fixed by wrapping each cell's content in
  its own `.amount-cell` flex container (`display: flex; justify-content:
  flex-end`) that fills the `<td>` and positions its child regardless of
  the input-vs-span quirk — the same fix pattern this file already
  documents for the Edit Capacity page's two adjacent money-cell columns
  (see "Capacity revenue feeds the Budget tab" above), applied to a `<span>`
  wrapper rather than the `<td>` itself so the Budget/Actual/Projected
  columns (which sit adjacent for the current month) never fold into one
  anonymous cell the way two adjacent flex-`<td>`s did there.
- **A read-only "Total" tab**, at the user's request, showing where each
  revenue account is projected to land for the full year — real YTD actual
  (Jan through the last closed month, from `daily_line_items`, falling back
  to that month's budget if a closed month hasn't synced yet — same hybrid
  fallback `hybridMonthlyCategoryTargets` already uses at the category
  level, just per-account here) plus the current month's actual-to-date
  extrapolated to a full month (the same projection this page's own
  current-month "Projected" column already computes) plus every future
  month's own budget. `yearAccountTotal`/`yearComputedAccountAmount` in
  `app/pages/budget/revenue.vue` substitute this page's own in-progress
  (unsaved) draft for whichever single month is currently open in the
  editor, so an unsaved edit shows up in the Total tab immediately, same as
  the Live Preview card's own live-draft substitution. Fetches
  actuals-by-account for every month Jan..asOfMonth once on mount,
  independent of which month tab is selected (unlike
  `selectedMonthAccountActuals`, which is scoped to the currently-edited
  month and clears when you switch away from it) — reuses the existing
  `/api/budget/actuals-by-account` endpoint per month rather than adding a
  new bulk route, same "12 parallel per-month fetches" pattern
  `useBudgetYear()` already uses for `budget_targets`. No Fed-from-Capacity
  banner, Fill-in-missing/Save actions, or Live Preview card on this tab —
  there's no single month here to act on, matching how Edit Budget's own
  Annual Total tab hides its equivalent COGS-recompute banner and
  Fill-in/Save row.
- Verified in the browser: Total tab renders the full account tree
  read-only with correct parent/child sums (e.g. Total Revenue $2,228,633
  reconciling against Restaurant Sales + Event Sales + Catering − Contra-
  Income), and switching back to a month tab (Sep) correctly restores the
  Live Preview card, Capacity banner, and Fill-in/Save actions with Total
  deselected.

## Where to look

- [`schema.sql`](schema.sql) — data model
- [`design/dashboard-mockup.html`](design/dashboard-mockup.html) — approved static mockup (reference only)
- [`design/pl-mockup.html`](design/pl-mockup.html) — tentatively approved P&L tab mockup (reference only)
- [`app/pages/index.vue`](app/pages/index.vue) — the real Dashboard page ("Weekly Performance"), incl. the This Week's Targets section and its inline weekly-goal edit form
- [`server/api/dashboard.get.ts`](server/api/dashboard.get.ts) — Dashboard data route, incl. the weekday-target/suggested-weekly-goal computation
- [`server/api/dashboard/weekly-benchmark.post.ts`](server/api/dashboard/weekly-benchmark.post.ts) — updates the editable `weekly_revenue_benchmark` goal
- [`server/utils/core-revenue.ts`](server/utils/core-revenue.ts) — shared core-dine-in-revenue account list + open-day covers threshold, used by the Dashboard and `capacity/history.get.ts`
- [`server/utils/weekly-targets.ts`](server/utils/weekly-targets.ts) — shared day-specific revenue/covers goal computation (weekday share × `weekly_revenue_benchmark`), used by the Dashboard's This Week's Targets and the Revenue Calendar page
- [`app/pages/pl/index.vue`](app/pages/pl/index.vue) — the real P&L page (route `/pl`)
- [`app/pages/pl/revenue-calendar.vue`](app/pages/pl/revenue-calendar.vue) — Revenue Calendar: each operating day vs. that weekday's own revenue goal, by Month/Year (route `/pl/revenue-calendar`; split off the old P&L Drill-Downs page 2026-08-20 — see "Budget Pace / Drill-Downs consolidation" above)
- [`server/api/pl.get.ts`](server/api/pl.get.ts) — data route shared by both P&L pages above and the Revenue Calendar page
- [`app/pages/budget/index.vue`](app/pages/budget/index.vue) — Budget Pace + Overspending, incl. the expandable Labor/Opex subcategory "why" breakdown and its Materiality Threshold form (route `/budget`)
- [`server/api/budget/overspending-detail.get.ts`](server/api/budget/overspending-detail.get.ts) — Labor/Opex subcategory breakdown behind Budget Pace's Overspending expand (moved from the old P&L Drill-Downs page 2026-08-20)
- [`server/api/budget/drilldown-thresholds.post.ts`](server/api/budget/drilldown-thresholds.post.ts) — saves the Materiality Threshold form above
- [`app/pages/budget/edit.vue`](app/pages/budget/edit.vue) — Edit Monthly Budget, incl. the live pace preview (route `/budget/edit`) — Revenue is read-only here (see below)
- [`app/pages/budget/revenue.vue`](app/pages/budget/revenue.vue) — Revenue tab: the real editable revenue projection, incl. the "Recompute from Capacity" sync (route `/budget/revenue`)
- [`app/pages/budget/labor.vue`](app/pages/budget/labor.vue) — Labor tab: rates/hours/salaries modeling (route `/budget/labor`)
- [`app/pages/reservations.vue`](app/pages/reservations.vue) / [`server/utils/opentable-import.mjs`](server/utils/opentable-import.mjs) — OpenTable CSV upload and importer (route `/reservations`; see "OpenTable reservation importer")
- [`app/utils/yearOutlook.ts`](app/utils/yearOutlook.ts) — year-end scenarios (budget / recent pace / pace with night-by-night revenue) shown on Cash Flow (see "Year-end outlook on the Cash Flow tab")
- [`server/api/revenue-projection.get.ts`](server/api/revenue-projection.get.ts) / [`server/utils/special-nights.ts`](server/utils/special-nights.ts) — night-by-night current-month projection; dated special nights and holiday closures, and the one rule for how they replace a normal night (see "Named holiday closures")
- [`server/api/booking-pace.get.ts`](server/api/booking-pace.get.ts) — Next 7 Nights booking pace on the Dashboard (see "Booking pace: next 7 nights")
- [`app/components/BohHoursReport.vue`](app/components/BohHoursReport.vue) / [`server/utils/boh-hours-report.ts`](server/utils/boh-hours-report.ts) — BOH hours-by-week report on the Kitchen Labor tab, plus its downloadable HTML (see "BOH hours report on the Kitchen Labor tab")
- [`app/pages/kitchen-week.vue`](app/pages/kitchen-week.vue) / [`server/api/kitchen-week.get.ts`](server/api/kitchen-week.get.ts) — covers-only This Week for the Sous Chef role (route `/kitchen-week`; see "Kitchen This Week")
- [`app/pages/staff-hours.vue`](app/pages/staff-hours.vue) / [`server/api/staff-hours.get.ts`](server/api/staff-hours.get.ts) — Staff Hours: avg hrs/week per employee over 90 days, full-time (30+) vs. part-time (route `/staff-hours`; see "Staff Hours report" above)
- [`server/utils/toast-employee-hours.ts`](server/utils/toast-employee-hours.ts) / [`scripts/backfill-toast-employee-hours.mjs`](scripts/backfill-toast-employee-hours.mjs) — per-employee hours + names from Toast's Labor API
- [`app/pages/cashflow.vue`](app/pages/cashflow.vue) — Cash Flow tab: Free Cash Flow, P&L vs. Cash Flow view, debt service calendar, reserve savings plan (route `/cashflow`)
- [`server/api/cashflow.get.ts`](server/api/cashflow.get.ts) — Cash Flow tab's data route
- [`server/api/cashflow/reserve-transfer.post.ts`](server/api/cashflow/reserve-transfer.post.ts) — records a real reserve transfer (or reversal)
- [`server/api/cashflow/reserve-plan.post.ts`](server/api/cashflow/reserve-plan.post.ts) — declares the current weekly reserve-transfer plan
- [`scripts/import-debt-schedule.mjs`](scripts/import-debt-schedule.mjs) — one-time seed of `loan_schedule` from the debt amortization workbooks
- [`app/composables/useBudgetData.ts`](app/composables/useBudgetData.ts) — types/constants/fetch shared by both budget pages
- [`app/layouts/default.vue`](app/layouts/default.vue) / [`app/utils/navigation.ts`](app/utils/navigation.ts) — section nav, sub-tabs and phone bottom bar
- [`app/pages/settings.vue`](app/pages/settings.vue) — Settings: connections, reservation upload, database update status, where other settings live
- [`scripts/migrate.mjs`](scripts/migrate.mjs) / [`scripts/migrations/`](scripts/migrations/) — schema migrations, applied automatically on start
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
- [`app/pages/capacity/index.vue`](app/pages/capacity/index.vue) — Capacity Pace view (route `/capacity`) and the Capacity edit tab (automatic/pinned forecast)
- [`server/utils/capacity-forecast.ts`](server/utils/capacity-forecast.ts) / [`server/utils/capacity-history.ts`](server/utils/capacity-history.ts) — automatic capacity forecast and the history it uses (see "Automatic capacity forecast with pins")
- [`server/utils/budget-forecast.ts`](server/utils/budget-forecast.ts) / [`server/utils/capacity-model.ts`](server/utils/capacity-model.ts) — automatic budget lines for months not yet started, and the shared Capacity projection (see "Automatic budget lines")
- [`app/components/BreakevenCard.vue`](app/components/BreakevenCard.vue) / [`server/api/breakeven.get.ts`](server/api/breakeven.get.ts) — breakeven covers/night card on Capacity Pace (see "Breakeven covers/night" above)
- [`app/pages/capacity/edit.vue`](app/pages/capacity/edit.vue) — editable capacity/turns/per-cover-revenue + monthly fill %/holiday closures (route `/capacity/edit`)
- [`server/api/capacity.get.ts`](server/api/capacity.get.ts) — Capacity tab's projection-vs-actual data route
- [`server/api/capacity/settings.get.ts`](server/api/capacity/settings.get.ts) / [`settings.post.ts`](server/api/capacity/settings.post.ts) — load/save capacity assumptions
- [`scripts/import-capacity-projections.mjs`](scripts/import-capacity-projections.mjs) — one-time seed of `capacity_areas`/`capacity_seasonality` from the real capacity worksheet
- [`scripts/migrate-capacity-revenue-split.mjs`](scripts/migrate-capacity-revenue-split.mjs) — one-time migration splitting `capacity_areas.per_cover_revenue` into Food/Beverage
- [`app/pages/historical.vue`](app/pages/historical.vue) — Historical tab: covers + spend-per-cover seasonality charts (route `/historical`)
- [`server/api/capacity/history.get.ts`](server/api/capacity/history.get.ts) — covers + spend-per-cover seasonality indexes, derived from real Toast covers and core-revenue QBO history, backing both "Set by History" and the Historical tab's two charts
- [`app/components/SeasonalityChart.vue`](app/components/SeasonalityChart.vue) — the monthly grouped-bar seasonality chart used twice on the Historical tab (covers, spend-per-cover)
- [`scripts/backfill-toast-metrics.mjs`](scripts/backfill-toast-metrics.mjs) — one-time historical Toast covers/labor-hours backfill (see "Toast POS integration" above); re-run with an extended `--since` 2026-08-12 to reach back through the Mass Ave era for the Historical tab's two indexes
- [`app/pages/budget/revenue.vue`](app/pages/budget/revenue.vue)'s "Recompute Revenue from Capacity" section (moved here 2026-09-21 — see "Revenue tab" below) — feeds Capacity's projected Food/Beverage revenue into the real revenue accounts
- [`server/api/budget/beverage-revenue-mix.get.ts`](server/api/budget/beverage-revenue-mix.get.ts) — real Beer/Liquor/Wine/Non-Alcoholic revenue split since the location move, used by the Recompute Revenue action above
- [`app/pages/nightly-margin.vue`](app/pages/nightly-margin.vue) — Nightly Margin: each operating night's estimated fully-loaded profit, with a distinct darkest-red/⚠ flag for a night that didn't even cover variable labor + COGS (route `/nightly-margin`)
- [`server/api/nightly-margin.get.ts`](server/api/nightly-margin.get.ts) — Nightly Margin's data route (trailing hourly-labor rate, COGS%, and fixed-labor-per-night, applied per day)

## 2026-11-11 — Dynamic budgeting step 3: forecast snapshots and accuracy report (built)

Built from the spec that was in CLAUDE.md. Files: `scripts/migrations/0017-forecast-snapshots.mjs` + `schema.sql`;
`server/utils/forecast-snapshots.ts` (writer); `server/utils/revenue-projection.ts` (moved from the route);
`server/api/forecast/snapshot.post.ts`, `server/api/forecast/accuracy.get.ts`; `app/pages/forecast-accuracy.vue`;
nav entry in `app/utils/navigation.ts`; snapshot hook in `qbo-sync-runner.ts`; assumed-figure override in
`server/api/capacity.get.ts`. No forecast-math file was changed.

Decisions made while building (not in the spec):
- Each snapshot covers current month + 12 ahead, so a target month appears in ~13 month_start snapshots. A month's
  frozen plan is the month_start dated its own 1st (used by Covers & Spend and the report's "Month-start plan"
  bucket); earlier month_start rows are bucketed by lead time like weekly ones. First version mixed them up and
  both the report and Covers & Spend picked April's snapshot for later months; caught in testing.
- Weekly snapshots fire on the first sync in a calendar week (dated that Monday), so a missed Monday sync
  doesn't lose the week. `live` core_sales is skipped when the projection has missingHistory > 0.
- Report lead buckets (weekly plan snapshots, weeks to the 1st): 1 wk = 0–2, 4 wks = 3–5, 8 wks = 6–10, 11+;
  month_start; live. The per-month table shows the snapshot nearest each target. Error = (forecast − actual) ÷ |actual|
  (abs so a negative actual keeps its direction). Chips: ✓ ≤5%, ▲ ≤15%, ⚠ beyond.
- Covers & Spend: only assumed covers, max covers, capacity sales (and fill %, avg check) come from the snapshot;
  the food/beverage split fields and per-area breakdown still come from the model.

Verification (local DB backed up first and restored afterward; migration also applied only to the scratch run):
- `revenue-projection` JSON for 2026-10/11/12 byte-identical before/after the move (`cmp`); bad month still 400.
- POST route: two dates, second call wrote 0 rows (idempotent); 144 rows per kind (13 months × 11 metrics + live).
- Accuracy: backdated snapshots (Apr–Jun 2026) against real June actuals; hand-checked from sqlite: sales
  $89,223, net income −$1,735, covers 1,008, plan net −$25,001 → error −13.41 (−1341%) as the API reported. Pre-opening
  months show huge covers/live errors because local forecasts use today's Cambridge St assumptions; test artifact only.
- Typecheck 300 errors before and after (302 mid-way until an `asOfDate` cast in capacity.get.ts).
- Page checked as server-rendered HTML (200, summary and monthly tables, chips with icons); not screenshotted because the
  Basic Auth URL could not be opened in the browser pane from this session.

## 2026-11-12 — Forecast snapshots confirmed in production

The first production sync after the step 3 deploy (2026-11-12 13:00 UTC) logged
`forecast snapshots: weekly 2026-11-09 (144 rows), month_start 2026-11-01 (144 rows)`. That is 13 months ×
11 plan metrics + 1 live row for the current month. The same run logged `budget forecast: 130 automatic
budget lines changed (2026-12–2027-12)`, which is every managed line (10 accounts × 13 months), as expected
when new synced data shifts the sales mix and cost %. The first snapshots are dated Nov 9 (weekly) and Nov 1
(month start, taken on Nov 12, so November's "frozen plan" record reflects the budget as of Nov 12).
Forecast Accuracy will show results once November closes and fully syncs. The open item was removed from
CLAUDE.md.

## Special nights: separate event revenue and dine-in fields — 2026-11-12

Kit found the Special Nights table confusing: Wild Things (Nov 17) showed $2,000, but that was dine-in only; its
$6,500 of tickets lived only in a hand-typed Event Sales budget, so the section looked wrong. Redesigned:
- `special_nights.event_revenue` added (migration 0018 rebuilds the table to also allow kind `catering`). The
  Sales Plan form has "Event revenue $" and "Regular dine-in $" fields (each enabled per type) with a hint of the
  chosen weekday's normal night; the table has both columns; the night-by-night table shows "+ $X event revenue".
- `server/utils/budget-forecast.ts` (`specialNightAdditions`, `EVENT_ACCOUNTS`): months after the current one get
  event revenue in 4150/4145 (on-site), 4180/4175 (off-site), 4230/4210 (catering) split by `salesMix().foodShare`,
  and replaced nights' dine-in is added back to 4010/beverage (before, an event night's dine-in was dropped from
  the budget). Cost % uses the new event food amounts (pinned rows count at their own amount).
- Catering nights are not "replaced" nights (`loadReplacedNights`) and project as normal nights.
- Dashboard/kitchen-week chips handle `catering`. Staffing spec renumbered to migration 0019.
- Verified locally (migration applied, test event night wrote $6,500 split to 4150/4145, removed afterwards,
  form hint renders). Not yet deployed; production Nov 17 needs re-entry by Kit.
- Same day, follow-ups from Kit: the night-by-night table is its own "Night by Night" card below Special Nights
  (it covers every remaining night); its column is "OpenTable bookings"; "Closed" can no longer be added as a special
  night (closures and holidays live in Settings; existing closed rows still display and can be removed).

## Buyout Revenue card and undated buyout counts removed — 2026-11-12

Kit introduced undated per-weekday buyout counts to see how much 2027 revenue could cover payroll (seeded 2 a month
for 2027 by `scripts/seed-2027-buyouts.mjs`), but with dated buyouts in Special Nights the card was a second, confusing
way to enter the same thing. Removed: the Sales Plan's Buyout Revenue card, `POST /api/budget/buyout-plan`, the
seed script, the "retire the undated count" option on adding a dated buyout, and the undated term in
`plannedBuyoutIncrement` (budget now counts dated buyouts only). The guaranteed-minimum rates editor moved into the
Special Nights card (prefills a buyout's price). `GET /api/budget/buyout-plan` now returns only rates and weekday
normal nights. What-If's "already booked" now reads dated buyouts (`buyoutBookedRevenueByDow`) instead of the old
counts; hypothetical buyouts are its stepper. Tables `revenue_buyout_plan` / `revenue_buyout_applied` are kept but unused.
Effect: the 2027 budget loses the hoped-for buyout revenue (the Jan 2027 example was +$6,442) at the next refresh.

## 2026-11-12 — Weekly covers/night trend moved from What-If to Covers & Spend

Kit asked whether the trend charts belonged on What-If. Decision: the read-only "Weekly Covers/Night Trend, By Area"
(sparklines, 4-week change, fill %) describes actuals, so it moved to the Covers & Spend pace tab (between "Are We
Meeting Our Assumptions?" and Breakeven). "Trailing 3-Month Averages, By Area" stays on What-If: it is the simulation's
baseline with the editable deltas. Server: the trend query moved from `revenue-modeling.get.ts` to the new
`server/api/capacity/area-trends.get.ts` (under `/api/capacity`, so the GM role can load it); the What-If route no
longer returns `areaTrends`. Sparkline code and CSS moved with it. Windows were left alone (What-If: trailing 3 months;
Covers & Spend: last two closed months). Typecheck 302 before and after.

## 2026-11-12 — Dynamic budgeting step 4: Staffing Plan hours follow Toast (built, not deployed)

Spec: `docs/specs/staffing-auto-hours.md`. Decisions made with Kit before building override the spec:
- **6-week window, not 3.** Why: with 3 weeks one odd week (a vacation, a big event) moves a person's mean by a
  third; 6 weeks halves that, and the covers ratio uses the same window so length doesn't bias it. Single constant
  `AUTO_HOURS_WINDOW_WEEKS` (`server/utils/labor-hours.ts`). Reach back at most 10 weeks (`AUTO_HOURS_MAX_LOOKBACK_WEEKS`),
  need ≥ 3 usable weeks (`AUTO_HOURS_MIN_USABLE_WEEKS`) or nothing is computed and current values stay. Skipped weeks:
  holiday closure, < 5 open nights (≥ 15 covers), or no job hours synced at all (added: otherwise a week before the
  hours backfill reads as everyone on vacation). `auto_hours_basis` stores weeks, hours, which weeks counted, mean,
  median and flags; the page flags a mean/median gap of 2+ hrs ("one week is off").
- **Direct roles scale with forecast covers.** ratio = (forecast covers per open night for the month, from
  `createCapacityModel().dayByDaySum` expectedCovers ÷ operatingDays) ÷ (actual covers per open night over the same
  usable weeks), clamped 1 ± `SEASONALITY_CAP_PCT`. Replaces last year's `monthlyIndex` in the Staffing Plan and in
  "Build next year's budget" (`BuildNextYearBudget.vue`); `labor-settings.get` returns `coversRatioByMonth` (this and
  next year). If job-hours weeks are too few, the ratio falls back to the same rule on `daily_toast_metrics` alone.
  Migration 0019 set `scales_with_seasonality = 0` for hourly/OT roles whose class isn't direct (locally only the Sous
  Chef; production may differ, the migration logs each). The page's checkbox ("Scale direct roles with forecast
  covers") only touches direct roles.
- **Pieces.** Migration `0019-staffing-auto-hours.mjs` + `schema.sql` (tables/columns as in the spec; first run copies
  future-month labor budget lines to `budget_targets_labor_pre_auto`). `shared/utils/labor-model.ts` holds the model
  plus `countFridays`/`fridaysInMonth` (re-exported from `app/utils/laborModel.ts` and `useBudgetData.ts`; modeled totals
  for 888 account-month values in 2026 and 2027 were byte-identical before and after the move). `labor-accounts.ts`
  (shared loader), `labor-hours.ts` (`computeAutoHours`, unplanned hours per account for roles with ≥ 1 linked person),
  `labor-forecast.ts` (`refreshLaborForecast`, `coversRatios`), wired into `refreshForecasts()` after the budget
  refresh in its own try/catch (the nightly log line is "labor forecast: …"). Routes: `GET/POST /api/budget/labor-mapping`
  (jobs + employees with suggestions; POST saves job → role), `labor-settings.get/post` extended. Owner-only by default
  deny, nothing added to `access.ts`. `targets.get` marks every Staffing Plan account `autoManaged` for future months, so
  a pinned labor line shows ↺ on the Budget page (labor lines are read-only there, so a pin only arrives via the API).
- **Slot renumbering wrinkle.** `labor-settings.post` receives the full slot list per account and upserts by
  (account, slot_index), so the page sends `toastEmployeeGuid` and `hoursPinned` with every slot, and the server clears
  a slot's stored auto hours whenever the guid at that index changes (the refresh then recomputes). Verified by removing a
  person: the person after them kept their link and got their own average.
- **Verification (local, synthetic Toast hours for 7 weeks in a backed-up DB, restored afterwards).** Two roles mapped,
  holiday on 2026-10-22: that week skipped and the window reached back to 6 usable weeks. Alice 30/32/34/30/32/32 → 31.5
  (mean 31.67, median 32); Bob with a zero week → 21.0 and "vacation?"; Cara starting mid-week → averaged from her first
  full week, 29, "new hire"; Eve's auto clock-out flagged; unplanned Dan 10 hrs/wk; BOH OT 9 ÷ 6 = 1.5, FOH OT 0.25 → 0.5.
  Covers: December 2026 forecast 121.67/night (5 Tuesdays at 115 with Chef's Counter dark, 22 other nights at 123.19) ÷
  actual 117.67 = 1.0341; Line Cook December = (880+500+285) × 1.0341 × 4 Fridays = $6,886.78 and January 2027 capped at
  0.85 (raw 0.629) × 5 Fridays = $7,076.25, both exactly what was written. The page's client-side pricing (from the API
  response) matched the refresh for all 481 labor lines Dec 2026–Dec 2027. A line pinned via `POST /api/budget/targets`
  survived a refresh (auto_amount kept) and unpinning restored it. With only 2 usable weeks nothing changed. Migration run
  twice on a copy: second run a no-op. Typecheck 302 before and after. The Staffing Plan and Settings pages were NOT
  looked at in a browser (local dev is behind Basic Auth); Settings was checked as server-rendered HTML and both pages
  compile and return 200.
- **What changes on deploy.** Every slot/OT row starts pinned, so hours don't move. But the first refresh rewrites every
  unpinned future labor line from the Staffing Plan inputs with the new covers scaling, so lines differ from the old index
  scaling (and a hand-edited Budget-page value that was never pinned would be replaced). Compare against
  `budget_targets_labor_pre_auto` after the first run. Staffing Plan Save still overwrites a pinned labor line's amount
  (it never sent `pinned`), as before.
