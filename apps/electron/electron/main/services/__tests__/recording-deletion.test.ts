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
  getQueueItems
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
    try { closeDatabase() } catch { /* already closed */ }
    cleanupDbFiles(paths.db)
  })

  beforeEach(() => {
    wipeData()
  })

  // -------------------------------------------------------------------------
  // personal flag
  // -------------------------------------------------------------------------
  describe('personal flag', () => {
    it('setRecordingPersonal toggles the flag and getExcludedRecordingIds reflects it', () => {
      seedRecording('r1')
      seedRecording('r2')
      expect(getExcludedRecordingIds().size).toBe(0)

      expect(setRecordingPersonal('r1', true)).toBe(true)
      const excluded = getExcludedRecordingIds()
      expect(excluded.has('r1')).toBe(true)
      expect(excluded.has('r2')).toBe(false)

      expect(setRecordingPersonal('r1', false)).toBe(false)
      expect(getExcludedRecordingIds().has('r1')).toBe(false)
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
      expect(getExcludedRecordingIds().has('r1')).toBe(true)
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
  })
})

// Reads a contact row directly (asserting the CONTACT is never deleted, only its
// meeting_contacts link). Declared after use — hoisted function declaration.
function getGlobalContact(id: string): unknown {
  return queryOne('SELECT id FROM contacts WHERE id = ?', [id])
}
