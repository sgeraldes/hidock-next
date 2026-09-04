/**
 * Tests for the SCOPED relational deletion primitive.
 *
 * hidock-graph-extraction-hardening — Task 6.7 (Req 4.6, 4.7).
 *
 * These exercise `deletePromotedRowsForTranscript`, `deletePromotedRowsForSelection`,
 * and `capturesForRecording` against a REAL temp-file better-sqlite3 DB (the
 * app's own schema via initializeDatabase). They prove the primitive deletes
 * EXACTLY the transcript-scoped set and nothing else:
 *   - only rows with knowledge_capture_id = <capture> AND
 *     extracted_from = 'transcript:<transcriptId>' are deleted (Req 4.6);
 *   - rows with extracted_from = 'manual' / 'migration:*' / 'knowledge-graph' /
 *     NULL on the SAME capture are PRESERVED (Req 4.7);
 *   - rows on a DIFFERENT capture / DIFFERENT transcript are PRESERVED;
 *   - the returned deleted-count equals the actual number of rows removed AND
 *     equals what discoverReIngestionScope's deletionCountsByExtractedFrom
 *     predicted for that transcript (predicted == actual);
 *   - deletion is scoped per-transcript even when a recording has MULTIPLE
 *     captures (two captures, distinct transcript labels, delete one transcript
 *     → only that transcript's rows go).
 *
 * Harness mirrors reingestion-discovery.test.ts: mock electron/config/
 * ai-providers/file-storage so a fresh temp DB is minted per test, then import
 * the service (which reads/writes through the same DB via run/queryAll). No live
 * DB is opened; no native rebuild or binding fix is needed for this file (it
 * uses the app's `initializeDatabase` engine, not the recording-provenance ABI
 * harness).
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    chat: { provider: 'gemini', geminiModel: 'gemini-2.0-flash', ollamaModel: '', maxContextChunks: 10 },
    transcription: { geminiApiKey: 'test-api-key', geminiModel: '' }, // pragma: allowlist secret
  })),
}))

vi.mock('@hidock/ai-providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hidock/ai-providers')>()
  return { ...mod, complete: vi.fn() }
})

// file-storage — return a fresh temp path for every getDatabasePath() call
let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-reingest-scoped-del-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { initializeDatabase, run as dbRun, queryAll as dbQueryAll } from '../database'
import {
  deletePromotedRowsForTranscript,
  deletePromotedRowsForSelection,
  capturesForRecording,
  discoverReIngestionScope,
  getKnowledgeGraphStore,
} from '../knowledge-graph-service'

// ---------------------------------------------------------------------------
// Seeding helpers (mirror reingestion-discovery.test.ts)
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString()

/** recording + transcript + knowledge_capture (the promotion FK target). */
function seedRecording(opts: { fullText: string }): {
  recordingId: string
  transcriptId: string
  captureId: string
} {
  const recordingId = randomUUID()
  const transcriptId = randomUUID()
  const captureId = randomUUID()
  const ts = now()
  dbRun(`INSERT INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)`, [
    recordingId,
    `rec-${recordingId}.hda`,
    '2026-06-01T10:00:00.000Z',
  ])
  dbRun(`INSERT INTO transcripts (id, recording_id, full_text, language) VALUES (?, ?, ?, ?)`, [
    transcriptId,
    recordingId,
    opts.fullText,
    'en',
  ])
  dbRun(
    `INSERT INTO knowledge_captures (id, title, captured_at, created_at, updated_at, source_recording_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [captureId, 'Test capture', ts, ts, ts, recordingId]
  )
  return { recordingId, transcriptId, captureId }
}

/** Add a second knowledge_capture for an existing recording (multi-capture case). */
function addCapture(recordingId: string, createdAt: string): string {
  const captureId = randomUUID()
  dbRun(
    `INSERT INTO knowledge_captures (id, title, captured_at, created_at, updated_at, source_recording_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [captureId, 'Extra capture', createdAt, createdAt, createdAt, recordingId]
  )
  return captureId
}

function markIngested(transcriptId: string): void {
  dbRun(`INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)`, [
    transcriptId,
    now(),
  ])
}

/** Insert a decision. `extractedFrom` = null inserts a NULL extracted_from row. */
function insertDecision(captureId: string, content: string, extractedFrom: string | null): void {
  const ts = now()
  dbRun(
    `INSERT INTO decisions (id, knowledge_capture_id, content, extracted_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), captureId, content, extractedFrom, ts, ts]
  )
}

function insertActionItem(captureId: string, content: string, extractedFrom: string | null): void {
  const ts = now()
  dbRun(
    `INSERT INTO action_items (id, knowledge_capture_id, content, extracted_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), captureId, content, extractedFrom, ts, ts]
  )
}

