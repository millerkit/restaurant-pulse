# Restaurant Pulse

A daily-use dashboard and planning tool for **Urban Hearth** (owners: Kit, the Business Manager, and Kit's wife, the Executive Chef), live
in production. It pulls the P&L from QuickBooks Online and covers/labor/orders from Toast, runs a nightly
sync, and is organized into five sections: Home, Sales, Team, Money, Planning.

## How this file is kept (standing rule)

- **CLAUDE.md holds current rules, decisions and open items only.** The full dated history (why things
  were built, incidents, verification details, superseded designs) lives in
  [`docs/claude-history.md`](docs/claude-history.md). When a rule below says "see history", look there.
- **When you finish work**: update the current-state text below (or add a short entry), and append the
  detailed dated write-up to the end of `docs/claude-history.md`, not here. A new section here should be a
  few lines; anything longer goes to the archive with a one-line pointer.
- **Keep this file lean on an ongoing basis**: when something here is superseded, resolved, or is only
  history, move it to the archive in the same change. Target well under ~500 lines.

## Terminology (screen wording vs. code)

The app's wording is plain; `schema.sql`, the code and the archive use older names:
COGS = "Food & drink cost"; Opex = "operating expenses"; benchmark = "target"; Free Cash Flow = "cash left
after loans"; Debt Service = "loan payments"; DSCR = "loan coverage ratio"; EBITDA = "operating profit
before interest & depreciation". Net Income and Prime cost are unchanged. Old page names: Weekly
Performance → This Week, Revenue/Margin Calendar → Daily Results, Budget Pace → Budget Check, Edit Budget →
Budget, Revenue → Sales Plan, Labor → Staffing Plan, Kitchen Labor → Kitchen Hours & Cost, Staff Hours →
Benefits Eligibility, Cash Flow → Cash & Loans, Historical → Seasonal Trends, Revenue Modeling → What-If.

## The business (facts the code depends on)

- **Location**: Cambridge St, opened **2026-06-20** (friends & family Jun 16–19). The old **Mass Ave**
  location closed 2026-05-30 and is being sold (lease + liquor license + equipment, ~$100K; gain budgeted
  ~$88K, timing uncertain). Mass Ave rent posts to **7920** (other expense). Many calculations split
  history at the move (`NEW_LOCATION_START`, `LOCATION_MOVE_PERIODS`).
- **Closed Mondays** (Mass Ave was also closed Sundays). Service nights are Tue–Sun. Time zone
  America/New_York.
- **Payroll posts every Friday**, so 5-Friday months carry ~25% more labor. 2027 has 53 Fridays.
- **Owner pay**: Executive Chef and Business Manager accounts are `is_owner_compensation` (Settings ›
  Staff & Pay Rules); the GM is a hired market-rate role (not owner pay).
- **Areas** (`capacity_areas`): Dining Room, Bar, Salon, Chef's Counter (6 seats × 2 turns, max 12; $190
  prix fixe Tue–Sat; **closed Tuesdays from 2026-12-01**, 85% recapture; **never opens Sundays**, `shared/utils/area-hours.ts`, which also holds the closure-uplift math used by the server and the Capacity/Settings pages), Outdoor (closed Nov–Apr). One-off nights an area shouldn't count in the Covers & Spend trend go in `area_night_exclusions` (Settings › Restaurant Setup › Skipped nights).
  Toast table names map to areas: banquette 1–7 and 20s → Dining Room, 30s/40s → Salon, 50s → Outdoor,
  B# → Bar, C# → Chef's Counter.
- **Loans**: 10 loans in `loan_schedule` (Eastern Bank SBA, QBO account 2740, plus 9 investor notes; the
  Price note is 2702). **Every loan payment draws from the Loan Reserve bank account** (1002 in the QBO register export;
  older code comments say 1005): investor
  notes since 2026-08-15, SBA from 2026-11-01 (`SBA_VIA_RESERVE_FROM`). Big Dec 20, 2026 catch-up payment
  ($61,693.48 across the 7 original investor notes = reserve target). **Miller note deferred**: no
  payments Nov 15 2026 – Jun 15 2027, $3,645.80 interest capitalized, then 55 × $2,913.91 from Jul 15
  2027 (applied to production; amendment drafted; QBO needs a monthly interest accrual JE).
- **Bank covenant**: Eastern Bank DSCR ≥ 1.25x, tested annually from FY2026, EBITDA ÷ all annual P&I.
  The Cash & Loans card shows the scoped reading (SBA + Chen, Savage, Schaefer, Gilreath, Mis); EBITDA
  adds back account 7020 loan interest (actuals for closed months, budget after) and budgeted
  depreciation (currently $0). Open questions with the bank are under "Not yet done".
