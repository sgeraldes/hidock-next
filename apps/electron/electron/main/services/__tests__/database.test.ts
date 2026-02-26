/**
 * Database Service Tests
 *
 * Tests for the critical backend database service (sql.js / SQLite in-memory).
 * Covers: initialization, recording queries, transcription queue management,
 * transcript insertion, status transitions, and schema migrations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock helpers: sql.js Database object
// ---------------------------------------------------------------------------

let mockStmtRows: Record<string, unknown>[] = []
let mockStmtRowIndex = 0

const mockStmt = {
  bind: vi.fn(),
  step: vi.fn(() => {
    if (mockStmtRowIndex < mockStmtRows.length) {
      mockStmtRowIndex++
      return true
    }
    return false
  }),
  getAsObject: vi.fn(() => {
    return mockStmtRows[mockStmtRowIndex - 1] ?? {}
  }),
  free: vi.fn(),
  reset: vi.fn()
}

let mockRowsModified = 0

const mockDatabase = {
  run: vi.fn(),
  exec: vi.fn(() => [] as any[]),
  prepare: vi.fn(() => mockStmt),
  getRowsModified: vi.fn(() => mockRowsModified),
  export: vi.fn(() => new Uint8Array([1, 2, 3])),
  close: vi.fn()
}

// sql.js constructor — `new SQL.Database(buffer?)` returns mockDatabase
// Use a real class that vi.fn() wraps, so it passes vitest's constructor check
// AND supports mockImplementation in tests
const RealMockSQLDatabase = vi.fn()
RealMockSQLDatabase.prototype = mockDatabase

vi.mock('sql.js', () => ({
  default: vi.fn(async () => ({
    Database: RealMockSQLDatabase
  }))
}))

// Alias for test code that references MockSQLDatabase
const MockSQLDatabase = RealMockSQLDatabase

vi.mock('fs', () => {
  const fsMock = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => Buffer.from('fake')),
    writeFileSync: vi.fn()
  }
  return {
    ...fsMock,
    default: fsMock
  }
})

vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => '/tmp/test-hidock.db')
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set up mockStmt to return rows for queryAll/queryOne calls. */
function setQueryResults(rows: Record<string, unknown>[]) {
  mockStmtRows = rows
  mockStmtRowIndex = 0
  // Reset the step mock to iterate properly each time
  mockStmt.step.mockImplementation(() => {
    if (mockStmtRowIndex < mockStmtRows.length) {
      mockStmtRowIndex++
      return true
    }
    return false
  })
  mockStmt.getAsObject.mockImplementation(() => {
    return mockStmtRows[mockStmtRowIndex - 1] ?? {}
  })
}

// Common PRAGMA table_info return value with all expected columns
const FULL_COLUMNS_PRAGMA = [{ values: [
  [0, 'id', 'TEXT', 0, null, 1],
  [1, 'migrated_to_capture_id', 'TEXT', 0, null, 0],
  [2, 'migration_status', 'TEXT', 0, null, 0],
  [3, 'migrated_at', 'TEXT', 0, null, 0],
  [4, 'category', 'TEXT', 0, null, 0],
  [5, 'status', 'TEXT', 0, null, 0],
  [6, 'quality_rating', 'TEXT', 0, null, 0],
  [7, 'quality_confidence', 'REAL', 0, null, 0],
  [8, 'quality_assessed_at', 'TEXT', 0, null, 0],
  [9, 'storage_tier', 'TEXT', 0, null, 0],
  [10, 'retention_days', 'INTEGER', 0, null, 0],
  [11, 'expires_at', 'TEXT', 0, null, 0],
  [12, 'meeting_id', 'TEXT', 0, null, 0],
  [13, 'correlation_confidence', 'REAL', 0, null, 0],
  [14, 'correlation_method', 'TEXT', 0, null, 0],
  [15, 'source_recording_id', 'TEXT', 0, null, 0],
  [16, 'edited_at', 'TEXT', 0, null, 0],
  [17, 'original_content', 'TEXT', 0, null, 0],
  [18, 'created_output_id', 'TEXT', 0, null, 0],
  [19, 'saved_as_insight_id', 'TEXT', 0, null, 0],
] }]

