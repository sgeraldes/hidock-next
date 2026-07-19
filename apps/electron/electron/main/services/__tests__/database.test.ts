// @vitest-environment node

/**
 * Database Service Tests (real better-sqlite3 engine).
 *
 * Exercises the critical backend database service against a REAL temp-file
 * SQLite database (better-sqlite3 + WAL via @hidock/database), not mocks. Each
 * function under test is driven end-to-end and asserted against actual queried
 * rows and real SQL semantics (FK/NOT NULL/CHECK constraints, INSERT OR
 * REPLACE, LEFT JOIN, UNION). Engine internals (WAL, migration runner, the
 * sql.js-compatibility facade) are covered by the @hidock/database package's
 * own tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync, readFileSync } from 'fs'

/**
 * The app's target schema version, read from database.ts rather than hardcoded.
 * Pinning a literal here meant every schema bump silently drifted the assertion
 * away from its own test title (it read "(40)" while asserting 42).
 */
const EXPECTED_SCHEMA_VERSION = Number(
  readFileSync(join(__dirname, '..', 'database.ts'), 'utf-8').match(/const SCHEMA_VERSION = (\d+)\b/)![1]
)

// The engine resolves its file via file-storage.getDatabasePath. A hoisted
// holder lets us point it at a unique temp path (vi.mock factories cannot close
// over ordinary top-level variables).
const paths = vi.hoisted(() => ({ db: '' }))
paths.db = join(tmpdir(), `hidock-dbtest-${process.pid}-${Date.now()}.db`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => paths.db
}))

import {
  initializeDatabase,
  closeDatabase,
  saveDatabase,
  getDatabase,
  run,
  queryOne,
  queryAll,
  runWithMassDeleteAllowed,
  getRecordingById,
  resolveRecordingId,
  insertRecording,
  markRecordingDownloaded,
  updateRecordingStatus,
  updateRecordingTranscriptionStatus,
  insertTranscript,
  addToQueue,
  getQueueItems,
  updateQueueItem,
  removeFromQueueByRecordingId,
  cancelPendingTranscriptions,
  resetStuckTranscriptions,
  addProjectNote,
  getProjectNotes,
  updateProjectNote,
  deleteProjectNote,
  getActionablesForProject
} from '../database'

// ---------------------------------------------------------------------------
// File + table lifecycle
// ---------------------------------------------------------------------------

function cleanupDbFiles(base: string): void {
  for (const suffix of ['', '-wal', '-shm', '.tmp']) {
    if (existsSync(`${base}${suffix}`)) rmSync(`${base}${suffix}`, { force: true })
  }
}

// Tables seeded/asserted by the suite, in child→parent order so the wipe
// respects foreign keys (some FKs are RESTRICT, not CASCADE).
const DATA_TABLES = [
  'transcription_queue',
  'transcripts',
  'synced_files',
  'actionables',
  'project_notes',
  'meeting_projects',
  'knowledge_projects',
  'knowledge_captures',
  'quality_assessments',
  'recording_preassignments',
  'recordings',
  'projects',
  'meetings'
]

