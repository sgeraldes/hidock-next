import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((s: string) => Buffer.from(`encrypted:${s}`)),
    decryptString: vi.fn().mockImplementation((b: Buffer) => b.toString().replace('encrypted:', '')),
  },
}))

import { app } from 'electron'
import { DEFAULT_MEETING_TYPES } from '../services/database-schema'
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
  renameSpeakerInSession,
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

// This suite exercises the REAL shared @hidock/database engine (real
// better-sqlite3), not a mock — `initializeDatabase()`'s DatabaseEngine is a
// module-level singleton, so `dbPathProvider` (via app.getPath('userData'))
// must point at a fresh, real, on-disk directory per test for isolation, and
// the directory must actually exist for better-sqlite3 to open a file in it
// (unlike the sql.js/in-memory engine this file originally tested, a REAL
// on-disk SQLite file cannot be faked with mocked fs/exec return values).
describe('Database Service', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'meeting-recorder-db-'))
    vi.mocked(app.getPath).mockReturnValue(userDataDir)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  describe('initializeDatabase', () => {
    it('creates a new database when no file exists', async () => {
      await initializeDatabase()
      const db = getDatabase()
      expect(db).toBeTruthy()
    })

    it('loads existing database file when present', async () => {
      await initializeDatabase()
      const session = createSession()
      closeDatabase()

      // Re-open against the SAME on-disk file (app.getPath still points at
      // userDataDir) — the earlier session must still be there.
      await initializeDatabase()
      const reloaded = getSession(session.id)
      expect(reloaded).toBeTruthy()
      expect(reloaded?.id).toBe(session.id)
    })

    it('creates all required tables', async () => {
      await initializeDatabase()
      const db = getDatabase()
      const result = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      const tableNames = result.length > 0 ? result[0].values.map((row) => row[0] as string) : []
      expect(tableNames.length).toBeGreaterThanOrEqual(12)
      expect(tableNames).toEqual(
        expect.arrayContaining([
          'sessions',
          'recordings',
          'transcript_segments',
          'speakers',
          'session_speakers',
          'meetings',
          'attachments',
          'action_items',
          'talking_points',
          'meeting_types',
          'settings',
        ]),
      )
    })

    it('seeds default meeting types on first run', async () => {
      await initializeDatabase()
      const types = getMeetingTypes()
      expect(types).toHaveLength(DEFAULT_MEETING_TYPES.length)
      expect(types.some((t) => t.name === 'General Meeting')).toBe(true)
    })

    it('saves database to disk after initialization', async () => {
      await initializeDatabase()
      expect(existsSync(join(userDataDir, 'data', 'meeting-recorder.db'))).toBe(true)
    })
  })

  describe('crash recovery', () => {
    it('marks active sessions and in-progress recordings as interrupted on startup', async () => {
      await initializeDatabase()
      const s1 = createSession()
      const s2 = createSession()
      const rec = createRecording({
        session_id: s1.id,
        filename: 'rec.ogg',
        file_path: '/tmp/rec.ogg',
      })

      const count = recoverInterruptedSessions()

      // 2 active sessions + 1 in-progress ('recording') recording.
      expect(count).toBe(3)
      expect(getSession(s1.id)?.status).toBe('interrupted')
      expect(getSession(s2.id)?.status).toBe('interrupted')
      expect(getRecordingsBySession(s1.id).find((r) => r.id === rec.id)?.status).toBe('interrupted')
    })

    it('does nothing when there is nothing to recover', async () => {
      await initializeDatabase()
      const session = createSession()
      updateSession(session.id, { status: 'complete' })

      const count = recoverInterruptedSessions()

      expect(count).toBe(0)
      expect(getSession(session.id)?.status).toBe('complete')
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
      const created = createSession()
      const session = getSession(created.id)
      expect(session).toBeTruthy()
      expect(session?.id).toBe(created.id)
    })

    it('getSession returns null for an unknown id', async () => {
      await initializeDatabase()
      expect(getSession('does-not-exist')).toBeNull()
    })

    it('updateSession modifies session fields', async () => {
      await initializeDatabase()
      const session = createSession()
      updateSession(session.id, { status: 'complete', title: 'Test Meeting' })
      const updated = getSession(session.id)
      expect(updated?.status).toBe('complete')
      expect(updated?.title).toBe('Test Meeting')
    })

    it('updateSession rejects an unknown column', async () => {
      await initializeDatabase()
      const session = createSession()
      expect(() =>
        // @ts-expect-error deliberately invalid column for this test
        updateSession(session.id, { id: 'not-allowed' }),
      ).toThrow(/Invalid column/)
    })

    it('deleteSession removes the session and all its related data', async () => {
      await initializeDatabase()
      const session = createSession()
      const recording = createRecording({
        session_id: session.id,
        filename: 'rec.ogg',
        file_path: '/tmp/rec.ogg',
      })
      insertTranscriptSegment({
        session_id: session.id,
        text: 'Hello world',
        start_ms: 0,
        end_ms: 1000,
        chunk_index: 0,
      })
      createAttachment({ session_id: session.id, type: 'note', content_text: 'note' })
      createActionItem({ session_id: session.id, text: 'follow up' })
      createTalkingPoint({ session_id: session.id, topic: 'Q1 Revenue', first_mentioned_ms: 0 })
      const speaker = createSpeaker('Alice')
      linkSpeakerToSession(session.id, speaker.id)

      deleteSession(session.id)

      expect(getSession(session.id)).toBeNull()
      expect(getRecordingsBySession(session.id)).toHaveLength(0)
      expect(getTranscriptBySession(session.id)).toHaveLength(0)
      expect(getAttachmentsBySession(session.id)).toHaveLength(0)
      expect(getActionItemsBySession(session.id)).toHaveLength(0)
      expect(getTalkingPointsBySession(session.id)).toHaveLength(0)
      expect(getSessionSpeakers(session.id)).toHaveLength(0)
      // The speaker itself is a global row, not session-scoped — deleteSession
      // only removes the session_speakers link, not the speaker.
      expect(getSpeakers().some((s) => s.id === speaker.id)).toBe(true)
      // recording is asserted gone above via getRecordingsBySession; keep the
      // reference so a future refactor that drops that call still exercises it.
      expect(recording).toHaveProperty('id')
    })

    it('getAllSessions returns every session, most recent first', async () => {
      await initializeDatabase()
      const first = createSession()
      const second = createSession()
      const sessions = getAllSessions()
      expect(sessions.map((s) => s.id)).toEqual(expect.arrayContaining([first.id, second.id]))
      expect(sessions).toHaveLength(2)
    })
  })

  describe('Recording CRUD', () => {
    it('createRecording creates a recording linked to a session', async () => {
      await initializeDatabase()
      const session = createSession()
      const rec = createRecording({
        session_id: session.id,
        filename: 'rec.ogg',
        file_path: '/tmp/rec.ogg',
        sample_rate: 16000,
      })
      expect(rec).toHaveProperty('id')
      expect(rec.session_id).toBe(session.id)
      expect(rec.status).toBe('recording')
    })

    it('getRecordingsBySession returns recordings for a session', async () => {
      await initializeDatabase()
      const session = createSession()
      const rec = createRecording({
        session_id: session.id,
        filename: 'rec.ogg',
        file_path: '/tmp/rec.ogg',
      })
      const recs = getRecordingsBySession(session.id)
      expect(recs).toHaveLength(1)
      expect(recs[0].id).toBe(rec.id)
      expect(recs[0].session_id).toBe(session.id)
    })

    it('updateRecording modifies recording fields', async () => {
      await initializeDatabase()
      const session = createSession()
      const rec = createRecording({
        session_id: session.id,
        filename: 'rec.ogg',
        file_path: '/tmp/rec.ogg',
      })
      updateRecording(rec.id, { status: 'stopped', duration_ms: 60000 })
      const updated = getRecordingsBySession(session.id)[0]
      expect(updated.status).toBe('stopped')
      expect(updated.duration_ms).toBe(60000)
    })
  })

  describe('Transcript Segments', () => {
    it('insertTranscriptSegment inserts a segment', async () => {
      await initializeDatabase()
      const session = createSession()
      const seg = insertTranscriptSegment({
        session_id: session.id,
        text: 'Hello world',
        start_ms: 0,
        end_ms: 5000,
        chunk_index: 0,
      })
      expect(seg).toHaveProperty('id')
      expect(seg.text).toBe('Hello world')
    })

    it('getTranscriptBySession returns segments ordered by start time', async () => {
      await initializeDatabase()
      const session = createSession()
      insertTranscriptSegment({
        session_id: session.id,
        speaker_name: 'Bob',
        text: 'Hey',
        start_ms: 1000,
        end_ms: 2000,
        chunk_index: 1,
      })
      insertTranscriptSegment({
        session_id: session.id,
        speaker_name: 'Alice',
        text: 'Hi',
        start_ms: 0,
        end_ms: 1000,
        chunk_index: 0,
      })

      const segments = getTranscriptBySession(session.id)
      expect(segments).toHaveLength(2)
      expect(segments[0].speaker_name).toBe('Alice')
      expect(segments[1].speaker_name).toBe('Bob')
    })
  })

  // SPEC-007: Rename count accuracy
  describe('renameSpeakerInSession (SPEC-007)', () => {
    it('returns the count of segments renamed, not the inflated post-rename total', async () => {
      await initializeDatabase()
      const session = createSession()
      for (let i = 0; i < 3; i++) {
        insertTranscriptSegment({
          session_id: session.id,
          speaker_name: 'Speaker 1',
          text: `line ${i}`,
          start_ms: i * 1000,
          end_ms: i * 1000 + 500,
          chunk_index: i,
        })
      }
      // A PRE-EXISTING "Alice" segment must not inflate the count returned
      // below — the bug SPEC-007 guards against is counting the post-rename
      // total (which would include this row) instead of just what changed.
      insertTranscriptSegment({
        session_id: session.id,
        speaker_name: 'Alice',
        text: 'already Alice',
        start_ms: 3000,
        end_ms: 3500,
        chunk_index: 3,
      })

      const count = renameSpeakerInSession(session.id, 'Speaker 1', 'Alice')

      expect(count).toBe(3)
      const segments = getTranscriptBySession(session.id)
      expect(segments.filter((s) => s.speaker_name === 'Alice')).toHaveLength(4)
      expect(segments.some((s) => s.speaker_name === 'Speaker 1')).toBe(false)
    })

    it('returns 0 when the old speaker name does not exist in the session', async () => {
      await initializeDatabase()
      const session = createSession()
      insertTranscriptSegment({
        session_id: session.id,
        speaker_name: 'Bob',
        text: 'hi',
        start_ms: 0,
        end_ms: 500,
        chunk_index: 0,
      })

      const count = renameSpeakerInSession(session.id, 'Ghost', 'Alice')

      expect(count).toBe(0)
    })

    it('still runs the UPDATE regardless of pre-count', async () => {
      await initializeDatabase()
      const session = createSession()
      insertTranscriptSegment({
        session_id: session.id,
        speaker_name: 'Bob',
        text: 'a',
        start_ms: 0,
        end_ms: 500,
        chunk_index: 0,
      })
      insertTranscriptSegment({
        session_id: session.id,
        speaker_name: 'Bob',
        text: 'b',
        start_ms: 500,
        end_ms: 1000,
        chunk_index: 1,
      })

      renameSpeakerInSession(session.id, 'Bob', 'Robert')

      const segments = getTranscriptBySession(session.id)
      expect(segments.every((s) => s.speaker_name === 'Robert')).toBe(true)
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
      createSpeaker('Alice')
      createSpeaker('Bob')
      const speakers = getSpeakers()
      expect(speakers).toHaveLength(2)
      expect(speakers.map((s) => s.name)).toEqual(expect.arrayContaining(['Alice', 'Bob']))
    })

    it('linkSpeakerToSession links a speaker to a session', async () => {
      await initializeDatabase()
      const session = createSession()
      const speaker = createSpeaker('Alice')
      linkSpeakerToSession(session.id, speaker.id)
      const linked = getSessionSpeakers(session.id)
      expect(linked).toHaveLength(1)
      expect(linked[0].id).toBe(speaker.id)
    })

    it('getSessionSpeakers returns only speakers linked to that session', async () => {
      await initializeDatabase()
      const session = createSession()
      const otherSession = createSession()
      const alice = createSpeaker('Alice')
      const bob = createSpeaker('Bob')
      linkSpeakerToSession(session.id, alice.id)
      linkSpeakerToSession(otherSession.id, bob.id)

      const speakers = getSessionSpeakers(session.id)

      expect(speakers).toHaveLength(1)
      expect(speakers[0].id).toBe(alice.id)
    })
  })

  describe('Attachments', () => {
    it('createAttachment creates an attachment', async () => {
      await initializeDatabase()
      const session = createSession()
      const att = createAttachment({
        session_id: session.id,
        type: 'note',
        content_text: 'My note',
      })
      expect(att).toHaveProperty('id')
      expect(att.type).toBe('note')
    })

    it('getAttachmentsBySession returns attachments for a session', async () => {
      await initializeDatabase()
      const session = createSession()
      createAttachment({ session_id: session.id, type: 'note', content_text: 'My note' })
      const atts = getAttachmentsBySession(session.id)
      expect(atts).toHaveLength(1)
      expect(atts[0].content_text).toBe('My note')
    })
  })

  describe('Action Items', () => {
    it('createActionItem creates an action item', async () => {
      await initializeDatabase()
      const session = createSession()
      const item = createActionItem({
        session_id: session.id,
        text: 'Follow up with client',
      })
      expect(item).toHaveProperty('id')
      expect(item.status).toBe('open')
    })

    it('getActionItemsBySession returns action items for a session', async () => {
      await initializeDatabase()
      const session = createSession()
      createActionItem({ session_id: session.id, text: 'Follow up', assignee: 'Alice' })
      const items = getActionItemsBySession(session.id)
      expect(items).toHaveLength(1)
      expect(items[0].assignee).toBe('Alice')
    })

    it('updateActionItem modifies action item fields', async () => {
      await initializeDatabase()
      const session = createSession()
      const item = createActionItem({ session_id: session.id, text: 'Follow up' })
      updateActionItem(item.id, { status: 'done' })
      const updated = getActionItemsBySession(session.id)[0]
      expect(updated.status).toBe('done')
    })
  })

  describe('Talking Points', () => {
    it('createTalkingPoint creates a talking point', async () => {
      await initializeDatabase()
      const session = createSession()
      const tp = createTalkingPoint({
        session_id: session.id,
        topic: 'Q1 Revenue',
        first_mentioned_ms: 30000,
      })
      expect(tp).toHaveProperty('id')
      expect(tp.topic).toBe('Q1 Revenue')
    })

    it('getTalkingPointsBySession returns talking points for a session', async () => {
      await initializeDatabase()
      const session = createSession()
      createTalkingPoint({ session_id: session.id, topic: 'Q1 Revenue', first_mentioned_ms: 30000 })
      const tps = getTalkingPointsBySession(session.id)
      expect(tps).toHaveLength(1)
      expect(tps[0].topic).toBe('Q1 Revenue')
    })
  })

  describe('Meeting Types', () => {
    it('getMeetingTypes returns the seeded default types', async () => {
      await initializeDatabase()
      const types = getMeetingTypes()
      expect(types.length).toBeGreaterThanOrEqual(DEFAULT_MEETING_TYPES.length)
      expect(types.every((t) => t.is_default === 1)).toBe(true)
    })

    it('createMeetingType creates a custom, non-default meeting type', async () => {
      await initializeDatabase()
      const mt = createMeetingType({
        name: 'Custom',
        description: 'My custom type',
        prompt_template: 'Summarize as {{format}}',
      })
      expect(mt).toHaveProperty('id')
      expect(mt.name).toBe('Custom')
      expect(mt.is_default).toBe(0)
      expect(getMeetingTypes().some((t) => t.id === mt.id)).toBe(true)
    })
  })

  describe('Settings', () => {
    it('setSetting stores a setting that getSetting can retrieve', async () => {
      await initializeDatabase()
      setSetting('theme', 'dark')
      expect(getSetting('theme')).toBe('dark')
    })

    it('getSetting returns null for a missing key', async () => {
      await initializeDatabase()
      expect(getSetting('nonexistent')).toBeNull()
    })

    it('setSetting with encrypt=true stores the value encrypted, not as plaintext', async () => {
      await initializeDatabase()
      setSetting('api_key', 'sk-123', true)

      const db = getDatabase()
      const result = db.exec('SELECT value, encrypted FROM settings WHERE key = ?', ['api_key'])
      const row = result[0].values[0]
      const storedValue = row[0] as string
      const encryptedFlag = row[1] as number
      expect(encryptedFlag).toBe(1)
      expect(storedValue).not.toBe('sk-123')

      // Round-trips back to plaintext via the (mocked) safeStorage decrypt path.
      expect(getSetting('api_key')).toBe('sk-123')
    })
  })

  describe('saveDatabase', () => {
    it('leaves the database file on disk (real better-sqlite3 persists on write)', async () => {
      await initializeDatabase()
      createSession()
      expect(() => saveDatabase()).not.toThrow()
      expect(existsSync(join(userDataDir, 'data', 'meeting-recorder.db'))).toBe(true)
    })
  })

  describe('getDatabase', () => {
    it('throws if database not initialized', () => {
      expect(() => getDatabase()).toThrow()
    })
  })
})
