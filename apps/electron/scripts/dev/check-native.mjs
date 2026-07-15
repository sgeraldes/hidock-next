#!/usr/bin/env node
/**
 * Native-module gate: prove better-sqlite3 loads under the ELECTRON runtime,
 * not just Node.
 *
 * better-sqlite3 is a native addon; a binary built for Node's ABI will NOT load
 * inside Electron (different NODE_MODULE_VERSION) and vice-versa. The committed /
 * `npm test` state keeps the Node-ABI binary (so Vitest works); the packaged app
 * gets an Electron-ABI binary via `electron-builder install-app-deps`
 * (postinstall). This script bridges the two:
 *
 *   1. back up the current binaries — BOTH copies: the app-local one and the
 *      packages/database one (the rebuild step resolves better-sqlite3 through
 *      the @hidock/database link and can rebuild that copy too),
 *   2. rebuild better-sqlite3 for Electron's ABI (@electron/rebuild),
 *   3. load it inside Electron's own runtime and exercise a WAL round-trip,
 *   4. restore the backed-up binaries so the Vitest suites keep passing,
 *   5. verify the packages/database copy still loads under the CURRENT Node —
 *      that copy is what the main-db vitest project actually requires (the
 *      dual-ABI shim in src/test/setup-db.ts redirects there); leaving it
 *      Electron-ABI fails every DB-backed test file with a
 *      NODE_MODULE_VERSION error.
 *
 * Exit code 0 = better-sqlite3 is Electron-ABI-loadable AND the vitest binding
 * contract holds. Non-zero = one of the two is broken.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const require = createRequire(import.meta.url)
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const packagesDbDir = join(appDir, '..', '..', 'packages', 'database')
// Every better_sqlite3.node the rebuild step can reach. The packages/database
// copy is the one the vitest main-db project loads (src/test/setup-db.ts).
const binaryPaths = [
  join(appDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  join(packagesDbDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
]
const backupOf = (p) => `${p}.node-abi.bak`
// Probe lives inside the app dir so `require('better-sqlite3')` resolves against
// the app's node_modules (require resolves relative to the script's location).
const probePath = join(appDir, '.check-native-probe.cjs')

/** Path to the Electron executable for this project. */
function electronBinary() {
  const p = require('electron')
  if (typeof p !== 'string') throw new Error('Could not resolve the Electron binary path')
  return p
}

// electron-rebuild resolves via a .cmd shim on Windows, so it needs a shell.
function runShell(cmd, args, opts = {}) {
  execFileSync(cmd, args, { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32', ...opts })
}

// The Electron executable is a real binary — run it WITHOUT a shell so argument
// quoting is never mangled (a shell would word-split an inline script).
function runElectron(bin, args, opts = {}) {
  execFileSync(bin, args, { cwd: appDir, stdio: 'inherit', shell: false, ...opts })
}

let restored = false
function restoreNodeAbi() {
  if (restored) return
  for (const binaryPath of binaryPaths) {
    const backupPath = backupOf(binaryPath)
    if (existsSync(backupPath)) {
      copyFileSync(backupPath, binaryPath)
      rmSync(backupPath, { force: true })
      console.log(`[check-native] Restored pre-check binary: ${relative(appDir, binaryPath)}`)
    }
  }
  rmSync(probePath, { force: true })
  restored = true
}

/**
 * The binding the vitest main-db project loads is NOT the app-local copy — the
 * setup-db.ts shim redirects require('better-sqlite3') to the copy inside
 * packages/database, which must stay built for the CURRENT Node ABI. Probe it
 * in a child process (a failed in-process require of a wrong-ABI binary cannot
 * be retried cleanly) and fail loudly with the repair command if it is broken.
 */
function verifyVitestBindingContract() {
  if (!existsSync(join(packagesDbDir, 'node_modules', 'better-sqlite3'))) {
    console.log('[check-native] packages/database better-sqlite3 not installed; skipping vitest-contract check.')
    return
  }
  const probe =
    "const D = require('better-sqlite3');" +
    "const db = new D(':memory:'); db.exec('CREATE TABLE t (x INTEGER)'); db.close();" +
    "console.log('[check-native] packages/database better-sqlite3 OK under Node (NODE_MODULE_VERSION ' + process.versions.modules + ') — vitest contract holds.');"
  try {
    execFileSync(process.execPath, ['-e', probe], { cwd: packagesDbDir, stdio: 'inherit', shell: false })
  } catch {
    console.error(
      '[check-native] FAIL: the packages/database better-sqlite3 binding does not load under the current Node — ' +
        'every DB-backed vitest file will fail with a NODE_MODULE_VERSION error. ' +
        'Repair with: (cd packages/database && npm rebuild better-sqlite3)'
    )
    process.exit(1)
  }
}

try {
  for (const binaryPath of binaryPaths) {
    if (existsSync(binaryPath)) copyFileSync(binaryPath, backupOf(binaryPath))
  }

  console.log('[check-native] Rebuilding better-sqlite3 for the Electron ABI...')
  runShell('npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3'])

  console.log('[check-native] Loading better-sqlite3 inside the Electron runtime...')
  const probe = [
    "const Database = require('better-sqlite3');",
    "const db = new Database(':memory:');",
    "db.pragma('journal_mode = WAL');",
    "db.exec('CREATE TABLE t (x INTEGER)');",
    "db.prepare('INSERT INTO t VALUES (?)').run(42);",
    "const row = db.prepare('SELECT x FROM t').get();",
    "if (!row || row.x !== 42) { throw new Error('unexpected result: ' + JSON.stringify(row)); }",
    "console.log('[check-native] better-sqlite3 OK under Electron (NODE_MODULE_VERSION ' + process.versions.modules + '):', JSON.stringify(row));",
    'db.close();',
  ].join('\n')
  writeFileSync(probePath, probe)

  // ELECTRON_RUN_AS_NODE runs Electron's bundled Node/V8 (Electron's ABI), so a
  // successful require here proves the Electron-ABI binary loads. Pass a script
  // FILE (not -e) so no shell can mangle the argument.
  runElectron(electronBinary(), [probePath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })

  restoreNodeAbi()
  verifyVitestBindingContract()
  console.log('[check-native] PASS')
  process.exit(0)
} catch (err) {
  console.error('[check-native] FAIL:', err?.message ?? err)
  restoreNodeAbi()
  process.exit(1)
}
