// @vitest-environment node

/**
 * Privacy source-deletion tests (v38) — real better-sqlite3 engine.
 *
 * Covers the two user intents end-to-end at the DB layer:
 *  - personal ("ignore") flag excludes a recording from AI pipeline read-sites
 *    (transcription enqueue, RAG exclusion set) and the Library default view.
 *  - the delete cascade: soft-delete hides + restore undoes; hard purge removes
 *    ALL derived rows (transcripts, embeddings, vector chunks, captures + every
 *    child, speaker bindings, candidates, synced_files, preassignments) and
 *    recomputes the meeting's participants WITHOUT orphaning a shared contact.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const paths = vi.hoisted(() => ({ db: '' }))
paths.db = join(tmpdir(), `hidock-deltest-${process.pid}-${Date.now()}.db`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => paths.db
}))

import {
  initializeDatabase,
  closeDatabase,
  getDatabase,
  run,
  queryOne,
  queryAll,
  runWithMassDeleteAllowed,
  getRecordings,
  getRecordingById,
  getTrashedRecordings,
  setRecordingPersonal,
  getExcludedRecordingIds,
  getRecordingDeletionImpact,
  deleteRecordingCascade,
  restoreRecording,
  addToQueue,
  getQueueItems,
  updateQueueItem,
  setGraphProvenanceCleanup,
  isGraphProvenanceCleanupRegistered,
  recordPendingFileCleanups,
  getPendingFileCleanups,
  updatePendingFileCleanups,
  getPendingGraphCleanups,
  retryPendingGraphCleanups,
  clearPendingGraphCleanup,
  isRecordingProcessable,
  markRecordingNotOnDeviceById,
  removeDeviceFileCacheEntry,
  type GraphProvenanceCleanupResult
} from '../database'

function cleanupDbFiles(base: string): void {
  for (const suffix of ['', '-wal', '-shm', '.tmp']) {
    if (existsSync(`${base}${suffix}`)) rmSync(`${base}${suffix}`, { force: true })
  }
}

const DATA_TABLES = [
  'transcription_queue',
  'vector_embeddings',
  'embeddings',
  'transcripts',
  'synced_files',
  'actionables',
  'action_items',
  'transcript_speakers',
  'turn_speaker_overrides',
  'speaker_splits',
  'mention_resolutions',
  'recording_meeting_candidates',
  'recording_preassignments',
  'meeting_contacts',
  'value_backfill_state',
  'knowledge_captures',
  'quality_assessments',
  'deletion_journal',
  'device_file_cache',
  'recordings',
  'contacts',
  'projects',
  'meetings'
]

function wipeData(): void {
  runWithMassDeleteAllowed(() => {
    for (const table of DATA_TABLES) {
      try {
        run(`DELETE FROM ${table}`)
      } catch {
        /* table may not exist yet */
      }
    }
  })
}

function seedMeeting(id: string, attendees?: Array<{ name?: string; email?: string }>): void {
  run(
    'INSERT INTO meetings (id, subject, start_time, end_time, attendees) VALUES (?, ?, ?, ?, ?)',
    [id, 'Sync', '2026-01-01T10:00:00.000Z', '2026-01-01T11:00:00.000Z', attendees ? JSON.stringify(attendees) : null]
  )
}

function seedRecording(id: string, opts: { filename?: string; file_path?: string | null; meeting_id?: string | null; personal?: number; original_filename?: string } = {}): void {
  run(
    `INSERT INTO recordings
       (id, filename, original_filename, file_path, date_recorded, meeting_id, status, location,
        transcription_status, on_device, on_local, source, is_imported, personal)
     VALUES (?, ?, ?, ?, ?, ?, 'none', 'local-only', 'none', 0, 1, 'hidock', 0, ?)`,
    [
      id,
      opts.filename ?? `${id}.wav`,
      opts.original_filename ?? `${id}.hda`,
      opts.file_path ?? `/data/${id}.wav`,
      '2026-01-01T10:00:00.000Z',
      opts.meeting_id ?? null,
      opts.personal ?? 0
    ]
  )
}

function seedTranscript(id: string, recordingId: string): void {
  run('INSERT INTO transcripts (id, recording_id, full_text) VALUES (?, ?, ?)', [id, recordingId, 'hello world content'])
}

function seedContact(id: string, name: string, email?: string): void {
  run(
    'INSERT INTO contacts (id, name, email, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    [id, name, email ?? null, '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z']
  )
}

// spec-006/F17 T6 AR3-1 — the hard branch FAILS CLOSED when the graph-cleanup
// seam is unregistered, so every existing hard-purge test here (which doesn't
// care about graph coupling) wires this explicit no-op stub. Individual AR3-1/
// N2 tests below temporarily override it (null, or a throwing/failing stub)
// and restore it in a `finally`.
function noopGraphCleanup(): GraphProvenanceCleanupResult {
  return {
    ok: true,
    markersRemoved: 0,
    edgesRemoved: 0,
    edgeSourceRowsRemoved: 0,
    meetingNodesRemoved: 0,
    orphanNodesRemoved: 0
  }
}

