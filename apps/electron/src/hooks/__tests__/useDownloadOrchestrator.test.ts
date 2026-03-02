import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for B-DEV-008 (per-file stall detection) and B-DEV-009 (memory cleanup)
 * and B-DEV-010 (debounce logic).
 *
 * These test the logic extracted from useDownloadOrchestrator without rendering the hook,
 * since the hook has deep dependencies on device service and Electron IPC.
 */

// ============================================================================
// B-DEV-008: Per-file stall detection
// ============================================================================

describe('Per-file stall detection (B-DEV-008)', () => {
  const DOWNLOAD_STALL_TIMEOUT = 60_000

  /**
   * Simulates the stall detection logic from the stallDetectionInterval callback
   * in useDownloadOrchestrator. This is the core logic we want to test.
   */
  function runStallDetection(
    downloadQueue: Map<string, { filename: string; progress: number; size: number }>,
    downloadProgressTimestamps: Map<string, { progress: number; timestamp: number }>,
    now: number
  ): { stalledFiles: string[]; removedFromQueue: string[] } {
    const stalledFiles: string[] = []
    const removedFromQueue: string[] = []

    downloadQueue.forEach((item, id) => {
      const prev = downloadProgressTimestamps.get(id)
      if (!prev) {
        downloadProgressTimestamps.set(id, { progress: item.progress, timestamp: now })
        return
      }

      if (item.progress !== prev.progress) {
        downloadProgressTimestamps.set(id, { progress: item.progress, timestamp: now })
      } else if (now - prev.timestamp > DOWNLOAD_STALL_TIMEOUT && item.progress > 0 && item.progress < 100) {
        stalledFiles.push(item.filename)
        removedFromQueue.push(id)
        downloadProgressTimestamps.delete(id)
      }
    })

    return { stalledFiles, removedFromQueue }
  }

  it('should detect stall on individual file without affecting others', () => {
    const downloadQueue = new Map([
      ['file1', { filename: 'rec1.hda', progress: 50, size: 1000 }],
      ['file2', { filename: 'rec2.hda', progress: 30, size: 2000 }],
    ])

    const timestamps = new Map<string, { progress: number; timestamp: number }>()
    const now = Date.now()

    // First pass: initialize timestamps
    runStallDetection(downloadQueue, timestamps, now)
    expect(timestamps.size).toBe(2)

    // Second pass: file1 stalled, file2 progressed
    downloadQueue.set('file2', { filename: 'rec2.hda', progress: 60, size: 2000 })
    const stalledTime = now + DOWNLOAD_STALL_TIMEOUT + 1000

    const result = runStallDetection(downloadQueue, timestamps, stalledTime)

    // file1 should be detected as stalled
    expect(result.stalledFiles).toEqual(['rec1.hda'])
    expect(result.removedFromQueue).toEqual(['file1'])

    // file2 should NOT be stalled - its timestamp should be updated
    expect(timestamps.has('file2')).toBe(true)
    expect(timestamps.get('file2')?.progress).toBe(60)
  })

  it('should not detect stall if progress is 0 (not started)', () => {
    const downloadQueue = new Map([
      ['file1', { filename: 'rec1.hda', progress: 0, size: 1000 }],
    ])
    const timestamps = new Map<string, { progress: number; timestamp: number }>()
    const now = Date.now()

    // Initialize
    runStallDetection(downloadQueue, timestamps, now)

    // Wait beyond timeout
    const result = runStallDetection(downloadQueue, timestamps, now + DOWNLOAD_STALL_TIMEOUT + 1000)
    expect(result.stalledFiles).toEqual([])
  })

  it('should not detect stall if progress is 100 (completed)', () => {
    const downloadQueue = new Map([
      ['file1', { filename: 'rec1.hda', progress: 100, size: 1000 }],
    ])
    const timestamps = new Map<string, { progress: number; timestamp: number }>()
    const now = Date.now()

    // Initialize
    runStallDetection(downloadQueue, timestamps, now)

    // Wait beyond timeout
    const result = runStallDetection(downloadQueue, timestamps, now + DOWNLOAD_STALL_TIMEOUT + 1000)
    expect(result.stalledFiles).toEqual([])
  })

  it('should not detect stall within timeout window', () => {
    const downloadQueue = new Map([
      ['file1', { filename: 'rec1.hda', progress: 50, size: 1000 }],
    ])
    const timestamps = new Map<string, { progress: number; timestamp: number }>()
    const now = Date.now()

    // Initialize
    runStallDetection(downloadQueue, timestamps, now)

    // Check at half the timeout -- should not stall
    const result = runStallDetection(downloadQueue, timestamps, now + DOWNLOAD_STALL_TIMEOUT / 2)
    expect(result.stalledFiles).toEqual([])
  })

  it('should handle multiple stalled files independently', () => {
    const downloadQueue = new Map([
      ['file1', { filename: 'rec1.hda', progress: 50, size: 1000 }],
      ['file2', { filename: 'rec2.hda', progress: 75, size: 2000 }],
      ['file3', { filename: 'rec3.hda', progress: 25, size: 3000 }],
    ])
    const timestamps = new Map<string, { progress: number; timestamp: number }>()
    const now = Date.now()

    // Initialize
    runStallDetection(downloadQueue, timestamps, now)

    // Only file3 makes progress
    downloadQueue.set('file3', { filename: 'rec3.hda', progress: 50, size: 3000 })

    const stalledTime = now + DOWNLOAD_STALL_TIMEOUT + 1000
    const result = runStallDetection(downloadQueue, timestamps, stalledTime)

    // file1 and file2 should be stalled, file3 should not
    expect(result.stalledFiles).toContain('rec1.hda')
    expect(result.stalledFiles).toContain('rec2.hda')
    expect(result.stalledFiles).not.toContain('rec3.hda')
    expect(result.removedFromQueue).toHaveLength(2)
  })
})

