// @vitest-environment node

/**
 * Duration backfill + low-value classifier tests (real better-sqlite3 engine).
 *
 * Verifies the data-layer fix for the Library: recordings.duration_seconds is
 * NULL on the download/import paths, so DB/client sort+filter by duration
 * returns nothing. backfillRecordingDurations() populates it from the cheapest
 * reliable sources already in the DB (device-file cache + transcript timing),
 * and classifyLowValueCaptures() gives the "clean up junk" filter real data.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const paths = vi.hoisted(() => ({ db: '' }))
paths.db = join(tmpdir(), `hidock-durationtest-${process.pid}-${Date.now()}.db`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => paths.db
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  runWithMassDeleteAllowed,
  backfillRecordingDurations,
  classifyLowValueCaptures,
  maxTranscriptSegmentEnd
} from '../database'

function cleanupDbFiles(base: string): void {
  for (const suffix of ['', '-wal', '-shm', '.tmp']) {
    if (existsSync(`${base}${suffix}`)) rmSync(`${base}${suffix}`, { force: true })
  }
}

const DATA_TABLES = ['transcripts', 'device_files_cache', 'knowledge_captures', 'quality_assessments', 'recordings']

function wipeData(): void {
  runWithMassDeleteAllowed(() => {
    for (const table of DATA_TABLES) {
      try {
        run(`DELETE FROM ${table}`)
      } catch {
        /* ignore */
      }
    }
  })
}

function seedRecording(id: string, opts: { filename?: string; duration?: number | null; meeting_id?: string | null } = {}): void {
  run(
    `INSERT INTO recordings
       (id, filename, file_path, date_recorded, duration_seconds, meeting_id, status, location,
        transcription_status, on_device, on_local, source, is_imported, personal)
     VALUES (?, ?, ?, ?, ?, ?, 'none', 'local-only', 'none', 0, 1, 'hidock', 0, 0)`,
    [id, opts.filename ?? `${id}.wav`, `/tmp/${id}.wav`, '2026-01-01T10:00:00.000Z', opts.duration ?? null, opts.meeting_id ?? null]
  )
}

function seedDeviceCache(filename: string, duration: number): void {
  run(
    `INSERT INTO device_files_cache (id, filename, file_size, duration_seconds, date_recorded)
     VALUES (?, ?, ?, ?, ?)`,
    [`cache-${filename}`, filename, 1000, duration, '2026-01-01T10:00:00.000Z']
  )
}

function seedTranscript(recordingId: string, opts: { speakers?: string | null; wordCount?: number } = {}): void {
  run(
    `INSERT INTO transcripts (id, recording_id, full_text, speakers, word_count)
     VALUES (?, ?, ?, ?, ?)`,
    [`t-${recordingId}`, recordingId, 'text', opts.speakers ?? null, opts.wordCount ?? 0]
  )
}

function seedCapture(id: string, sourceRecordingId: string, meetingId: string | null = null): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, meeting_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, `Capture ${id}`, '2026-01-01T10:00:00.000Z', sourceRecordingId, meetingId]
  )
}

function durationOf(id: string): number | null {
  return queryOne<{ duration_seconds: number | null }>('SELECT duration_seconds FROM recordings WHERE id = ?', [id])?.duration_seconds ?? null
}

describe('maxTranscriptSegmentEnd', () => {
  it('returns 0 for null/empty/invalid input', () => {
    expect(maxTranscriptSegmentEnd(null)).toBe(0)
    expect(maxTranscriptSegmentEnd('')).toBe(0)
    expect(maxTranscriptSegmentEnd('not json')).toBe(0)
    expect(maxTranscriptSegmentEnd('{}')).toBe(0)
  })

  it('returns the largest segment end time', () => {
    const speakers = JSON.stringify([
      { speaker: 'A', start: 0, end: 12 },
      { speaker: 'B', start: 12, end: 40 },
      { speaker: 'A', start: 40, end: 40 } // final turn clamped to its start
    ])
    expect(maxTranscriptSegmentEnd(speakers)).toBe(40)
  })

  it('falls back to start when end is missing', () => {
    expect(maxTranscriptSegmentEnd(JSON.stringify([{ start: 33 }]))).toBe(33)
  })
})

