// Weekly series for the FOH Hours trend charts: guests per FOH hour, team sales per hour and average turn time over
// complete weeks, normal-service nights only (server/utils/foh-hours-report.ts). Same access as /api/foh-hours.
export default defineEventHandler(() => buildFohHoursReport(null, { trends: true }).trends ?? [])
