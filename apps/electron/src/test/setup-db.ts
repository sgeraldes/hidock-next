/**
 * D3: better-sqlite3 dual-ABI shim — SCOPED setup, loaded ONLY by the
 * `main-db` vitest project (see vitest.config.ts `test.projects`), i.e. the
 * DB-backed main-process test files. Renderer tests and the unmocked
 * `native-binding` project never see this mock, so a binding-load-failure
 * test can exist (better-sqlite3-binding.smoke.test.ts) and a broken/missing
 * production binary is NOT hidden from the whole suite.
 *
 * Why the shim exists: apps/electron/node_modules/better-sqlite3 is compiled
 * for Electron's ABI (NODE_MODULE_VERSION 140); Node-based vitest runs under a
 * different ABI (147) and can't load it — which broke every DB-backed test
 * file. Native modules are externalized, so a vite `alias` cannot redirect
 * them. The @hidock/database workspace installs its own better-sqlite3 built
 * for the Node ABI; this module mock redirects the import to that copy for
 * tests ONLY. DB tests keep running against REAL SQLite (no behavior change,
 * no stubs), while the Electron-built binding the running app depends on is
 * left completely untouched — no `npm rebuild`, no node_modules mutation.
 *
 * Version skew between the two copies is guarded by the version-pin test in
 * better-sqlite3-binding.smoke.test.ts.
 *
 * The shim also wraps the constructor with trackDatabases() and sweeps in an
 * afterAll: DB-backed suites mint fresh temp SQLite files per test and never
 * deleted them (8000+ hidock-*-test-*.sqlite files piled up in %TEMP%), so
 * every handle is tracked and its tmpdir()-hosted files are removed once the
 * test file is done — see temp-db-tracker.ts.
 */
import { vi, afterAll } from 'vitest'

vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('module')
  const { fileURLToPath } = await import('url')
  const { dirname, resolve } = await import('path')
  const req = createRequire(import.meta.url)
  const here = dirname(fileURLToPath(import.meta.url))
  // setup-db.ts lives at apps/electron/src/test/ → repo root is four levels up.
  const nodeAbiCopy = resolve(here, '../../../../packages/database/node_modules/better-sqlite3')
  const Database = req(nodeAbiCopy)
  const { trackDatabases } = await import('./temp-db-tracker')
  return { default: trackDatabases(Database) }
})

// Temp-DB hygiene: this setup module is evaluated once per test FILE, so this
// afterAll runs after each file's own hooks finish. The one-macrotask defer
// keeps the sweep after a file's own synchronous afterAll cleanup regardless
// of vitest's hook ordering, so suites that close/delete their DB themselves
// always get to run first.
afterAll(async () => {
  await new Promise((tick) => setImmediate(tick))
  const { sweepTempDbs } = await import('./temp-db-tracker')
  sweepTempDbs()
})
