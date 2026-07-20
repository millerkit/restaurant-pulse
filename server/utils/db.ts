import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const dbPath = join(process.cwd(), 'data', 'restaurant.sqlite')

let db: Database.Database | undefined

export function useDb(): Database.Database {
  if (!db) {
    if (!existsSync(dbPath)) {
      throw new Error(`Database not found at ${dbPath} — run "npm run db:init" first.`)
    }
    db = new Database(dbPath)
  }
  return db
}
