/**
 * D3 follow-up (review): UNMOCKED smoke checks for the better-sqlite3 native
 * binding. This file runs in the `native-binding` vitest project (see
 * vitest.config.ts), which does NOT load the dual-ABI shim in
 * src/test/setup-db.ts — loads here hit the REAL binaries on disk.
 *
 * Purpose: detect the production binary being MISSING, or the two workspace
 * copies drifting to different versions — the failure classes a global mock
 * would silently hide. It does NOT run queries against the Electron-ABI
 * binary (impossible under Node by definition); a packaged-app / Electron-
 * runtime query smoke belongs in CI (roadmap note D6).
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
// This file lives at apps/electron/electron/main/services/__tests__/.
const appRoot = resolve(here, '../../../..')
const repoRoot = resolve(appRoot, '../..')

// The app's copy — built for Electron's ABI; what production actually loads.
const appCopy = join(appRoot, 'node_modules', 'better-sqlite3')
// The @hidock/database workspace copy — built for the Node ABI; what the
// scoped test shim (src/test/setup-db.ts) redirects DB-backed tests to.
const nodeCopy = join(repoRoot, 'packages', 'database', 'node_modules', 'better-sqlite3')
// The @hidock/knowledge-graph workspace copy (F18/CX-T4-2) — Node-ABI, used
// only by that package's OWN test suite. Its install is optional from this
// app's perspective (only present after `npm install` in the package), so
// the version-equality check below is conditional on its presence; the
// package.json DECLARATION check is not (it needs no node_modules).
const kgCopy = join(repoRoot, 'packages', 'knowledge-graph', 'node_modules', 'better-sqlite3')

const req = createRequire(import.meta.url)

function readPkg(dir: string): { version: string } {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
}

describe('better-sqlite3 native binding (unmocked)', () => {
  it('the production (Electron-ABI) binary exists on disk', () => {
    // A missing binary means the packaged app cannot open its database at all.
    expect(existsSync(join(appCopy, 'package.json'))).toBe(true)
    expect(existsSync(join(appCopy, 'build', 'Release', 'better_sqlite3.node'))).toBe(true)
  })

  it('the Node-ABI copy the test shim depends on exists on disk', () => {
    expect(existsSync(join(nodeCopy, 'package.json'))).toBe(true)
    expect(existsSync(join(nodeCopy, 'build', 'Release', 'better_sqlite3.node'))).toBe(true)
  })

  it("loading the app's binding under Node either works or fails with the SPECIFIC ABI-mismatch error", () => {
    // Job of this assertion: distinguish "binary present but built for the
    // Electron ABI" (expected under Node-based vitest) from "binary missing
    // or corrupted" (a real production problem). Anything other than a clean
    // load or a NODE_MODULE_VERSION pair mismatch fails the suite.
    let loaded: unknown
    let failure: unknown
    try {
      loaded = req(appCopy)
    } catch (e) {
      failure = e
    }

    if (failure) {
      const err = failure as NodeJS.ErrnoException
      // Must be the dlopen ABI error, not a missing/broken module.
      expect(err.code).toBe('ERR_DLOPEN_FAILED')
      expect(String(err.message)).toMatch(
        /compiled against a different Node\.js version using\s+NODE_MODULE_VERSION (\d+)[\s\S]*requires\s+NODE_MODULE_VERSION (\d+)/
      )
    } else {
      // If the app copy ever becomes loadable under Node (e.g. rebuilt for the
      // Node ABI in CI), it must at least expose the Database constructor.
      expect(typeof loaded).toBe('function')
    }
  })

  it('the Node-ABI copy actually loads under Node (the shim is healthy)', () => {
    const Database = req(nodeCopy)
    expect(typeof Database).toBe('function')
  })

  it('all installed copies are version-pinned equal (no silent skew)', () => {
    const appVersion = readPkg(appCopy).version
    const nodeVersion = readPkg(nodeCopy).version
    // DB-backed tests exercise the Node-ABI copy while production runs the
    // Electron-ABI copy — they must stay the SAME better-sqlite3 version or
    // tests validate a different SQLite/driver than the app ships.
    expect(appVersion).toBe(nodeVersion)
    // Third workspace copy (F18): @hidock/knowledge-graph's own test harness.
    // Conditional — the package may not be npm-installed in every checkout,
    // but when it IS, its copy must not drift either.
    if (existsSync(join(kgCopy, 'package.json'))) {
      expect(readPkg(kgCopy).version).toBe(appVersion)
    }
  })

  it('all workspace package.json dependency declarations pin the same version range', () => {
    const appPkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8'))
    const dbPkg = JSON.parse(readFileSync(join(repoRoot, 'packages', 'database', 'package.json'), 'utf-8'))
    const kgPkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'knowledge-graph', 'package.json'), 'utf-8')
    )
    const appSpec = appPkg.dependencies?.['better-sqlite3'] ?? appPkg.devDependencies?.['better-sqlite3']
    const dbSpec = dbPkg.devDependencies?.['better-sqlite3'] ?? dbPkg.dependencies?.['better-sqlite3']
    const kgSpec = kgPkg.devDependencies?.['better-sqlite3'] ?? kgPkg.dependencies?.['better-sqlite3']
    expect(appSpec).toBeTruthy()
    expect(dbSpec).toBeTruthy()
    expect(kgSpec).toBeTruthy()
    expect(appSpec).toBe(dbSpec)
    expect(kgSpec).toBe(appSpec)
  })

  it('knowledge-graph declares a Node engines floor compatible with its better-sqlite3 pin (CX-T4-2)', () => {
    // better-sqlite3 12.x requires Node >=20; an engines floor of 18 would
    // advertise a runtime the package's own test harness cannot run on.
    const kgPkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'knowledge-graph', 'package.json'), 'utf-8')
    )
    const engines: string = kgPkg.engines?.node ?? ''
    const floor = /(\d+)/.exec(engines)?.[1]
    expect(floor).toBeTruthy()
    expect(Number(floor)).toBeGreaterThanOrEqual(20)
  })
})
