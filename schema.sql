-- Restaurant Performance Dashboard — starting schema (SQLite)
--
-- Design goal: every dashboard question (today vs. same-weekday history,
-- COGS/labor vs. revenue, black/red, on-pace-vs-budget) is answerable from
-- daily_line_items joined against accounts and budget_targets. Nothing here
-- is QuickBooks-report-shaped — it's shaped for the questions we're asking.

-- One row per QBO account we care about, tagged with the internal category
-- the dashboard groups by. This mapping is what makes "which labor category
-- is costing us too much" possible later without a schema change — just add
-- more granular accounts under category = 'labor'.
--
-- account_number/parent_account_id reconstruct the real QBO chart of
-- accounts hierarchy (e.g. 6000 Labor -> 6010 BOH Wages -> 6012 Garde
-- Manger Cook), needed so a budget can be exported back into QBO's own
-- account-level Excel template and re-imported. qbo_account_id is
-- nullable because accounts seeded from that Excel template (see
-- scripts/import-budget-xlsx.mjs) don't carry QBO's internal object ID —
-- only a real QBO Account sync (not yet built) can fill that in, matched
-- by account_number.
CREATE TABLE accounts (
  id                 INTEGER PRIMARY KEY,
  qbo_account_id     TEXT UNIQUE,            -- QuickBooks Online Account.Id, filled in once the real account sync exists
  account_number     TEXT,                   -- QBO account number, e.g. "6012" (some built-in QBO accounts have none)
  parent_account_id  INTEGER REFERENCES accounts(id),  -- reconstructs the COA's sub-account nesting
  name               TEXT NOT NULL,          -- QBO account name, e.g. "Garde Manger Cook"
  category           TEXT NOT NULL CHECK (category IN ('revenue', 'cogs', 'labor', 'opex', 'other_income', 'other_expense')),
  subcategory        TEXT,                   -- optional finer bucket, e.g. "BOH", "FOH", "Food", "Beverage"
  -- Only meaningful for category='opex': rent/insurance/loan interest are
  -- 'fixed' (not controllable month to month, so not worth benchmarking);
  -- marketing/repairs/supplies/admin are 'variable' (the actionable slice,
  -- benchmarked as 'opex_variable' in category_benchmarks). NULL elsewhere.
  cost_behavior      TEXT CHECK (cost_behavior IN ('fixed', 'variable')),
  -- Only meaningful for category='labor': marks an owner-operator's own
  -- salary (added 2026-07-22 — this restaurant's Executive Chef and
  -- Business Manager are the two owners), as distinct from a hired
  -- market-rate role like General Manager. Deliberately NOT modeled as
  -- cost_behavior='fixed' — owner comp is controllable (you set your own
  -- pay), unlike rent/insurance, so it isn't "fixed" in that sense; this is
  -- a separate concern (is this compensation representative of what a
  -- hired-staff industry benchmark assumes, or does it include an
  -- ownership premium the benchmark was never built to include) and gets
  -- its own flag rather than overloading cost_behavior's meaning. Owner
  -- comp still counts toward total labor $ and net income — this only
  -- controls whether it's included in the labor % shown against the
  -- benchmark. 0/1 boolean, defaults to 0 (not owner compensation).
  is_owner_compensation INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1
);

-- One row per (date, account) with the day's amount, pulled from QBO's
-- ProfitAndLoss report at summarize_column_by=Days. This is the single
-- fact table everything else aggregates from.
CREATE TABLE daily_line_items (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,              -- ISO 8601, e.g. '2026-07-16'
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  amount      REAL NOT NULL,              -- positive for revenue and expense magnitudes (sign handled at query time)
  UNIQUE (date, account_id)
);

CREATE INDEX idx_daily_line_items_date ON daily_line_items(date);
CREATE INDEX idx_daily_line_items_account ON daily_line_items(account_id);

-- Budget targets, one row per (year, month, account) — matches how QBO's
-- own budget object actually works (per-account, not per-category), which
-- is what makes an export -> re-import round trip with QBO possible. The
-- app's macro Budget tab rolls these up through accounts.category at query
-- time (same pattern as the category_benchmarks queries below), the same
-- way "which labor category" drill-downs already roll up daily_line_items.
--
-- There is deliberately no 'net_income' row here — QBO has no real "Net
-- Income" account (see the Total Net Income row in a QBO budget export,
-- which is a computed subtotal, not an account), so budgeted net income is
-- always derived as revenue - cogs - labor - opex + other_income -
-- other_expense, never entered directly, so it can't drift out of sync with
-- the category budgets it's made of. (category was a single 'other' bucket
-- until 2026-07-29, when it was split into other_income/other_expense so
-- each account's real sign is known instead of guessed — see CLAUDE.md.)
CREATE TABLE budget_targets (
  id          INTEGER PRIMARY KEY,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  amount      REAL NOT NULL,
  UNIQUE (year, month, account_id)
);

