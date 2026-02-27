/**
 * Structural test for the Electron preload script.
 * The preload script bridges IPC between main and renderer processes.
 * Functional testing is done via Electron MCP E2E tests.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

describe('electron preload script', () => {
  it('preload index.ts exists', () => {
    const preloadPath = resolve(__dirname, '../../preload/index.ts')
    expect(existsSync(preloadPath)).toBe(true)
  })

  it('ipc handlers registry exists', () => {
    const handlersPath = resolve(__dirname, '../ipc/handlers.ts')
    expect(existsSync(handlersPath)).toBe(true)
  })
})