- **Pre-opening non-cash reclasses** (rent 6505 $60K, insurance catch-up 6752 Jan–May, serviceware 6785 on
  2026-06-20) are added back in Free Cash Flow only (`PRE_OPENING_NONCASH_ADJUSTMENTS`), not in Net Income.
- **Gift cards** are a balance-sheet liability (QBO **2440** Gift Cards Outstanding; Toast's nightly JE credits it for
  cards sold, debits it for cards redeemed). Since 2026-11-15 the nightly sync re-pulls 2440's GeneralLedger from
  `GIFT_CARD_TRACKING_START` (2026-11-01) every run into `gift_card_activity` (`server/utils/qbo-gift-card-sync.ts`,
  non-fatal). Cash & Loans shows sold, redeemed and **net** (sold − redeemed: redemptions are revenue with no new cash)
  as a pure cushion: each outlook card adds a "With gift card cash" line under cash left after loans, plus weeks of loan
  payments; never in Net Income, breakeven, Free Cash Flow or the covenant. The manual `gift_card_plan` input is retired.
- **Old-location assets**: catch-up depreciation JE imported 2025-12-31 via Retained Earnings; Section 179
  on the new location is undecided until 2026 tax prep (see history).

## Stack, running it, deploying

- **Stack**: Nuxt 4 + TypeScript + SQLite (`better-sqlite3`), on Fly (`restaurant-pulse`, one always-on
  machine, volume at `/app/data`). The user is fluent in Vue.
- **Local**: `npm install`, `npm run dev` (runs migrations first). Local dev is behind Basic Auth
  (`BASIC_AUTH_USER` / `BASIC_AUTH_PASS` in `.env.local`); in a browser pass them in the URL.
  `npm run db:init` destroys data (including the QBO token) — don't use it on a used database.
- **Migrations run automatically** before the app starts (`scripts/migrate.mjs`, Dockerfile `CMD`) and
  before `npm run dev`. Add `scripts/migrations/NNNN-name.mjs` exporting `up(db, log)`; it must be safe to
  re-run, and `schema.sql` must be updated too. It backs up first (`data/backups/`, newest 3 kept; copies
  contain QBO tokens). A failed migration logs and the app still starts; Settings › Database updates shows
  it. Toast/QBO data backfills are not migrations: run them by hand.
- **`fly deploy` builds from local disk, including uncommitted changes.** Commit (or know what you're
  shipping) before deploying. The "app is not listening on the expected address" deploy warning is benign.
- **Secrets**: any `runtimeConfig` value read from `process.env` needs both the plain and the
  `NUXT_`-prefixed Fly secret, or it silently reads as unset in production.
- **Typecheck**: `npx nuxi typecheck` has ~300 long-standing strict-null errors; compare counts before and
  after rather than expecting zero. `typescript` is pinned to 5.x for `vue-tsc`.

## Working against production

- **Reading production data**: disposable read-only `.cjs` scripts (`.cjs` because `/app/package.json` is
  ESM) uploaded with `fly ssh sftp shell` (`put local /app/name.cjs`; only cd/ls/get/put/chmod; leave with
  Ctrl+D), run with `fly ssh console -C "node /app/name.cjs"` using `/app/node_modules/better-sqlite3`,
  then deleted.
- **Writing to production** needs the user's explicit approval for that write. Back up first; the auto-mode
  safety check may block production commands, and the user then runs them. Don't route around a block.
  Backups on the volume contain QBO tokens: delete them once results are trusted.
- **Never key a script on raw `accounts.id` across environments** (local and production ids differ).
  Match by `account_number` or `qbo_account_id`, and refuse ambiguous matches.

## Auth and roles

- `pulse.urbanhearth.net` is behind **Cloudflare Access** (email one-time PIN); the app verifies the
  `Cf-Access-Jwt-Assertion` JWT, never just the Host header. The raw `restaurant-pulse.fly.dev` hostname
  keeps shared Basic Auth as an owner backstop. Cloudflare's allow-list is edited in Cloudflare.
- **Roles** (`user_roles`, `shared/utils/access.ts`, default deny, enforced on pages and API routes):
  Everyone lands on Home › Summary (`/`, `roleHome`). `owner` = everything; `gm` = read-only This Week (incl. cost pace/budget runway), Daily Results, Covers &
  Spend, Seasonal Trends, Budget Check, Kitchen Hours & Cost with dollars, FOH Hours, plus "Sync now"; `kitchen` =
  Kitchen This Week (`/kitchen-week`, covers only) and Kitchen Hours & Cost as percentages/hours only;
  `floor` (Floor Manager, 2026-11-17) = exactly the kitchen view (Summary, Kitchen This Week) with FOH Hours
  (`/foh-hours`) in place of Kitchen Hours & Cost; no Sync now.
  Owner pay is merged or zeroed server-side for non-owners. Owners can "Preview as" GM/Sous Chef/Floor Manager
  (downgrade-only cookie). An unknown verified email is refused until added in Settings › People & Access.

