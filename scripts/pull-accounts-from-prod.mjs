// Local dev can never hold its own QBO connection — Intuit's production
// OAuth keys only accept a public HTTPS redirect URI, so localhost isn't a
// viable OAuth target (see CLAUDE.md's QBO Account + P&L sync section).
// Production is the only place the real chart of accounts lives, kept
// current by server/utils/qbo-account-sync.ts running nightly there. This
// script is the other half: a one-way, on-demand pull of just the
// `accounts` table from the production Fly volume down into local dev, so
// local reflects real COA state without ever talking to QBO itself.
//
//   npm run db:pull-accounts
//
// Matches remote rows to local rows by qbo_account_id first, account_number
// second (same precedence qbo-account-sync.ts itself uses). Never touches
// budget_targets or daily_line_items (both key off the local account id,
// which this script preserves for existing rows) and never overwrites
// is_owner_compensation (hand-set locally, not sourced from QBO). Deletes
// nothing — an account no longer present in the remote dump is deactivated
// (is_active=0), matching this app's never-delete-accounts convention.
//
// Also runs automatically as a `predev` hook (see package.json) so local
// COA drift doesn't silently build back up between manual runs — invoked
// there as `--soft`, which (a) skips the pull entirely if the last one
// succeeded within SOFT_THROTTLE_MS (repeatedly restarting `npm run dev`
// during a session shouldn't re-hit production's SSH every time) and
// (b) never fails `npm run dev` itself — a network hiccup or an expired
// `fly` auth session logs a warning and lets dev start against whatever
// local data already exists, rather than blocking startup outright. A
// plain `npm run db:pull-accounts` (no flag) always pulls fresh and always
// surfaces a real failure.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')
const lastPullPath = join(rootDir, 'data', '.last-accounts-pull')
const flyApp = process.env.FLY_APP ?? 'restaurant-pulse'
const soft = process.argv.includes('--soft')
const SOFT_THROTTLE_MS = 12 * 60 * 60 * 1000 // 12 hours

const START_MARKER = '===ACCOUNTS_JSON_START==='
const END_MARKER = '===ACCOUNTS_JSON_END==='

// Runs entirely inside the remote container via the app's own better-sqlite3
// dependency (the image has no sqlite3 CLI) — same approach used to inspect
// and repair the production database earlier. Read-only: SELECT only.
const remoteScript = `
const Database = require('/app/node_modules/better-sqlite3');
const db = new Database('/app/data/restaurant.sqlite', { readonly: true });
console.log('${START_MARKER}');
console.log(JSON.stringify(db.prepare('SELECT * FROM accounts').all()));
console.log('${END_MARKER}');
db.close();
`

function fetchRemoteAccounts() {
  let output
  try {
    output = execFileSync('fly', ['ssh', 'console', '-a', flyApp, '-C', `node -e "${remoteScript.replace(/\n/g, ' ')}"`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit']
    })
  } catch (err) {
    console.error(`Failed to reach production app "${flyApp}" via "fly ssh console". Is the fly CLI installed and authenticated?`)
    throw err
  }
  const start = output.indexOf(START_MARKER)
  const end = output.indexOf(END_MARKER)
  if (start === -1 || end === -1) {
    throw new Error('Could not find accounts JSON in remote output:\n' + output)
  }
  return JSON.parse(output.slice(start + START_MARKER.length, end).trim())
}

function msSinceLastPull() {
  if (!existsSync(lastPullPath)) return Infinity
  const last = Date.parse(readFileSync(lastPullPath, 'utf8').trim())
  return Number.isNaN(last) ? Infinity : Date.now() - last
}

