/**
 * Temp-DB tracker for the `main-db` vitest project (main-process, DB-backed
 * tests). setup-db.ts wraps the shim's better-sqlite3 constructor with
 * trackDatabases(), so every handle a test file opens — and the file it
 * points at — is recorded here; sweepTempDbs() runs from a setup-file
 * afterAll, closes whatever is still open, and deletes the tracked DB files.
 *
 * Why this exists: DB-backed test files mint fresh SQLite paths under
 * os.tmpdir() (e.g. `hidock-kg-test-${Date.now()}-${n}.sqlite`) and re-run
 * initializeDatabase() per test. DatabaseEngine.initialize() does NOT close
 * the previously-open handle, and no suite ever deleted the minted files —
 * one full run stranded ~90 files, and %TEMP% accumulated 8000+ of them over
 * time. Tracking at the constructor is the one choke point that covers every
 * DB-backed suite (and future ones) without per-file cleanup code.
 *
 * Ordering constraint: handles MUST be closed before deleting. better-sqlite3
 * holds a native file handle, and on Windows rmSync on an open DB fails with
 * EPERM — which is also why closing only the engine's current handle would
 * not be enough (the stranded ones would keep their files locked).
 *
 * Safety: only files that resolve inside os.tmpdir() are deleted. Anything
 * else (repo-relative fixtures, ':memory:', anonymous DBs) is closed but
 * never touched on disk.
 */
import { existsSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve, sep } from 'path'

interface SqliteHandle {
  readonly open: boolean
  close(): unknown
}

interface TrackedDb {
  handle: SqliteHandle
  /** Resolved absolute DB file path; '' when the DB is not file-backed. */
  file: string
}

// The tracked list lives on globalThis, NOT at module scope: suites that call
// vi.resetModules() (e.g. database.test.ts's isolated-lifecycle block) make
// the next better-sqlite3 import re-evaluate this module, and a module-scoped
// array would strand every handle the orphaned instance tracked — the sweep
// would then see a fresh, empty list. globalThis survives registry resets.
const GLOBAL_KEY = Symbol.for('hidock.temp-db-tracker.tracked')
const globalStore = globalThis as Record<symbol, TrackedDb[] | undefined>
const tracked: TrackedDb[] = (globalStore[GLOBAL_KEY] ??= [])

/** Files better-sqlite3/SQLite may create next to a database file. */
const DB_FILE_SUFFIXES = ['', '-wal', '-shm', '-journal']

/**
 * Wrap the better-sqlite3 constructor so every instance (and the file it
 * opens) is recorded for the end-of-file sweep. Plain calls are routed
 * through the construct trap so they are tracked exactly once.
 */
export function trackDatabases<T extends object>(Database: T): T {
  const proxy = new Proxy(Database, {
    construct(target, args: unknown[], newTarget) {
      const instance = Reflect.construct(target as new (...a: unknown[]) => object, args, newTarget)
      const filename = typeof args[0] === 'string' ? args[0] : ''
      const fileBacked = filename !== '' && filename !== ':memory:'
      tracked.push({ handle: instance as SqliteHandle, file: fileBacked ? resolve(filename) : '' })
      return instance
    },
    apply(_target, _thisArg, args: unknown[]) {
      return Reflect.construct(proxy as unknown as new (...a: unknown[]) => object, args)
    },
  })
  return proxy as T
}

/**
 * Close every tracked handle that is still open, then delete the tracked
 * temp DB files (and their -wal/-shm/-journal siblings). Returns counts so
 * the wiring can be asserted in tests. Handles a test already closed and
 * files a test already removed are fine; files outside os.tmpdir() are
 * never deleted.
 */
export function sweepTempDbs(): { closed: number; deleted: number } {
  const tempRoot = resolve(tmpdir()) + sep
  let closed = 0
  let deleted = 0
  const files: string[] = []
  for (const db of tracked.splice(0)) {
    try {
      if (db.handle.open) {
        db.handle.close()
        closed++
      }
    } catch {
      /* best-effort: per-file deletion below stays guarded */
    }
    if (db.file !== '' && db.file.startsWith(tempRoot) && !files.includes(db.file)) files.push(db.file)
  }

  for (const file of files) {
    for (const suffix of DB_FILE_SUFFIXES) {
      const sibling = file + suffix
      try {
        if (existsSync(sibling)) {
          rmSync(sibling, { force: true })
          deleted++
        }
      } catch {
        /* e.g. a concurrent worker still holds this file open — leave it */
      }
    }
  }

  // DatabaseEngine.backupOnBoot() copies `<db>.bak-<YYYY-MM-DD>` next to a
  // pre-existing DB before reopening it. The suffix is date-stamped, so match
  // by prefix — one readdir per parent dir, not one per tracked file (%TEMP%
  // can hold tens of thousands of entries).
  const bakPrefixesByDir = new Map<string, string[]>()
  for (const file of files) {
    const dir = dirname(file)
    const prefixes = bakPrefixesByDir.get(dir) ?? []
    prefixes.push(`${basename(file)}.bak-`)
    bakPrefixesByDir.set(dir, prefixes)
  }
  for (const [dir, prefixes] of bakPrefixesByDir) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!prefixes.some((prefix) => name.startsWith(prefix))) continue
      try {
        rmSync(join(dir, name), { force: true })
        deleted++
      } catch {
        /* best-effort */
      }
    }
  }
  return { closed, deleted }
}
