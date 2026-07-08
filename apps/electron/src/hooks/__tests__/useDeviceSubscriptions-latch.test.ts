/**
 * Defect B: the auto-sync trigger must only latch (fire once) after it holds a real
 * device file list. Latching on a premature 'ready' (fired before the file-list scan)
 * was permanently suppressing auto-download, because the once-guard then skipped the
 * later 'ready' fired after the scan completed.
 */
import { describe, it, expect, vi } from 'vitest'

// Importing the hook module pulls in these deps; stub them so the pure helper loads.
vi.mock('@/services/hidock-device', () => ({ getHiDockDeviceService: vi.fn(() => ({})) }))
vi.mock('@/store/useAppStore', () => ({
  useAppStore: Object.assign(vi.fn(), { getState: vi.fn(() => ({})) })
}))
vi.mock('@/services/qa-monitor', () => ({ shouldLogQa: vi.fn(() => false) }))
vi.mock('@/utils/autoSyncGuard', () => ({
  checkAutoSyncAllowed: vi.fn(() => ({ allowed: false, reason: 'test' })),
  waitForConfig: vi.fn(),
  waitForDeviceReady: vi.fn()
}))
vi.mock('@/hooks/useDownloadOrchestrator', () => ({
  requestScopedDownloads: vi.fn(),
  drainDownloadQueue: vi.fn()
}))

import { shouldLatchAutoSync } from '../useDeviceSubscriptions'

describe('shouldLatchAutoSync — defect B (auto-download must not be permanently suppressed)', () => {
  it('latches when a real file list is available', () => {
    expect(shouldLatchAutoSync(84, 84)).toBe(true)
  })

  it('latches when the device genuinely reports zero recordings (nothing to sync)', () => {
    expect(shouldLatchAutoSync(0, 0)).toBe(true)
  })

  it('does NOT latch when the list is still empty but the device reports files (scan not ready)', () => {
    // This is the defect: a premature 'ready' before the scan must not latch, so the
    // 'ready' fired after the scan can retry and actually queue the device files.
    expect(shouldLatchAutoSync(0, 84)).toBe(false)
  })

  it('latches once files arrive even if the device count is momentarily stale/negative', () => {
    expect(shouldLatchAutoSync(84, -1)).toBe(true)
  })
})
