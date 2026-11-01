// ONE-OFF — runs INSIDE the production container. Restores one month's REVENUE budget_targets
// from a backup copy of the database. Compares by default (read-only); pass --apply to write.
// Only revenue accounts for the given year/month are touched; accounts matched by account_number.
//   node restore-budget-revenue.cjs <backupFile> <year> <month> [--accounts=4010,4022,...] [--apply]
// --accounts limits the restore to those account numbers (e.g. just the Food/Beverage leaves the
// "Recompute Revenue from Capacity" button writes: 4010,4022,4024,4026,4028).
const path = require('path');
const DB_PATH = process.env.DB_PATH || '/app/data/restaurant.sqlite';
let Database; try { Database = require('/app/node_modules/better-sqlite3'); } catch { Database = require('better-sqlite3'); }
const [backupFile, yearArg, monthArg, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
const onlyArg = flags.find(f => f.startsWith('--accounts='));
const only = onlyArg ? new Set(onlyArg.slice(11).split(',').map(x => x.trim())) : null;
const year = Number(yearArg), month = Number(monthArg);
if (!backupFile || !year || !(month >= 1 && month <= 12)) { console.error('usage: node restore-budget-revenue.cjs <backupFile> <year> <month> [--accounts=a,b] [--apply]'); process.exit(2); }
const dataDir = path.dirname(DB_PATH);
if (path.dirname(backupFile) !== dataDir || !/^backup-[\w.-]+\.sqlite$/.test(path.basename(backupFile)) || path.resolve(backupFile) === path.resolve(DB_PATH)) { console.error('backupFile must be a backup-*.sqlite file in ' + dataDir); process.exit(2); }
const db = new Database(DB_PATH); db.pragma('busy_timeout = 8000');
db.exec(`ATTACH DATABASE '${backupFile.replace(/'/g, "''")}' AS bak`);
const rows = db.prepare(`
  SELECT a.id, a.account_number num, a.name, l.amount cur, b.amount old
  FROM accounts a
  LEFT JOIN budget_targets l ON l.account_id = a.id AND l.year = ? AND l.month = ?
  LEFT JOIN (SELECT ba.account_number num, bt.amount FROM bak.budget_targets bt JOIN bak.accounts ba ON ba.id = bt.account_id WHERE bt.year = ? AND bt.month = ?) b ON b.num = a.account_number
  WHERE a.is_active = 1 AND a.category = 'revenue' AND a.account_number IS NOT NULL
  ORDER BY a.account_number`).all(year, month, year, month);
const dup = db.prepare(`SELECT account_number n, COUNT(*) c FROM accounts WHERE is_active=1 AND category='revenue' AND account_number IS NOT NULL GROUP BY 1 HAVING c>1`).all();
if (dup.length) { console.error('duplicate active account numbers, aborting:', JSON.stringify(dup)); process.exit(1); }
const money = v => v == null ? '(none)' : v.toFixed(2);
const diffs = rows.filter(r => r.old != null && Math.abs((r.cur ?? 0) - r.old) > 0.005 && (!only || only.has(String(r.num))));
console.log(`${year}-${String(month).padStart(2,'0')} revenue budget: backup ${backupFile}`);
console.log('acct   name'.padEnd(46) + 'current'.padStart(14) + 'backup'.padStart(14));
for (const r of rows.filter(r => r.cur != null || r.old != null)) console.log(`${String(r.num).padEnd(6)} ${String(r.name).slice(0,38).padEnd(38)} ${money(r.cur).padStart(14)} ${money(r.old).padStart(14)}${diffs.includes(r) ? '  <-- differs' : ''}`);
const skipped = rows.filter(r => r.old == null && r.cur != null && r.cur !== 0);
if (skipped.length) console.log('\nNOT touched (no row in backup):', skipped.map(r => r.num).join(', '));
console.log(`\n${diffs.length} account(s) differ.`);
if (!apply) { console.log('Read-only. Re-run with --apply to restore the backup values for the rows marked "differs".'); process.exit(0); }
if (!diffs.length) { console.log('Nothing to restore.'); process.exit(0); }
const bak = path.join(dataDir, 'backup-pre-restore-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
db.exec(`VACUUM INTO '${bak}'`); console.log('Backup of live DB before restore:', bak);
const up = db.prepare('INSERT INTO budget_targets (year, month, account_id, amount) VALUES (?,?,?,?) ON CONFLICT(year, month, account_id) DO UPDATE SET amount = excluded.amount');
db.transaction(() => { for (const r of diffs) up.run(year, month, r.id, r.old); })();
console.log(`Restored ${diffs.length} account(s).`);
