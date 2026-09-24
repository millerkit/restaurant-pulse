// Saves this month's planned buyout counts and, when the client just ran
// the "Apply to budget" action, the resulting per-account applied amounts
// (see schema.sql's revenue_buyout_applied comment for why the latter is
// tracked at all). Both happen in one call because the Revenue tab's Apply
// button always does both together — there's no UI path that saves counts
// without also applying them — but `applied` is optional so a future caller
// could save counts as a pure draft without writing budget_targets.
type Body = {
  year: number
  month: number
  counts: Record<string, number>
  applied?: { accountId: number, amount: number }[]
}

const VALID_DOWS = new Set([0, 2, 3, 4, 5, 6]) // Sun,Tue,Wed,Thu,Fri,Sat — Monday excluded, restaurant is closed

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!Number.isInteger(body?.year) || body.year < 2000 || body.year > 2100) {
    throw createError({ statusCode: 400, statusMessage: `Invalid year: ${body?.year}` })
  }
  if (!Number.isInteger(body?.month) || body.month < 1 || body.month > 12) {
    throw createError({ statusCode: 400, statusMessage: `Invalid month: ${body?.month}` })
  }
  if (!body.counts || typeof body.counts !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Expected a "counts" object keyed by day-of-week' })
  }
  const countEntries: [number, number][] = []
  for (const [dowStr, count] of Object.entries(body.counts)) {
    const dow = Number(dowStr)
    if (!VALID_DOWS.has(dow)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid day-of-week: ${dowStr}` })
    }
    // Decimals are intentional (see the buyout-count-input comment in
    // revenue.vue) — a buyout priced above/below its weekday's standard
    // rate is a fractional multiple of a "standard" buyout, not a whole count.
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      throw createError({ statusCode: 400, statusMessage: `Invalid count for day-of-week ${dowStr}: ${count}` })
    }
    countEntries.push([dow, count])
  }
  const appliedEntries = body.applied ?? []
  for (const a of appliedEntries) {
    if (!Number.isInteger(a.accountId) || typeof a.amount !== 'number' || !Number.isFinite(a.amount)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid applied entry: ${JSON.stringify(a)}` })
    }
  }

  const db = useDb()
  const upsertCount = db.prepare(`
    INSERT INTO revenue_buyout_plan (year, month, dow, count) VALUES (?, ?, ?, ?)
    ON CONFLICT(year, month, dow) DO UPDATE SET count = excluded.count
  `)
  const upsertApplied = db.prepare(`
    INSERT INTO revenue_buyout_applied (year, month, account_id, amount) VALUES (?, ?, ?, ?)
    ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount
  `)
  const run = db.transaction(() => {
    for (const [dow, count] of countEntries) upsertCount.run(body.year, body.month, dow, count)
    for (const a of appliedEntries) upsertApplied.run(body.year, body.month, a.accountId, a.amount)
  })
  run()

  return { savedCounts: countEntries.length, savedApplied: appliedEntries.length }
})
