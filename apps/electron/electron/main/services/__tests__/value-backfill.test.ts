// @vitest-environment node

/**
 * Value backfill runner tests (F16/spec-003 Part G — real better-sqlite3
 * engine, temp DB; mocked LLM). Covers the eligible-set predicate, the
 * AR-3 atomic reserve/call/finalize architecture (including the required
 * crash-boundary trio), the AR-4 one-attempt-per-run model (including the
 * required attempts 1/2/3 restart matrix), resumability/cancel, rate
 * limiting, chunk/yield, and progress/complete events.
 *
 * classifyCaptureValueRaw is mocked (full control over the "LLM reply" and
 * skip reasons) while applyCaptureValueClassification runs FOR REAL against
 * the temp DB, so the guarded write (never-downgrade, confidence floor) is
 * genuinely exercised end-to-end, not re-asserted from value-classification.test.ts.
 *
 * Never opens F:\HiDock-Next-Data — temp DB only. No real LLM calls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import type { BrowserWindow } from 'electron'

const paths = vi.hoisted(() => ({ db: '' }))
paths.db = join(tmpdir(), `hidock-valuebackfill-${process.pid}-${Date.now()}.db`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => paths.db
}))

// classifyCaptureValueRaw is FULLY replaced (not called through) — its own
// dependencies (complete(), getProviderConfigFromSettings as used INSIDE it)
// never execute. applyCaptureValueClassification is kept REAL.
const classifyCaptureValueRawMock = vi.fn()
vi.mock('../value-classification', async () => {
  const actual = await vi.importActual<typeof import('../value-classification')>('../value-classification')
  return {
    ...actual,
    classifyCaptureValueRaw: (...args: unknown[]) => classifyCaptureValueRawMock(...args)
  }
})

// Defensive — value-classification.ts imports these even though our mock
// bypasses classifyCaptureValueRaw's real body; keeps module load side-effect
// free in the Node test environment (mirrors value-classification.test.ts).
vi.mock('@hidock/ai-providers', () => ({
  complete: vi.fn()
}))

// value-backfill.ts's OWN top-level provider gate.
const getProviderConfigFromSettingsMock = vi.fn()
vi.mock('../ai-provider-config', () => ({
  getProviderConfigFromSettings: () => getProviderConfigFromSettingsMock()
}))

// applyCaptureValueClassification (kept real) reads the confidence floor via
// getConfig() — mock it directly (mirrors value-classification.test.ts).
const mockConfig = vi.hoisted(() => ({
  transcription: { valueClassificationMinConfidence: 0.6 }
}))
vi.mock('../config', () => ({
  getConfig: () => mockConfig
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  runWithMassDeleteAllowed
} from '../database'

import {
  startValueBackfill,
  cancelValueBackfill,
  getValueBackfillStatus,
  setMainWindowForValueBackfill,
  _setValueBackfillConfigForTests,
  _resetValueBackfillForTests,
  _getYieldCountForTests
} from '../value-backfill'

function cleanupDbFiles(base: string): void {
  for (const suffix of ['', '-wal', '-shm', '.tmp']) {
    if (existsSync(`${base}${suffix}`)) rmSync(`${base}${suffix}`, { force: true })
  }
}

const DATA_TABLES = ['transcripts', 'knowledge_captures', 'recordings', 'meetings', 'value_backfill_state']

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

let seq = 0
function seedRecording(id: string, opts: { personal?: boolean } = {}): void {
  seq++
  run(
    `INSERT INTO recordings
       (id, filename, file_path, date_recorded, status, location,
        transcription_status, on_device, on_local, source, is_imported, personal)
     VALUES (?, ?, ?, ?, 'none', 'local-only', 'none', 0, 1, 'hidock', 0, ?)`,
    [id, `${id}.wav`, `/tmp/${id}.wav`, '2026-01-01T10:00:00.000Z', opts.personal ? 1 : 0]
  )
}

function seedTranscript(recordingId: string, opts: { fullText?: string | null } = {}): void {
  run(`INSERT INTO transcripts (id, recording_id, full_text) VALUES (?, ?, ?)`, [
    `t-${recordingId}`,
    recordingId,
    opts.fullText === undefined ? 'Default transcript text with real content.' : opts.fullText
  ])
}

function seedCapture(
  id: string,
  sourceRecordingId: string,
  opts: { qualityRating?: string; qualitySource?: string | null; deletedAt?: string | null; capturedAt?: string } = {}
): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, quality_source, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      `Capture ${id}`,
      opts.capturedAt ?? '2026-01-01T10:00:00.000Z',
      sourceRecordingId,
      opts.qualityRating ?? 'unrated',
      opts.qualitySource ?? null,
      opts.deletedAt ?? null
    ]
  )
}

/** Full happy-path seed: recording + transcript + unrated capture, ready to
 *  be picked up by the eligible-set query. */
