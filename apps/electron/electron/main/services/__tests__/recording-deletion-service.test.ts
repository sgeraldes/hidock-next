// @vitest-environment node

/**
 * recording-deletion-service tests — the coordinating layer that turns a DB
 * cascade into the on-disk side effects (unlink audio + wiki + artifact blobs,
 * sync the in-memory vector store). All dependencies are mocked so this asserts
 * ONLY the coordination: hard purge unlinks files; soft delete touches none.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  deleteRecordingCascade: vi.fn(),
  restoreRecording: vi.fn(),
  setRecordingPersonal: vi.fn(),
  getRecordingDeletionImpact: vi.fn()
}))
const files = vi.hoisted(() => ({
  deleteRecording: vi.fn(),
  removeMeetingWiki: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  vectorDeleteByRecording: vi.fn()
}))

vi.mock('../database', () => db)
vi.mock('../file-storage', () => ({ deleteRecording: files.deleteRecording }))
vi.mock('../meeting-wiki', () => ({ removeMeetingWiki: files.removeMeetingWiki }))
vi.mock('../vector-store', () => ({
  getVectorStore: () => ({ deleteByRecording: files.vectorDeleteByRecording })
}))
vi.mock('fs', () => ({
  existsSync: (p: string) => files.existsSync(p),
  unlinkSync: (p: string) => files.unlinkSync(p)
}))

import {
  markRecordingPersonal,
  deleteRecording,
  restoreDeletedRecording,
  getDeletionImpact
} from '../recording-deletion-service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('markRecordingPersonal', () => {
  it('returns the new flag on success', () => {
    db.setRecordingPersonal.mockReturnValue(true)
    expect(markRecordingPersonal('r1', true)).toEqual({ success: true, personal: true })
    expect(db.setRecordingPersonal).toHaveBeenCalledWith('r1', true)
  })

  it('errors for an unknown recording', () => {
    db.setRecordingPersonal.mockReturnValue(undefined)
    expect(markRecordingPersonal('ghost', true)).toEqual({
      success: false,
      error: 'Recording ghost not found'
    })
  })
})

describe('deleteRecording (soft)', () => {
  it('touches NO files on a soft delete', async () => {
    db.deleteRecordingCascade.mockReturnValue({
      mode: 'soft',
      recordingId: 'r1',
      filename: 'r1.wav',
      filePath: '/data/r1.wav',
      artifactPaths: [],
      removed: {}
    })
    const res = await deleteRecording('r1', { hard: false })
    expect(res.success).toBe(true)
    expect(files.deleteRecording).not.toHaveBeenCalled()
    expect(files.removeMeetingWiki).not.toHaveBeenCalled()
    expect(files.vectorDeleteByRecording).not.toHaveBeenCalled()
  })
})

describe('deleteRecording (hard)', () => {
  it('unlinks the audio file, wiki, artifact blobs and syncs the vector store', async () => {
    db.deleteRecordingCascade.mockReturnValue({
      mode: 'hard',
      recordingId: 'r1',
      filename: 'r1.wav',
      filePath: '/data/r1.wav',
      artifactPaths: ['/data/artifacts/a.pdf', '/data/artifacts/b.png'],
      removed: { transcripts: 1 }
    })
    files.deleteRecording.mockReturnValue(true)
    files.removeMeetingWiki.mockReturnValue(2)
    files.existsSync.mockReturnValue(true)

    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(true)
    if (!res.success) return

    // Audio file unlinked via the sandboxed file-storage helper.
    expect(files.deleteRecording).toHaveBeenCalledWith('/data/r1.wav')
    expect(res.filesRemoved.audio).toBe(true)
    // Wiki pages purged.
    expect(files.removeMeetingWiki).toHaveBeenCalledWith('r1')
    expect(res.filesRemoved.wikiPages).toBe(2)
    // Artifact blobs unlinked.
    expect(files.unlinkSync).toHaveBeenCalledWith('/data/artifacts/a.pdf')
    expect(files.unlinkSync).toHaveBeenCalledWith('/data/artifacts/b.png')
    expect(res.filesRemoved.artifactBlobs).toBe(2)
    // In-memory vector store synced.
    expect(files.vectorDeleteByRecording).toHaveBeenCalledWith('r1')
  })

  it('does not unlink an artifact blob that no longer exists', async () => {
    db.deleteRecordingCascade.mockReturnValue({
      mode: 'hard',
      recordingId: 'r1',
      filename: 'r1.wav',
      filePath: null,
      artifactPaths: ['/data/artifacts/gone.pdf'],
      removed: {}
    })
    files.existsSync.mockReturnValue(false)
    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(true)
    expect(files.unlinkSync).not.toHaveBeenCalled()
  })

  it('errors when the recording is unknown', async () => {
    db.deleteRecordingCascade.mockReturnValue(undefined)
    const res = await deleteRecording('ghost', { hard: true })
    expect(res.success).toBe(false)
  })
})

describe('restoreDeletedRecording / getDeletionImpact', () => {
  it('delegates restore to the DB layer', () => {
    db.restoreRecording.mockReturnValue(true)
    expect(restoreDeletedRecording('r1')).toEqual({ success: true })
  })

  it('delegates impact to the DB layer', () => {
    db.getRecordingDeletionImpact.mockReturnValue({ recordingId: 'r1' })
    expect(getDeletionImpact('r1')).toEqual({ recordingId: 'r1' })
  })
})
