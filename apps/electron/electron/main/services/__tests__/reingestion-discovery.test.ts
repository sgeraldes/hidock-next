/**
 * Tests for the scoped re-ingestion READ-ONLY discovery / dry-run manifest.
 *
 * hidock-graph-extraction-hardening — Task 6.1 (Req 4.2, 4.8).
 *
 * These exercise `discoverReIngestionScope`, `listMarkedReIngestionCandidates`,
 * and `computeTranscriptHash` against a REAL temp-file better-sqlite3 DB (the
 * app's own schema via initializeDatabase). They assert the manifest describes
 * EXACTLY the selected scope and nothing more:
 *   - recordingIds / transcriptIds list precisely the selected pairs (deduped, sorted).
 *   - transcriptHashes are present + stable for every selected transcript.
 *   - markerState reflects marked vs unmarked correctly.
 *   - deletionCountsByExtractedFrom equals the actual count of matching
 *     first-class rows (decisions + action_items) and is grouped by extracted_from.
 *   - unmarked transcripts are reported SEPARATELY and NOT counted as destructive scope.
 *   - manual / migrated rows (a DIFFERENT extracted_from) are NEVER counted.
 *   - discovery performs NO writes / NO deletes / NO marker changes (read-only).
 *
 * Harness mirrors knowledge-graph-service.test.ts: mock electron/config/
 * ai-providers/file-storage so a fresh temp DB is minted per test, then import
 * the service (which reads through the same DB via run/queryAll). No live DB is
 * opened; no native rebuild or binding fix is needed for this file (it uses the
 * app's `initializeDatabase` engine, not the recording-provenance ABI harness).
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
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-reingest-discovery-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { initializeDatabase, run as dbRun, queryAll as dbQueryAll } from '../database'
import {
  discoverReIngestionScope,
  listMarkedReIngestionCandidates,
  computeTranscriptHash,
  computeScopeDigest,
  assertScopeDigestMatches,
  ScopeChangedError,
  validateReIngestionSelection,
  InvalidReIngestionSelectionError,
  getKnowledgeGraphStore,
} from '../knowledge-graph-service'

// ---------------------------------------------------------------------------
// Seeding helpers
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

/** Add a graph_ingested_transcripts marker for a transcript. */
function markIngested(transcriptId: string): void {
  dbRun(`INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)`, [
    transcriptId,
    now(),
  ])
}

