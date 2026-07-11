/**
 * AppConfig.features defaults (Track I, I2-a): existing installs upgrade to the
 * `full` preset with no overrides — zero behavior change.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}))

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
