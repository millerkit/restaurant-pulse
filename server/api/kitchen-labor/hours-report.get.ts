// The same report as a standalone HTML file to download and send (Slack etc.).
export default defineEventHandler((event) => {
  const { week } = getQuery(event)
  const report = buildBohHoursReport(typeof week === 'string' ? week : null)
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="boh-hours-week-of-${report.weekStart}.html"`)
  setHeader(event, 'Cache-Control', 'no-store')
  return renderBohHoursHtml(report)
})
