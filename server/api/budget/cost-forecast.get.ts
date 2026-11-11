// The food & drink cost percentages the automatic budget uses for months that haven't
// started (server/utils/budget-forecast.ts), for the Budget page to show beside those lines.
import { restaurantToday } from '../../utils/capacity-forecast'
import { COST_PAIRS, costWindow } from '../../utils/budget-forecast'

export default defineEventHandler(() => {
  const db = useDb()
  const window = costWindow(db, restaurantToday(useRuntimeConfig().qbo?.syncTimeZone))
  return { ...window, pairs: COST_PAIRS }
})