function main() {
  if (soft) {
    const elapsed = msSinceLastPull()
    if (elapsed < SOFT_THROTTLE_MS) {
      console.log(`Skipping accounts pull — last one succeeded ${Math.round(elapsed / 60000)} min ago (throttle: ${SOFT_THROTTLE_MS / 3600000}h). Run "npm run db:pull-accounts" for a fresh pull now.`)
      return
    }
  }

  console.log(`Pulling accounts from production ("${flyApp}")...`)
  const remoteAccounts = fetchRemoteAccounts()
  console.log(`Fetched ${remoteAccounts.length} accounts from production.`)

  const db = new Database(dbPath)
  const findByQboId = db.prepare('SELECT * FROM accounts WHERE qbo_account_id = ?')
  // Restricted to is_active=1 and to exactly-one-match: an inactive local
  // duplicate (or a second active row that happens to share a stale
  // account_number) must never steal a match away from the live account
  // that actually holds budget_targets/daily_line_items history. Ambiguous
  // matches are reported and skipped (inserted fresh) rather than guessed.
  const findByAccountNumber = db.prepare('SELECT * FROM accounts WHERE account_number = ? AND qbo_account_id IS NULL AND is_active = 1')
  const findDuplicateAccountNumbers = db.prepare('SELECT account_number, count(*) c FROM accounts WHERE is_active=1 AND account_number IS NOT NULL GROUP BY account_number HAVING c>1')
  const updateStmt = db.prepare(`
    UPDATE accounts
    SET qbo_account_id = ?, account_number = ?, name = ?, category = ?, subcategory = ?, cost_behavior = ?, is_active = ?
    WHERE id = ?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO accounts (qbo_account_id, account_number, name, category, subcategory, cost_behavior, is_owner_compensation, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `)
  const updateParentStmt = db.prepare('UPDATE accounts SET parent_account_id = ? WHERE id = ?')
  const deactivateStmt = db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?')

  let inserted = 0
  let updated = 0
  const ambiguous = []
  const remoteIdToLocalId = new Map()
  const remoteIdToRemoteRow = new Map(remoteAccounts.map(a => [a.id, a]))
  const touchedLocalIds = new Set()

  const applyAll = db.transaction(() => {
    for (const remote of remoteAccounts) {
      let local = remote.qbo_account_id ? findByQboId.get(remote.qbo_account_id) : undefined
      if (!local && remote.account_number) {
        const candidates = findByAccountNumber.all(remote.account_number)
        if (candidates.length === 1) {
          local = candidates[0]
        } else if (candidates.length > 1) {
          // More than one active, unclaimed local row shares this account
          // number — don't guess which one is "real" (that's exactly what
          // corrupted local data on 2026-07-29: an unqualified match landed
          // on an empty duplicate instead of the row with real history).
          // Insert this remote account as new instead and flag it for a
          // manual look via `npm run db:pull-accounts`'s summary output.
          ambiguous.push({ account_number: remote.account_number, name: remote.name, candidateIds: candidates.map(c => c.id) })
        }
      }

      if (local) {
        updateStmt.run(
          remote.qbo_account_id, remote.account_number, remote.name,
          remote.category, remote.subcategory, remote.cost_behavior, remote.is_active,
          local.id
        )
        remoteIdToLocalId.set(remote.id, local.id)
        touchedLocalIds.add(local.id)
        updated++
      } else {
        const { lastInsertRowid } = insertStmt.run(
          remote.qbo_account_id, remote.account_number, remote.name,
          remote.category, remote.subcategory, remote.cost_behavior, remote.is_active
        )
        remoteIdToLocalId.set(remote.id, Number(lastInsertRowid))
        touchedLocalIds.add(Number(lastInsertRowid))
        inserted++
      }
    }

    // Second pass: remap parent_account_id now that every remote row has a
    // known local id.
    for (const remote of remoteAccounts) {
      if (remote.parent_account_id == null) continue
      const localId = remoteIdToLocalId.get(remote.id)
      const localParentId = remoteIdToLocalId.get(remote.parent_account_id)
      if (localId && localParentId) updateParentStmt.run(localParentId, localId)
    }
  })
  applyAll()

  // Accounts that exist locally with a qbo_account_id (i.e. previously
  // pulled from QBO) but weren't in this dump have been removed/deactivated
  // in QBO since the last pull.
  const previouslySynced = db.prepare("SELECT id FROM accounts WHERE qbo_account_id IS NOT NULL").all()
  let deactivated = 0
  for (const { id } of previouslySynced) {
    if (!touchedLocalIds.has(id)) {
      deactivateStmt.run(id)
      deactivated++
    }
  }

  if (ambiguous.length > 0) {
    console.warn(`\n${ambiguous.length} remote account(s) matched more than one active local row by account_number — inserted as new instead of guessing. Resolve by hand (merge history onto the correct row, deactivate the other):`)
    for (const a of ambiguous) console.warn(`  ${a.account_number} "${a.name}" — candidate local ids: ${a.candidateIds.join(', ')}`)
  }

  const stillDuplicated = findDuplicateAccountNumbers.all()
  if (stillDuplicated.length > 0) {
    console.warn(`\n${stillDuplicated.length} account_number(s) still have more than one active local row after this pull — investigate before trusting budget/actuals rollups for them:`)
    for (const d of stillDuplicated) console.warn(`  ${d.account_number} (${d.c} active rows)`)
  }

  db.close()
  writeFileSync(lastPullPath, new Date().toISOString())
  console.log(`\nDone: ${inserted} inserted, ${updated} updated, ${deactivated} deactivated.`)
}

try {
  main()
} catch (err) {
  if (soft) {
    console.warn(`Accounts pull failed, continuing without it: ${err instanceof Error ? err.message : err}`)
  } else {
    console.error(err)
    process.exit(1)
  }
}
