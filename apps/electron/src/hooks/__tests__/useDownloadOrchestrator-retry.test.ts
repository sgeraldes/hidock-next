/**
 * MEDIUM-4 (Codex): the reconnect ('ready') retry must re-queue not only 'failed'
 * downloads but also 'cancelled' ones. cancelActiveDownloads (called on disconnect,
 * re-sync, or user cancel) persists an interrupted transfer as 'cancelled', not
 * 'failed'. The reconnect handler previously looked only for 'failed', so a
 * disconnect-during-download stranded the file until a manual retry. The shared
 * predicate keeps the reconnect selection and the operations badge consistent with
 * the main-process retryFailed(), which already re-queues both statuses.
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

import { isRetryableDownloadStatus } from '../useDownloadOrchestrator'

type QueueItem = { filename: string; status: string }

// Mirrors the reconnect retry-selection predicate in useDownloadOrchestrator's
// onStatusChange('ready') handler: retry when ANY item is retryable.
const reconnectShouldRetry = (queue: QueueItem[]): boolean =>
  queue.some((i) => isRetryableDownloadStatus(i.status))

describe('MEDIUM-4: reconnect retry includes disconnect-cancelled downloads', () => {
  it('treats failed and cancelled as retryable, and nothing else', () => {
    expect(isRetryableDownloadStatus('failed')).toBe(true)
    expect(isRetryableDownloadStatus('cancelled')).toBe(true)
    expect(isRetryableDownloadStatus('pending')).toBe(false)
    expect(isRetryableDownloadStatus('downloading')).toBe(false)
    expect(isRetryableDownloadStatus('completed')).toBe(false)
  })

  it('disconnect-during-download → reconnect retries the cancelled item', () => {
    const queue: QueueItem[] = [
      { filename: 'meeting-1.hda', status: 'cancelled' }, // interrupted by disconnect
      { filename: 'meeting-2.hda', status: 'completed' }
    ]
    // Regression: the OLD predicate only matched 'failed' → would NOT retry, stranding it.
    expect(queue.some((i) => i.status === 'failed')).toBe(false)
    // Fixed: the shared retryable predicate catches the disconnect-cancelled item.
    expect(reconnectShouldRetry(queue)).toBe(true)
  })

  it('does not trigger a retry when nothing is retryable', () => {
    expect(reconnectShouldRetry([
      { filename: 'a', status: 'completed' },
      { filename: 'b', status: 'pending' },
      { filename: 'c', status: 'downloading' }
    ])).toBe(false)
  })
})
