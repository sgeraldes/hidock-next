/**
 * HiDock Device Service - Auto-connect Persistence Tests
 *
 * BUG-AC-001: initAutoConnectStarted guard never resets
 *   OBSERVED: Pressing "Restart" in dev mode (window.webContents.reload) reloads only
 *   the renderer. The service singleton persists with initAutoConnectStarted = true.
 *   App.tsx calls initAutoConnect() again on mount, but guard blocks it silently.
 *   RESULT: Auto-connect never starts after renderer reload.
 *
 * BUG-AC-002: App cleanup disconnect() persists autoConnect: false to config
 *   OBSERVED: App.tsx cleanup calls deviceService.disconnect() if connected.
 *   disconnect() calls disableAutoConnect() which saves autoConnect: false to config.json.
 *   On next startup, config says false → auto-connect never starts.
 *   EXPECTED: Cleanup disconnect should release USB without touching auto-connect config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Logic simulation tests (fast, no USB) ─────────────────────────────────

describe('BUG-AC-001: initAutoConnectStarted guard blocks restart', () => {
  // Simulate the service singleton pattern
  let initAutoConnectStarted: boolean
  let startAutoConnectCalled: number
  let configEnabled: boolean

  function resetState() {
    initAutoConnectStarted = false
    startAutoConnectCalled = 0
    configEnabled = true // default: user has auto-connect enabled
  }

  async function initAutoConnect() {
    if (initAutoConnectStarted) return // guard
    initAutoConnectStarted = true
    if (configEnabled) startAutoConnectCalled++
  }

  function stopAutoConnect() {
    // App.tsx cleanup - does NOT reset initAutoConnectStarted in buggy code
  }

  function resetInitAutoConnect() {
    // Fix: this is what needs to exist
    initAutoConnectStarted = false
  }

  beforeEach(resetState)

  it('BUG: initAutoConnect blocked on second call when guard not reset', async () => {
    // First init (app startup)
    await initAutoConnect()
    expect(startAutoConnectCalled).toBe(1)

    // Simulate renderer reload: cleanup runs (stopAutoConnect), then remount
    stopAutoConnect()
    // Guard is NOT reset - this is the bug
    await initAutoConnect()

    // Bug: auto-connect was NOT started again
    expect(startAutoConnectCalled).toBe(1) // Still 1, should have been 2
  })

  it('FIXED: initAutoConnect runs again after resetInitAutoConnect()', async () => {
    // First init
    await initAutoConnect()
    expect(startAutoConnectCalled).toBe(1)

    // App.tsx cleanup with fix: also calls resetInitAutoConnect()
    stopAutoConnect()
    resetInitAutoConnect()

    // Second init after renderer reload
    await initAutoConnect()

    // Fixed: auto-connect started again
    expect(startAutoConnectCalled).toBe(2)
  })
})

describe('BUG-AC-002: Cleanup disconnect persists autoConnect: false', () => {
  let configFile: { autoConnect: boolean }
  let usbConnected: boolean

  const saveConfig = vi.fn((update: { autoConnect: boolean }) => {
    configFile = { ...configFile, ...update }
  })

  function resetState() {
    configFile = { autoConnect: true } // user had it enabled
    usbConnected = true
    saveConfig.mockClear()
  }

  // Simulates current buggy disconnect() that always calls disableAutoConnect
  function disconnect_buggy() {
    // disableAutoConnect() - always persists false
    saveConfig({ autoConnect: false })
    usbConnected = false
  }

  // Simulates fixed disconnect() with option to preserve config
  function disconnect_fixed(options: { preserveAutoConnect?: boolean } = {}) {
    if (options.preserveAutoConnect !== true) {
      saveConfig({ autoConnect: false })
    }
    usbConnected = false
  }

  beforeEach(resetState)

  it('BUG: cleanup disconnect saves autoConnect: false, breaking next startup', () => {
    expect(configFile.autoConnect).toBe(true) // user wants auto-connect

    // App.tsx beforeunload / cleanup calls disconnect when connected
    disconnect_buggy()

    // Bug: config now says false
    expect(configFile.autoConnect).toBe(false) // persisted incorrectly
    expect(usbConnected).toBe(false) // USB released (correct)

    // Next startup reads false → auto-connect never starts
    const autoConnectOnStartup = configFile.autoConnect
    expect(autoConnectOnStartup).toBe(false) // Bug confirmed
  })

  it('FIXED: cleanup disconnect releases USB without touching auto-connect config', () => {
    expect(configFile.autoConnect).toBe(true)

    // App.tsx cleanup with fix: preserveAutoConnect: true
    disconnect_fixed({ preserveAutoConnect: true })

    // Fixed: config still says true
    expect(configFile.autoConnect).toBe(true) // preserved
    expect(usbConnected).toBe(false) // USB released (correct)

    // Next startup reads true → auto-connect starts
    const autoConnectOnStartup = configFile.autoConnect
    expect(autoConnectOnStartup).toBe(true) // Fixed
  })
})

// ─── Integration-style tests against real service ──────────────────────────

describe('HiDockDeviceService - auto-connect lifecycle', () => {
  let HiDockDeviceService: any
  let mockStartAutoConnect: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => ({
        isOpen: vi.fn(() => false),
        isConnected: vi.fn(() => false),
        open: vi.fn(),
        close: vi.fn(),
        getDeviceInfo: vi.fn(),
        getCardInfo: vi.fn(),
        getSettings: vi.fn(),
        listFiles: vi.fn(() => []),
        downloadFile: vi.fn(),
        deleteFile: vi.fn(),
        setTime: vi.fn(),
        tryConnect: vi.fn().mockResolvedValue(false),
        removeUsbConnectListener: vi.fn(),
        getLockHolder: vi.fn(() => null),
        onconnect: null,
        ondisconnect: null
      })),
      DeviceModel: { UNKNOWN: 'unknown', H1: 'H1', H1E: 'H1E', P1: 'P1' }
    }))

    vi.doMock('../../utils/path-validation', () => ({
      validateDevicePath: vi.fn((p: string) => p)
    }))
    vi.doMock('../../utils/timeout', () => ({
      withTimeout: vi.fn((p: Promise<any>) => p),
      isAbortError: vi.fn(() => false)
    }))
    vi.doMock('../qa-monitor', () => ({
      shouldLogQa: vi.fn(() => false)
    }))

    // Mock electronAPI so loadAutoConnectConfig succeeds with enabled = true
    ;(globalThis as any).window = {
      electronAPI: {
        config: {
          get: vi.fn().mockResolvedValue({
            success: true,
            data: { device: { autoConnect: true, autoDownload: true } }
          })
        }
      }
    }

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  afterEach(() => {
    delete (globalThis as any).window
  })

  it('BUG-AC-001: initAutoConnect blocked on second call (simulates renderer reload)', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Spy on startAutoConnect
    mockStartAutoConnect = vi.spyOn(serviceAny, 'startAutoConnect').mockImplementation(() => {})

    // First call (app startup)
    await service.initAutoConnect()
    expect(mockStartAutoConnect).toHaveBeenCalledTimes(1)

    // Simulate renderer reload cleanup
    service.stopAutoConnect()

    // Second call (renderer remounted - same service instance)
    await service.initAutoConnect()

    // BUG: startAutoConnect was NOT called again
    expect(mockStartAutoConnect).toHaveBeenCalledTimes(1) // Bug: still 1
  })

  it('FIXED: initAutoConnect runs after resetInitAutoConnect()', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    mockStartAutoConnect = vi.spyOn(serviceAny, 'startAutoConnect').mockImplementation(() => {})

    // First call
    await service.initAutoConnect()
    expect(mockStartAutoConnect).toHaveBeenCalledTimes(1)

    // Cleanup with fix
    service.stopAutoConnect()
    service.resetInitAutoConnect() // New method needed

    // Second call after reload
    await service.initAutoConnect()

    // Fixed: startAutoConnect called again
    expect(mockStartAutoConnect).toHaveBeenCalledTimes(2)
  })
})