## Data sources and sync

**Nightly sync** (`runNightlySync`, `server/utils/qbo-sync-runner.ts`) at 8:00 AM New York, also "Sync
now". Refuses to run unless `QBO_ENVIRONMENT=production`: **local dev's QBO connection is Intuit's sandbox**
(unrelated demo company) and syncing it corrupted local accounts once. For a real chart of accounts locally,
`npm run db:pull-accounts`. Order: accounts → P&L → Toast → `refreshForecasts()`.

**QuickBooks** (`ProfitAndLoss`, `summarize_column_by=Days`, **cash basis**):
- Amounts keep QBO's sign (contra-revenue like 4910 Discounts is negative). A parent account's own direct
  postings (Section `Header.ColData`) are captured, never the `Summary` row. `AccountType` strings have
  spaces ("Cost of Goods Sold", "Other Income"). Categories: revenue, cogs, labor, opex, other_income,
  other_expense. Inactive QBO accounts are invisible to the account sync (their P&L rows drop).
- **The sync only moves forward** (catch-up from the last synced date, 30-day floor). A backdated entry
  or a recoded/deleted one is never revisited: run `node scripts/diff-qbo-pl.mjs --since=<date>` in
  production (`--fix` replaces differing accounts' rows; backs up first) or a targeted
  `scripts/backfill-qbo-pl.mjs --since --until --accounts=<qboAccountIds>`. As of 2026-11-09 all categories
  matched QBO to the cent.
- **A parent account's budget row is never counted** (budget entry is leaf-only; server sums skip parents).

**Toast** (`server/utils/toast.ts`, `toast-metrics-sync.ts`):
- Covers = sum of non-deleted orders' `numberOfGuests` for orders opened **at or after 5 PM**, ignoring
  any order over 50 guests. A day is "open" with ≥ 15 covers and positive core revenue.
- Labor hours use Toast's regular + overtime hours. Per-employee and per-job hours are stored for Benefits
  Eligibility and the BOH hours report (BOH = kitchen job titles; porters separate).
- Per-area revenue = `check.amount` (not `totalAmount`, which includes tax and tip). Chef's Counter:
  covers = prepaid + day-of selections not on a bulk Stripe-paid check; food = dollars on "Day Of" selections
  (incl. the bulk Stripe check); beverage = the rest.
- Revenue for averages comes from QBO **core dine-in** accounts (`CORE_REVENUE_ACCOUNT_NUMBERS`: 4000,
  4010, 4020, 4022–4028), excluding events (41xx), catering (42xx), retail (43xx). Nights whose spend per
  cover falls outside 0.6–1.4× the median are excluded and listed (`excludeSpendOutliers`). An "event night"
  (event sales, core under 25% of goal) gets its own treatment (`isEventNight`).

**OpenTable**: no API; CSV export uploaded on Settings/Reservations (`reservations` table, replace by
visit-date range, no guest PII stored). Booking pace for the next 7 nights only adds accuracy within ~3
days out. Refresh the upload at least weekly.

**Bank register** for the loan reserve: QBO register export (`.xls/.xlsx`) uploaded on Cash & Loans;
it is the source of truth for `reserve_transfers` (replace through the file's last date; must tie to the
register's ending balance).

## The planning model (current design)

**Dynamic budgeting** (built 2026-11-11, steps 1–3; step 3 section below): the forecast updates itself; a
month's plan **freezes on the 1st**; anything typed by hand is **pinned** (↺ unpins). Refresh runs after
the nightly sync, after any input save, and lazily on page load (`refreshForecasts`,
`refreshForecastsAfterChange`, `ensureForecastsFresh` in `server/utils/capacity-forecast.ts`).
- **Capacity drivers** (Planning › Capacity): per-area **spend per guest** = the area's real Toast blend
  over the two most recently closed, fully synced months (≥ 30 covers), updated at month close.
  **Expected covers per night** for every month that hasn't started = Cambridge St's de-seasonalized demand
  level (`coversPerNightLevel`, covers per regular night since the move) × that month's covers index, split
  across areas in proportion to capacity × each area's real fill rate (capped; demand, not seats: Outdoor's
  winter closure moves guests indoors). The **covers index** (`server/utils/capacity-history.ts`, rebuilt
  2026-11-17): regular nights only (location's own service nights, no holidays/special nights/party nights
  over 1.75× the month's median; no same-day QBO revenue required), each month ÷ the centered 12-month
  average at the same location, recent years weighted double (Jan–May lean 2/3 on 2026 Mass Ave), scaled to
  average 100. Cambridge St months join once it has 12 full months. See history. The current month is never recomputed. Rows are per calendar month and
  reused every year (a closed month's row is next year's forecast). Pins: `capacity_areas.follow_actuals`
  (1 = automatic), `capacity_area_seasonality.pinned`. Chef's Counter spend per guest is pinned at
  $190/$50; covers Jan–Apr pinned at 7 (re-check after February 2027 actuals).
- **Capacity grid rows are each month's next occurrence** (this month and later = this year, earlier = next year), so
  its Projected Revenue equals the Sales Plan's food + beverage budget for that month (fixed 2026-11-17; see history).
- **Covers values are per Tue–Sun night before any weekly area closure**; a closure (e.g. Chef's Counter
  Tuesdays) zeroes those nights and lifts the others by the recapture %, capped at capacity.
- **Budget lines that follow the forecast** (`server/utils/budget-forecast.ts`), for every month after
  the current one through December of next year: food sales 4010 and beverage sales 4022/4024/4026/4028
  = the Capacity projection (`createCapacityModel`) + dated buyouts, split by the real sales mix since
  the move; food & drink cost 5010/5110/5120/5125/5130 = each line's actual % of its sales over the last
  (up to) three closed months from Aug 2026 × the budgeted sales. **Food cost % is measured over all food
  sales** (4010 + event food 4150/4180 + catering food 4230; costs 5010 + 5220) and applied to all budgeted
  food sales, minus 5220's own budget. **Processing fees** (2026-11-17): Toast Fees 6220 = its real % of
  dine-in sales (4010 + 4022–4028) over the same window (3.0% Aug–Oct 2026) × budgeted dine-in sales;
  buyouts count there (billed by Toast invoice, often paid by ACH with no card fee, sometimes by card; the
  measured % absorbs the mix). Stripe Fees 6210 = fixed `STRIPE_FEE_RATE` 3% × budgeted 41xx/42xx leaf lines
  (event and catering money paid ahead). Chef's Counter prepaid tickets (Stripe) stopped ~2026-11-06 and now
  go through Toast, so the Toast % should drift up as the window rolls. See history. Pins:
  `budget_targets.pinned` / `auto_amount`. Everything else in the budget is entered by hand (Staffing Plan for labor).
- **Special nights and holidays**: holidays are dated (`holiday_closures`, Settings); buyouts, closures,
  off-site and event nights are dated `special_nights` (Sales Plan). A non-buyout night replaces a normal
  night with its own expected dine-in revenue; a buyout stays a normal night and adds (its price − that
  weekday's normal night). The old undated per-weekday buyout counts (`revenue_buyout_plan`, the Sales Plan's
  Buyout Revenue card) were removed 2026-11-12; hypothetical buyouts go on the What-If page.
  **Two revenue fields per night** (2026-11-12, migration 0018): `expected_revenue` = regular dine-in that
  night (hint: the weekday's normal night), `event_revenue` = what the event itself brings in. Kinds: buyout
  (price rings into dine-in), off-site, on-site event, catering (runs alongside a normal night); closures are entered only as Settings holidays. For
  months that haven't started the budget writes event revenue to Event Sales / Catering (4150/4145 on-site,
  4180/4175 off-site, 4230/4210 catering; food/drink split by the real sales mix), puts a replaced night's
  dine-in back into Food/Beverage Sales, and event food counts in food cost. Those accounts are managed (typing
  pins them); a hand-budgeted row with no `auto_amount` is left alone in months with no dated event revenue.
  The current month's Event Sales stay hand-budgeted (plan frozen). Existing nights got `event_revenue` 0:
  re-enter Nov 17 Wild Things ($6,500 of tickets) in the new field.
- **Current month**: the plan is frozen; the live forecast is the night-by-night projection (synced sales
  + each remaining night's recent weekday average or special-night amount, nudged by bookings for the
  next ~3 days), used for Projected on the Sales Plan and Budget pages (`app/utils/revenueProjection.ts`).
- **Weekly goal**: `weekly_revenue_benchmark` (Settings) × each weekday's real share of a week since the
  move (`server/utils/weekly-targets.ts`, with weekly-closure adjustments) drives This Week's targets and
  the Revenue Calendar.
- **Staffing Plan** (`shared/utils/labor-model.ts`, re-exported from `app/utils/laborModel.ts`): weekly rates/hours/salaries × that month's Fridays,
  first-paycheck dates, taxable tips per payroll for SS/Medicare (rates locked at 6.2%/1.45%), role
  classes (direct/supervision/overhead/growth). Saving writes the labor budget, and saving the current
  year also rewrites all 12 months of next year's labor from the same inputs (overwriting hand-entered
  next-year labor; current-year-only inputs like a reduced salary or SUTA rate carry over as-is). A raise
  effective mid-month isn't modeled.
- **Staffing hours follow Toast** (dynamic budgeting step 4, live since 2026-11-12, migration 0019). Shared station logins (staff override "excluded", e.g. Service Bar) never count toward
  anyone's hours or OT. A job mapped "Salaried / fixed pay" is deliberately not tied to hours.
  A slot linked to a Toast employee (Staffing Plan picker; Settings › Staff & Pay Rules maps Toast jobs →
  roles, `toast_job_labor_accounts`) gets `auto_weekly_hours` = mean of that person's regular hours on the
  role's jobs over the last **6** usable Mon–Sun weeks (`AUTO_HOURS_WINDOW_WEEKS`, `server/utils/labor-hours.ts`;
  a week with a holiday closure, < 5 open nights or no synced hours is skipped, reach back ≤ 10 weeks, need ≥ 3
  or nothing changes), to the nearest 0.5, median stored beside it. Flags: vacation?, new hire, no shifts 2
  wks, auto clock-outs. OT accounts get the group's average weekly OT hours. `hours_pinned` / `ot_hours_pinned`
  = typed by hand (every existing slot started pinned; ↺ / "use it?" unpins). `refreshLaborForecast`
  (`labor-forecast.ts`, inside `refreshForecasts()` in its own try/catch) reprices every labor line for months
  after the current one through next December with the shared model; a pinned `budget_targets` line is kept.
  Direct roles that scale multiply hours by clamp(forecast covers per open night ÷ actual per open night over
  the same window, ±`SEASONALITY_CAP_PCT`), replacing last year's seasonal index (Staffing Plan and Build next
  year's budget); migration 0019 turned scaling off for non-direct hourly/OT roles (the Sous Chef).
