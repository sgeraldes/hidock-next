
import '@testing-library/jest-dom/vitest'
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

  // jsdom ships no canvas implementation: HTMLCanvasElement#getContext logs
  // "Not implemented: HTMLCanvasElement's getContext() method: without installing
  // the canvas npm package" to stderr and returns null, so any component that
  // draws on mount (WaveformCanvas whenever a test feeds it real audioData)
  // spams the run output. Return a minimal per-canvas 2D stub instead of
  // installing the native `canvas` package. Tests that assert on drawing
  // (WaveformCanvas.test.tsx) vi.spyOn(getContext) over this stub and are
  // unaffected. Non-'2d' requests (e.g. webgl) return null, silently.
  // measureText → width 0 also keeps axe-core's icon-ligature probe (the other
  // getContext caller, via color-contrast in library-a11y.test.tsx) on its
  // cheap early-return path instead of rasterizing glyphs we can't produce.
  const context2dByCanvas = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()

  const makeContext2d = (canvas: HTMLCanvasElement): CanvasRenderingContext2D =>
    ({
      canvas,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      clip: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn(() => ({ width: 0 })),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(Math.max(0, Math.floor(w)) * Math.max(0, Math.floor(h)) * 4)
      })),
      putImageData: vi.fn(),
      createImageData: vi.fn((w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(Math.max(0, Math.floor(w)) * Math.max(0, Math.floor(h)) * 4)
      })),
      drawImage: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createPattern: vi.fn(() => null),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      setTransform: vi.fn(),
      resetTransform: vi.fn(),
      setLineDash: vi.fn(),
      getLineDash: vi.fn(() => [])
    }) as unknown as CanvasRenderingContext2D

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string
  ): CanvasRenderingContext2D | null {
    if (contextId !== '2d') return null
    let ctx = context2dByCanvas.get(this)
    if (!ctx) {
      ctx = makeContext2d(this)
      context2dByCanvas.set(this, ctx)
    }
    return ctx
  } as typeof HTMLCanvasElement.prototype.getContext

  // jsdom answers getComputedStyle(el, '::before') by IGNORING the pseudo
  // argument — it logs "Not implemented: Window's getComputedStyle() method:
  // with pseudo-elements" and then returns the element's own computed style.
  // axe-core's color-contrast rule probes ::before/::after backgrounds on every
  // run (dozens of lines across the a11y suite), so drop the pseudo argument up
  // front: the return value is exactly what jsdom would have produced, minus
  // the stderr noise. Real pseudo-element styles still can't be asserted in
  // jsdom — see the note on the color-contrast test in library-a11y.test.tsx.
  const realGetComputedStyle = window.getComputedStyle.bind(window)
  window.getComputedStyle = ((elt: Element) =>
    realGetComputedStyle(elt)) as typeof window.getComputedStyle

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

