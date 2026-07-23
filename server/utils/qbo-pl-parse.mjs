// Pure QBO ProfitAndLoss-report-JSON transforms, with no imports and no
// Nitro/TS dependency, so both the Nitro app (server/utils/qbo-pl-sync.ts)
// and the standalone backfill script (scripts/backfill-qbo-pl.mjs, which
// runs via plain `node` against the production Fly volume and can't
// reliably execute TypeScript) can import this file directly.
//
// Shapes below were confirmed against a live sandbox ProfitAndLoss
// response (summarize_column_by=Days) before being written, not assumed:
// every real Data row's ColData[0] carries {value, id}; Section rows carry
// nested Rows.Row plus a separate Summary.ColData subtotal (never
// type:"Data"); the report's trailing "Total" column has no StartDate/
// EndDate in its MetaData at all (only ColKey:"total") — it is a rollup
// column, not a real day, and must be skipped rather than treated as a
// shape-drift error.

// Recurses into type:"Section" rows' nested Rows.Row for arbitrarily deep
// chart-of-accounts nesting; collects only type:"Data" rows. A Section's
// own Header/Summary are QBO's own computed subtotal rows — never
// collected, matching schema.sql's stated design principle ("Nothing here
// is QuickBooks-report-shaped — it's shaped for the questions we're
// asking"); we recompute our own category rollups instead.
export function flattenDataRows(rows, out = []) {
  for (const row of rows ?? []) {
    if (row.type === 'Data') out.push(row)
    else if (row.type === 'Section' && row.Rows?.Row) flattenDataRows(row.Rows.Row, out)
  }
  return out
}

// Column 0 is the label column (always null here). Every real day column
// carries its exact ISO date in MetaData's StartDate (falling back to
// EndDate — confirmed equal for Days summarization). The report's final
// "Total" column has no StartDate/EndDate at all — recognized by its
// ColKey and skipped (null) silently, since it's an expected, named
// non-day column, not a shape drift. Any *other* column missing a date is
// unexpected and logged, but still returns null rather than throwing — a
// single malformed column shouldn't crash an entire day's/month's ingest.
export function extractColumnDates(columns) {
  return (columns ?? []).map((col, i) => {
    if (i === 0) return null
    const meta = Object.fromEntries((col.MetaData ?? []).map(m => [m.Name, m.Value]))
    if (meta.ColKey === 'total') return null
    const date = meta.StartDate ?? meta.EndDate
    if (!date) {
      console.warn(`qbo-pl-parse: column ${i} (${col.ColTitle}) has no StartDate/EndDate and isn't the recognized Total column — skipping`)
      return null
    }
    return date
  })
}

// Ties it together: { qboAccountId, date, amount }[]. amount is
// Math.abs(value) per schema.sql's "positive magnitude, sign handled at
// query time" convention for daily_line_items. A blank cell is treated as
// amount=0 (still produced, not skipped) so a no-activity day upserts a
// real zero rather than leaving a stale nonzero value from a prior sync.
export function reportToLineItems(report) {
  const dates = extractColumnDates(report.Columns?.Column)
  const dataRows = flattenDataRows(report.Rows?.Row)
  const items = []
  for (const row of dataRows) {
    const qboAccountId = row.ColData?.[0]?.id
    if (!qboAccountId) continue // no linked account id — not a real account row (shouldn't happen for Data rows, but don't corrupt data if it does)
    for (let col = 1; col < (row.ColData?.length ?? 0); col++) {
      const date = dates[col]
      if (!date) continue // the Total column, or another unrecognized non-day column
      const raw = row.ColData[col]?.value
      const amount = Math.abs(Number(raw ?? 0) || 0)
      items.push({ qboAccountId, date, amount })
    }
  }
  return items
}
