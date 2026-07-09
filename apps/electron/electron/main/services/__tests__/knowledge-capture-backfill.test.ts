// @vitest-environment node

/**
 * Knowledge-capture backfill / self-heal.
 *
 * Exercises the real sql.js engine (temp-file backed) so the capture creation is
 * tested against actual SQL: one capture per non-empty transcript, correct field
 * mapping from transcript+recording, two-way recording link, and full idempotency
 * (a second run creates nothing).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-kc-backfill-${process.pid}.sqlite`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => dbPath
}))

import { initializeDatabase, closeDatabase, run, queryOne } from '../database'
import {
  backfillKnowledgeCaptures,
  ensureKnowledgeCaptureForRecording
} from '../knowledge-capture-backfill'

function seedRecording(id: string, opts: { filename?: string; date?: string; meetingId?: string | null } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
    id,
    opts.filename ?? `${id}.wav`,
    opts.date ?? '2026-02-01T10:00:00.000Z',
    opts.meetingId ?? null
  ])
}

function seedMeeting(id: string): void {
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [
    id,
    'Sync',
    '2026-02-01T10:00:00.000Z',
    '2026-02-01T11:00:00.000Z'
  ])
}

function seedTranscript(
  recordingId: string,
  opts: { fullText?: string; summary?: string; title?: string } = {}
): void {
  run(
    `INSERT INTO transcripts (id, recording_id, full_text, summary, title_suggestion)
     VALUES (?, ?, ?, ?, ?)`,
    [
      `trans_${recordingId}`,
      recordingId,
      opts.fullText ?? 'hello world transcript body',
      opts.summary ?? null,
      opts.title ?? null
    ]
  )
}

function captureCount(): number {
  return queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM knowledge_captures')?.c ?? 0
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('backfillKnowledgeCaptures', () => {
  it('creates one capture per non-empty transcript, mapping fields from transcript+recording', () => {
    seedMeeting('m1')
    seedRecording('r1', { filename: 'rec1.wav', date: '2026-02-01T09:00:00.000Z', meetingId: 'm1' })
    seedTranscript('r1', { summary: 'a good summary', title: 'Quarterly Planning' })

    const result = backfillKnowledgeCaptures()
    expect(result).toEqual({ created: 1, existing: 0 })
    expect(captureCount()).toBe(1)

    const cap = queryOne<any>('SELECT * FROM knowledge_captures WHERE source_recording_id = ?', ['r1'])
    expect(cap.title).toBe('Quarterly Planning') // title_suggestion wins
    expect(cap.summary).toBe('a good summary')
    expect(cap.meeting_id).toBe('m1')
    expect(cap.captured_at).toBe('2026-02-01T09:00:00.000Z') // recording date
    expect(cap.category).toBe('meeting')
    expect(cap.status).toBe('ready')

    // Two-way link so updateKnowledgeCaptureTitle() (which reads migrated_to_capture_id) works.
    const rec = queryOne<any>('SELECT migrated_to_capture_id, migration_status FROM recordings WHERE id = ?', ['r1'])
    expect(rec.migrated_to_capture_id).toBe(cap.id)
    expect(rec.migration_status).toBe('migrated')
  })

  it('falls back to the recording filename when the transcript has no title', () => {
    seedRecording('r2', { filename: 'no-title.wav' })
    seedTranscript('r2')
    backfillKnowledgeCaptures()
    const cap = queryOne<any>('SELECT title FROM knowledge_captures WHERE source_recording_id = ?', ['r2'])
    expect(cap.title).toBe('no-title.wav')
  })

  it('skips transcripts whose full_text is empty', () => {
    seedRecording('r3')
    seedTranscript('r3', { fullText: '   ' })
    const result = backfillKnowledgeCaptures()
    expect(result.created).toBe(0)
    expect(captureCount()).toBe(0)
  })

  it('is idempotent — a second run creates nothing', () => {
    seedRecording('r1')
    seedRecording('r2')
    seedTranscript('r1')
    seedTranscript('r2')

    const first = backfillKnowledgeCaptures()
    expect(first.created).toBe(2)
    expect(captureCount()).toBe(2)

    const second = backfillKnowledgeCaptures()
    expect(second).toEqual({ created: 0, existing: 2 })
    expect(captureCount()).toBe(2) // no duplicates
  })
})

describe('ensureKnowledgeCaptureForRecording', () => {
  it('creates a capture for a transcribed recording and returns its id', () => {
    seedRecording('r1')
    seedTranscript('r1', { title: 'One' })
    const id = ensureKnowledgeCaptureForRecording('r1')
    expect(id).toBeTruthy()
    expect(captureCount()).toBe(1)
  })

  it('returns the existing capture id without creating a duplicate', () => {
    seedRecording('r1')
    seedTranscript('r1')
    const first = ensureKnowledgeCaptureForRecording('r1')
    const second = ensureKnowledgeCaptureForRecording('r1')
    expect(second).toBe(first)
    expect(captureCount()).toBe(1)
  })

  it('returns null when the recording has no transcript', () => {
    seedRecording('r-no-transcript')
    expect(ensureKnowledgeCaptureForRecording('r-no-transcript')).toBeNull()
    expect(captureCount()).toBe(0)
  })
})