function wipeData(): void {
  runWithMassDeleteAllowed(() => {
    for (const table of DATA_TABLES) {
      try {
        run(`DELETE FROM ${table}`)
      } catch {
        /* table may not exist in this schema build; ignore */
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Seed helpers (satisfy NOT NULL + FK; unique ids per call site)
// ---------------------------------------------------------------------------

function seedMeeting(id: string, subject = 'Sync'): void {
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [
    id,
    subject,
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T11:00:00.000Z'
  ])
}

function seedProject(id: string, name = 'Project'): void {
  run('INSERT INTO projects (id, name, status) VALUES (?, ?, ?)', [id, name, 'active'])
}

interface SeedRecordingOpts {
  filename?: string
  file_path?: string | null
  date_recorded?: string
  meeting_id?: string | null
  status?: string
  location?: string
  transcription_status?: string
  on_device?: number
  on_local?: number
}

function seedRecording(id: string, opts: SeedRecordingOpts = {}): void {
  run(
    `INSERT INTO recordings
       (id, filename, file_path, date_recorded, meeting_id, status, location,
        transcription_status, on_device, on_local, source, is_imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hidock', 0)`,
    [
      id,
      opts.filename ?? `${id}.wav`,
      opts.file_path ?? null,
      opts.date_recorded ?? '2026-01-01T10:00:00.000Z',
      opts.meeting_id ?? null,
      opts.status ?? 'none',
      opts.location ?? 'local-only',
      opts.transcription_status ?? 'none',
      opts.on_device ?? 0,
      opts.on_local ?? 1
    ]
  )
}

function seedKnowledgeCapture(id: string, sourceRecordingId: string | null = null): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id)
     VALUES (?, ?, ?, ?)`,
    [id, `Capture ${id}`, '2026-01-01T10:00:00.000Z', sourceRecordingId]
  )
}

function seedActionable(id: string, sourceKnowledgeId: string): void {
  run(
    `INSERT INTO actionables (id, type, title, source_knowledge_id, status, created_at)
     VALUES (?, 'email', ?, ?, 'pending', ?)`,
    [id, `Actionable ${id}`, sourceKnowledgeId, '2026-01-01T10:00:00.000Z']
  )
}

function tableColumns(table: string): string[] {
  const res = getDatabase().exec(`PRAGMA table_info(${table})`)
  if (res.length === 0 || !res[0].values) return []
  return res[0].values.map((row) => String(row[1]))
}

// ---------------------------------------------------------------------------

describe('Database Service', () => {
  beforeAll(async () => {
    cleanupDbFiles(paths.db)
    await initializeDatabase()
  })

  afterAll(() => {
    try {
      closeDatabase()
    } catch {
      /* already closed */
    }
    cleanupDbFiles(paths.db)
  })

  beforeEach(() => {
    wipeData()
  })

  // =========================================================================
  // 1. initializeDatabase — real boot + schema
  // =========================================================================
  describe('initializeDatabase()', () => {
    it('initializes and reports the current schema version', () => {
      const row = queryOne<{ version: number }>(
        'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
      )
      expect(row?.version).toBe(EXPECTED_SCHEMA_VERSION)
    })

    it('creates the expected core tables', () => {
      const names = queryAll<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).map((r) => r.name)
      for (const t of ['recordings', 'transcripts', 'transcription_queue', 'meetings', 'projects', 'project_notes', 'actionables', 'knowledge_captures']) {
        expect(names).toContain(t)
      }
    })
  })

  // =========================================================================
  // 2. getRecordingById
  // =========================================================================
  describe('getRecordingById()', () => {
    it('returns a recording when it exists', () => {
      seedRecording('rec-123', { filename: 'test.wav', file_path: '/recordings/test.wav', status: 'complete' })
      const result = getRecordingById('rec-123')
      expect(result).toBeDefined()
      expect(result?.id).toBe('rec-123')
      expect(result?.filename).toBe('test.wav')
      expect(result?.status).toBe('complete')
    })

    it('returns undefined when the recording does not exist', () => {
      expect(getRecordingById('nonexistent-id')).toBeUndefined()
    })
  })

  // =========================================================================
  // 3. insertTranscript
  // =========================================================================
  describe('insertTranscript()', () => {
    it('persists all transcript fields', () => {
      seedRecording('rec-123')
      insertTranscript({
        id: 'tx-1',
        recording_id: 'rec-123',
        full_text: 'Hello world transcript text',
        language: 'en',
        summary: 'A greeting',
        action_items: '["say hi"]',
        topics: '["greetings"]',
        key_points: '["hello"]',
        sentiment: 'positive',
        speakers: '["Alice", "Bob"]',
        word_count: 4,
        transcription_provider: 'gemini',
        transcription_model: 'gemini-2.0-flash',
        title_suggestion: 'Greeting Session',
        question_suggestions: '["How are you?"]'
      })

      const row = queryOne<Record<string, unknown>>('SELECT * FROM transcripts WHERE id = ?', ['tx-1'])
      expect(row).toBeDefined()
      expect(row?.recording_id).toBe('rec-123')
      expect(row?.full_text).toBe('Hello world transcript text')
      expect(row?.language).toBe('en')
      expect(row?.summary).toBe('A greeting')
      expect(row?.word_count).toBe(4)
      expect(row?.transcription_model).toBe('gemini-2.0-flash')
    })

    it('stores null for optional fields when omitted', () => {
      seedRecording('rec-456')
      insertTranscript({
        id: 'tx-2',
        recording_id: 'rec-456',
        full_text: 'Some text',
        language: 'es'
      })

      const row = queryOne<Record<string, unknown>>('SELECT * FROM transcripts WHERE id = ?', ['tx-2'])
      expect(row?.summary).toBeNull()
      expect(row?.action_items).toBeNull()
      expect(row?.topics).toBeNull()
      expect(row?.key_points).toBeNull()
      expect(row?.sentiment).toBeNull()
      expect(row?.speakers).toBeNull()
      expect(row?.word_count).toBeNull()
      expect(row?.transcription_provider).toBeNull()
      expect(row?.transcription_model).toBeNull()
      expect(row?.title_suggestion).toBeNull()
      expect(row?.question_suggestions).toBeNull()
    })
  })

  // =========================================================================
  // 4. getQueueItems
  // =========================================================================
  describe('getQueueItems()', () => {
    it('returns all items joined to the recording filename when no status filter', () => {
      seedRecording('rec-1', { filename: 'file1.wav', date_recorded: '2026-01-02T00:00:00.000Z' })
      seedRecording('rec-2', { filename: 'file2.wav', date_recorded: '2026-01-01T00:00:00.000Z' })
      addToQueue('rec-1')
      const q2 = addToQueue('rec-2')
      updateQueueItem(q2, 'processing')

      const result = getQueueItems()
      expect(result).toHaveLength(2)
      // Recency-first: newest recording (rec-1) is first.
      expect(result[0].recording_id).toBe('rec-1')
      expect(result[0].filename).toBe('file1.wav')
      expect(result.map((r) => r.filename)).toContain('file2.wav')
    })

    it('filters by status when provided', () => {
      seedRecording('rec-1')
      seedRecording('rec-2')
      addToQueue('rec-1') // pending
      const q2 = addToQueue('rec-2')
      updateQueueItem(q2, 'processing')

      const pending = getQueueItems('pending')
      expect(pending).toHaveLength(1)
      expect(pending[0].recording_id).toBe('rec-1')
      expect(pending[0].status).toBe('pending')
    })

    it('returns an empty array when no queue items exist', () => {
      expect(getQueueItems()).toEqual([])
    })
  })

  // =========================================================================
  // 5. updateQueueItem — status transitions
  // =========================================================================
  describe('updateQueueItem()', () => {
    function queueRow(id: string) {
      return queryOne<Record<string, unknown>>('SELECT * FROM transcription_queue WHERE id = ?', [id])
    }

    it('sets started_at and increments attempts for "processing"', () => {
      seedRecording('rec-1')
      const id = addToQueue('rec-1')
      updateQueueItem(id, 'processing')
      const row = queueRow(id)
      expect(row?.status).toBe('processing')
      expect(row?.started_at).not.toBeNull()
      expect(row?.attempts).toBe(1)
    })

    it('sets completed_at and null error_message for "completed"', () => {
      seedRecording('rec-1')
      const id = addToQueue('rec-1')
      updateQueueItem(id, 'completed')
      const row = queueRow(id)
      expect(row?.status).toBe('completed')
      expect(row?.completed_at).not.toBeNull()
      expect(row?.error_message).toBeNull()
    })

    it('sets completed_at and the error_message for "failed"', () => {
      seedRecording('rec-1')
      const id = addToQueue('rec-1')
      updateQueueItem(id, 'failed', 'API rate limit exceeded')
      const row = queueRow(id)
      expect(row?.status).toBe('failed')
      expect(row?.completed_at).not.toBeNull()
      expect(row?.error_message).toBe('API rate limit exceeded')
    })

    it('only sets status for other values (e.g. "cancelled")', () => {
      seedRecording('rec-1')
      const id = addToQueue('rec-1')
      updateQueueItem(id, 'cancelled')
      const row = queueRow(id)
      expect(row?.status).toBe('cancelled')
      expect(row?.started_at).toBeNull()
      expect(row?.completed_at).toBeNull()
    })
  })

  // =========================================================================
  // 6. updateRecordingTranscriptionStatus
  // =========================================================================
  describe('updateRecordingTranscriptionStatus()', () => {
    it('updates the transcription_status column for a recording', () => {
      seedRecording('rec-123', { transcription_status: 'none' })
      updateRecordingTranscriptionStatus('rec-123', 'processing')
      expect(getRecordingById('rec-123')?.transcription_status).toBe('processing')
    })
  })

  // =========================================================================
  // 7. cancelPendingTranscriptions
  // =========================================================================
  describe('cancelPendingTranscriptions()', () => {
    it('deletes pending items, cancels processing items, and resets recording statuses', () => {
      seedRecording('rec-1', { transcription_status: 'pending' })
      seedRecording('rec-2', { transcription_status: 'processing' })
      addToQueue('rec-1') // pending
      const q2 = addToQueue('rec-2')
      updateQueueItem(q2, 'processing')

      const result = cancelPendingTranscriptions()
      expect(result).toBe(2)

      // Pending queue row deleted; processing row moved to cancelled.
      expect(getQueueItems('pending')).toHaveLength(0)
      const q2row = queryOne<{ status: string }>('SELECT status FROM transcription_queue WHERE id = ?', [q2])
      expect(q2row?.status).toBe('cancelled')

      // Both recordings reset to 'none'.
      expect(getRecordingById('rec-1')?.transcription_status).toBe('none')
      expect(getRecordingById('rec-2')?.transcription_status).toBe('none')
    })

    it('returns 0 when there are no pending or processing items', () => {
      expect(cancelPendingTranscriptions()).toBe(0)
    })
  })

  // =========================================================================
  // 8. removeFromQueueByRecordingId
  // =========================================================================
  describe('removeFromQueueByRecordingId()', () => {
    it('deletes the queue row for the given recording', () => {
      seedRecording('rec-789')
      addToQueue('rec-789')
      expect(getQueueItems()).toHaveLength(1)

      removeFromQueueByRecordingId('rec-789')
      expect(getQueueItems()).toHaveLength(0)
    })
  })

  // =========================================================================
  // 9. resetStuckTranscriptions
  // =========================================================================
  describe('resetStuckTranscriptions()', () => {
    it('resets stuck recordings and queue items, returning the real counts', () => {
      seedRecording('rec-1', { transcription_status: 'processing' })
      seedRecording('rec-2', { transcription_status: 'pending' })
      const q1 = addToQueue('rec-1')
      updateQueueItem(q1, 'processing')

      const result = resetStuckTranscriptions()
      expect(result).toEqual({ recordingsReset: 2, queueItemsReset: 1 })

      expect(getRecordingById('rec-1')?.transcription_status).toBe('none')
      expect(getRecordingById('rec-2')?.transcription_status).toBe('none')
      const q1row = queryOne<{ status: string }>('SELECT status FROM transcription_queue WHERE id = ?', [q1])
      expect(q1row?.status).toBe('pending')
    })

    it('returns zeros when nothing is stuck', () => {
      expect(resetStuckTranscriptions()).toEqual({ recordingsReset: 0, queueItemsReset: 0 })
    })
  })

  // =========================================================================
  // 10. Schema shape (columns/tables that past migrations introduced)
  // =========================================================================
  describe('Schema shape', () => {
    it('actionables has the confidence column (v17)', () => {
      expect(tableColumns('actionables')).toContain('confidence')
    })

    it('chat_messages has the v18 columns', () => {
      const cols = tableColumns('chat_messages')
      for (const c of ['edited_at', 'original_content', 'created_output_id', 'saved_as_insight_id']) {
        expect(cols).toContain(c)
      }
    })

    it('projects has folder_path/url and project_notes exists (v29)', () => {
      const cols = tableColumns('projects')
      expect(cols).toContain('folder_path')
      expect(cols).toContain('url')
      expect(tableColumns('project_notes').length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // 11. Project notes + project actionables (v29)
  // =========================================================================
  describe('Project notes & actionables (v29)', () => {
    it('addProjectNote inserts and returns the created row', () => {
      seedProject('p1')
      const result = addProjectNote('p1', 'issue', 'Broken login')
      expect(result.project_id).toBe('p1')
      expect(result.kind).toBe('issue')
      expect(result.content).toBe('Broken login')
      expect(result.status).toBe('open')

      const persisted = queryOne<{ content: string }>('SELECT content FROM project_notes WHERE id = ?', [result.id])
      expect(persisted?.content).toBe('Broken login')
    })

    it('getProjectNotes filters by kind when provided', () => {
      seedProject('p1')
      addProjectNote('p1', 'risk', 'A')
      addProjectNote('p1', 'issue', 'B')
      const risks = getProjectNotes('p1', 'risk')
      expect(risks).toHaveLength(1)
      expect(risks[0].content).toBe('A')
    })

    it('getProjectNotes returns all kinds when kind is omitted', () => {
      seedProject('p1')
      addProjectNote('p1', 'risk', 'A')
      addProjectNote('p1', 'note', 'B')
      expect(getProjectNotes('p1')).toHaveLength(2)
    })

    it('updateProjectNote stamps resolved_at when resolving', () => {
      seedProject('p1')
      const note = addProjectNote('p1', 'issue', 'A')
      const result = updateProjectNote(note.id, { status: 'resolved' })
      expect(result.status).toBe('resolved')
      expect(result.resolved_at).not.toBeNull()
    })

    it('updateProjectNote throws when the note does not exist', () => {
      expect(() => updateProjectNote('missing', { content: 'x' })).toThrow(/not found/)
    })

    it('deleteProjectNote removes the row', () => {
      seedProject('p1')
      const note = addProjectNote('p1', 'issue', 'A')
      deleteProjectNote(note.id)
      expect(queryOne('SELECT id FROM project_notes WHERE id = ?', [note.id])).toBeUndefined()
    })

    it('getActionablesForProject unions the meeting-path and direct-knowledge-path actionables', () => {
      seedProject('p1')

      // Meeting path: project → meeting → recording → knowledge_capture → actionable
      seedMeeting('m1')
      run('INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', ['m1', 'p1'])
      seedRecording('r1', { meeting_id: 'm1' })
      seedKnowledgeCapture('k1', 'r1')
      seedActionable('a1', 'k1')

      // Direct path: knowledge_projects → actionable
      seedKnowledgeCapture('k2', null)
      run('INSERT INTO knowledge_projects (knowledge_capture_id, project_id) VALUES (?, ?)', ['k2', 'p1'])
      seedActionable('a2', 'k2')

      const result = getActionablesForProject('p1')
      const ids = result.map((r) => r.id)
      expect(ids).toContain('a1')
      expect(ids).toContain('a2')
      expect(result).toHaveLength(2)
    })
  })

  // =========================================================================
  // 12. Recording lifecycle: insert / status / download / resolve
  // =========================================================================
  describe('insertRecording()', () => {
    it('persists the lifecycle columns rather than the device-oriented DDL defaults', () => {
      insertRecording({
        id: 'rec-1',
        filename: 'file.wav',
        original_filename: 'file.wav',
        file_path: '/recordings/file.wav',
        file_size: 100,
        duration_seconds: undefined,
        date_recorded: '2026-07-07T19:31:44',
        meeting_id: undefined,
        correlation_confidence: undefined,
        correlation_method: undefined,
        status: 'none',
        location: 'local-only',
        on_device: 0,
        on_local: 1,
        transcription_status: 'none',
        source: 'hidock',
        is_imported: 0
      } as never)

      const row = getRecordingById('rec-1')
      expect(row?.location).toBe('local-only')
      expect(row?.on_local).toBe(1)
      expect(row?.on_device).toBe(0)
      expect(row?.file_path).toBe('/recordings/file.wav')
    })
  })

  describe('updateRecordingStatus()', () => {
    it('updates the legacy status column', () => {
      seedRecording('rec-100', { status: 'none' })
      updateRecordingStatus('rec-100', 'complete')
      expect(getRecordingById('rec-100')?.status).toBe('complete')
    })
  })

  describe('markRecordingDownloaded()', () => {
    it('updates an existing device row found under a different extension (.hda vs .wav)', () => {
      seedRecording('rec-dev', {
        filename: '2026Jul07-193144-Rec43.hda',
        on_device: 1,
        on_local: 0,
        location: 'device-only'
      })

      const id = markRecordingDownloaded(
        '2026Jul07-193144-Rec43.hda',
        'F:\\Audios\\2026Jul07-193144-Rec43.wav'
      )

      expect(id).toBe('rec-dev')
      const row = getRecordingById('rec-dev')
      expect(row?.on_local).toBe(1)
      expect(row?.location).toBe('both')
      expect(row?.file_path).toBe('F:\\Audios\\2026Jul07-193144-Rec43.wav')
    })

    it('creates a properly-flagged row when no recording exists yet', () => {
      const id = markRecordingDownloaded(
        '2026Jul07-193144-Rec43.hda',
        'F:\\Audios\\2026Jul07-193144-Rec43.wav',
        { fileSize: 123, dateRecorded: '2026-07-07T19:31:44.000Z' }
      )

      expect(id).toBeTruthy()
      const row = getRecordingById(id)
      expect(row?.filename).toBe('2026Jul07-193144-Rec43.wav') // local basename canonical
      expect(row?.original_filename).toBe('2026Jul07-193144-Rec43.hda') // device name preserved
      expect(row?.location).toBe('both')
      expect(row?.on_local).toBe(1)
      expect(row?.on_device).toBe(1)
      expect(row?.file_size).toBe(123)
    })
  })

  describe('resolveRecordingId()', () => {
    it('returns the recording directly when the id exists', () => {
      seedRecording('rec-1', { filename: 'a.wav' })
      expect(resolveRecordingId('rec-1')?.id).toBe('rec-1')
    })

    it('resolves a synced_files id to the recording via local filename', () => {
      seedRecording('rec-real', { filename: '2026Jul07-193144-Rec43.wav' })
      run(
        `INSERT INTO synced_files (id, original_filename, local_filename, file_path)
         VALUES (?, ?, ?, ?)`,
        [
          'synced-id',
          '2026Jul07-193144-Rec43.hda',
          '2026Jul07-193144-Rec43.wav',
          'F:\\Audios\\2026Jul07-193144-Rec43.wav'
        ]
      )
      expect(resolveRecordingId('synced-id')?.id).toBe('rec-real')
    })

    it('returns undefined for unknown ids', () => {
      expect(resolveRecordingId('ghost')).toBeUndefined()
    })
  })

  // =========================================================================
  // 13. Persistence helpers (WAL — no export/flush model)
  // =========================================================================
  describe('run() / saveDatabase()', () => {
    it('run() executes immediately and the row is queryable', () => {
      run('INSERT INTO recordings (id, filename, date_recorded, status, location, on_device, on_local, source, is_imported) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        'run-1',
        'run.wav',
        '2026-01-01T00:00:00.000Z',
        'none',
        'local-only',
        0,
        1,
        'hidock',
        0
      ])
      expect(getRecordingById('run-1')?.filename).toBe('run.wav')
    })

    it('saveDatabase() checkpoints without throwing and data survives', () => {
      seedRecording('save-1')
      expect(() => saveDatabase()).not.toThrow()
      expect(getRecordingById('save-1')).toBeDefined()
    })
  })

  // =========================================================================
  // 14. queryAll helper
  // =========================================================================
  describe('queryAll()', () => {
    it('returns multiple rows', () => {
      seedRecording('r1', { filename: 'a.wav' })
      seedRecording('r2', { filename: 'b.wav' })
      seedRecording('r3', { filename: 'c.wav' })
      const rows = queryAll<{ id: string; filename: string }>(
        'SELECT id, filename FROM recordings ORDER BY filename',
        []
      )
      expect(rows).toHaveLength(3)
      expect(rows[0].filename).toBe('a.wav')
      expect(rows[2].filename).toBe('c.wav')
    })
  })
})

// ---------------------------------------------------------------------------
// Lifecycle in an isolated module (uninitialized-access + close/reopen), so it
// never disturbs the shared connection above.
// ---------------------------------------------------------------------------

describe('Database lifecycle (isolated module)', () => {
  const isoPath = join(tmpdir(), `hidock-dbtest-iso-${process.pid}-${Date.now()}.db`)

  afterAll(() => {
    for (const suffix of ['', '-wal', '-shm', '.tmp']) {
      if (existsSync(`${isoPath}${suffix}`)) rmSync(`${isoPath}${suffix}`, { force: true })
    }
  })

  it('getDatabase() throws before initialize()', async () => {
    paths.db = isoPath
    vi.resetModules()
    const mod = await import('../database')
    expect(() => mod.getDatabase()).toThrow('Database not initialized')
  })

  it('closeDatabase() persists writes so a reopen sees them', async () => {
    paths.db = isoPath
    vi.resetModules()
    const modA = await import('../database')
    await modA.initializeDatabase()
    modA.run(
      "INSERT INTO recordings (id, filename, date_recorded, status, location, on_device, on_local, source, is_imported) VALUES ('iso-1', 'iso.wav', '2026-01-01T00:00:00.000Z', 'none', 'local-only', 0, 1, 'hidock', 0)"
    )
    modA.closeDatabase()

    vi.resetModules()
    const modB = await import('../database')
    await modB.initializeDatabase()
    expect(modB.getRecordingById('iso-1')?.filename).toBe('iso.wav')
    modB.closeDatabase()
  })
})