describe('Privacy source-deletion (v38)', () => {
  beforeAll(async () => {
    cleanupDbFiles(paths.db)
    await initializeDatabase()
    // vector_embeddings is created lazily by the vector store; create it here so
    // the cascade + counts have a real table to exercise.
    getDatabase().run(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY, content TEXT, embedding TEXT,
        meeting_id TEXT, recording_id TEXT, chunk_index INTEGER,
        timestamp TEXT, subject TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  })

  afterAll(() => {
    setGraphProvenanceCleanup(null)
    try { closeDatabase() } catch { /* already closed */ }
    cleanupDbFiles(paths.db)
  })

  beforeEach(() => {
    wipeData()
    setGraphProvenanceCleanup(noopGraphCleanup)
  })

  // -------------------------------------------------------------------------
  // personal flag
  // -------------------------------------------------------------------------
  describe('personal flag', () => {
    it('setRecordingPersonal toggles the flag and getExcludedRecordingIds reflects it', () => {
      seedRecording('r1')
      seedRecording('r2')
      expect(getExcludedRecordingIds().ids.size).toBe(0)

      expect(setRecordingPersonal('r1', true)).toBe(true)
      const excluded = getExcludedRecordingIds().ids
      expect(excluded.has('r1')).toBe(true)
      expect(excluded.has('r2')).toBe(false)

      expect(setRecordingPersonal('r1', false)).toBe(false)
      expect(getExcludedRecordingIds().ids.has('r1')).toBe(false)
    })

    it('returns undefined for an unknown recording', () => {
      expect(setRecordingPersonal('ghost', true)).toBeUndefined()
    })

    it('excludes personal recordings from the transcription enqueue chokepoint', () => {
      seedRecording('r1', { personal: 1 })
      seedRecording('r2')
      expect(addToQueue('r1')).toBe('') // refused
      expect(addToQueue('r2')).not.toBe('')
      const pending = getQueueItems('pending')
      expect(pending.map((q) => q.recording_id)).toEqual(['r2'])
    })

    it('marking personal removes its pending queue items', () => {
      seedRecording('r1')
      const qid = addToQueue('r1')
      expect(qid).not.toBe('')
      setRecordingPersonal('r1', true)
      expect(getQueueItems('pending').length).toBe(0)
    })

    it('personal recordings are still returned by getRecordings (shown behind a chip)', () => {
      seedRecording('r1', { personal: 1 })
      const rows = getRecordings()
      expect(rows.find((r) => r.id === 'r1')?.personal).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // soft delete + undo
  // -------------------------------------------------------------------------
  describe('soft delete + restore', () => {
    it('hides the recording from getRecordings and is reversible', () => {
      seedRecording('r1')
      seedTranscript('t1', 'r1')

      const res = deleteRecordingCascade('r1', { hard: false })
      expect(res?.mode).toBe('soft')
      expect(getRecordings().find((r) => r.id === 'r1')).toBeUndefined()
      // Derived data is untouched by a soft delete.
      expect(queryOne('SELECT id FROM transcripts WHERE recording_id = ?', ['r1'])).toBeTruthy()
      // Journal row written.
      expect(queryOne("SELECT id FROM deletion_journal WHERE recording_id = ? AND mode = 'soft'", ['r1'])).toBeTruthy()

      expect(restoreRecording('r1')).toBe(true)
      expect(getRecordings().find((r) => r.id === 'r1')).toBeTruthy()
      const journal = queryOne<{ restored_at?: string }>(
        "SELECT restored_at FROM deletion_journal WHERE recording_id = ? AND mode = 'soft'",
        ['r1']
      )
      expect(journal?.restored_at).toBeTruthy()
    })

    it('restore returns false for a recording that was never soft-deleted', () => {
      seedRecording('r1')
      expect(restoreRecording('r1')).toBe(false)
    })

    it('soft-deleted recordings are in the excluded set', () => {
      seedRecording('r1')
      deleteRecordingCascade('r1', { hard: false })
      expect(getExcludedRecordingIds().ids.has('r1')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Trash surface (spec-005/F17 T5 §D1) — getTrashedRecordings()
  // -------------------------------------------------------------------------
  describe('getTrashedRecordings', () => {
    it('returns only tombstoned (deleted_at IS NOT NULL) rows, live rows excluded', () => {
      seedRecording('r1')
      seedRecording('r2')
      deleteRecordingCascade('r1', { hard: false })

      const trashed = getTrashedRecordings()
      expect(trashed.map((r) => r.id)).toEqual(['r1'])
      expect(getRecordings().map((r) => r.id)).toEqual(['r2'])
    })

    it('orders newest-tombstone-first', () => {
      seedRecording('r1')
      seedRecording('r2')
      seedRecording('r3')
      deleteRecordingCascade('r1', { hard: false })
      deleteRecordingCascade('r2', { hard: false })
      deleteRecordingCascade('r3', { hard: false })
      // Stamp explicit, unambiguous deleted_at values — three sequential
      // real-clock calls can land in the same millisecond and make the ORDER BY
      // non-deterministic; this isolates the test from that timing race.
      run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-01-01T10:00:00.000Z', 'r1'])
      run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-01-01T11:00:00.000Z', 'r2'])
      run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-01-01T12:00:00.000Z', 'r3'])

      const trashed = getTrashedRecordings()
      expect(trashed.map((r) => r.id)).toEqual(['r3', 'r2', 'r1'])
    })

    it('excludes personal (but not deleted) recordings — personal and trashed are independent', () => {
      seedRecording('r1', { personal: 1 })
      seedRecording('r2')
      deleteRecordingCascade('r2', { hard: false })

      const trashed = getTrashedRecordings()
      expect(trashed.map((r) => r.id)).toEqual(['r2'])
    })

    it('a hard-purged recording never appears in Trash (it no longer exists)', () => {
      seedRecording('r1')
      deleteRecordingCascade('r1', { hard: true })
      expect(getTrashedRecordings()).toEqual([])
    })

    it('returns an empty array when nothing is soft-deleted', () => {
      seedRecording('r1')
      expect(getTrashedRecordings()).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // hard purge cascade
  // -------------------------------------------------------------------------
  describe('hard purge cascade', () => {
    function seedFullRecording(id: string, meetingId?: string): void {
      seedRecording(id, { meeting_id: meetingId ?? null })
      seedTranscript(`${id}-t`, id)
      run('INSERT INTO embeddings (id, transcript_id, chunk_index, chunk_text, embedding) VALUES (?, ?, 0, ?, ?)', [
        `${id}-e`, `${id}-t`, 'chunk', Buffer.from([1, 2, 3, 4])
      ])
      run('INSERT INTO vector_embeddings (id, content, embedding, recording_id, chunk_index) VALUES (?, ?, ?, ?, 0)', [
        `${id}-v`, 'chunk', 'x', id
      ])
      run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id) VALUES (?, ?, ?, ?)', [
        `${id}-c`, 'Cap', '2026-01-01T10:00:00.000Z', id
      ])
      run('INSERT INTO action_items (id, knowledge_capture_id, content) VALUES (?, ?, ?)', [`${id}-ai`, `${id}-c`, 'do it'])
      run("INSERT INTO actionables (id, type, title, source_knowledge_id, status) VALUES (?, 'email', 'A', ?, 'pending')", [`${id}-act`, `${id}-c`])
      run('INSERT INTO recording_meeting_candidates (id, recording_id, meeting_id, confidence_score) VALUES (?, ?, ?, 0.5)', [
        `${id}-cand`, id, meetingId ?? 'm-none'
      ])
      run('INSERT INTO synced_files (id, original_filename, local_filename, file_path) VALUES (?, ?, ?, ?)', [
        `${id}-sf`, `${id}.hda`, `${id}.wav`, `/data/${id}.wav`
      ])
      run('INSERT INTO recording_preassignments (filename, meeting_id) VALUES (?, ?)', [`${id}.wav`, null])
    }

    it('removes every derived row and reports accurate counts', () => {
      seedMeeting('m1')
      seedFullRecording('r1', 'm1')

      const res = deleteRecordingCascade('r1', { hard: true })
      expect(res?.mode).toBe('hard')
      expect(res?.removed.transcripts).toBe(1)
      expect(res?.removed.captures).toBe(1)
      expect(res?.removed.actionItems).toBe(1)
      expect(res?.removed.embeddings).toBe(2) // 1 transcript embedding + 1 vector chunk

      // Nothing derived survives.
      expect(queryAll('SELECT id FROM transcripts WHERE recording_id = ?', ['r1']).length).toBe(0)
      expect(queryAll('SELECT id FROM embeddings WHERE transcript_id = ?', ['r1-t']).length).toBe(0)
      expect(queryAll('SELECT id FROM vector_embeddings WHERE recording_id = ?', ['r1']).length).toBe(0)
      expect(queryAll('SELECT id FROM knowledge_captures WHERE id = ?', ['r1-c']).length).toBe(0)
      expect(queryAll('SELECT id FROM action_items WHERE id = ?', ['r1-ai']).length).toBe(0)
      expect(queryAll('SELECT id FROM actionables WHERE id = ?', ['r1-act']).length).toBe(0)
      expect(queryAll('SELECT id FROM recording_meeting_candidates WHERE recording_id = ?', ['r1']).length).toBe(0)
      expect(queryAll('SELECT id FROM synced_files WHERE original_filename = ?', ['r1.hda']).length).toBe(0)
      expect(queryAll('SELECT filename FROM recording_preassignments WHERE filename = ?', ['r1.wav']).length).toBe(0)
      expect(getRecordingById('r1')).toBeUndefined()

      // Audit journal records the hard purge.
      expect(queryOne("SELECT id FROM deletion_journal WHERE recording_id = ? AND mode = 'hard'", ['r1'])).toBeTruthy()
    })

    it('returns the audio + artifact paths for the caller to unlink', () => {
      seedRecording('r1', { file_path: '/data/r1.wav' })
      run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id) VALUES (?, ?, ?, ?)', [
        'r1-c', 'Cap', '2026-01-01T10:00:00.000Z', 'r1'
      ])
      run('INSERT INTO artifacts (id, knowledge_capture_id, kind, storage_path) VALUES (?, ?, ?, ?)', [
        'r1-a', 'r1-c', 'pdf', '/data/artifacts/r1.pdf'
      ])
      const res = deleteRecordingCascade('r1', { hard: true })
      expect(res?.filePath).toBe('/data/r1.wav')
      expect(res?.artifactPaths).toContain('/data/artifacts/r1.pdf')
    })

    // CX-T3-3 (F16/spec-003 fix round): the v43 value-backfill classification
    // markers are part of the purge contract — a hard-purged recording must
    // not leave its captures' bookkeeping behind (FKs are OFF; every capture
    // child is deleted explicitly).
    it('removes value-backfill classification markers for the purged captures (CX-T3-3)', () => {
      seedRecording('r1')
      run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id) VALUES (?, ?, ?, ?)', [
        'r1-c', 'Cap', '2026-01-01T10:00:00.000Z', 'r1'
      ])
      run(
        `INSERT INTO value_backfill_state (capture_id, status, result_rating, attempts)
         VALUES ('r1-c', 'classified', 'garbage', 1)`
      )
      // An unrelated recording's marker must survive the scoped purge.
      seedRecording('r2')
      run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id) VALUES (?, ?, ?, ?)', [
        'r2-c', 'Cap2', '2026-01-01T10:00:00.000Z', 'r2'
      ])
      run(
        `INSERT INTO value_backfill_state (capture_id, status, result_rating, attempts)
         VALUES ('r2-c', 'classified', 'unrated', 1)`
      )

      const res = deleteRecordingCascade('r1', { hard: true })

      expect(res?.mode).toBe('hard')
      expect(queryAll('SELECT capture_id FROM value_backfill_state WHERE capture_id = ?', ['r1-c']).length).toBe(0)
      expect(queryAll('SELECT capture_id FROM value_backfill_state WHERE capture_id = ?', ['r2-c']).length).toBe(1)
    })

    it('returns undefined for an unknown recording', () => {
      expect(deleteRecordingCascade('ghost', { hard: true })).toBeUndefined()
    })

    // AC#9 (spec-005/F17 T5) — permanent-delete FROM Trash: hard-purging a
    // recording that is currently soft-deleted (tombstoned) must still work,
    // since getRecordingById doesn't filter deleted_at.
    it('hard-purges a recording that is already soft-deleted (permanent-delete from Trash)', () => {
      seedRecording('r1')
      seedTranscript('t1', 'r1')
      deleteRecordingCascade('r1', { hard: false })
      expect(getTrashedRecordings().map((r) => r.id)).toEqual(['r1'])

      const res = deleteRecordingCascade('r1', { hard: true })

      expect(res?.mode).toBe('hard')
      expect(getRecordingById('r1')).toBeUndefined()
      expect(getTrashedRecordings()).toEqual([]) // it leaves the visible Trash list too
    })
  })

  // -------------------------------------------------------------------------
  // participant recompute — no orphaning of shared contacts
  // -------------------------------------------------------------------------
  describe('meeting participant recompute', () => {
    it('unlinks a contact contributed solely by the deleted recording but keeps a shared one', () => {
      seedMeeting('m1')
      // c-shared appears in TWO recordings of the meeting; c-only appears in one.
      seedContact('c-shared', 'Shared Person')
      seedContact('c-only', 'Solo Person')

      seedRecording('r1', { meeting_id: 'm1' })
      seedRecording('r2', { meeting_id: 'm1' })
      seedTranscript('t1', 'r1')
      seedTranscript('t2', 'r2')

      // Speaker bindings: r1 has both contacts, r2 has only the shared one.
      run('INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)', ['s1', 'r1', 'S1', 'c-shared'])
      run('INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)', ['s2', 'r1', 'S2', 'c-only'])
      run('INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)', ['s3', 'r2', 'S1', 'c-shared'])
      // meeting_contacts holds both (as assignSpeaker would have written).
      run("INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES ('m1', 'c-shared', 'attendee')")
      run("INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES ('m1', 'c-only', 'attendee')")

      const res = deleteRecordingCascade('r1', { hard: true })
      expect(res?.removed.meetingLinksRemoved).toBe(1)

      // Shared contact stays linked (justified by r2); solo contact is unlinked.
      const links = queryAll<{ contact_id: string }>('SELECT contact_id FROM meeting_contacts WHERE meeting_id = ?', ['m1'])
      const ids = links.map((l) => l.contact_id)
      expect(ids).toContain('c-shared')
      expect(ids).not.toContain('c-only')

      // Neither contact row is deleted — only the junction link.
      expect(getGlobalContact('c-shared')).toBeTruthy()
      expect(getGlobalContact('c-only')).toBeTruthy()
    })

    it('keeps a contact justified by the meeting calendar attendees (email match)', () => {
      seedMeeting('m1', [{ name: 'Cal Person', email: 'cal@example.com' }])
      seedContact('c-cal', 'Cal Person', 'cal@example.com')
      seedRecording('r1', { meeting_id: 'm1' })
      run('INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)', ['s1', 'r1', 'S1', 'c-cal'])
      run("INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES ('m1', 'c-cal', 'attendee')")

      deleteRecordingCascade('r1', { hard: true })
      const links = queryAll<{ contact_id: string }>('SELECT contact_id FROM meeting_contacts WHERE meeting_id = ?', ['m1'])
      expect(links.map((l) => l.contact_id)).toContain('c-cal')
    })
  })

  // -------------------------------------------------------------------------
  // deletion impact (confirm-dialog decidability)
  // -------------------------------------------------------------------------
  describe('getRecordingDeletionImpact', () => {
    it('reports what a hard purge would remove', () => {
      seedMeeting('m1')
      seedRecording('r1', { meeting_id: 'm1', file_path: '/data/r1.wav' })
      seedTranscript('t1', 'r1')
      run('INSERT INTO vector_embeddings (id, content, embedding, recording_id, chunk_index) VALUES (?, ?, ?, ?, 0)', ['v1', 'c', 'x', 'r1'])
      run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id) VALUES (?, ?, ?, ?)', ['c1', 'Cap', '2026-01-01T10:00:00.000Z', 'r1'])
      run('INSERT INTO action_items (id, knowledge_capture_id, content) VALUES (?, ?, ?)', ['ai1', 'c1', 'do'])

      const impact = getRecordingDeletionImpact('r1')
      expect(impact?.transcripts).toBe(1)
      expect(impact?.actionItems).toBe(1)
      expect(impact?.embeddings).toBe(1)
      expect(impact?.captures).toBe(1)
      expect(impact?.hasAudioFile).toBe(true)
    })

    it('returns undefined for an unknown recording', () => {
      expect(getRecordingDeletionImpact('ghost')).toBeUndefined()
    })

    // AC#9 (spec-005/F17 T5) — the Trash-mode "Delete permanently…" path depends
    // on getRecordingById NOT filtering deleted_at (verified anchor), so a
    // soft-deleted (tombstoned) recording must still resolve here.
    it('reports impact for a soft-deleted (tombstoned) recording', () => {
      seedRecording('r1', { file_path: '/data/r1.wav' })
      seedTranscript('t1', 'r1')
      deleteRecordingCascade('r1', { hard: false })
      expect(getRecordings().find((r) => r.id === 'r1')).toBeUndefined() // confirms it's really hidden

      const impact = getRecordingDeletionImpact('r1')
      expect(impact).toBeTruthy()
      expect(impact?.transcripts).toBe(1)
      expect(impact?.hasAudioFile).toBe(true)
    })

    // spec-006/F17 T6 D5 + F-INFO-6: onDevice/deviceFilename come straight
    // from the DB row (not the renderer's UnifiedRecording, which loses
    // deviceFilename entirely for a Trash row).
    it('reports onDevice:true and deviceFilename when the recording is marked on-device', () => {
      seedRecording('r1', { filename: 'on-device.wav' })
      run('UPDATE recordings SET on_device = 1 WHERE id = ?', ['r1'])
      const impact = getRecordingDeletionImpact('r1')
      expect(impact?.onDevice).toBe(true)
      expect(impact?.deviceFilename).toBe('on-device.wav')
    })

    it('reports onDevice:false and deviceFilename:null when not on device', () => {
      seedRecording('r1')
      const impact = getRecordingDeletionImpact('r1')
      expect(impact?.onDevice).toBe(false)
      expect(impact?.deviceFilename).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // spec-006/F17 T6 AR3-1 — fail-closed graph-cleanup seam
  // -------------------------------------------------------------------------
  describe('AR3-1 — fail-closed graph-cleanup seam', () => {
    it('refuses (throws) a hard purge when the seam is unwired, leaving the recording and its children fully intact', () => {
      seedRecording('r1')
      seedTranscript('t1', 'r1')
      setGraphProvenanceCleanup(null)
      try {
        expect(() => deleteRecordingCascade('r1', { hard: true })).toThrow(/graph cleanup unavailable/i)
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(getRecordingById('r1')).toBeTruthy()
      expect(queryOne('SELECT id FROM transcripts WHERE recording_id = ?', ['r1'])).toBeTruthy()
      expect(queryOne("SELECT id FROM deletion_journal WHERE recording_id = ? AND mode = 'hard'", ['r1'])).toBeFalsy()
    })

    it('does not affect a soft delete — the seam is never consulted', () => {
      seedRecording('r1')
      setGraphProvenanceCleanup(null)
      try {
        expect(() => deleteRecordingCascade('r1', { hard: false })).not.toThrow()
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(getRecordings().find((r) => r.id === 'r1')).toBeUndefined() // hidden, as expected
    })

    it('AR3-3(c) escape hatch: skipGraphCleanup bypasses the seam entirely, succeeding even while unwired', () => {
      seedRecording('r1')
      setGraphProvenanceCleanup(null)
      let res
      try {
        res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(res?.mode).toBe('hard')
      expect(res?.graphCleanupSkipped).toBe(true)
      expect(getRecordingById('r1')).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // N2 — a seam that reports/throws failure rolls back the WHOLE hard purge
  // -------------------------------------------------------------------------
  describe('N2 — crash-rollback when the graph-cleanup seam fails', () => {
    function seedRichRecording(id: string): void {
      seedRecording(id)
      seedTranscript(`${id}-t`, id)
      run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id) VALUES (?, ?, ?, ?)', [
        `${id}-c`, 'Cap', '2026-01-01T10:00:00.000Z', id
      ])
    }

    it('a THROWING seam rolls back cascade rows + knowledge captures together (single-txn rollback)', () => {
      seedRichRecording('r1')
      setGraphProvenanceCleanup(() => {
        throw new Error('graph store exploded')
      })
      try {
        expect(() => deleteRecordingCascade('r1', { hard: true })).toThrow(/graph store exploded/)
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(getRecordingById('r1')).toBeTruthy()
      expect(queryAll('SELECT id FROM transcripts WHERE recording_id = ?', ['r1']).length).toBe(1)
      expect(queryAll('SELECT id FROM knowledge_captures WHERE id = ?', ['r1-c']).length).toBe(1)
      expect(queryOne("SELECT id FROM deletion_journal WHERE recording_id = ? AND mode = 'hard'", ['r1'])).toBeFalsy()
    })

    it('a seam reporting {ok:false} (no throw) also aborts the whole purge', () => {
      seedRichRecording('r1')
      setGraphProvenanceCleanup(() => ({
        ok: false,
        error: 'graph write failed',
        markersRemoved: 0,
        edgesRemoved: 0,
        edgeSourceRowsRemoved: 0,
        meetingNodesRemoved: 0,
        orphanNodesRemoved: 0
      }))
      try {
        expect(() => deleteRecordingCascade('r1', { hard: true })).toThrow(/graph write failed/)
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(getRecordingById('r1')).toBeTruthy()
      expect(queryAll('SELECT id FROM knowledge_captures WHERE id = ?', ['r1-c']).length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Journal privacy (AR3-7, extends D4) — the hard row's exact persisted shape
  // -------------------------------------------------------------------------
  describe('hard journal privacy (AR3-7)', () => {
    it('a normal hard purge journals recording_snapshot=NULL and removed_counts=NULL, keeping only the opaque recording_id/mode/created_at', () => {
      seedRecording('r1', { filename: 'secret.wav', original_filename: 'secret.hda' })
      deleteRecordingCascade('r1', { hard: true })

      const row = queryOne<{
        id: string
        recording_id: string
        mode: string
        recording_snapshot: string | null
        removed_counts: string | null
        created_at: string
        restored_at: string | null
      }>("SELECT * FROM deletion_journal WHERE recording_id = ? AND mode = 'hard'", ['r1'])

      expect(row).toBeTruthy()
      expect(row).toEqual({
        id: row!.id,
        recording_id: 'r1',
        mode: 'hard',
        recording_snapshot: null,
        removed_counts: null,
        created_at: row!.created_at,
        restored_at: null
      })
      expect(row!.created_at).toBeTruthy()
      // No filename/path leaked anywhere in the row.
      expect(JSON.stringify(row)).not.toContain('secret')
    })

    it('the escape-hatch purge journals {mode, graph_cleanup_skipped, pending_graph ledger} and still nulls removed_counts (ARF-4)', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })
      const row = queryOne<{ recording_snapshot: string | null; removed_counts: string | null }>(
        'SELECT recording_snapshot, removed_counts FROM deletion_journal WHERE id = ?',
        [res!.journalId!]
      )
      // ARF-4 — the escape hatch now persists a durable pending-graph-cleanup
      // ledger (ids for the deferred retry sweep) alongside the audit marker.
      expect(JSON.parse(row!.recording_snapshot!)).toEqual({
        mode: 'hard',
        graph_cleanup_skipped: true,
        pending_graph: { recordingId: 'r1', meetingId: 'r1', transcriptIds: [] }
      })
      expect(row!.removed_counts).toBeNull()
    })

    it('the soft-delete journal is UNCHANGED — full recording snapshot for restore fidelity', () => {
      seedRecording('r1', { filename: 'keepme.wav' })
      deleteRecordingCascade('r1', { hard: false })
      const row = queryOne<{ recording_snapshot: string }>(
        "SELECT recording_snapshot FROM deletion_journal WHERE recording_id = ? AND mode = 'soft'",
        ['r1']
      )
      const snap = JSON.parse(row!.recording_snapshot)
      expect(snap.id).toBe('r1')
      expect(snap.filename).toBe('keepme.wav')
    })
  })

  // -------------------------------------------------------------------------
  // Graph actual counts + pre-captured meetingId/transcriptIds threading (D1)
  // -------------------------------------------------------------------------
  describe('graph seam wiring — actual counts + pre-captured ids', () => {
    it('merges the seam actual counts into removed', () => {
      seedRecording('r1')
      setGraphProvenanceCleanup(() => ({
        ok: true,
        markersRemoved: 2,
        edgesRemoved: 3,
        edgeSourceRowsRemoved: 4,
        meetingNodesRemoved: 1,
        orphanNodesRemoved: 5
      }))
      let res
      try {
        res = deleteRecordingCascade('r1', { hard: true })
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(res?.removed.markersRemoved).toBe(2)
      expect(res?.removed.edgesRemoved).toBe(3)
      expect(res?.removed.edgeSourceRowsRemoved).toBe(4)
      expect(res?.removed.meetingNodesRemoved).toBe(1)
      expect(res?.removed.orphanNodesRemoved).toBe(5)
    })

    it('passes the pre-captured meetingId and transcriptIds to the seam', () => {
      seedMeeting('m1')
      seedRecording('r1', { meeting_id: 'm1' })
      seedTranscript('t1', 'r1')
      const seen: Array<{ id: string; opts: { meetingId?: string; transcriptIds?: string[] } }> = []
      setGraphProvenanceCleanup((id, opts) => {
        seen.push({ id, opts })
        return noopGraphCleanup()
      })
      try {
        deleteRecordingCascade('r1', { hard: true })
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(seen).toEqual([{ id: 'r1', opts: { meetingId: 'm1', transcriptIds: ['t1'] } }])
    })

    it('falls back to recordingId as meetingId when the recording has no meeting_id', () => {
      seedRecording('r1')
      const seen: Array<{ meetingId?: string }> = []
      setGraphProvenanceCleanup((_id, opts) => {
        seen.push(opts)
        return noopGraphCleanup()
      })
      try {
        deleteRecordingCascade('r1', { hard: true })
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(seen[0].meetingId).toBe('r1')
    })

    it('journalId is returned for a hard purge and points at a real journal row', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true })
      expect(res?.journalId).toBeTruthy()
      expect(queryOne('SELECT id FROM deletion_journal WHERE id = ?', [res?.journalId])).toBeTruthy()
    })

    it('journalId is absent for a soft delete', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: false })
      expect(res?.journalId).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // AR3-2 DB ledger helpers — pending post-commit file-cleanup round trip
  // -------------------------------------------------------------------------
  describe('AR3-2 pending-file-cleanup ledger (DB layer)', () => {
    it('recordPendingFileCleanups writes pending_files, merging with an existing graph_cleanup_skipped flag rather than clobbering it', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })
      recordPendingFileCleanups(res!.journalId!, [{ kind: 'audio', path: '/data/r1.wav' }])

      const row = queryOne<{ recording_snapshot: string }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res!.journalId!]
      )
      expect(JSON.parse(row!.recording_snapshot)).toEqual({
        mode: 'hard',
        graph_cleanup_skipped: true,
        // ARF-4 — the escape hatch's pending_graph ledger coexists with pending_files.
        pending_graph: { recordingId: 'r1', meetingId: 'r1', transcriptIds: [] },
        pending_files: [{ kind: 'audio', path: '/data/r1.wav' }]
      })
    })

    it('recordPendingFileCleanups([]) is a no-op — the row stays NULL', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true })
      recordPendingFileCleanups(res!.journalId!, [])
      const row = queryOne<{ recording_snapshot: string | null }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res!.journalId!]
      )
      expect(row!.recording_snapshot).toBeNull()
    })

    it('getPendingFileCleanups returns only rows carrying pending_files, newest first, respecting the limit', () => {
      seedRecording('r1')
      seedRecording('r2')
      seedRecording('r3')
      const res1 = deleteRecordingCascade('r1', { hard: true })!
      const res2 = deleteRecordingCascade('r2', { hard: true })!
      const res3 = deleteRecordingCascade('r3', { hard: true })!
      // Explicit, unambiguous created_at ordering (avoids a same-millisecond race).
      run("UPDATE deletion_journal SET created_at = '2026-01-01T10:00:00.000Z' WHERE id = ?", [res1.journalId])
      run("UPDATE deletion_journal SET created_at = '2026-01-01T11:00:00.000Z' WHERE id = ?", [res2.journalId])
      run("UPDATE deletion_journal SET created_at = '2026-01-01T12:00:00.000Z' WHERE id = ?", [res3.journalId])
      recordPendingFileCleanups(res1.journalId!, [{ kind: 'audio', path: '/data/r1.wav' }])
      recordPendingFileCleanups(res3.journalId!, [{ kind: 'wiki' }])
      // res2 has no pending files — must not appear.

      const all = getPendingFileCleanups(10)
      expect(all.map((r) => r.journalId)).toEqual([res3.journalId, res1.journalId])

      const limited = getPendingFileCleanups(1)
      expect(limited.map((r) => r.journalId)).toEqual([res3.journalId])
    })

    it('updatePendingFileCleanups clears pending_files (nulls the column) when nothing else remains on the snapshot', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true })!
      recordPendingFileCleanups(res.journalId!, [{ kind: 'audio', path: '/data/r1.wav' }])
      updatePendingFileCleanups(res.journalId!, [])
      const row = queryOne<{ recording_snapshot: string | null }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res.journalId!]
      )
      expect(row!.recording_snapshot).toBeNull()
    })

    it('updatePendingFileCleanups preserves graph_cleanup_skipped + pending_graph when clearing pending_files', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })!
      recordPendingFileCleanups(res.journalId!, [{ kind: 'audio', path: '/data/r1.wav' }])
      updatePendingFileCleanups(res.journalId!, [])
      const row = queryOne<{ recording_snapshot: string }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res.journalId!]
      )
      // ARF-4 — clearing the file ledger must not drop the graph ledger.
      expect(JSON.parse(row!.recording_snapshot)).toEqual({
        mode: 'hard',
        graph_cleanup_skipped: true,
        pending_graph: { recordingId: 'r1', meetingId: 'r1', transcriptIds: [] }
      })
    })

    it('updatePendingFileCleanups writes back a still-remaining subset', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true })!
      recordPendingFileCleanups(res.journalId!, [{ kind: 'audio', path: '/data/r1.wav' }, { kind: 'wiki' }])
      updatePendingFileCleanups(res.journalId!, [{ kind: 'wiki' }])
      const row = queryOne<{ recording_snapshot: string }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res.journalId!]
      )
      expect(JSON.parse(row!.recording_snapshot).pending_files).toEqual([{ kind: 'wiki' }])
    })

    // OP-NIT (T6 fix round): a rewrite of a missing/malformed snapshot must
    // keep the JSON self-describing — seeded with {mode:'hard'}, matching
    // recordPendingFileCleanups (the mode COLUMN stays authoritative either
    // way; this is consistency, not correctness).
    it('updatePendingFileCleanups preserves the in-JSON mode field when rewriting a malformed snapshot', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true })!
      run("UPDATE deletion_journal SET recording_snapshot = 'not-json' WHERE id = ?", [res.journalId!])

      updatePendingFileCleanups(res.journalId!, [{ kind: 'wiki' }])

      const row = queryOne<{ recording_snapshot: string }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res.journalId!]
      )
      expect(JSON.parse(row!.recording_snapshot)).toEqual({ mode: 'hard', pending_files: [{ kind: 'wiki' }] })
    })

    it('updatePendingFileCleanups keeps the in-JSON mode when writing pending_files onto a NULL snapshot', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true })! // snapshot NULL per AR3-7

      updatePendingFileCleanups(res.journalId!, [{ kind: 'audio', path: '/data/r1.wav' }])

      const row = queryOne<{ recording_snapshot: string }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res.journalId!]
      )
      expect(JSON.parse(row!.recording_snapshot)).toEqual({
        mode: 'hard',
        pending_files: [{ kind: 'audio', path: '/data/r1.wav' }]
      })
    })
  })

  // -------------------------------------------------------------------------
  // CX-T6-1 (fix round) — offline device-cache reconciliation by filename
  // -------------------------------------------------------------------------
  describe('removeDeviceFileCacheEntry (CX-T6-1)', () => {
    it('does not throw when the device_file_cache table does not exist yet', () => {
      run('DROP TABLE IF EXISTS device_file_cache')
      expect(() => removeDeviceFileCacheEntry('ghost.hda')).not.toThrow()
    })

    it('removes exactly the named cache entry, leaving others intact', () => {
      // The table is created lazily by deviceCache:saveAll in production;
      // mirror its DDL here.
      run(`CREATE TABLE IF NOT EXISTS device_file_cache (
        filename TEXT PRIMARY KEY, size INTEGER, duration REAL, dateCreated TEXT
      )`)
      run("INSERT INTO device_file_cache (filename, size, duration, dateCreated) VALUES ('purged.hda', 10, 1.0, '2026-01-01')")
      run("INSERT INTO device_file_cache (filename, size, duration, dateCreated) VALUES ('kept.hda', 20, 2.0, '2026-01-02')")

      removeDeviceFileCacheEntry('purged.hda')

      const rows = queryAll<{ filename: string }>('SELECT filename FROM device_file_cache')
      expect(rows.map((r) => r.filename)).toEqual(['kept.hda'])
    })

    it('is a no-op for a filename that is not cached', () => {
      run(`CREATE TABLE IF NOT EXISTS device_file_cache (
        filename TEXT PRIMARY KEY, size INTEGER, duration REAL, dateCreated TEXT
      )`)
      run("INSERT INTO device_file_cache (filename, size, duration, dateCreated) VALUES ('kept.hda', 20, 2.0, '2026-01-02')")

      expect(() => removeDeviceFileCacheEntry('never-cached.hda')).not.toThrow()
      expect(queryAll('SELECT filename FROM device_file_cache').length).toBe(1)
    })

    // CX-T6-5 (fix round 2): ONLY the missing-table condition is tolerated —
    // any REAL DB failure must propagate, so recordings:markNotOnDevice
    // reports {success:false} instead of a false success that lets the
    // ghost cache row survive a restart. Injected via a RAISE(ABORT)
    // trigger — a genuine sqlite error whose message is NOT "no such table".
    it('propagates a real (non-missing-table) DB failure instead of swallowing it', () => {
      run(`CREATE TABLE IF NOT EXISTS device_file_cache (
        filename TEXT PRIMARY KEY, size INTEGER, duration REAL, dateCreated TEXT
      )`)
      run("INSERT INTO device_file_cache (filename, size, duration, dateCreated) VALUES ('stuck.hda', 10, 1.0, '2026-01-01')")
      run(`CREATE TRIGGER fail_cache_delete BEFORE DELETE ON device_file_cache
           BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END`)
      try {
        expect(() => removeDeviceFileCacheEntry('stuck.hda')).toThrow(/disk I\/O error/)
        // ...and the row genuinely survived (the failure was real, not cosmetic).
        expect(queryAll('SELECT filename FROM device_file_cache').length).toBe(1)
      } finally {
        run('DROP TRIGGER IF EXISTS fail_cache_delete')
      }
    })
  })

  // -------------------------------------------------------------------------
  // AR3-6(b) — immediate single-recording device reconciliation
  // -------------------------------------------------------------------------
  describe('markRecordingNotOnDeviceById (AR3-6b)', () => {
    it('flips on_device to 0 and location to local-only when also on_local', () => {
      seedRecording('r1')
      run("UPDATE recordings SET on_device = 1, location = 'both' WHERE id = ?", ['r1'])
      markRecordingNotOnDeviceById('r1')
      const rec = getRecordingById('r1')
      expect(rec?.on_device).toBe(0)
      expect(rec?.location).toBe('local-only')
    })

    it('sets location to deleted when not on_local either', () => {
      seedRecording('r1')
      run("UPDATE recordings SET on_device = 1, on_local = 0, location = 'device-only' WHERE id = ?", ['r1'])
      markRecordingNotOnDeviceById('r1')
      const rec = getRecordingById('r1')
      expect(rec?.location).toBe('deleted')
    })

    it('no-ops for an unknown recording (does not throw)', () => {
      expect(() => markRecordingNotOnDeviceById('ghost')).not.toThrow()
    })

    it('no-ops when the recording is already not on device', () => {
      seedRecording('r1')
      markRecordingNotOnDeviceById('r1')
      const rec = getRecordingById('r1')
      expect(rec?.location).toBe('local-only') // unchanged from seedRecording's default
    })
  })

  // -------------------------------------------------------------------------
  // ARF-1 — a hard purge removes every PRIOR journal row for the recording
  // (soft snapshots), leaving only the minimal opaque hard audit row.
  // -------------------------------------------------------------------------
  describe('ARF-1 — prior journal rows purged on hard delete', () => {
    it('soft-delete then hard purge leaves NO journal row retaining the soft snapshot', () => {
      seedRecording('r1', { filename: 'secret.wav', original_filename: 'secret.hda' })
      seedTranscript('t1', 'r1')

      // Soft delete writes a FULL-snapshot journal row (filename/paths/etc.).
      deleteRecordingCascade('r1', { hard: false })
      const softRow = queryOne<{ recording_snapshot: string }>(
        "SELECT recording_snapshot FROM deletion_journal WHERE recording_id = ? AND mode = 'soft'",
        ['r1']
      )
      expect(JSON.parse(softRow!.recording_snapshot).filename).toBe('secret.wav')

      // Hard purge must delete that soft row and keep ONLY the minimal hard row.
      deleteRecordingCascade('r1', { hard: true })
      const rows = queryAll<{ mode: string; recording_snapshot: string | null }>(
        'SELECT mode, recording_snapshot FROM deletion_journal WHERE recording_id = ?',
        ['r1']
      )
      expect(rows.length).toBe(1)
      expect(rows[0].mode).toBe('hard')
      expect(rows[0].recording_snapshot).toBeNull()
      // The soft snapshot's sensitive data is gone from the journal entirely.
      const allJournal = queryAll<{ recording_snapshot: string | null }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE recording_id = ?',
        ['r1']
      )
      expect(JSON.stringify(allJournal)).not.toContain('secret')
    })

    it('purges MULTIPLE prior soft rows (repeated trash/restore cycles) on hard delete', () => {
      seedRecording('r1', { filename: 'keepme.wav' })
      deleteRecordingCascade('r1', { hard: false })
      restoreRecording('r1')
      // Second trash writes a SECOND soft journal row for the same recording.
      deleteRecordingCascade('r1', { hard: false })
      expect(
        queryAll("SELECT id FROM deletion_journal WHERE recording_id = ? AND mode = 'soft'", ['r1']).length
      ).toBeGreaterThanOrEqual(2)

      deleteRecordingCascade('r1', { hard: true })
      const rows = queryAll<{ mode: string }>('SELECT mode FROM deletion_journal WHERE recording_id = ?', ['r1'])
      expect(rows.map((r) => r.mode)).toEqual(['hard'])
    })
  })

  // -------------------------------------------------------------------------
  // ARF-3 — soft delete / mark-personal tombstones a PROCESSING queue row, and
  // isRecordingProcessable gates in-flight post-analysis persistence.
  // -------------------------------------------------------------------------
  describe('ARF-3 — in-flight transcription is stopped', () => {
    it('soft delete cancels a PROCESSING queue row (not just pending/failed)', () => {
      seedRecording('r1')
      const qid = addToQueue('r1')
      updateQueueItem(qid, 'processing')
      expect(getQueueItems('processing').map((q) => q.recording_id)).toEqual(['r1'])

      deleteRecordingCascade('r1', { hard: false })

      expect(getQueueItems('processing').length).toBe(0)
      const row = queryOne<{ status: string }>('SELECT status FROM transcription_queue WHERE id = ?', [qid])
      expect(row?.status).toBe('cancelled')
    })

    it('marking personal cancels a PROCESSING queue row', () => {
      seedRecording('r1')
      const qid = addToQueue('r1')
      updateQueueItem(qid, 'processing')
      setRecordingPersonal('r1', true)
      const row = queryOne<{ status: string }>('SELECT status FROM transcription_queue WHERE id = ?', [qid])
      expect(row?.status).toBe('cancelled')
    })

    it('isRecordingProcessable is true only for a live, non-deleted, non-personal recording', () => {
      seedRecording('live')
      seedRecording('personal', { personal: 1 })
      seedRecording('trashed')
      deleteRecordingCascade('trashed', { hard: false })

      expect(isRecordingProcessable('live')).toBe(true)
      expect(isRecordingProcessable('personal')).toBe(false)
      expect(isRecordingProcessable('trashed')).toBe(false)
      expect(isRecordingProcessable('ghost')).toBe(false)
      // Restoring makes it processable again.
      restoreRecording('trashed')
      expect(isRecordingProcessable('trashed')).toBe(true)
    })

    it('a value-excluded (but live) recording is STILL processable — value gating is separate', () => {
      seedRecording('r1')
      run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)', [
        'r1-c', 'Cap', '2026-01-01T10:00:00.000Z', 'r1', 'garbage'
      ])
      expect(getExcludedRecordingIds().ids.has('r1')).toBe(true) // value-excluded from AI surfaces
      expect(isRecordingProcessable('r1')).toBe(true) // but still transcribable / its own derivatives allowed
    })
  })

  // -------------------------------------------------------------------------
  // ARF-4 — durable pending-graph-cleanup ledger + retry sweep for the
  // skipGraphCleanup escape hatch.
  // -------------------------------------------------------------------------
  describe('ARF-4 — deferred graph-cleanup ledger + sweep', () => {
    it('the escape hatch writes a pending_graph ledger entry the sweep can read', () => {
      seedMeeting('m1')
      seedRecording('r1', { meeting_id: 'm1' })
      seedTranscript('t1', 'r1')
      const res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })!

      const pending = getPendingGraphCleanups()
      expect(pending.length).toBe(1)
      expect(pending[0]).toEqual({
        journalId: res.journalId,
        recordingId: 'r1',
        meetingId: 'm1',
        transcriptIds: ['t1']
      })
    })

    it('retryPendingGraphCleanups calls the seam by ids and clears the entry on success', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })!
      // The escape hatch bypassed the seam, so the ledger entry exists.
      expect(getPendingGraphCleanups().map((p) => p.journalId)).toEqual([res.journalId])

      const seen: Array<{ id: string; opts: { meetingId?: string; transcriptIds?: string[] } }> = []
      setGraphProvenanceCleanup((id, opts) => {
        seen.push({ id, opts })
        return noopGraphCleanup()
      })
      try {
        const sweep = retryPendingGraphCleanups()
        expect(sweep.attempted).toBe(1)
        expect(sweep.cleared).toBe(1)
        expect(sweep.clearedJournalIds).toEqual([res.journalId])
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      // Seam was invoked with the stored ids.
      expect(seen).toEqual([{ id: 'r1', opts: { meetingId: 'r1', transcriptIds: [] } }])
      // Ledger's pending_graph is cleared; the graph_cleanup_skipped AUDIT
      // marker (that the hatch was used) is deliberately preserved.
      expect(getPendingGraphCleanups()).toEqual([])
      const row = queryOne<{ recording_snapshot: string | null }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res.journalId]
      )
      expect(JSON.parse(row!.recording_snapshot!)).toEqual({ mode: 'hard', graph_cleanup_skipped: true })
    })

    it('a failing seam leaves the ledger entry for a later sweep (crash/restart resilience)', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })!

      // Simulate the crash-between-purge-and-sweep window: the entry is durably
      // on disk. A first sweep with a still-unhealthy graph fails to clear it.
      setGraphProvenanceCleanup(() => ({
        ok: false,
        error: 'graph still down',
        markersRemoved: 0,
        edgesRemoved: 0,
        edgeSourceRowsRemoved: 0,
        meetingNodesRemoved: 0,
        orphanNodesRemoved: 0
      }))
      let firstSweep
      try {
        firstSweep = retryPendingGraphCleanups()
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(firstSweep!.cleared).toBe(0)
      expect(firstSweep!.stillPending).toEqual([res.journalId])
      // Entry SURVIVES for the next sweep.
      expect(getPendingGraphCleanups().map((p) => p.journalId)).toEqual([res.journalId])

      // Next sweep with a healthy graph clears it.
      const secondSweep = retryPendingGraphCleanups()
      expect(secondSweep.cleared).toBe(1)
      expect(getPendingGraphCleanups()).toEqual([])
    })

    it('retryPendingGraphCleanups is a no-op when the seam is unwired (entries survive)', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })!
      setGraphProvenanceCleanup(null)
      try {
        const sweep = retryPendingGraphCleanups()
        expect(sweep).toEqual({ attempted: 0, cleared: 0, clearedJournalIds: [], stillPending: [] })
      } finally {
        setGraphProvenanceCleanup(noopGraphCleanup)
      }
      expect(getPendingGraphCleanups().map((p) => p.journalId)).toEqual([res.journalId])
    })

    it('a normal (non-escape-hatch) hard purge leaves NO pending_graph entry', () => {
      seedRecording('r1')
      deleteRecordingCascade('r1', { hard: true })
      expect(getPendingGraphCleanups()).toEqual([])
    })

    it('clearPendingGraphCleanup preserves other snapshot fields (e.g. pending_files)', () => {
      seedRecording('r1')
      const res = deleteRecordingCascade('r1', { hard: true, skipGraphCleanup: true })!
      recordPendingFileCleanups(res.journalId!, [{ kind: 'audio', path: '/data/r1.wav' }])
      clearPendingGraphCleanup(res.journalId!)
      const row = queryOne<{ recording_snapshot: string }>(
        'SELECT recording_snapshot FROM deletion_journal WHERE id = ?',
        [res.journalId!]
      )
      expect(JSON.parse(row!.recording_snapshot)).toEqual({
        mode: 'hard',
        graph_cleanup_skipped: true,
        pending_files: [{ kind: 'audio', path: '/data/r1.wav' }]
      })
    })
  })

  // -------------------------------------------------------------------------
  // Wiring-guard support — the seam-registration query itself
  // -------------------------------------------------------------------------
  describe('isGraphProvenanceCleanupRegistered', () => {
    it('reflects the current wiring state', () => {
      setGraphProvenanceCleanup(null)
      expect(isGraphProvenanceCleanupRegistered()).toBe(false)
      setGraphProvenanceCleanup(noopGraphCleanup)
      expect(isGraphProvenanceCleanupRegistered()).toBe(true)
    })
  })
})

// Reads a contact row directly (asserting the CONTACT is never deleted, only its
// meeting_contacts link). Declared after use — hoisted function declaration.
function getGlobalContact(id: string): unknown {
  return queryOne('SELECT id FROM contacts WHERE id = ?', [id])
}
