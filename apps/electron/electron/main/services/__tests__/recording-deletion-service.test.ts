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
  getRecordingDeletionImpact: vi.fn(),
  // F17/T6 (spec-006 AR3-2) — the pending-file-cleanup ledger. Defaulted so
  // every existing test's retry sweep (now unconditional on a hard purge) is
  // a true no-op unless a test explicitly wires backlog rows.
  recordPendingFileCleanups: vi.fn(),
  getPendingFileCleanups: vi.fn().mockReturnValue([]),
  updatePendingFileCleanups: vi.fn()
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
  getDeletionImpact,
  retryPendingFileCleanups
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

  // spec-006/F17 T6 AR3-2 — success reports allFilesRemoved:true and an empty
  // pendingFileKinds list when every target was confirmed removed.
  it('reports allFilesRemoved:true with no pending kinds when everything succeeds', async () => {
    db.deleteRecordingCascade.mockReturnValue({
      mode: 'hard',
      recordingId: 'r1',
      filename: 'r1.wav',
      filePath: '/data/r1.wav',
      artifactPaths: [],
      removed: {},
      journalId: 'journal-1'
    })
    files.deleteRecording.mockReturnValue(true)
    files.existsSync.mockReturnValue(true)
    files.removeMeetingWiki.mockReturnValue(0)

    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.allFilesRemoved).toBe(true)
    expect(res.pendingFileKinds).toEqual([])
    expect(db.recordPendingFileCleanups).not.toHaveBeenCalled()
  })
})

// spec-006/F17 T6 AR3-1/AR3-3 — the cascade throw for an unwired graph seam
// (or a pre-flight failure surfaced the same way) is translated into an
// explicit graphUnavailable:true flag so the caller can offer the
// skipGraphCleanup escape hatch — never automatically.
describe('deleteRecording — graphUnavailable propagation', () => {
  it('sets graphUnavailable:true for the fail-closed cascade message', async () => {
    db.deleteRecordingCascade.mockImplementation(() => {
      throw new Error('graph cleanup unavailable — purge refused (fail-closed)')
    })
    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.graphUnavailable).toBe(true)
    expect(res.error).toMatch(/graph cleanup unavailable/i)
  })

  it('does NOT set graphUnavailable for an unrelated cascade failure', async () => {
    db.deleteRecordingCascade.mockImplementation(() => {
      throw new Error('disk I/O error')
    })
    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.graphUnavailable).toBeUndefined()
  })
})

