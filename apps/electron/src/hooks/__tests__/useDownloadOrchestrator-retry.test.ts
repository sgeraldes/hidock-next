/**
 * HIGH-3 (Codex): the reconnect ('ready') retry must re-queue disconnect-INTERRUPTED
 * downloads (status 'failed', or 'cancelled' with a non-user origin) but must NEVER
 * resurrect a USER-cancelled download — a deliberate cancel stays terminal until a
 * manual Retry. The shared origin-aware predicate keeps the reconnect selection and
 * the operations badge consistent with the main-process retryFailed(_, interruptedOnly).
 *
 * (Supersedes MEDIUM-4, which treated every 'cancelled' as retryable and therefore
 * resurrected user cancels on reconnect.)
 */
import { describe, it, expect, vi } from 'vitest'

// The predicate has no runtime deps, but importing the module pulls these in.
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

import { isRetryableDownloadItem } from '../useDownloadOrchestrator'

type QueueItem = { filename: string; status: string; cancelReason?: 'user' | 'interrupted' }

// Mirrors the reconnect retry-selection predicate in useDownloadOrchestrator's
// onStatusChange('ready') handler: retry when ANY item is auto-retryable.
const reconnectShouldRetry = (queue: QueueItem[]): boolean =>
  queue.some((i) => isRetryableDownloadItem(i))

describe('HIGH-3: reconnect retry includes interrupted but NOT user-cancelled downloads', () => {
  it('classifies each status/origin correctly', () => {
    expect(isRetryableDownloadItem({ status: 'failed' })).toBe(true)
    // A disconnect/re-sync interruption is retryable (explicit or defaulted origin).
    expect(isRetryableDownloadItem({ status: 'cancelled', cancelReason: 'interrupted' })).toBe(true)
    expect(isRetryableDownloadItem({ status: 'cancelled' })).toBe(true)
    // A deliberate user cancel is NOT auto-retryable.
    expect(isRetryableDownloadItem({ status: 'cancelled', cancelReason: 'user' })).toBe(false)
    // Non-terminal / done statuses never retry.
    expect(isRetryableDownloadItem({ status: 'pending' })).toBe(false)
    expect(isRetryableDownloadItem({ status: 'downloading' })).toBe(false)
    expect(isRetryableDownloadItem({ status: 'completed' })).toBe(false)
  })

  it('disconnect-during-download → reconnect retries the interrupted item', () => {
    const queue: QueueItem[] = [
      { filename: 'meeting-1.hda', status: 'cancelled', cancelReason: 'interrupted' },
      { filename: 'meeting-2.hda', status: 'completed' }
    ]
    expect(reconnectShouldRetry(queue)).toBe(true)
  })

  it('user-cancelled download does NOT trigger a reconnect retry (stays terminal)', () => {
    const queue: QueueItem[] = [
      { filename: 'meeting-1.hda', status: 'cancelled', cancelReason: 'user' },
      { filename: 'meeting-2.hda', status: 'completed' }
    ]
    // Regression guard: the OLD status-only predicate treated this as retryable and
    // resurrected the deliberately-cancelled download on reconnect.
    expect(reconnectShouldRetry(queue)).toBe(false)
  })

  it('a mix retries only when an interrupted/failed item is present', () => {
    expect(reconnectShouldRetry([
      { filename: 'a', status: 'cancelled', cancelReason: 'user' },
      { filename: 'b', status: 'failed' } // failed still forces a retry pass
    ])).toBe(true)

    expect(reconnectShouldRetry([
      { filename: 'a', status: 'cancelled', cancelReason: 'user' },
      { filename: 'b', status: 'completed' },
      { filename: 'c', status: 'pending' }
    ])).toBe(false)
  })

  it('does not trigger a retry when nothing is retryable', () => {
    expect(reconnectShouldRetry([
      { filename: 'a', status: 'completed' },
      { filename: 'b', status: 'pending' },
      { filename: 'c', status: 'downloading' }
    ])).toBe(false)
  })
})
