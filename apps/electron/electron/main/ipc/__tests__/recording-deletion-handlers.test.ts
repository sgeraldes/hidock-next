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
const markRecordingPersonalMock = vi.fn()
const getDeletionImpactMock = vi.fn()
const deleteRecordingMock = vi.fn()
const restoreDeletedRecordingMock = vi.fn()

vi.mock('../../services/database', () => ({
  resolveRecordingId: (...args: unknown[]) => resolveRecordingIdMock(...args),
  setKnowledgeCaptureRatingByRecording: (...args: unknown[]) => setKnowledgeCaptureRatingByRecordingMock(...args)
}))

vi.mock('../../services/recording-deletion-service', () => ({
  markRecordingPersonal: (...args: unknown[]) => markRecordingPersonalMock(...args),
  getDeletionImpact: (...args: unknown[]) => getDeletionImpactMock(...args),
  deleteRecording: (...args: unknown[]) => deleteRecordingMock(...args),
  restoreDeletedRecording: (...args: unknown[]) => restoreDeletedRecordingMock(...args)
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
  })

  describe('recordings:deleteCascade', () => {
    it('resolves the id then delegates to the service with hard=false (soft)', async () => {
      resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
      deleteRecordingMock.mockResolvedValue({ success: true, mode: 'soft' })
      const handler = getHandler('recordings:deleteCascade')

      const result = await handler(null, 'rec-1', false)

      expect(result).toEqual({ success: true, mode: 'soft' })
      expect(deleteRecordingMock).toHaveBeenCalledWith('resolved-1', { hard: false })
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
    })

    it('returns "Recording not found" when resolveRecordingId fails', async () => {
      resolveRecordingIdMock.mockReturnValue(undefined)
      const handler = getHandler('recordings:deleteCascade')

      const result = await handler(null, 'ghost', true)

      expect(result).toEqual({ success: false, error: 'Recording not found' })
      expect(deleteRecordingMock).not.toHaveBeenCalled()
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
})