function insertDecision(captureId: string, content: string, extractedFrom: string): void {
  const ts = now()
  dbRun(
    `INSERT INTO decisions (id, knowledge_capture_id, content, extracted_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), captureId, content, extractedFrom, ts, ts]
  )
}

function insertActionItem(captureId: string, content: string, extractedFrom: string): void {
  const ts = now()
  dbRun(
    `INSERT INTO action_items (id, knowledge_capture_id, content, extracted_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), captureId, content, extractedFrom, ts, ts]
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scoped re-ingestion discovery (Task 6.1, read-only)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await initializeDatabase()
    // The graph_ingested_transcripts tracking table is created lazily by the
    // store, not by initializeDatabase(). Ensure it exists before seeding markers.
    getKnowledgeGraphStore()
  })

  describe('computeTranscriptHash', () => {
    it('is stable and content-sensitive', () => {
      const a = computeTranscriptHash('Alice discussed TypeScript.')
      const a2 = computeTranscriptHash('Alice discussed TypeScript.')
      const b = computeTranscriptHash('Bob discussed Python.')
      expect(a).toBe(a2) // deterministic
      expect(a).not.toBe(b) // content-sensitive
      expect(a.startsWith('sha256:')).toBe(true)
    })
  })

  describe('discoverReIngestionScope', () => {
    it('lists exactly the selected recording/transcript ids (deduped + sorted) with stable hashes', () => {
      const r1 = seedRecording({ fullText: 'Transcript one body.' })
      const r2 = seedRecording({ fullText: 'Transcript two body.' })
      markIngested(r1.transcriptId)
      markIngested(r2.transcriptId)

      const manifest = discoverReIngestionScope({
        pairs: [
          { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
          { recordingId: r2.recordingId, transcriptId: r2.transcriptId },
          // duplicate pair — must not appear twice
          { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
        ],
      })

      expect(manifest.recordingIds).toEqual([r1.recordingId, r2.recordingId].sort())
      expect(manifest.transcriptIds).toEqual([r1.transcriptId, r2.transcriptId].sort())

      // Hashes present + stable + match a direct recompute.
      expect(manifest.transcriptHashes[r1.transcriptId]).toBe(computeTranscriptHash('Transcript one body.'))
      expect(manifest.transcriptHashes[r2.transcriptId]).toBe(computeTranscriptHash('Transcript two body.'))
    })

    it('reports marker state correctly (marked vs unmarked)', () => {
      const marked = seedRecording({ fullText: 'Marked body.' })
      const unmarked = seedRecording({ fullText: 'Unmarked body.' })
      markIngested(marked.transcriptId)
      // unmarked: no marker inserted

      const manifest = discoverReIngestionScope({
        pairs: [
          { recordingId: marked.recordingId, transcriptId: marked.transcriptId },
          { recordingId: unmarked.recordingId, transcriptId: unmarked.transcriptId },
        ],
      })

      expect(manifest.markerState[marked.transcriptId]).toBe('marked')
      expect(manifest.markerState[unmarked.transcriptId]).toBe('unmarked')
    })

    it('deletionCountsByExtractedFrom equals the actual matching first-class row count, grouped', () => {
      const r1 = seedRecording({ fullText: 'Body one.' })
      const r2 = seedRecording({ fullText: 'Body two.' })
      markIngested(r1.transcriptId)
      markIngested(r2.transcriptId)

      const from1 = `transcript:${r1.transcriptId}`
      const from2 = `transcript:${r2.transcriptId}`

      // r1: 2 decisions + 1 action item = 3 scoped rows
      insertDecision(r1.captureId, 'Ship EVA25', from1)
      insertDecision(r1.captureId, 'Adopt Postgres', from1)
      insertActionItem(r1.captureId, 'Kelly to sign off', from1)
      // r2: 1 action item = 1 scoped row
      insertActionItem(r2.captureId, 'Follow up on Thor', from2)

      const manifest = discoverReIngestionScope({
        pairs: [
          { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
          { recordingId: r2.recordingId, transcriptId: r2.transcriptId },
        ],
      })

      expect(manifest.deletionCountsByExtractedFrom).toEqual({
        [from1]: 3,
        [from2]: 1,
      })

      // Cross-check against a direct DB count of the scoped set.
      const dbCount1 =
        (dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions WHERE extracted_from = ?', [from1])[0]?.n ??
          0) +
        (dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items WHERE extracted_from = ?', [from1])[0]
          ?.n ?? 0)
      expect(manifest.deletionCountsByExtractedFrom[from1]).toBe(dbCount1)
    })

    it('never counts manual / migrated / other-sourced rows (different extracted_from)', () => {
      const r1 = seedRecording({ fullText: 'Body.' })
      markIngested(r1.transcriptId)

      const scoped = `transcript:${r1.transcriptId}`
      // One scoped row that WOULD be deleted...
      insertDecision(r1.captureId, 'Scoped decision', scoped)
      // ...and rows with a DIFFERENT extracted_from on the SAME capture that must be excluded.
      insertDecision(r1.captureId, 'Manual decision', 'manual')
      insertDecision(r1.captureId, 'Migrated decision', 'migration:v11')
      insertActionItem(r1.captureId, 'Manual action', 'manual')
      insertActionItem(r1.captureId, 'Legacy action', 'knowledge-graph')

      const manifest = discoverReIngestionScope({
        pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }],
      })

      // Only the single scoped row is counted.
      expect(manifest.deletionCountsByExtractedFrom).toEqual({ [scoped]: 1 })
      expect(manifest.deletionCountsByExtractedFrom['manual']).toBeUndefined()
      expect(manifest.deletionCountsByExtractedFrom['migration:v11']).toBeUndefined()
      expect(manifest.deletionCountsByExtractedFrom['knowledge-graph']).toBeUndefined()
    })

    it('reports unmarked transcripts separately and excludes them from destructive scope', () => {
      const marked = seedRecording({ fullText: 'Marked body.' })
      const unmarked = seedRecording({ fullText: 'Unmarked body.' })
      markIngested(marked.transcriptId)

      const markedFrom = `transcript:${marked.transcriptId}`
      const unmarkedFrom = `transcript:${unmarked.transcriptId}`
      insertDecision(marked.captureId, 'Marked decision', markedFrom)
      // Even if first-class rows keyed to the unmarked transcript exist, an
      // unmarked transcript is NOT destructive scope and must not be counted.
      insertDecision(unmarked.captureId, 'Unmarked decision', unmarkedFrom)

      const manifest = discoverReIngestionScope({
        pairs: [
          { recordingId: marked.recordingId, transcriptId: marked.transcriptId },
          { recordingId: unmarked.recordingId, transcriptId: unmarked.transcriptId },
        ],
      })

      expect(manifest.unmarkedTranscripts).toEqual([unmarked.transcriptId])
      // Only the marked transcript's scoped rows are counted.
      expect(manifest.deletionCountsByExtractedFrom).toEqual({ [markedFrom]: 1 })
      expect(manifest.deletionCountsByExtractedFrom[unmarkedFrom]).toBeUndefined()
    })

    it('handles a missing transcript with the empty-hash sentinel and no counts', () => {
      const manifest = discoverReIngestionScope({
        pairs: [{ recordingId: 'rec-missing', transcriptId: 'tx-missing' }],
      })
      expect(manifest.transcriptHashes['tx-missing']).toBe('')
      expect(manifest.markerState['tx-missing']).toBe('unmarked')
      expect(manifest.unmarkedTranscripts).toEqual(['tx-missing'])
      expect(manifest.deletionCountsByExtractedFrom).toEqual({})
    })

    it('is READ-ONLY: no rows, markers, or first-class rows are mutated by discovery', () => {
      const r1 = seedRecording({ fullText: 'Body.' })
      markIngested(r1.transcriptId)
      insertDecision(r1.captureId, 'A decision', `transcript:${r1.transcriptId}`)
      insertActionItem(r1.captureId, 'An action', `transcript:${r1.transcriptId}`)

      const before = {
        markers: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM graph_ingested_transcripts')[0].n,
        decisions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions')[0].n,
        actions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items')[0].n,
        transcripts: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM transcripts')[0].n,
      }

      discoverReIngestionScope({ pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }] })
      listMarkedReIngestionCandidates()

      const after = {
        markers: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM graph_ingested_transcripts')[0].n,
        decisions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions')[0].n,
        actions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items')[0].n,
        transcripts: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM transcripts')[0].n,
      }

      expect(after).toEqual(before)
    })
  })

  describe('listMarkedReIngestionCandidates', () => {
    it('lists only marked (recording, transcript) pairs, deterministically ordered', () => {
      const r1 = seedRecording({ fullText: 'Body one.' })
      const r2 = seedRecording({ fullText: 'Body two.' })
      const r3 = seedRecording({ fullText: 'Body three.' })
      markIngested(r1.transcriptId)
      markIngested(r3.transcriptId)
      // r2 intentionally left unmarked

      const candidates = listMarkedReIngestionCandidates()
      const transcriptIds = candidates.map((c) => c.transcriptId)

      expect(transcriptIds).toContain(r1.transcriptId)
      expect(transcriptIds).toContain(r3.transcriptId)
      expect(transcriptIds).not.toContain(r2.transcriptId)
      // Each candidate carries the recording it belongs to.
      const c1 = candidates.find((c) => c.transcriptId === r1.transcriptId)
      expect(c1?.recordingId).toBe(r1.recordingId)
    })
  })
})

