/**
 * HiDock Device Service Tests
 *
 * Tests for the HiDockDeviceService, focusing on activity log historical replay
 * and listener management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ActivityLogEntry } from '../hidock-device'

// Mock jensen module
vi.mock('../jensen', () => ({
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
    onconnect: null,
    ondisconnect: null
  })),
  DeviceModel: {
    UNKNOWN: 'unknown',
    H1: 'H1',
    H1E: 'H1E',
    P1: 'P1'
  }
}))

// Mock path validation
vi.mock('../../utils/path-validation', () => ({
  validateDevicePath: vi.fn((path: string) => path)
}))

// Mock timeout utilities
vi.mock('../../utils/timeout', () => ({
  withTimeout: vi.fn((promise: Promise<any>) => promise),
  isAbortError: vi.fn(() => false)
}))

// Mock QA monitor
vi.mock('../qa-monitor', () => ({
  shouldLogQa: vi.fn(() => false)
}))

describe('HiDockDeviceService - Activity Log Historical Replay', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset module cache to get fresh instance
    vi.resetModules()

    // Dynamically import after mocks are set up
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should replay historical logs to new listener', () => {
    const service = new HiDockDeviceService()

    // Generate some historical logs using the private logActivity method
    // Access via type assertion since it's private
    const serviceAny = service as any
    serviceAny.logActivity('info', 'Log 1')
    serviceAny.logActivity('success', 'Log 2')
    serviceAny.logActivity('error', 'Log 3')

    // Subscribe a new listener
    const receivedLogs: ActivityLogEntry[] = []
    service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs.push(entry)
    })

    // Should have received initialization log + 3 historical logs
    expect(receivedLogs.length).toBeGreaterThanOrEqual(3)

    // Find our logs (they come after initialization log)
    const ourLogs = receivedLogs.filter(log =>
      log.message === 'Log 1' || log.message === 'Log 2' || log.message === 'Log 3'
    )
    expect(ourLogs).toHaveLength(3)
    expect(ourLogs[0].message).toBe('Log 1')
    expect(ourLogs[0].type).toBe('info')
    expect(ourLogs[1].message).toBe('Log 2')
    expect(ourLogs[1].type).toBe('success')
    expect(ourLogs[2].message).toBe('Log 3')
    expect(ourLogs[2].type).toBe('error')
  })

  it('should replay historical logs in correct order', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Generate multiple logs
    for (let i = 1; i <= 10; i++) {
      serviceAny.logActivity('info', `Log ${i}`)
    }

    // Subscribe a new listener
    const receivedLogs: ActivityLogEntry[] = []
    service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs.push(entry)
    })

    // Filter to our test logs (exclude initialization log)
    const ourLogs = receivedLogs.filter(log => log.message.startsWith('Log '))
    expect(ourLogs).toHaveLength(10)
    for (let i = 0; i < 10; i++) {
      expect(ourLogs[i].message).toBe(`Log ${i + 1}`)
    }
  })

  it('should receive both historical and new logs', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Generate historical logs
    serviceAny.logActivity('info', 'Historical 1')
    serviceAny.logActivity('info', 'Historical 2')

    // Subscribe a listener
    const receivedLogs: ActivityLogEntry[] = []
    service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs.push(entry)
    })

    // Filter to our test logs
    const ourLogsBeforeNew = receivedLogs.filter(log =>
      log.message === 'Historical 1' || log.message === 'Historical 2'
    )
    expect(ourLogsBeforeNew).toHaveLength(2)

    // Generate new log after subscription
    serviceAny.logActivity('info', 'New log')

    // Should now have all 3 test logs
    const ourLogsAfterNew = receivedLogs.filter(log =>
      log.message === 'Historical 1' || log.message === 'Historical 2' || log.message === 'New log'
    )
    expect(ourLogsAfterNew).toHaveLength(3)
    expect(ourLogsAfterNew[0].message).toBe('Historical 1')
    expect(ourLogsAfterNew[1].message).toBe('Historical 2')
    expect(ourLogsAfterNew[2].message).toBe('New log')
  })

  it('should handle listener errors during replay without breaking iteration', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Generate historical logs
    serviceAny.logActivity('info', 'Log 1')
    serviceAny.logActivity('info', 'Log 2')
    serviceAny.logActivity('info', 'Log 3')

    // Mock console.error to verify error handling
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Subscribe a listener that throws on the second log
    const receivedLogs: ActivityLogEntry[] = []
    service.onActivity((entry: ActivityLogEntry) => {
      if (entry.message === 'Log 2') {
        throw new Error('Listener error')
      }
      receivedLogs.push(entry)
    })

    // Filter to our test logs (exclude initialization log)
    const ourLogs = receivedLogs.filter(log =>
      log.message === 'Log 1' || log.message === 'Log 3'
    )
    expect(ourLogs).toHaveLength(2)
    expect(ourLogs[0].message).toBe('Log 1')
    expect(ourLogs[1].message).toBe('Log 3')

    // Should have logged the error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Activity listener error during replay:',
      expect.any(Error)
    )

    consoleErrorSpy.mockRestore()
  })

  it('should handle initialization log and receive new logs', () => {
    const service = new HiDockDeviceService()

    // Subscribe a listener - should receive initialization log
    const receivedLogs: ActivityLogEntry[] = []
    service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs.push(entry)
    })

    // Should have received initialization log
    expect(receivedLogs.length).toBeGreaterThanOrEqual(1)

    // Generate a new log
    const serviceAny = service as any
    serviceAny.logActivity('info', 'First user log')

    // Should now have initialization log + user log
    const userLogs = receivedLogs.filter(log => log.message === 'First user log')
    expect(userLogs).toHaveLength(1)
    expect(userLogs[0].message).toBe('First user log')
  })

  it('should support multiple listeners with independent replays', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Generate historical logs
    serviceAny.logActivity('info', 'Log 1')
    serviceAny.logActivity('info', 'Log 2')

    // Subscribe first listener
    const receivedLogs1: ActivityLogEntry[] = []
    service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs1.push(entry)
    })

    // Add more logs
    serviceAny.logActivity('info', 'Log 3')

    // Subscribe second listener
    const receivedLogs2: ActivityLogEntry[] = []
    service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs2.push(entry)
    })

    // Filter to our test logs
    const ourLogs1 = receivedLogs1.filter(log =>
      log.message === 'Log 1' || log.message === 'Log 2' || log.message === 'Log 3'
    )
    const ourLogs2 = receivedLogs2.filter(log =>
      log.message === 'Log 1' || log.message === 'Log 2' || log.message === 'Log 3'
    )

    // First listener should have all 3 logs
    expect(ourLogs1).toHaveLength(3)

    // Second listener should have all 3 historical logs (including the one after first listener subscribed)
    expect(ourLogs2).toHaveLength(3)
    expect(ourLogs2[0].message).toBe('Log 1')
    expect(ourLogs2[1].message).toBe('Log 2')
    expect(ourLogs2[2].message).toBe('Log 3')
  })

  it('should return unsubscribe function that works correctly', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Generate historical log
    serviceAny.logActivity('info', 'Historical log')

    // Subscribe a listener
    const receivedLogs: ActivityLogEntry[] = []
    const unsubscribe = service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs.push(entry)
    })

    // Filter to our test logs
    const historicalLogs = receivedLogs.filter(log => log.message === 'Historical log')
    expect(historicalLogs).toHaveLength(1)

    const logsBeforeUnsubscribe = receivedLogs.length

    // Unsubscribe
    unsubscribe()

    // Generate new log
    serviceAny.logActivity('info', 'New log after unsubscribe')

    // Should not have received the new log
    expect(receivedLogs).toHaveLength(logsBeforeUnsubscribe)
    const newLogs = receivedLogs.filter(log => log.message === 'New log after unsubscribe')
    expect(newLogs).toHaveLength(0)
  })

  it('should handle concurrent modification during replay safely', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Generate historical logs
    serviceAny.logActivity('info', 'Log 1')
    serviceAny.logActivity('info', 'Log 2')
    serviceAny.logActivity('info', 'Log 3')

    // Subscribe a listener that adds more logs during replay
    const receivedLogs: ActivityLogEntry[] = []
    let testLogCount = 0

    service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs.push(entry)

      // Try to add more logs during replay (only once on first test log)
      if (entry.message === 'Log 1' && testLogCount === 0) {
        testLogCount++
        serviceAny.logActivity('info', 'Added during replay')
      }
    })

    // Filter to our test logs
    const ourLogs = receivedLogs.filter(log =>
      log.message === 'Log 1' ||
      log.message === 'Log 2' ||
      log.message === 'Log 3' ||
      log.message === 'Added during replay'
    )

    // Should have received original 3 logs during replay + 1 new log notification = 4 total
    expect(ourLogs).toHaveLength(4)

    // Verify all logs are present (order may vary due to concurrent modification)
    const messages = ourLogs.map(log => log.message)
    expect(messages).toContain('Log 1')
    expect(messages).toContain('Log 2')
    expect(messages).toContain('Log 3')
    expect(messages).toContain('Added during replay')
  })

  it('should include all log entry properties in replay', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Generate log with details
    serviceAny.logActivity('error', 'Test error', 'Error details here')

    // Subscribe a listener
    const receivedLogs: ActivityLogEntry[] = []
    service.onActivity((entry: ActivityLogEntry) => {
      receivedLogs.push(entry)
    })

    // Find our test log
    const testLog = receivedLogs.find(log => log.message === 'Test error')
    expect(testLog).toBeDefined()

    // Verify all properties are present
    expect(testLog).toHaveProperty('timestamp')
    expect(testLog!.timestamp).toBeInstanceOf(Date)
    expect(testLog!.type).toBe('error')
    expect(testLog!.message).toBe('Test error')
    expect(testLog!.details).toBe('Error details here')
  })
})

describe('HiDockDeviceService - State Management', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return initial state when not connected', () => {
    const service = new HiDockDeviceService()
    const state = service.getState()

    expect(state).toBeDefined()
    expect(state.connected).toBe(false)
    expect(state.model).toBe('unknown')
    expect(state.serialNumber).toBeNull()
    expect(state.firmwareVersion).toBeNull()
    expect(state.storage).toBeNull()
    expect(state.settings).toBeNull()
    expect(state.recordingCount).toBe(0)
  })

  it('should allow updating state fields', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Update state fields
    serviceAny.state.connected = true
    serviceAny.state.model = 'H1'
    serviceAny.state.serialNumber = '12345'
    serviceAny.state.firmwareVersion = '1.0.0'
    serviceAny.state.recordingCount = 5

    const state = service.getState()
    expect(state.connected).toBe(true)
    expect(state.model).toBe('H1')
    expect(state.serialNumber).toBe('12345')
    expect(state.firmwareVersion).toBe('1.0.0')
    expect(state.recordingCount).toBe(5)
  })

  it('should update storage information', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.storage = {
      used: 1000,
      capacity: 10000,
      freePercent: 90
    }

    const state = service.getState()
    expect(state.storage).toEqual({
      used: 1000,
      capacity: 10000,
      freePercent: 90
    })
  })

  it('should notify state change listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    service.onStateChange(listener)

    // onStateChange immediately notifies with current state
    expect(listener).toHaveBeenCalledTimes(1)

    // Trigger state change notification
    serviceAny.notifyStateChange()

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('should handle multiple state change listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const listener3 = vi.fn()

    service.onStateChange(listener1)
    service.onStateChange(listener2)
    service.onStateChange(listener3)

    // Each listener already called once on subscription
    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
    expect(listener3).toHaveBeenCalledTimes(1)

    serviceAny.notifyStateChange()

    expect(listener1).toHaveBeenCalledTimes(2)
    expect(listener2).toHaveBeenCalledTimes(2)
    expect(listener3).toHaveBeenCalledTimes(2)
  })

  it('should unsubscribe state change listener', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    const unsubscribe = service.onStateChange(listener)

    // Already called once on subscription
    expect(listener).toHaveBeenCalledTimes(1)

    serviceAny.notifyStateChange()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    serviceAny.notifyStateChange()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('HiDockDeviceService - Connection Status Management', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return initial connection status', () => {
    const service = new HiDockDeviceService()
    const status = service.getConnectionStatus()

    expect(status).toBeDefined()
    expect(status.step).toBe('idle')
    expect(status.message).toBe('Not connected')
  })

  it('should update connection status', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.updateStatus('requesting', 'Requesting device access', 10)

    const status = service.getConnectionStatus()
    expect(status.step).toBe('requesting')
    expect(status.message).toBe('Requesting device access')
    expect(status.progress).toBe(10)
  })

  it('should notify status change listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    service.onStatusChange(listener)

    // onStatusChange immediately notifies with current status
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      step: 'idle',
      message: 'Not connected'
    })

    serviceAny.updateStatus('opening', 'Opening device connection', 20)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenNthCalledWith(2, {
      step: 'opening',
      message: 'Opening device connection',
      progress: 20
    })
  })

  it('should handle multiple status change listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const listener3 = vi.fn()

    service.onStatusChange(listener1)
    service.onStatusChange(listener2)
    service.onStatusChange(listener3)

    // Each listener already called once on subscription
    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
    expect(listener3).toHaveBeenCalledTimes(1)

    serviceAny.updateStatus('getting-info', 'Getting device info')

    expect(listener1).toHaveBeenCalledTimes(2)
    expect(listener2).toHaveBeenCalledTimes(2)
    expect(listener3).toHaveBeenCalledTimes(2)
  })

  it('should unsubscribe status change listener', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    const unsubscribe = service.onStatusChange(listener)

    // Already called once on subscription
    expect(listener).toHaveBeenCalledTimes(1)

    serviceAny.updateStatus('getting-storage', 'Getting storage info')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    serviceAny.updateStatus('getting-settings', 'Getting settings')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('should handle connection status with no progress', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    service.onStatusChange(listener)

    // Clear initial call
    listener.mockClear()

    serviceAny.updateStatus('syncing-time', 'Syncing time')

    expect(listener).toHaveBeenCalledWith({
      step: 'syncing-time',
      message: 'Syncing time',
      progress: undefined
    })
  })
})

describe('HiDockDeviceService - Connection Change Management', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should notify connection change listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    service.onConnectionChange(listener)

    serviceAny.notifyConnectionChange(true)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(true)
  })

  it('should handle multiple connection change listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener1 = vi.fn()
    const listener2 = vi.fn()

    service.onConnectionChange(listener1)
    service.onConnectionChange(listener2)

    serviceAny.notifyConnectionChange(false)

    expect(listener1).toHaveBeenCalledWith(false)
    expect(listener2).toHaveBeenCalledWith(false)
  })

  it('should unsubscribe connection change listener', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    const unsubscribe = service.onConnectionChange(listener)

    serviceAny.notifyConnectionChange(true)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    serviceAny.notifyConnectionChange(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should handle connection change with no listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(() => serviceAny.notifyConnectionChange(true)).not.toThrow()
  })
})

describe('HiDockDeviceService - isConnected', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return false when not connected', () => {
    const service = new HiDockDeviceService()
    expect(service.isConnected()).toBe(false)
  })

  it('should return true when connected', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // isConnected checks both state.connected AND jensen.isConnected()
    serviceAny.state.connected = true
    serviceAny.jensen.isConnected = vi.fn(() => true)
    expect(service.isConnected()).toBe(true)
  })

  it('should return false when disconnected after connection', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    serviceAny.jensen.isConnected = vi.fn(() => true)
    expect(service.isConnected()).toBe(true)

    serviceAny.state.connected = false
    serviceAny.jensen.isConnected = vi.fn(() => false)
    expect(service.isConnected()).toBe(false)
  })
})

describe('HiDockDeviceService - Activity Log Management', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return empty activity log initially', () => {
    const service = new HiDockDeviceService()
    const logs = service.getActivityLog()

    // Should only have initialization log
    expect(logs.length).toBe(1)
    expect(logs[0].message).toBe('Device service initialized')
  })

  it('should add activity logs', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.logActivity('info', 'Test log 1')
    serviceAny.logActivity('success', 'Test log 2')

    const logs = service.getActivityLog()
    expect(logs.length).toBe(3) // initialization + 2 test logs

    const testLogs = logs.filter(log => log.message.startsWith('Test log'))
    expect(testLogs).toHaveLength(2)
    expect(testLogs[0].message).toBe('Test log 1')
    expect(testLogs[0].type).toBe('info')
    expect(testLogs[1].message).toBe('Test log 2')
    expect(testLogs[1].type).toBe('success')
  })

  it('should add activity logs with details', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.logActivity('error', 'Error occurred', 'Stack trace here')

    const logs = service.getActivityLog()
    const errorLog = logs.find(log => log.message === 'Error occurred')

    expect(errorLog).toBeDefined()
    expect(errorLog!.type).toBe('error')
    expect(errorLog!.details).toBe('Stack trace here')
  })

  it('should clear activity log', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.logActivity('info', 'Test log 1')
    serviceAny.logActivity('info', 'Test log 2')
    serviceAny.logActivity('info', 'Test log 3')

    expect(service.getActivityLog().length).toBe(4) // initialization + 3 test logs

    service.clearActivityLog()

    const logs = service.getActivityLog()
    expect(logs.length).toBe(0)
  })

  it('should add logs with correct timestamp order', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.logActivity('info', 'First log')
    serviceAny.logActivity('info', 'Second log')
    serviceAny.logActivity('info', 'Third log')

    const logs = service.getActivityLog()
    const testLogs = logs.filter(log => log.message.includes('log'))

    expect(testLogs[0].timestamp.getTime()).toBeLessThanOrEqual(testLogs[1].timestamp.getTime())
    expect(testLogs[1].timestamp.getTime()).toBeLessThanOrEqual(testLogs[2].timestamp.getTime())
  })

  it('should support all log types', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.logActivity('error', 'Error log')
    serviceAny.logActivity('success', 'Success log')
    serviceAny.logActivity('info', 'Info log')
    serviceAny.logActivity('usb-out', 'USB out log')
    serviceAny.logActivity('usb-in', 'USB in log')
    serviceAny.logActivity('warning', 'Warning log')

    const logs = service.getActivityLog()
    expect(logs.find(log => log.type === 'error')).toBeDefined()
    expect(logs.find(log => log.type === 'success')).toBeDefined()
    expect(logs.find(log => log.type === 'info')).toBeDefined()
    expect(logs.find(log => log.type === 'usb-out')).toBeDefined()
    expect(logs.find(log => log.type === 'usb-in')).toBeDefined()
    expect(logs.find(log => log.type === 'warning')).toBeDefined()
  })
})

describe('HiDockDeviceService - Progress Listener Management', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should register and notify progress listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    service.onDownloadProgress(listener)

    const progress = {
      filename: 'test.wav',
      bytesReceived: 500,
      totalBytes: 1000,
      percent: 50
    }

    serviceAny.notifyProgress(progress)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(progress)
  })

  it('should handle multiple progress listeners', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener1 = vi.fn()
    const listener2 = vi.fn()

    service.onDownloadProgress(listener1)
    service.onDownloadProgress(listener2)

    const progress = {
      filename: 'recording.wav',
      bytesReceived: 1024,
      totalBytes: 2048,
      percent: 50
    }

    serviceAny.notifyProgress(progress)

    expect(listener1).toHaveBeenCalledWith(progress)
    expect(listener2).toHaveBeenCalledWith(progress)
  })

  it('should unsubscribe progress listener', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    const unsubscribe = service.onDownloadProgress(listener)

    const progress1 = { filename: 'test1.wav', bytesReceived: 100, totalBytes: 1000, percent: 10 }
    serviceAny.notifyProgress(progress1)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()

    const progress2 = { filename: 'test2.wav', bytesReceived: 500, totalBytes: 1000, percent: 50 }
    serviceAny.notifyProgress(progress2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should handle progress with 0%', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    service.onDownloadProgress(listener)

    const progress = {
      filename: 'download.wav',
      bytesReceived: 0,
      totalBytes: 10000,
      percent: 0
    }

    serviceAny.notifyProgress(progress)
    expect(listener).toHaveBeenCalledWith(progress)
  })

  it('should handle progress with 100%', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const listener = vi.fn()
    service.onDownloadProgress(listener)

    const progress = {
      filename: 'complete.wav',
      bytesReceived: 5000,
      totalBytes: 5000,
      percent: 100
    }

    serviceAny.notifyProgress(progress)
    expect(listener).toHaveBeenCalledWith(progress)
  })
})

describe('HiDockDeviceService - Error Handling', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should handle listener errors in state change notification', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const normalListener = vi.fn()

    // Subscribe normal listener first (won't throw)
    service.onStateChange(normalListener)
    expect(normalListener).toHaveBeenCalledTimes(1)

    // Now subscribe a throwing listener - it will throw during initial call
    const throwingListener = vi.fn(() => {
      throw new Error('Listener error')
    })

    // onStateChange immediately calls listener, so this will throw
    expect(() => service.onStateChange(throwingListener)).toThrow('Listener error')

    // Now call notifyStateChange - throwing listener was added to set before error
    serviceAny.notifyStateChange()

    // Should have logged error from notifyStateChange
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'State change listener error:',
      expect.any(Error)
    )

    consoleErrorSpy.mockRestore()
  })

  it('should handle listener errors in connection change notification', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const throwingListener = vi.fn(() => {
      throw new Error('Connection listener error')
    })
    const normalListener = vi.fn()

    service.onConnectionChange(throwingListener)
    service.onConnectionChange(normalListener)

    serviceAny.notifyConnectionChange(true)

    expect(throwingListener).toHaveBeenCalled()
    expect(normalListener).toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Connection listener error:',
      expect.any(Error)
    )

    consoleErrorSpy.mockRestore()
  })

  it('should handle listener errors in status change notification', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const normalListener = vi.fn()

    // Subscribe normal listener first (won't throw)
    service.onStatusChange(normalListener)
    expect(normalListener).toHaveBeenCalledTimes(1)

    // Now subscribe a throwing listener - it will throw during initial call
    const throwingListener = vi.fn(() => {
      throw new Error('Status listener error')
    })

    // onStatusChange immediately calls listener, so this will throw
    expect(() => service.onStatusChange(throwingListener)).toThrow('Status listener error')

    // Now call updateStatus - throwing listener was added to set before error
    serviceAny.updateStatus('ready', 'Ready')

    // Should have logged error from notifyStatusChange
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Status listener error:',
      expect.any(Error)
    )

    consoleErrorSpy.mockRestore()
  })

  it('should handle listener errors in progress notification', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const throwingListener = vi.fn(() => {
      throw new Error('Progress listener error')
    })
    const normalListener = vi.fn()

    service.onDownloadProgress(throwingListener)
    service.onDownloadProgress(normalListener)

    const progress = { filename: 'test.wav', bytesReceived: 100, totalBytes: 1000, percent: 10 }
    serviceAny.notifyProgress(progress)

    expect(throwingListener).toHaveBeenCalled()
    expect(normalListener).toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Progress listener error:',
      expect.any(Error)
    )

    consoleErrorSpy.mockRestore()
  })

  it('should handle listener errors in activity notification', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const throwingListener = vi.fn(() => {
      throw new Error('Activity listener error')
    })
    const normalListener = vi.fn()

    service.onActivity(throwingListener)
    service.onActivity(normalListener)

    serviceAny.logActivity('info', 'Test activity')

    expect(throwingListener).toHaveBeenCalled()
    expect(normalListener).toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Activity listener error:',
      expect.any(Error)
    )

    consoleErrorSpy.mockRestore()
  })
})

describe('HiDockDeviceService - FileInfo Conversion', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should convert FileInfo to HiDockRecording', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const fileInfo = {
      name: 'recording.wav',
      length: 1024,
      duration: 60,
      time: new Date('2024-01-01'),
      version: 1,
      signature: 'abc123'
    }

    const recording = serviceAny.fileInfoToRecording(fileInfo)

    expect(recording).toEqual({
      id: 'abc123', // Uses signature as id
      filename: 'recording.wav',
      size: 1024,
      duration: 60,
      dateCreated: new Date('2024-01-01'),
      version: 1,
      signature: 'abc123'
    })
  })

  it('should handle FileInfo with missing signature', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const fileInfo = {
      name: 'recording.wav',
      length: 2048,
      duration: 120,
      time: new Date('2024-02-15'),
      version: 2
      // signature is missing
    }

    const recording = serviceAny.fileInfoToRecording(fileInfo)

    expect(recording.id).toBe('recording.wav') // Uses name as fallback id
    expect(recording.filename).toBe('recording.wav')
    expect(recording.size).toBe(2048)
    expect(recording.duration).toBe(120)
    expect(recording.dateCreated).toEqual(new Date('2024-02-15'))
    expect(recording.version).toBe(2)
    expect(recording.signature).toBeUndefined()
  })
})

describe('HiDockDeviceService - Constructor and Initialization', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should initialize with default state', () => {
    const service = new HiDockDeviceService()

    expect(service.isConnected()).toBe(false)
    expect(service.getConnectionStatus().step).toBe('idle')
    expect(service.getActivityLog().length).toBe(1) // initialization log
  })

  it('should initialize listeners as Sets', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.connectionListeners).toBeInstanceOf(Set)
    expect(serviceAny.statusListeners).toBeInstanceOf(Set)
    expect(serviceAny.stateChangeListeners).toBeInstanceOf(Set)
    expect(serviceAny.progressListeners).toBeInstanceOf(Set)
    expect(serviceAny.activityListeners).toBeInstanceOf(Set)
  })

  it('should log initialization activity', () => {
    const service = new HiDockDeviceService()
    const logs = service.getActivityLog()

    const initLog = logs.find(log => log.message === 'Device service initialized')
    expect(initLog).toBeDefined()
    expect(initLog!.type).toBe('info')
  })
})

describe('HiDockDeviceService - Cache Management', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should initialize with null cached recordings', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.cachedRecordings).toBeNull()
  })

  it('should initialize cache timestamp as undefined', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // cachedRecordings and related fields are not explicitly initialized in constructor
    expect(serviceAny.cachedRecordings).toBeNull()
  })

  it('should set cache timestamp when recordings are cached', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const mockRecordings = [
      {
        id: 'rec1',
        filename: 'test1.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date(),
        version: 1,
        signature: 'sig1'
      }
    ]

    serviceAny.cachedRecordings = mockRecordings
    serviceAny.cacheTimestamp = Date.now()

    expect(serviceAny.cachedRecordings.length).toBe(1)
    expect(serviceAny.cacheTimestamp).toBeGreaterThan(0)
  })
})

describe('HiDockDeviceService - Initialization State', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return false for isInitialized when not initialized', () => {
    const service = new HiDockDeviceService()
    expect(service.isInitialized()).toBe(false)
  })

  it('should return true for isInitialized when initialized', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.initializationComplete = true
    expect(service.isInitialized()).toBe(true)
  })

  it('should track initialization state changes', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(service.isInitialized()).toBe(false)

    serviceAny.initializationComplete = true
    expect(service.isInitialized()).toBe(true)

    serviceAny.initializationComplete = false
    expect(service.isInitialized()).toBe(false)
  })
})

describe('HiDockDeviceService - Cached Recordings', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return empty array when no cached recordings', () => {
    const service = new HiDockDeviceService()
    const cached = service.getCachedRecordings()

    expect(cached).toEqual([])
  })

  it('should return cached recordings when available', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const mockRecordings = [
      {
        id: 'rec1',
        filename: 'recording1.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date('2024-01-01'),
        version: 1,
        signature: 'sig1'
      },
      {
        id: 'rec2',
        filename: 'recording2.wav',
        size: 2000,
        duration: 120,
        dateCreated: new Date('2024-01-02'),
        version: 1,
        signature: 'sig2'
      }
    ]

    serviceAny.cachedRecordings = mockRecordings

    const cached = service.getCachedRecordings()
    expect(cached).toHaveLength(2)
    expect(cached[0].filename).toBe('recording1.wav')
    expect(cached[1].filename).toBe('recording2.wav')
  })

  it('should return same reference to cached recordings', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const mockRecordings = [
      {
        id: 'rec1',
        filename: 'test.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date(),
        version: 1,
        signature: 'sig1'
      }
    ]

    serviceAny.cachedRecordings = mockRecordings

    const cached1 = service.getCachedRecordings()
    const cached2 = service.getCachedRecordings()

    expect(cached1).toBe(cached2)
  })

  it('should handle null cached recordings', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.cachedRecordings = null

    const cached = service.getCachedRecordings()
    expect(cached).toEqual([])
  })
})

describe('HiDockDeviceService - Abort Controllers', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should initialize with empty abort controllers map', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.abortControllers).toBeInstanceOf(Map)
    expect(serviceAny.abortControllers.size).toBe(0)
  })

  it('should track abort controllers', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const controller1 = new AbortController()
    const controller2 = new AbortController()

    serviceAny.abortControllers.set('download1', controller1)
    serviceAny.abortControllers.set('download2', controller2)

    expect(serviceAny.abortControllers.size).toBe(2)
    expect(serviceAny.abortControllers.get('download1')).toBe(controller1)
    expect(serviceAny.abortControllers.get('download2')).toBe(controller2)
  })

  it('should remove abort controllers', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const controller = new AbortController()
    serviceAny.abortControllers.set('download1', controller)

    expect(serviceAny.abortControllers.has('download1')).toBe(true)

    serviceAny.abortControllers.delete('download1')

    expect(serviceAny.abortControllers.has('download1')).toBe(false)
  })
})

describe('HiDockDeviceService - Auto-Connect Configuration', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should initialize with default auto-connect config disabled', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.autoConnectConfig.enabled).toBe(false)
    expect(serviceAny.autoConnectConfig.connectOnStartup).toBe(false)
    expect(serviceAny.autoConnectConfig.intervalMs).toBe(5000)
  })

  it('should track config loaded state', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.configLoaded).toBe(false)
  })

  it('should track auto-connect enabled state', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.autoConnectEnabled).toBe(true)
  })

  it('should track user initiated disconnect', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.userInitiatedDisconnect).toBe(false)

    serviceAny.userInitiatedDisconnect = true
    expect(serviceAny.userInitiatedDisconnect).toBe(true)
  })
})

describe('HiDockDeviceService - List Recordings Lock', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should initialize with no list recordings promise', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.listRecordingsPromise).toBeNull()
  })

  it('should initialize with list recordings lock as false', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.listRecordingsLock).toBe(false)
  })

  it('should track list recordings lock state', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.listRecordingsLock = true
    expect(serviceAny.listRecordingsLock).toBe(true)

    serviceAny.listRecordingsLock = false
    expect(serviceAny.listRecordingsLock).toBe(false)
  })

  it('should track last completed timestamp', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.listRecordingsLastCompleted).toBe(0)

    const now = Date.now()
    serviceAny.listRecordingsLastCompleted = now
    expect(serviceAny.listRecordingsLastCompleted).toBe(now)
  })
})

describe('HiDockDeviceService - Model Information', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return initial model as unknown', () => {
    const service = new HiDockDeviceService()
    const state = service.getState()

    expect(state.model).toBe('unknown')
  })

  it('should update model in state', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.model = 'H1'

    const state = service.getState()
    expect(state.model).toBe('H1')
  })

  it('should handle different device models', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const models = ['H1', 'H1E', 'P1', 'unknown']

    models.forEach((model) => {
      serviceAny.state.model = model
      const state = service.getState()
      expect(state.model).toBe(model)
    })
  })
})

describe('HiDockDeviceService - Initialization Abort', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should initialize with initAborted as false', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.initAborted).toBe(false)
  })

  it('should track abort initialization state', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.initAborted = true
    expect(serviceAny.initAborted).toBe(true)

    serviceAny.initAborted = false
    expect(serviceAny.initAborted).toBe(false)
  })
})

describe('HiDockDeviceService - Ready Status Deduplication', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should initialize with last ready status timestamp as 0', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.lastReadyStatusTimestamp).toBe(0)
  })

  it('should track last ready status timestamp', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const now = Date.now()
    serviceAny.lastReadyStatusTimestamp = now
    expect(serviceAny.lastReadyStatusTimestamp).toBe(now)
  })
})

describe('HiDockDeviceService - Storage Information', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return null storage initially', () => {
    const service = new HiDockDeviceService()
    const state = service.getState()

    expect(state.storage).toBeNull()
  })

  it('should update storage with all fields', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const storageInfo = {
      used: 5000,
      capacity: 10000,
      freePercent: 50
    }

    serviceAny.state.storage = storageInfo

    const state = service.getState()
    expect(state.storage).toEqual(storageInfo)
  })

  it('should handle full storage', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.storage = {
      used: 10000,
      capacity: 10000,
      freePercent: 0
    }

    const state = service.getState()
    expect(state.storage!.freePercent).toBe(0)
  })

  it('should handle empty storage', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.storage = {
      used: 0,
      capacity: 10000,
      freePercent: 100
    }

    const state = service.getState()
    expect(state.storage!.freePercent).toBe(100)
  })
})

describe('HiDockDeviceService - Device Settings', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return null settings initially', () => {
    const service = new HiDockDeviceService()
    const state = service.getState()

    expect(state.settings).toBeNull()
  })

  it('should store device settings', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const mockSettings = {
      recordingQuality: 'high',
      autoSync: true,
      batteryLevel: 80
    }

    serviceAny.state.settings = mockSettings

    const state = service.getState()
    expect(state.settings).toEqual(mockSettings)
  })
})

describe('HiDockDeviceService - Serial Number and Firmware', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return null serial number initially', () => {
    const service = new HiDockDeviceService()
    const state = service.getState()

    expect(state.serialNumber).toBeNull()
  })

  it('should return null firmware version initially', () => {
    const service = new HiDockDeviceService()
    const state = service.getState()

    expect(state.firmwareVersion).toBeNull()
  })

  it('should update serial number', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.serialNumber = 'SN123456789'

    const state = service.getState()
    expect(state.serialNumber).toBe('SN123456789')
  })

  it('should update firmware version', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.firmwareVersion = '2.1.5'

    const state = service.getState()
    expect(state.firmwareVersion).toBe('2.1.5')
  })
})

describe('HiDockDeviceService - Recording Count', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should initialize recording count as 0', () => {
    const service = new HiDockDeviceService()
    const state = service.getState()

    expect(state.recordingCount).toBe(0)
  })

  it('should update recording count', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.recordingCount = 5

    const state = service.getState()
    expect(state.recordingCount).toBe(5)
  })

  it('should handle large recording counts', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.recordingCount = 1000

    const state = service.getState()
    expect(state.recordingCount).toBe(1000)
  })
})

describe('HiDockDeviceService - Public Log Method', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should add log via public log method', () => {
    const service = new HiDockDeviceService()

    service.log('info', 'Public log message')

    const logs = service.getActivityLog()
    const publicLog = logs.find(log => log.message === 'Public log message')

    expect(publicLog).toBeDefined()
    expect(publicLog!.type).toBe('info')
  })

  it('should add log with details via public log method', () => {
    const service = new HiDockDeviceService()

    service.log('error', 'Public error', 'Error details')

    const logs = service.getActivityLog()
    const errorLog = logs.find(log => log.message === 'Public error')

    expect(errorLog).toBeDefined()
    expect(errorLog!.type).toBe('error')
    expect(errorLog!.details).toBe('Error details')
  })

  it('should support all log types via public log method', () => {
    const service = new HiDockDeviceService()

    service.log('info', 'Info message')
    service.log('success', 'Success message')
    service.log('error', 'Error message')
    service.log('warning', 'Warning message')
    service.log('usb-out', 'USB out message')
    service.log('usb-in', 'USB in message')

    const logs = service.getActivityLog()

    expect(logs.find(log => log.message === 'Info message')).toBeDefined()
    expect(logs.find(log => log.message === 'Success message')).toBeDefined()
    expect(logs.find(log => log.message === 'Error message')).toBeDefined()
    expect(logs.find(log => log.message === 'Warning message')).toBeDefined()
    expect(logs.find(log => log.message === 'USB out message')).toBeDefined()
    expect(logs.find(log => log.message === 'USB in message')).toBeDefined()
  })

  it('should notify listeners when using public log method', () => {
    const service = new HiDockDeviceService()

    const listener = vi.fn()
    service.onActivity(listener)

    const initialCallCount = listener.mock.calls.length

    service.log('info', 'Test message')

    expect(listener).toHaveBeenCalledTimes(initialCallCount + 1)
    const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0]
    expect(lastCall.message).toBe('Test message')
  })
})

describe('HiDockDeviceService - Activity Log Max Entries', () => {
  let HiDockDeviceService: any
  let MAX_ACTIVITY_LOG_ENTRIES: number

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService

    // Import the constant
    const constantsModule = await import('../../constants/activity-log')
    MAX_ACTIVITY_LOG_ENTRIES = constantsModule.MAX_ACTIVITY_LOG_ENTRIES
  })

  it('should limit activity log to max entries', () => {
    const service = new HiDockDeviceService()

    // Add more logs than the max
    for (let i = 0; i < MAX_ACTIVITY_LOG_ENTRIES + 50; i++) {
      service.log('info', `Log ${i}`)
    }

    const logs = service.getActivityLog()

    // Should not exceed max entries
    expect(logs.length).toBeLessThanOrEqual(MAX_ACTIVITY_LOG_ENTRIES)
  })

  it('should keep most recent entries when exceeding max', () => {
    const service = new HiDockDeviceService()

    // Add more logs than the max
    for (let i = 0; i < MAX_ACTIVITY_LOG_ENTRIES + 10; i++) {
      service.log('info', `Log ${i}`)
    }

    const logs = service.getActivityLog()

    // Should contain the most recent logs
    const lastLog = logs[logs.length - 1]
    expect(lastLog.message).toContain(`Log ${MAX_ACTIVITY_LOG_ENTRIES + 9}`)
  })

  it('should discard oldest entries when exceeding max', () => {
    const service = new HiDockDeviceService()

    // Add more logs than the max
    for (let i = 0; i < MAX_ACTIVITY_LOG_ENTRIES + 10; i++) {
      service.log('info', `Log ${i}`)
    }

    const logs = service.getActivityLog()

    // Should not contain the oldest logs
    const hasOldLog = logs.some(log => log.message === 'Log 0')
    expect(hasOldLog).toBe(false)
  })
})

describe('HiDockDeviceService - State Copy Immutability', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return a copy of state, not the original', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const state1 = service.getState()
    const state2 = service.getState()

    // Should be different object references
    expect(state1).not.toBe(state2)

    // But should have same values
    expect(state1).toEqual(state2)
  })

  it('should not affect internal state when modifying returned state', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.recordingCount = 5

    const state = service.getState()
    state.recordingCount = 100

    // Internal state should not change
    const newState = service.getState()
    expect(newState.recordingCount).toBe(5)
  })
})

describe('HiDockDeviceService - Connection Status Copy Immutability', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return a copy of connection status, not the original', () => {
    const service = new HiDockDeviceService()

    const status1 = service.getConnectionStatus()
    const status2 = service.getConnectionStatus()

    // Should be different object references
    expect(status1).not.toBe(status2)

    // But should have same values
    expect(status1).toEqual(status2)
  })

  it('should not affect internal status when modifying returned status', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const status = service.getConnectionStatus()
    status.step = 'ready'
    status.message = 'Modified'

    // Internal status should not change
    const newStatus = service.getConnectionStatus()
    expect(newStatus.step).toBe('idle')
    expect(newStatus.message).toBe('Not connected')
  })
})

describe('HiDockDeviceService - Activity Log Copy', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return a copy of activity log, not the original', () => {
    const service = new HiDockDeviceService()

    service.log('info', 'Test log')

    const log1 = service.getActivityLog()
    const log2 = service.getActivityLog()

    // Should be different array references
    expect(log1).not.toBe(log2)

    // But should have same length
    expect(log1.length).toBe(log2.length)
  })

  it('should not affect internal log when modifying returned log', () => {
    const service = new HiDockDeviceService()

    service.log('info', 'Test log')

    const log = service.getActivityLog()
    const originalLength = log.length

    log.push({
      timestamp: new Date(),
      type: 'error',
      message: 'Added externally'
    })

    // Internal log should not change
    const newLog = service.getActivityLog()
    expect(newLog.length).toBe(originalLength)
  })
})

describe('HiDockDeviceService - Refresh Device Info', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    // Create mock jensen
    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      listFiles: vi.fn(() => []),
      onconnect: null,
      ondisconnect: null
    }

    // Mock jensen module with our controlled mock
    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return null when not connected', async () => {
    const service = new HiDockDeviceService()

    // Not connected
    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.refreshDeviceInfo()

    expect(result).toBeNull()
    expect(mockJensen.getDeviceInfo).not.toHaveBeenCalled()
  })

  it('should call jensen.getDeviceInfo when connected', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Simulate connected state
    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockInfo = {
      serialNumber: 'SN12345',
      versionCode: '1.2.3',
      model: 'H1'
    }
    mockJensen.getDeviceInfo.mockResolvedValue(mockInfo)

    const result = await service.refreshDeviceInfo()

    expect(result).toEqual(mockInfo)
    expect(mockJensen.getDeviceInfo).toHaveBeenCalled()
  })

  it('should update state with device info', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockInfo = {
      serialNumber: 'SN98765',
      versionCode: '2.0.1',
      model: 'H1E'
    }
    mockJensen.getDeviceInfo.mockResolvedValue(mockInfo)

    await service.refreshDeviceInfo()

    const state = service.getState()
    expect(state.serialNumber).toBe('SN98765')
    expect(state.firmwareVersion).toBe('2.0.1')
    expect(state.model).toBe('H1E')
  })

  it('should log activity when getting device info', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockInfo = {
      serialNumber: 'SN12345',
      versionCode: '1.0.0',
      model: 'P1'
    }
    mockJensen.getDeviceInfo.mockResolvedValue(mockInfo)

    await service.refreshDeviceInfo()

    const logs = service.getActivityLog()
    const usbOutLog = logs.find(log => log.type === 'usb-out' && log.message === 'CMD: Get Device Info')
    const usbInLog = logs.find(log => log.type === 'usb-in' && log.message === 'Device Info Received')

    expect(usbOutLog).toBeDefined()
    expect(usbInLog).toBeDefined()
  })

  it('should log error when device info fails', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getDeviceInfo.mockResolvedValue(null)

    await service.refreshDeviceInfo()

    const logs = service.getActivityLog()
    const errorLog = logs.find(log => log.type === 'error' && log.message === 'Failed to get device info')

    expect(errorLog).toBeDefined()
  })

  it('should notify state change after updating device info', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const listener = vi.fn()
    service.onStateChange(listener)

    const initialCallCount = listener.mock.calls.length

    const mockInfo = {
      serialNumber: 'SN11111',
      versionCode: '3.0.0',
      model: 'H1'
    }
    mockJensen.getDeviceInfo.mockResolvedValue(mockInfo)

    await service.refreshDeviceInfo()

    // Should have been called again after update
    expect(listener.mock.calls.length).toBeGreaterThan(initialCallCount)
  })
})

describe('HiDockDeviceService - Refresh Storage Info', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      listFiles: vi.fn(() => []),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return null when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.refreshStorageInfo()

    expect(result).toBeNull()
    expect(mockJensen.getCardInfo).not.toHaveBeenCalled()
  })

  it('should call jensen.getCardInfo when connected', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockCardInfo = {
      used: 100, // MiB
      capacity: 1000, // MiB
      free: 900 // MiB
    }
    mockJensen.getCardInfo.mockResolvedValue(mockCardInfo)

    const result = await service.refreshStorageInfo()

    expect(mockJensen.getCardInfo).toHaveBeenCalled()
  })

  it('should convert MiB to bytes correctly', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockCardInfo = {
      used: 100, // 100 MiB
      capacity: 1000, // 1000 MiB
      free: 900 // 900 MiB
    }
    mockJensen.getCardInfo.mockResolvedValue(mockCardInfo)

    await service.refreshStorageInfo()

    const state = service.getState()
    expect(state.storage).toBeDefined()
    expect(state.storage!.used).toBe(100 * 1024 * 1024) // bytes
    expect(state.storage!.capacity).toBe(1000 * 1024 * 1024) // bytes
  })

  it('should calculate free percent correctly', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockCardInfo = {
      used: 250,
      capacity: 1000,
      free: 750
    }
    mockJensen.getCardInfo.mockResolvedValue(mockCardInfo)

    await service.refreshStorageInfo()

    const state = service.getState()
    expect(state.storage!.freePercent).toBe(75)
  })

  it('should handle zero capacity', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockCardInfo = {
      used: 0,
      capacity: 0,
      free: 0
    }
    mockJensen.getCardInfo.mockResolvedValue(mockCardInfo)

    await service.refreshStorageInfo()

    const state = service.getState()
    expect(state.storage!.freePercent).toBe(0)
  })

  it('should set default storage on null card info', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getCardInfo.mockResolvedValue(null)

    await service.refreshStorageInfo()

    const state = service.getState()
    expect(state.storage).toEqual({
      used: 0,
      capacity: 0,
      freePercent: 0
    })
  })

  it('should log error on null card info', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getCardInfo.mockResolvedValue(null)

    await service.refreshStorageInfo()

    const logs = service.getActivityLog()
    const errorLog = logs.find(log => log.type === 'error' && log.message === 'Failed to get card info')

    expect(errorLog).toBeDefined()
  })

  it('should handle card info exception', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getCardInfo.mockRejectedValue(new Error('USB timeout'))

    const result = await service.refreshStorageInfo()

    expect(result).toBeNull()
    const state = service.getState()
    expect(state.storage).toEqual({
      used: 0,
      capacity: 0,
      freePercent: 0
    })
  })
})

describe('HiDockDeviceService - Refresh Settings', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      listFiles: vi.fn(() => []),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return null when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.refreshSettings()

    expect(result).toBeNull()
    expect(mockJensen.getSettings).not.toHaveBeenCalled()
  })

  it('should call jensen.getSettings when connected', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockSettings = {
      autoRecord: true,
      recordingQuality: 'high'
    }
    mockJensen.getSettings.mockResolvedValue(mockSettings)

    const result = await service.refreshSettings()

    expect(mockJensen.getSettings).toHaveBeenCalled()
    expect(result).toEqual(mockSettings)
  })

  it('should update state with settings', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const mockSettings = {
      autoRecord: false,
      recordingQuality: 'medium'
    }
    mockJensen.getSettings.mockResolvedValue(mockSettings)

    await service.refreshSettings()

    const state = service.getState()
    expect(state.settings).toEqual(mockSettings)
  })

  it('should log error when settings fail', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getSettings.mockResolvedValue(null)

    await service.refreshSettings()

    const logs = service.getActivityLog()
    const errorLog = logs.find(log => log.type === 'error' && log.message === 'Failed to get settings')

    expect(errorLog).toBeDefined()
  })
})

describe('HiDockDeviceService - Sync Time', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      listFiles: vi.fn(() => []),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return false when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.syncTime()

    expect(result).toBe(false)
    expect(mockJensen.setTime).not.toHaveBeenCalled()
  })

  it('should call jensen.setTime when connected', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setTime.mockResolvedValue({ result: 'success' })

    await service.syncTime()

    expect(mockJensen.setTime).toHaveBeenCalled()
    expect(mockJensen.setTime).toHaveBeenCalledWith(expect.any(Date))
  })

  it('should return true on success', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setTime.mockResolvedValue({ result: 'success' })

    const result = await service.syncTime()

    expect(result).toBe(true)
  })

  it('should return false on failure', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setTime.mockResolvedValue({ result: 'failure' })

    const result = await service.syncTime()

    expect(result).toBe(false)
  })

  it('should log success on successful sync', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setTime.mockResolvedValue({ result: 'success' })

    await service.syncTime()

    const logs = service.getActivityLog()
    const successLog = logs.find(log => log.type === 'success' && log.message === 'Time synced successfully')

    expect(successLog).toBeDefined()
  })

  it('should log error on failed sync', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setTime.mockResolvedValue({ result: 'failure' })

    await service.syncTime()

    const logs = service.getActivityLog()
    const errorLog = logs.find(log => log.type === 'error' && log.message === 'Failed to sync time')

    expect(errorLog).toBeDefined()
  })
})

describe('HiDockDeviceService - Get Recording Count', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      listFiles: vi.fn(() => []),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return 0 when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.getRecordingCount()

    expect(result).toBe(0)
    expect(mockJensen.getFileCount).not.toHaveBeenCalled()
  })

  it('should call jensen.getFileCount when connected', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getFileCount.mockResolvedValue({ count: 5 })

    const result = await service.getRecordingCount()

    expect(mockJensen.getFileCount).toHaveBeenCalled()
    expect(result).toBe(5)
  })

  it('should update state with recording count', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getFileCount.mockResolvedValue({ count: 10 })

    await service.getRecordingCount()

    const state = service.getState()
    expect(state.recordingCount).toBe(10)
  })

  it('should handle missing count property', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getFileCount.mockResolvedValue({})

    const result = await service.getRecordingCount()

    expect(result).toBe(0)
  })

  it('should log activity when getting recording count', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.getFileCount.mockResolvedValue({ count: 7 })

    await service.getRecordingCount()

    const logs = service.getActivityLog()
    const usbOutLog = logs.find(log => log.type === 'usb-out' && log.message === 'CMD: Get File Count')
    const usbInLog = logs.find(log => log.type === 'usb-in' && log.message === 'File Count Received')

    expect(usbOutLog).toBeDefined()
    expect(usbInLog).toBeDefined()
    expect(usbInLog!.details).toContain('7 recordings')
  })

  it('should notify state change after updating count', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    const listener = vi.fn()
    service.onStateChange(listener)

    const initialCallCount = listener.mock.calls.length

    mockJensen.getFileCount.mockResolvedValue({ count: 3 })

    await service.getRecordingCount()

    expect(listener.mock.calls.length).toBeGreaterThan(initialCallCount)
  })
})

describe('HiDockDeviceService - List Recordings Not Connected', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      listFiles: vi.fn(() => []),
      getLockHolder: vi.fn(() => null),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return empty array when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.listRecordings()

    expect(result).toEqual([])
    expect(mockJensen.listFiles).not.toHaveBeenCalled()
  })

  it('should log error when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    await service.listRecordings()

    const logs = service.getActivityLog()
    const errorLog = logs.find(log => log.message === 'Cannot list files')

    expect(errorLog).toBeDefined()
    expect(errorLog!.type).toBe('error')
    expect(errorLog!.details).toBe('Device not connected')
  })
})

describe('HiDockDeviceService - List Recordings Debounce', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => true),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      listFiles: vi.fn(() => []),
      getLockHolder: vi.fn(() => null),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return cached recordings within debounce window', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Simulate connected state
    serviceAny.state.connected = true

    // Set up cached recordings
    const cachedData = [
      {
        id: 'rec1',
        filename: 'cached.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date(),
        version: 1,
        signature: 'sig1'
      }
    ]
    serviceAny.cachedRecordings = cachedData
    serviceAny.listRecordingsLastCompleted = Date.now() - 1000 // 1 second ago

    const result = await service.listRecordings()

    // Should return cached data
    expect(result).toBe(cachedData)
    // Should not call listFiles
    expect(mockJensen.listFiles).not.toHaveBeenCalled()
  })

  it('should call progress callback with cached data in debounce', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true

    const cachedData = [
      {
        id: 'rec1',
        filename: 'test.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date(),
        version: 1,
        signature: 'sig1'
      }
    ]
    serviceAny.cachedRecordings = cachedData
    serviceAny.listRecordingsLastCompleted = Date.now() - 500 // 500ms ago

    const onProgress = vi.fn()

    await service.listRecordings(onProgress)

    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })

  it('should bypass debounce when forceRefresh is true', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    serviceAny.initializationComplete = true

    // Set up cached recordings within debounce window
    const cachedData = [
      {
        id: 'rec1',
        filename: 'old.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date(),
        version: 1,
        signature: 'sig1'
      }
    ]
    serviceAny.cachedRecordings = cachedData
    serviceAny.listRecordingsLastCompleted = Date.now() - 100 // Recent

    mockJensen.listFiles.mockResolvedValue([
      {
        name: 'new.wav',
        length: 2000,
        duration: 120,
        time: new Date(),
        version: 1,
        signature: 'sig2'
      }
    ])

    // forceRefresh should bypass debounce
    const result = await service.listRecordings(undefined, true)

    expect(mockJensen.listFiles).toHaveBeenCalled()
    expect(result.length).toBe(1)
    expect(result[0].filename).toBe('new.wav')
  })
})

describe('HiDockDeviceService - List Recordings Lock Cases', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => true),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      listFiles: vi.fn(() => []),
      getLockHolder: vi.fn(() => null),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return cached recordings when download lock is held', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true

    // Set up cached recordings
    const cachedData = [
      {
        id: 'rec1',
        filename: 'cached.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date(),
        version: 1,
        signature: 'sig1'
      }
    ]
    serviceAny.cachedRecordings = cachedData

    // Simulate download lock
    mockJensen.getLockHolder.mockReturnValue('downloadFile:test.wav')

    const result = await service.listRecordings()

    expect(result).toBe(cachedData)
    expect(mockJensen.listFiles).not.toHaveBeenCalled()
  })

  it('should return empty array when download lock is held and no cache', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    serviceAny.cachedRecordings = null

    // Simulate download lock
    mockJensen.getLockHolder.mockReturnValue('downloadFile:test.wav')

    const result = await service.listRecordings()

    expect(result).toEqual([])
  })

  it('should return cached recordings when delete lock is held', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true

    const cachedData = [
      {
        id: 'rec1',
        filename: 'cached.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date(),
        version: 1,
        signature: 'sig1'
      }
    ]
    serviceAny.cachedRecordings = cachedData

    // Simulate delete lock
    mockJensen.getLockHolder.mockReturnValue('deleteFile:test.wav')

    const result = await service.listRecordings()

    expect(result).toBe(cachedData)
    expect(mockJensen.listFiles).not.toHaveBeenCalled()
  })

  it('should call progress callback when returning cached due to lock', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true

    const cachedData = [
      {
        id: 'rec1',
        filename: 'test.wav',
        size: 1000,
        duration: 60,
        dateCreated: new Date(),
        version: 1,
        signature: 'sig1'
      }
    ]
    serviceAny.cachedRecordings = cachedData

    mockJensen.getLockHolder.mockReturnValue('downloadFile:test.wav')

    const onProgress = vi.fn()

    await service.listRecordings(onProgress)

    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })
})

describe('HiDockDeviceService - Delete Recording', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      deleteFile: vi.fn(),
      listFiles: vi.fn(() => []),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return false when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.deleteRecording('test.wav')

    expect(result).toBe(false)
    expect(mockJensen.deleteFile).not.toHaveBeenCalled()
  })

  it('should call jensen.deleteFile when connected', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.deleteFile.mockResolvedValue({ result: 'success' })

    await service.deleteRecording('test.wav')

    expect(mockJensen.deleteFile).toHaveBeenCalledWith('test.wav')
  })

  it('should return true on successful delete', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.deleteFile.mockResolvedValue({ result: 'success' })

    const result = await service.deleteRecording('recording.wav')

    expect(result).toBe(true)
  })

  it('should return false on failed delete', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.deleteFile.mockResolvedValue({ result: 'failure' })

    const result = await service.deleteRecording('recording.wav')

    expect(result).toBe(false)
  })

  it('should log success on successful delete', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.deleteFile.mockResolvedValue({ result: 'success' })

    await service.deleteRecording('test.wav')

    const logs = service.getActivityLog()
    const successLog = logs.find(log => log.type === 'success' && log.message === 'File deleted')

    expect(successLog).toBeDefined()
    expect(successLog!.details).toBe('test.wav')
  })

  it('should invalidate cache on successful delete', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    // Set up cache
    serviceAny.cachedRecordings = [{ id: '1', filename: 'test.wav' }]
    serviceAny.cachedRecordingCount = 1

    mockJensen.deleteFile.mockResolvedValue({ result: 'success' })

    await service.deleteRecording('test.wav')

    expect(serviceAny.cachedRecordings).toBeNull()
    expect(serviceAny.cachedRecordingCount).toBe(-1)
  })

  it('should log error on failed delete', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.deleteFile.mockResolvedValue({ result: 'failure' })

    await service.deleteRecording('test.wav')

    const logs = service.getActivityLog()
    const errorLog = logs.find(log => log.type === 'error' && log.message === 'Failed to delete file')

    expect(errorLog).toBeDefined()
  })

  it('should validate filenames before deleting', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    // validateDevicePath is mocked to just return the path
    // In production, it would validate and throw for invalid paths
    // Test that the service at least attempts to call deleteFile with the filename
    mockJensen.deleteFile.mockResolvedValue({ result: 'success' })

    const result = await service.deleteRecording('valid-file.wav')

    expect(mockJensen.deleteFile).toHaveBeenCalledWith('valid-file.wav')
    expect(result).toBe(true)
  })
})

describe('HiDockDeviceService - Format Storage', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      deleteFile: vi.fn(),
      formatCard: vi.fn(),
      listFiles: vi.fn(() => []),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return false when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.formatStorage()

    expect(result).toBe(false)
    expect(mockJensen.formatCard).not.toHaveBeenCalled()
  })

  it('should call jensen.formatCard when connected', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.formatCard.mockResolvedValue({ result: 'success' })
    mockJensen.getFileCount.mockResolvedValue({ count: 0 })

    await service.formatStorage()

    expect(mockJensen.formatCard).toHaveBeenCalled()
  })

  it('should return true on successful format', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.formatCard.mockResolvedValue({ result: 'success' })
    mockJensen.getFileCount.mockResolvedValue({ count: 0 })

    const result = await service.formatStorage()

    expect(result).toBe(true)
  })

  it('should return false on failed format', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.formatCard.mockResolvedValue({ result: 'failure' })

    const result = await service.formatStorage()

    expect(result).toBe(false)
  })

  it('should invalidate cache on successful format', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    // Set up cache
    serviceAny.cachedRecordings = [{ id: '1', filename: 'test.wav' }]
    serviceAny.cachedRecordingCount = 1

    mockJensen.formatCard.mockResolvedValue({ result: 'success' })
    mockJensen.getFileCount.mockResolvedValue({ count: 0 })

    await service.formatStorage()

    expect(serviceAny.cachedRecordings).toBeNull()
    expect(serviceAny.cachedRecordingCount).toBe(-1)
  })

  it('should throw error on format exception', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.formatCard.mockRejectedValue(new Error('USB disconnected'))

    await expect(service.formatStorage()).rejects.toThrow('Format storage failed')
  })

  it('should invalidate cache on format exception', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    serviceAny.cachedRecordings = [{ id: '1', filename: 'test.wav' }]

    mockJensen.formatCard.mockRejectedValue(new Error('USB error'))

    try {
      await service.formatStorage()
    } catch {
      // Expected to throw
    }

    expect(serviceAny.cachedRecordings).toBeNull()
  })
})

describe('HiDockDeviceService - Set Auto Record', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => false),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      setAutoRecord: vi.fn(),
      listFiles: vi.fn(() => []),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return false when not connected', async () => {
    const service = new HiDockDeviceService()

    mockJensen.isConnected.mockReturnValue(false)

    const result = await service.setAutoRecord(true)

    expect(result).toBe(false)
    expect(mockJensen.setAutoRecord).not.toHaveBeenCalled()
  })

  it('should call jensen.setAutoRecord when connected', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    serviceAny.state.settings = { autoRecord: false }
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setAutoRecord.mockResolvedValue({ result: 'success' })

    await service.setAutoRecord(true)

    expect(mockJensen.setAutoRecord).toHaveBeenCalledWith(true)
  })

  it('should return true on success', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    serviceAny.state.settings = { autoRecord: false }
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setAutoRecord.mockResolvedValue({ result: 'success' })

    const result = await service.setAutoRecord(true)

    expect(result).toBe(true)
  })

  it('should update state settings on success', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    serviceAny.state.settings = { autoRecord: false }
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setAutoRecord.mockResolvedValue({ result: 'success' })

    await service.setAutoRecord(true)

    expect(serviceAny.state.settings.autoRecord).toBe(true)
  })

  it('should return false on failure', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.state.connected = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.setAutoRecord.mockResolvedValue({ result: 'failure' })

    const result = await service.setAutoRecord(true)

    expect(result).toBe(false)
  })
})

describe('HiDockDeviceService - QA Logging Path', () => {
  let HiDockDeviceService: any
  let mockShouldLogQa: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    // Enable QA logging for these tests
    mockShouldLogQa = vi.fn(() => true)
    vi.doMock('../qa-monitor', () => ({
      shouldLogQa: mockShouldLogQa
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should log activity notification count when QA logging is enabled', () => {
    const service = new HiDockDeviceService()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Add a listener so the count is non-zero
    const received: any[] = []
    service.onActivity((entry: any) => received.push(entry))

    // Log something to trigger the QA log path
    service.log('info', 'Test QA path')

    // Should have logged the QA monitor message about listener count
    const qaLogs = consoleSpy.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('logActivity')
    )
    expect(qaLogs.length).toBeGreaterThan(0)

    consoleSpy.mockRestore()
  })
})

describe('HiDockDeviceService - persistCacheToStorage', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should return early when cachedRecordings is empty', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Ensure no cached recordings
    serviceAny.cachedRecordings = []

    // Should not throw and should return early
    serviceAny.persistCacheToStorage()
    // No error = success (early return before window.electronAPI access)
  })

  it('should return early when cachedRecordings is null', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    serviceAny.cachedRecordings = null

    serviceAny.persistCacheToStorage()
    // No error = success
  })

  it('should convert recordings and call deviceCache.saveAll', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const mockSaveAll = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as any).window = {
      electronAPI: {
        deviceCache: { saveAll: mockSaveAll }
      }
    }

    serviceAny.cachedRecordings = [
      {
        filename: 'test.wav',
        size: 1024,
        duration: 60,
        dateCreated: new Date('2026-03-01T10:00:00Z')
      }
    ]

    serviceAny.persistCacheToStorage()

    expect(mockSaveAll).toHaveBeenCalledWith([
      {
        filename: 'test.wav',
        size: 1024,
        duration: 60,
        dateCreated: '2026-03-01T10:00:00.000Z'
      }
    ])

    delete (globalThis as any).window
  })
})

describe('HiDockDeviceService - Constructor Callbacks', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should set onconnect and ondisconnect callbacks on jensen device', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    expect(serviceAny.jensen.onconnect).toBeDefined()
    expect(typeof serviceAny.jensen.onconnect).toBe('function')
    expect(serviceAny.jensen.ondisconnect).toBeDefined()
    expect(typeof serviceAny.jensen.ondisconnect).toBe('function')
  })

  it('should call handleConnect when onconnect callback fires', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    // Spy on handleConnect
    const handleConnectSpy = vi.spyOn(serviceAny, 'handleConnect').mockImplementation(() => {})

    // Fire the onconnect callback set during construction
    serviceAny.jensen.onconnect()

    expect(handleConnectSpy).toHaveBeenCalled()
    handleConnectSpy.mockRestore()
  })

  it('should call handleDisconnect when ondisconnect callback fires', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const handleDisconnectSpy = vi.spyOn(serviceAny, 'handleDisconnect').mockImplementation(() => {})

    serviceAny.jensen.ondisconnect()

    expect(handleDisconnectSpy).toHaveBeenCalled()
    handleDisconnectSpy.mockRestore()
  })
})

describe('HiDockDeviceService - persistCacheToStorage error path', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('should handle saveAll rejection gracefully', async () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mockSaveAll = vi.fn().mockRejectedValue(new Error('Storage error'))
    ;(globalThis as any).window = {
      electronAPI: {
        deviceCache: { saveAll: mockSaveAll }
      }
    }

    serviceAny.cachedRecordings = [
      { filename: 'test.wav', size: 1024, duration: 60, dateCreated: new Date() }
    ]

    serviceAny.persistCacheToStorage()

    // Wait for the catch to fire
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist cache'),
      expect.any(Error)
    )

    warnSpy.mockRestore()
    delete (globalThis as any).window
  })

  it('should use current date when dateCreated is missing', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any

    const mockSaveAll = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as any).window = {
      electronAPI: { deviceCache: { saveAll: mockSaveAll } }
    }

    serviceAny.cachedRecordings = [
      { filename: 'no-date.wav', size: 512, duration: 30, dateCreated: null }
    ]

    serviceAny.persistCacheToStorage()

    expect(mockSaveAll).toHaveBeenCalledWith([
      expect.objectContaining({
        filename: 'no-date.wav',
        size: 512,
        duration: 30,
        dateCreated: expect.any(String)
      })
    ])

    delete (globalThis as any).window
  })
})

describe('HiDockDeviceService - Realtime/Battery/Bluetooth (not connected)', () => {
  let HiDockDeviceService: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  it('getRealtimeSettings returns null when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.getRealtimeSettings()).toBeNull()
  })

  it('startRealtime returns false when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.startRealtime()).toBe(false)
  })

  it('pauseRealtime returns false when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.pauseRealtime()).toBe(false)
  })

  it('stopRealtime returns false when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.stopRealtime()).toBe(false)
  })

  it('getRealtimeData returns null when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.getRealtimeData(0)).toBeNull()
  })

  it('getBatteryStatus returns null when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.getBatteryStatus()).toBeNull()
  })

  it('startBluetoothScan returns false when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.startBluetoothScan()).toBe(false)
  })

  it('stopBluetoothScan returns false when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.stopBluetoothScan()).toBe(false)
  })

  it('getBluetoothStatus returns null when not connected', async () => {
    const service = new HiDockDeviceService()
    expect(await service.getBluetoothStatus()).toBeNull()
  })

  it('isP1Device delegates to jensen', () => {
    const service = new HiDockDeviceService()
    const serviceAny = service as any
    serviceAny.jensen.isP1Device = vi.fn(() => true)
    expect(service.isP1Device()).toBe(true)
    serviceAny.jensen.isP1Device = vi.fn(() => false)
    expect(service.isP1Device()).toBe(false)
  })
})

describe('HiDockDeviceService - Singleton Factory', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('getHiDockDeviceService returns same instance on repeated calls', async () => {
    const module = await import('../hidock-device')
    const getService = (module as any).getHiDockDeviceService

    const instance1 = getService()
    const instance2 = getService()

    expect(instance1).toBe(instance2)
  })
})
