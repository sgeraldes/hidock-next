import { getSetting } from './database-extras'

/**
 * High-precision performance monitoring for QA debugging.
 * All logs respect the qaLogsEnabled toggle from database.
 *
 * Usage:
 *   const perf = new PerformanceMonitor(sessionId, chunkIndex)
 *   perf.mark('start')
 *   // ... do work ...
 *   perf.mark('end')
 *   perf.logStage('My Stage', 'start', 'end')
 */
export class PerformanceMonitor {
  private marks = new Map<string, number>()
  private qaEnabled: boolean
  private sessionId: string
  private chunkIndex: number

  constructor(sessionId: string, chunkIndex: number) {
    this.sessionId = sessionId
    this.chunkIndex = chunkIndex
    try {
      this.qaEnabled = getSetting('ui.qaLogsEnabled') === 'true'
    } catch {
      this.qaEnabled = false
    }
  }

  /**
   * Record a timing mark with the given name.
   * Returns the timestamp for direct use if needed.
   */
  mark(name: string): number {
    const timestamp = performance.now()
    this.marks.set(name, timestamp)
    return timestamp
  }

  /**
   * Calculate the duration between two marks.
   * Returns -1 if either mark doesn't exist.
   */
  delta(from: string, to: string): number {
    const start = this.marks.get(from)
    const end = this.marks.get(to)
    if (start === undefined || end === undefined) return -1
    return end - start
  }

  /**
   * Log a stage with calculated delta between two marks.
   * Only logs if QA is enabled.
   */
  logStage(stageName: string, fromMark: string, toMark: string): void {
    if (!this.qaEnabled) return
    const ms = this.delta(fromMark, toMark)
    if (ms < 0) return
    console.log(
      `[QA-MONITOR] [Perf] ${stageName}: ${ms.toFixed(1)}ms (session: ${this.sessionId}, chunk: ${this.chunkIndex})`
    )
  }

  /**
   * Log the total end-to-end time from first to last mark.
   * Only logs if QA is enabled.
   */
  logTotal(): void {
    if (!this.qaEnabled) return
    const entries = Array.from(this.marks.entries()).sort((a, b) => a[1] - b[1])
    if (entries.length < 2) return
    const total = entries[entries.length - 1][1] - entries[0][1]
    console.log(
      `[QA-MONITOR] [Perf] Total end-to-end: ${total.toFixed(1)}ms (session: ${this.sessionId}, chunk: ${this.chunkIndex})`
    )
  }

  /**
   * Check if QA logging is enabled (useful for conditional code).
   */
  isEnabled(): boolean {
    return this.qaEnabled
  }
}
