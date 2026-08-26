import { beforeEach, describe, expect, it, vi } from 'vitest'

const show = vi.fn()
const loadURL = vi.fn(async (_url: string) => undefined)
const isDestroyed = vi.fn(() => false)
const executeJavaScript = vi.fn(async (_script: string) => undefined)
let browserWindowOptions: Record<string, unknown> | undefined
const callOrder: string[] = []

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {
    constructor(options: Record<string, unknown>) {
      browserWindowOptions = options
    }
    webContents = {
      executeJavaScript: async (script: string) => {
        callOrder.push('paint')
        return executeJavaScript(script)
      },
    }
    async loadURL(url: string) {
      callOrder.push('load')
      return loadURL(url)
    }
    isDestroyed() { return isDestroyed() }
    show() {
      callOrder.push('show')
      show()
    }
  }
}))

describe('startup splash first-frame contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callOrder.length = 0
    browserWindowOptions = undefined
  })

  it('paints useful progress while hidden before exposing the native window', async () => {
    const { createSplashWindow, SPLASH_HTML } = await import('../splash-screen')
    await createSplashWindow('G:/app/out/preload/splash.js')

    expect(browserWindowOptions).toMatchObject({
      show: false,
      paintWhenInitiallyHidden: true,
      backgroundColor: '#0f1626'
    })
    expect(callOrder).toEqual(['load', 'paint', 'show'])
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('requestAnimationFrame'))
    expect(SPLASH_HTML).toContain('width: 6%')
    expect(SPLASH_HTML).toContain('Starting application…')
    expect(SPLASH_HTML).toContain('prefers-reduced-motion: reduce')
  })
})