/** Standard exec mock: all columns present, at schema version 18. */
function setupStandardExecMock(schemaVersion = 18) {
  mockDatabase.exec.mockImplementation((sql: string) => {
    if (sql.includes('PRAGMA table_info')) {
      return FULL_COLUMNS_PRAGMA
    }
    if (sql.includes('schema_version')) {
      return schemaVersion > 0 ? [{ values: [[schemaVersion]] }] : []
    }
    return []
  })
}

/** Initialize the database module with standard mocks. */
async function initTestDatabase(schemaVersion = 18) {
  const fs = await import('fs')
  ;(fs.existsSync as any).mockReturnValue(false)
  setupStandardExecMock(schemaVersion)
  const dbModule = await import('../database')
  await dbModule.initializeDatabase()
  return dbModule
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Database Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStmtRows = []
    mockStmtRowIndex = 0
    mockRowsModified = 0

    // Re-establish default implementations after clearAllMocks
    mockDatabase.prepare.mockImplementation(() => mockStmt)
    mockDatabase.exec.mockImplementation(() => [] as any[])
    mockDatabase.getRowsModified.mockImplementation(() => mockRowsModified)
    mockDatabase.export.mockImplementation(() => new Uint8Array([1, 2, 3]))
    mockStmt.step.mockImplementation(() => {
      if (mockStmtRowIndex < mockStmtRows.length) {
        mockStmtRowIndex++
        return true
      }
      return false
    })
    mockStmt.getAsObject.mockImplementation(() => {
      return mockStmtRows[mockStmtRowIndex - 1] ?? {}
    })
  })

  // =========================================================================
  // 1. initializeDatabase
  // =========================================================================
  describe('initializeDatabase()', () => {
    it('should create a new database when no file exists on disk', async () => {
      const dbModule = await initTestDatabase()

      // Should call new Database() (fresh db, no buffer arg)
      expect(MockSQLDatabase).toHaveBeenCalled()

      // Should have run multiple SQL statements (CREATE TABLE, indexes, etc.)
      expect(mockDatabase.run).toHaveBeenCalled()

      // Should save the database after initialization
      const fsModule = await import('fs')
      expect(fsModule.writeFileSync).toHaveBeenCalled()
    })

    it('should load existing database from disk when file exists', async () => {
      const fs = await import('fs')
      ;(fs.existsSync as any).mockReturnValue(true)
      ;(fs.readFileSync as any).mockReturnValue(Buffer.from([0, 1, 2]))
      setupStandardExecMock(18)

      const dbModule = await import('../database')
      await dbModule.initializeDatabase()

      // Should call new Database(buffer)
      expect(MockSQLDatabase).toHaveBeenCalledWith(expect.anything())
      expect(fs.readFileSync).toHaveBeenCalled()
    })

    it('should run migrations when current version < SCHEMA_VERSION', async () => {
      await initTestDatabase(17)

      // The migration runner inserts version records via run()
      const runCalls = mockDatabase.run.mock.calls.map((c: any[]) => c[0] as string)
      const migrationInserts = runCalls.filter(
        (sql: string) => typeof sql === 'string' && sql.includes('INSERT OR REPLACE INTO schema_version')
      )
      expect(migrationInserts.length).toBeGreaterThanOrEqual(1)
    })

    it('should throw on fatal initialization error', async () => {
      const initSqlJs = (await import('sql.js')).default
      ;(initSqlJs as any).mockRejectedValueOnce(new Error('WASM load failed'))

      const dbModule = await import('../database')
      await expect(dbModule.initializeDatabase()).rejects.toThrow('WASM load failed')
    })
  })

  // =========================================================================
  // 2. getDatabase / getRecordingById
  // =========================================================================
  describe('getDatabase()', () => {
    it('should throw if database is not initialized', async () => {
      // Reset module to get a fresh state where db = null
      vi.resetModules()

      vi.doMock('sql.js', () => ({
        default: vi.fn(async () => ({
          Database: MockSQLDatabase
        }))
      }))
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => Buffer.from('fake')),
        writeFileSync: vi.fn()
      }))
      vi.doMock('../file-storage', () => ({
        getDatabasePath: vi.fn(() => '/tmp/test-hidock.db')
      }))

      const dbModule = await import('../database')
      expect(() => dbModule.getDatabase()).toThrow('Database not initialized')
    })
  })

  describe('getRecordingById()', () => {
    it('should return a recording when it exists', async () => {
      const dbModule = await initTestDatabase()

      const mockRecording = {
        id: 'rec-123',
        filename: 'test.hda',
        file_path: '/recordings/test.hda',
        status: 'complete',
        location: 'local-only',
        transcription_status: 'none',
        on_device: 0,
        on_local: 1,
        date_recorded: '2026-01-01',
        source: 'hidock',
        is_imported: 0,
        created_at: '2026-01-01T00:00:00Z'
      }
      setQueryResults([mockRecording])

      const result = dbModule.getRecordingById('rec-123')

      expect(result).toEqual(mockRecording)
      expect(mockStmt.bind).toHaveBeenCalledWith(['rec-123'])
      expect(mockStmt.free).toHaveBeenCalled()
    })

    it('should return undefined when recording does not exist', async () => {
      const dbModule = await initTestDatabase()

      setQueryResults([])

      const result = dbModule.getRecordingById('nonexistent-id')
      expect(result).toBeUndefined()
    })
  })

  // =========================================================================
  // 3. insertTranscript
  // =========================================================================
  describe('insertTranscript()', () => {
    it('should execute INSERT OR REPLACE with all transcript fields', async () => {
      const dbModule = await initTestDatabase()
      mockDatabase.run.mockClear()

      const transcript = {
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
      }

      dbModule.insertTranscript(transcript)

      const runCalls = mockDatabase.run.mock.calls
      const insertCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT OR REPLACE INTO transcripts')
      )

      expect(insertCall).toBeDefined()
      const params = insertCall![1] as any[]
      expect(params[0]).toBe('tx-1')
      expect(params[1]).toBe('rec-123')
      expect(params[2]).toBe('Hello world transcript text')
      expect(params[3]).toBe('en')
      expect(params[4]).toBe('A greeting')
    })

    it('should pass null for optional fields when undefined', async () => {
      const dbModule = await initTestDatabase()
      mockDatabase.run.mockClear()

      const minimalTranscript = {
        id: 'tx-2',
        recording_id: 'rec-456',
        full_text: 'Some text',
        language: 'es'
      }

      dbModule.insertTranscript(minimalTranscript)

      const runCalls = mockDatabase.run.mock.calls
      const insertCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT OR REPLACE INTO transcripts')
      )
      expect(insertCall).toBeDefined()

      const params = insertCall![1] as any[]
      // Optional fields should be null (indices 4-14)
      expect(params[4]).toBeNull()  // summary
      expect(params[5]).toBeNull()  // action_items
      expect(params[6]).toBeNull()  // topics
      expect(params[7]).toBeNull()  // key_points
      expect(params[8]).toBeNull()  // sentiment
      expect(params[9]).toBeNull()  // speakers
      expect(params[10]).toBeNull() // word_count
      expect(params[11]).toBeNull() // transcription_provider
      expect(params[12]).toBeNull() // transcription_model
      expect(params[13]).toBeNull() // title_suggestion
      expect(params[14]).toBeNull() // question_suggestions
    })
  })

  // =========================================================================
  // 4. getQueueItems
  // =========================================================================
  describe('getQueueItems()', () => {
    it('should return all queue items with recording filename when no status filter', async () => {
      const dbModule = await initTestDatabase()

      const mockQueueItems = [
        { id: 'q-1', recording_id: 'rec-1', status: 'pending', attempts: 0, filename: 'file1.hda', created_at: '2026-01-01' },
        { id: 'q-2', recording_id: 'rec-2', status: 'processing', attempts: 1, filename: 'file2.hda', created_at: '2026-01-02' }
      ]
      setQueryResults(mockQueueItems)

      const result = dbModule.getQueueItems()

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('q-1')
      expect(result[0].filename).toBe('file1.hda')
      expect(result[1].status).toBe('processing')

      // SQL should contain the LEFT JOIN but no WHERE clause
      const prepareCalls = mockDatabase.prepare.mock.calls
      const lastPrepareSQL = prepareCalls[prepareCalls.length - 1][0] as string
      expect(lastPrepareSQL).toContain('LEFT JOIN recordings')
      expect(lastPrepareSQL).not.toContain('WHERE tq.status')
    })

    it('should filter by status when provided', async () => {
      const dbModule = await initTestDatabase()

      setQueryResults([
        { id: 'q-1', recording_id: 'rec-1', status: 'pending', attempts: 0, filename: 'file1.hda', created_at: '2026-01-01' }
      ])

      const result = dbModule.getQueueItems('pending')

      expect(result).toHaveLength(1)

      // SQL should include WHERE clause with status filter
      const prepareCalls = mockDatabase.prepare.mock.calls
      const lastPrepareSQL = prepareCalls[prepareCalls.length - 1][0] as string
      expect(lastPrepareSQL).toContain('WHERE tq.status')

      // Should bind with the status parameter
      expect(mockStmt.bind).toHaveBeenCalledWith(['pending'])
    })

    it('should return empty array when no queue items exist', async () => {
      const dbModule = await initTestDatabase()

      setQueryResults([])

      const result = dbModule.getQueueItems()
      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // 5. updateQueueItem - status transitions
  // =========================================================================
  describe('updateQueueItem()', () => {
    let dbModule: Awaited<ReturnType<typeof initTestDatabase>>

    beforeEach(async () => {
      dbModule = await initTestDatabase()
      mockDatabase.run.mockClear()
    })

    it('should set started_at and increment attempts for "processing" status', () => {
      dbModule.updateQueueItem('q-1', 'processing')

      const runCalls = mockDatabase.run.mock.calls
      const updateCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('transcription_queue')
      )
      expect(updateCall).toBeDefined()
      const sql = updateCall![0] as string
      expect(sql).toContain('started_at = CURRENT_TIMESTAMP')
      expect(sql).toContain('attempts = attempts + 1')
      expect(updateCall![1]).toEqual(['processing', 'q-1'])
    })

    it('should set completed_at and error_message for "completed" status', () => {
      dbModule.updateQueueItem('q-2', 'completed')

      const runCalls = mockDatabase.run.mock.calls
      const updateCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('transcription_queue')
      )
      expect(updateCall).toBeDefined()
      const sql = updateCall![0] as string
      expect(sql).toContain('completed_at = CURRENT_TIMESTAMP')
      expect(sql).toContain('error_message = ?')
      expect(updateCall![1]).toEqual(['completed', null, 'q-2'])
    })

    it('should set completed_at and error_message for "failed" status', () => {
      dbModule.updateQueueItem('q-3', 'failed', 'API rate limit exceeded')

      const runCalls = mockDatabase.run.mock.calls
      const updateCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('transcription_queue')
      )
      expect(updateCall).toBeDefined()
      const sql = updateCall![0] as string
      expect(sql).toContain('completed_at = CURRENT_TIMESTAMP')
      expect(sql).toContain('error_message = ?')
      expect(updateCall![1]).toEqual(['failed', 'API rate limit exceeded', 'q-3'])
    })

    it('should only set status for other status values (e.g., "cancelled")', () => {
      dbModule.updateQueueItem('q-4', 'cancelled')

      const runCalls = mockDatabase.run.mock.calls
      const updateCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('transcription_queue')
      )
      expect(updateCall).toBeDefined()
      const sql = updateCall![0] as string
      expect(sql).toContain('SET status = ?')
      expect(sql).not.toContain('started_at')
      expect(sql).not.toContain('completed_at')
      expect(updateCall![1]).toEqual(['cancelled', 'q-4'])
    })
  })

  // =========================================================================
  // 6. updateRecordingTranscriptionStatus
  // =========================================================================
  describe('updateRecordingTranscriptionStatus()', () => {
    it('should update the transcription_status column for a recording', async () => {
      const dbModule = await initTestDatabase()
      mockDatabase.run.mockClear()

      dbModule.updateRecordingTranscriptionStatus('rec-123', 'processing')

      const runCalls = mockDatabase.run.mock.calls
      const updateCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('transcription_status')
      )
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toContain('UPDATE recordings SET transcription_status = ?')
      expect(updateCall![1]).toEqual(['processing', 'rec-123'])
    })
  })

  // =========================================================================
  // 7. cancelPendingTranscriptions
  // =========================================================================
  describe('cancelPendingTranscriptions()', () => {
    it('should delete pending items, cancel processing items, and reset recording statuses', async () => {
      const dbModule = await initTestDatabase()
      mockDatabase.run.mockClear()

      // cancelPendingTranscriptions internally calls getQueueItems('pending')
      // then getQueueItems('processing'), which use prepare/step/getAsObject.
      let queryCallCount = 0
      const pendingItems = [
        { id: 'q-1', recording_id: 'rec-1', status: 'pending', attempts: 0, filename: 'file1.hda', created_at: '2026-01-01' }
      ]
      const processingItems = [
        { id: 'q-2', recording_id: 'rec-2', status: 'processing', attempts: 1, filename: 'file2.hda', created_at: '2026-01-02' }
      ]

      mockDatabase.prepare.mockImplementation(() => {
        queryCallCount++
        const items = queryCallCount === 1 ? pendingItems : processingItems
        let idx = 0
        return {
          bind: vi.fn(),
          step: vi.fn(() => {
            if (idx < items.length) { idx++; return true }
            return false
          }),
          getAsObject: vi.fn(() => items[idx - 1] ?? {}),
          free: vi.fn(),
          reset: vi.fn()
        }
      })

      const result = dbModule.cancelPendingTranscriptions()

      // Should return total count of pending + processing
      expect(result).toBe(2)

      // Should DELETE pending items
      const runCalls = mockDatabase.run.mock.calls
      const deleteCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes("DELETE FROM transcription_queue WHERE status = 'pending'")
      )
      expect(deleteCall).toBeDefined()

      // Should UPDATE processing items to cancelled
      const cancelCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes("UPDATE transcription_queue SET status = 'cancelled'")
      )
      expect(cancelCall).toBeDefined()

      // Should reset transcription_status to 'none' for affected recordings
      const statusResetCalls = runCalls.filter(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes('UPDATE recordings SET transcription_status')
      )
      expect(statusResetCalls.length).toBe(2)
      expect(statusResetCalls[0][1]).toEqual(['none', 'rec-1'])
      expect(statusResetCalls[1][1]).toEqual(['none', 'rec-2'])
    })

    it('should return 0 when no pending or processing items exist', async () => {
      const dbModule = await initTestDatabase()

      mockDatabase.prepare.mockImplementation(() => ({
        bind: vi.fn(),
        step: vi.fn(() => false),
        getAsObject: vi.fn(() => ({})),
        free: vi.fn(),
        reset: vi.fn()
      }))

      const result = dbModule.cancelPendingTranscriptions()
      expect(result).toBe(0)
    })
  })

  // =========================================================================
  // 8. removeFromQueueByRecordingId
  // =========================================================================
  describe('removeFromQueueByRecordingId()', () => {
    it('should execute DELETE with the correct recording_id', async () => {
      const dbModule = await initTestDatabase()
      mockDatabase.run.mockClear()

      dbModule.removeFromQueueByRecordingId('rec-789')

      const deleteCall = mockDatabase.run.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes('DELETE FROM transcription_queue WHERE recording_id')
      )
      expect(deleteCall).toBeDefined()
      expect(deleteCall![1]).toEqual(['rec-789'])
    })
  })

  // =========================================================================
  // 9. resetStuckTranscriptions
  // =========================================================================
  describe('resetStuckTranscriptions()', () => {
    it('should reset stuck recordings and queue items, returning actual counts', async () => {
      const dbModule = await initTestDatabase()
      mockDatabase.run.mockClear()

      // First call to getRowsModified (after recordings update) returns 3
      // Second call (after queue update) returns 2
      let getRowsModifiedCallCount = 0
      mockDatabase.getRowsModified.mockImplementation(() => {
        getRowsModifiedCallCount++
        return getRowsModifiedCallCount === 1 ? 3 : 2
      })

      const result = dbModule.resetStuckTranscriptions()

      expect(result).toEqual({ recordingsReset: 3, queueItemsReset: 2 })

      // Should update recordings with status = 'transcribing' to 'pending'
      const runCalls = mockDatabase.run.mock.calls
      const recordingsUpdate = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes("UPDATE recordings SET status = 'pending' WHERE status = 'transcribing'")
      )
      expect(recordingsUpdate).toBeDefined()

      // Should update queue items with status = 'processing' to 'pending'
      const queueUpdate = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes("UPDATE transcription_queue SET status = 'pending' WHERE status = 'processing'")
      )
      expect(queueUpdate).toBeDefined()
    })

    it('should return zeros when nothing is stuck', async () => {
      const dbModule = await initTestDatabase()

      mockDatabase.getRowsModified.mockReturnValue(0)

      const result = dbModule.resetStuckTranscriptions()
      expect(result).toEqual({ recordingsReset: 0, queueItemsReset: 0 })
    })
  })

  // =========================================================================
  // 10. Schema migrations
  // =========================================================================
  describe('Schema Migrations', () => {
    it('migration v17 should add confidence column to actionables if missing', async () => {
      const fs = await import('fs')
      ;(fs.existsSync as any).mockReturnValue(false)

      mockDatabase.exec.mockImplementation((sql: string) => {
        if (sql.includes('PRAGMA table_info(actionables)')) {
          // actionables WITHOUT confidence column
          return [{ values: [
            [0, 'id', 'TEXT', 0, null, 1],
            [1, 'type', 'TEXT', 0, null, 0],
            [2, 'title', 'TEXT', 0, null, 0],
            [3, 'status', 'TEXT', 0, null, 0]
          ] }]
        }
        if (sql.includes('PRAGMA table_info(chat_messages)')) {
          return [{ values: [
            [0, 'id', 'TEXT', 0, null, 1],
            [1, 'content', 'TEXT', 0, null, 0],
            [2, 'role', 'TEXT', 0, null, 0],
            [3, 'edited_at', 'TEXT', 0, null, 0],
            [4, 'original_content', 'TEXT', 0, null, 0],
            [5, 'created_output_id', 'TEXT', 0, null, 0],
            [6, 'saved_as_insight_id', 'TEXT', 0, null, 0],
          ] }]
        }
        if (sql.includes('PRAGMA table_info')) {
          return FULL_COLUMNS_PRAGMA
        }
        if (sql.includes('schema_version')) {
          return [{ values: [[16]] }]
        }
        return []
      })

      const dbModule = await import('../database')
      await dbModule.initializeDatabase()

      const runCalls = mockDatabase.run.mock.calls
      const alterCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes('ALTER TABLE actionables ADD COLUMN confidence')
      )
      expect(alterCall).toBeDefined()
    })

    it('migration v17 should skip confidence column if it already exists', async () => {
      const fs = await import('fs')
      ;(fs.existsSync as any).mockReturnValue(false)

      mockDatabase.exec.mockImplementation((sql: string) => {
        if (sql.includes('PRAGMA table_info(actionables)')) {
          // actionables WITH confidence column already present
          return [{ values: [
            [0, 'id', 'TEXT', 0, null, 1],
            [1, 'type', 'TEXT', 0, null, 0],
            [2, 'title', 'TEXT', 0, null, 0],
            [3, 'status', 'TEXT', 0, null, 0],
            [4, 'confidence', 'REAL', 0, null, 0]
          ] }]
        }
        if (sql.includes('PRAGMA table_info(chat_messages)')) {
          return [{ values: [
            [0, 'id', 'TEXT', 0, null, 1],
            [1, 'content', 'TEXT', 0, null, 0],
            [2, 'role', 'TEXT', 0, null, 0],
            [3, 'edited_at', 'TEXT', 0, null, 0],
            [4, 'original_content', 'TEXT', 0, null, 0],
            [5, 'created_output_id', 'TEXT', 0, null, 0],
            [6, 'saved_as_insight_id', 'TEXT', 0, null, 0],
          ] }]
        }
        if (sql.includes('PRAGMA table_info')) {
          return FULL_COLUMNS_PRAGMA
        }
        if (sql.includes('schema_version')) {
          return [{ values: [[16]] }]
        }
        return []
      })

      const dbModule = await import('../database')
      await dbModule.initializeDatabase()

      const runCalls = mockDatabase.run.mock.calls
      const alterCall = runCalls.find(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes('ALTER TABLE actionables ADD COLUMN confidence')
      )
      expect(alterCall).toBeUndefined()
    })

    it('migration v18 should add missing chat_messages columns', async () => {
      const fs = await import('fs')
      ;(fs.existsSync as any).mockReturnValue(false)

      mockDatabase.exec.mockImplementation((sql: string) => {
        if (sql.includes('PRAGMA table_info(actionables)')) {
          return [{ values: [
            [0, 'id', 'TEXT', 0, null, 1],
            [1, 'confidence', 'REAL', 0, null, 0]
          ] }]
        }
        if (sql.includes('PRAGMA table_info(chat_messages)')) {
          // chat_messages WITHOUT the v18 columns
          return [{ values: [
            [0, 'id', 'TEXT', 0, null, 1],
            [1, 'content', 'TEXT', 0, null, 0],
            [2, 'role', 'TEXT', 0, null, 0]
          ] }]
        }
        if (sql.includes('PRAGMA table_info')) {
          return FULL_COLUMNS_PRAGMA
        }
        if (sql.includes('schema_version')) {
          return [{ values: [[17]] }]
        }
        return []
      })

      const dbModule = await import('../database')
      await dbModule.initializeDatabase()

      // v18 migration should add 4 columns to chat_messages
      const runCalls = mockDatabase.run.mock.calls
      const v18Alters = runCalls.filter(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes('ALTER TABLE chat_messages ADD COLUMN')
      )

      const allAlterSqls = v18Alters.map((c: any[]) => c[0] as string)
      expect(allAlterSqls.some((s: string) => s.includes('edited_at'))).toBe(true)
      expect(allAlterSqls.some((s: string) => s.includes('original_content'))).toBe(true)
      expect(allAlterSqls.some((s: string) => s.includes('created_output_id'))).toBe(true)
      expect(allAlterSqls.some((s: string) => s.includes('saved_as_insight_id'))).toBe(true)
    })
  })

  // =========================================================================
  // Additional: saveDatabase, closeDatabase, run helpers
  // =========================================================================
  describe('saveDatabase()', () => {
    it('should export database and write to disk', async () => {
      const dbModule = await initTestDatabase()
      const fs = await import('fs')

      ;(fs.writeFileSync as any).mockClear()
      mockDatabase.export.mockClear()

      dbModule.saveDatabase()

      expect(mockDatabase.export).toHaveBeenCalled()
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/test-hidock.db',
        expect.any(Buffer)
      )
    })
  })

  describe('closeDatabase()', () => {
    it('should save and close the database', async () => {
      const dbModule = await initTestDatabase()

      mockDatabase.close.mockClear()

      dbModule.closeDatabase()

      expect(mockDatabase.export).toHaveBeenCalled()
      expect(mockDatabase.close).toHaveBeenCalled()
    })
  })

  // =========================================================================
  // updateRecordingStatus (legacy)
  // =========================================================================
  describe('updateRecordingStatus()', () => {
    it('should update the legacy status column', async () => {
      const dbModule = await initTestDatabase()
      mockDatabase.run.mockClear()

      dbModule.updateRecordingStatus('rec-100', 'complete')

      const updateCall = mockDatabase.run.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && (call[0] as string).includes('UPDATE recordings SET status = ?')
      )
      expect(updateCall).toBeDefined()
      expect(updateCall![1]).toEqual(['complete', 'rec-100'])
    })
  })

  // =========================================================================
  // queryAll / queryOne helpers
  // =========================================================================
  describe('queryAll()', () => {
    it('should return multiple rows', async () => {
      const dbModule = await initTestDatabase()

      const mockRows = [
        { id: 'r1', filename: 'a.hda' },
        { id: 'r2', filename: 'b.hda' },
        { id: 'r3', filename: 'c.hda' }
      ]
      setQueryResults(mockRows)

      const results = dbModule.queryAll<{ id: string; filename: string }>(
        'SELECT * FROM recordings ORDER BY filename',
        []
      )

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe('r1')
      expect(results[2].filename).toBe('c.hda')
      expect(mockStmt.free).toHaveBeenCalled()
    })
  })

  describe('run()', () => {
    it('should run SQL and save the database', async () => {
      const dbModule = await initTestDatabase()
      const fs = await import('fs')

      mockDatabase.run.mockClear()
      ;(fs.writeFileSync as any).mockClear()
      mockDatabase.export.mockClear()

      dbModule.run('INSERT INTO recordings (id, filename) VALUES (?, ?)', ['test-id', 'test.hda'])

      expect(mockDatabase.run).toHaveBeenCalledWith(
        'INSERT INTO recordings (id, filename) VALUES (?, ?)',
        ['test-id', 'test.hda']
      )

      // Should auto-save after run()
      expect(mockDatabase.export).toHaveBeenCalled()
      expect(fs.writeFileSync).toHaveBeenCalled()
    })
  })
})
