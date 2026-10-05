// ONE-OFF (2026-10-05) — runs INSIDE the production container, not locally.
//
// Why: two reclassifications done in QBO after the rows had already synced —
//   1. an Eversource bill moved from 6522 Gas (Energy) to 6521 Electricity (paid 2026-08-20)
//   2. Mass Ave rent moved toward 7920 "Rent – Mass Ave (closed location)" (new Other Expense account)
// The nightly sync only moves forward, and scripts/backfill-qbo-pl.mjs only upserts rows QBO
// still reports, so a line that moved between accounts would leave a stale duplicate on its old
// account. This script therefore (per account/date range): backs up the DB, deletes the local
// daily_line_items rows, re-pulls them via the backfill script, and restores them from the backup
// if the re-pull fails. Accounts are matched by qbo_account_id, never by local id.
//
// Run from the repo root (pipes this file into the container; nothing is left behind there):
//   B64=$(base64 < scripts/oneoff-resync-energy-rent.cjs | tr -d '\n'); fly ssh console -a restaurant-pulse -C "sh -c 'echo $B64 | base64 -d > /tmp/resync.cjs && node /tmp/resync.cjs <since> <until> <qboId,qboId>; rm /tmp/resync.cjs'"
const Database = require('/app/node_modules/better-sqlite3');
const { execSync } = require('child_process');
const db = new Database('/app/data/restaurant.sqlite'); db.pragma('busy_timeout = 8000');
const bak = '/app/data/backup-pre-resync-' + new Date().toISOString().replace(/[:.]/g,'-') + '.sqlite';
db.exec(`VACUUM INTO '${bak}'`); console.log('BACKUP', bak);
// Usage: node resync.cjs <since> <until> <qboAccountId,qboAccountId,...>
// The 2026-10-05 runs were: 2026-07-25 2026-08-31 118,119 (Electricity, Gas)
//                      and: 2026-06-20 2026-10-04 31,1150040249 (Building Rent, 7920 Mass Ave rent)
const [since, until, qboList] = process.argv.slice(2);
if (!since || !until || !qboList) { console.error('usage: node resync.cjs <since> <until> <qboId,qboId,...>'); process.exit(2); }
const jobs = [{ label: 'custom', since, until, qbo: qboList.split(',') }];
const snap = (ids,s,u)=>db.prepare(`select a.account_number n, d.date, d.amount from daily_line_items d join accounts a on a.id=d.account_id where d.account_id in (${ids.join(',')}) and d.date between ? and ? and d.amount<>0 order by 1,2`).all(s,u);
for (const j of jobs) {
  const ids = j.qbo.map(q => { const r = db.prepare('select id from accounts where qbo_account_id=?').get(q); if(!r) throw new Error('no account for qbo '+q); return r.id; });
  const before = snap(ids,j.since,j.until);
  console.log(`\n== ${j.label} BEFORE`, JSON.stringify(before.map(r=>`${r.n} ${r.date} ${r.amount}`)));
  const del = db.prepare(`delete from daily_line_items where account_id in (${ids.join(',')}) and date between ? and ?`).run(j.since,j.until);
  console.log('deleted', del.changes);
  try {
    const out = execSync(`node scripts/backfill-qbo-pl.mjs --since=${j.since} --until=${j.until} --accounts=${j.qbo.join(',')} 2>&1`, { cwd:'/app', encoding:'utf8', timeout:170000 });
    console.log(out.split('\n').slice(-6).join('\n'));
  } catch (e) {
    console.log('BACKFILL FAILED — restoring', (e.stdout||e.message||'').toString().slice(-500));
    db.exec(`ATTACH '${bak}' AS bk`);
    db.prepare(`insert or replace into daily_line_items (date,account_id,amount) select date,account_id,amount from bk.daily_line_items where account_id in (${ids.join(',')}) and date between ? and ?`).run(j.since,j.until);
    db.exec('DETACH bk'); process.exit(1);
  }
  const after = snap(ids,j.since,j.until);
  console.log(`== ${j.label} AFTER`, JSON.stringify(after.map(r=>`${r.n} ${r.date} ${r.amount}`)));
}
