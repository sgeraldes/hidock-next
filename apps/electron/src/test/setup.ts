
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// D3: better-sqlite3 dual-ABI shim (native module, so vite `alias` can't touch
// it — externalized deps are loaded by Node's require and bypass aliases).
//
// apps/electron/node_modules/better-sqlite3 is compiled for Electron's ABI
// (NODE_MODULE_VERSION 140); Node-based vitest runs under a different ABI (147)
// and can't load it — which broke every DB-backed test file. The
// @hidock/database workspace installs its own better-sqlite3 built for the Node
// ABI. Redirect the import to that copy for tests ONLY, via a global module
// mock. DB tests keep running against REAL SQLite (no behavior change, no
// stubs), while the Electron-built binding the running app depends on is left
// completely untouched — no `npm rebuild`, no node_modules mutation.
vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('module')
  const { fileURLToPath } = await import('url')
  const { dirname, resolve } = await import('path')
  const req = createRequire(import.meta.url)
  const here = dirname(fileURLToPath(import.meta.url))
  // setup.ts lives at apps/electron/src/test/ → repo root is four levels up.
  const nodeAbiCopy = resolve(here, '../../../../packages/database/node_modules/better-sqlite3')
  const Database = req(nodeAbiCopy)
  return { default: Database }
})

// Only setup browser mocks if we're in a browser-like environment
if (typeof window !== 'undefined') {
  // Mock localStorage for Zustand persist middleware
  const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
      get length() {
        return Object.keys(store).length
      },
      key: (index: number) => Object.keys(store)[index] ?? null
    }
  })()

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true
  })

  // Mock matchMedia if needed
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  // Mock scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = vi.fn()

  // Pointer-capture APIs jsdom doesn't implement — Radix popper components
  // (DropdownMenu, Select, Popover) call these when opening via pointer.
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = vi.fn()
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  }
}