- **Pay is dated by year** (2026-11-12, migration 0020): `labor_position_slots` keeps `prior_hourly_rate` /
  `prior_weekly_salary` and `pay_change_year`. A rate/salary typed on a future year's Staffing Plan applies from
  that year on; earlier years keep their pay (`resolvePay` in `labor-settings.post.ts`, `loadLaborAccounts(db, year)`).
  Hours, OT and new/removed people are still shared across years. See history.
- **Next year**: the Budget, Sales Plan and Staffing Plan have a 2026/2027 toggle. "Build next year's
  budget" seeds an empty year (fixed costs from December, revenue, labor); revenue and food & drink cost
  now follow the forecast regardless.

## Design rules

- "Clean, simple, quickly readable." No traditional line/bar time-series or pie charts on the dashboard
  pages (Seasonal Trends' bar chart is the deliberate exception). Tables are fine.
- **Status color is never alone**: always paired with an icon/label (✓ ▲ ▼ ⚠). The user has red-green
  color vision deficiency: run new palettes through the `dataviz` skill's validator; use `--shortfall` /
  `--shortfall-deep` for adjacent severity steps; budget rows shade by `varianceTint()` (pale green
  capped, red darkens with materiality).
- Status colors and tokens live in `app/assets/css/main.css` (light and dark).

## Navigation map

Defined in `app/utils/navigation.ts`, rendered by `app/layouts/default.vue` (bottom bar on phones).
Home: Summary (`/`, every role; see below), This Week (`/this-week`; kitchen role: `/kitchen-week`). Sales (a section opens on its first tab): Covers & Spend (`/capacity`; includes the weekly covers/night trend by area, `/api/capacity/area-trends`: complete weeks only, buyout/event/closed nights left out, an area's empty night counts as 0), Daily Results (`/pl/revenue-calendar`, sales
and profit views; the profit view leaves out Mondays and holiday closures unless a special night is dated there, listing any money that landed on them), Seasonal Trends (`/historical`). Team: Kitchen Hours &
Cost (`/kitchen-labor`), FOH Hours (`/foh-hours`, GM/Floor Manager; hours per person, no dollars; `server/utils/foh-hours-report.ts`, see "FOH Hours" below), Benefits Eligibility (`/staff-hours`). Money: Profit & Loss (`/pl`, month and year to date
from QBO actuals via `/api/pl`), Budget Check (`/budget`), Cash & Loans (`/cashflow`), Forecast Accuracy (`/forecast-accuracy`, owner). Planning: Budget (`/budget/edit`), Sales Plan
(`/budget/revenue`), Staffing Plan (`/budget/labor`), Capacity (`/capacity?tab=edit`), Breakeven
(`/breakeven`, owner), What-If (`/revenue-modeling`). Settings (`/settings`, owner): targets and alert levels, restaurant setup (seats,
turns, weekly area closures, holidays), staff and pay rules, people and access, connections, reservation
upload, database updates.

## Forecast snapshots and accuracy report (dynamic budgeting step 3) — built 2026-11-11

The forecast overwrites itself nightly, so `takeForecastSnapshots` (`server/utils/forecast-snapshots.ts`)
saves month-level copies into `forecast_snapshots` (migration 0017): `weekly` (first sync on/after each
Monday, dated that Monday) and `month_start` (first sync on/after the 1st, dated the 1st = the month's frozen
plan). Each covers the current month through 12 months ahead, so a **month's own record is the
`month_start` dated its own 1st** (earlier months' `month_start` rows also cover it, as a lead-time forecast).
Metrics per month: `sales`, `core_sales`, `food_drink_cost`, `labor`, `opex`, `other_income`, `other_expense`,
`net_income` (leaf budget lines, same formula as `netIncome()`), plus `covers`, `max_covers`, `capacity_sales`
from `createCapacityModel`. `source = 'plan'` is `budget_targets`; `'live'` is the current month's night-by-night
core sales (`computeRevenueProjection`, moved to `server/utils/revenue-projection.ts`; the route is a thin
wrapper), skipped when the projection is incomplete. Runs in `runNightlySync()` after `refreshForecasts()`
(log-only on failure, logs "forecast snapshots: …"). Manual: `POST /api/forecast/snapshot` with optional
`{ date }` takes both kinds "as of" that date (owner-only by default).
- **Money › Forecast Accuracy** (`/forecast-accuracy`, `GET /api/forecast/accuracy`, owner-only by default
  deny): each closed, fully synced month with snapshots shows actual vs. month-start plan and the 1/4/8-week-out
  forecasts (nearest weekly snapshot in a lead bucket) with error chips (✓ ≤5%, ▲ ≤15%, ⚠ beyond; error =
  (forecast − actual) ÷ |actual|, + = forecast too high), plus mean absolute % error by lead bucket for sales,
  dine-in sales, covers and net income. States it fills in over time.
- **Covers & Spend**: `capacity.get.ts` uses a full closed or current month's own `month_start` snapshot for its
  assumed covers, max covers, capacity sales (and fill %/avg check from them); `assumed.fromSnapshot` carries the
  date. No snapshot (everything before the deploy) falls back to the model. Per-area figures are not snapshotted.
- Forecast math files were not touched. Details and verification: `docs/claude-history.md`.


## Home › Summary (`/`, every role) — built 2026-11-17

A few plain sentences on how we've been doing: last complete Tue–Sun week, this month so far, Cash and loans (owner
only), looking ahead (next 2 weeks), plus a six-night strip, one progress bar and an optional owners' note
(`home_summary_note`, migration 0023, owner-only `POST /api/home-summary/note`). Rules-based, not an AI writer
(`server/utils/home-summary.ts`): each finding is a fact with a tone, a size and the **roles allowed to see it, filtered
before any sentence or headline is built**. Kit's decisions: the softer tone for everyone, **good news first** (each
section sorts good → neutral → concern, main facts before details); the GM sees profit (same figure as the owner: owner
pay is folded into labor for non-owners, never removed); the Sous Chef sees guests and the last closed month's food
cost % (5010+5220 over all food sales, vs. plan, else the month before), never dollars. Profit and cost % only for a
closed, fully synced month. Booking sentences only from a fresh OpenTable upload. Owner's reserve figures come from
calling the Cash & Loans handler directly. Stale Toast/QBO data adds a "Data note" and drops the affected sentences.