// ============================================================================
// B-DEV-009: downloadProgressTimestamps memory cleanup
// ============================================================================

describe('downloadProgressTimestamps cleanup (B-DEV-009)', () => {
  /**
   * Simulates the cleanup logic from the stallDetectionInterval callback.
   */
  function runCleanup(
    downloadQueue: Map<string, { filename: string; progress: number; size: number }>,
    downloadProgressTimestamps: Map<string, { progress: number; timestamp: number }>
  ) {
    if (downloadQueue.size === 0) {
      downloadProgressTimestamps.clear()
    } else {
      for (const [id] of downloadProgressTimestamps) {
        if (!downloadQueue.has(id)) {
          downloadProgressTimestamps.delete(id)
        }
      }
    }
  }

  it('should clear all timestamps when download queue is empty', () => {
    const downloadQueue = new Map<string, { filename: string; progress: number; size: number }>()
    const timestamps = new Map<string, { progress: number; timestamp: number }>([
      ['file1', { progress: 50, timestamp: Date.now() }],
      ['file2', { progress: 75, timestamp: Date.now() }],
      ['file3', { progress: 100, timestamp: Date.now() }],
    ])

    runCleanup(downloadQueue, timestamps)
    expect(timestamps.size).toBe(0)
  })

  it('should remove timestamps for files no longer in queue', () => {
    const downloadQueue = new Map([
      ['file2', { filename: 'rec2.hda', progress: 50, size: 2000 }],
    ])
    const timestamps = new Map<string, { progress: number; timestamp: number }>([
      ['file1', { progress: 100, timestamp: Date.now() }],
      ['file2', { progress: 50, timestamp: Date.now() }],
      ['file3', { progress: 75, timestamp: Date.now() }],
    ])

    runCleanup(downloadQueue, timestamps)

    // Only file2 should remain
    expect(timestamps.size).toBe(1)
    expect(timestamps.has('file2')).toBe(true)
    expect(timestamps.has('file1')).toBe(false)
    expect(timestamps.has('file3')).toBe(false)
  })

  it('should keep all timestamps when all files are still in queue', () => {
    const downloadQueue = new Map([
      ['file1', { filename: 'rec1.hda', progress: 50, size: 1000 }],
      ['file2', { filename: 'rec2.hda', progress: 75, size: 2000 }],
    ])
    const timestamps = new Map<string, { progress: number; timestamp: number }>([
      ['file1', { progress: 50, timestamp: Date.now() }],
      ['file2', { progress: 75, timestamp: Date.now() }],
    ])

    runCleanup(downloadQueue, timestamps)
    expect(timestamps.size).toBe(2)
  })
})

// ============================================================================
// B-DEV-010: Debounce logic for refreshSyncedFilenames
// ============================================================================

describe('Debounce logic (B-DEV-010)', () => {
  const DEBOUNCE_MS = 500

  /**
   * Simulates the debounce logic from refreshSyncedFilenames.
   * Returns true if the call was executed, false if debounced.
   */
  function shouldExecute(lastTimestamp: number, now: number): boolean {
    return (now - lastTimestamp) >= DEBOUNCE_MS
  }

  it('should allow first call', () => {
    expect(shouldExecute(0, Date.now())).toBe(true)
  })

  it('should debounce call within 500ms window', () => {
    const now = Date.now()
    expect(shouldExecute(now, now + 100)).toBe(false)
    expect(shouldExecute(now, now + 499)).toBe(false)
  })

  it('should allow call after 500ms window', () => {
    const now = Date.now()
    expect(shouldExecute(now, now + 500)).toBe(true)
    expect(shouldExecute(now, now + 501)).toBe(true)
  })

  it('should allow call after much longer period', () => {
    const now = Date.now()
    expect(shouldExecute(now, now + 10000)).toBe(true)
  })

  it('should debounce rapid successive calls', () => {
    let lastTimestamp = 0
    const results: boolean[] = []
    const startTime = Date.now()

    // Simulate 5 rapid calls 50ms apart
    for (let i = 0; i < 5; i++) {
      const now = startTime + i * 50
      const shouldRun = shouldExecute(lastTimestamp, now)
      results.push(shouldRun)
      if (shouldRun) {
        lastTimestamp = now
      }
    }

    // First call always executes, rest within 250ms should be debounced
    expect(results[0]).toBe(true)
    expect(results[1]).toBe(false)
    expect(results[2]).toBe(false)
    expect(results[3]).toBe(false)
    expect(results[4]).toBe(false)
  })

  it('should allow periodic calls spaced 500ms+ apart', () => {
    let lastTimestamp = 0
    const results: boolean[] = []
    const startTime = Date.now()

    // Simulate 3 calls 600ms apart
    for (let i = 0; i < 3; i++) {
      const now = startTime + i * 600
      const shouldRun = shouldExecute(lastTimestamp, now)
      results.push(shouldRun)
      if (shouldRun) {
        lastTimestamp = now
      }
    }

    // All calls should execute since they're spaced 600ms apart
    expect(results).toEqual([true, true, true])
  })
})
