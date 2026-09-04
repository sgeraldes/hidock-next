/**
 * Tests for the WHOLE-BATCH transaction + durable Progress_Journal destructive
 * scoped re-ingestion run.
 *
 * hidock-graph-extraction-hardening — Task 6.10 (Req 4.9, 4.10).
 *
 * These exercise `runScopedReIngestionRemoval` (mode A, whole-batch
 * transaction) and `runJournaledReIngestionRemoval` (mode B, durable
 * Progress_Journal) against a REAL temp-file better-sqlite3 DB (the app's own
 * schema via initializeDatabase). They prove:
 *
 *   - HAPPY PATH: a whole-batch run removes graph provenance + scoped
 *     first-class rows + markers for every selected MARKED transcript;
 *     predicted (manifest deletionCountsByExtractedFrom) == actual; manual /
 *     migrated / NULL-sourced rows are preserved (reuses task 6.7 guarantees).
 *   - ATOMIC ROLLBACK (Req 4.10): a failure partway through the batch rolls the
 *     ENTIRE batch back — NO rows / markers change for ANY item (no silent
 *     mixed state).
 *   - GUARDS FIRE BEFORE MUTATION: a bad Scope_Digest throws ScopeChangedError
 *     and a bad selection throws InvalidReIngestionSelectionError, both with
 *     nothing deleted.
 *   - UNMARKED transcripts in the selection are reported separately and NOT
 *     destructively processed (their rows / markers untouched).
 *   - PROGRESS_JOURNAL: per-item atomicity (a mid-item failure leaves that item
 *     neither partially-removed nor journaled), resume returns exact
 *     completed/remaining, and re-running skips already-journaled items.
 *
 * Ids only anywhere — no transcript content in any assertion, log, or error.
 *
 * Harness mirrors graph-provenance-cleanup.test.ts / reingestion-scoped-
 * deletion.test.ts: mock electron/config/ai-providers/file-storage so a fresh
 * temp DB is minted per test; mock only complete() (the LLM call). No live DB
 * is opened; no batch is started.
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

// A per-recording poison hook for the atomic-rollback test: when a recording id
// is registered here, the wrapped `removeRecordingProvenance` throws for it.
// This lets us inject a failure PARTWAY THROUGH the batch while every other
// recording removes normally (delegates to the real implementation).
const _poisonRecordingIds = new Set<string>()
vi.mock('@hidock/knowledge-graph', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hidock/knowledge-graph')>()
  return {
    ...mod,
    removeRecordingProvenance: vi.fn((store: any, recordingId: string, opts: any) => {
      if (_poisonRecordingIds.has(recordingId)) {
        throw new Error(`injected removal failure for recording ${recordingId}`)
      }
      return (mod as any).removeRecordingProvenance(store, recordingId, opts)
    }),
  }
})

// file-storage — a fresh temp path for every getDatabasePath() call.
let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() =>
    join(tmpdir(), `hidock-reingest-batch-tx-${Date.now()}-${++_dbCounter}.sqlite`)
  ),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { complete } from '@hidock/ai-providers'
import { initializeDatabase, run as dbRun, queryAll as dbQueryAll, queryOne as dbQueryOne } from '../database'
import {
  ingestFromDbTranscripts,
  getKnowledgeGraphStore,
  discoverReIngestionScope,
  computeScopeDigest,
  runScopedReIngestionRemoval,
  runJournaledReIngestionRemoval,
  readReIngestionJournal,
  routeUnmarkedToIncrementalIngestion,
  unmarkedTranscriptsFrom,
  MarkedTranscriptRoutedToIncrementalError,
  ScopeChangedError,
  InvalidReIngestionSelectionError,
  type ReIngestionSelection,
} from '../knowledge-graph-service'

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString()

/** Extraction JSON with one decision + one action, all tagged work (survives
 *  the fail-closed item boundary), so ingest PROMOTES scoped first-class rows. */
function workExtractionJson(topic: string): string {
  return JSON.stringify({
    people: [{ name: 'Alice', skills: [], category: 'work' }],
    topics: [{ text: topic, category: 'work' }],
    projects: [],
    decisions: [{ text: `Decision about ${topic}`, category: 'work' }],
    action_items: [{ text: `Action about ${topic}`, owner: 'Alice', category: 'work' }],
    risks: [],
    next_steps: [],
  })
}