## FOH Hours (Team › FOH Hours, `/foh-hours`) — built 2026-11-17

For the GM and the Floor Manager (new `floor` role, migration 0024, = the Sous Chef's view with FOH Hours instead of
Kitchen Hours). `server/utils/foh-hours-report.ts` (+ `server/api/foh-hours.get.ts`, `foh-hours/report.get.ts` download,
`app/pages/foh-hours.vue`). Two parts, both for a Mon–Sun week with a week picker:
- **Hours** (Toast time entries by job, `daily_toast_job_hours`): per person per day, grouped **Floor / Bar / Concierge** by
  the job each person worked most that week; near-40 and auto clock-out flags; Guests row. FOH jobs match `FOH_JOB_PATTERN`;
  a job that is neither FOH nor BOH is listed as not counted.
- **Views** (`PageTabs.vue` + `usePageTab`, selection in the URL as `?show=`, first key is the default): Productivity (default), Hours, Trends; the week picker shows on Productivity and Hours. Kitchen Hours has the same control: Hours (default, the BOH report) and Cost (labor % of food revenue). `?show=` is deliberately not `?tab=` (Capacity and the role guard use it) or `?view=` (the Sous Chef's restricted Kitchen view).
- **Weekly trends** (the Trends view, Chart/Table toggle like Kitchen Hours; `GET /api/foh-hours/trends`, `WeeklyTrendChart.vue`): guests per
  FOH hour, team sales per hour (the productivity table's total) and average turn time, one point per complete Mon-Sun week (latest 26), normal
  nights only; a week with under 3 normal nights is a gap (`MIN_NIGHTS_FOR_TREND_POINT`); dashed least-squares trend like Kitchen Hours.
- **Server productivity** (shown first, sortable, default sales/hr high to low; Toast's Employee productivity report, `daily_toast_server_sales`, migrations 0025-0026): guests, orders,
  net sales, per guest, avg order, sales/hr, avg turn, non-cash tips %, voids. Definitions in `server/utils/toast-server-sales.mjs`
  (matched Toast's report for 2026-11-13). Only people with Server / Bartender / Lead Bartender hours that week and at least 10 orders in it
(`MIN_ORDERS_FOR_PRODUCTIVITY_ROW`; plus the shared bar login's own row); hours = clocked hours on those jobs. **Chef's Counter orders are split out** (`is_counter` rows: table `C<n>` or a
Chef's Counter selection) into their own table, with tip % blank (prix fixe includes the gratuity) and hours from the new Toast job
"Chef's Counter" (matched by `COUNTER_JOB_PATTERN`; Food Runner is FOH hours-only, never in productivity). **The GM and the Floor Manager both see these dollars** (Kit's call), so
  `/api/foh-hours` is the one dollar-carrying route the `floor` role may call. Filled nightly by the Toast sync (same orders, no
  extra call, non-fatal); history by hand: `npm run db:backfill-toast-server-sales -- --since=2026-06-16` (production:
  `fly ssh console -C "node scripts/backfill-toast-server-sales.mjs --since=2026-06-16"`, needs approval; idempotent).
**Normal-service nights only** (`classifyDays`, `MIN_ORDERS_FOR_SERVICE_DAY` = 20 in `foh-hours-report.ts`): closed Mondays,
dated holiday closures, dated buyout / event / off-site nights (Sales Plan `special_nights`), and any other night with under 20 orders
(low volume or an anomaly; falls back to the 15-covers rule where order counts aren't synced) are tagged under the date and left out of
Guests, guests per FOH hour (weekly card and a per-night row; compare the same weekday across weeks, a slow Tuesday always runs lower than a Friday) and the productivity table (their hours are still listed). Change the 20 in one place.
**Left out of every FOH figure** (Kit, 2026-11-17): managers (anyone who ever clocked a General Manager, Floor Manager or Wine
Director job: Abigail, Shane, Katie; `MANAGER_JOB_PATTERN`) and shared station logins (staff override "excluded", e.g. Service Bar,
which still shows in the productivity table as a "Shared login" row since it carries the bar's sales). There is no Management
section. **Ideas not built** (data the sync downloads but doesn't keep): clock-in/out times, per-night (not per-week) server
rows, comps/discounts per person; scheduled vs. actual hours needs a new Toast API scope. See history.

## Not yet done

- **Eastern Bank, in writing**: (a) does "all annual principal and interest payments" mean the SBA loan
  only or all 10 loans; (b) is "EBITA" a typo for EBITDA; (c) will the pre-opening reclasses count as
  non-recurring add-backs; (d) does EBITDA count a one-time gain on asset sale. **Accountant**: is
  depreciation being posted (it's $0)? If booked, the covenant's depreciation add-back must read actuals.
- **7020 Loan Interest, Dec 2026**: re-verify against real December actuals after Dec 20 (it depends on
  pre-loaded QBO transactions).
- **Toast covers backfill in production** further back (for Seasonal Trends' multi-year comparison), and
  confirm production `capacity_areas` capacities match seats × turns (Settings › Restaurant Setup saves fix
  this).
- A truly measured historical fill % needs Mass Ave's old seating, which was never recorded.
- Labor: payroll tax rates reset each January (SUTA is the reduced 2026 rate).
- **Possible feature (not needed now, Kit 2026-11-12): mid-month raises.** Not modeled. Design if wanted: two
  optional columns on `labor_position_slots`, `raise_effective_date` (a paycheck date, like
  `first_paycheck_date`) and `raise_new_amount` (new hourly rate, or new weekly salary). Only
  `slotMonthlyDollars` / `slotSalaryMonthlyDollars` in `shared/utils/labor-model.ts` split a month's Fridays
  before/after; slots without a raise must stay byte-identical (compare all accounts and months). OT's blended
  base rate would keep current rates unless made month-aware. Needs a migration, `schema.sql`, and two inputs
  on the Staffing Plan slot.
- Toast's per-area revenue uses check totals, which can't exclude a private event at a table.

## Breakeven (Planning › Breakeven, `/breakeven`, owner-only)

`server/api/breakeven.get.ts` + `app/pages/breakeven.vue` (moved out of Covers & Spend 2026-11-14; nothing
of it remains there). Year toggle (shared with the Budget pages) + Jan–Dec month tabs; past months this year are disabled. **Gap view**: cost layer −
dine-in margin at **expected covers** (recent average for the current month, Capacity forecast after) − planned
events/buyouts/catering margin (budget 41xx–42xx + dated buyout increment + event-night diners, at the dine-in
contribution rate) − planned retail margin (budget 43xx; cost % from actual 53xx÷43xx since the move once ≥ $1K,
else budget, else the food & drink cost target) = **still short**, also as event sales needed. Event-only labor is
not modeled. By-weekday: every night grows by the same % over expected covers (toggle: with planned events &
retail / dine-in only). See history.

## Cash & Loans Year-End Outlook

Two cards (simplified 2026-11-12): **Budget** (real actuals for closed months, budget for this month and later, which
already follows the live forecast) and **Latest forecast** (same, but this month's revenue from the night-by-night
projection, food & drink cost scaled with it). Labor, opex and other income/expense stay at budget. The old Recent
pace card and its ratio were removed as double counting. Math: `app/utils/yearOutlook.ts`. Budget accuracy now lives on
Forecast Accuracy.

## Where to look

- [`schema.sql`](schema.sql) — data model (comments explain each table); [`scripts/migrations/`](scripts/migrations/) — schema changes
- [`docs/claude-history.md`](docs/claude-history.md) — full project history and the reasoning behind each rule
- Forecast and budget engine: [`server/utils/capacity-forecast.ts`](server/utils/capacity-forecast.ts), [`capacity-history.ts`](server/utils/capacity-history.ts), [`capacity-model.ts`](server/utils/capacity-model.ts), [`budget-forecast.ts`](server/utils/budget-forecast.ts), [`special-nights.ts`](server/utils/special-nights.ts), [`weekly-targets.ts`](server/utils/weekly-targets.ts), [`core-revenue.ts`](server/utils/core-revenue.ts), [`booking-pace.ts`](server/utils/booking-pace.ts)
- Sync: [`qbo-sync-runner.ts`](server/utils/qbo-sync-runner.ts), [`qbo.ts`](server/utils/qbo.ts), [`qbo-pl-parse.mjs`](server/utils/qbo-pl-parse.mjs), [`qbo-account-sync.ts`](server/utils/qbo-account-sync.ts), [`toast-metrics-sync.ts`](server/utils/toast-metrics-sync.ts), [`toast-table-map.ts`](server/utils/toast-table-map.ts), [`toast-employee-hours.ts`](server/utils/toast-employee-hours.ts); scripts `backfill-qbo-pl.mjs`, `backfill-toast-metrics.mjs`, `backfill-toast-employee-hours.mjs`, `diff-qbo-pl.mjs`, `pull-accounts-from-prod.mjs`
- Auth: [`server/middleware/auth.ts`](server/middleware/auth.ts), [`shared/utils/access.ts`](shared/utils/access.ts), [`app/middleware/role.global.ts`](app/middleware/role.global.ts)
- Budget pages: [`app/pages/budget/edit.vue`](app/pages/budget/edit.vue), [`revenue.vue`](app/pages/budget/revenue.vue), [`labor.vue`](app/pages/budget/labor.vue), [`index.vue`](app/pages/budget/index.vue) (Budget Check); shared [`app/composables/useBudgetData.ts`](app/composables/useBudgetData.ts), [`app/utils/laborModel.ts`](app/utils/laborModel.ts), [`app/utils/revenueProjection.ts`](app/utils/revenueProjection.ts); routes in [`server/api/budget/`](server/api/budget/)
- Capacity: [`app/pages/capacity/index.vue`](app/pages/capacity/index.vue), [`server/api/capacity.get.ts`](server/api/capacity.get.ts), [`server/api/capacity/`](server/api/capacity/)
- Cash & Loans: [`app/pages/cashflow.vue`](app/pages/cashflow.vue), [`server/api/cashflow.get.ts`](server/api/cashflow.get.ts), [`app/utils/yearOutlook.ts`](app/utils/yearOutlook.ts), [`server/utils/bank-register-import.mjs`](server/utils/bank-register-import.mjs)
- Home Summary: [`app/pages/index.vue`](app/pages/index.vue), [`server/utils/home-summary.ts`](server/utils/home-summary.ts), [`server/api/home-summary.get.ts`](server/api/home-summary.get.ts)
- This Week / Daily Results: [`app/pages/this-week.vue`](app/pages/this-week.vue), [`server/api/dashboard.get.ts`](server/api/dashboard.get.ts), [`app/pages/pl/revenue-calendar.vue`](app/pages/pl/revenue-calendar.vue), [`server/api/pl.get.ts`](server/api/pl.get.ts), [`server/api/nightly-margin.get.ts`](server/api/nightly-margin.get.ts)
- Team: [`app/pages/kitchen-labor.vue`](app/pages/kitchen-labor.vue), [`app/pages/kitchen-week.vue`](app/pages/kitchen-week.vue), [`app/pages/staff-hours.vue`](app/pages/staff-hours.vue)
- Settings and navigation: [`app/pages/settings.vue`](app/pages/settings.vue), [`app/utils/navigation.ts`](app/utils/navigation.ts), [`app/layouts/default.vue`](app/layouts/default.vue); styles [`app/assets/css/main.css`](app/assets/css/main.css)