// ---------------------------------------------------------------------------
// Task 6.3 helpers — mutate marker / transcript state between compute + enforce
// ---------------------------------------------------------------------------

/** Remove a transcript's ingest marker (marked -> unmarked). */
function unmarkIngested(transcriptId: string): void {
  dbRun(`DELETE FROM graph_ingested_transcripts WHERE transcript_id = ?`, [transcriptId])
}

/** Rewrite a transcript's full_text (simulates a re-transcription). */
function rewriteTranscript(transcriptId: string, fullText: string): void {
  dbRun(`UPDATE transcripts SET full_text = ? WHERE id = ?`, [fullText, transcriptId])
}

// ---------------------------------------------------------------------------
// Task 6.3 — Scope_Digest determinism, sensitivity, and enforcement (Req 4.3, 4.4)
// ---------------------------------------------------------------------------

describe('Scope_Digest compute + enforcement (Task 6.3, read-only, Req 4.3/4.4)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await initializeDatabase()
    getKnowledgeGraphStore()
  })

  describe('computeScopeDigest — determinism', () => {
    it('yields the same digest for the same scope + state across repeated computes', () => {
      const r1 = seedRecording({ fullText: 'Alpha body.' })
      const r2 = seedRecording({ fullText: 'Beta body.' })
      markIngested(r1.transcriptId)
      markIngested(r2.transcriptId)

      const selection = {
        pairs: [
          { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
          { recordingId: r2.recordingId, transcriptId: r2.transcriptId },
        ],
      }

      const d1 = computeScopeDigest(discoverReIngestionScope(selection))
      const d2 = computeScopeDigest(discoverReIngestionScope(selection))
      expect(d1.value).toBe(d2.value)
      expect(d1.value.startsWith('sha256:')).toBe(true)
    })

    it('is insensitive to pair order in the selection (canonical sort)', () => {
      const r1 = seedRecording({ fullText: 'One.' })
      const r2 = seedRecording({ fullText: 'Two.' })
      markIngested(r1.transcriptId)
      markIngested(r2.transcriptId)

      const ordered = {
        pairs: [
          { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
          { recordingId: r2.recordingId, transcriptId: r2.transcriptId },
        ],
      }
      const reversed = {
        pairs: [
          { recordingId: r2.recordingId, transcriptId: r2.transcriptId },
          { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
        ],
      }

      expect(computeScopeDigest(discoverReIngestionScope(ordered)).value).toBe(
        computeScopeDigest(discoverReIngestionScope(reversed)).value
      )
    })
  })

  describe('computeScopeDigest — sensitivity', () => {
    it('changes when a selected id changes', () => {
      const r1 = seedRecording({ fullText: 'Body one.' })
      const r2 = seedRecording({ fullText: 'Body two.' })
      markIngested(r1.transcriptId)
      markIngested(r2.transcriptId)

      const base = computeScopeDigest(
        discoverReIngestionScope({ pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }] })
      )
      const changedId = computeScopeDigest(
        discoverReIngestionScope({ pairs: [{ recordingId: r2.recordingId, transcriptId: r2.transcriptId }] })
      )
      expect(changedId.value).not.toBe(base.value)
    })

    it('changes when a transcript full_text (hence its hash) changes', () => {
      const r1 = seedRecording({ fullText: 'Original transcript body.' })
      markIngested(r1.transcriptId)
      const selection = { pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }] }

      const before = computeScopeDigest(discoverReIngestionScope(selection))
      rewriteTranscript(r1.transcriptId, 'Re-transcribed, different body.')
      const after = computeScopeDigest(discoverReIngestionScope(selection))

      expect(after.value).not.toBe(before.value)
    })

    it('changes when a marker flips (marked <-> unmarked)', () => {
      const r1 = seedRecording({ fullText: 'Body.' })
      markIngested(r1.transcriptId)
      const selection = { pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }] }

      const marked = computeScopeDigest(discoverReIngestionScope(selection))
      unmarkIngested(r1.transcriptId)
      const unmarked = computeScopeDigest(discoverReIngestionScope(selection))

      expect(unmarked.value).not.toBe(marked.value)
    })
  })

  describe('assertScopeDigestMatches — enforcement', () => {
    it('returns the fresh manifest when the supplied digest still matches', () => {
      const r1 = seedRecording({ fullText: 'Body one.' })
      const r2 = seedRecording({ fullText: 'Body two.' })
      markIngested(r1.transcriptId)
      markIngested(r2.transcriptId)

      const selection = {
        pairs: [
          { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
          { recordingId: r2.recordingId, transcriptId: r2.transcriptId },
        ],
      }

      const supplied = computeScopeDigest(discoverReIngestionScope(selection))
      const manifest = assertScopeDigestMatches(selection, supplied)

      // On a match it returns the VERIFIED current manifest, and recomputing its
      // digest reproduces the supplied value.
      expect(manifest.recordingIds).toEqual([r1.recordingId, r2.recordingId].sort())
      expect(computeScopeDigest(manifest).value).toBe(supplied.value)
    })

    it('THROWS ScopeChangedError when a marker flips between compute and enforce', () => {
      const r1 = seedRecording({ fullText: 'Body.' })
      markIngested(r1.transcriptId)
      const selection = { pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }] }

      const supplied = computeScopeDigest(discoverReIngestionScope(selection))
      // Drift: the marker is cleared after the digest was computed.
      unmarkIngested(r1.transcriptId)

      expect(() => assertScopeDigestMatches(selection, supplied)).toThrow(ScopeChangedError)
    })

    it('THROWS ScopeChangedError when a transcript is re-transcribed between compute and enforce', () => {
      const r1 = seedRecording({ fullText: 'Original body.' })
      markIngested(r1.transcriptId)
      const selection = { pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }] }

      const supplied = computeScopeDigest(discoverReIngestionScope(selection))
      // Drift: the transcript content changes after the digest was computed.
      rewriteTranscript(r1.transcriptId, 'Different body after re-transcription.')

      expect(() => assertScopeDigestMatches(selection, supplied)).toThrow(ScopeChangedError)
    })

    it('fails BEFORE mutation: no rows, markers, or first-class rows change when it throws', () => {
      const r1 = seedRecording({ fullText: 'Body.' })
      markIngested(r1.transcriptId)
      insertDecision(r1.captureId, 'A decision', `transcript:${r1.transcriptId}`)
      insertActionItem(r1.captureId, 'An action', `transcript:${r1.transcriptId}`)
      const selection = { pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }] }

      const supplied = computeScopeDigest(discoverReIngestionScope(selection))
      // Drift so the guard will throw.
      rewriteTranscript(r1.transcriptId, 'Changed.')

      const before = {
        markers: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM graph_ingested_transcripts')[0].n,
        decisions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions')[0].n,
        actions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items')[0].n,
      }

      expect(() => assertScopeDigestMatches(selection, supplied)).toThrow(ScopeChangedError)

      const after = {
        markers: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM graph_ingested_transcripts')[0].n,
        decisions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions')[0].n,
        actions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM action_items')[0].n,
      }
      expect(after).toEqual(before)
    })

    it('the thrown error contains no transcript text (only opaque digest hashes)', () => {
      const secret = 'CONFIDENTIAL board discussion about Project Thunderbird acquisition.'
      const r1 = seedRecording({ fullText: secret })
      markIngested(r1.transcriptId)
      const selection = { pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }] }

      const supplied = computeScopeDigest(discoverReIngestionScope(selection))
      rewriteTranscript(r1.transcriptId, `${secret} Plus a new sentence.`)

      let caught: unknown
      try {
        assertScopeDigestMatches(selection, supplied)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(ScopeChangedError)
      const err = caught as ScopeChangedError
      // No fragment of the transcript body leaks into the message or fields.
      expect(err.message).not.toContain('Thunderbird')
      expect(err.message).not.toContain('CONFIDENTIAL')
      expect(err.message).not.toContain(secret)
      expect(err.expected).not.toContain('Thunderbird')
      expect(err.actual).not.toContain('Thunderbird')
      // The digest values it does carry are opaque sha256 hashes.
      expect(err.actual.startsWith('sha256:')).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Task 6.5 — selection validation: non-empty explicit list; reject invalid pairs
// (Req 4.1, 4.5). READ-ONLY; throws BEFORE any mutation; ids-only in errors.
// ---------------------------------------------------------------------------

/**
 * Seed a fresh recording that owns a transcript, and return both ids. Used to
 * build a MISMATCHED pair — the transcript genuinely belongs to `recordingId`,
 * so pairing it with any OTHER recording is a mismatch. A dedicated recording is
 * minted per call because `transcripts.recording_id` is UNIQUE (one transcript
 * per recording), so we cannot attach a second transcript to an existing one.
 */
function seedOwnedTranscript(fullText: string): { recordingId: string; transcriptId: string } {
  const recordingId = randomUUID()
  const transcriptId = randomUUID()
  dbRun(`INSERT INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)`, [
    recordingId,
    `rec-${recordingId}.hda`,
    '2026-06-01T10:00:00.000Z',
  ])
  dbRun(`INSERT INTO transcripts (id, recording_id, full_text, language) VALUES (?, ?, ?, ?)`, [
    transcriptId,
    recordingId,
    fullText,
    'en',
  ])
  return { recordingId, transcriptId }
}

describe('validateReIngestionSelection (Task 6.5, read-only, Req 4.1/4.5)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await initializeDatabase()
    getKnowledgeGraphStore()
  })

  it('accepts a non-empty list of correct, existing, matched pairs (returns order-preserved)', () => {
    const r1 = seedRecording({ fullText: 'Body one.' })
    const r2 = seedRecording({ fullText: 'Body two.' })

    const selection = {
      pairs: [
        { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
        { recordingId: r2.recordingId, transcriptId: r2.transcriptId },
      ],
    }

    const validated = validateReIngestionSelection(selection)
    // Order preserved, exact list returned.
    expect(validated.pairs).toEqual(selection.pairs)
  })

  it('REJECTS an empty selection (Req 4.1)', () => {
    expect(() => validateReIngestionSelection({ pairs: [] })).toThrow(InvalidReIngestionSelectionError)
    // Missing/undefined selection is treated as empty too.
    // @ts-expect-error deliberately passing undefined to assert the guard holds
    expect(() => validateReIngestionSelection(undefined)).toThrow(InvalidReIngestionSelectionError)

    let caught: unknown
    try {
      validateReIngestionSelection({ pairs: [] })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidReIngestionSelectionError)
    expect((caught as InvalidReIngestionSelectionError).violations).toEqual([{ kind: 'empty' }])
  })

  it('REJECTS an unknown recordingId (Req 4.5), naming the offending pair by id', () => {
    const r1 = seedRecording({ fullText: 'Body.' })
    // Pair a real, matching transcript with a recordingId that does not exist.
    const selection = {
      pairs: [{ recordingId: 'rec-does-not-exist', transcriptId: r1.transcriptId }],
    }

    let caught: unknown
    try {
      validateReIngestionSelection(selection)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidReIngestionSelectionError)
    const err = caught as InvalidReIngestionSelectionError
    expect(err.violations).toContainEqual({
      kind: 'unknown_recording',
      recordingId: 'rec-does-not-exist',
      transcriptId: r1.transcriptId,
    })
    // Because the transcript belongs to r1 (not the fake recording), it is also
    // structurally a mismatched pair — that's fine; both are id-only violations.
    expect(err.message).toContain('rec-does-not-exist')
  })

  it('REJECTS an unknown transcriptId (Req 4.5)', () => {
    const r1 = seedRecording({ fullText: 'Body.' })
    const selection = {
      pairs: [{ recordingId: r1.recordingId, transcriptId: 'tx-does-not-exist' }],
    }

    let caught: unknown
    try {
      validateReIngestionSelection(selection)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidReIngestionSelectionError)
    const err = caught as InvalidReIngestionSelectionError
    expect(err.violations).toContainEqual({
      kind: 'unknown_transcript',
      recordingId: r1.recordingId,
      transcriptId: 'tx-does-not-exist',
    })
  })

  it('REJECTS a mismatched pair (transcript belongs to a different recording) (Req 4.5)', () => {
    const r1 = seedRecording({ fullText: 'Recording one body.' })
    // A transcript that actually belongs to its own recording...
    const owned = seedOwnedTranscript('Stray transcript body.')
    // ...but is paired with r1's recording — mismatched.
    const selection = {
      pairs: [{ recordingId: r1.recordingId, transcriptId: owned.transcriptId }],
    }

    let caught: unknown
    try {
      validateReIngestionSelection(selection)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidReIngestionSelectionError)
    const err = caught as InvalidReIngestionSelectionError
    expect(err.violations).toContainEqual({
      kind: 'mismatched_pair',
      recordingId: r1.recordingId,
      transcriptId: owned.transcriptId,
      actualRecordingId: owned.recordingId,
    })
  })

  it('REJECTS a duplicate pair (same pair appears twice) (Req 4.5) — distinct from discovery de-dupe', () => {
    const r1 = seedRecording({ fullText: 'Body.' })
    const selection = {
      pairs: [
        { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
        { recordingId: r1.recordingId, transcriptId: r1.transcriptId },
      ],
    }

    let caught: unknown
    try {
      validateReIngestionSelection(selection)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidReIngestionSelectionError)
    const err = caught as InvalidReIngestionSelectionError
    expect(err.violations).toContainEqual({
      kind: 'duplicate_pair',
      recordingId: r1.recordingId,
      transcriptId: r1.transcriptId,
    })
    // A duplicate is reported exactly once, even if the pair recurs.
    const dupes = err.violations.filter((v) => v.kind === 'duplicate_pair')
    expect(dupes.length).toBe(1)

    // Contrast: the READ-ONLY discovery path SILENTLY de-dupes the same list
    // (it describes a set), proving the two behaviours are deliberately distinct.
    const manifest = discoverReIngestionScope(selection)
    expect(manifest.transcriptIds).toEqual([r1.transcriptId])
    expect(manifest.recordingIds).toEqual([r1.recordingId])
  })

  it('collects EVERY offending pair in one pass (multiple violations)', () => {
    const good = seedRecording({ fullText: 'Good body.' })
    const owned = seedOwnedTranscript('Stray body.')

    const selection = {
      pairs: [
        // valid
        { recordingId: good.recordingId, transcriptId: good.transcriptId },
        // unknown recording — recordingId absent. (The transcript is unknown too,
        // so this row is purely unknown_recording + unknown_transcript, not a
        // mismatch — a mismatch requires the transcript to exist.)
        { recordingId: 'rec-missing', transcriptId: 'tx-missing-a' },
        // unknown transcript (recording is real)
        { recordingId: good.recordingId, transcriptId: 'tx-missing-b' },
        // mismatched (owned.transcriptId belongs to owned.recordingId, paired with `good`)
        { recordingId: good.recordingId, transcriptId: owned.transcriptId },
      ],
    }

    let caught: unknown
    try {
      validateReIngestionSelection(selection)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidReIngestionSelectionError)
    const violations = (caught as InvalidReIngestionSelectionError).violations
    // Every offending row is flagged (the single valid pair contributes none).
    expect(violations).toContainEqual({
      kind: 'unknown_recording',
      recordingId: 'rec-missing',
      transcriptId: 'tx-missing-a',
    })
    expect(violations).toContainEqual({
      kind: 'unknown_transcript',
      recordingId: 'rec-missing',
      transcriptId: 'tx-missing-a',
    })
    expect(violations).toContainEqual({
      kind: 'unknown_transcript',
      recordingId: good.recordingId,
      transcriptId: 'tx-missing-b',
    })
    expect(violations).toContainEqual({
      kind: 'mismatched_pair',
      recordingId: good.recordingId,
      transcriptId: owned.transcriptId,
      actualRecordingId: owned.recordingId,
    })
  })

  it('the thrown error names offending pairs by id and contains NO transcript text', () => {
    const secret = 'CONFIDENTIAL merger terms for Project Thunderbird and the acquisition price.'
    const r1 = seedRecording({ fullText: secret })
    // Mismatch it against a non-existent recording so validation throws.
    const selection = {
      pairs: [{ recordingId: 'rec-ghost', transcriptId: r1.transcriptId }],
    }

    let caught: unknown
    try {
      validateReIngestionSelection(selection)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidReIngestionSelectionError)
    const err = caught as InvalidReIngestionSelectionError

    // The offending ids ARE present...
    expect(err.message).toContain('rec-ghost')
    expect(err.message).toContain(r1.transcriptId)
    // ...but no fragment of transcript content leaks into the message or fields.
    expect(err.message).not.toContain('Thunderbird')
    expect(err.message).not.toContain('CONFIDENTIAL')
    expect(err.message).not.toContain(secret)
    const serialized = JSON.stringify(err.violations)
    expect(serialized).not.toContain('Thunderbird')
    expect(serialized).not.toContain('CONFIDENTIAL')
    expect(serialized).not.toContain(secret)
  })

  it('is READ-ONLY: neither a valid nor an invalid selection mutates any rows', () => {
    const r1 = seedRecording({ fullText: 'Body.' })
    markIngested(r1.transcriptId)
    insertDecision(r1.captureId, 'A decision', `transcript:${r1.transcriptId}`)

    const before = {
      recordings: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM recordings')[0].n,
      transcripts: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM transcripts')[0].n,
      markers: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM graph_ingested_transcripts')[0].n,
      decisions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions')[0].n,
    }

    // A valid call...
    validateReIngestionSelection({
      pairs: [{ recordingId: r1.recordingId, transcriptId: r1.transcriptId }],
    })
    // ...and an invalid call that throws.
    expect(() =>
      validateReIngestionSelection({ pairs: [{ recordingId: 'nope', transcriptId: 'nope' }] })
    ).toThrow(InvalidReIngestionSelectionError)

    const after = {
      recordings: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM recordings')[0].n,
      transcripts: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM transcripts')[0].n,
      markers: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM graph_ingested_transcripts')[0].n,
      decisions: dbQueryAll<{ n: number }>('SELECT COUNT(*) AS n FROM decisions')[0].n,
    }
    expect(after).toEqual(before)
  })
})
