import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type ReadonlyDatabase = Database.Database

export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.HIDOCK_DB_PATH || join(homedir(), 'HiDock', 'data', 'hidock.db'))
}

export function openReadonlyDatabase(path = resolveDatabasePath()): ReadonlyDatabase {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  db.pragma('query_only = ON')
  return db
}
