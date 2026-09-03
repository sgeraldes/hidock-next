import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eligibleCaptureIds } from './eligibility.js'
import { HidockRepository } from './repository.js'

let db: Database.Database
let repository: HidockRepository

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE recordings (id TEXT PRIMARY KEY, date_recorded TEXT, personal INTEGER, deleted_at TEXT);
    CREATE TABLE meetings (id TEXT PRIMARY KEY, subject TEXT, attendees TEXT);
    CREATE TABLE knowledge_captures (id TEXT PRIMARY KEY, title TEXT, user_title TEXT, summary TEXT,
      captured_at TEXT, source_recording_id TEXT, meeting_id TEXT, quality_rating TEXT, deleted_at TEXT);
    CREATE TABLE transcripts (id TEXT PRIMARY KEY, recording_id TEXT, full_text TEXT, summary TEXT,
      topics TEXT, key_points TEXT, speakers TEXT, mentioned_people TEXT);
    CREATE TABLE action_items (id TEXT PRIMARY KEY, knowledge_capture_id TEXT, content TEXT, assignee TEXT,
      due_date TEXT, priority TEXT, status TEXT, confidence REAL);
    CREATE TABLE decisions (id TEXT PRIMARY KEY, knowledge_capture_id TEXT, content TEXT, context TEXT,
      participants TEXT, confidence REAL, decided_at TEXT);
  `)
  const add = db.prepare(`INSERT INTO recordings VALUES (?, '2026-09-01T10:00:00Z', ?, ?)`)
  add.run('rec-ok', 0, null)
  add.run('rec-personal', 1, null)
  add.run('rec-deleted', 0, '2026-09-02')
  const capture = db.prepare(`INSERT INTO knowledge_captures VALUES (?, ?, NULL, ?, '2026-09-01', ?, NULL, ?, ?)`)
  capture.run('cap-ok', 'Thor stand-up', 'Discussed EVA2 and Data Kraken', 'rec-ok', 'valuable', null)
  capture.run('cap-personal', 'Private', 'secret', 'rec-personal', 'unrated', null)
  capture.run('cap-deleted-rec', 'Deleted recording', 'secret', 'rec-deleted', 'unrated', null)
  capture.run('cap-low', 'Low value', 'noise', null, 'low-value', null)
  capture.run('cap-soft-deleted', 'Deleted capture', 'secret', null, 'valuable', '2026-09-02')
  db.prepare(`INSERT INTO transcripts VALUES ('tx', 'rec-ok', 'We agreed the EVA2 dependency.', 'Summary', '["EVA2"]', '[]', '[]', '[]')`).run()
  db.prepare(`INSERT INTO action_items VALUES ('a1', 'cap-ok', 'Speak to Arifa', 'Kelly', NULL, 'high', 'pending', .9)`).run()
  db.prepare(`INSERT INTO decisions VALUES ('d1', 'cap-ok', 'Keep scope in Product', 'PO-to-PO', '["Kelly"]', .8, '2026-09-01')`).run()
  repository = new HidockRepository(db)
})

afterEach(() => db.close())

describe('privacy boundary', () => {
  it('only positively allows eligible captures', () => {
    expect([...eligibleCaptureIds(db, ['cap-ok', 'cap-personal', 'cap-deleted-rec', 'cap-low', 'cap-soft-deleted', 'missing'])]).toEqual(['cap-ok'])
  })

  it('fails closed if eligibility cannot be established', () => {
    db.exec('DROP TABLE recordings')
    expect(eligibleCaptureIds(db, ['cap-ok']).size).toBe(0)
  })
})

describe('repository', () => {
  it('searches eligible transcript content only', () => {
    expect(repository.search('EVA2')).toMatchObject([{ captureId: 'cap-ok' }])
    expect(repository.search('secret')).toEqual([])
  })

  it('returns transcripts, actions and decisions with provenance', () => {
    expect(repository.transcript('cap-ok')).toMatchObject({ transcript: 'We agreed the EVA2 dependency.' })
    expect(repository.actions()).toMatchObject([{ content: 'Speak to Arifa', sourceTitle: 'Thor stand-up' }])
    expect(repository.decisions()).toMatchObject([{ content: 'Keep scope in Product', participants: ['Kelly'] }])
  })

  it('refuses an ineligible transcript', () => {
    expect(() => repository.transcript('cap-personal')).toThrow(/not eligible/)
  })
})
