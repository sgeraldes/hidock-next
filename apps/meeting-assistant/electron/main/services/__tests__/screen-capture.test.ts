/**
 * ScreenCaptureService tests.
 *
 * Since screen-capture.ts uses named ESM imports from 'node:fs' (which cannot
 * be intercepted by vi.mock in native-ESM mode), these tests use the real
 * filesystem with temporary directories.  Only the database layer and the
 * 'ai' module are mocked so the tests remain self-contained.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../database-queries', () => ({
  createScreenshot: vi.fn(() => ({
    id: 1,
    session_id: 'test-session',
    path: '/session/screenshots/001_12345.png',
    captured_at: Date.now(),
    analysis: null,
    is_manual: 0,
  })),
  updateScreenshotAnalysis: vi.fn(),
  getScreenshotsBySession: vi.fn(() => []),
}))

vi.mock('../database', () => ({
  saveDatabase: vi.fn(),
}))

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: 'A presentation slide showing quarterly results.',
  })),
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import * as dbQueries from '../database-queries'
import * as db from '../database'
import { generateText } from 'ai'
import { ScreenCaptureService } from '../screen-capture'

const mockCreateScreenshot = vi.mocked(dbQueries.createScreenshot)
const mockUpdateScreenshotAnalysis = vi.mocked(dbQueries.updateScreenshotAnalysis)
const mockSaveDatabase = vi.mocked(db.saveDatabase)
const mockGenerateText = vi.mocked(generateText)

/** Minimal LanguageModel stub */
function makeModel() {
  return { modelId: 'test-model', provider: 'test' } as unknown as import('ai').LanguageModel
}

/** Factory for a capture function that returns a small fake buffer (or null) */
function makeCaptureScreenFn(returnNull = false): () => Promise<Buffer | null> {
  return vi.fn(async () => {
    if (returnNull) return null
    return Buffer.from([0x89, 0x50, 0x4e, 0x47]) // fake PNG header
  })
}

