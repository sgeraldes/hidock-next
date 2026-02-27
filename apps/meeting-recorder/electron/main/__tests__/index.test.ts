/**
 * Structural test for the Electron main process entry point.
 * Full E2E verification happens via Electron MCP (app launch + screenshot).
 * Unit tests here cover only the non-Electron utility logic.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

describe('electron main process entry', () => {
  it('main process index.ts exists', () => {
    const indexPath = resolve(__dirname, '../index.ts')
    expect(existsSync(indexPath)).toBe(true)
  })

  it('preload script exists', () => {
    const preloadPath = resolve(__dirname, '../../preload/index.ts')
    expect(existsSync(preloadPath)).toBe(true)
  })
})
