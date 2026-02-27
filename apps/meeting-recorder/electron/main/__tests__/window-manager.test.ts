/**
 * Structural test for window manager bootstrapping.
 * Full window creation is verified via Electron MCP (app launch + screenshot).
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

describe('window manager bootstrap', () => {
  it('main process index file exists', () => {
    const indexPath = resolve(__dirname, '../index.ts')
    expect(existsSync(indexPath)).toBe(true)
  })
})
