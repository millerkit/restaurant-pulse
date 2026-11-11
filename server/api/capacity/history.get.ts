// Historical seasonality reference for the Seasonal Trends page and the
// Capacity page. The computation lives in server/utils/capacity-history.ts,
// shared with the automatic capacity forecast (server/utils/capacity-forecast.ts).
import { loadCapacityHistory } from '../../utils/capacity-history'

export default defineEventHandler(() => loadCapacityHistory(useDb()))
