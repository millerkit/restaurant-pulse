// One-time (or reset) setup: creates data/restaurant.sqlite from schema.sql.
// Run with `npm run db:init`. Safe to re-run against a fresh file — the
// nightly sync job is what actually populates daily_line_items later.
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const dbPath = join(rootDir, 'data', 'restaurant.sqlite')
const schemaPath = join(rootDir, 'schema.sql')

mkdirSync(dirname(dbPath), { recursive: true })

if (existsSync(dbPath)) {
  console.log(`Removing existing database at ${dbPath}`)
  unlinkSync(dbPath)
}

const schema = readFileSync(schemaPath, 'utf-8')
const db = new Database(dbPath)
db.exec(schema)
db.close()

console.log(`Initialized ${dbPath} from schema.sql`)