/** Advance fake timers by ms, then drain the microtask queue */
async function advanceAndFlush(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

// ─── Temp dir helpers ─────────────────────────────────────────────────────────

let tmpDir: string
let sessionDir: string
const SESSION_ID = 'session-abc'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ScreenCaptureService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Create fresh temp dirs for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test-'))
    sessionDir = path.join(tmpDir, 'session-abc')
    fs.mkdirSync(sessionDir, { recursive: true })

    mockCreateScreenshot.mockReturnValue({
      id: 1,
      session_id: SESSION_ID,
      path: path.join(sessionDir, 'screenshots', '001_12345.png'),
      captured_at: Date.now(),
      analysis: null,
      is_manual: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  // ── 1. Constructor defaults ──────────────────────────────────────────────
  describe('constructor', () => {
    it('uses default options', () => {
      const svc = new ScreenCaptureService()
      expect(svc.getCaptureCount()).toBe(0)
      expect(svc.isAutoCapturing()).toBe(false)
    })

    it('accepts custom options', () => {
      const svc = new ScreenCaptureService({
        autoIntervalSeconds: 60,
        maxPerSession: 50,
        analyzeWithLLM: false,
        includeInNotes: false,
      })
      expect(svc).toBeInstanceOf(ScreenCaptureService)
    })
  })

  // ── 2. setModel() ────────────────────────────────────────────────────────
  describe('setModel()', () => {
    it('sets the model without throwing', () => {
      const svc = new ScreenCaptureService()
      expect(() =>
        svc.setModel(makeModel() as Parameters<typeof svc.setModel>[0]),
      ).not.toThrow()
    })
  })

  // ── 3. setCaptureFunction() ──────────────────────────────────────────────
  describe('setCaptureFunction()', () => {
    it('sets the capture function without throwing', () => {
      const svc = new ScreenCaptureService()
      expect(() => svc.setCaptureFunction(makeCaptureScreenFn())).not.toThrow()
    })
  })

  // ── 4. startAutoCapture() ────────────────────────────────────────────────
  describe('startAutoCapture()', () => {
    it('emits auto-capture-started with sessionId', () => {
      const svc = new ScreenCaptureService()
      const events: unknown[] = []
      svc.on('auto-capture-started', (e) => events.push(e))
      svc.startAutoCapture(SESSION_ID, sessionDir)
      expect(events).toEqual([SESSION_ID])
    })

    it('marks isAutoCapturing as true', () => {
      const svc = new ScreenCaptureService()
      svc.startAutoCapture(SESSION_ID, sessionDir)
      expect(svc.isAutoCapturing()).toBe(true)
      svc.stopAutoCapture()
    })

    it('creates screenshots directory if it does not exist', () => {
      const newSessionDir = path.join(tmpDir, 'new-session')
      fs.mkdirSync(newSessionDir, { recursive: true })
      const screenshotsDir = path.join(newSessionDir, 'screenshots')
      // Ensure it does NOT exist yet
      expect(fs.existsSync(screenshotsDir)).toBe(false)

      const svc = new ScreenCaptureService()
      svc.startAutoCapture('new-session', newSessionDir)
      expect(fs.existsSync(screenshotsDir)).toBe(true)
      svc.stopAutoCapture()
    })

    it('does NOT throw when screenshots directory already exists', () => {
      // Pre-create the screenshots dir
      const screenshotsDir = path.join(sessionDir, 'screenshots')
      fs.mkdirSync(screenshotsDir, { recursive: true })

      const svc = new ScreenCaptureService()
      expect(() => svc.startAutoCapture(SESSION_ID, sessionDir)).not.toThrow()
      svc.stopAutoCapture()
    })

    it('resets captureCount to 0 on each start', async () => {
      const svc = new ScreenCaptureService({ autoIntervalSeconds: 1, analyzeWithLLM: false })
      svc.setCaptureFunction(makeCaptureScreenFn())
      svc.startAutoCapture(SESSION_ID, sessionDir)

      await advanceAndFlush(1000)

      expect(svc.getCaptureCount()).toBeGreaterThan(0)

      // Restart — count should reset
      svc.stopAutoCapture()
      const sessionDir2 = path.join(tmpDir, 'session-2')
      fs.mkdirSync(sessionDir2, { recursive: true })
      svc.startAutoCapture('session-2', sessionDir2)
      expect(svc.getCaptureCount()).toBe(0)
      svc.stopAutoCapture()
    })

    it('fires capture on the configured interval', async () => {
      const captureFn = makeCaptureScreenFn()
      const svc = new ScreenCaptureService({ autoIntervalSeconds: 2, analyzeWithLLM: false })
      svc.setCaptureFunction(captureFn)
      svc.startAutoCapture(SESSION_ID, sessionDir)

      // Not fired before 2s
      vi.advanceTimersByTime(1999)
      expect(captureFn).not.toHaveBeenCalled()

      // Fired after 2s
      await advanceAndFlush(1)
      expect(captureFn).toHaveBeenCalledTimes(1)
      svc.stopAutoCapture()
    })
  })

  // ── 5. stopAutoCapture() ─────────────────────────────────────────────────
  describe('stopAutoCapture()', () => {
    it('emits auto-capture-stopped', () => {
      const svc = new ScreenCaptureService()
      svc.startAutoCapture(SESSION_ID, sessionDir)

      const events: unknown[] = []
      svc.on('auto-capture-stopped', () => events.push(true))
      svc.stopAutoCapture()

      expect(events).toHaveLength(1)
    })

    it('sets isAutoCapturing to false', () => {
      const svc = new ScreenCaptureService()
      svc.startAutoCapture(SESSION_ID, sessionDir)
      svc.stopAutoCapture()
      expect(svc.isAutoCapturing()).toBe(false)
    })

    it('prevents further auto-captures after stop', async () => {
      const captureFn = makeCaptureScreenFn()
      const svc = new ScreenCaptureService({ autoIntervalSeconds: 1, analyzeWithLLM: false })
      svc.setCaptureFunction(captureFn)
      svc.startAutoCapture(SESSION_ID, sessionDir)
      svc.stopAutoCapture()

      await advanceAndFlush(5000)
      expect(captureFn).not.toHaveBeenCalled()
    })

    it('is safe to call when not started', () => {
      const svc = new ScreenCaptureService()
      expect(() => svc.stopAutoCapture()).not.toThrow()
    })
  })

  // ── 6. capture() ─────────────────────────────────────────────────────────
  describe('capture()', () => {
    it('calls captureScreenFn, writes file, saves to database, emits screenshot-captured', async () => {
      const captureFn = makeCaptureScreenFn()
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.setCaptureFunction(captureFn)
      svc.startAutoCapture(SESSION_ID, sessionDir)

      const capturedEvents: unknown[] = []
      svc.on('screenshot-captured', (e) => capturedEvents.push(e))

      await svc.capture(true)

      expect(captureFn).toHaveBeenCalledOnce()
      expect(mockCreateScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ session_id: SESSION_ID, is_manual: true }),
      )
      expect(mockSaveDatabase).toHaveBeenCalled()
      expect(capturedEvents).toHaveLength(1)
      expect(capturedEvents[0]).toMatchObject({ isManual: true })
      svc.stopAutoCapture()
    })

    it('actually writes the PNG file to the screenshots directory', async () => {
      const captureFn = makeCaptureScreenFn()
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.setCaptureFunction(captureFn)
      svc.startAutoCapture(SESSION_ID, sessionDir)

      await svc.capture(false)

      const screenshotsDir = path.join(sessionDir, 'screenshots')
      const files = fs.readdirSync(screenshotsDir).filter((f) => f.endsWith('.png'))
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/001_\d+\.png$/)
      svc.stopAutoCapture()
    })

    it('increments captureCount', async () => {
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.setCaptureFunction(makeCaptureScreenFn())
      svc.startAutoCapture(SESSION_ID, sessionDir)

      await svc.capture(false)
      expect(svc.getCaptureCount()).toBe(1)

      await svc.capture(false)
      expect(svc.getCaptureCount()).toBe(2)
      svc.stopAutoCapture()
    })

    it('passes the correct path to createScreenshot', async () => {
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.setCaptureFunction(makeCaptureScreenFn())
      svc.startAutoCapture(SESSION_ID, sessionDir)

      await svc.capture(false)

      const call = mockCreateScreenshot.mock.calls[0][0]
      expect(call.path).toContain('screenshots')
      expect(call.path).toMatch(/001_\d+\.png$/)
      svc.stopAutoCapture()
    })
  })

  // ── 7. capture() with LLM analysis ──────────────────────────────────────
  describe('capture() - LLM analysis', () => {
    it('calls generateText and updateScreenshotAnalysis when analyzeWithLLM=true and model set', async () => {
      const svc = new ScreenCaptureService({ analyzeWithLLM: true })
      svc.setModel(makeModel() as Parameters<typeof svc.setModel>[0])
      svc.setCaptureFunction(makeCaptureScreenFn())
      svc.startAutoCapture(SESSION_ID, sessionDir)

      const analysisEvents: unknown[] = []
      svc.on('screenshot-analyzed', (e) => analysisEvents.push(e))

      await svc.capture(false)

      expect(mockGenerateText).toHaveBeenCalledOnce()
      expect(mockUpdateScreenshotAnalysis).toHaveBeenCalledWith(
        1, // screenshot id from mock
        'A presentation slide showing quarterly results.',
      )
      expect(analysisEvents).toHaveLength(1)
      expect(analysisEvents[0]).toMatchObject({
        id: 1,
        analysis: 'A presentation slide showing quarterly results.',
      })
      svc.stopAutoCapture()
    })

    it('does NOT call generateText when analyzeWithLLM=false', async () => {
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.setModel(makeModel() as Parameters<typeof svc.setModel>[0])
      svc.setCaptureFunction(makeCaptureScreenFn())
      svc.startAutoCapture(SESSION_ID, sessionDir)

      await svc.capture(false)
      expect(mockGenerateText).not.toHaveBeenCalled()
      svc.stopAutoCapture()
    })

    it('does NOT call generateText when model is not set', async () => {
      const svc = new ScreenCaptureService({ analyzeWithLLM: true })
      svc.setCaptureFunction(makeCaptureScreenFn())
      svc.startAutoCapture(SESSION_ID, sessionDir)

      await svc.capture(false)
      expect(mockGenerateText).not.toHaveBeenCalled()
      svc.stopAutoCapture()
    })

    it('emits analysis-error when generateText throws', async () => {
      const analysisErr = new Error('Vision API failed')
      mockGenerateText.mockRejectedValueOnce(analysisErr)

      const svc = new ScreenCaptureService({ analyzeWithLLM: true })
      svc.setModel(makeModel() as Parameters<typeof svc.setModel>[0])
      svc.setCaptureFunction(makeCaptureScreenFn())
      svc.startAutoCapture(SESSION_ID, sessionDir)

      const analysisErrors: unknown[] = []
      svc.on('analysis-error', (e) => analysisErrors.push(e))

      await svc.capture(false)

      expect(analysisErrors).toHaveLength(1)
      expect(analysisErrors[0]).toMatchObject({ error: analysisErr })
      svc.stopAutoCapture()
    })
  })

  // ── 8. capture() - max limit ─────────────────────────────────────────────
  describe('capture() - max capture limit', () => {
    it('emits max-captures-reached and does not capture when at limit', async () => {
      const captureFn = makeCaptureScreenFn()
      const svc = new ScreenCaptureService({ maxPerSession: 2, analyzeWithLLM: false })
      svc.setCaptureFunction(captureFn)
      svc.startAutoCapture(SESSION_ID, sessionDir)

      await svc.capture(false)
      await svc.capture(false)
      // Now at max (2)

      const maxEvents: unknown[] = []
      svc.on('max-captures-reached', (e) => maxEvents.push(e))

      await svc.capture(false) // should be blocked
      expect(captureFn).toHaveBeenCalledTimes(2) // not called a 3rd time
      expect(maxEvents).toHaveLength(1)
      expect(maxEvents[0]).toBe(2)
      svc.stopAutoCapture()
    })
  })

  // ── 9. capture() without required deps ──────────────────────────────────
  describe('capture() - missing dependencies', () => {
    it('returns early when sessionId/sessionDir is not set (no startAutoCapture)', async () => {
      const captureFn = makeCaptureScreenFn()
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.setCaptureFunction(captureFn)
      // No startAutoCapture — no sessionId or sessionDir

      await svc.capture(false)
      expect(captureFn).not.toHaveBeenCalled()
    })

    it('returns early when captureScreenFn is not set', async () => {
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.startAutoCapture(SESSION_ID, sessionDir)
      // No setCaptureFunction

      await svc.capture(false)
      expect(mockCreateScreenshot).not.toHaveBeenCalled()
      svc.stopAutoCapture()
    })

    it('does not capture when captureScreenFn returns null', async () => {
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.setCaptureFunction(makeCaptureScreenFn(true)) // returns null
      svc.startAutoCapture(SESSION_ID, sessionDir)

      const capturedEvents: unknown[] = []
      svc.on('screenshot-captured', (e) => capturedEvents.push(e))

      await svc.capture(false)
      expect(mockCreateScreenshot).not.toHaveBeenCalled()
      expect(capturedEvents).toHaveLength(0)
      svc.stopAutoCapture()
    })
  })

  // ── 10. capture() error handling ─────────────────────────────────────────
  describe('capture() - error handling', () => {
    it('emits error event when captureScreenFn throws', async () => {
      const captureErr = new Error('Screen capture failed')
      const captureFn = vi.fn(async () => { throw captureErr })
      const svc = new ScreenCaptureService({ analyzeWithLLM: false })
      svc.setCaptureFunction(captureFn)
      svc.startAutoCapture(SESSION_ID, sessionDir)

      const errorEvents: unknown[] = []
      svc.on('error', (e) => errorEvents.push(e))

      await svc.capture(false)
      expect(errorEvents).toEqual([captureErr])
      svc.stopAutoCapture()
    })
  })

  // ── 11. getCaptureCount() / isAutoCapturing() ────────────────────────────
  describe('state tracking', () => {
    it('getCaptureCount returns 0 initially', () => {
      const svc = new ScreenCaptureService()
      expect(svc.getCaptureCount()).toBe(0)
    })

    it('isAutoCapturing returns false before start and after stop', () => {
      const svc = new ScreenCaptureService()
      expect(svc.isAutoCapturing()).toBe(false)
      svc.startAutoCapture(SESSION_ID, sessionDir)
      expect(svc.isAutoCapturing()).toBe(true)
      svc.stopAutoCapture()
      expect(svc.isAutoCapturing()).toBe(false)
    })

    it('getCaptureCount does not increment when capture returns early (null buffer)', async () => {
      const svc = new ScreenCaptureService()
      svc.setCaptureFunction(makeCaptureScreenFn(true)) // returns null
      svc.startAutoCapture(SESSION_ID, sessionDir)

      await svc.capture(false)
      expect(svc.getCaptureCount()).toBe(0)
      svc.stopAutoCapture()
    })
  })
})
