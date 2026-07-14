// @vitest-environment node

/**
 * BUG B — recordings.status self-heal.
 *
 * The transcription pipeline historically wrote only transcription_status (and the
 * transcript row), never recordings.status — which the meeting-detail badge reads.
 * A recording inserted with status='none' therefore kept showing "Not transcribed"
 * over a fully joined transcript. healRecordingStatusFromTranscripts() advances
 * status to 'complete' for exactly those rows and is idempotent.
 *
 * Runs against the REAL sql.js engine (temp-file backed) so the actual SQL —
 * including the `IS NOT` NULL-safe guards and the transcript EXISTS subquery — is
 * exercised, not a mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-bugb-status-heal-${process.pid}.sqlite`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => dbPath
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  healRecordingStatusFromTranscripts
} from '../database'

function seedRecording(id: string, status: string, opts: { deletedAt?: string | null } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, status, deleted_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, `${id}.wav`, '2026-07-01T17:00:00.000Z', status, opts.deletedAt ?? null]
  )
}

function seedTranscript(recordingId: string, fullText: string): void {
  run(
    `INSERT INTO transcripts (id, recording_id, full_text) VALUES (?, ?, ?)`,
    [`trans_${recordingId}`, recordingId, fullText]
  )
}

function statusOf(id: string): string | undefined {
  return queryOne<{ status: string }>('SELECT status FROM recordings WHERE id = ?', [id])?.status
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('healRecordingStatusFromTranscripts', () => {
  it('advances a drifted status to complete for a recording with a joined transcript', () => {
    seedRecording('rec-drift', 'none')
    seedTranscript('rec-drift', 'A full transcript body.')

    const healed = healRecordingStatusFromTranscripts()

    expect(healed).toBe(1)
    expect(statusOf('rec-drift')).toBe('complete')
  })

  it('is idempotent — a second run heals nothing', () => {
    seedRecording('rec-drift', 'none')
    seedTranscript('rec-drift', 'A full transcript body.')

    expect(healRecordingStatusFromTranscripts()).toBe(1)
    expect(healRecordingStatusFromTranscripts()).toBe(0)
    expect(statusOf('rec-drift')).toBe('complete')
  })

  it('never touches recordings without a transcript, or with an empty transcript', () => {
    seedRecording('rec-none', 'none') // no transcript
    seedRecording('rec-empty', 'none')
    seedTranscript('rec-empty', '   ') // whitespace-only full_text

    expect(healRecordingStatusFromTranscripts()).toBe(0)
    expect(statusOf('rec-none')).toBe('none')
    expect(statusOf('rec-empty')).toBe('none')
  })

  it('never resurrects a deleted recording (status deleted or deleted_at set)', () => {
    seedRecording('rec-deleted-status', 'deleted')
    seedTranscript('rec-deleted-status', 'Transcript for a deleted row.')
    seedRecording('rec-tombstoned', 'none', { deletedAt: '2026-07-02T00:00:00.000Z' })
    seedTranscript('rec-tombstoned', 'Transcript for a tombstoned row.')

    expect(healRecordingStatusFromTranscripts()).toBe(0)
    expect(statusOf('rec-deleted-status')).toBe('deleted')
    expect(statusOf('rec-tombstoned')).toBe('none')
  })

  it('leaves an already-complete row untouched (no double count)', () => {
    seedRecording('rec-done', 'complete')
    seedTranscript('rec-done', 'Already complete.')

    expect(healRecordingStatusFromTranscripts()).toBe(0)
    expect(statusOf('rec-done')).toBe('complete')
  })
})