-- Configurable red/green thresholds for cost-ratio categories (COGS%,
-- labor% of revenue), used by the P&L tab to color a period's actual
-- ratio. Separate from budget_targets, which is dollar amounts by month —
-- this is percentages, and doesn't vary by month/year, just by category.
--
-- 'prime_cost' (COGS% + labor% combined) gets its own row rather than being
-- derived from the cogs/labor rows added together — restaurants benchmark
-- prime cost against its own industry-standard target (~60-65%), which
-- isn't just the sum of the two individual targets.
CREATE TABLE category_benchmarks (
  id            INTEGER PRIMARY KEY,
  category      TEXT NOT NULL UNIQUE CHECK (category IN ('cogs', 'labor', 'prime_cost', 'opex_variable')),
  target_pct    REAL NOT NULL,   -- e.g. 0.30 for 30% of revenue
  warning_pct   REAL NOT NULL,   -- above this: warning
  serious_pct   REAL NOT NULL,   -- above this: serious
  critical_pct  REAL NOT NULL    -- above this: critical
);

-- Holds the QBO OAuth tokens for the one connected company. Single-row
-- table (id is always 1) since this app is scoped to one restaurant, per
-- CLAUDE.md. Separate from budget_targets/category_benchmarks-style config
-- because tokens rotate on every refresh and expire, so this is live
-- credential state, not settings.
CREATE TABLE qbo_tokens (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),
  realm_id                  TEXT NOT NULL,   -- QBO company ID returned by the OAuth callback
  access_token              TEXT NOT NULL,
  refresh_token             TEXT NOT NULL,
  access_token_expires_at   TEXT NOT NULL,   -- ISO 8601
  refresh_token_expires_at  TEXT NOT NULL,   -- ISO 8601 (refresh tokens are single-use and rotate)
  updated_at                TEXT NOT NULL
);

-- One row per business date, pulled from Toast POS — covers (guest count)
-- and total labor hours, the two figures the Dashboard needs for average
-- check and sales/labor-hour that QBO has no equivalent of (see
-- server/utils/toast-metrics-sync.ts). Deliberately its own table rather
-- than shoehorned into daily_line_items: these aren't GL account amounts,
-- they're POS-sourced counts with a different unit and no accounts row to
-- join against.
--
-- covers is the sum of each order's own numberOfGuests (Toast's
-- check-level numberOfGuests field was found to be null on every check for
-- this restaurant when spot-checked against a real day — order-level is
-- the reliable field). labor_hours is the sum of regularHours +
-- overtimeHours across that day's labor/v1/timeEntries — fields Toast
-- already computes per entry (accounting for breaks/rounding), rather than
-- this app re-deriving hours from raw clock-in/out timestamps.
CREATE TABLE daily_toast_metrics (
  date         TEXT PRIMARY KEY,   -- ISO 8601, e.g. '2026-07-29' (matches daily_line_items.date)
  covers       INTEGER NOT NULL,
  labor_hours  REAL NOT NULL,
  synced_at    TEXT NOT NULL
);

-- Full per-loan, per-payment debt-service schedule (principal + interest
-- split, including each loan's one-time catch-up interest payment) for
-- Urban Hearth's 10 loans (see CLAUDE.md's Debt Service / Cash Flow tab
-- section). Imported once via scripts/import-debt-schedule.mjs from two
-- source amortization workbooks (investor_loans_v6.xlsx,
-- Eastern_Bank_Loan_Amortization_Reference.xlsx — neither checked in, same
-- posture as the real budget xlsx scripts/import-budget-xlsx.mjs reads
-- from). Exists because QBO's P&L has no principal line at all — a loan
-- payment's principal portion reduces a balance-sheet liability, not an
-- expense account — so daily_line_items/budget_targets can only ever see
-- the interest portion (account 7020 Loan Interest). This table is the only
-- place principal, and the one-time catch-up interest events, are tracked.
--
-- loan_key is a stable slug ('sba', 'chen', 'savage', 'schaefer',
-- 'gilreath', 'mis', 'price', 'reid', 'jones', 'miller'), not a QBO
-- liability account number — the source brief's own account reference had
-- the SBA loan and the unrelated Price investor loan both cited as
-- account 2740, so accounts.account_number isn't a safe join key here
-- without confirming the real SBA sub-account number against QBO directly
-- (not yet done).
CREATE TABLE loan_schedule (
  id             INTEGER PRIMARY KEY,
  loan_key       TEXT NOT NULL,
  lender         TEXT NOT NULL,
  payment_date   TEXT NOT NULL,   -- ISO 8601, e.g. '2026-12-20'
  payment_type   TEXT NOT NULL CHECK (payment_type IN ('catch_up', 'regular')),
  interest       REAL NOT NULL,
  principal      REAL NOT NULL,
  total_payment  REAL NOT NULL,
  UNIQUE (loan_key, payment_date, payment_type)
);

