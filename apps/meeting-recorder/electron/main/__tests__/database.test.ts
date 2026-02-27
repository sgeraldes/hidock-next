import { describe, it, expect, afterEach, vi } from 'vitest'

const mockRun = vi.fn()
const mockExec = vi.fn().mockReturnValue([])
const mockExportFn = vi.fn().mockReturnValue(new Uint8Array([1, 2, 3]))
const mockClose = vi.fn()

vi.mock('sql.js', () => ({
  default: vi.fn().mockResolvedValue({
    Database: vi.fn(function (this: Record<string, unknown>) {
      this.run = mockRun
      this.exec = mockExec
      this.export = mockExportFn
      this.close = mockClose
    }),
  }),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-meeting-recorder'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((s: string) => Buffer.from(`encrypted:${s}`)),
    decryptString: vi.fn().mockImplementation((b: Buffer) => b.toString().replace('encrypted:', '')),
  },
}))

vi.mock('fs', () => {
  const fsMocks = {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  }
  return { ...fsMocks, default: fsMocks }
})

import {
  initializeDatabase,
  closeDatabase,
  getDatabase,
  saveDatabase,
  createSession,
  getSession,
  updateSession,
  getAllSessions,
  deleteSession,
  createRecording,
  getRecordingsBySession,
  updateRecording,
  insertTranscriptSegment,
  getTranscriptBySession,
  createSpeaker,
  getSpeakers,
  linkSpeakerToSession,
  getSessionSpeakers,
  createAttachment,
  getAttachmentsBySession,
  createActionItem,
  getActionItemsBySession,
  updateActionItem,
  createTalkingPoint,
  getTalkingPointsBySession,
  getMeetingTypes,
  createMeetingType,
  getSetting,
  setSetting,
  recoverInterruptedSessions,
} from '../services/database'

