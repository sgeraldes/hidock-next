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
    open: vi.fn(),
    close: vi.fn(),
    getDeviceInfo: vi.fn(),
    getCardInfo: vi.fn(),
    getSettings: vi.fn(),
    listFiles: vi.fn(() => []),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
    setTime: vi.fn()
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
