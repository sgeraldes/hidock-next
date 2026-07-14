// @vitest-environment node

/**
 * Content-based VALUE classification tests (F16 / spec-001).
 *
 * Two layers, per the spec's testing requirements:
 *  1. Pure (no DB, no network): parseValueClassification, mapValueToRating,
 *     and the injection/clamp cases.
 *  2. DB apply (real better-sqlite3 engine + temp DB, mocking ../file-storage
 *     getDatabasePath to a temp file — follows __tests__/recording-deletion.test.ts):
 *     applyCaptureValueClassification's never-downgrade/refresh matrix and
 *     persisted columns, plus the standalone classifyCaptureValue() re-classifier
 *     (LLM complete() mocked).
 *
 * Never opens F:\HiDock-Next-Data — temp/fixture DBs only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const paths = vi.hoisted(() => ({ db: '' }))
paths.db = join(tmpdir(), `hidock-valuetest-${process.pid}-${Date.now()}.db`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => paths.db
}))

// classifyCaptureValue's only network dependency — mocked so no real LLM call
// is ever made and the exact prompt string is inspectable.
const mockComplete = vi.fn()
vi.mock('@hidock/ai-providers', () => ({
  complete: (...args: unknown[]) => mockComplete(...args)
}))

// Avoids pulling in ../config (and transitively `electron`) through
// ../ai-provider-config; lets tests control "no provider configured" without
// touching real config.ts.
const mockGetProviderConfig = vi.fn()
vi.mock('../ai-provider-config', () => ({
  getProviderConfigFromSettings: () => mockGetProviderConfig()
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  runWithMassDeleteAllowed
} from '../database'

import {
  parseValueClassification,
  mapValueToRating,
  applyCaptureValueClassification,
  classifyCaptureValue,
  VALUE_REASON_TAGS
} from '../value-classification'

function cleanupDbFiles(base: string): void {
  for (const suffix of ['', '-wal', '-shm', '.tmp']) {
    if (existsSync(`${base}${suffix}`)) rmSync(`${base}${suffix}`, { force: true })
  }
}

const DATA_TABLES = ['transcripts', 'knowledge_captures', 'recordings', 'meetings']

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

function seedRecording(id: string, opts: { filename?: string } = {}): void {
  run(
    `INSERT INTO recordings
       (id, filename, file_path, date_recorded, status, location,
        transcription_status, on_device, on_local, source, is_imported, personal)
     VALUES (?, ?, ?, ?, 'none', 'local-only', 'none', 0, 1, 'hidock', 0, 0)`,
    [id, opts.filename ?? `${id}.wav`, `/tmp/${id}.wav`, '2026-01-01T10:00:00.000Z']
  )
}

function seedMeeting(id: string, subject: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)`, [
    id,
    subject,
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T11:00:00.000Z'
  ])
}

function seedTranscript(recordingId: string, opts: { fullText?: string | null; summary?: string | null } = {}): void {
  run(`INSERT INTO transcripts (id, recording_id, full_text, summary) VALUES (?, ?, ?, ?)`, [
    `t-${recordingId}`,
    recordingId,
    opts.fullText ?? 'Default transcript text.',
    opts.summary ?? null
  ])
}

function seedCapture(
  id: string,
  sourceRecordingId: string,
  opts: {
    meetingId?: string | null
    summary?: string | null
    qualityRating?: string | null
    qualitySource?: string | null
  } = {}
): void {
  run(
    `INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, meeting_id, quality_rating, quality_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      `Capture ${id}`,
      opts.summary ?? null,
      '2026-01-01T10:00:00.000Z',
      sourceRecordingId,
      opts.meetingId ?? null,
      opts.qualityRating ?? 'unrated',
      opts.qualitySource ?? null
    ]
  )
}

function getCaptureRow(id: string) {
  return queryOne<{
    quality_rating: string | null
    quality_confidence: number | null
    quality_assessed_at: string | null
    quality_reasons: string | null
    quality_source: string | null
  }>(
    'SELECT quality_rating, quality_confidence, quality_assessed_at, quality_reasons, quality_source FROM knowledge_captures WHERE id = ?',
    [id]
  )
}

// ===========================================================================
// Layer 1: pure functions — no DB, no network
// ===========================================================================

describe('parseValueClassification (pure)', () => {
  it('returns the safe default for undefined/null input', () => {
    expect(parseValueClassification(undefined)).toEqual({ value: 'normal', reasons: [], confidence: 0 })
    expect(parseValueClassification(null)).toEqual({ value: 'normal', reasons: [], confidence: 0 })
  })

  it('returns the safe default for an empty object', () => {
    expect(parseValueClassification({})).toEqual({ value: 'normal', reasons: [], confidence: 0 })
  })

  it('returns the safe default for garbage input and never throws', () => {
    expect(() => parseValueClassification({ value: 42, value_reasons: 'not-an-array', value_confidence: 'nope' } as any)).not.toThrow()
    const parsed = parseValueClassification({ value: 42, value_reasons: 'not-an-array', value_confidence: 'nope' } as any)
    expect(parsed).toEqual({ value: 'normal', reasons: [], confidence: 0 })
  })

  it.each(['high', 'normal', 'low', 'none'] as const)('accepts the valid enum value "%s"', (value) => {
    expect(parseValueClassification({ value }).value).toBe(value)
  })

  it('rejects an invalid value string and defaults to normal', () => {
    expect(parseValueClassification({ value: 'maybe' }).value).toBe('normal')
  })

  it('keeps only allowlisted reason tags and drops everything else (prompt-injection guard)', () => {
    const parsed = parseValueClassification({
      value: 'none',
      value_reasons: ['personal_family', 'injected_arbitrary_tag', 'background_ambient', '<script>alert(1)</script>', 123]
    } as any)
    expect(parsed.reasons).toEqual(['personal_family', 'background_ambient'])
  })

  it('accepts every tag in VALUE_REASON_TAGS', () => {
    const parsed = parseValueClassification({ value: 'none', value_reasons: [...VALUE_REASON_TAGS] })
    expect(parsed.reasons).toEqual([...VALUE_REASON_TAGS])
  })

  it('defaults reasons to [] when value_reasons is not an array', () => {
    expect(parseValueClassification({ value: 'low', value_reasons: 'personal_family' } as any).reasons).toEqual([])
    expect(parseValueClassification({ value: 'low', value_reasons: null } as any).reasons).toEqual([])
  })

  it('clamps confidence into [0,1]', () => {
    expect(parseValueClassification({ value_confidence: 1.5 }).confidence).toBe(1)
    expect(parseValueClassification({ value_confidence: -0.5 }).confidence).toBe(0)
    expect(parseValueClassification({ value_confidence: 0.42 }).confidence).toBe(0.42)
  })

  it('zeroes non-finite confidence (NaN/Infinity/non-numeric string)', () => {
    expect(parseValueClassification({ value_confidence: NaN }).confidence).toBe(0)
    expect(parseValueClassification({ value_confidence: Infinity }).confidence).toBe(0)
    expect(parseValueClassification({ value_confidence: 'not-a-number' } as any).confidence).toBe(0)
  })
})

describe('mapValueToRating (pure)', () => {
  it('maps "none" to garbage', () => {
    expect(mapValueToRating('none')).toBe('garbage')
  })

  it('maps "low" to low-value', () => {
    expect(mapValueToRating('low')).toBe('low-value')
  })

  it('never over-claims: "high" and "normal" map to null (no rating assigned)', () => {
    expect(mapValueToRating('high')).toBeNull()
    expect(mapValueToRating('normal')).toBeNull()
  })
})

// ===========================================================================
// Layer 2: DB apply — real better-sqlite3 engine, temp DB
// ===========================================================================

describe('applyCaptureValueClassification (real engine)', () => {
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

  it('classifies a Spanish cooking-chatter fixture as garbage with reasons persisted', () => {
    seedRecording('rec-cooking')
    seedCapture('cap-cooking', 'rec-cooking')

    const result = applyCaptureValueClassification('cap-cooking', {
      value: 'none',
      reasons: ['personal_family', 'background_ambient'],
      confidence: 0.92
    })

    expect(result).toEqual({ applied: true, rating: 'garbage' })
    const row = getCaptureRow('cap-cooking')
    expect(row?.quality_rating).toBe('garbage')
    expect(row?.quality_source).toBe('ai')
    expect(row?.quality_confidence).toBeCloseTo(0.92)
    expect(row?.quality_assessed_at).toBeTruthy()
    expect(JSON.parse(row!.quality_reasons!)).toEqual(['personal_family', 'background_ambient'])
  })

  it('classifies a greeting-only-no-show fixture as garbage with that reason tag', () => {
    seedRecording('rec-greeting')
    seedCapture('cap-greeting', 'rec-greeting')

    const result = applyCaptureValueClassification('cap-greeting', {
      value: 'none',
      reasons: ['greeting_only_no_show'],
      confidence: 0.8
    })

    expect(result.rating).toBe('garbage')
    const row = getCaptureRow('cap-greeting')
    expect(JSON.parse(row!.quality_reasons!)).toEqual(['greeting_only_no_show'])
  })

  it('classifies value=low as low-value', () => {
    seedRecording('rec-low')
    seedCapture('cap-low', 'rec-low')

    const result = applyCaptureValueClassification('cap-low', { value: 'low', reasons: ['off_topic_chatter'], confidence: 0.5 })

    expect(result).toEqual({ applied: true, rating: 'low-value' })
    expect(getCaptureRow('cap-low')?.quality_rating).toBe('low-value')
  })

  it('leaves a real work-meeting fixture (value=normal|high) unrated', () => {
    seedRecording('rec-work')
    seedCapture('cap-work', 'rec-work')

    const result = applyCaptureValueClassification('cap-work', { value: 'normal', reasons: [], confidence: 0.7 })

    expect(result).toEqual({ applied: true, rating: 'unrated' })
    const row = getCaptureRow('cap-work')
    expect(row?.quality_rating).toBe('unrated')
    // AI still stamps source='ai' + assessed_at even when staying unrated
    // (design-review note 7 — harmless, makes re-analysis idempotent).
    expect(row?.quality_source).toBe('ai')
  })

  it('never-downgrade: a quality_source=user capture is untouched regardless of value', () => {
    seedRecording('rec-user')
    seedCapture('cap-user', 'rec-user', { qualityRating: 'valuable', qualitySource: 'user' })

    const result = applyCaptureValueClassification('cap-user', { value: 'none', reasons: ['personal_family'], confidence: 0.9 })

    expect(result.applied).toBe(false)
    const row = getCaptureRow('cap-user')
    expect(row?.quality_rating).toBe('valuable')
    expect(row?.quality_source).toBe('user')
    expect(row?.quality_reasons).toBeNull()
  })

  it('never-downgrade: a legacy non-unrated rating with NULL quality_source is untouched', () => {
    seedRecording('rec-legacy')
    seedCapture('cap-legacy', 'rec-legacy', { qualityRating: 'archived', qualitySource: null })

    const result = applyCaptureValueClassification('cap-legacy', { value: 'none', reasons: [], confidence: 0.9 })

    expect(result.applied).toBe(false)
    const row = getCaptureRow('cap-legacy')
    expect(row?.quality_rating).toBe('archived')
    expect(row?.quality_source).toBeNull()
  })

  it('refresh: an AI-set garbage capture re-analyzed as high resets to unrated', () => {
    seedRecording('rec-refresh')
    seedCapture('cap-refresh', 'rec-refresh', { qualityRating: 'garbage', qualitySource: 'ai' })

    const result = applyCaptureValueClassification('cap-refresh', { value: 'high', reasons: [], confidence: 0.85 })

    expect(result).toEqual({ applied: true, rating: 'unrated' })
    expect(getCaptureRow('cap-refresh')?.quality_rating).toBe('unrated')
  })

  it('refresh: an AI-set low-value capture can be corrected to garbage', () => {
    seedRecording('rec-correct')
    seedCapture('cap-correct', 'rec-correct', { qualityRating: 'low-value', qualitySource: 'ai' })

    const result = applyCaptureValueClassification('cap-correct', { value: 'none', reasons: ['no_substance'], confidence: 0.6 })

    expect(result).toEqual({ applied: true, rating: 'garbage' })
  })

  it('is idempotent across repeated calls with the same classification', () => {
    seedRecording('rec-idem')
    seedCapture('cap-idem', 'rec-idem')

    const cls = { value: 'none' as const, reasons: ['personal_family'], confidence: 0.9 }
    const first = applyCaptureValueClassification('cap-idem', cls)
    const second = applyCaptureValueClassification('cap-idem', cls)

    expect(first.applied).toBe(true)
    expect(second.applied).toBe(true)
    expect(getCaptureRow('cap-idem')?.quality_rating).toBe('garbage')
  })

  it('is non-throwing and reports not-applied for a nonexistent capture id', () => {
    expect(() => applyCaptureValueClassification('does-not-exist', { value: 'none', reasons: [], confidence: 0.5 })).not.toThrow()
    const result = applyCaptureValueClassification('does-not-exist', { value: 'none', reasons: [], confidence: 0.5 })
    expect(result.applied).toBe(false)
    expect(result.rating).toBe('unrated')
  })
})

describe('classifyCaptureValue (standalone re-classifier, real engine + mocked complete())', () => {
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
    mockComplete.mockReset()
    mockGetProviderConfig.mockReset()
    mockGetProviderConfig.mockReturnValue({ provider: 'google', model: 'gemini-3.5-flash', apiKey: 'test-key' })
  })

  it('classifies an unrated capture WITH a transcript and persists the result', async () => {
    seedRecording('rec-1')
    seedTranscript('rec-1', { fullText: 'Reunión de trabajo sobre el presupuesto Q3.', summary: 'Budget discussion.' })
    seedCapture('cap-1', 'rec-1')
    mockComplete.mockResolvedValue(JSON.stringify({ value: 'none', value_reasons: ['personal_family'], value_confidence: 0.88 }))

    const result = await classifyCaptureValue('cap-1')

    expect(result.skipped).toBeUndefined()
    expect(result.changed).toBe(true)
    expect(result.value).toBe('none')
    expect(result.rating).toBe('garbage')
    expect(result.reasons).toEqual(['personal_family'])
    expect(result.confidence).toBeCloseTo(0.88)
    expect(mockComplete).toHaveBeenCalledTimes(1)
    expect(getCaptureRow('cap-1')?.quality_rating).toBe('garbage')
  })

  it('returns skipped=no-transcript when the capture has no transcript row', async () => {
    seedRecording('rec-2')
    seedCapture('cap-2', 'rec-2')
    // no seedTranscript() call — LEFT JOIN yields NULL full_text

    const result = await classifyCaptureValue('cap-2')

    expect(result.skipped).toBe('no-transcript')
    expect(result.changed).toBe(false)
    expect(mockComplete).not.toHaveBeenCalled()
    expect(getCaptureRow('cap-2')?.quality_rating).toBe('unrated')
  })

  it('returns skipped=no-transcript when the transcript full_text is blank', async () => {
    seedRecording('rec-2b')
    seedTranscript('rec-2b', { fullText: '   ' })
    seedCapture('cap-2b', 'rec-2b')

    const result = await classifyCaptureValue('cap-2b')

    expect(result.skipped).toBe('no-transcript')
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('returns skipped=no-transcript for a nonexistent capture id', async () => {
    const result = await classifyCaptureValue('does-not-exist')
    expect(result.skipped).toBe('no-transcript')
    expect(result.changed).toBe(false)
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('returns skipped=already-rated and leaves an already-rated capture untouched', async () => {
    seedRecording('rec-3')
    seedTranscript('rec-3', { fullText: 'Some real content here.' })
    seedCapture('cap-3', 'rec-3', { qualityRating: 'valuable', qualitySource: 'user' })

    const result = await classifyCaptureValue('cap-3')

    expect(result.skipped).toBe('already-rated')
    expect(result.changed).toBe(false)
    expect(mockComplete).not.toHaveBeenCalled()
    expect(getCaptureRow('cap-3')?.quality_rating).toBe('valuable')
  })

  it('returns skipped=already-rated for an unrated-but-user-sourced capture (stricter than the live path)', async () => {
    seedRecording('rec-3b')
    seedTranscript('rec-3b', { fullText: 'Some real content here.' })
    seedCapture('cap-3b', 'rec-3b', { qualityRating: 'unrated', qualitySource: 'user' })

    const result = await classifyCaptureValue('cap-3b')

    expect(result.skipped).toBe('already-rated')
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('returns skipped=already-rated for an AI-set rating (standalone never refreshes, unlike the live path)', async () => {
    seedRecording('rec-3c')
    seedTranscript('rec-3c', { fullText: 'Some real content here.' })
    seedCapture('cap-3c', 'rec-3c', { qualityRating: 'garbage', qualitySource: 'ai' })

    const result = await classifyCaptureValue('cap-3c')

    expect(result.skipped).toBe('already-rated')
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('returns skipped=no-provider when no AI provider is configured', async () => {
    seedRecording('rec-4')
    seedTranscript('rec-4', { fullText: 'Some real content here.' })
    seedCapture('cap-4', 'rec-4')
    mockGetProviderConfig.mockReturnValue(null)

    const result = await classifyCaptureValue('cap-4')

    expect(result.skipped).toBe('no-provider')
    expect(result.changed).toBe(false)
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('is non-throwing on a malformed LLM reply (defaults to normal, still stamps ai/unrated)', async () => {
    seedRecording('rec-5')
    seedTranscript('rec-5', { fullText: 'Some real content here.' })
    seedCapture('cap-5', 'rec-5')
    mockComplete.mockResolvedValue('this is not JSON at all')

    const result = await classifyCaptureValue('cap-5')

    expect(result.skipped).toBeUndefined()
    expect(result.value).toBe('normal')
    expect(result.rating).toBe('unrated')
    expect(getCaptureRow('cap-5')?.quality_source).toBe('ai')
  })

  it('propagates a complete() failure (network/rate-limit) rather than swallowing it', async () => {
    seedRecording('rec-6')
    seedTranscript('rec-6', { fullText: 'Some real content here.' })
    seedCapture('cap-6', 'rec-6')
    mockComplete.mockRejectedValue(new Error('rate limit exceeded'))

    await expect(classifyCaptureValue('cap-6')).rejects.toThrow('rate limit exceeded')
    // Unchanged — the failure happened before any DB write.
    expect(getCaptureRow('cap-6')?.quality_rating).toBe('unrated')
    expect(getCaptureRow('cap-6')?.quality_source).toBeNull()
  })

  it('includes the meeting subject and stored summary in the prompt when available', async () => {
    seedMeeting('m-1', 'Q3 Budget Sync')
    seedRecording('rec-7')
    seedTranscript('rec-7', { fullText: 'Discutimos el presupuesto.' })
    seedCapture('cap-7', 'rec-7', { meetingId: 'm-1', summary: 'The team reviewed the Q3 budget.' })
    mockComplete.mockResolvedValue(JSON.stringify({ value: 'high', value_reasons: [], value_confidence: 0.9 }))

    await classifyCaptureValue('cap-7')

    const prompt = mockComplete.mock.calls[0][0] as string
    expect(prompt).toContain('Q3 Budget Sync')
    expect(prompt).toContain('The team reviewed the Q3 budget.')
  })

  it('truncates a very long transcript to a bounded head+tail excerpt', async () => {
    const head = 'HEAD_MARKER_' + 'a'.repeat(6000)
    const middle = 'MIDDLE_SHOULD_BE_DROPPED_' + 'b'.repeat(20000)
    const tail = 'c'.repeat(2000) + '_TAIL_MARKER'
    const longText = `${head}${middle}${tail}`

    seedRecording('rec-8')
    seedTranscript('rec-8', { fullText: longText })
    seedCapture('cap-8', 'rec-8')
    mockComplete.mockResolvedValue(JSON.stringify({ value: 'normal', value_reasons: [], value_confidence: 0.5 }))

    await classifyCaptureValue('cap-8')

    const prompt = mockComplete.mock.calls[0][0] as string
    expect(prompt).toContain('HEAD_MARKER_')
    expect(prompt).toContain('_TAIL_MARKER')
    expect(prompt).not.toContain('MIDDLE_SHOULD_BE_DROPPED')
    // Bounded regardless of how long the original transcript was.
    expect(prompt.length).toBeLessThan(longText.length)
  })

  it('does not truncate a short transcript', async () => {
    seedRecording('rec-9')
    seedTranscript('rec-9', { fullText: 'A short transcript.' })
    seedCapture('cap-9', 'rec-9')
    mockComplete.mockResolvedValue(JSON.stringify({ value: 'normal', value_reasons: [], value_confidence: 0.5 }))

    await classifyCaptureValue('cap-9')

    const prompt = mockComplete.mock.calls[0][0] as string
    expect(prompt).toContain('A short transcript.')
    expect(prompt).not.toContain('[...transcript truncated...]')
  })
})
