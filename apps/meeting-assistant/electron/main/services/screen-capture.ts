import { EventEmitter } from 'node:events'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import { createScreenshot, updateScreenshotAnalysis } from './database-queries'
import { saveDatabase } from './database'

export interface ScreenCaptureOptions {
  autoIntervalSeconds?: number   // default 30
  maxPerSession?: number         // default 100
  analyzeWithLLM?: boolean       // default true
  includeInNotes?: boolean       // default true
}

export class ScreenCaptureService extends EventEmitter {
  private model: LanguageModel | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private sessionId: string | null = null
  private sessionDir: string | null = null
  private captureCount: number = 0
  private options: Required<ScreenCaptureOptions>

  // Electron desktopCapturer must be injected (not importable in main process directly)
  private captureScreenFn: (() => Promise<Buffer | null>) | null = null

  constructor(options?: ScreenCaptureOptions) {
    super()
    this.options = {
      autoIntervalSeconds: 30,
      maxPerSession: 100,
      analyzeWithLLM: true,
      includeInNotes: true,
      ...options,
    }
  }

  /** Set the LLM model for screenshot analysis */
  setModel(model: LanguageModel): void {
    this.model = model
  }

  /** Set the screen capture function (injected from Electron) */
  setCaptureFunction(fn: () => Promise<Buffer | null>): void {
    this.captureScreenFn = fn
  }

  /** Start auto-capture for a session */
  startAutoCapture(sessionId: string, sessionDir: string): void {
    this.sessionId = sessionId
    this.sessionDir = sessionDir
    this.captureCount = 0

    const screenshotsDir = join(sessionDir, 'screenshots')
    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true })
    }

    this.timer = setInterval(
      () => this.capture(false),
      this.options.autoIntervalSeconds * 1000,
    )
    this.emit('auto-capture-started', sessionId)
  }

  /** Stop auto-capture */
  stopAutoCapture(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.emit('auto-capture-stopped')
  }

  /** Capture a single screenshot */
  async capture(isManual: boolean): Promise<void> {
    if (!this.sessionId || !this.sessionDir || !this.captureScreenFn) return
    if (this.captureCount >= this.options.maxPerSession) {
      this.emit('max-captures-reached', this.captureCount)
      return
    }

    try {
      const buffer = await this.captureScreenFn()
      if (!buffer) return

      // Save file
      this.captureCount++
      const timestamp = Date.now()
      const filename = `${String(this.captureCount).padStart(3, '0')}_${timestamp}.png`
      const screenshotsDir = join(this.sessionDir, 'screenshots')
      const filePath = join(screenshotsDir, filename)
      writeFileSync(filePath, buffer)

      // Store in database
      const screenshot = createScreenshot({
        session_id: this.sessionId,
        path: filePath,
        is_manual: isManual,
      })
      saveDatabase()

      this.emit('screenshot-captured', { id: screenshot.id, path: filePath, isManual })

      // Analyze with LLM if enabled
      if (this.options.analyzeWithLLM && this.model) {
        await this.analyzeScreenshot(screenshot.id, buffer)
      }
    } catch (error) {
      this.emit('error', error)
    }
  }

  /** Analyze a screenshot with LLM vision */
  private async analyzeScreenshot(screenshotId: number, imageBuffer: Buffer): Promise<void> {
    if (!this.model) return

    try {
      const base64 = imageBuffer.toString('base64')
      const result = await generateText({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                image: base64,
                mediaType: 'image/png',
              },
              {
                type: 'text',
                text: 'Describe what is being presented or shown in this screenshot in the context of a meeting. Be concise but capture key information like slide titles, diagrams, code, or shared content.',
              },
            ],
          },
        ],
      })

      updateScreenshotAnalysis(screenshotId, result.text)
      saveDatabase()
      this.emit('screenshot-analyzed', { id: screenshotId, analysis: result.text })
    } catch (error) {
      this.emit('analysis-error', { id: screenshotId, error })
    }
  }

  /** Get count of captures in current session */
  getCaptureCount(): number {
    return this.captureCount
  }

  /** Check if auto-capture is running */
  isAutoCapturing(): boolean {
    return this.timer !== null
  }
}