// spec-006/F17 T6 AR3-2 — post-commit file-cleanup partial-result contract:
// a failed unlink is recorded durably (keyed by the journal row id) rather
// than only logged, and the bounded retry sweep clears it on a later pass.
describe('AR3-2 — partial file-cleanup + retry ledger round-trip', () => {
  it('a locked audio file (existed, unlink failed) is recorded as pending and reported as a partial result', async () => {
    db.deleteRecordingCascade.mockReturnValue({
      mode: 'hard',
      recordingId: 'r1',
      filename: 'r1.wav',
      filePath: '/data/r1.wav',
      artifactPaths: [],
      removed: {},
      journalId: 'journal-locked'
    })
    files.deleteRecording.mockReturnValue(false) // unlink attempt failed
    files.existsSync.mockReturnValue(true) // ...but the file DID exist
    files.removeMeetingWiki.mockReturnValue(0)

    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(true)
    if (!res.success) return

    expect(db.recordPendingFileCleanups).toHaveBeenCalledWith('journal-locked', [
      { kind: 'audio', path: '/data/r1.wav' }
    ])
    expect(res.allFilesRemoved).toBe(false)
    expect(res.pendingFileKinds).toContain('audio')
  })

  it('an audio file that no longer exists is NOT treated as a pending failure', async () => {
    db.deleteRecordingCascade.mockReturnValue({
      mode: 'hard',
      recordingId: 'r1',
      filename: 'r1.wav',
      filePath: '/data/r1.wav',
      artifactPaths: [],
      removed: {},
      journalId: 'journal-gone'
    })
    files.deleteRecording.mockReturnValue(false) // nothing to remove
    files.existsSync.mockReturnValue(false) // ...because it was already gone
    files.removeMeetingWiki.mockReturnValue(0)

    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.allFilesRemoved).toBe(true)
    expect(db.recordPendingFileCleanups).not.toHaveBeenCalled()
  })

  it('a wiki-purge failure and a vector-store failure both record pending kinds', async () => {
    db.deleteRecordingCascade.mockReturnValue({
      mode: 'hard',
      recordingId: 'r1',
      filename: 'r1.wav',
      filePath: null,
      artifactPaths: [],
      removed: {},
      journalId: 'journal-mixed'
    })
    files.removeMeetingWiki.mockImplementation(() => {
      throw new Error('wiki dir locked')
    })
    files.vectorDeleteByRecording.mockRejectedValue(new Error('vector store busy'))

    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.allFilesRemoved).toBe(false)
    expect(res.pendingFileKinds.sort()).toEqual(['vector', 'wiki'])
    expect(db.recordPendingFileCleanups).toHaveBeenCalledWith(
      'journal-mixed',
      expect.arrayContaining([{ kind: 'wiki' }, { kind: 'vector' }])
    )
  })

  it('does not crash when the cascade result carries no journalId (defensive)', async () => {
    db.deleteRecordingCascade.mockReturnValue({
      mode: 'hard',
      recordingId: 'r1',
      filename: 'r1.wav',
      filePath: '/data/r1.wav',
      artifactPaths: [],
      removed: {}
      // no journalId
    })
    files.deleteRecording.mockReturnValue(false)
    files.existsSync.mockReturnValue(true)

    const res = await deleteRecording('r1', { hard: true })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.allFilesRemoved).toBe(false)
    expect(db.recordPendingFileCleanups).not.toHaveBeenCalled() // no journalId to key it by
  })

  describe('retryPendingFileCleanups', () => {
    it('clears a pending target once the retry succeeds', async () => {
      db.getPendingFileCleanups.mockReturnValueOnce([
        { journalId: 'journal-1', recordingId: 'r1', targets: [{ kind: 'audio', path: '/data/r1.wav' }] }
      ])
      files.deleteRecording.mockReturnValue(true) // retry succeeds this time

      const result = await retryPendingFileCleanups()

      expect(files.deleteRecording).toHaveBeenCalledWith('/data/r1.wav')
      expect(db.updatePendingFileCleanups).toHaveBeenCalledWith('journal-1', [])
      expect(result).toEqual({ attempted: 1, cleared: 1, stillPending: {} })
    })

    it('keeps a target pending when the retry fails again', async () => {
      db.getPendingFileCleanups.mockReturnValueOnce([
        { journalId: 'journal-1', recordingId: 'r1', targets: [{ kind: 'audio', path: '/data/r1.wav' }] }
      ])
      files.deleteRecording.mockReturnValue(false)
      files.existsSync.mockReturnValue(true)

      const result = await retryPendingFileCleanups()

      expect(db.updatePendingFileCleanups).toHaveBeenCalledWith('journal-1', [{ kind: 'audio', path: '/data/r1.wav' }])
      expect(result).toEqual({ attempted: 1, cleared: 0, stillPending: { 'journal-1': ['audio'] } })
    })

    it('retries wiki and vector targets by recordingId, and artifact targets by path', async () => {
      db.getPendingFileCleanups.mockReturnValueOnce([
        {
          journalId: 'journal-2',
          recordingId: 'r2',
          targets: [{ kind: 'wiki' }, { kind: 'vector' }, { kind: 'artifact', path: '/data/artifacts/a.pdf' }]
        }
      ])
      files.removeMeetingWiki.mockReturnValue(1)
      files.vectorDeleteByRecording.mockResolvedValue(0)
      files.existsSync.mockReturnValue(true)

      const result = await retryPendingFileCleanups()

      expect(files.removeMeetingWiki).toHaveBeenCalledWith('r2')
      expect(files.vectorDeleteByRecording).toHaveBeenCalledWith('r2')
      expect(files.unlinkSync).toHaveBeenCalledWith('/data/artifacts/a.pdf')
      expect(db.updatePendingFileCleanups).toHaveBeenCalledWith('journal-2', [])
      expect(result.cleared).toBe(1)
    })

    it('is bounded and non-fatal — a read failure resolves cleanly instead of throwing', async () => {
      db.getPendingFileCleanups.mockImplementationOnce(() => {
        throw new Error('db unavailable')
      })
      await expect(retryPendingFileCleanups()).resolves.toEqual({ attempted: 0, cleared: 0, stillPending: {} })
    })
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
