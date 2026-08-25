import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { revealMainWindow } from '../window-reveal'

type Listener = () => void

function windowHarness() {
  const windowListeners = new Map<string, Listener>()
  const webListeners = new Map<string, Listener>()
  let visible = false
  let destroyed = false
  const show = vi.fn(() => { visible = true })

  const window = {
    once: vi.fn((event: string, listener: Listener) => { windowListeners.set(event, listener) }),
    webContents: {
      once: vi.fn((event: string, listener: Listener) => { webListeners.set(event, listener) }),
    },
    isVisible: vi.fn(() => visible),
    isDestroyed: vi.fn(() => destroyed),
    show,
  } as unknown as BrowserWindow

  return {
    window,
    show,
    emitWindow: (event: string) => windowListeners.get(event)?.(),
    emitWeb: (event: string) => webListeners.get(event)?.(),
    destroy: () => { destroyed = true },
  }
}

describe('main-window reveal contract', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reveals on did-finish-load even when ready-to-show never arrives', async () => {
    const harness = windowHarness()
    const closeSplash = vi.fn()
    const revealed = revealMainWindow(harness.window, { closeSplash, timeoutMs: 8_000 })

    harness.emitWeb('did-finish-load')

    await expect(revealed).resolves.toBe('did-finish-load')
    expect(harness.show).toHaveBeenCalledOnce()
    expect(closeSplash).toHaveBeenCalledOnce()
  })

  it('uses the timeout to reveal the window, never to run hidden work', async () => {
    const harness = windowHarness()
    const closeSplash = vi.fn()
    const revealed = revealMainWindow(harness.window, { closeSplash, timeoutMs: 8_000 })

    await vi.advanceTimersByTimeAsync(8_000)

    await expect(revealed).resolves.toBe('timeout')
    expect(harness.show).toHaveBeenCalledOnce()
    expect(closeSplash).toHaveBeenCalledOnce()
  })

  it('does not reveal or start follow-up work after the window was closed', async () => {
    const harness = windowHarness()
    const closeSplash = vi.fn()
    const revealed = revealMainWindow(harness.window, { closeSplash, timeoutMs: 8_000 })

    harness.destroy()
    harness.emitWindow('closed')
    harness.emitWeb('did-finish-load')

    await expect(revealed).resolves.toBeNull()
    expect(harness.show).not.toHaveBeenCalled()
    expect(closeSplash).not.toHaveBeenCalled()
  })
})