/** recording + transcript + knowledge_capture (promotion FK target). */
function seedRecording(topic: string): { recordingId: string; transcriptId: string; captureId: string } {
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
    `Transcript body about ${topic}.`,
    'en',
  ])
  dbRun(
    `INSERT INTO knowledge_captures (id, title, captured_at, created_at, updated_at, source_recording_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [captureId, 'Test capture', ts, ts, ts, recordingId]
  )
  return { recordingId, transcriptId, captureId }
}

function insertDecision(captureId: string, content: string, extractedFrom: string | null): void {
  const ts = now()
  dbRun(
    `INSERT INTO decisions (id, knowledge_capture_id, content, extracted_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), captureId, content, extractedFrom, ts, ts]
  )
}

function markerExists(transcriptId: string): boolean {
  return !!dbQueryOne<{ transcript_id: string }>(
    'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
    [transcriptId]
  )
}

function firstClassRowCount(captureId: string): number {
  const d =
    dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions WHERE knowledge_capture_id = ?', [captureId])[0]
      ?.n ?? 0
  const a =
    dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items WHERE knowledge_capture_id = ?', [
      captureId,
    ])[0]?.n ?? 0
  return d + a
}

function scopedRowCount(captureId: string, transcriptId: string): number {
  const from = `transcript:${transcriptId}`
  const d =
    dbQueryAll<{ n: number }>(
      'SELECT COUNT(*) AS n FROM decisions WHERE knowledge_capture_id = ? AND extracted_from = ?',
      [captureId, from]
    )[0]?.n ?? 0
  const a =
    dbQueryAll<{ n: number }>(
      'SELECT COUNT(*) AS n FROM action_items WHERE knowledge_capture_id = ? AND extracted_from = ?',
      [captureId, from]
    )[0]?.n ?? 0
  return d + a
}

function graphSourceRowCount(recordingId: string): number {
  return (
    dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM graph_edge_sources WHERE recording_id = ?', [
      recordingId,
    ])[0]?.n ?? 0
  )
}

function selectionOf(...pairs: Array<{ recordingId: string; transcriptId: string }>): ReIngestionSelection {
  return { pairs: pairs.map((p) => ({ recordingId: p.recordingId, transcriptId: p.transcriptId })) }
}

function digestFor(selection: ReIngestionSelection) {
  return computeScopeDigest(discoverReIngestionScope(selection))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.clearAllMocks()
  _poisonRecordingIds.clear()
  ;(complete as any).mockImplementation((prompt: string) => {
    // Return a work-only extraction keyed off the topic embedded in the prompt.
    const topic = /about ([A-Za-z0-9-]+)\./.exec(prompt)?.[1] ?? 'topic'
    return Promise.resolve(workExtractionJson(topic))
  })
  await initializeDatabase()
  getKnowledgeGraphStore() // ensure graph_ingested_transcripts exists
})

// ===========================================================================
// Mode A — whole-batch transaction
// ===========================================================================