-- Real, actual transfers into the QBO 1005 Loan Payment Reserve account,
-- toward the loan_schedule catch-up-interest target (see CLAUDE.md's Debt
-- Service / Cash Flow tab section). Deliberately NOT derived from a fixed
-- $/week schedule assumption — a real gap caught 2026-07-31: the app
-- originally assumed every planned Monday transfer happened at a fixed
-- $2,200, but two of the real transfers (7/13, 7/20) were reversed the same
-- week (the user needed the cash for bills), and the weekly amount itself
-- later changed to $2,500 starting 7/27. No bank feed exists to detect any
-- of this automatically, so this table is manually recorded (via the Cash
-- Flow tab's "Record a transfer" form) and is the sole source of truth for
-- "how much is actually saved" — amount is signed so a reversal is just
-- another row (a negative one) rather than a special case, and multiple
-- rows may share a transfer_date (a same-day transfer + reversal, e.g.).
CREATE TABLE reserve_transfers (
  id             INTEGER PRIMARY KEY,
  transfer_date  TEXT NOT NULL,   -- ISO 8601, e.g. '2026-07-27'
  amount         REAL NOT NULL,   -- negative = reversal/withdrawal
  note           TEXT
);

-- The user's currently-declared weekly reserve transfer plan — separate
-- from reserve_transfers' history because "what I'm planning to transfer
-- each week going forward" and "what I've actually transferred" are two
-- different facts that can disagree at any moment (e.g. the user
-- announcing a new $4,000/week plan before that week's transfer has
-- actually happened yet). Before this table existed, the Cash Flow tab's
-- projection inferred the "current weekly rate" from the single most
-- recent positive reserve_transfers row — which broke the first time the
-- user wanted to declare a new rate ahead of the next actual transfer.
-- Single-row (id is always 1); reserve_transfers stays the sole source of
-- truth for "saved so far," this table only feeds the forward projection.
CREATE TABLE reserve_plan (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  weekly_amount  REAL NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Tracks each nightly sync run against the QBO Reports API, so the
-- dashboard can show "as of" freshness and surface sync failures instead
-- of silently going stale.
CREATE TABLE sync_runs (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  rows_synced   INTEGER,
  error_message TEXT
);

-- Example queries the schema above needs to answer directly:
--
-- Last night's revenue vs. a comparison date:
--   SELECT SUM(dli.amount)
--   FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
--   WHERE a.category = 'revenue' AND dli.date = ?;
--
-- Month-to-date COGS % of revenue:
--   SELECT
--     SUM(CASE WHEN a.category = 'cogs' THEN dli.amount ELSE 0 END) /
--     SUM(CASE WHEN a.category = 'revenue' THEN dli.amount ELSE 0 END) AS cogs_pct
--   FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
--   WHERE dli.date BETWEEN date('now', 'start of month') AND date('now');
--
-- Budget pace: compare actual-to-date against (monthly target * day-of-month / days-in-month).
--
-- Budget tab — macro category budget for a month, rolled up from
-- account-level budget_targets rows:
--   SELECT a.category, SUM(bt.amount) AS budgeted
--   FROM budget_targets bt JOIN accounts a ON a.id = bt.account_id
--   WHERE bt.year = ? AND bt.month = ? GROUP BY a.category;
--
-- P&L tab — weekly/monthly/yearly rollup with COGS%/labor% status color:
--   SELECT a.category,
--     SUM(dli.amount) AS total,
--     SUM(dli.amount) / (SELECT SUM(amount) FROM daily_line_items dli2
--       JOIN accounts a2 ON a2.id = dli2.account_id
--       WHERE a2.category = 'revenue' AND dli2.date BETWEEN ? AND ?) AS pct_of_revenue
--   FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
--   WHERE dli.date BETWEEN ? AND ? GROUP BY a.category;
--   -- compare pct_of_revenue against category_benchmarks to pick a status color
--
-- P&L drill-down — labor by subcategory within a period (e.g. isolate
-- overtime once it has its own accounts row, category='labor', subcategory='Overtime'):
--   SELECT a.subcategory, SUM(dli.amount)
--   FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
--   WHERE a.category = 'labor' AND dli.date BETWEEN ? AND ?
--   GROUP BY a.subcategory ORDER BY SUM(dli.amount) DESC;
--
-- Revenue shortfall drill-down — which days within the period underperformed
-- vs. the same weekday last week/month/year (reuses the existing daily
-- comparison logic, just applied to every day in the period instead of one):
--   SELECT dli.date, SUM(dli.amount) AS actual
--   FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
--   WHERE a.category = 'revenue' AND dli.date BETWEEN ? AND ?
--   GROUP BY dli.date ORDER BY dli.date;
--
-- Opex drill-down — fixed vs. variable subtotals (only the variable subtotal
-- gets compared against category_benchmarks; fixed costs aren't controllable
-- month to month, so benchmarking them isn't actionable), plus the
-- subcategory breakdown within variable to find what's driving it:
--   SELECT a.cost_behavior, SUM(dli.amount)
--   FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
--   WHERE a.category = 'opex' AND dli.date BETWEEN ? AND ?
--   GROUP BY a.cost_behavior;
--
--   SELECT a.subcategory, SUM(dli.amount)
--   FROM daily_line_items dli JOIN accounts a ON a.id = dli.account_id
--   WHERE a.category = 'opex' AND a.cost_behavior = 'variable' AND dli.date BETWEEN ? AND ?
--   GROUP BY a.subcategory ORDER BY SUM(dli.amount) DESC;
