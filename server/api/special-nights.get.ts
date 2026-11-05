// Dated special nights between ?from and ?to (inclusive, YYYY-MM-DD). See schema.sql.
import { loadSpecialNights } from '../utils/special-nights'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler((event) => {
  const { from, to } = getQuery(event) as { from?: string, to?: string }
  if (!from || !to || !ISO.test(from) || !ISO.test(to)) {
    throw createError({ statusCode: 400, statusMessage: 'from and to must be YYYY-MM-DD' })
  }
  return { nights: [...loadSpecialNights(useDb(), from, to).values()] }
})