describe('runScopedReIngestionRemoval (whole-batch transaction, Req 4.9/4.10)', () => {
  it('HAPPY PATH: removes graph provenance + scoped rows + markers for all marked transcripts; predicted == actual; preserves other-sourced rows', async () => {
    const r1 = seedRecording('alpha')
    const r2 = seedRecording('beta')

    const ingest = await ingestFromDbTranscripts()
    expect(ingest.ingested).toBe(2)

    // Add other-sourced rows on r1's capture that MUST be preserved (Req 4.7).
    insertDecision(r1.captureId, 'Manual decision', 'manual')
    insertDecision(r1.captureId, 'Migrated decision', 'migration:v11')
    insertDecision(r1.captureId, 'Null decision', null)

    // Sanity: markers + scoped rows + graph provenance exist pre-run.
    expect(markerExists(r1.transcriptId)).toBe(true)
    expect(markerExists(r2.transcriptId)).toBe(true)
    expect(scopedRowCount(r1.captureId, r1.transcriptId)).toBe(2) // 1 decision + 1 action
    expect(scopedRowCount(r2.captureId, r2.transcriptId)).toBe(2)
    expect(graphSourceRowCount(r1.recordingId)).toBeGreaterThan(0)
    expect(graphSourceRowCount(r2.recordingId)).toBeGreaterThan(0)

    const selection = selectionOf(r1, r2)
    const manifest = discoverReIngestionScope(selection)
    const predicted = manifest.deletionCountsByExtractedFrom
    const digest = computeScopeDigest(manifest)

    const result = runScopedReIngestionRemoval(selection, digest)

    // Both marked transcripts processed; none skipped as unmarked.
    expect(result.mode).toBe('whole-batch')
    expect(result.processed).toHaveLength(2)
    expect(result.skippedUnmarked).toEqual([])

    // predicted == actual (Req 4.8).
    expect(result.deletedByExtractedFrom).toEqual(predicted)
    expect(result.totals.total).toBe(4) // 2 per transcript

    // Markers cleared, scoped rows gone, graph provenance removed.
    expect(markerExists(r1.transcriptId)).toBe(false)
    expect(markerExists(r2.transcriptId)).toBe(false)
    expect(scopedRowCount(r1.captureId, r1.transcriptId)).toBe(0)
    expect(scopedRowCount(r2.captureId, r2.transcriptId)).toBe(0)
    expect(graphSourceRowCount(r1.recordingId)).toBe(0)
    expect(graphSourceRowCount(r2.recordingId)).toBe(0)

    // Other-sourced rows on r1's capture PRESERVED (3 remain).
    expect(firstClassRowCount(r1.captureId)).toBe(3)
  })

  it('ATOMIC ROLLBACK: a mid-batch failure rolls back the ENTIRE batch — no rows/markers changed for ANY item (Req 4.10)', async () => {
    const r1 = seedRecording('gamma')
    const r2 = seedRecording('delta')
    await ingestFromDbTranscripts()

    const before = {
      m1: markerExists(r1.transcriptId),
      m2: markerExists(r2.transcriptId),
      s1: scopedRowCount(r1.captureId, r1.transcriptId),
      s2: scopedRowCount(r2.captureId, r2.transcriptId),
      g1: graphSourceRowCount(r1.recordingId),
      g2: graphSourceRowCount(r2.recordingId),
    }
    expect(before).toEqual({ m1: true, m2: true, s1: 2, s2: 2, g1: before.g1, g2: before.g2 })
    expect(before.g1).toBeGreaterThan(0)
    expect(before.g2).toBeGreaterThan(0)

    // Poison the SECOND recording so its removal throws partway through.
    _poisonRecordingIds.add(r2.recordingId)

    const selection = selectionOf(r1, r2)
    const digest = digestFor(selection)

    expect(() => runScopedReIngestionRemoval(selection, digest)).toThrow(/injected removal failure/)

    // NOTHING changed for ANY item — the whole batch rolled back, including
    // r1's work that had already run before r2 threw.
    expect(markerExists(r1.transcriptId)).toBe(true)
    expect(markerExists(r2.transcriptId)).toBe(true)
    expect(scopedRowCount(r1.captureId, r1.transcriptId)).toBe(2)
    expect(scopedRowCount(r2.captureId, r2.transcriptId)).toBe(2)
    expect(graphSourceRowCount(r1.recordingId)).toBe(before.g1)
    expect(graphSourceRowCount(r2.recordingId)).toBe(before.g2)
  })

  it('GUARD: a mismatched Scope_Digest throws ScopeChangedError and deletes nothing', async () => {
    const r1 = seedRecording('epsilon')
    await ingestFromDbTranscripts()

    const selection = selectionOf(r1)

    expect(() => runScopedReIngestionRemoval(selection, { value: 'sha256:not-the-real-digest' })).toThrow(
      ScopeChangedError
    )

    // Untouched.
    expect(markerExists(r1.transcriptId)).toBe(true)
    expect(scopedRowCount(r1.captureId, r1.transcriptId)).toBe(2)
    expect(graphSourceRowCount(r1.recordingId)).toBeGreaterThan(0)
  })

  it('GUARD: an empty selection throws InvalidReIngestionSelectionError and deletes nothing', async () => {
    const r1 = seedRecording('zeta')
    await ingestFromDbTranscripts()

    const empty: ReIngestionSelection = { pairs: [] }
    // The digest is irrelevant — validation fails first.
    expect(() => runScopedReIngestionRemoval(empty, { value: 'sha256:whatever' })).toThrow(
      InvalidReIngestionSelectionError
    )

    expect(markerExists(r1.transcriptId)).toBe(true)
    expect(scopedRowCount(r1.captureId, r1.transcriptId)).toBe(2)
  })

  it('UNMARKED transcripts are reported separately and NOT destructively processed', async () => {
    const marked = seedRecording('eta')
    const unmarked = seedRecording('theta')
    // Only ingest `marked` (so it carries a marker + provenance). Give the
    // unmarked recording a scoped-labelled first-class row so we can prove it is
    // NOT deleted by the destructive path.
    await ingestFromDbTranscripts() // marks BOTH — so remove the unmarked one's marker.
    dbRun('DELETE FROM graph_ingested_transcripts WHERE transcript_id = ?', [unmarked.transcriptId])
    insertDecision(unmarked.captureId, 'Should survive', `transcript:${unmarked.transcriptId}`)

    expect(markerExists(marked.transcriptId)).toBe(true)
    expect(markerExists(unmarked.transcriptId)).toBe(false)

    const selection = selectionOf(marked, unmarked)
    const manifest = discoverReIngestionScope(selection)
    const digest = computeScopeDigest(manifest)

    const result = runScopedReIngestionRemoval(selection, digest)

    // Only the marked transcript was processed.
    expect(result.processed.map((p) => p.transcriptId)).toEqual([marked.transcriptId])
    expect(result.skippedUnmarked).toContain(unmarked.transcriptId)

    // The unmarked transcript's scoped rows are untouched: the 2 ingest-promoted
    // rows (1 decision + 1 action) PLUS the 1 manually inserted scoped decision.
    expect(scopedRowCount(unmarked.captureId, unmarked.transcriptId)).toBe(3)
    expect(markerExists(unmarked.transcriptId)).toBe(false)

    // The marked transcript was fully removed.
    expect(markerExists(marked.transcriptId)).toBe(false)
    expect(scopedRowCount(marked.captureId, marked.transcriptId)).toBe(0)
  })
})

