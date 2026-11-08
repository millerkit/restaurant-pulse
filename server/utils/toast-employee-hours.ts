// Per-employee hours for the Staff Hours report. See schema.sql's
// daily_toast_employee_hours / toast_employees comments for what's stored
// and why. Hours come from the same time entries syncToastMetricsForDate
// already fetches (no extra call per day); names come from one
// /labor/v1/employees call per sync run.

interface ToastCredentials {
  apiHostname: string
  clientId: string
  clientSecret: string
  restaurantGuid: string
}

export interface ToastEmployeeTimeEntry {
  regularHours: number | null
  overtimeHours: number | null
  employeeReference: { guid: string } | null
  jobReference?: { guid: string } | null
  deleted?: boolean
  autoClockedOut?: boolean
}

interface ToastEmployee {
  guid: string
  firstName: string | null
  lastName: string | null
  chosenName: string | null
  deleted: boolean
}

// Replaces the date's rows wholesale rather than upserting, so an entry that
// was deleted or corrected in Toast after an earlier sync can't leave a stale
// employee-day behind. Entries with no hours (an unfinished clock-in) don't
// count as a day worked.
export function writeEmployeeHoursForDate(isoDate: string, timeEntries: ToastEmployeeTimeEntry[]) {
  const byEmployee = new Map<string, { hours: number; autoShifts: number; autoHours: number }>()
  for (const te of timeEntries) {
    const guid = te.employeeReference?.guid
    if (!guid || te.deleted) continue
    const hours = (te.regularHours ?? 0) + (te.overtimeHours ?? 0)
    if (hours <= 0) continue
    const entry = byEmployee.get(guid) ?? { hours: 0, autoShifts: 0, autoHours: 0 }
    entry.hours += hours
    if (te.autoClockedOut) {
      entry.autoShifts += 1
      entry.autoHours += hours
    }
    byEmployee.set(guid, entry)
  }

  const db = useDb()
  const syncedAt = new Date().toISOString()
  writeJobHoursForDate(isoDate, timeEntries, syncedAt)
  const insert = db.prepare(`
    INSERT INTO daily_toast_employee_hours (date, employee_guid, hours, auto_clocked_out_shifts, auto_clocked_out_hours, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  db.transaction(() => {
    db.prepare('DELETE FROM daily_toast_employee_hours WHERE date = ?').run(isoDate)
    for (const [guid, e] of byEmployee) insert.run(isoDate, guid, e.hours, e.autoShifts, e.autoHours, syncedAt)
  })()
}

// Same entries at employee-day-job grain, for the BOH hours report. A missing
// table (migration not run yet) only warns, so it can't fail the covers and
// labor-hours sync the dashboard depends on.
function writeJobHoursForDate(isoDate: string, timeEntries: ToastEmployeeTimeEntry[], syncedAt: string) {
  const byKey = new Map<string, { employee: string; job: string; regular: number; overtime: number; autoShifts: number; autoHours: number }>()
  for (const te of timeEntries) {
    const employee = te.employeeReference?.guid
    const job = te.jobReference?.guid
    if (!employee || !job || te.deleted) continue
    const regular = te.regularHours ?? 0
    const overtime = te.overtimeHours ?? 0
    if (regular + overtime <= 0) continue
    const key = `${employee}|${job}`
    const e = byKey.get(key) ?? { employee, job, regular: 0, overtime: 0, autoShifts: 0, autoHours: 0 }
    e.regular += regular
    e.overtime += overtime
    if (te.autoClockedOut) {
      e.autoShifts += 1
      e.autoHours += regular + overtime
    }
    byKey.set(key, e)
  }
  try {
    const db = useDb()
    const insert = db.prepare(`
      INSERT INTO daily_toast_job_hours (date, employee_guid, job_guid, regular_hours, overtime_hours, auto_clocked_out_shifts, auto_clocked_out_hours, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.transaction(() => {
      db.prepare('DELETE FROM daily_toast_job_hours WHERE date = ?').run(isoDate)
      for (const e of byKey.values()) insert.run(isoDate, e.employee, e.job, e.regular, e.overtime, e.autoShifts, e.autoHours, syncedAt)
    })()
  } catch (err) {
    console.warn(`writeJobHoursForDate(${isoDate}) failed — BOH hours report will be stale (database migration 0010 not applied? see Settings): ${err instanceof Error ? err.message : err}`)
  }
}

interface ToastJobRecord {
  guid: string
  title: string | null
  wageFrequency: string | null
  deleted?: boolean
}

// Job titles for the BOH hours report. One call per sync run.
export async function syncToastJobs(creds: ToastCredentials) {
  const res = await toastFetch(creds, '/labor/v1/jobs')
  if (!res.ok) {
    throw new Error(`Toast API request failed [/labor/v1/jobs]: ${res.status} ${await res.text()}`)
  }
  const jobs = await res.json() as ToastJobRecord[]
  const db = useDb()
  const syncedAt = new Date().toISOString()
  const upsert = db.prepare(`
    INSERT INTO toast_jobs (guid, title, wage_frequency, deleted, synced_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (guid) DO UPDATE SET
      title = excluded.title,
      wage_frequency = excluded.wage_frequency,
      deleted = excluded.deleted,
      synced_at = excluded.synced_at
  `)
  db.transaction(() => {
    for (const j of jobs) upsert.run(j.guid, j.title ?? '(untitled)', j.wageFrequency, j.deleted ? 1 : 0, syncedAt)
  })()
  return jobs.length
}

export async function syncToastEmployees(creds: ToastCredentials) {
  const res = await toastFetch(creds, '/labor/v1/employees')
  if (!res.ok) {
    throw new Error(`Toast API request failed [/labor/v1/employees]: ${res.status} ${await res.text()}`)
  }
  const employees = await res.json() as ToastEmployee[]

  const db = useDb()
  const syncedAt = new Date().toISOString()
  const upsert = db.prepare(`
    INSERT INTO toast_employees (guid, first_name, last_name, chosen_name, deleted, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (guid) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      chosen_name = excluded.chosen_name,
      deleted = excluded.deleted,
      synced_at = excluded.synced_at
  `)
  db.transaction(() => {
    for (const e of employees) {
      upsert.run(e.guid, e.firstName, e.lastName, e.chosenName, e.deleted ? 1 : 0, syncedAt)
    }
  })()
  return employees.length
}
