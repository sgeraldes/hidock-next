/**
 * Defect B: the auto-sync trigger must only latch (fire once) after it holds a real
 * device file list. Latching on a premature 'ready' (fired before the file-list scan)
 * was permanently suppressing auto-download, because the once-guard then skipped the
 * later 'ready' fired after the scan completed.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

// HIGH-3 (Codex): the latch is a re-entrancy guard for an ACTIVE attempt, not a
// permanent one-per-connect flag. It is set BEFORE listRecordings (so a concurrent
// 'ready' can't start a second scan), but it MUST be released when the listing throws
// or returns an unusable list — otherwise one bad scan disables auto-sync until
// disconnect. This applies to BOTH auto-sync paths (status-change trigger + initial
// pre-connected path). Guarded as a source invariant so a future edit can't silently
// re-strand it (the reset lives in the effect's async callback, which is impractical
// to drive end-to-end without a full hook render + IPC harness).
describe('HIGH-3: auto-sync latch releases on a failed/unusable scan', () => {
  const src = readFileSync(resolve(__dirname, '../useDeviceSubscriptions.ts'), 'utf8')

  it('releases the latch when listRecordings THROWS (both auto-sync paths)', () => {
    const markers = [...src.matchAll(
      /console\.error\('\[useDeviceSubscriptions\] (?:Failed to fetch file list|Initial file list fetch failed)/g
    )]
    expect(markers).toHaveLength(2)
    for (const m of markers) {
      const block = src.slice(m.index, m.index + 900)
      expect(block).toContain('autoSyncTriggeredRef.current = false')
      // The release must precede the early return that exits the failed attempt.
      expect(block.indexOf('autoSyncTriggeredRef.current = false'))
        .toBeLessThan(block.indexOf('return'))
    }
  })

  it('releases the latch when the list is unusable/scan-not-ready (both auto-sync paths)', () => {
    const markers = [...src.matchAll(/if \(!shouldLatchAutoSync\(recordings\.length/g)]
    expect(markers).toHaveLength(2)
    for (const m of markers) {
      const block = src.slice(m.index, m.index + 900)
      expect(block).toContain('autoSyncTriggeredRef.current = false')
    }
  })
})
