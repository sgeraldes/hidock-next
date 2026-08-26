/**
 * AppConfig.features defaults (Track I, I2-a): existing installs upgrade to the
 * `full` preset with no overrides — zero behavior change.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'

// Isolated per-process userData dir. Pointing userData at the tmpdir ROOT (as
// before) made every real-fs config suite share one %TEMP%/config.json across
// files and runs — leaking the file and letting parallel workers see each
// other's writes. A function declaration so the hoisted mock factory can call it.
function testUserDataDir(): string {
  return join(tmpdir(), `hidock-config-features-test-${process.pid}`)
}

vi.mock('electron', () => {
  // config.ts resolves its paths as soon as it is imported — the dir must
  // exist (and be empty) before that happens.
  const dir = testUserDataDir()
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return {
    app: { getPath: () => testUserDataDir() },
    safeStorage: { isEncryptionAvailable: () => false },
  }
})

afterAll(() => {
  rmSync(testUserDataDir(), { recursive: true, force: true })
})

vi.mock('../brains/brain-credential-store', () => ({
  getBrainCredentialStore: () => ({
    hasSecret: () => false,
    getSecret: () => null,
    setSecret: () => true,
  }),
}))

import { getConfig, updateConfig } from '../config'
import { resolveFeatureState, CORE_FEATURE_IDS } from '../../../../src/shared/feature-registry'

describe('config.features defaults', () => {
  it('defaults to the full preset with empty flags', () => {
    const cfg = getConfig()
    expect(cfg.features).toEqual({ preset: 'full', flags: {} })
  })

  it('the default resolves to every core feature enabled (zero behavior change)', () => {
    const resolved = resolveFeatureState(getConfig().features)
    for (const id of CORE_FEATURE_IDS) {
      expect(resolved[id].enabled, id).toBe(true)
    }
  })

  it('updateConfig persists a preset change into the features section', async () => {
    await updateConfig('features', { preset: 'library-only' })
    expect(getConfig().features.preset).toBe('library-only')
    // flags untouched by a preset-only update
    expect(getConfig().features.flags).toEqual({})
    await updateConfig('features', { preset: 'full' })
    expect(getConfig().features.preset).toBe('full')
  })
})
