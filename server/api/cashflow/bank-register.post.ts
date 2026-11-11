// Imports the QBO bank register for the Loan Reserve account (.xls/.xlsx, raw binary body) into
// reserve_transfers. ?mode=preview (default) writes nothing and returns what would change;
// ?mode=apply performs it. Parsing/matching rules live in server/utils/bank-register-import.mjs.
import { parseRegister, planImport, applyImport } from '../../utils/bank-register-import.mjs'

export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event, false)
  if (!raw || raw.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'The upload was empty.' })
  }
  const mode = getQuery(event).mode === 'apply' ? 'apply' : 'preview'
  const db = useDb()
  try {
    const plan = planImport(db, parseRegister(raw))
    if (mode === 'apply') applyImport(db, plan)
    return { mode, applied: mode === 'apply', ...plan }
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: err instanceof Error ? err.message : 'Could not read the file.' })
  }
})
