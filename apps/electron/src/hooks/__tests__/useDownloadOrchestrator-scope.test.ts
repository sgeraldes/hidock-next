/**
 * Slice 1 (ADR-0005): scoped download selection.
 *
 * Regression for the "download one → downloads all 52" bug. The orchestrator
 * used to drain every pending item; now, when auto-download is OFF, it processes
 * only the filenames a user action explicitly requested.
 */
import { describe, it, expect, vi } from 'vitest'

// The pure selector has no runtime deps, but importing the module pulls these in.
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

import { selectDownloadsToProcess, requestScopedDownloads } from '../useDownloadOrchestrator'

const items = (...names: string[]) => names.map((filename) => ({ filename }))

describe('Slice 1: selectDownloadsToProcess', () => {
  it('auto-download OFF → processes only explicitly requested filenames', () => {
    const result = selectDownloadsToProcess(items('a', 'b', 'c'), new Set(['b']), false)
    expect(result.map((r) => r.filename)).toEqual(['b'])
  })

  it('auto-download OFF + empty request set → processes nothing (no runaway drain)', () => {
    expect(selectDownloadsToProcess(items('a', 'b'), new Set(), false)).toEqual([])
  })

  it('auto-download ON → processes all pending regardless of the request set', () => {
    const result = selectDownloadsToProcess(items('a', 'b'), new Set(), true)
    expect(result.map((r) => r.filename)).toEqual(['a', 'b'])
  })

  it('requestScopedDownloads is callable and does not throw', () => {
    expect(() => requestScopedDownloads(['x', 'y'])).not.toThrow()
  })
})