// ===========================================================================
// Mode B — durable Progress_Journal
// ===========================================================================

describe('runJournaledReIngestionRemoval (durable Progress_Journal, Req 4.9/4.10)', () => {
  it('journals every completed item and returns exact completed/remaining', async () => {
    const r1 = seedRecording('iota')
    const r2 = seedRecording('kappa')
    await ingestFromDbTranscripts()

    const selection = selectionOf(r1, r2)
    const digest = digestFor(selection)
    const runId = `run-${randomUUID()}`

    const result = runJournaledReIngestionRemoval(runId, selection, digest)

    expect(result.mode).toBe('journaled')
    expect(result.completed.map((c) => c.transcriptId).sort()).toEqual(
      [r1.transcriptId, r2.transcriptId].sort()
    )
    expect(result.alreadyDone).toEqual([])
    expect(result.remaining).toEqual([])

    // Journal durably records both items.
    const journal = readReIngestionJournal(runId)
    expect(journal.map((e) => e.transcriptId).sort()).toEqual([r1.transcriptId, r2.transcriptId].sort())

    // Both fully removed.
    expect(markerExists(r1.transcriptId)).toBe(false)
    expect(markerExists(r2.transcriptId)).toBe(false)
    expect(scopedRowCount(r1.captureId, r1.transcriptId)).toBe(0)
    expect(scopedRowCount(r2.captureId, r2.transcriptId)).toBe(0)
  })

  it('PER-ITEM ATOMICITY: a mid-item failure leaves that item neither partially-removed nor journaled', async () => {
    const r1 = seedRecording('lambda')
    const r2 = seedRecording('mu')
    await ingestFromDbTranscripts()

    // Poison r2 so its per-item transaction throws.
    _poisonRecordingIds.add(r2.recordingId)

    const selection = selectionOf(r1, r2)
    const digest = digestFor(selection)
    const runId = `run-${randomUUID()}`

    expect(() => runJournaledReIngestionRemoval(runId, selection, digest)).toThrow(/injected removal failure/)

    // r1 completed + journaled atomically (its own committed transaction).
    expect(markerExists(r1.transcriptId)).toBe(false)
    expect(scopedRowCount(r1.captureId, r1.transcriptId)).toBe(0)

    // r2 is neither removed NOR journaled (its transaction rolled back).
    expect(markerExists(r2.transcriptId)).toBe(true)
    expect(scopedRowCount(r2.captureId, r2.transcriptId)).toBe(2)
    expect(graphSourceRowCount(r2.recordingId)).toBeGreaterThan(0)

    const journal = readReIngestionJournal(runId)
    expect(journal.map((e) => e.transcriptId)).toEqual([r1.transcriptId])
  })

  it('RESUME: re-running skips already-journaled items and completes only the remaining ones', async () => {
    const r1 = seedRecording('nu')
    const r2 = seedRecording('xi')
    await ingestFromDbTranscripts()

    const selection = selectionOf(r1, r2)
    const digest = digestFor(selection)
    const runId = `run-${randomUUID()}`

    // First invocation: poison r2 so only r1 completes + journals.
    _poisonRecordingIds.add(r2.recordingId)
    expect(() => runJournaledReIngestionRemoval(runId, selection, digest)).toThrow()
    expect(readReIngestionJournal(runId).map((e) => e.transcriptId)).toEqual([r1.transcriptId])

    // Un-poison and RESUME with the SAME runId. The scope digest must be
    // recomputed because r1's marker was cleared (scope drift is expected here),
    // so we recompute against the current state.
    _poisonRecordingIds.clear()
    const resumeDigest = digestFor(selection)
    const resume = runJournaledReIngestionRemoval(runId, selection, resumeDigest)

    // r1 already done (skipped), r2 completed this invocation.
    expect(resume.alreadyDone.map((p) => p.transcriptId)).toEqual([r1.transcriptId])
    expect(resume.completed.map((c) => c.transcriptId)).toEqual([r2.transcriptId])
    expect(resume.remaining).toEqual([])

    // Both now removed; journal holds both.
    expect(markerExists(r2.transcriptId)).toBe(false)
    expect(scopedRowCount(r2.captureId, r2.transcriptId)).toBe(0)
    expect(readReIngestionJournal(runId).map((e) => e.transcriptId).sort()).toEqual(
      [r1.transcriptId, r2.transcriptId].sort()
    )
  })

  it('RE-RUN is idempotent: running a fully-journaled run again skips everything', async () => {
    const r1 = seedRecording('omicron')
    await ingestFromDbTranscripts()

    const selection = selectionOf(r1)
    const runId = `run-${randomUUID()}`

    const first = runJournaledReIngestionRemoval(runId, selection, digestFor(selection))
    expect(first.completed).toHaveLength(1)

    // Re-run with the SAME runId (recompute digest against the now-removed state).
    const second = runJournaledReIngestionRemoval(runId, selection, digestFor(selection))
    // The journal is authoritative for "already completed" (independent of the
    // now-cleared marker), so the item is reported as alreadyDone and NOTHING is
    // re-processed. No new journal rows (INSERT OR IGNORE — no dup).
    expect(second.completed).toEqual([])
    expect(second.alreadyDone.map((p) => p.transcriptId)).toEqual([r1.transcriptId])
    // Journal still holds exactly the one original entry.
    expect(readReIngestionJournal(runId)).toHaveLength(1)
  })
})

