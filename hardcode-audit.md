# Hardcode audit — what's Urban-Hearth-specific in restaurant-pulse

**Date:** 2026-10-22. **Purpose:** inventory every assumption in the code that
would break (or silently mislead) for a second restaurant, so the productization
work (see [`product-strategy-notes.md`](product-strategy-notes.md)) starts from a
real list. This is the seed of the onboarding spec: each **Setting** and
**Inferable** row is a question the onboarding flow has to answer.

Read-only audit: grep of `server/`, `app/`, `scripts/`, `schema.sql`,
`nuxt.config.ts`, `fly.toml`. Nothing was changed. Line numbers are as of this
commit and will drift.

## Legend

| Class | Meaning |
|---|---|
| **Setting** | Legitimately per-restaurant. Move to a tenant settings table + a UI to edit it. |
| **Inferable** | Can be derived from the restaurant's own data (QBO chart of accounts, POS history). Compute a default, let the owner confirm. |
| **UH-only** | Specific to Urban Hearth's situation. Remove from the core; keep as an optional module or drop. |
| **Platform** | A global default or an integration fact. Fine as a constant (maybe overridable). |

**Effort:** L = under a day, M = a few days, H = real design work.

## Headline findings

1. **The code is keyed to QBO `account_number`, not a stable internal role.**
   24 files reference `account_number`; 10 server/app files contain literal
   4-digit account strings ('4010', '6010', '7020', ...). QBO makes `AcctNum`
   optional (Intuit's own sandbox company had none), and most small restaurants
   don't enable it. Fix: give `accounts` explicit role columns
   (`revenue_stream`, `labor_group`, `is_core_dine_in`, ...) populated at
   onboarding, and make every query use those instead of number literals.
   This is the single biggest generalization task (rows 20-24).
2. **"Dinner-only, closed Mondays, ~90 covers a night" is baked into the
   filters.** The 5pm cutoff, `MIN_COVERS_FOR_OPEN_DAY = 15`, and the Monday
   checks are each calibrated to this one restaurant. For a lunch spot or a
   40-seat bistro they would silently drop real days (rows 8, 33, 34).
3. **Many settings already exist as tables, but as singletons.** Six tables use
   `CHECK (id = 1)` (`qbo_tokens`, `reserve_plan`, `weekly_revenue_benchmark`,
   `buyout_rates`, `drilldown_thresholds`, `labor_tax_rates`). Multi-tenancy is
   mostly adding `org_id`, not redesigning them.
4. **The same constant is duplicated in many files**, so making it a setting
   also deletes code: time zone x7, Monday-closure check x10,
   `CORE_REVENUE_ACCOUNT_NUMBERS` x2 (server + `revenue.vue`),
   `NEW_LOCATION_START` x2 (`weekly-targets.ts`, `beverage-revenue-mix.ts`).
5. **A large, self-contained slice is UH-only** (Cash Flow tab: loans,
   reserve, DSCR covenant; buyout planner; pre-opening reclasses; `cashflow.get.ts`
   alone is 714 lines). It is not the wedge. Plan it as an optional "Capital"
   module, not core.

## A. Tenancy, identity, deployment

| # | What | Where | Class | Effort | Notes |
|---|---|---|---|---|---|
| 1 | One SQLite file, opened with no tenant context | `server/utils/db.ts:6` | Platform | H | Needs a per-request tenant-scoped connection (Postgres + `org_id`, or one DB per tenant). Everything calls `useDb()`. |
| 2 | Singleton config tables (`CHECK (id = 1)`) | `schema.sql` lines ~113, 370, 389, 404, 471, 562 | Setting | M | Add `org_id` as the key. |
| 3 | Restaurant name | `site.restaurantName` in `app/layouts/default.vue:8` and page titles | Setting | L | Per-org. |
| 4 | Privacy / Terms say "built for the owners of Urban Hearth, not offered to others" | `app/pages/privacy.vue:8`, `terms.vue:8` | UH-only | M | Needs real legal text for a product. |
| 5 | Auth: shared Basic Auth + Cloudflare Access on `pulse.urbanhearth.net` | `server/middleware/auth.ts`, `nuxt.config.ts` | Platform | H | Replace with real accounts, roles, per-org sessions. |
| 6 | QBO tokens: one row, one `realm_id`; client id/secret in env | `schema.sql:112`, `server/utils/qbo.ts`, `nuxt.config.ts` | Platform | H | App credentials stay global; tokens per org, encrypted at rest. |
| 7 | Toast credentials + one `restaurantGuid` in env | `nuxt.config.ts` (`toast`) | Setting | M | Per-org secrets. See open question on Toast partner approval in the strategy notes. |
| 8 | Nightly sync via `setInterval` in-process, one timezone/hour from env | `server/plugins/qbo-nightly-sync.ts`, `nuxt.config.ts:37` | Platform | H | Needs a job queue / scheduler, per-org schedule. |
| 9 | Single Fly app, one volume, `sjc` region | `fly.toml` | Platform | M | Deployment topology decision (tied to row 1). |
| 10 | Repo contains real financial material: `reports/`, `scripts/covenant-report/`, `scripts/oneoff-*`, `CLAUDE.md` history, a plaintext login in `.claude/settings.local.json` | repo | UH-only | L | **Do not copy into a new repo.** Start clean; rotate that login. |

## B. Calendar and time

| # | What | Where | Class | Effort | Notes |
|---|---|---|---|---|---|
| 11 | `America/New_York` hardcoded in 7 places | `toast-metrics-sync.ts:78`, `breakeven.get.ts:24`, `overspending-detail.get.ts:91`, `cashflow.get.ts:537`, `labor-settings.get.ts:58`, `backfill-toast-metrics.mjs:64`, `nuxt.config.ts:37` | Setting | L | One `org.timezone`; pass it in. Inferable from the Toast location. |
| 12 | **Closed Mondays** (`getUTCDay() !== 1`) in ~10 places; `WEEKDAYS` list is Tue-Sun; week starts Monday | `weekly-targets.ts:20,80`, `dashboard.get.ts:39,259`, `capacity.get.ts:41`, `revenue-modeling.get.ts:60`, `breakeven.get.ts:41,116`, `overspending-detail.get.ts:57`, `buyout-plan.post.ts:15`, `capacity/index.vue:376`, `revenue.vue:190` | Setting + Inferable | M | Store `operating_days`; also detect from the last 8-12 weeks of covers/revenue. One shared helper replaces ten copies. |
| 13 | **Payroll is every Friday** (weekly). The whole Labor model counts Fridays per month | `labor-settings.get.ts:31`, `useBudgetData.ts:47-57`, `edit.vue:372`, `labor.vue` | Setting | M-H | Needs `payroll_frequency` (weekly / biweekly / semi-monthly) and weekday. Biweekly and semi-monthly change the month math, not just a constant. |
| 14 | `YEAR = 2026` constant (87 uses in `app/`); fiscal year = calendar year | `useBudgetData.ts:25` | Inferable | M | Derive from today; add `fiscal_year_start_month`. |
| 15 | "Unbudgeted" months hardcoded: year 2026, months 1-6 | `overspending-detail.get.ts:50-51` | UH-only | L | Infer: months with no `budget_targets` rows. |
| 16 | Holiday closures as a flat monthly count (2 Jan, 1 Jul, 1 Nov, 2 Dec) | seeded in `import-capacity-projections.mjs:79`; `capacity_seasonality` | Setting | L | Already a table; seed is UH-only. |
| 17 | Cash-basis accounting for the P&L pull | `qbo-pl-sync.ts`, `backfill-qbo-pl.mjs` (`accounting_method=Cash`) | Setting | L | `org.accounting_method`. |

## C. Location history and analysis baselines

| # | What | Where | Class | Effort | Notes |
|---|---|---|---|---|---|
| 18 | `NEW_LOCATION_START = '2026-06-20'`: "trust data only from here" | `weekly-targets.ts:18`; used in `food-beverage-mix.ts`, `pl.get.ts:126`, `dashboard.get.ts`, `nightly-margin.get.ts:64,132`, `revenue-modeling.get.ts:149` | Setting | M | Generalize to "analysis baseline start". Default to trailing N weeks; offer a step-change detector when the owner moved, remodeled, or changed concept. Duplicate: `SINCE_LOCATION_MOVE` in `beverage-revenue-mix.get.ts:20`. |
| 19 | `LOCATION_MOVE_PERIODS` + "Mass Ave vs Cambridge St" baselines in the Historical tab | `capacity/history.get.ts:142-144, 225-234`, `historical.vue` | UH-only | M | Generalize to a list of operating periods, or drop the two-location comparison. Most restaurants just need prior-year vs this-year. |
| 20 | `COGS_BASELINE_START_MONTH = 8` (skip opening stock-up months) | `edit.vue:841` | UH-only | L | Derive from the baseline start (row 18). |

## D. Chart of accounts and classification

| # | What | Where | Class | Effort | Notes |
|---|---|---|---|---|---|
| 21 | **Core dine-in revenue = account numbers** 4000, 4010, 4020, 4022-4028 | `core-revenue.ts:12` (duplicated in `revenue.vue:13`) | Setting | H | Used by Dashboard targets, Revenue Calendar, Capacity, Breakeven, Historical. Replace with `accounts.revenue_stream` (`dine_in` / `event` / `catering` / `retail` / `other`), suggested at onboarding. |
| 22 | Event revenue = account numbers 4100-4199 | `core-revenue.ts:18` | Setting | M | Same column as row 21. |
| 23 | Labor sub-group parents: 6010 BOH, 6030 FOH, 6050 Management, 6060 Benefits, 6080 Taxes | `labor-settings.get.ts:17`, `qbo-account-sync.ts:105`, `seed-labor-position-settings.mjs:84-88`, `add-labor-role-class.mjs:37-39` | Setting | H | The Labor tab assumes this exact hierarchy. Needs a mapping step ("which of your labor accounts are hourly kitchen / hourly floor / salaried / benefits / taxes") with sensible suggestions from account names. |
| 24 | Category heuristics: fixed opex = names 'occupancy costs' / 'insurance' / 'interest & financing'; COGS split by keywords food/beer/liquor/wine/beverage; labor = top-level account named "Labor" | `qbo-account-sync.ts:20-30` (duplicated in `import-budget-xlsx.mjs:55`) | Inferable | H | Keep as *suggestions* in an onboarding review screen, never silent. This is the core of the 10-minute-onboarding promise. |
| 25 | Massachusetts payroll taxes: `medicare`, `social_security`, `futa`, `suta_ma`, `pfml_ma` columns | `labor_tax_rates` schema, `seed-labor-position-settings.mjs:88` | Setting | M | Make tax lines a list (name, rate, wage cap, applies-to-tips) instead of five fixed columns; state templates. |
| 26 | Owner-compensation flag set by hand via SQL; role-class assignments by account number | `accounts.is_owner_compensation`, `add-labor-role-class.mjs` | Setting | L | Needs a UI toggle (already on the "Not yet done" list). |
| 27 | Beverage sub-groups Beer / Liquor / Wine / Non-Alcoholic (revenue 4022-4028, COGS 5110-5130) | `edit.vue:922`, `beverage-revenue-mix.get.ts`, `food-beverage-mix.ts` | Inferable | M | Not every restaurant breaks beverages out this way. Derive groups from the account tree. |
| 28 | Export shaped like UH's own QBO budget xlsx; template is `data/qbo-budget-template.xlsx` | `server/api/budget/export.get.ts`, `data/` | UH-only | M | Template must be captured per tenant (from their own QBO export) or generated. |
| 29 | `account_number` as the join key everywhere (24 files) | see headline finding 1 | Platform | H | Key on `qbo_account_id`; treat `account_number` as optional display. |

## E. POS (Toast) and capacity

| # | What | Where | Class | Effort | Notes |
|---|---|---|---|---|---|
| 30 | Toast is the only POS; order `numberOfGuests` (not check-level) is the covers source | `toast-metrics-sync.ts`, `toast.ts` | Platform | H | Needs a POS adapter interface: `getDailyCovers`, `getLaborHours`, `getAreaSales`. Toast quirks stay inside the adapter. |
| 31 | Table to area mapping by name: `B<n>` Bar, `C<n>` Chef's Counter, 1-29 Dining Room, 30-49 Salon, 50-59 Outdoor | `toast-table-map.ts:24`, `backfill-toast-metrics.mjs:72` | Setting | M | UI: list the restaurant's Toast tables, assign each to an area. Pattern rules optional. |
| 32 | Chef's Counter at a flat $190 food per cover; two item names | `toast-metrics-sync.ts:54-55`, `backfill-toast-metrics.mjs:94-95` | UH-only | M | Generalize to "off-POS prepaid experiences" (per-area flat price rule), or drop. |
| 33 | **Dinner only:** orders before 17:00 local are ignored for covers | `toast-metrics-sync.ts:77`, `backfill-toast-metrics.mjs:63` | Setting | L-M | Per-org service window, per-day if needed. Lunch / brunch / all-day restaurants would lose most of their covers today. |
| 34 | **`MIN_COVERS_FOR_OPEN_DAY = 15`** decides which days count as open | `core-revenue.ts:47` | Inferable | M | Tuned to ~90-cover nights. A 40-cover place would be marked mostly closed. Derive from the distribution (e.g. a fraction of the median, or the gap-finding approach used in the original analysis). |
| 35 | Outlier / sanity thresholds: spend band 0.6x-1.4x of median, event night = core under 25% of goal, max 50 guests per order, 56-day window, 3 open days per month index | `core-revenue.ts:24,60-61`, `toast-metrics-sync.ts:94`, `breakeven.get.ts:25`, `history.get.ts:38` | Platform | L | Reasonable defaults; verify against a few other restaurants, expose as advanced settings. |
| 36 | Five dining areas (Dining Room, Bar, Salon, Chef's Counter, Outdoor), Outdoor closed Nov-Apr matched by name `isOutdoor()` | `capacity_areas`, `capacity/edit.vue` | Setting | M | Table-driven already; replace the name match with a per-area seasonal flag; seed screen instead of a CSV import. |
| 37 | Capacity seeded from UH's worksheet CSV and a hand-typed 12-month fill table | `import-capacity-projections.mjs:37,79` | UH-only | L | Replace with an onboarding form. |

## F. Benchmarks and business rules

| # | What | Where | Class | Effort | Notes |
|---|---|---|---|---|---|
| 38 | Benchmarks: COGS 32%, Labor 33%, Prime 65%, Variable opex 6%, with warning/serious/critical bands | `seed-category-benchmarks.mjs:39` | Setting | L | Table exists. Offer defaults by format (full-service, fine dining, casual, counter-service). The domain-judgment layer from the strategy notes lives here. |
| 39 | Weekly "good week" revenue goal, seeded at $50,000 | `weekly_revenue_benchmark` | Setting | L | Suggest from trailing actuals / breakeven. |
| 40 | Owner-comp "both ways" display (Executive Chef, Business Manager) | `index.vue:~195`, `budget/index.vue` | Setting | L | Driven by row 26's flag; fine once that's a UI toggle. |
| 41 | Buyout planner: default weekday $10,000 / weekend $12,000, Tue-Sun only | `buyout-rates.ts:9-10`, `buyout-plan.post.ts:15`, `revenue-modeling.vue` | UH-only | M | Rename to "private events" module with its own settings, or defer. |
| 42 | Cash Flow tab: loans, reserve account (1005), SBA via reserve from 2026-11-01, DSCR covenant (Eastern Bank), pre-opening reclass add-backs (6505, 6752, 6785), loan interest 7020 | `cashflow.get.ts` (714 lines), `cashflow.vue`, `loan_schedule`, `reserve_*` tables, `import-debt-schedule.mjs`, `fix-jones-miller-amortization.mjs` | UH-only | H | Optional "Capital" module. Some of it generalizes (debt schedule, reserve, DSCR for SBA borrowers) but the specifics are one owner's deal. |
| 43 | Revenue Calendar / Margin copy: "that weekday's revenue goal", fixed-labor wording | `pl.get.ts:32`, `revenue-calendar.vue:252` | Platform | L | Fine; revisit under the voice guide. |
| 44 | Prior-year comparison breaks on a relocation (Drill-down / Historical caveat noted in CLAUDE.md) | `history.get.ts` | UH-only | M | Falls out of row 19. |

## G. Copy and UI

| # | What | Where | Class | Effort | Notes |
|---|---|---|---|---|---|
| 45 | 12 top-level nav links, labeled for UH's own build history ("Budget" vs "Budget Pace", "Revenue/Margin Calendar") | `app/layouts/default.vue:12-22` | Platform | M | Information architecture pass (Today / Week / Month / Plan / Cash). |
| 46 | Prose that states UH facts ("closed Mondays", "standing Monday closure", "Cambridge St") | `capacity/index.vue:922`, `edit.vue:1570`, many comments | UH-only | L | Replace with settings-driven text. |
| 47 | Dev seed data mimics UH (Monday-closed, UH revenue levels) | `seed-dev-actuals.mjs` | UH-only | L | Replace with a neutral demo restaurant; also useful for sales demos and screenshots. |

## Suggested order of attack (if this proceeds)

1. **Chart-of-accounts roles** (rows 21-24, 29). Everything downstream depends
   on this, and onboarding quality is the product.
2. **A shared `restaurant settings` module** that replaces the duplicated
   constants (rows 11, 12, 18, 33, 34): timezone, operating days, service
   window, baseline start, open-day rule. Cheap, and it removes ~20 copies.
3. **Tenant scoping** (rows 1, 2, 6, 7, 8) once the settings shape is known.
4. **POS adapter boundary** (rows 30-31) before adding a second POS.
5. **Defer or modularize** the UH-only items (rows 4, 19, 32, 41, 42, 46).

## Open questions this audit surfaced

- Do target restaurants *use* QBO account numbers? If most don't, role mapping
  has to come from names and hierarchy only. Worth checking with 2-3 prospective
  pilots' charts of accounts before designing the mapping screen.
- Is "dinner-only" a design choice for the wedge (full-service dinner
  independents first) or a limitation to remove? It changes rows 33-34 from
  "make it a setting" to "leave it and say so."
- Weekly payroll is the easy case. What share of independents run biweekly or
  semi-monthly? That decides how much of the Labor tab can port as-is (row 13).
