// @vitest-environment node

/**
 * setKnowledgeCaptureRatingByRecording tests (F16/spec-003 Part E — real
 * better-sqlite3 engine, temp DB). This is the write path behind
 * recordings:setValueRating: an EXPLICIT user action, so unlike
 * applyCaptureValueClassification it always applies — no never-downgrade
 * guard (the guard protects a user rating FROM the AI classifier, not the
 * other way around).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const paths = vi.hoisted(() => ({ db: '' }))
paths.db = join(tmpdir(), `hidock-setvaluerating-${process.pid}-${Date.now()}.db`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => paths.db
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  runWithMassDeleteAllowed,
  setKnowledgeCaptureRatingByRecording
} from '../database'

function cleanupDbFiles(base: string): void {
  for (const suffix of ['', '-wal', '-shm', '.tmp']) {
    if (existsSync(`${base}${suffix}`)) rmSync(`${base}${suffix}`, { force: true })
  }
}

const DATA_TABLES = ['transcripts', 'knowledge_captures', 'recordings']

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

function seedRecording(id: string): void {
  run(
    `INSERT INTO recordings
       (id, filename, file_path, date_recorded, status, location,
        transcription_status, on_device, on_local, source, is_imported, personal)
     VALUES (?, ?, ?, ?, 'none', 'local-only', 'none', 0, 1, 'hidock', 0, 0)`,
    [id, `${id}.wav`, `/tmp/${id}.wav`, '2026-01-01T10:00:00.000Z']
  )
}

function seedCapture(
  id: string,
  sourceRecordingId: string,
  opts: { qualityRating?: string; qualitySource?: string | null; qualityReasons?: string | null } = {}
): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, quality_source, quality_reasons)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      `Capture ${id}`,
      '2026-01-01T10:00:00.000Z',
      sourceRecordingId,
      opts.qualityRating ?? 'unrated',
      opts.qualitySource ?? null,
      opts.qualityReasons ?? null
    ]
  )
}

function getCaptureRow(id: string) {
  return queryOne<{
    quality_rating: string
    quality_confidence: number | null
    quality_assessed_at: string | null
    quality_source: string | null
    quality_reasons: string | null
  }>(
    'SELECT quality_rating, quality_confidence, quality_assessed_at, quality_source, quality_reasons FROM knowledge_captures WHERE id = ?',
    [id]
  )
}

describe('setKnowledgeCaptureRatingByRecording (real engine)', () => {
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

  it('sets the rating, full confidence, quality_source=user, and clears reasons', () => {
    seedRecording('rec-1')
    seedCapture('cap-1', 'rec-1', { qualityRating: 'unrated' })

    const result = setKnowledgeCaptureRatingByRecording('rec-1', 'low-value')

    expect(result).toEqual({ success: true, rating: 'low-value' })
    const row = getCaptureRow('cap-1')
    expect(row?.quality_rating).toBe('low-value')
    expect(row?.quality_confidence).toBeCloseTo(1.0)
    expect(row?.quality_assessed_at).toBeTruthy()
    expect(row?.quality_source).toBe('user')
    expect(row?.quality_reasons).toBeNull()
  })

  it('ALWAYS applies — no never-downgrade guard (explicit user action beats an AI rating)', () => {
    seedRecording('rec-2')
    seedCapture('cap-2', 'rec-2', {
      qualityRating: 'valuable',
      qualitySource: 'ai',
      qualityReasons: JSON.stringify(['no_substance'])
    })

    const result = setKnowledgeCaptureRatingByRecording('rec-2', 'garbage')

    expect(result).toEqual({ success: true, rating: 'garbage' })
    const row = getCaptureRow('cap-2')
    expect(row?.quality_rating).toBe('garbage')
    expect(row?.quality_source).toBe('user')
    expect(row?.quality_reasons).toBeNull()
  })

  it('overrides an existing user-set rating too (the user can change their own mind)', () => {
    seedRecording('rec-3')
    seedCapture('cap-3', 'rec-3', { qualityRating: 'garbage', qualitySource: 'user' })

    const result = setKnowledgeCaptureRatingByRecording('rec-3', 'valuable')

    expect(result.rating).toBe('valuable')
    expect(getCaptureRow('cap-3')?.quality_rating).toBe('valuable')
  })

  it('"Clear rating" (unrated) drops the reasons and stamps quality_source=user', () => {
    seedRecording('rec-4')
    seedCapture('cap-4', 'rec-4', {
      qualityRating: 'low-value',
      qualitySource: 'ai',
      qualityReasons: JSON.stringify(['background_ambient'])
    })

    const result = setKnowledgeCaptureRatingByRecording('rec-4', 'unrated')

    expect(result).toEqual({ success: true, rating: 'unrated' })
    const row = getCaptureRow('cap-4')
    expect(row?.quality_rating).toBe('unrated')
    expect(row?.quality_source).toBe('user')
    expect(row?.quality_reasons).toBeNull()
  })

  it('updates EVERY capture owned by the recording (multi-capture case)', () => {
    seedRecording('rec-multi')
    seedCapture('cap-multi-a', 'rec-multi')
    seedCapture('cap-multi-b', 'rec-multi')

    const result = setKnowledgeCaptureRatingByRecording('rec-multi', 'garbage')

    expect(result).toEqual({ success: true, rating: 'garbage' })
    expect(getCaptureRow('cap-multi-a')?.quality_rating).toBe('garbage')
    expect(getCaptureRow('cap-multi-b')?.quality_rating).toBe('garbage')
  })

  it('returns success:false when the recording has no knowledge_captures', () => {
    seedRecording('rec-empty')

    const result = setKnowledgeCaptureRatingByRecording('rec-empty', 'garbage')

    expect(result).toEqual({ success: false })
  })

  it('returns success:false for a nonexistent recording id', () => {
    const result = setKnowledgeCaptureRatingByRecording('does-not-exist', 'garbage')
    expect(result).toEqual({ success: false })
  })
})
