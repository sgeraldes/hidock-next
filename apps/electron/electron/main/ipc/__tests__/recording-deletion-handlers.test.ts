/**
 * recordings:markPersonal / deletionImpact / deleteCascade / restore IPC tests.
 *
 * Mock-only, mirroring recording-deletion-handlers.setValueRating.test.ts's
 * pattern: capture the handler registered via ipcMain.handle and invoke it
 * directly. Verifies zod validation at the boundary, id resolution via
 * resolveRecordingId, and the structured { success, ... } response shape.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerRecordingDeletionHandlers } from '../recording-deletion-handlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

const resolveRecordingIdMock = vi.fn()
const setKnowledgeCaptureRatingByRecordingMock = vi.fn()
const setGraphProvenanceCleanupMock = vi.fn()
const markRecordingNotOnDeviceByIdMock = vi.fn()
const removeDeviceFileCacheEntryMock = vi.fn()
const markRecordingPersonalMock = vi.fn()
const getDeletionImpactMock = vi.fn()
const deleteRecordingMock = vi.fn()
const restoreDeletedRecordingMock = vi.fn()
const retryPendingFileCleanupsMock = vi.fn()
const removeRecordingProvenanceCoreMock = vi.fn()
const removeRecordingFromGraphMock = vi.fn()
// Defaulted to a healthy store so existing hard-delete tests (which don't
// care about the AR3-3(a) pre-flight) aren't blocked by it. vi.clearAllMocks()
// (below, in beforeEach) resets call history but NOT this configured return
// value, so it stands unless a specific test overrides it.
const ensureGraphReadyMock = vi.fn().mockReturnValue({ ok: true })

vi.mock('../../services/database', () => ({
  resolveRecordingId: (...args: unknown[]) => resolveRecordingIdMock(...args),
  setKnowledgeCaptureRatingByRecording: (...args: unknown[]) => setKnowledgeCaptureRatingByRecordingMock(...args),
  setGraphProvenanceCleanup: (...args: unknown[]) => setGraphProvenanceCleanupMock(...args),
  markRecordingNotOnDeviceById: (...args: unknown[]) => markRecordingNotOnDeviceByIdMock(...args),
  removeDeviceFileCacheEntry: (...args: unknown[]) => removeDeviceFileCacheEntryMock(...args)
}))

// spec-006/F17 T6 — recording-deletion-handlers.ts now imports
// knowledge-graph-service (seam wiring + deletionImpact's graph dry-run +
// deleteCascade's ensureGraphReady pre-flight) — mock it so the real graph
// package is never loaded here.
vi.mock('../../services/knowledge-graph-service', () => ({
  removeRecordingProvenanceCore: (...args: unknown[]) => removeRecordingProvenanceCoreMock(...args),
  removeRecordingFromGraph: (...args: unknown[]) => removeRecordingFromGraphMock(...args),
  ensureGraphReady: (...args: unknown[]) => ensureGraphReadyMock(...args)
}))

vi.mock('../../services/recording-deletion-service', () => ({
  markRecordingPersonal: (...args: unknown[]) => markRecordingPersonalMock(...args),
  getDeletionImpact: (...args: unknown[]) => getDeletionImpactMock(...args),
  deleteRecording: (...args: unknown[]) => deleteRecordingMock(...args),
  restoreDeletedRecording: (...args: unknown[]) => restoreDeletedRecordingMock(...args),
  retryPendingFileCleanups: (...args: unknown[]) => retryPendingFileCleanupsMock(...args)
}))

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = (ipcMain.handle as any).mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`${channel} was not registered`)
  return call[1]
}

describe('recording-deletion-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerRecordingDeletionHandlers()
  })

  describe('recordings:markPersonal', () => {
    it('resolves the id then flips the flag', async () => {
      resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
      markRecordingPersonalMock.mockReturnValue({ success: true, personal: true })
      const handler = getHandler('recordings:markPersonal')

      const result = await handler(null, 'rec-1', true)

      expect(result).toEqual({ success: true, personal: true })
      expect(markRecordingPersonalMock).toHaveBeenCalledWith('resolved-1', true)
    })

    it('returns an error without throwing when the recording is unknown', async () => {
      resolveRecordingIdMock.mockReturnValue(undefined)
      const handler = getHandler('recordings:markPersonal')

      const result = await handler(null, 'ghost', true)

      expect(result).toEqual({ success: false, error: 'Recording not found' })
    })
  })

  describe('recordings:deletionImpact', () => {
    it('resolves the id and returns the impact payload', async () => {
      resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
      getDeletionImpactMock.mockReturnValue({
        recordingId: 'resolved-1',
        filename: 'r1.wav',
        transcripts: 1,
        actionItems: 0,
        embeddings: 2,
        captures: 1,
        artifacts: 0,
        meetingLinks: 0,
        hasAudioFile: true
      })
      const handler = getHandler('recordings:deletionImpact')

      const result: any = await handler(null, 'rec-1')

      expect(result.success).toBe(true)
      expect(result.data.transcripts).toBe(1)
      expect(getDeletionImpactMock).toHaveBeenCalledWith('resolved-1')
    })

    // AC#9 (spec-005/F17 T5) regression guard: the handler must not layer its
    // OWN deleted_at filtering on top of resolveRecordingId — a soft-deleted
    // (tombstoned) recording resolves fine (resolveRecordingId/getRecordingById
    // don't filter deleted_at; verified at the DB layer in
    // recording-deletion.test.ts), so the handler must return real data for it,
    // not "Recording not found".
    it('returns data for a soft-deleted (tombstoned) recording', async () => {
      resolveRecordingIdMock.mockReturnValue({
        id: 'resolved-1',
        deleted_at: '2026-01-01T10:00:00.000Z'
      })
      getDeletionImpactMock.mockReturnValue({
        recordingId: 'resolved-1',
        filename: 'trashed.wav',
        transcripts: 1,
        actionItems: 0,
        embeddings: 0,
        captures: 0,
        artifacts: 0,
        meetingLinks: 0,
        hasAudioFile: true
      })
      const handler = getHandler('recordings:deletionImpact')

      const result: any = await handler(null, 'trashed-rec-id')

      expect(result.success).toBe(true)
      expect(result.data.filename).toBe('trashed.wav')
    })

    it('returns "Recording not found" when resolveRecordingId fails', async () => {
      resolveRecordingIdMock.mockReturnValue(undefined)
      const handler = getHandler('recordings:deletionImpact')

      const result = await handler(null, 'ghost')

      expect(result).toEqual({ success: false, error: 'Recording not found' })
    })

    it('rejects an invalid (empty) id without throwing', async () => {
      const handler = getHandler('recordings:deletionImpact')
      const result = await handler(null, '')
      expect(result).toEqual({ success: false, error: 'Invalid recording id' })
      expect(resolveRecordingIdMock).not.toHaveBeenCalled()
    })

    // spec-006/F17 T6 D5/AR3-8 — graphEstimate computation.
    describe('graphEstimate (D5/AR3-8)', () => {
      const baseImpactData = {
        recordingId: 'resolved-1',
        filename: 'r1.wav',
        transcripts: 1,
        actionItems: 0,
        embeddings: 0,
        captures: 0,
        artifacts: 0,
        meetingLinks: 0,
        hasAudioFile: true,
        onDevice: false,
        deviceFilename: null
      }

      it('sums edges + meetingNodes + orphanNodes from a successful dry run', async () => {
        resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
        getDeletionImpactMock.mockReturnValue(baseImpactData)
        removeRecordingFromGraphMock.mockReturnValue({
          ok: true,
          edgesRemoved: 3,
          meetingNodesRemoved: 1,
          orphanNodesRemoved: 2
        })
        const handler = getHandler('recordings:deletionImpact')

        const result: any = await handler(null, 'rec-1')

        expect(result.success).toBe(true)
        expect(result.data.graphEstimate).toBe(6)
        expect(removeRecordingFromGraphMock).toHaveBeenCalledWith('resolved-1', { dryRun: true })
      })

      it('is null when the dry run reports {ok:false}', async () => {
        resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
        getDeletionImpactMock.mockReturnValue(baseImpactData)
        removeRecordingFromGraphMock.mockReturnValue({ ok: false, error: 'graph store unavailable' })
        const handler = getHandler('recordings:deletionImpact')

        const result: any = await handler(null, 'rec-1')

        expect(result.success).toBe(true)
        expect(result.data.graphEstimate).toBeNull()
      })

      it('is null (never throws across IPC) when the dry run itself throws', async () => {
        resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
        getDeletionImpactMock.mockReturnValue(baseImpactData)
        removeRecordingFromGraphMock.mockImplementation(() => {
          throw new Error('boom')
        })
        const handler = getHandler('recordings:deletionImpact')

        const result: any = await handler(null, 'rec-1')

        expect(result.success).toBe(true)
        expect(result.data.graphEstimate).toBeNull()
      })
    })
  })

  describe('recordings:deleteCascade', () => {
    it('resolves the id then delegates to the service with hard=false (soft)', async () => {
      resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
      deleteRecordingMock.mockResolvedValue({ success: true, mode: 'soft' })
      const handler = getHandler('recordings:deleteCascade')

      const result = await handler(null, 'rec-1', false)

      expect(result).toEqual({ success: true, mode: 'soft' })
      expect(deleteRecordingMock).toHaveBeenCalledWith('resolved-1', { hard: false })
      // Soft deletes never consult graph readiness — no graph coupling at all.
      expect(ensureGraphReadyMock).not.toHaveBeenCalled()
    })

    it('delegates to the service with hard=true (permanent — including from Trash)', async () => {
      // AC#9 — permanent-delete FROM Trash resolves through the SAME path;
      // resolveRecordingId is mocked here (the real non-filtering behavior is
      // the DB-layer fact under test at recording-deletion.test.ts), this just
      // proves the handler doesn't add its own gating.
      resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1', deleted_at: '2026-01-01T10:00:00.000Z' })
      deleteRecordingMock.mockResolvedValue({ success: true, mode: 'hard' })
      const handler = getHandler('recordings:deleteCascade')

      const result = await handler(null, 'trashed-rec-id', true)

      expect(result).toEqual({ success: true, mode: 'hard' })
      expect(deleteRecordingMock).toHaveBeenCalledWith('resolved-1', { hard: true })
      expect(ensureGraphReadyMock).toHaveBeenCalled()
    })

    it('returns "Recording not found" when resolveRecordingId fails', async () => {
      resolveRecordingIdMock.mockReturnValue(undefined)
      const handler = getHandler('recordings:deleteCascade')

      const result = await handler(null, 'ghost', true)

      expect(result).toEqual({ success: false, error: 'Recording not found' })
      expect(deleteRecordingMock).not.toHaveBeenCalled()
    })

    // spec-006/F17 T6 AR3-3(a) — pre-flight graph readiness check for a hard
    // delete, BEFORE the service (and its transaction) is even called.
    describe('ensureGraphReady pre-flight (AR3-3a)', () => {
      it('refuses with graphUnavailable:true when the graph store is not ready, without calling the service', async () => {
        resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
        ensureGraphReadyMock.mockReturnValueOnce({ ok: false, error: 'disk I/O error' })
        const handler = getHandler('recordings:deleteCascade')

        const result: any = await handler(null, 'rec-1', true)

        expect(result.success).toBe(false)
        expect(result.graphUnavailable).toBe(true)
        expect(result.error).toContain('disk I/O error')
        expect(deleteRecordingMock).not.toHaveBeenCalled()
      })

      it('does not run the pre-flight for a soft delete', async () => {
        resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
        deleteRecordingMock.mockResolvedValue({ success: true, mode: 'soft' })
        const handler = getHandler('recordings:deleteCascade')

        await handler(null, 'rec-1', false)

        expect(ensureGraphReadyMock).not.toHaveBeenCalled()
      })
    })

    // spec-006/F17 T6 AR3-3(c) — the explicit skipGraphCleanup escape hatch.
    describe('skipGraphCleanup escape hatch (AR3-3c)', () => {
      it('bypasses the ensureGraphReady pre-flight entirely and threads the flag to the service', async () => {
        resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
        deleteRecordingMock.mockResolvedValue({ success: true, mode: 'hard', graphCleanupSkipped: true })
        const handler = getHandler('recordings:deleteCascade')

        const result = await handler(null, 'rec-1', true, { skipGraphCleanup: true })

        expect(ensureGraphReadyMock).not.toHaveBeenCalled()
        expect(deleteRecordingMock).toHaveBeenCalledWith('resolved-1', { hard: true, skipGraphCleanup: true })
        expect(result).toEqual({ success: true, mode: 'hard', graphCleanupSkipped: true })
      })

      it('a falsy skipGraphCleanup does not change the call shape (backward compatible)', async () => {
        resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
        deleteRecordingMock.mockResolvedValue({ success: true, mode: 'hard' })
        const handler = getHandler('recordings:deleteCascade')

        await handler(null, 'rec-1', true, { skipGraphCleanup: false })

        expect(deleteRecordingMock).toHaveBeenCalledWith('resolved-1', { hard: true })
      })
    })
  })

  describe('recordings:restore', () => {
    it('delegates to restoreDeletedRecording', async () => {
      restoreDeletedRecordingMock.mockReturnValue({ success: true })
      const handler = getHandler('recordings:restore')

      const result = await handler(null, 'rec-1')

      expect(result).toEqual({ success: true })
      expect(restoreDeletedRecordingMock).toHaveBeenCalledWith('rec-1')
    })

    it('rejects an invalid (empty) id without throwing', async () => {
      const handler = getHandler('recordings:restore')
      const result = await handler(null, '')
      expect(result).toEqual({ success: false })
      expect(restoreDeletedRecordingMock).not.toHaveBeenCalled()
    })

    it('never throws across IPC — an unexpected service error is caught', async () => {
      restoreDeletedRecordingMock.mockImplementation(() => {
        throw new Error('db exploded')
      })
      const handler = getHandler('recordings:restore')

      const result = await handler(null, 'rec-1')

      expect(result).toEqual({ success: false })
    })
  })

  // spec-006/F17 T6 AR3-6(b) + CX-T6-1 (fix round: filename-keyed fallback)
  describe('recordings:markNotOnDevice', () => {
    it('resolves the id then reconciles device presence', async () => {
      resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
      const handler = getHandler('recordings:markNotOnDevice')

      const result = await handler(null, 'rec-1')

      expect(result).toEqual({ success: true })
      expect(markRecordingNotOnDeviceByIdMock).toHaveBeenCalledWith('resolved-1')
    })

    // CX-T6-1 — the POST-PURGE path: the hard cascade already deleted the
    // recordings row, so the id no longer resolves. Previously this returned
    // "Recording not found" and did NOTHING, leaving the offline device
    // cache to resurrect the deleted file as a ghost device-only row.
    it('post-purge (unresolvable id) with a deviceFilename still succeeds, reconciling the device cache by filename', async () => {
      resolveRecordingIdMock.mockReturnValue(undefined)
      const handler = getHandler('recordings:markNotOnDevice')

      const result = await handler(null, 'purged-rec-id', 'purged.hda')

      expect(result).toEqual({ success: true })
      expect(markRecordingNotOnDeviceByIdMock).not.toHaveBeenCalled() // no row to flip
      expect(removeDeviceFileCacheEntryMock).toHaveBeenCalledWith('purged.hda')
    })

    it('a resolvable id clears the device cache for the explicit filename AND the row\'s own filename variants', async () => {
      resolveRecordingIdMock.mockReturnValue({
        id: 'resolved-1',
        filename: 'row-name.wav',
        original_filename: 'row-name.hda'
      })
      const handler = getHandler('recordings:markNotOnDevice')

      const result = await handler(null, 'rec-1', 'explicit.hda')

      expect(result).toEqual({ success: true })
      expect(markRecordingNotOnDeviceByIdMock).toHaveBeenCalledWith('resolved-1')
      expect(removeDeviceFileCacheEntryMock).toHaveBeenCalledWith('explicit.hda')
      expect(removeDeviceFileCacheEntryMock).toHaveBeenCalledWith('row-name.wav')
      expect(removeDeviceFileCacheEntryMock).toHaveBeenCalledWith('row-name.hda')
    })

    it('returns an error without throwing when the recording is unknown AND no filename was given', async () => {
      resolveRecordingIdMock.mockReturnValue(undefined)
      const handler = getHandler('recordings:markNotOnDevice')

      const result = await handler(null, 'ghost')

      expect(result).toEqual({ success: false, error: 'Recording not found' })
      expect(markRecordingNotOnDeviceByIdMock).not.toHaveBeenCalled()
      expect(removeDeviceFileCacheEntryMock).not.toHaveBeenCalled()
    })

    it('rejects an invalid (empty) id without throwing', async () => {
      const handler = getHandler('recordings:markNotOnDevice')
      const result = await handler(null, '')
      expect(result).toEqual({ success: false, error: 'Invalid recording id' })
      expect(resolveRecordingIdMock).not.toHaveBeenCalled()
    })

    it('rejects an invalid (non-string) deviceFilename without acting on anything', async () => {
      const handler = getHandler('recordings:markNotOnDevice')
      const result = await handler(null, 'rec-1', 42)
      expect(result).toEqual({ success: false, error: 'Invalid recording id' })
      expect(resolveRecordingIdMock).not.toHaveBeenCalled()
      expect(removeDeviceFileCacheEntryMock).not.toHaveBeenCalled()
    })

    // CX-T6-5 (fix round 2) — removeDeviceFileCacheEntry no longer swallows
    // real DB failures; the handler surfaces them as an honest
    // {success:false} instead of a false success that leaves the ghost
    // cache row to resurface after restart.
    it('reports {success:false} when the device-cache reconciliation itself fails (real DB error)', async () => {
      resolveRecordingIdMock.mockReturnValue(undefined) // post-purge: row already gone
      removeDeviceFileCacheEntryMock.mockImplementationOnce(() => {
        throw new Error('disk I/O error')
      })
      const handler = getHandler('recordings:markNotOnDevice')

      const result = await handler(null, 'purged-rec-id', 'purged.hda')

      expect(result).toEqual({ success: false, error: 'disk I/O error' })
    })

    it('never throws across IPC — an unexpected service error is caught', async () => {
      resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
      markRecordingNotOnDeviceByIdMock.mockImplementation(() => {
        throw new Error('db exploded')
      })
      const handler = getHandler('recordings:markNotOnDevice')

      const result = await handler(null, 'rec-1')

      expect(result).toEqual({ success: false, error: 'db exploded' })
    })
  })

  // spec-006/F17 T6 AR3-2 — the Trash-view-entry sweep IPC.
  describe('recordings:retryPendingCleanups', () => {
    it('delegates to retryPendingFileCleanups and reports its summary', async () => {
      retryPendingFileCleanupsMock.mockResolvedValue({ attempted: 2, cleared: 1, stillPending: { j1: ['audio'] } })
      const handler = getHandler('recordings:retryPendingCleanups')

      const result = await handler(null)

      expect(result).toEqual({ success: true, attempted: 2, cleared: 1, stillPending: { j1: ['audio'] } })
    })

    it('never throws across IPC — an unexpected service error is caught', async () => {
      retryPendingFileCleanupsMock.mockRejectedValue(new Error('db exploded'))
      const handler = getHandler('recordings:retryPendingCleanups')

      const result = await handler(null)

      expect(result).toEqual({ success: false, error: 'db exploded' })
    })
  })
})