// ===========================================================================
// Task 6.14 — route UNMARKED transcripts to INCREMENTAL ingestion (Req 4.12)
// ===========================================================================
//
// Req 4.12: an unmarked selected transcript is (a) reported SEPARATELY, (b)
// routed to INCREMENTAL (additive) ingestion, and (c) NEVER auto-added to the
// destructive manifest. The discovery manifest + destructive runs already
// prove (a) and (c); these tests prove (b) — and re-confirm (a)/(c) at the
// routing seam. Ids only; no transcript content asserted.

describe('routeUnmarkedToIncrementalIngestion (Task 6.14, Req 4.12)', () => {
  it('reports unmarked transcripts SEPARATELY and keeps them OUT of the destructive/marked manifest', () => {
    const marked = seedRecording('rho')
    const unmarked = seedRecording('sigma')
    // Mark only `marked` (simulate a prior ingest of just that one).
    dbRun(`INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)`, [
      marked.transcriptId,
      now(),
    ])

    const selection = selectionOf(marked, unmarked)
    const manifest = discoverReIngestionScope(selection)

    // (a) reported separately, (c) not in the marked/destructive scope.
    expect(manifest.unmarkedTranscripts).toEqual([unmarked.transcriptId])
    expect(manifest.markerState[unmarked.transcriptId]).toBe('unmarked')
    expect(manifest.markerState[marked.transcriptId]).toBe('marked')

    // A destructive run over the SAME selection reports the unmarked transcript
    // in `skippedUnmarked` and NEVER processes it destructively.
    const result = runScopedReIngestionRemoval(selection, computeScopeDigest(manifest))
    expect(result.skippedUnmarked).toEqual([unmarked.transcriptId])
    expect(result.processed.map((p) => p.transcriptId)).toEqual([marked.transcriptId])
    expect(result.processed.map((p) => p.transcriptId)).not.toContain(unmarked.transcriptId)

    // The projection helper reads the same separately-reported set from either shape.
    expect(unmarkedTranscriptsFrom(manifest)).toEqual([unmarked.transcriptId])
    expect(unmarkedTranscriptsFrom(result)).toEqual([unmarked.transcriptId])
  })

  it('ROUTES unmarked transcripts to the incremental (additive) path: they get ingested + marked, with NO pre-deletion', async () => {
    const unmarked = seedRecording('tau')
    // A pre-existing manual (other-sourced) row on the SAME capture that the
    // additive path must NOT delete (proves incremental != destructive).
    insertDecision(unmarked.captureId, 'Manual decision', 'manual')

    // The transcript is unmarked and has no scoped first-class rows yet.
    expect(markerExists(unmarked.transcriptId)).toBe(false)
    expect(scopedRowCount(unmarked.captureId, unmarked.transcriptId)).toBe(0)

    const selection = selectionOf(unmarked)
    const manifest = discoverReIngestionScope(selection)
    expect(manifest.unmarkedTranscripts).toEqual([unmarked.transcriptId])

    const routing = await routeUnmarkedToIncrementalIngestion(manifest)

    // Separately reported as routed, and an incremental (additive) pass ran.
    expect(routing.routedTranscriptIds).toEqual([unmarked.transcriptId])
    expect(routing.incremental).not.toBeNull()
    expect(routing.incremental!.ingested).toBeGreaterThanOrEqual(1)

    // Additive result: the transcript is now ingested + marked, and its scoped
    // first-class rows exist. The manual row is UNTOUCHED (no pre-deletion).
    expect(markerExists(unmarked.transcriptId)).toBe(true)
    expect(scopedRowCount(unmarked.captureId, unmarked.transcriptId)).toBe(2) // 1 decision + 1 action
    expect(
      dbQueryAll<{ n: number }>(
        'SELECT COUNT(*) AS n FROM decisions WHERE knowledge_capture_id = ? AND extracted_from = ?',
        [unmarked.captureId, 'manual']
      )[0]?.n ?? 0
    ).toBe(1)
  })

  it('is a NO-OP when there are no unmarked transcripts to route (no ingest pass runs)', async () => {
    const marked = seedRecording('upsilon')
    await ingestFromDbTranscripts() // marks it
    expect(markerExists(marked.transcriptId)).toBe(true)

    const manifest = discoverReIngestionScope(selectionOf(marked))
    expect(manifest.unmarkedTranscripts).toEqual([])

    const routing = await routeUnmarkedToIncrementalIngestion(manifest)
    expect(routing.routedTranscriptIds).toEqual([])
    // No unmarked ids → no incremental pass was run at all.
    expect(routing.incremental).toBeNull()
  })

  it('FAILS CLOSED: refuses to route a MARKED transcript to the incremental path (nothing ingested)', async () => {
    const marked = seedRecording('phi')
    await ingestFromDbTranscripts() // marks it + promotes its scoped rows
    const scopedBefore = scopedRowCount(marked.captureId, marked.transcriptId)
    expect(markerExists(marked.transcriptId)).toBe(true)

    // Hand the seam a source that (incorrectly) lists a MARKED transcript as
    // "unmarked". The guard must reject it BEFORE any ingest and change nothing.
    const spoofed = { unmarkedTranscripts: [marked.transcriptId] }

    await expect(routeUnmarkedToIncrementalIngestion(spoofed)).rejects.toBeInstanceOf(
      MarkedTranscriptRoutedToIncrementalError
    )
    // Nothing changed: marker + scoped rows exactly as before.
    expect(markerExists(marked.transcriptId)).toBe(true)
    expect(scopedRowCount(marked.captureId, marked.transcriptId)).toBe(scopedBefore)
  })
})
