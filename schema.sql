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
CREATE TABLE accounts (
  id              INTEGER PRIMARY KEY,
  qbo_account_id  TEXT NOT NULL UNIQUE,   -- QuickBooks Online Account.Id
  name            TEXT NOT NULL,          -- QBO account name, e.g. "Payroll:BOH Wages"
  category        TEXT NOT NULL CHECK (category IN ('revenue', 'cogs', 'labor', 'opex', 'other')),
  subcategory     TEXT,                   -- optional finer bucket, e.g. "BOH", "FOH", "Food", "Beverage"
  is_active       INTEGER NOT NULL DEFAULT 1
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

-- Budget targets, entered manually (CSV import or a simple form) since QBO's
-- Budget object doesn't cleanly cover restaurant-style category budgets.
-- One row per (year, month, category) — enough to derive both a monthly
-- target and a day-by-day expected pace (straight-line by default).
CREATE TABLE budget_targets (
  id        INTEGER PRIMARY KEY,
  year      INTEGER NOT NULL,
  month     INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  category  TEXT NOT NULL CHECK (category IN ('revenue', 'cogs', 'labor', 'opex', 'other', 'net_income')),
  amount    REAL NOT NULL,
  UNIQUE (year, month, category)
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
