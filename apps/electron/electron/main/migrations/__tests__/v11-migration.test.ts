
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { migrateToV11Impl } from '../../ipc/migration-handlers'
import initSqlJs from 'sql.js'

// Mock Electron
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn()
}))

let dbInstance: any = null

vi.mock('../../services/database', () => ({
  getDatabase: () => dbInstance,
  runInTransaction: (fn: any) => fn(),
  saveDatabase: vi.fn()
}))

describe('V11 Migration', () => {
  let SQL: any

  beforeEach(async () => {
    SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    
    dbInstance.run(`
      CREATE TABLE recordings (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        date_recorded TEXT NOT NULL,
        meeting_id TEXT,
        status TEXT
      );
      CREATE TABLE transcripts (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        full_text TEXT,
        summary TEXT,
        action_items TEXT
      );
      CREATE TABLE meetings (id TEXT PRIMARY KEY, subject TEXT);
      CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    `)
    
    dbInstance.run(`
      INSERT INTO recordings (id, filename, date_recorded, status) VALUES 
        ('rec-1', 'test.wav', '2025-01-01T10:00:00Z', 'transcribed');
      INSERT INTO transcripts (id, recording_id, full_text, summary, action_items) VALUES
        ('trans-1', 'rec-1', 'Hello world', 'A summary', '["Action 1"]');
    `)
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
    vi.clearAllMocks()
  })

  it('should migrate recordings to knowledge captures', async () => {
    const result = await migrateToV11Impl(null)
    expect(result.success).toBe(true)
    expect(result.capturesCreated).toBe(1)

    const captures = dbInstance.exec("SELECT * FROM knowledge_captures")
    expect(captures.length).toBe(1)
    expect(captures[0].values[0][1]).toBe('Recording: test.wav')
  })
})