describe('backfillRecordingDurations', () => {
  beforeAll(async () => {
    cleanupDbFiles(paths.db)
    await initializeDatabase()
  })

  afterAll(() => {
    try {
      closeDatabase()
    } catch {
      /* ignore */
    }
    cleanupDbFiles(paths.db)
  })

  beforeEach(() => {
    wipeData()
  })

  it('populates duration_seconds from the device-file cache (base-filename match)', () => {
    // Download stored the local .wav with NULL duration; the device cache knows
    // the .hda source's duration. Base-filename matching bridges the extension.
    seedRecording('rec-a', { filename: 'Rec59.wav', duration: null })
    seedDeviceCache('Rec59.hda', 132)

    const result = backfillRecordingDurations()

    expect(result.updated).toBe(1)
    expect(durationOf('rec-a')).toBe(132)
  })

  it('falls back to the transcript last-segment end when no cache exists', () => {
    seedRecording('rec-b', { duration: null })
    seedTranscript('rec-b', {
      speakers: JSON.stringify([
        { start: 0, end: 30 },
        { start: 30, end: 95 }
      ])
    })

    const result = backfillRecordingDurations()

    expect(result.updated).toBe(1)
    expect(durationOf('rec-b')).toBe(95)
  })

  it('is idempotent and never overwrites an existing duration', () => {
    seedRecording('rec-c', { filename: 'Keep.wav', duration: 500 })
    seedDeviceCache('Keep.hda', 132)

    const first = backfillRecordingDurations()
    expect(first.updated).toBe(0) // already has a duration
    expect(durationOf('rec-c')).toBe(500)

    // Row needing backfill; a second run only touches the still-NULL row.
    seedRecording('rec-d', { filename: 'New.wav', duration: null })
    seedDeviceCache('New.hda', 77)
    const second = backfillRecordingDurations()
    expect(second.updated).toBe(1)
    expect(durationOf('rec-d')).toBe(77)
  })

  it('enables duration sort/filter: after backfill the DB can order by duration', () => {
    seedRecording('short', { filename: 'Short.wav', duration: null })
    seedDeviceCache('Short.hda', 8)
    seedRecording('long', { filename: 'Long.wav', duration: null })
    seedDeviceCache('Long.hda', 600)

    // Before: both NULL — ordering/filtering by duration yields nothing usable.
    const before = queryAll<{ id: string }>(
      'SELECT id FROM recordings WHERE duration_seconds > 0 ORDER BY duration_seconds ASC'
    )
    expect(before.length).toBe(0)

    backfillRecordingDurations()

    // After: real values, so "< 1 min" filter and duration sort both work.
    const underOneMinute = queryAll<{ id: string }>(
      'SELECT id FROM recordings WHERE duration_seconds > 0 AND duration_seconds < 60'
    ).map((r) => r.id)
    expect(underOneMinute).toEqual(['short'])

    const sorted = queryAll<{ id: string }>(
      'SELECT id FROM recordings WHERE duration_seconds > 0 ORDER BY duration_seconds ASC'
    ).map((r) => r.id)
    expect(sorted).toEqual(['short', 'long'])
  })
})

describe('classifyLowValueCaptures', () => {
  beforeAll(async () => {
    cleanupDbFiles(paths.db)
    await initializeDatabase()
  })

  afterAll(() => {
    try {
      closeDatabase()
    } catch {
      /* ignore */
    }
    cleanupDbFiles(paths.db)
  })

  beforeEach(() => {
    wipeData()
  })

  it('marks a short, transcript-less, meeting-less capture as low-value', () => {
    seedRecording('junk', { duration: 6 })
    seedCapture('cap-junk', 'junk')

    const result = classifyLowValueCaptures()

    expect(result.markedLowValue).toBe(1)
    const q = queryOne<{ quality_rating: string }>('SELECT quality_rating FROM knowledge_captures WHERE id = ?', ['cap-junk'])
    expect(q?.quality_rating).toBe('low-value')
  })

  it('does NOT downgrade substantial or ambiguous captures', () => {
    // Long recording → keep unrated.
    seedRecording('long', { duration: 1800 })
    seedCapture('cap-long', 'long')
    // Short but with a real transcript → keep unrated.
    seedRecording('short-transcribed', { duration: 8 })
    seedTranscript('short-transcribed', { wordCount: 120 })
    seedCapture('cap-st', 'short-transcribed')
    // Short but linked to a meeting → keep unrated.
    run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', ['m1', 'Sync', '2026-01-01T10:00:00.000Z', '2026-01-01T11:00:00.000Z'])
    seedRecording('short-meeting', { duration: 8, meeting_id: 'm1' })
    seedCapture('cap-sm', 'short-meeting', 'm1')

    classifyLowValueCaptures()

    for (const id of ['cap-long', 'cap-st', 'cap-sm']) {
      const q = queryOne<{ quality_rating: string }>('SELECT quality_rating FROM knowledge_captures WHERE id = ?', [id])
      expect(q?.quality_rating).toBe('unrated')
    }
  })

  it('never overrides a user/AI-set rating and is idempotent', () => {
    seedRecording('junk', { duration: 6 })
    seedCapture('cap-junk', 'junk')
    run(`UPDATE knowledge_captures SET quality_rating = 'valuable' WHERE id = 'cap-junk'`)

    const result = classifyLowValueCaptures()
    expect(result.markedLowValue).toBe(0)
    const q = queryOne<{ quality_rating: string }>('SELECT quality_rating FROM knowledge_captures WHERE id = ?', ['cap-junk'])
    expect(q?.quality_rating).toBe('valuable')
  })
})
