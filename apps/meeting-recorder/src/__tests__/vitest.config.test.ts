/**
 * Smoke test for vitest.config.ts
 * Config files skip TDD per project rules. This confirms the config file exists.
 * Actual test framework validation: all other test files passing = vitest config works.
 */
import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { existsSync } from 'fs'

describe('vitest.config', () => {
  it('vitest config file exists', () => {
    const configPath = resolve(__dirname, '../../vitest.config.ts')
    expect(existsSync(configPath)).toBe(true)
  })

  it('test setup file exists', () => {
    const setupPath = resolve(__dirname, '../test/setup.ts')
    expect(existsSync(setupPath)).toBe(true)
  })
})
