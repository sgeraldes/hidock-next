import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockExec, mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReadFileSync: vi.fn().mockReturnValue(''),
}))

vi.mock('child_process', () => ({
  exec: mockExec,
  default: { exec: mockExec },
}))

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  default: { existsSync: mockExistsSync, readFileSync: mockReadFileSync },
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}))

import { MicDetector } from '../services/mic-detector'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

describe('MicDetector', () => {
  let detector: MicDetector

  beforeEach(() => {
    mockExec.mockReset()
    detector = new MicDetector({ pollIntervalMs: 1000 })
  })

  afterEach(() => {
    detector.stop()
  })

  describe('poll', () => {
    it('returns an object with active boolean', async () => {
      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        cb(null, '', '')
      })
      const result = await detector.poll()
      expect(result).toHaveProperty('active')
      expect(typeof result.active).toBe('boolean')
    })

    it('returns active: false when no mic activity detected', async () => {
      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        cb(null, '', '')
      })
      const result = await detector.poll()
      expect(result.active).toBe(false)
    })

    it('returns active: false with error on unsupported platform', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'freebsd' })

      const result = await detector.poll()
      expect(result.active).toBe(false)
      expect(result.error).toContain('Unsupported platform')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('returns active: false when exec callback has error', async () => {
      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        cb(new Error('command failed'), '', '')
      })
      const result = await detector.poll()
      expect(result.active).toBe(false)
    })

    it('detects active mic on Linux via pactl', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux' })

      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        if (typeof _cmd === 'string' && _cmd.includes('pactl')) {
          cb(null, 'Source Output #42\n\t\tapplication.name = "Firefox"\n', '')
        } else {
          cb(null, '', '')
        }
      })

      const result = await detector.poll()
      expect(result.active).toBe(true)
      expect(result.appName).toBe('Firefox')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('detects active mic on macOS via lsof', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })

      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        if (typeof _cmd === 'string' && _cmd.includes('lsof')) {
          cb(null, 'Google   Chrome  1234   user   cwd   DIR   coreaudiod\n', '')
        } else {
          cb(null, '', '')
        }
      })

      const result = await detector.poll()
      expect(result.active).toBe(true)

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('detects active mic on Windows via reg query', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })

      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        if (typeof _cmd === 'string' && _cmd.includes('reg query')) {
          cb(null, 'LastUsedTimeStart    REG_QWORD    0x1\nLastUsedTimeStop    REG_QWORD    0x0\n', '')
        } else {
          cb(null, '', '')
        }
      })

      const result = await detector.poll()
      expect(result.active).toBe(true)

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })

  describe('start/stop', () => {
    it('start begins polling and emits status via callback', async () => {
      const callback = vi.fn()
      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        cb(null, '', '')
      })

      detector.start(callback)
      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalled()
      }, { timeout: 2000 })
      detector.stop()

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ active: expect.any(Boolean) })
      )
    })

    it('stop halts polling', () => {
      const callback = vi.fn()
      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        cb(null, '', '')
      })

      detector.start(callback)
      detector.stop()
      expect(detector.isRunning()).toBe(false)
    })
  })

  describe('grace period', () => {
    it('does not immediately report inactive after mic stops', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux' })

      const detectorWithGrace = new MicDetector({
        pollIntervalMs: 1000,
        gracePeriodMs: 5000,
      })

      let micActive = true
      mockExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
        if (micActive && typeof _cmd === 'string' && _cmd.includes('pactl')) {
          cb(null, 'Source Output #42\n', '')
        } else {
          cb(null, '', '')
        }
      })

      const result1 = await detectorWithGrace.poll()
      expect(result1.active).toBe(true)

      micActive = false
      const result2 = await detectorWithGrace.poll()
      expect(result2.active).toBe(true)

      detectorWithGrace.stop()
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })
})
