import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PerformanceMonitor } from '../services/performance-monitor'
import * as databaseExtras from '../services/database-extras'

// Mock database-extras
vi.mock('../services/database-extras', () => ({
  getSetting: vi.fn(),
}))

describe('PerformanceMonitor', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  describe('mark()', () => {
    it('should record timestamps correctly', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      const t1 = monitor.mark('start')
      const t2 = monitor.mark('end')

      expect(t2).toBeGreaterThanOrEqual(t1)
      expect(typeof t1).toBe('number')
      expect(typeof t2).toBe('number')
    })

    it('should allow marking the same name multiple times', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      const t1 = monitor.mark('point')
      const t2 = monitor.mark('point')

      expect(t2).toBeGreaterThanOrEqual(t1)
    })
  })

  describe('delta()', () => {
    it('should calculate difference between marks', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.mark('start')
      monitor.mark('end')

      const delta = monitor.delta('start', 'end')
      expect(delta).toBeGreaterThanOrEqual(0)
    })

    it('should return -1 if start mark does not exist', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.mark('end')
      const delta = monitor.delta('nonexistent', 'end')

      expect(delta).toBe(-1)
    })

    it('should return -1 if end mark does not exist', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.mark('start')
      const delta = monitor.delta('start', 'nonexistent')

      expect(delta).toBe(-1)
    })

    it('should return -1 if both marks do not exist', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      const delta = monitor.delta('nonexistent1', 'nonexistent2')

      expect(delta).toBe(-1)
    })
  })

  describe('logStage()', () => {
    it('should log when QA is enabled', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 5)

      monitor.mark('start')
      monitor.mark('end')
      monitor.logStage('Test Stage', 'start', 'end')

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[QA-MONITOR]')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Test Stage')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('session: test-session')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('chunk: 5')
      )
    })

    it('should not log when QA is disabled', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('false')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.mark('start')
      monitor.mark('end')
      monitor.logStage('Test Stage', 'start', 'end')

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should not log when mark does not exist', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.mark('start')
      monitor.logStage('Test Stage', 'start', 'nonexistent')

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should handle database errors gracefully', () => {
      vi.mocked(databaseExtras.getSetting).mockImplementation(() => {
        throw new Error('Database error')
      })

      // Should not throw
      expect(() => {
        const monitor = new PerformanceMonitor('test-session', 0)
        monitor.mark('start')
        monitor.mark('end')
        monitor.logStage('Test Stage', 'start', 'end')
      }).not.toThrow()

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })
  })

  describe('logTotal()', () => {
    it('should log total time from first to last mark', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 3)

      monitor.mark('first')
      monitor.mark('middle')
      monitor.mark('last')
      monitor.logTotal()

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[QA-MONITOR]')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Total end-to-end')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('session: test-session')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('chunk: 3')
      )
    })

    it('should not log when QA is disabled', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('false')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.mark('first')
      monitor.mark('last')
      monitor.logTotal()

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should not log when fewer than 2 marks exist', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.mark('only-one')
      monitor.logTotal()

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('should not log when no marks exist', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.logTotal()

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })
  })

  describe('isEnabled()', () => {
    it('should return true when QA is enabled', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      expect(monitor.isEnabled()).toBe(true)
    })

    it('should return false when QA is disabled', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('false')
      const monitor = new PerformanceMonitor('test-session', 0)

      expect(monitor.isEnabled()).toBe(false)
    })

    it('should return false when setting is not "true"', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('something-else')
      const monitor = new PerformanceMonitor('test-session', 0)

      expect(monitor.isEnabled()).toBe(false)
    })

    it('should return false when setting is null', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue(null)
      const monitor = new PerformanceMonitor('test-session', 0)

      expect(monitor.isEnabled()).toBe(false)
    })

    it('should return false on database error', () => {
      vi.mocked(databaseExtras.getSetting).mockImplementation(() => {
        throw new Error('Database error')
      })
      const monitor = new PerformanceMonitor('test-session', 0)

      expect(monitor.isEnabled()).toBe(false)
    })
  })

  describe('Integration scenarios', () => {
    it('should work with typical pipeline timing flow', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('session-123', 2)

      monitor.mark('pipeline-entry')
      monitor.mark('chirp3-start')
      monitor.mark('chirp3-end')
      monitor.mark('gemini-start')
      monitor.mark('gemini-end')
      monitor.mark('pipeline-exit')

      monitor.logStage('Chirp3 stage', 'chirp3-start', 'chirp3-end')
      monitor.logStage('Gemini stage', 'gemini-start', 'gemini-end')
      monitor.logStage('Total pipeline', 'pipeline-entry', 'pipeline-exit')
      monitor.logTotal()

      expect(consoleLogSpy).toHaveBeenCalledTimes(4)
      expect(consoleLogSpy.mock.calls.every(call =>
        call[0].includes('[QA-MONITOR]')
      )).toBe(true)
    })

    it('should handle marks that are created out of order', () => {
      vi.mocked(databaseExtras.getSetting).mockReturnValue('true')
      const monitor = new PerformanceMonitor('test-session', 0)

      monitor.mark('end')
      monitor.mark('start')

      // Delta should still work (might be negative)
      const delta = monitor.delta('start', 'end')
      expect(typeof delta).toBe('number')
    })
  })
})
