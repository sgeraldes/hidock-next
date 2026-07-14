
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// NOTE: the D3 better-sqlite3 dual-ABI shim is intentionally NOT here. It is
// scoped to the `main-db` vitest project via src/test/setup-db.ts so that
// non-DB tests never see the mock and the unmocked `native-binding` project
// (better-sqlite3-binding.smoke.test.ts) can detect a missing/broken
// production binary. See vitest.config.ts `test.projects`.

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

