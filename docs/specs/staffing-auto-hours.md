# Spec: Staffing Plan hours follow a rolling 3-week average (dynamic budgeting step 4)

Written 2026-11-11, not built. Meant to be built from directly (possibly by a smaller model). Read
CLAUDE.md's "The planning model" section first. It describes the automatic-with-pins pattern this step
copies from Capacity (`server/utils/capacity-forecast.ts`) and budget lines (`server/utils/budget-forecast.ts`).
**Build after step 3 (forecast snapshots) has merged.** Step 3 uses migration `0017`, so this one is `0018`.

## Goal

Today every hourly person's "typical hrs/wk" on the Staffing Plan (`labor_position_slots.weekly_hours`) is
typed by hand and drifts from reality. Instead, each mapped person's hours default to their **real average
over the last 3 complete weeks** from Toast, the labor budget for months that haven't started follows
automatically, and anything typed by hand is **pinned** (↺ unpins), exactly like Capacity and the
automatic budget lines.

## Decisions (already made)

- **Window**: the last 3 complete Mon–Sun weeks whose Sunday is on or before the latest date in
  `daily_toast_job_hours`.
  - Skip a week that contains a holiday closure (`holiday_closures`) or in which the restaurant was
    open fewer than 5 nights (`daily_toast_metrics`, a day is open at ≥ 15 covers). Reach back to the
    next older week instead, no further than 8 weeks.
  - If fewer than 2 usable weeks are found, compute nothing and keep the current values.
