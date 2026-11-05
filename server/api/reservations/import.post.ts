// Uploads an OpenTable GuestCenter CSV (raw text body). Parsing, privacy rules and
// replace-by-date-range behavior live in server/utils/opentable-import.mjs.
import { importReservations } from '../../utils/opentable-import.mjs'

export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event, 'utf8')
  if (!raw || !raw.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'The upload was empty.' })
  }
  try {
    return importReservations(useDb(), raw)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: err instanceof Error ? err.message : 'Could not read the file.' })
  }
})
