/**
 * spec-006/F17 T6 — wiring-guard test (Design Review #3, AR3-1).
 *
 * Proves registerRecordingDeletionHandlers() actually wires the
 * graph-provenance cleanup seam at registration time — i.e. that
 * isGraphProvenanceCleanupRegistered() flips to true purely as a SIDE EFFECT
 * of calling the real registration function, with the REAL database.ts seam
 * functions (not mocked — a mock would prove nothing about the real wiring
 * call happening). Only knowledge-graph-service is mocked, so the real graph
 * package is never loaded here. Mirrors the ipcMain.handle capture harness
 * from recording-deletion-handlers.setValueRating.test.ts.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { ipcMain } from 'electron'
import { isGraphProvenanceCleanupRegistered, setGraphProvenanceCleanup } from '../../services/database'
import { registerRecordingDeletionHandlers } from '../recording-deletion-handlers'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: vi.fn() }
}))

// knowledge-graph-service is mocked so the real @hidock/knowledge-graph
// package (and its AI-provider-adjacent imports) is never loaded — this test
// only cares about the WIRING call, not graph behavior.
vi.mock('../../services/knowledge-graph-service', () => ({
  removeRecordingProvenanceCore: vi.fn(),
  removeRecordingFromGraph: vi.fn(),
  ensureGraphReady: vi.fn(() => ({ ok: true }))
}))

describe('registerRecordingDeletionHandlers — graph-cleanup seam wiring guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to the "never wired" state before each test, so a prior test's
    // wiring can't leak into the next one's assertion.
    setGraphProvenanceCleanup(null)
  })

  it('is unregistered before registration', () => {
    expect(isGraphProvenanceCleanupRegistered()).toBe(false)
  })

  it('registers the graph-cleanup seam as a side effect of registration', () => {
    expect(isGraphProvenanceCleanupRegistered()).toBe(false)

    registerRecordingDeletionHandlers()

    expect(isGraphProvenanceCleanupRegistered()).toBe(true)
  })

  it('also registers every recordings:* IPC channel (registration did not short-circuit before the seam wiring or after it)', () => {
    registerRecordingDeletionHandlers()

    const channels = (ipcMain.handle as any).mock.calls.map((c: unknown[]) => c[0])
    expect(channels).toEqual(
      expect.arrayContaining([
        'recordings:markPersonal',
        'recordings:setValueRating',
        'recordings:deletionImpact',
        'recordings:deleteCascade',
        'recordings:restore',
        'recordings:markNotOnDevice',
        'recordings:retryPendingCleanups'
      ])
    )
  })
})
