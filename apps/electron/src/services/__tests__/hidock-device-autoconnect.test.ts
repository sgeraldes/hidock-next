/**
 * HiDock Device Service - Auto-connect Behavior Tests
 *
 * Spec: .claude/specs/spec-auto-connect-behavior.md
 *
 * Core invariant:
 *   config.autoConnect = USER PREFERENCE, only changed by the toggle
 *   userInitiatedDisconnect = SESSION STATE, resets every startup
 *
 * BUGS BEING FIXED:
 *   disableAutoConnect() was writing false to config.json — WRONG
 *   enableAutoConnect() was writing true to config.json — unnecessary
 *   Result: every Disconnect, cancel, timeout, page-close overwrote user's preference
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Contract tests: what writes to config.json ────────────────────────────

describe('Config persistence contract: only setAutoConnectConfig writes to disk', () => {
  let saveConfigCalls: Array<{ autoConnect: boolean }>

  function makeService() {
    saveConfigCalls = []
    const saveConfig = (val: { autoConnect: boolean }) => saveConfigCalls.push(val)

    const service = {
      autoConnectConfig: { enabled: true, connectOnStartup: true, intervalMs: 5000 },
      autoConnectEnabled: false,
      userInitiatedDisconnect: false,

      saveAutoConnectConfig() {
        saveConfig({ autoConnect: this.autoConnectConfig.enabled })
      },

      // BUGGY version (current code before fix):
      disableAutoConnect_buggy() {
        this.autoConnectEnabled = false
        this.userInitiatedDisconnect = true
        this.autoConnectConfig.enabled = false          // BUG: touches user preference
        this.autoConnectConfig.connectOnStartup = false // BUG: touches user preference
        this.saveAutoConnectConfig()                    // BUG: writes to config.json
      },

      // FIXED version (per spec):
      disableAutoConnect_fixed() {
        this.autoConnectEnabled = false
        this.userInitiatedDisconnect = true
        // NO config changes, NO save
      },

      // BUGGY enableAutoConnect (current):
      enableAutoConnect_buggy() {
        this.autoConnectEnabled = true
        this.userInitiatedDisconnect = false
        this.autoConnectConfig.enabled = true
        this.autoConnectConfig.connectOnStartup = true
        this.saveAutoConnectConfig()                    // BUG: unnecessary save
      },

      // FIXED enableAutoConnect (per spec):
      enableAutoConnect_fixed() {
        this.autoConnectEnabled = true
        this.userInitiatedDisconnect = false
        // NO config changes, NO save
      },

      // setAutoConnectConfig IS the only writer (this doesn't change):
      setAutoConnectConfig(config: Partial<{ enabled: boolean; connectOnStartup: boolean }>) {
        this.autoConnectConfig = { ...this.autoConnectConfig, ...config }
        this.saveAutoConnectConfig()
      },
    }

    return service
  }

  it('BUG: disableAutoConnect (current) writes false to config.json', () => {
    const svc = makeService()
    expect(svc.autoConnectConfig.enabled).toBe(true) // user had it ON

    svc.disableAutoConnect_buggy()

    expect(saveConfigCalls).toHaveLength(1)           // BUG: wrote to disk
    expect(saveConfigCalls[0].autoConnect).toBe(false) // BUG: user preference overwritten
  })

  it('FIXED: disableAutoConnect does NOT write to config.json', () => {
    const svc = makeService()
    expect(svc.autoConnectConfig.enabled).toBe(true)

    svc.disableAutoConnect_fixed()

    expect(saveConfigCalls).toHaveLength(0)            // No disk write
    expect(svc.autoConnectConfig.enabled).toBe(true)   // User preference preserved
    expect(svc.userInitiatedDisconnect).toBe(true)     // Session state set correctly
  })

  it('BUG: enableAutoConnect (current) writes true to config.json unnecessarily', () => {
    const svc = makeService()
    svc.autoConnectConfig.enabled = false // user had it OFF
    saveConfigCalls = []

    svc.enableAutoConnect_buggy()

    expect(saveConfigCalls).toHaveLength(1) // BUG: write happened
    // This silently overrides user's OFF preference when they connect manually
  })

  it('FIXED: enableAutoConnect does NOT write to config.json', () => {
    const svc = makeService()
    svc.autoConnectConfig.enabled = false // user had it OFF
    saveConfigCalls = []

    svc.enableAutoConnect_fixed()

    expect(saveConfigCalls).toHaveLength(0)           // No write
    expect(svc.autoConnectConfig.enabled).toBe(false) // User's OFF preference preserved
    expect(svc.userInitiatedDisconnect).toBe(false)   // Session state cleared
  })

  it('setAutoConnectConfig IS the only writer — toggle ON saves true', () => {
    const svc = makeService()
    svc.autoConnectConfig.enabled = false
    saveConfigCalls = []

    svc.setAutoConnectConfig({ enabled: true, connectOnStartup: true })

    expect(saveConfigCalls).toHaveLength(1)
    expect(saveConfigCalls[0].autoConnect).toBe(true)
  })

  it('setAutoConnectConfig IS the only writer — toggle OFF saves false', () => {
    const svc = makeService()
    saveConfigCalls = []

    svc.setAutoConnectConfig({ enabled: false, connectOnStartup: false })

    expect(saveConfigCalls).toHaveLength(1)
    expect(saveConfigCalls[0].autoConnect).toBe(false)
  })
})

// ─── startAutoConnect() decision table ─────────────────────────────────────

describe('startAutoConnect() decision table', () => {
  function makeStartAutoConnect(opts: {
    configEnabled: boolean
    userInitiatedDisconnect: boolean
    alreadyRunning?: boolean
  }) {
    let startAutoConnectCalled = 0

    const svc = {
      autoConnectConfig: { enabled: opts.configEnabled },
      userInitiatedDisconnect: opts.userInitiatedDisconnect,
      autoConnectEnabled: opts.alreadyRunning ?? false,
      state: { connected: false },

      startAutoConnect() {
        if (!this.autoConnectConfig.enabled) return        // User preference OFF
        if (this.userInitiatedDisconnect) return           // User disconnected this session
        if (this.autoConnectEnabled || this.state.connected) return

        this.autoConnectEnabled = true
        startAutoConnectCalled++
      },

      getStartCount: () => startAutoConnectCalled,
    }

    return svc
  }

  it('fires when config=true and userInitiatedDisconnect=false (startup)', () => {
    const svc = makeStartAutoConnect({ configEnabled: true, userInitiatedDisconnect: false })
    svc.startAutoConnect()
    expect(svc.getStartCount()).toBe(1)
  })

  it('blocked when config=false (user toggled OFF)', () => {
    const svc = makeStartAutoConnect({ configEnabled: false, userInitiatedDisconnect: false })
    svc.startAutoConnect()
    expect(svc.getStartCount()).toBe(0)
  })

  it('blocked when userInitiatedDisconnect=true (user clicked Disconnect)', () => {
    const svc = makeStartAutoConnect({ configEnabled: true, userInitiatedDisconnect: true })
    svc.startAutoConnect()
    expect(svc.getStartCount()).toBe(0)
  })

  it('fires after restart: new service has userInitiatedDisconnect=false by default', () => {
    // Simulate: user clicked Disconnect in previous session
    const oldSession = makeStartAutoConnect({ configEnabled: true, userInitiatedDisconnect: true })
    oldSession.startAutoConnect()
    expect(oldSession.getStartCount()).toBe(0) // Blocked in old session

    // Restart: new service instance, userInitiatedDisconnect resets to false
    const newSession = makeStartAutoConnect({ configEnabled: true, userInitiatedDisconnect: false })
    newSession.startAutoConnect()
    expect(newSession.getStartCount()).toBe(1) // Fires on new session!
  })

  it('fires after restart even if user had disconnected before restart', () => {
    // This is the KEY behavior: restart = fresh session
    const afterRestart = makeStartAutoConnect({ configEnabled: true, userInitiatedDisconnect: false })
    afterRestart.startAutoConnect()
    expect(afterRestart.getStartCount()).toBe(1)
  })
})

// ─── Integration: real service  ────────────────────────────────────────────

describe('HiDockDeviceService - auto-connect contract (real service)', () => {
  let HiDockDeviceService: any
  let mockWindow: any

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

    const updateSectionMock = vi.fn().mockResolvedValue({ success: true })

    mockWindow = {
      electronAPI: {
        config: {
          get: vi.fn().mockResolvedValue({
            success: true,
            data: { device: { autoConnect: true, autoDownload: true } }
          }),
          updateSection: updateSectionMock
        }
      }
    }
    ;(globalThis as any).window = mockWindow

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  afterEach(() => {
    delete (globalThis as any).window
  })

  it('disableAutoConnect does NOT call saveAutoConnectConfig (no config write)', () => {
    const service = new HiDockDeviceService()
    const saveSpy = vi.spyOn(service as any, 'saveAutoConnectConfig')

    service.disableAutoConnect()

    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('disableAutoConnect sets userInitiatedDisconnect=true (session state only)', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    service.disableAutoConnect()

    expect(serviceAny.userInitiatedDisconnect).toBe(true)
    expect(serviceAny.autoConnectEnabled).toBe(false)
  })

  it('disableAutoConnect does NOT change autoConnectConfig.enabled (user preference)', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Wait for config to load (config says autoConnect: true)
    await new Promise(resolve => setTimeout(resolve, 50))

    service.disableAutoConnect()

    // User preference must be preserved
    expect(serviceAny.autoConnectConfig.enabled).toBe(true)
  })

  it('enableAutoConnect does NOT call saveAutoConnectConfig', () => {
    const service = new HiDockDeviceService()
    const saveSpy = vi.spyOn(service as any, 'saveAutoConnectConfig')

    service.enableAutoConnect()

    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('setAutoConnectConfig IS the only path that saves config', () => {
    const service = new HiDockDeviceService()
    service.setAutoConnectConfig({ enabled: false, connectOnStartup: false })

    expect(mockWindow.electronAPI.config.updateSection).toHaveBeenCalledWith(
      'device',
      { autoConnect: false }
    )
  })

  it('after restart: userInitiatedDisconnect=false so auto-connect can fire', async () => {
    const service = new HiDockDeviceService()
    const startSpy = vi.spyOn(service as any, 'startAutoConnect').mockImplementation(() => {})

    // Simulate: previous session user disconnected
    service.disableAutoConnect()
    expect((service as any).userInitiatedDisconnect).toBe(true)

    // Simulate restart: new service instance has userInitiatedDisconnect=false
    const service2 = new HiDockDeviceService()
    const startSpy2 = vi.spyOn(service2 as any, 'startAutoConnect').mockImplementation(() => {})
    await service2.initAutoConnect()

    // New session should fire auto-connect (config says true, session state reset)
    expect(startSpy2).toHaveBeenCalled()
  })
})
