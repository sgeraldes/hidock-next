/**
 * Defect C: recency-first download queue ordering (orderDownloadsForProcessing).
 *
 * Mirrors the transcription queue's ordering semantics (queue-ordering.test.ts):
 * user-explicit single downloads first (FIFO), then everything else newest-first
 * by recording date, undated last. Kept fully mocked so importing the orchestrator
 * pulls in nothing heavy.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/services/hidock-device', () => ({ getHiDockDeviceService: vi.fn(() => ({})) }))
vi.mock('@/store/useAppStore', () => ({
  useAppStore: Object.assign(vi.fn(), { getState: vi.fn(() => ({})) })
}))
vi.mock('@/components/ui/toaster', () => ({ toast: vi.fn() }))
vi.mock('@/features/library/utils/errorHandling', () => ({
  parseError: vi.fn(),
  getErrorMessage: vi.fn()
}))
vi.mock('@/services/qa-monitor', () => ({ shouldLogQa: vi.fn(() => false) }))

import {
  orderDownloadsForProcessing,
  markDownloadPriority,
  clearDownloadPriority,
  drainDownloadQueue,
  canStartDownloadSession
} from '../useDownloadOrchestrator'

type Item = { filename: string; recordingDate?: Date | string | null }
const item = (filename: string, recordingDate?: Date | string | null): Item => ({ filename, recordingDate })

describe('orderDownloadsForProcessing — recency-first download ordering', () => {
  it('dequeues the newest recording (recordingDate) first regardless of enqueue order', () => {
    const ordered = orderDownloadsForProcessing(
      [
        item('old', '2026-05-01T10:00:00Z'),
        item('newest', '2026-07-06T09:00:00Z'),
        item('mid', '2026-06-15T12:00:00Z')
      ],
      new Set()
    ).map((i) => i.filename)
    expect(ordered).toEqual(['newest', 'mid', 'old'])
  })

  it('accepts Date objects as well as ISO strings', () => {
    const ordered = orderDownloadsForProcessing(
      [
        item('old', new Date('2026-05-01T10:00:00Z')),
        item('newest', new Date('2026-07-06T09:00:00Z'))
      ],
      new Set()
    ).map((i) => i.filename)
    expect(ordered).toEqual(['newest', 'old'])
  })

  it('puts a user-explicit request ahead of a newer backlog item', () => {
    const ordered = orderDownloadsForProcessing(
      [
        item('backlog-new', '2026-07-06T09:00:00Z'),
        item('explicit-old', '2026-04-01T09:00:00Z')
      ],
      new Set(['explicit-old'])
    ).map((i) => i.filename)
    expect(ordered).toEqual(['explicit-old', 'backlog-new'])
  })

  it('orders multiple user-explicit requests FIFO by enqueue order', () => {
    // 'b' has a newer recording date but 'a' was enqueued first → FIFO wins among
    // user-explicit items, and both precede the non-priority backlog.
    const ordered = orderDownloadsForProcessing(
      [
        item('backlog', '2026-07-06T09:00:00Z'),
        item('a', '2026-01-01T09:00:00Z'),
        item('b', '2026-07-05T09:00:00Z')
      ],
      new Set(['a', 'b'])
    ).map((i) => i.filename)
    expect(ordered).toEqual(['a', 'b', 'backlog'])
  })

  it('sorts undated (missing/null) recordings last', () => {
    const ordered = orderDownloadsForProcessing(
      [
        item('undated', null),
        item('newer', '2026-06-10T09:00:00Z'),
        item('older', '2026-05-10T09:00:00Z'),
        item('nodate')
      ],
      new Set()
    ).map((i) => i.filename)
    expect(ordered).toEqual(['newer', 'older', 'undated', 'nodate'])
  })

  it('keeps enqueue (FIFO) order for equal recording dates', () => {
    const ordered = orderDownloadsForProcessing(
      [
        item('first', '2026-06-01T09:00:00Z'),
        item('second', '2026-06-01T09:00:00Z')
      ],
      new Set()
    ).map((i) => i.filename)
    expect(ordered).toEqual(['first', 'second'])
  })

  it('does not mutate the input array', () => {
    const items = [item('a', '2026-01-01T00:00:00Z'), item('b', '2026-07-01T00:00:00Z')]
    const snapshot = items.map((i) => i.filename)
    orderDownloadsForProcessing(items, new Set())
    expect(items.map((i) => i.filename)).toEqual(snapshot)
  })
})

describe('download priority markers', () => {
  it('markDownloadPriority / clearDownloadPriority are callable and do not throw', () => {
    expect(() => markDownloadPriority(['rec1.mp3', 'rec2.mp3'])).not.toThrow()
    expect(() => clearDownloadPriority('rec1.mp3')).not.toThrow()
  })
})

describe('drainDownloadQueue — defect A safety', () => {
  it('is a no-op (does not throw) when the orchestrator is not mounted', () => {
    // useDeviceSubscriptions may call this before/after the orchestrator hook exists.
    expect(() => drainDownloadQueue()).not.toThrow()
  })
})

describe('canStartDownloadSession — no download attempt unless genuinely connected', () => {
  it('starts only when connected AND step === "ready"', () => {
    expect(canStartDownloadSession(true, 'ready')).toBe(true)
  })

  it('does NOT start when disconnected — even if the store step is a stale "ready"', () => {
    // The exact evidence: a download went "active" against a disconnected device.
    expect(canStartDownloadSession(false, 'ready')).toBe(false)
  })

  it('does NOT start while connected but still initializing (step not ready)', () => {
    // isConnected() can read true during early init before the device is usable (DL-001).
    expect(canStartDownloadSession(true, 'getting-info')).toBe(false)
    expect(canStartDownloadSession(true, 'counting-files')).toBe(false)
  })

  it('does NOT start when disconnected and idle (queued-while-off must only persist)', () => {
    expect(canStartDownloadSession(false, 'idle')).toBe(false)
  })
})
