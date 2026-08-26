/**
 * HiDock Device Service — gentle reconnect + honest failure state.
 *
 * MOCK-ONLY (no real USB). Covers the gap where the single boot auto-connect fails
 * against a present-but-busy device and nothing retries: a guarded re-attempt, its
 * cooldown/connected/disabled guards, and the "connection failed" status that drives
 * the honest titlebar pill.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const HIDOCK = { vendorId: 0x10d6, productId: 0xb00d, productName: 'HiDock H1E' }

let getDevicesMock: ReturnType<typeof vi.fn>
let tryConnectMock: ReturnType<typeof vi.fn>

async function loadService() {
  vi.resetModules()

  tryConnectMock = vi.fn().mockResolvedValue(false)
  vi.doMock('../jensen', () => ({
    getJensenDevice: vi.fn(() => ({
      isConnected: vi.fn(() => false),
      isOperationInProgress: vi.fn(() => false),
      getLockHolder: vi.fn(() => null),
      tryConnect: tryConnectMock,
      removeUsbConnectListener: vi.fn(),
      getModel: vi.fn(() => 'hidock-h1e'),
      disconnect: vi.fn().mockResolvedValue(undefined),
      onconnect: null,
      ondisconnect: null
    })),
    USB_VENDOR_IDS: [0x10d6, 0x3887],
    USB_PRODUCT_IDS: { H1E: 0xb00d, H1: 0xaf0c, P1: 0xb00e },
    DeviceModel: { UNKNOWN: 'unknown' }
  }))
  vi.doMock('../../utils/path-validation', () => ({ validateDevicePath: vi.fn((p: string) => p) }))
  vi.doMock('../../utils/timeout', () => ({ withTimeout: vi.fn((p: Promise<any>) => p), isAbortError: vi.fn(() => false) }))
  vi.doMock('../qa-monitor', () => ({ shouldLogQa: vi.fn(() => false) }))

  const mod = await import('../hidock-device')
  return (mod as any).HiDockDeviceService
}

beforeEach(() => {
  getDevicesMock = vi.fn().mockResolvedValue([HIDOCK])
  ;(globalThis as any).navigator = {
    usb: { getDevices: getDevicesMock, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  }
  ;(globalThis as any).window = {
    electronAPI: { config: { get: vi.fn().mockResolvedValue({ success: true, data: { device: { autoConnect: true } } }) } }
  }
})

afterEach(() => {
  delete (globalThis as any).navigator
  delete (globalThis as any).window
})

describe('HiDockDeviceService — gentle reconnect', () => {
  it('re-attempts a connect when a device is present, idle, and past the failure cooldown', async () => {
    const Service = await loadService()
    const service = new Service()
    const s = service as any
    s.autoConnectConfig.enabled = true
    s.userInitiatedDisconnect = false
    s.state.connected = false
    s.lastConnectFailureAt = 0
    const spy = vi.spyOn(s, 'tryConnectSilent').mockResolvedValue(true)

    await s.gentleReattempt('test')

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-attempt within the failure cooldown', async () => {
    const Service = await loadService()
    const s = new Service() as any
    s.autoConnectConfig.enabled = true
    s.lastConnectFailureAt = Date.now() // just failed
    const spy = vi.spyOn(s, 'tryConnectSilent').mockResolvedValue(true)

    await s.gentleReattempt('test')

    expect(spy).not.toHaveBeenCalled()
  })

  it('does NOT re-attempt when already connected', async () => {
    const Service = await loadService()
    const s = new Service() as any
    s.autoConnectConfig.enabled = true
    s.state.connected = true
    const spy = vi.spyOn(s, 'tryConnectSilent').mockResolvedValue(true)

    await s.gentleReattempt('test')

    expect(spy).not.toHaveBeenCalled()
  })

  it('does NOT re-attempt after the user explicitly disconnected', async () => {
    const Service = await loadService()
    const s = new Service() as any
    s.autoConnectConfig.enabled = true
    s.userInitiatedDisconnect = true
    const spy = vi.spyOn(s, 'tryConnectSilent').mockResolvedValue(true)

    await s.gentleReattempt('test')

    expect(spy).not.toHaveBeenCalled()
  })

  it('does NOT re-attempt when no authorized device is attached', async () => {
    const Service = await loadService()
    getDevicesMock.mockResolvedValue([]) // nothing plugged in
    const s = new Service() as any
    s.autoConnectConfig.enabled = true
    const spy = vi.spyOn(s, 'tryConnectSilent').mockResolvedValue(true)

    await s.gentleReattempt('test')

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('HiDockDeviceService — quick recovery after an unexpected drop (2026-07-22)', () => {
  // The HiDock drops USB transiently in normal use — notably when a recording
  // STOPS (firmware re-enumerates). The 3-minute watch is too slow for the
  // post-recording sync; handleDisconnect must schedule guarded re-attempts
  // within seconds.

  it('schedules exactly one guarded re-attempt at +8s after handleDisconnect', async () => {
    vi.useFakeTimers()
    try {
      const Service = await loadService()
      const s = new Service() as any
      s.autoConnectConfig.enabled = true
      s.userInitiatedDisconnect = false
      s.state.connected = true
      const spy = vi.spyOn(s, 'tryConnectSilent').mockResolvedValue(true)

      s.handleDisconnect()
      expect(spy).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(8_500)
      expect(spy).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(22_000)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT schedule quick recovery after a user-initiated disconnect', async () => {
    vi.useFakeTimers()
    try {
      const Service = await loadService()
      const s = new Service() as any
      s.autoConnectConfig.enabled = true
      s.userInitiatedDisconnect = true // explicit user action — respect it
      s.state.connected = true
      const spy = vi.spyOn(s, 'tryConnectSilent').mockResolvedValue(true)

      s.handleDisconnect()
      await vi.advanceTimersByTimeAsync(40_000)

      expect(spy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a completed connect cancels the pending quick-recovery attempts', async () => {
    vi.useFakeTimers()
    try {
      const Service = await loadService()
      const s = new Service() as any
      s.autoConnectConfig.enabled = true
      s.userInitiatedDisconnect = false
      s.state.connected = true
      const spy = vi.spyOn(s, 'tryConnectSilent').mockResolvedValue(true)

      s.handleDisconnect()
      // Device reconnects (onconnect → handleConnect) before the timers fire.
      // handleConnect will fail its init steps against this bare mock — fine,
      // the timer-clear runs first.
      await s.handleConnect()
      spy.mockClear()

      await vi.advanceTimersByTimeAsync(40_000)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HiDockDeviceService — honest failure state', () => {
  it('marks connectFailed with a busy hint when a present device will not open (boot scenario)', async () => {
    const Service = await loadService()
    tryConnectMock.mockResolvedValue(false) // device present but busy → open fails
    const service = new Service()
    const s = service as any

    const statuses: any[] = []
    service.onStatusChange((st: any) => statuses.push(st))

    await s.tryConnectSilent()

    const failed = statuses.find((st) => st.connectFailed)
    expect(failed).toBeTruthy()
    expect(failed.devicePresent).toBe(true)
    expect(s.lastConnectFailureAt).toBeGreaterThan(0)
  })

  it('a later successful re-attempt clears the failed flag (fresh status has no connectFailed)', async () => {
    const Service = await loadService()
    const service = new Service()
    const s = service as any

    // Simulate a prior failure.
    s.markConnectFailure(true)
    expect(s.connectionStatus.connectFailed).toBe(true)

    // A normal status update (e.g. the retry beginning) carries no failed flag.
    s.updateStatus('requesting', 'Requesting…', 5)
    expect(s.connectionStatus.connectFailed).toBeUndefined()
  })
})
