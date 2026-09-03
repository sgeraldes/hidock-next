import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HiDockDataSource } from '../src/data-source.js'

let directory: string
let databasePath: string
let source: HiDockDataSource | undefined

function createFixture(path: string): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY, subject TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL
    );
    CREATE TABLE recordings (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, date_recorded TEXT NOT NULL,
      personal INTEGER DEFAULT 0, deleted_at TEXT
    );
    CREATE TABLE knowledge_captures (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, user_title TEXT, summary TEXT, category TEXT,
      quality_rating TEXT, source_recording_id TEXT, meeting_id TEXT, captured_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE transcripts (
      id TEXT PRIMARY KEY, recording_id TEXT NOT NULL, full_text TEXT NOT NULL, language TEXT,
      summary TEXT, topics TEXT, key_points TEXT, speakers TEXT, mentioned_people TEXT
    );
    CREATE TABLE action_items (
      id TEXT PRIMARY KEY, knowledge_capture_id TEXT NOT NULL, content TEXT NOT NULL,
      assignee TEXT, due_date TEXT, priority TEXT, status TEXT, created_at TEXT
    );
    CREATE TABLE decisions (
      id TEXT PRIMARY KEY, knowledge_capture_id TEXT NOT NULL, content TEXT NOT NULL,
      context TEXT, participants TEXT, confidence REAL, decided_at TEXT, created_at TEXT
    );
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE knowledge_projects (knowledge_capture_id TEXT NOT NULL, project_id TEXT NOT NULL);
    CREATE TABLE vector_embeddings (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, embedding BLOB NOT NULL, meeting_id TEXT,
      recording_id TEXT, chunk_index INTEGER, timestamp TEXT, subject TEXT, source_type TEXT,
      capture_id TEXT, created_at TEXT
    );
  `)

  const meeting = db.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?)')
  meeting.run('meeting-good', 'Roadmap review', '2026-08-26T09:00:00Z', '2026-08-26T10:00:00Z')
  const recording = db.prepare(
    'INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, ?, ?, ?)'
  )
  recording.run('rec-good', 'good.wav', '2026-08-26T09:00:00Z', 0, null)
  recording.run('rec-personal', 'personal.wav', '2026-08-27T09:00:00Z', 1, null)
  recording.run('rec-deleted', 'deleted.wav', '2026-08-27T08:00:00Z', 0, '2026-08-27T10:00:00Z')
  recording.run('rec-low', 'low.wav', '2026-08-27T07:00:00Z', 0, null)
  recording.run('rec-rescued', 'rescued.wav', '2026-08-25T09:00:00Z', 0, null)

  const capture = db.prepare(
    `INSERT INTO knowledge_captures
      (id, title, user_title, summary, category, quality_rating, source_recording_id, meeting_id, captured_at, deleted_at)
     VALUES (?, ?, ?, ?, 'meeting', ?, ?, ?, ?, ?)`
  )
  capture.run('cap-good', 'good.wav', 'Quarterly roadmap', 'Roadmap scope and launch plan', 'valuable', 'rec-good', 'meeting-good', '2026-08-26T09:00:00Z', null)
  capture.run('cap-personal', 'Private', null, 'Private roadmap secret', 'valuable', 'rec-personal', null, '2026-08-27T09:00:00Z', null)
  capture.run('cap-deleted-rec', 'Deleted recording', null, 'Deleted roadmap secret', 'valuable', 'rec-deleted', null, '2026-08-27T08:00:00Z', null)
  capture.run('cap-low', 'Low value', null, 'Low-value roadmap secret', 'low-value', 'rec-low', null, '2026-08-27T07:00:00Z', null)
  capture.run('cap-rescued-low', 'Rescued low', null, 'One low result', 'low-value', 'rec-rescued', null, '2026-08-25T09:00:00Z', null)
  capture.run('cap-rescued-keep', 'Rescued keep', null, 'Explicit keep rescues recording', 'archived', 'rec-rescued', null, '2026-08-25T09:01:00Z', null)
  capture.run('cap-soft-deleted', 'Deleted capture', null, 'Deleted capture roadmap secret', 'valuable', 'rec-good', null, '2026-08-24T09:00:00Z', '2026-08-27T12:00:00Z')
  capture.run('cap-orphan', 'Purged source', null, 'Hard-purged roadmap secret', 'valuable', 'missing-recording', null, '2026-08-27T11:00:00Z', null)

  const transcript = db.prepare(
    `INSERT INTO transcripts
      (id, recording_id, full_text, language, summary, topics, key_points, speakers, mentioned_people)
     VALUES (?, ?, ?, 'en', ?, '["roadmap"]', '["launch"]', '["Kelly"]', '["Alex"]')`
  )
  transcript.run('tr-good', 'rec-good', 'We agreed the public roadmap launch date and next steps.', 'Roadmap summary')
  transcript.run('tr-personal', 'rec-personal', 'Private roadmap secret transcript.', 'Private')
  transcript.run('tr-deleted', 'rec-deleted', 'Deleted roadmap secret transcript.', 'Deleted')
  transcript.run('tr-low', 'rec-low', 'Low-value roadmap secret transcript.', 'Low')
  transcript.run('tr-rescued', 'rec-rescued', 'The rescued roadmap remains searchable.', 'Rescued')

  const chunk = db.prepare(
    `INSERT INTO vector_embeddings
      (id, content, embedding, meeting_id, recording_id, chunk_index, timestamp, subject, source_type, capture_id, created_at)
     VALUES (?, ?, X'00', ?, ?, 0, ?, ?, 'transcript', ?, ?)`
  )
  chunk.run('vec-good', 'Indexed roadmap launch evidence.', 'meeting-good', 'rec-good', '2026-08-26T09:30:00Z', 'Roadmap review', 'cap-good', '2026-08-26T09:30:00Z')
  chunk.run('vec-personal', 'Private indexed roadmap secret.', null, 'rec-personal', '2026-08-27T09:30:00Z', 'Private', 'cap-personal', '2026-08-27T09:30:00Z')
  chunk.run('vec-low', 'Low-value indexed roadmap secret.', null, 'rec-low', '2026-08-27T08:30:00Z', 'Low', 'cap-low', '2026-08-27T08:30:00Z')
  chunk.run('vec-rescued', 'Indexed rescued roadmap evidence.', null, 'rec-rescued', '2026-08-25T09:30:00Z', 'Rescued', 'cap-rescued-keep', '2026-08-25T09:30:00Z')

  const action = db.prepare('INSERT INTO action_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  action.run('act-good', 'cap-good', 'Publish roadmap', 'Kelly', '2026-08-28', 'high', 'pending', '2026-08-26T10:00:00Z')
  action.run('act-private', 'cap-personal', 'Private action', 'Kelly', null, 'high', 'pending', '2026-08-27T10:00:00Z')
  action.run('act-low', 'cap-low', 'Low-value action', null, null, 'low', 'pending', '2026-08-27T09:00:00Z')

  const decision = db.prepare('INSERT INTO decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  decision.run('dec-good', 'cap-good', 'Launch in September', 'Approved plan', '["Kelly","Alex"]', 0.95, '2026-08-26T09:45:00Z', '2026-08-26T09:45:00Z')
  decision.run('dec-private', 'cap-personal', 'Private decision', null, '[]', 0.9, '2026-08-27T09:45:00Z', '2026-08-27T09:45:00Z')

  db.prepare('INSERT INTO projects VALUES (?, ?)').run('project-1', 'Thor')
  db.prepare('INSERT INTO knowledge_projects VALUES (?, ?)').run('cap-good', 'project-1')
  db.close()
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hidock-mcp-'))
  databasePath = join(directory, 'hidock.db')
  createFixture(databasePath)
  source = new HiDockDataSource(databasePath)
})

afterEach(() => {
  source?.close()
  source = undefined
  rmSync(directory, { recursive: true, force: true })
})

describe('HiDockDataSource privacy boundary', () => {
  it('lists only eligible captures and preserves explicit keep rescue semantics', () => {
    const ids = source!.recentMeetings({ limit: 20 }).map((meeting) => meeting.captureId)
    expect(ids).toContain('cap-good')
    expect(ids).toContain('cap-rescued-low')
    expect(ids).toContain('cap-rescued-keep')
    expect(ids).not.toContain('cap-personal')
    expect(ids).not.toContain('cap-deleted-rec')
    expect(ids).not.toContain('cap-low')
    expect(ids).not.toContain('cap-soft-deleted')
    expect(ids).not.toContain('cap-orphan')
  })

  it('checks capture eligibility before returning transcript text', () => {
    expect(source!.getTranscript('cap-good')?.fullText).toContain('public roadmap')
    expect(source!.getTranscript('cap-personal')).toBeNull()
    expect(source!.getTranscript('cap-low')).toBeNull()
    expect(source!.getTranscript('cap-orphan')).toBeNull()
    expect(source!.getTranscript('unknown')).toBeNull()
  })

  it('filters search, actions, and decisions through the same boundary', () => {
    expect(source!.search('roadmap', { limit: 20 }).map((result) => result.captureId)).toEqual(
      expect.arrayContaining(['cap-good', 'cap-rescued-keep'])
    )
    expect(source!.search('roadmap', { limit: 20 }).map((result) => result.captureId)).not.toEqual(
      expect.arrayContaining(['cap-personal', 'cap-low', 'cap-orphan'])
    )
    expect(source!.actions({ limit: 20 }).map((action) => action.id)).toEqual(['act-good'])
    expect(source!.decisions({ limit: 20 }).map((decision) => decision.id)).toEqual(['dec-good'])
  })

  it('supports project and date filters without weakening eligibility', () => {
    expect(source!.recentMeetings({ project: 'Thor', from: '2026-08-26', to: '2026-08-26' })).toHaveLength(1)
    expect(source!.actions({ project: 'Thor', status: 'pending' }).map((action) => action.id)).toEqual(['act-good'])
  })

  it('enforces SQLite query-only mode even through an internal handle', () => {
    const internal = source as unknown as { db: Database.Database }
    expect(() => internal.db.prepare('DELETE FROM transcripts').run()).toThrow()
  })
})
