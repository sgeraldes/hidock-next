/**
 * recordings:setValueRating IPC tests (F16/spec-003 Part E).
 *
 * Mock-only, mirroring recording-handlers.test.ts's pattern: capture the
 * handler registered via ipcMain.handle and invoke it directly. Verifies
 * zod validation at the boundary, id resolution, and the structured
 * { success, ... } response shape (never throws across IPC).
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

vi.mock('../../services/database', () => ({
  resolveRecordingId: (...args: unknown[]) => resolveRecordingIdMock(...args),
  setKnowledgeCaptureRatingByRecording: (...args: unknown[]) => setKnowledgeCaptureRatingByRecordingMock(...args)
}))

vi.mock('../../services/recording-deletion-service', () => ({
  markRecordingPersonal: vi.fn(),
  getDeletionImpact: vi.fn(),
  deleteRecording: vi.fn(),
  restoreDeletedRecording: vi.fn()
}))

function getSetValueRatingHandler(): (...args: unknown[]) => Promise<unknown> {
  const call = (ipcMain.handle as any).mock.calls.find((c: unknown[]) => c[0] === 'recordings:setValueRating')
  if (!call) throw new Error('recordings:setValueRating was not registered')
  return call[1]
}

describe('recordings:setValueRating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerRecordingDeletionHandlers()
  })

  it('registers the channel', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('recordings:setValueRating', expect.any(Function))
  })

  it('rejects a missing id without throwing', async () => {
    const handler = getSetValueRatingHandler()
    const result = await handler(null, '', 'garbage')
    expect(result).toEqual({ success: false, error: expect.any(String) })
    expect(resolveRecordingIdMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid rating enum value without throwing', async () => {
    const handler = getSetValueRatingHandler()
    const result = await handler(null, 'rec-1', 'super-valuable')
    expect(result).toEqual({ success: false, error: expect.any(String) })
    expect(resolveRecordingIdMock).not.toHaveBeenCalled()
  })

  it.each(['valuable', 'archived', 'low-value', 'garbage', 'unrated'])('accepts the valid rating "%s"', async (rating) => {
    resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
    setKnowledgeCaptureRatingByRecordingMock.mockReturnValue({ success: true, rating })
    const handler = getSetValueRatingHandler()

    const result = await handler(null, 'rec-1', rating)

    expect(result).toEqual({ success: true, rating })
    expect(setKnowledgeCaptureRatingByRecordingMock).toHaveBeenCalledWith('resolved-1', rating)
  })

  it('returns "Recording not found" when resolveRecordingId fails to resolve', async () => {
    resolveRecordingIdMock.mockReturnValue(undefined)
    const handler = getSetValueRatingHandler()

    const result = await handler(null, 'unknown-id', 'garbage')

    expect(result).toEqual({ success: false, error: 'Recording not found' })
    expect(setKnowledgeCaptureRatingByRecordingMock).not.toHaveBeenCalled()
  })

  it('returns an error when the recording has no knowledge captures', async () => {
    resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
    setKnowledgeCaptureRatingByRecordingMock.mockReturnValue({ success: false })
    const handler = getSetValueRatingHandler()

    const result = await handler(null, 'rec-1', 'garbage')

    expect(result).toEqual({ success: false, error: expect.any(String) })
  })

  it('is capture-scoped via resolveRecordingId — never writes with the raw untrusted id', async () => {
    resolveRecordingIdMock.mockReturnValue({ id: 'resolved-different-id' })
    setKnowledgeCaptureRatingByRecordingMock.mockReturnValue({ success: true, rating: 'garbage' })
    const handler = getSetValueRatingHandler()

    await handler(null, 'raw-untrusted-id', 'garbage')

    expect(setKnowledgeCaptureRatingByRecordingMock).toHaveBeenCalledWith('resolved-different-id', 'garbage')
  })

  it('never throws across IPC — an unexpected service error is caught and returned', async () => {
    resolveRecordingIdMock.mockReturnValue({ id: 'resolved-1' })
    setKnowledgeCaptureRatingByRecordingMock.mockImplementation(() => {
      throw new Error('db exploded')
    })
    const handler = getSetValueRatingHandler()

    const result = await handler(null, 'rec-1', 'garbage')

    expect(result).toEqual({ success: false, error: 'db exploded' })
  })
})