- **Regular hours per person** = the person's `regular_hours` on jobs mapped to the slot's account,
  averaged over the usable weeks in which they worked at all.
  - A zero week, when others worked, is treated as vacation: it is left out of the average and flagged
    "vacation?".
  - A new hire whose first shift falls inside the window is averaged from their first full week.
  - Round to the nearest 0.5 hour.
  - Keep the stored value when the basis (the window's weeks) is unchanged. This avoids the cent-drift
    bug fixed in step 1.
- **Overtime**: each `overtime`-type account's `ot_hours` gets an auto value: the window's average
  weekly `overtime_hours` summed over everyone on jobs mapped to that account's group's (`ot_base_group`)
  hourly accounts. It can be pinned the same way.
- **Rates and salaries stay hand-entered.** Toast wages aren't stored. Salary slots are untouched.
- **Scaling with forecast covers.** This was the recommendation; flip it before building if Kit prefers
  flat hours.
  - For months after the current one, an account with `role_class = 'direct'` and
    `scales_with_seasonality = 1` multiplies each slot's base hours by:
    clamp( forecast covers per open night for that month ÷ actual covers per open night in the window ,
    1 ± `SEASONALITY_CAP_PCT` ).
  - The month's forecast covers per open night come from `createCapacityModel(db, monthStart,
    monthEnd).dayByDaySum`, divided by the month's Tue–Sun nights minus holiday closures.
  - This **replaces** the last-year seasonal index (`monthlyIndex` from `/api/capacity/history`) as the
    scaling source, everywhere the Staffing Plan uses `seasonalPct`.
  - Supervision, overhead and growth roles stay flat. Migration 0018 sets `scales_with_seasonality = 0`
    for hourly and overtime accounts whose `role_class` isn't `direct`, and logs each change.
  - The page's global checkbox becomes "Scale direct roles with forecast covers" and only touches
    direct roles.
- **Nothing changes on deploy**: every existing slot starts pinned (its hand-entered hours are kept).
  Hours only start following Toast once Kit maps a slot to a Toast employee. At that moment the page
  shows "3-week average: X hrs/wk — use it?", and accepting unpins.
- **Current month stays frozen**: the automatic refresh writes labor budget lines only for months after
  the current one, through December of next year, like `refreshBudgetForecast`.
  - A labor line typed on the Budget page is pinned (`budget_targets.pinned`) and kept.
  - Staffing Plan Save keeps its current behavior: it writes the current year from `asOfMonth` and all
    of next year. Because the refresh uses the same shared model, the figures agree.

## Data (migration `scripts/migrations/0018-staffing-auto-hours.mjs`, plus `schema.sql`)

```sql
-- Toast job → budget role. One-time mapping, edited in Settings › Staff & Pay Rules.
CREATE TABLE toast_job_labor_accounts (
  job_guid    TEXT PRIMARY KEY,               -- toast_jobs.guid
  account_id  INTEGER REFERENCES accounts(id), -- NULL = deliberately unmapped (e.g. owner jobs)
  updated_at  TEXT NOT NULL
);
ALTER TABLE labor_position_slots ADD COLUMN toast_employee_guid TEXT;  -- NULL = not mapped
ALTER TABLE labor_position_slots ADD COLUMN hours_pinned INTEGER NOT NULL DEFAULT 1;
ALTER TABLE labor_position_slots ADD COLUMN auto_weekly_hours REAL;
ALTER TABLE labor_position_slots ADD COLUMN auto_hours_basis TEXT;     -- JSON, see below
ALTER TABLE labor_position_slots ADD COLUMN auto_updated_at TEXT;
ALTER TABLE labor_position_settings ADD COLUMN ot_hours_pinned INTEGER NOT NULL DEFAULT 1;
ALTER TABLE labor_position_settings ADD COLUMN auto_ot_hours REAL;
ALTER TABLE labor_position_settings ADD COLUMN auto_ot_basis TEXT;
```

- **Idempotency**: check `PRAGMA table_info` before each `ALTER`.
- **First run**: copy labor budget lines (accounts under the labor category) for every month after the
  current one into `budget_targets_labor_pre_auto`, as 0016 did.
- **`auto_hours_basis` JSON**: `{ weeks: ['2026-10-19', …] (Mondays), hours: [31.5, 0, 34], flags:
  ['vacation?' | 'new hire' | 'no shifts 2 wks' | 'auto clock-outs'] }`.
- **Match accounts across environments** by `account_number`, never raw ids.

## Code

1. **Move the labor model to `shared/`.** Move `app/utils/laborModel.ts` and the two calendar helpers it
   needs (`countFridays`, `fridaysInMonth`, from `app/composables/useBudgetData.ts`) to
   `shared/utils/labor-model.ts`. Re-export them from the old locations so the pages don't change, and
   keep the math byte-identical. Confirm the Staffing Plan's modeled totals for every month are
   unchanged before and after the move: record them first, from the page or with a small script.
2. **`server/utils/labor-hours.ts`**:
   - `computeAutoHours(db, today)` returns per-slot and per-OT-account auto values, bases and flags,
     following the window and averaging rules above.
   - It also reports **unplanned hours** per account: hours on mapped jobs by employees not mapped to any
     slot, as name, hrs/wk.
   - It reads `daily_toast_job_hours`, `toast_jobs`, `toast_employees`, `holiday_closures` and
     `daily_toast_metrics`.
   - "No shifts 2 wks": a mapped person with no hours in the last 2 complete weeks is flagged; their
     auto value is kept, not zeroed. Removing someone stays a human decision.
3. **`server/utils/labor-forecast.ts`**: `refreshLaborForecast(db, today)` does three things:
   - It writes the auto values (into `weekly_hours` / `ot_hours` too, where unpinned).
   - It builds `LaborAccount[]` the way `server/api/budget/labor-settings.get.ts` does. Extract that
     loader into a util and share it.
   - It prices each labor account for every month after the current one through December of next year
     with the shared model, using `seasonalPct` = the covers ratio above. It upserts `budget_targets`
     with the same `amount`/`auto_amount`/`pinned` rule as `refreshBudgetForecast`.
4. **Wire it into `refreshForecasts()`** (`server/utils/capacity-forecast.ts`) after `refreshBudgetForecast`,
   so it runs after the nightly sync, after input saves and lazily. Run it inside its own try/catch, so
   a labor failure never blocks the capacity or budget refresh.
   - Also call `refreshForecastsAfterChange` from `labor-settings.post.ts` and from the new mapping
     route.
5. **Budget page pins**: extend `server/api/budget/targets.get.ts`'s `autoManaged` to the labor accounts
   the refresh writes, so the Budget page shows the automatic/↺ state on labor lines, as it does for
   sales and cost.
6. **Routes**:
   - `GET/POST /api/budget/labor-mapping` returns jobs with suggested accounts (case-insensitive title
     ↔ account name match, plus `BOH_JOB_PATTERN` in `server/utils/boh-hours-report.ts` for BOH), and
     employees with suggested slots (name match on `employee_name`). The POST saves the mappings.
   - `labor-settings.get.ts` adds `toastEmployeeGuid`, `hoursPinned`, `autoWeeklyHours` and
     `autoHoursBasis` per slot, the OT equivalents, `unplannedHours`, and `coversRatioByMonth` (for the
     scaling display).
   - `labor-settings.post.ts` accepts `hoursPinned` / `otHoursPinned`. Typing a value pins it, and ↺
     sends `false`, which restores the auto value.
   - Owner-only by default deny; add nothing to `shared/utils/access.ts`.

## Pages

- **Staffing Plan** (`app/pages/budget/labor.vue`):
  - Each hourly slot gets a Toast employee picker (suggested match preselected but not saved until
    chosen).
  - Hrs/wk shows "auto · 3-wk avg" or "pinned ↺", with a tooltip of the three weekly figures and any
    flags as chips (icon + label, never color alone: ⚠ vacation?, ⚠ left?, ⚠ auto clock-outs, ✚ new hire).
  - Per role, an "Unplanned: 12 hrs/wk (Jordan, Sam) — add as person" line.
  - The seasonality panel explains the covers ratio for the next few months instead of last year's
    index. Keep the cap note.
  - Replace the old "implied weekly hours" hint (from trailing dollars ÷ rate) with the real 3-week
    average, which is better data. Remove it only once the auto value shows.
- **Settings › Staff & Pay Rules**: a "Toast jobs → budget roles" table (job title, suggested account,
  select, "not budgeted" option).

## Verify

- Run the migration on a copy of local data; confirm idempotency (run twice) and that nothing about the
  budget changes on first deploy (all slots pinned).
- Local Toast job hours stop in July. Add synthetic `daily_toast_job_hours` rows for 4 weeks to a
  backed-up local DB, then restore it afterwards. Then:
  - Map two slots, and check by hand: the averages, a vacation week, a new hire, the OT average, and
    that unplanned hours appear.
  - Check a holiday-closure week being skipped.
- Check scaling by hand for one future month: forecast covers per night ÷ window covers per night,
  capped.
- Check that Staffing Plan Save and the automatic refresh produce identical labor lines, and that a
  pinned labor line on the Budget page survives a refresh.
- Typecheck: compare error counts before and after.
- Production: after deploy, check `fly logs` after the next sync for the labor refresh line. Then map
  people in Settings and on the Staffing Plan. The labor budget for later months moves only for people
  who are mapped and unpinned.

When built, replace this file's pointer in CLAUDE.md with a few lines of current state in "The planning
model", and append the detailed write-up to `docs/claude-history.md`.