/** Count all decision + action_item rows on a capture (any extracted_from). */
function countRows(captureId: string): { decisions: number; actionItems: number } {
  return {
    decisions:
      dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions WHERE knowledge_capture_id = ?', [captureId])[0]
        ?.n ?? 0,
    actionItems:
      dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items WHERE knowledge_capture_id = ?', [
        captureId,
      ])[0]?.n ?? 0,
  }
}

/** All decision contents remaining on a capture. */
function decisionContents(captureId: string): string[] {
  return dbQueryAll<{ content: string }>(
    'SELECT content FROM decisions WHERE knowledge_capture_id = ? ORDER BY content',
    [captureId]
  ).map((r) => r.content)
}

function actionContents(captureId: string): string[] {
  return dbQueryAll<{ content: string }>(
    'SELECT content FROM action_items WHERE knowledge_capture_id = ? ORDER BY content',
    [captureId]
  ).map((r) => r.content)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scoped relational deletion (Task 6.7, Req 4.6/4.7)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await initializeDatabase()
    getKnowledgeGraphStore() // ensure graph_ingested_transcripts exists
  })

  it('deletes ONLY rows with the transcript label on the capture; preserves manual/migrated/knowledge-graph/NULL', () => {
    const r1 = seedRecording({ fullText: 'Body.' })
    const scoped = `transcript:${r1.transcriptId}`

    // Scoped rows (WILL be deleted): 2 decisions + 1 action.
    insertDecision(r1.captureId, 'Scoped decision A', scoped)
    insertDecision(r1.captureId, 'Scoped decision B', scoped)
    insertActionItem(r1.captureId, 'Scoped action', scoped)

    // Other-sourced rows on the SAME capture (MUST be preserved — Req 4.7).
    insertDecision(r1.captureId, 'Manual decision', 'manual')
    insertDecision(r1.captureId, 'Migrated decision', 'migration:v11')
    insertDecision(r1.captureId, 'Legacy graph decision', 'knowledge-graph')
    insertDecision(r1.captureId, 'Null-sourced decision', null)
    insertActionItem(r1.captureId, 'Manual action', 'manual')
    insertActionItem(r1.captureId, 'Null-sourced action', null)

    const res = deletePromotedRowsForTranscript(r1.recordingId, r1.transcriptId)

    // Deleted exactly the scoped set.
    expect(res.counts).toEqual({ decisions: 2, actionItems: 1, total: 3 })
    expect(res.deletedByExtractedFrom).toEqual({ [scoped]: 3 })
    expect(res.captureIds).toEqual([r1.captureId])

    // Preserved rows remain, in full, untouched.
    expect(decisionContents(r1.captureId)).toEqual(
      ['Legacy graph decision', 'Manual decision', 'Migrated decision', 'Null-sourced decision'].sort()
    )
    expect(actionContents(r1.captureId)).toEqual(['Manual action', 'Null-sourced action'].sort())

    // No scoped rows survive.
    expect(
      dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions WHERE extracted_from = ?', [scoped])[0]?.n
    ).toBe(0)
    expect(
      dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items WHERE extracted_from = ?', [scoped])[0]?.n
    ).toBe(0)
  })

  it('never touches rows on a DIFFERENT capture or a DIFFERENT transcript', () => {
    const r1 = seedRecording({ fullText: 'Body one.' })
    const r2 = seedRecording({ fullText: 'Body two.' })
    const from1 = `transcript:${r1.transcriptId}`
    const from2 = `transcript:${r2.transcriptId}`

    insertDecision(r1.captureId, 'R1 scoped', from1)
    insertDecision(r2.captureId, 'R2 scoped', from2)
    // A row on r1's capture labelled with r2's transcript (different transcript,
    // same capture) — must NOT be deleted when we delete r1's transcript.
    insertDecision(r1.captureId, 'R1 capture but r2 label', from2)

    const res = deletePromotedRowsForTranscript(r1.recordingId, r1.transcriptId)

    expect(res.counts.total).toBe(1)
    // r1's own scoped row gone.
    expect(decisionContents(r1.captureId)).toEqual(['R1 capture but r2 label'])
    // r2 capture entirely untouched.
    expect(countRows(r2.captureId)).toEqual({ decisions: 1, actionItems: 0 })
  })

  it('returned deleted-count equals actual removals AND matches the dry-run predicted count (predicted == actual)', () => {
    const r1 = seedRecording({ fullText: 'Body one.' })
    const r2 = seedRecording({ fullText: 'Body two.' })
    markIngested(r1.transcriptId)
    markIngested(r2.transcriptId)
    const from1 = `transcript:${r1.transcriptId}`
    const from2 = `transcript:${r2.transcriptId}`

    insertDecision(r1.captureId, 'D1', from1)
    insertDecision(r1.captureId, 'D2', from1)
    insertActionItem(r1.captureId, 'A1', from1)
    insertActionItem(r2.captureId, 'A2', from2)
    // Noise: preserved rows that must not affect counts.
    insertDecision(r1.captureId, 'manual', 'manual')

    const selection = {
      pairs: [
        { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
        { recordingId: r2.recordingId, transcriptId: r2.transcriptId },
      ],
    }

    // PREDICTED (pre-mutation, read-only preview).
    const predicted = discoverReIngestionScope(selection).deletionCountsByExtractedFrom
    expect(predicted).toEqual({ [from1]: 3, [from2]: 1 })

    // Count rows actually present in the scoped set before deleting.
    const beforeScoped =
      (dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions WHERE extracted_from IN (?, ?)', [
        from1,
        from2,
      ])[0]?.n ?? 0) +
      (dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items WHERE extracted_from IN (?, ?)', [
        from1,
        from2,
      ])[0]?.n ?? 0)

    // ACTUAL deletion.
    const batch = deletePromotedRowsForSelection(selection)

    // Predicted == actual, per label AND in total.
    expect(batch.deletedByExtractedFrom).toEqual(predicted)
    expect(batch.totals.total).toBe(beforeScoped)
    expect(batch.totals.total).toBe(4)

    // And every scoped row is now gone; the preserved manual row survives.
    expect(
      dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions WHERE extracted_from IN (?, ?)', [
        from1,
        from2,
      ])[0]?.n
    ).toBe(0)
    expect(countRows(r1.captureId)).toEqual({ decisions: 1, actionItems: 0 }) // just 'manual'
  })

  it('is scoped per-transcript even when a recording has MULTIPLE captures', () => {
    // One recording with TWO captures (schema allows many captures per recording
    // but only ONE transcript per recording — recordings.transcripts is 1:1). T1
    // is this recording's transcript, promoted under BOTH captures. A DIFFERENT
    // transcript (T2, on a different recording) also has rows on capture B.
    // Deleting T1 must remove only T1-labelled rows across BOTH of the
    // recording's captures; T2's rows and any other-sourced rows survive.
    const r1 = seedRecording({ fullText: 'Recording body.' }) // capture A = r1.captureId (created_at = now())
    // capture B created strictly AFTER capture A so `ORDER BY created_at, id`
    // deterministically yields [A, B]. (seedRecording stamps A with now().)
    const captureB = addCapture(r1.recordingId, '2999-01-01T00:00:00.000Z')
    const r2 = seedRecording({ fullText: 'Other recording body.' }) // provides a distinct transcript id

    const fromT1 = `transcript:${r1.transcriptId}`
    const fromT2 = `transcript:${r2.transcriptId}`

    // T1 promoted rows land on BOTH of r1's captures (exercises multi-capture deletion).
    insertDecision(r1.captureId, 'T1 on capture A', fromT1)
    insertActionItem(captureB, 'T1 on capture B', fromT1)
    // A DIFFERENT transcript's rows on capture B (must survive when deleting T1).
    insertDecision(captureB, 'T2 on capture B', fromT2)
    // Manual row on capture A (must survive).
    insertDecision(r1.captureId, 'Manual on capture A', 'manual')

    // capturesForRecording returns BOTH captures, deterministically ordered.
    const captures = capturesForRecording(r1.recordingId)
    expect(captures).toEqual([r1.captureId, captureB]) // created_at A < B

    const res = deletePromotedRowsForTranscript(r1.recordingId, r1.transcriptId)

    // Deleted both T1 rows (one per capture), nothing else.
    expect(res.counts).toEqual({ decisions: 1, actionItems: 1, total: 2 })
    expect(res.deletedByExtractedFrom).toEqual({ [fromT1]: 2 })
    expect(res.captureIds).toEqual([r1.captureId, captureB])

    // T2 row and manual row survive.
    expect(decisionContents(captureB)).toEqual(['T2 on capture B'])
    expect(decisionContents(r1.captureId)).toEqual(['Manual on capture A'])
    expect(
      dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items WHERE extracted_from = ?', [fromT1])[0]?.n
    ).toBe(0)
    // T2's rows are fully intact.
    expect(
      dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions WHERE extracted_from = ?', [fromT2])[0]?.n
    ).toBe(1)
  })

  it('dry-run preview sums scoped rows across ALL captures of a multi-capture recording (deterministic ordering, predicted == actual) — Task 6.12/Req 4.11', () => {
    // A recording with TWO captures whose transcript's promoted rows land on
    // BOTH captures. The read-only preview (discoverReIngestionScope) must count
    // rows across EVERY capture — resolved via the deterministic
    // `capturesForRecording` ordering — not a single arbitrarily-picked capture.
    // If discovery only inspected one capture, `predicted` would undercount and
    // the predicted == actual invariant (Req 4.8) would break for multi-capture
    // recordings.
    const r1 = seedRecording({ fullText: 'Recording body.' }) // capture A (created_at = now())
    const captureB = addCapture(r1.recordingId, '2999-01-01T00:00:00.000Z') // created strictly after A
    markIngested(r1.transcriptId)
    const scoped = `transcript:${r1.transcriptId}`

    // Scoped rows split across BOTH captures.
    insertDecision(r1.captureId, 'A: scoped decision', scoped)
    insertActionItem(r1.captureId, 'A: scoped action', scoped)
    insertDecision(captureB, 'B: scoped decision', scoped)
    // Other-sourced noise on each capture (must NOT be counted).
    insertDecision(r1.captureId, 'A: manual', 'manual')
    insertDecision(captureB, 'B: migrated', 'migration:v11')

    // Deterministic capture ordering is stable and repeated calls agree.
    expect(capturesForRecording(r1.recordingId)).toEqual([r1.captureId, captureB])
    expect(capturesForRecording(r1.recordingId)).toEqual(capturesForRecording(r1.recordingId))

    const selection = {
      pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }],
    }

    // PREDICTED (read-only) — must total 3 (2 on A + 1 on B), across all captures.
    const predicted = discoverReIngestionScope(selection).deletionCountsByExtractedFrom
    expect(predicted).toEqual({ [scoped]: 3 })

    // ACTUAL deletion equals the prediction, per label AND in total.
    const batch = deletePromotedRowsForSelection(selection)
    expect(batch.deletedByExtractedFrom).toEqual(predicted)
    expect(batch.totals.total).toBe(3)

    // Noise rows survive on both captures.
    expect(decisionContents(r1.captureId)).toEqual(['A: manual'])
    expect(decisionContents(captureB)).toEqual(['B: migrated'])
  })

  it('deleting a transcript with no promoted rows removes nothing and reports zero', () => {
    const r1 = seedRecording({ fullText: 'Body.' })
    insertDecision(r1.captureId, 'Manual only', 'manual')

    const res = deletePromotedRowsForTranscript(r1.recordingId, r1.transcriptId)

    expect(res.counts).toEqual({ decisions: 0, actionItems: 0, total: 0 })
    expect(res.deletedByExtractedFrom).toEqual({})
    expect(countRows(r1.captureId)).toEqual({ decisions: 1, actionItems: 0 })
  })

  it('batch de-duplicates repeated pairs so a transcript is deleted at most once', () => {
    const r1 = seedRecording({ fullText: 'Body.' })
    const scoped = `transcript:${r1.transcriptId}`
    insertDecision(r1.captureId, 'D', scoped)
    insertActionItem(r1.captureId, 'A', scoped)

    const batch = deletePromotedRowsForSelection({
      pairs: [
        { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
        { recordingId: r1.recordingId, transcriptId: r1.transcriptId }, // duplicate
      ],
    })

    expect(batch.perTranscript).toHaveLength(1)
    expect(batch.totals.total).toBe(2)
    expect(batch.deletedByExtractedFrom).toEqual({ [scoped]: 2 })
  })
})
