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
 *   1. back up the current (Node-ABI) binary,
 *   2. rebuild better-sqlite3 for Electron's ABI (@electron/rebuild),
 *   3. load it inside Electron's own runtime and exercise a WAL round-trip,
 *   4. restore the Node-ABI binary so the Vitest suites keep passing.
 *
 * Exit code 0 = better-sqlite3 is Electron-ABI-loadable. Non-zero = it is not.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const binaryPath = join(appDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
const backupPath = `${binaryPath}.node-abi.bak`
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
  if (existsSync(backupPath)) {
    copyFileSync(backupPath, binaryPath)
    rmSync(backupPath, { force: true })
    console.log('[check-native] Restored Node-ABI binary (Vitest suites keep working).')
  }
  rmSync(probePath, { force: true })
  restored = true
}

try {
  if (existsSync(binaryPath)) copyFileSync(binaryPath, backupPath)

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
  console.log('[check-native] PASS')
  process.exit(0)
} catch (err) {
  console.error('[check-native] FAIL:', err?.message ?? err)
  restoreNodeAbi()
  process.exit(1)
}