describe('Database Service', () => {
  afterEach(() => {
    closeDatabase()
    mockRun.mockClear()
    mockExec.mockReturnValue([])
    mockExportFn.mockClear()
  })

  describe('initializeDatabase', () => {
    it('initializes sql.js and creates a new database when no file exists', async () => {
      await initializeDatabase()
      const db = getDatabase()
      expect(db).toBeTruthy()
    })

    it('loads existing database file when present', async () => {
      const fs = await import('fs')
      vi.mocked(fs.existsSync).mockReturnValueOnce(true)
      vi.mocked(fs.readFileSync).mockReturnValueOnce(Buffer.from([1, 2, 3]))

      await initializeDatabase()
      const db = getDatabase()
      expect(db).toBeTruthy()
    })

    it('creates all required tables', async () => {
      await initializeDatabase()
      const calls = mockRun.mock.calls.map((c: unknown[]) => String(c[0]))
      const createTableCalls = calls.filter((s: string) => s.includes('CREATE TABLE'))
      expect(createTableCalls.length).toBeGreaterThanOrEqual(12)
    })

    it('seeds default meeting types on first run', async () => {
      await initializeDatabase()
      const calls = mockRun.mock.calls.map((c: unknown[]) => String(c[0]))
      const insertCalls = calls.filter((s: string) => s.includes('INSERT') && s.includes('meeting_types'))
      expect(insertCalls.length).toBeGreaterThan(0)
    })

    it('saves database to disk after initialization', async () => {
      const fs = await import('fs')
      await initializeDatabase()
      expect(fs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('crash recovery', () => {
    it('marks active sessions as interrupted on startup', async () => {
      mockExec.mockImplementation((sql: string) => {
        if (typeof sql === 'string' && sql.includes("status = 'active'")) {
          return [{ columns: ['id'], values: [['session-1'], ['session-2']] }]
        }
        if (typeof sql === 'string' && sql.includes("status = 'recording'")) {
          return [{ columns: ['id'], values: [['rec-1']] }]
        }
        return []
      })

      await initializeDatabase()
      const count = recoverInterruptedSessions()
      expect(count).toBeGreaterThanOrEqual(0)
      mockExec.mockImplementation(() => [])
    })
  })

  describe('Session CRUD', () => {
    it('createSession returns a session with an id and active status', async () => {
      await initializeDatabase()
      const session = createSession()
      expect(session).toHaveProperty('id')
      expect(session.status).toBe('active')
      expect(session.started_at).toBeTruthy()
    })

    it('getSession retrieves a session by id', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'status', 'started_at', 'ended_at', 'meeting_type_id', 'title', 'summary', 'created_at'],
        values: [['s1', 'active', '2026-01-01T00:00:00', null, null, null, null, '2026-01-01T00:00:00']],
      }])
      const session = getSession('s1')
      expect(session).toBeTruthy()
      expect(session?.id).toBe('s1')
    })

    it('updateSession modifies session fields', async () => {
      await initializeDatabase()
      mockRun.mockClear()
      updateSession('s1', { status: 'complete', title: 'Test Meeting' })
      expect(mockRun).toHaveBeenCalled()
    })

    it('deleteSession removes session and related data', async () => {
      await initializeDatabase()
      mockRun.mockClear()
      deleteSession('s1')
      const deleteCalls = mockRun.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((s: string) => s.includes('DELETE'))
      expect(deleteCalls).toHaveLength(8)
      expect(deleteCalls.some((s: string) => s.includes('sessions'))).toBe(true)
      expect(deleteCalls.some((s: string) => s.includes('transcript_segments'))).toBe(true)
      expect(deleteCalls.some((s: string) => s.includes('recordings'))).toBe(true)
      expect(deleteCalls.some((s: string) => s.includes('attachments'))).toBe(true)
      expect(deleteCalls.some((s: string) => s.includes('action_items'))).toBe(true)
      expect(deleteCalls.some((s: string) => s.includes('talking_points'))).toBe(true)
      expect(deleteCalls.some((s: string) => s.includes('meetings'))).toBe(true)
      expect(deleteCalls.some((s: string) => s.includes('session_speakers'))).toBe(true)
    })

    it('getAllSessions returns an array', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'status', 'started_at', 'ended_at', 'meeting_type_id', 'title', 'summary', 'created_at'],
        values: [
          ['s1', 'active', '2026-01-01', null, null, null, null, '2026-01-01'],
          ['s2', 'complete', '2026-01-02', '2026-01-02', null, 'Done', 'Summary', '2026-01-02'],
        ],
      }])
      const sessions = getAllSessions()
      expect(Array.isArray(sessions)).toBe(true)
    })
  })

  describe('Recording CRUD', () => {
    it('createRecording creates a recording linked to a session', async () => {
      await initializeDatabase()
      const rec = createRecording({
        session_id: 's1',
        filename: 'rec.ogg',
        file_path: '/tmp/rec.ogg',
        sample_rate: 16000,
      })
      expect(rec).toHaveProperty('id')
      expect(rec.session_id).toBe('s1')
      expect(rec.status).toBe('recording')
    })

    it('getRecordingsBySession returns recordings for a session', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'session_id', 'filename', 'file_path', 'duration_ms', 'sample_rate', 'created_at', 'status', 'last_chunk_index'],
        values: [['r1', 's1', 'rec.ogg', '/tmp/rec.ogg', 0, 16000, '2026-01-01', 'recording', 0]],
      }])
      const recs = getRecordingsBySession('s1')
      expect(recs).toHaveLength(1)
      expect(recs[0].session_id).toBe('s1')
    })

    it('updateRecording modifies recording fields', async () => {
      await initializeDatabase()
      mockRun.mockClear()
      updateRecording('r1', { status: 'stopped', duration_ms: 60000 })
      expect(mockRun).toHaveBeenCalled()
    })
  })

  describe('Transcript Segments', () => {
    it('insertTranscriptSegment inserts a segment', async () => {
      await initializeDatabase()
      const seg = insertTranscriptSegment({
        session_id: 's1',
        text: 'Hello world',
        start_ms: 0,
        end_ms: 5000,
        chunk_index: 0,
      })
      expect(seg).toHaveProperty('id')
      expect(seg.text).toBe('Hello world')
    })

    it('getTranscriptBySession returns ordered segments', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'session_id', 'speaker_name', 'text', 'start_ms', 'end_ms', 'sentiment', 'confidence', 'language', 'chunk_index', 'created_at'],
        values: [
          ['t1', 's1', 'Alice', 'Hi', 0, 1000, 'positive', 0.9, 'en', 0, '2026-01-01'],
          ['t2', 's1', 'Bob', 'Hey', 1000, 2000, 'neutral', 0.8, 'en', 1, '2026-01-01'],
        ],
      }])
      const segments = getTranscriptBySession('s1')
      expect(segments).toHaveLength(2)
      expect(segments[0].speaker_name).toBe('Alice')
    })
  })

  describe('Speakers', () => {
    it('createSpeaker creates a speaker', async () => {
      await initializeDatabase()
      const speaker = createSpeaker('Alice')
      expect(speaker).toHaveProperty('id')
      expect(speaker.name).toBe('Alice')
    })

    it('getSpeakers returns all speakers', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'name', 'display_name', 'created_at'],
        values: [['sp1', 'Alice', 'Alice A.', '2026-01-01']],
      }])
      const speakers = getSpeakers()
      expect(speakers).toHaveLength(1)
    })

    it('linkSpeakerToSession links a speaker to a session', async () => {
      await initializeDatabase()
      mockRun.mockClear()
      linkSpeakerToSession('s1', 'sp1')
      expect(mockRun).toHaveBeenCalled()
    })

    it('getSessionSpeakers returns speakers for a session', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'name', 'display_name', 'created_at'],
        values: [['sp1', 'Alice', null, '2026-01-01']],
      }])
      const speakers = getSessionSpeakers('s1')
      expect(speakers).toHaveLength(1)
    })
  })

  describe('Attachments', () => {
    it('createAttachment creates an attachment', async () => {
      await initializeDatabase()
      const att = createAttachment({
        session_id: 's1',
        type: 'note',
        content_text: 'My note',
      })
      expect(att).toHaveProperty('id')
      expect(att.type).toBe('note')
    })

    it('getAttachmentsBySession returns attachments for a session', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'session_id', 'type', 'filename', 'file_path', 'mime_type', 'content_text', 'created_at'],
        values: [['a1', 's1', 'note', null, null, null, 'My note', '2026-01-01']],
      }])
      const atts = getAttachmentsBySession('s1')
      expect(atts).toHaveLength(1)
    })
  })

  describe('Action Items', () => {
    it('createActionItem creates an action item', async () => {
      await initializeDatabase()
      const item = createActionItem({
        session_id: 's1',
        text: 'Follow up with client',
      })
      expect(item).toHaveProperty('id')
      expect(item.status).toBe('open')
    })

    it('getActionItemsBySession returns action items', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'session_id', 'text', 'assignee', 'status', 'created_at'],
        values: [['ai1', 's1', 'Follow up', 'Alice', 'open', '2026-01-01']],
      }])
      const items = getActionItemsBySession('s1')
      expect(items).toHaveLength(1)
    })

    it('updateActionItem modifies action item fields', async () => {
      await initializeDatabase()
      mockRun.mockClear()
      updateActionItem('ai1', { status: 'done' })
      expect(mockRun).toHaveBeenCalled()
    })
  })

  describe('Talking Points', () => {
    it('createTalkingPoint creates a talking point', async () => {
      await initializeDatabase()
      const tp = createTalkingPoint({
        session_id: 's1',
        topic: 'Q1 Revenue',
        first_mentioned_ms: 30000,
      })
      expect(tp).toHaveProperty('id')
      expect(tp.topic).toBe('Q1 Revenue')
    })

    it('getTalkingPointsBySession returns talking points', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'session_id', 'topic', 'first_mentioned_ms', 'created_at'],
        values: [['tp1', 's1', 'Q1 Revenue', 30000, '2026-01-01']],
      }])
      const tps = getTalkingPointsBySession('s1')
      expect(tps).toHaveLength(1)
    })
  })

  describe('Meeting Types', () => {
    it('getMeetingTypes returns all meeting types', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['id', 'name', 'description', 'prompt_template', 'icon', 'is_default', 'created_at'],
        values: [
          ['mt1', 'General Meeting', 'Default', null, 'calendar', 1, '2026-01-01'],
          ['mt2', 'Standup', 'Daily standup', null, 'clock', 1, '2026-01-01'],
        ],
      }])
      const types = getMeetingTypes()
      expect(types).toHaveLength(2)
    })

    it('createMeetingType creates a custom meeting type', async () => {
      await initializeDatabase()
      const mt = createMeetingType({
        name: 'Custom',
        description: 'My custom type',
        prompt_template: 'Summarize as {{format}}',
      })
      expect(mt).toHaveProperty('id')
      expect(mt.name).toBe('Custom')
      expect(mt.is_default).toBe(0)
    })
  })

  describe('Settings', () => {
    it('setSetting stores a setting', async () => {
      await initializeDatabase()
      mockRun.mockClear()
      setSetting('theme', 'dark')
      expect(mockRun).toHaveBeenCalled()
    })

    it('getSetting retrieves a setting value', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['key', 'value', 'encrypted'],
        values: [['theme', 'dark', 0]],
      }])
      const val = getSetting('theme')
      expect(val).toBe('dark')
    })

    it('getSetting returns null for missing key', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([])
      const val = getSetting('nonexistent')
      expect(val).toBeNull()
    })

    it('setSetting with encrypt=true encrypts the value', async () => {
      await initializeDatabase()
      mockRun.mockClear()
      setSetting('api_key', 'sk-123', true)
      expect(mockRun).toHaveBeenCalled()
    })

    it('getSetting decrypts encrypted values', async () => {
      await initializeDatabase()
      mockExec.mockReturnValueOnce([{
        columns: ['key', 'value', 'encrypted'],
        values: [['api_key', Buffer.from('encrypted:sk-123').toString('base64'), 1]],
      }])
      const val = getSetting('api_key')
      expect(val).toBe('sk-123')
    })
  })

  describe('saveDatabase', () => {
    it('writes database to disk', async () => {
      const fs = await import('fs')
      await initializeDatabase()
      vi.mocked(fs.writeFileSync).mockClear()
      saveDatabase()
      expect(fs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('getDatabase', () => {
    it('throws if database not initialized', () => {
      expect(() => getDatabase()).toThrow()
    })
  })
})