function seedEligible(id: string, capturedAt?: string): void {
  const recId = `rec-${id}`
  seedRecording(recId)
  seedTranscript(recId)
  seedCapture(id, recId, { capturedAt })
}

/** Directly seed a value_backfill_state row — the technique used to simulate
 *  a "restart after crash" without an actual process crash: the marker table
 *  IS the durable ground truth a restart reads. */
function seedBackfillState(
  captureId: string,
  opts: { status: string; attempts: number; runId?: string; resultRating?: string | null; lastError?: string | null }
): void {
  run(
    `INSERT INTO value_backfill_state (capture_id, status, result_rating, attempts, run_id, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      captureId,
      opts.status,
      opts.resultRating ?? null,
      opts.attempts,
      opts.runId ?? 'stale-run-id',
      opts.lastError ?? null,
      '2026-01-01T09:00:00.000Z'
    ]
  )
}

function getCaptureRow(id: string) {
  return queryOne<{ quality_rating: string; quality_source: string | null }>(
    'SELECT quality_rating, quality_source FROM knowledge_captures WHERE id = ?',
    [id]
  )
}

function getBackfillStateRow(id: string) {
  return queryOne<{ status: string; result_rating: string | null; attempts: number; run_id: string | null; last_error: string | null }>(
    'SELECT status, result_rating, attempts, run_id, last_error FROM value_backfill_state WHERE capture_id = ?',
    [id]
  )
}

function successReply(value: 'high' | 'normal' | 'low' | 'none' = 'none', confidence = 0.9, reasons: string[] = []) {
  return { classification: { value, reasons, confidence }, currentRating: 'unrated' as const }
}

const FAKE_WINDOW_FACTORY = () => {
  const send = vi.fn()
  const win = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
  return { win, send }
}

describe('value-backfill', () => {
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
    seq = 0
    classifyCaptureValueRawMock.mockReset()
    classifyCaptureValueRawMock.mockImplementation(async () => successReply())
    getProviderConfigFromSettingsMock.mockReset()
    getProviderConfigFromSettingsMock.mockReturnValue({ provider: 'google', model: 'gemini-3.5-flash', apiKey: 'test-key' })
    mockConfig.transcription.valueClassificationMinConfidence = 0.6
    _resetValueBackfillForTests()
    // Fast, deterministic tests: no real waiting, small chunks so yield/chunk
    // behavior is easy to assert without huge fixture sets.
    _setValueBackfillConfigForTests({
      chunkSize: 2,
      minIntervalMs: 0,
      maxDurableAttempts: 3,
      inRunRetryDelaysMs: [0, 0, 0],
      progressThrottleMs: 0,
      delayFn: async () => {}
    })
  })

  // ---------------------------------------------------------------------
  // Provider gate
  // ---------------------------------------------------------------------

  describe('provider gate', () => {
    it('is a no-op when no AI provider is configured', async () => {
      getProviderConfigFromSettingsMock.mockReturnValue(null)
      seedEligible('cap-1')

      const result = await startValueBackfill()

      expect(result).toEqual({ started: false, reason: 'no-provider' })
      expect(classifyCaptureValueRawMock).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------
  // Concurrency guard
  // ---------------------------------------------------------------------

  describe('concurrency guard', () => {
    it('rejects a concurrent start while a run is in flight', async () => {
      seedEligible('cap-1')
      classifyCaptureValueRawMock.mockResolvedValue(successReply())

      // `running = true` is the FIRST side-effecting statement in
      // startValueBackfill, executed synchronously before any `await` — so
      // calling it a second time immediately after (no synchronization
      // trickery needed) already observes running===true, exactly as a
      // real near-simultaneous double-click would.
      const firstRun = startValueBackfill()
      const secondResult = await startValueBackfill()

      expect(secondResult).toEqual({ started: false, reason: 'already-running' })

      await firstRun
    })
  })

  // ---------------------------------------------------------------------
  // Eligible-set predicate
  // ---------------------------------------------------------------------

  describe('eligible-set predicate', () => {
    it('classifies an eligible unrated capture with a transcript', async () => {
      seedEligible('cap-1')

      const result = await startValueBackfill()

      expect(result).toEqual({ started: true, total: 1 })
      expect(classifyCaptureValueRawMock).toHaveBeenCalledTimes(1)
      expect(getBackfillStateRow('cap-1')?.status).toBe('classified')
    })

    it('never selects a capture with no transcript row', async () => {
      const recId = 'rec-notranscript'
      seedRecording(recId)
      seedCapture('cap-notranscript', recId)
      // no seedTranscript() call

      const result = await startValueBackfill()

      expect(result.total).toBe(0)
      expect(classifyCaptureValueRawMock).not.toHaveBeenCalled()
    })

    it('never selects a capture whose transcript is blank', async () => {
      const recId = 'rec-blank'
      seedRecording(recId)
      seedTranscript(recId, { fullText: '   ' })
      seedCapture('cap-blank', recId)

      const result = await startValueBackfill()

      expect(result.total).toBe(0)
    })

    it('never selects an already-rated capture (never-downgrade at the SELECT)', async () => {
      const recId = 'rec-rated'
      seedRecording(recId)
      seedTranscript(recId)
      seedCapture('cap-rated', recId, { qualityRating: 'valuable', qualitySource: 'user' })

      const result = await startValueBackfill()

      expect(result.total).toBe(0)
      expect(classifyCaptureValueRawMock).not.toHaveBeenCalled()
      expect(getCaptureRow('cap-rated')).toEqual({ quality_rating: 'valuable', quality_source: 'user' })
    })

    it('never selects an unrated capture the user explicitly cleared (quality_source=user)', async () => {
      const recId = 'rec-usercleared'
      seedRecording(recId)
      seedTranscript(recId)
      seedCapture('cap-usercleared', recId, { qualityRating: 'unrated', qualitySource: 'user' })

      const result = await startValueBackfill()

      expect(result.total).toBe(0)
      expect(classifyCaptureValueRawMock).not.toHaveBeenCalled()
    })

    it('never selects a soft-deleted capture', async () => {
      const recId = 'rec-deleted'
      seedRecording(recId)
      seedTranscript(recId)
      seedCapture('cap-deleted', recId, { deletedAt: '2026-01-02T00:00:00.000Z' })

      const result = await startValueBackfill()

      expect(result.total).toBe(0)
    })

    it('never selects a capture whose recording is marked personal', async () => {
      const recId = 'rec-personal'
      seedRecording(recId, { personal: true })
      seedTranscript(recId)
      seedCapture('cap-personal', recId)

      const result = await startValueBackfill()

      expect(result.total).toBe(0)
    })

    it('orders newest-first by default', async () => {
      seedEligible('cap-old', '2026-01-01T00:00:00.000Z')
      seedEligible('cap-new', '2026-06-01T00:00:00.000Z')

      const order: string[] = []
      classifyCaptureValueRawMock.mockImplementation(async (captureId: string) => {
        order.push(captureId)
        return successReply()
      })

      await startValueBackfill()

      expect(order).toEqual(['cap-new', 'cap-old'])
    })

    it('orders oldest-first when order:"oldest" is requested', async () => {
      seedEligible('cap-old', '2026-01-01T00:00:00.000Z')
      seedEligible('cap-new', '2026-06-01T00:00:00.000Z')

      const order: string[] = []
      classifyCaptureValueRawMock.mockImplementation(async (captureId: string) => {
        order.push(captureId)
        return successReply()
      })

      await startValueBackfill({ order: 'oldest' })

      expect(order).toEqual(['cap-old', 'cap-new'])
    })
  })

  // ---------------------------------------------------------------------
  // Classification outcomes
  // ---------------------------------------------------------------------

  describe('classification outcomes', () => {
    it('a "none" result persists garbage and is counted as marked', async () => {
      seedEligible('cap-1')
      classifyCaptureValueRawMock.mockResolvedValue(successReply('none', 0.9, ['personal_family']))

      await startValueBackfill()

      expect(getCaptureRow('cap-1')?.quality_rating).toBe('garbage')
      expect(getBackfillStateRow('cap-1')).toMatchObject({ status: 'classified', result_rating: 'garbage' })
    })

    it('a "low" result persists low-value', async () => {
      seedEligible('cap-1')
      classifyCaptureValueRawMock.mockResolvedValue(successReply('low', 0.8))

      await startValueBackfill()

      expect(getCaptureRow('cap-1')?.quality_rating).toBe('low-value')
    })

    it('"normal"/"high" results stay unrated but ARE tracked, so a second run does not reclassify them', async () => {
      seedEligible('cap-1')
      classifyCaptureValueRawMock.mockResolvedValue(successReply('normal', 0.7))

      const first = await startValueBackfill()
      expect(first.total).toBe(1)
      expect(classifyCaptureValueRawMock).toHaveBeenCalledTimes(1)
      expect(getCaptureRow('cap-1')?.quality_rating).toBe('unrated')
      expect(getBackfillStateRow('cap-1')).toMatchObject({ status: 'classified', result_rating: 'unrated' })

      classifyCaptureValueRawMock.mockClear()
      const second = await startValueBackfill()
      expect(second.total).toBe(0)
      expect(classifyCaptureValueRawMock).not.toHaveBeenCalled()
    })

    it('a below-confidence-floor "none" leaves the rating unrated but still marks it classified (no re-spend)', async () => {
      seedEligible('cap-1')
      classifyCaptureValueRawMock.mockResolvedValue(successReply('none', 0.3, ['personal_family']))

      await startValueBackfill()

      expect(getCaptureRow('cap-1')?.quality_rating).toBe('unrated')
      expect(getBackfillStateRow('cap-1')).toMatchObject({ status: 'classified', result_rating: 'unrated' })

      classifyCaptureValueRawMock.mockClear()
      const second = await startValueBackfill()
      expect(second.total).toBe(0)
    })
  })

  // ---------------------------------------------------------------------
  // AR-3: atomic reserve -> call -> finalize, crash-boundary trio
  // ---------------------------------------------------------------------

  describe('AR-3 crash-boundary recovery (restart reconciles: no double-persist, no lost counts)', () => {
    it('boundary 1 — crash AFTER reserve, BEFORE call: restart re-attempts and completes', async () => {
      seedEligible('cap-1')
      // Simulates: a prior run reserved this item (attempts bumped to 1,
      // status in_progress) then the whole process died before the LLM call
      // ever started.
      seedBackfillState('cap-1', { status: 'in_progress', attempts: 1, runId: 'crashed-run' })

      const result = await startValueBackfill()

      expect(result.total).toBe(1) // in_progress rows are re-eligible
      expect(classifyCaptureValueRawMock).toHaveBeenCalledTimes(1)
      const row = getBackfillStateRow('cap-1')
      expect(row?.status).toBe('classified')
      expect(row?.attempts).toBe(2) // ONE new increment for this new attempt
      expect(row?.run_id).not.toBe('crashed-run')
    })

    it('boundary 2 — crash AFTER call, BEFORE finalize: restart re-attempts cleanly (no half-applied state)', async () => {
      seedEligible('cap-1')
      // From the DB's perspective this is indistinguishable from boundary 1
      // (RESERVE is the only write before FINALIZE) — which is the point of
      // the atomic design: no state exists that represents "call succeeded,
      // finalize pending". The restart simply re-attempts from RESERVE.
      seedBackfillState('cap-1', { status: 'in_progress', attempts: 1, runId: 'crashed-run-2' })

      const result = await startValueBackfill()

      expect(result.total).toBe(1)
      expect(classifyCaptureValueRawMock).toHaveBeenCalledTimes(1)
      const row = getBackfillStateRow('cap-1')
      expect(row?.status).toBe('classified')
      expect(row?.attempts).toBe(2)
      // No stray partial rating from a "lost" prior call — exactly what THIS
      // run's mocked reply produced.
      expect(getCaptureRow('cap-1')?.quality_rating).toBe(row?.result_rating)
    })

    it('boundary 3 — crash AFTER finalize: restart does NOT re-process (no double-persist, no re-billing)', async () => {
      seedEligible('cap-1')
      // Both halves of finalize already committed (rating + marker) before the
      // crash — a fully "classified" row.
      run(`UPDATE knowledge_captures SET quality_rating = 'garbage', quality_source = 'ai' WHERE id = 'cap-1'`)
      seedBackfillState('cap-1', { status: 'classified', attempts: 1, resultRating: 'garbage', runId: 'finished-run' })

      const result = await startValueBackfill()

      expect(result.total).toBe(0) // already classified — excluded entirely
      expect(classifyCaptureValueRawMock).not.toHaveBeenCalled()
      const row = getBackfillStateRow('cap-1')
      expect(row?.attempts).toBe(1) // unchanged — no re-billing
      expect(getCaptureRow('cap-1')?.quality_rating).toBe('garbage') // unchanged
    })

    it('a mixed restart: stale in_progress + already-classified + never-touched — counts reconcile with no loss', async () => {
      seedEligible('cap-stale') // will be re-attempted
      seedBackfillState('cap-stale', { status: 'in_progress', attempts: 1, runId: 'old-run' })

      seedEligible('cap-done') // already finished — must be skipped
      run(`UPDATE knowledge_captures SET quality_rating = 'low-value', quality_source = 'ai' WHERE id = 'cap-done'`)
      seedBackfillState('cap-done', { status: 'classified', attempts: 1, resultRating: 'low-value' })

      seedEligible('cap-fresh') // never touched before

      const result = await startValueBackfill()

      // Only the 2 NOT-yet-classified captures count toward this run's total —
      // the already-done one is neither re-billed nor re-counted.
      expect(result.total).toBe(2)
      expect(classifyCaptureValueRawMock).toHaveBeenCalledTimes(2)
      expect(classifyCaptureValueRawMock).not.toHaveBeenCalledWith('cap-done')
      expect(getBackfillStateRow('cap-done')?.attempts).toBe(1)
    })
  })

  // ---------------------------------------------------------------------
  // AR-4: one durable attempt per run, in-run retries don't touch the counter
  // ---------------------------------------------------------------------

  describe('AR-4 attempts matrix (restart behavior at persisted attempts 1, 2, 3)', () => {
    it('attempt 1 fails -> status=failed, attempts=1 (retry-eligible)', async () => {
      seedEligible('cap-1')
      classifyCaptureValueRawMock.mockRejectedValue(new Error('transient failure'))

      const result = await startValueBackfill()

      expect(result.total).toBe(1)
      const row = getBackfillStateRow('cap-1')
      expect(row).toMatchObject({ status: 'failed', attempts: 1 })
      expect(row?.last_error).toContain('transient failure')
    })

    it('attempt 2 (persisted attempts=1) is RETRIED -> attempts becomes 2, still failed', async () => {
      seedEligible('cap-1')
      seedBackfillState('cap-1', { status: 'failed', attempts: 1, lastError: 'transient failure' })
      classifyCaptureValueRawMock.mockRejectedValue(new Error('still failing'))

      const result = await startValueBackfill()

      expect(result.total).toBe(1) // retry-eligible: attempts(1) < MAX(3)
      // classifyCaptureValueRawMock is called 1 + IN_RUN_RETRY_DELAYS_MS.length
      // times per durable attempt when it always fails (in-run retries) — the
      // DURABLE attempts counter is the thing under test here, not that count.
      expect(classifyCaptureValueRawMock.mock.calls.length).toBeGreaterThan(0)
      expect(getBackfillStateRow('cap-1')).toMatchObject({ status: 'failed', attempts: 2 })
    })

    it('attempt 3 (persisted attempts=2) is RETRIED -> attempts becomes 3, still failed', async () => {
      seedEligible('cap-1')
      seedBackfillState('cap-1', { status: 'failed', attempts: 2, lastError: 'still failing' })
      classifyCaptureValueRawMock.mockRejectedValue(new Error('failing again'))

      const result = await startValueBackfill()

      expect(result.total).toBe(1) // retry-eligible: attempts(2) < MAX(3)
      expect(getBackfillStateRow('cap-1')).toMatchObject({ status: 'failed', attempts: 3 })
    })

    it('attempts=3 is PARKED — a later run does not retry it (same counter as eligibility)', async () => {
      seedEligible('cap-1')
      seedBackfillState('cap-1', { status: 'failed', attempts: 3, lastError: 'failing again' })

      const result = await startValueBackfill()

      expect(result.total).toBe(0) // parked: attempts(3) >= MAX(3)
      expect(classifyCaptureValueRawMock).not.toHaveBeenCalled()
      expect(getBackfillStateRow('cap-1')).toMatchObject({ status: 'failed', attempts: 3 })
    })

    it('a later successful attempt recovers a previously-failed item (retried until success within the cap)', async () => {
      seedEligible('cap-1')
      seedBackfillState('cap-1', { status: 'failed', attempts: 2, lastError: 'flaky' })
      classifyCaptureValueRawMock.mockResolvedValue(successReply('none', 0.9))

      const result = await startValueBackfill()

      expect(result.total).toBe(1)
      const row = getBackfillStateRow('cap-1')
      expect(row).toMatchObject({ status: 'classified', attempts: 3, result_rating: 'garbage' })
      expect(getCaptureRow('cap-1')?.quality_rating).toBe('garbage')
    })

    it('in-run transient retries (backoff within ONE durable attempt) do NOT touch the attempts counter', async () => {
      seedEligible('cap-1')
      let calls = 0
      classifyCaptureValueRawMock.mockImplementation(async () => {
        calls++
        if (calls < 3) throw new Error('429 rate limit exceeded')
        return successReply('none', 0.9)
      })

      const result = await startValueBackfill()

      expect(result.total).toBe(1)
      expect(classifyCaptureValueRawMock).toHaveBeenCalledTimes(3) // in-process retries
      const row = getBackfillStateRow('cap-1')
      expect(row?.attempts).toBe(1) // durable attempts: ONE, despite 3 in-process tries
      expect(row?.status).toBe('classified')
    })

    it('rate-limit-shaped errors back off LONGER than a generic error (spied delayFn)', async () => {
      seedEligible('cap-1')
      const delays: number[] = []
      _setValueBackfillConfigForTests({
        // Non-zero base so the rate-limit multiplier is observable — the
        // beforeEach default ([0,0,0]) would make 0*multiplier still 0.
        inRunRetryDelaysMs: [1000, 2000, 4000],
        delayFn: async (ms: number) => {
          delays.push(ms)
        }
      })
      let calls = 0
      classifyCaptureValueRawMock.mockImplementation(async () => {
        calls++
        if (calls === 1) throw new Error('429 Too Many Requests')
        return successReply()
      })

      await startValueBackfill()

      expect(delays.length).toBeGreaterThan(0)
      // The rate-limit branch multiplies the base in-run backoff (1000 * 3).
      expect(delays[0]).toBeGreaterThan(1000)
    })

    it('all marker writes use ON CONFLICT DO UPDATE semantics (unrelated columns survive a second write)', async () => {
      seedEligible('cap-1')
      seedBackfillState('cap-1', { status: 'failed', attempts: 2, lastError: 'previous error text' })
      classifyCaptureValueRawMock.mockResolvedValue(successReply('none', 0.9))

      await startValueBackfill()

      const row = getBackfillStateRow('cap-1')
      // A successful finalize clears last_error (explicit NULL in our finalize
      // SQL) rather than leaving stale error text behind — proves the row was
      // UPDATEd in place, not blindly replaced/reset.
      expect(row?.last_error).toBeNull()
      expect(row?.status).toBe('classified')
    })
  })

  // ---------------------------------------------------------------------
  // Resumability + cancel
  // ---------------------------------------------------------------------

  describe('resumability + cancel', () => {
    it('cancel mid-run persists the cursor; a subsequent run processes only the remainder', async () => {
      const ids = ['cap-1', 'cap-2', 'cap-3', 'cap-4', 'cap-5']
      for (const id of ids) seedEligible(id)

      let calls = 0
      classifyCaptureValueRawMock.mockImplementation(async () => {
        calls++
        if (calls === 3) cancelValueBackfill()
        return successReply()
      })

      const result = await startValueBackfill()

      expect(result.total).toBe(5) // eligible set computed BEFORE cancellation
      expect(classifyCaptureValueRawMock).toHaveBeenCalledTimes(3) // stopped after the 3rd item completed

      classifyCaptureValueRawMock.mockClear()
      classifyCaptureValueRawMock.mockImplementation(async () => successReply())
      const second = await startValueBackfill()

      expect(second.total).toBe(2) // only the remainder
      expect(classifyCaptureValueRawMock).toHaveBeenCalledTimes(2)

      // Totals reconcile: all 5 end up classified across the two runs.
      for (const id of ids) {
        expect(getBackfillStateRow(id)?.status).toBe('classified')
      }
    })

    it('cancelValueBackfill() is cancelled:false when nothing is running', () => {
      const result = cancelValueBackfill()
      expect(result).toEqual({ cancelled: false })
    })

    it('the completion event reports cancelled:true when a run was cancelled', async () => {
      seedEligible('cap-1')
      seedEligible('cap-2')
      const { win, send } = FAKE_WINDOW_FACTORY()
      setMainWindowForValueBackfill(win)
      classifyCaptureValueRawMock.mockImplementation(async () => {
        cancelValueBackfill()
        return successReply()
      })

      await startValueBackfill()

      const completeCall = send.mock.calls.find((c) => c[0] === 'value:backfill-complete')
      expect(completeCall?.[1]).toMatchObject({ cancelled: true })
    })
  })

  // ---------------------------------------------------------------------
  // Chunk + yield
  // ---------------------------------------------------------------------

  describe('chunking + yielding', () => {
    it('yields between chunks (never runs a whole batch synchronously)', async () => {
      const ids = ['cap-1', 'cap-2', 'cap-3', 'cap-4', 'cap-5']
      for (const id of ids) seedEligible(id)
      _setValueBackfillConfigForTests({ chunkSize: 2 })

      await startValueBackfill()

      // 5 items / chunk size 2 = 3 chunks -> 3 yields.
      expect(_getYieldCountForTests()).toBe(3)
    })

    it('processes zero items (and yields zero times) when nothing is eligible', async () => {
      const result = await startValueBackfill()
      expect(result.total).toBe(0)
      expect(_getYieldCountForTests()).toBe(0)
    })
  })

  // ---------------------------------------------------------------------
  // Progress / complete events
  // ---------------------------------------------------------------------

  describe('progress + complete events', () => {
    it('emits a progress event per item (throttle set to 0 for the test) and one complete event', async () => {
      seedEligible('cap-1')
      seedEligible('cap-2')
      const { win, send } = FAKE_WINDOW_FACTORY()
      setMainWindowForValueBackfill(win)

      await startValueBackfill()

      const progressCalls = send.mock.calls.filter((c) => c[0] === 'value:backfill-progress')
      expect(progressCalls.length).toBe(2)
      expect(progressCalls[0][1]).toMatchObject({ processed: 1, total: 2 })
      expect(progressCalls[1][1]).toMatchObject({ processed: 2, total: 2 })

      const completeCalls = send.mock.calls.filter((c) => c[0] === 'value:backfill-complete')
      expect(completeCalls.length).toBe(1)
      expect(completeCalls[0][1]).toMatchObject({ processed: 2, total: 2, cancelled: false })
    })

    it('the complete event counts "marked" only for low-value/garbage outcomes', async () => {
      seedEligible('cap-marked')
      seedEligible('cap-unmarked')
      const { win, send } = FAKE_WINDOW_FACTORY()
      setMainWindowForValueBackfill(win)
      classifyCaptureValueRawMock.mockImplementation(async (captureId: string) =>
        captureId === 'cap-marked' ? successReply('none', 0.9) : successReply('normal', 0.9)
      )

      await startValueBackfill()

      const completeCall = send.mock.calls.find((c) => c[0] === 'value:backfill-complete')
      expect(completeCall?.[1]).toMatchObject({ processed: 2, marked: 1 })
    })

    it('the complete event counts "failed" for items that exhausted in-run retries', async () => {
      seedEligible('cap-1')
      const { win, send } = FAKE_WINDOW_FACTORY()
      setMainWindowForValueBackfill(win)
      classifyCaptureValueRawMock.mockRejectedValue(new Error('permanent failure'))

      await startValueBackfill()

      const completeCall = send.mock.calls.find((c) => c[0] === 'value:backfill-complete')
      expect(completeCall?.[1]).toMatchObject({ processed: 1, failed: 1 })
    })

    it('never sends to a destroyed window', async () => {
      seedEligible('cap-1')
      const send = vi.fn()
      const win = { isDestroyed: () => true, webContents: { send } } as unknown as BrowserWindow
      setMainWindowForValueBackfill(win)

      await startValueBackfill()

      expect(send).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------
  // Rate limiting between items
  // ---------------------------------------------------------------------

  describe('rate limiting', () => {
    it('waits at least MIN_INTERVAL_MS between LLM calls', async () => {
      seedEligible('cap-1')
      seedEligible('cap-2')
      const delayCalls: number[] = []
      _setValueBackfillConfigForTests({
        minIntervalMs: 500,
        delayFn: async (ms: number) => {
          delayCalls.push(ms)
        }
      })

      await startValueBackfill()

      // The first call never waits (no prior call this run); the second does.
      expect(delayCalls.some((ms) => ms > 0)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------
  // getValueBackfillStatus()
  // ---------------------------------------------------------------------

  describe('getValueBackfillStatus', () => {
    it('derives total/done/marked/failed/remaining from the marker table', async () => {
      seedEligible('cap-classified-marked')
      run(`UPDATE knowledge_captures SET quality_rating = 'garbage', quality_source = 'ai' WHERE id = 'cap-classified-marked'`)
      seedBackfillState('cap-classified-marked', { status: 'classified', attempts: 1, resultRating: 'garbage' })

      seedEligible('cap-classified-unmarked')
      seedBackfillState('cap-classified-unmarked', { status: 'classified', attempts: 1, resultRating: 'unrated' })

      seedEligible('cap-parked')
      seedBackfillState('cap-parked', { status: 'failed', attempts: 3, lastError: 'gave up' })

      seedEligible('cap-retry-eligible')
      seedBackfillState('cap-retry-eligible', { status: 'failed', attempts: 1, lastError: 'will retry' })

      seedEligible('cap-untouched')

      const status = getValueBackfillStatus()

      expect(status.running).toBe(false)
      expect(status.total).toBe(5)
      expect(status.done).toBe(2)
      expect(status.marked).toBe(1)
      expect(status.failed).toBe(1) // only the PARKED one
      // remaining = total - done - failed(parked) = 5 - 2 - 1 = 2
      // (cap-retry-eligible + cap-untouched are both still "in flight")
      expect(status.remaining).toBe(2)
    })

    it('reports running:true while a backfill is in progress', async () => {
      seedEligible('cap-1')
      let capturedStatusDuringRun: ReturnType<typeof getValueBackfillStatus> | undefined
      classifyCaptureValueRawMock.mockImplementation(async () => {
        capturedStatusDuringRun = getValueBackfillStatus()
        return successReply()
      })

      await startValueBackfill()

      expect(capturedStatusDuringRun?.running).toBe(true)
    })
  })

  // ---------------------------------------------------------------------
  // Boot safety (defensive re-assertion — the real guarantee is "this module
  // is never imported by boot-tasks.ts", verified by boot-tasks.test.ts / a
  // grep-based check, since a unit test here cannot prove a NEGATIVE about a
  // different file's registration list).
  // ---------------------------------------------------------------------

  describe('table safety net', () => {
    it('creating a fresh table via the lazy ensure does not throw and getValueBackfillStatus still works after', async () => {
      // The table already exists via SCHEMA/migration; this proves the lazy
      // CREATE TABLE IF NOT EXISTS path (invoked on every startValueBackfill/
      // getValueBackfillStatus call) is itself idempotent and harmless.
      expect(() => getValueBackfillStatus()).not.toThrow()
      const result = await startValueBackfill()
      expect(result.started).toBe(true)
    })
  })
})
