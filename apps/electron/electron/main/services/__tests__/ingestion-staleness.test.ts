/**
 * hidock-graph-extraction-hardening Task 8.5 (Req 5.3) — staleness detection by
 * version/hash.
 *
 * Verifies that `isExtractionStale` / `findStaleMarkedTranscripts`:
 *  - report NOT stale for a run whose prompt_hash, schema_version,
 *    parser_version and transcript_hash all match the CURRENT generation;
 *  - report STALE with the CORRECT reason for each individual mismatch
 *    (prompt_hash | schema_version | parser_version | transcript_hash);
 *  - report STALE with reason `legacy` for a migration-synthesized sentinel row;
 *  - report STALE with reason `no_prior_run` when no ingestion_run exists;
 *  - compare against the SAME "current" descriptor a fresh live extraction would
 *    stamp (getCurrentExtractionProvenance), not a divergent constant;
 *  - are COMPARISON ONLY: they never delete, clear a marker, or mutate any row.
 *
 * Harness mirrors legacy-marker-migration.test.ts / ingestion-run-provenance.test.ts:
 * mock electron/config/file-storage so a fresh temp SQLite DB is minted per test,
 * then drive the real service exports against the app's real DB engine. No live
 * DB is opened; no native rebuild is needed (uses `initializeDatabase`, not the
 * recording-provenance ABI harness).
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    chat: { provider: 'ollama', ollamaModel: 'llama3.2', extractionOllamaModel: 'gemma3:12b', maxContextChunks: 10 },
    transcription: { geminiApiKey: '', geminiModel: '' }, // pragma: allowlist secret
  })),
}))

let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-ingestion-staleness-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

import { initializeDatabase, run as dbRun, queryAll as dbQueryAll, queryOne as dbQueryOne } from '../database'
import {
  isExtractionStale,
  findStaleMarkedTranscripts,
  recordIngestionRun,
  computeTranscriptHash,
  migrateLegacyIngestMarkers,
  getKnowledgeGraphStore,
  type IngestionRunInput,
} from '../knowledge-graph-service'
import { getCurrentExtractionProvenance } from '@hidock/knowledge-graph'

const CURRENT = getCurrentExtractionProvenance()
const TRANSCRIPT_TEXT = 'Alice and Bob discussed the Q3 roadmap and the payments migration.'
const now = () => new Date().toISOString()

/** recording + transcript pair; returns their ids and the CURRENT content hash. */
function seedTranscript(fullText = TRANSCRIPT_TEXT): {
  recordingId: string
  transcriptId: string
  transcriptHash: string
} {
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
  return { recordingId, transcriptId, transcriptHash: computeTranscriptHash(fullText) }
}

function seedLegacyMarker(transcriptId: string, ingestedAt: string): void {
  dbRun(`INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)`, [
    transcriptId,
    ingestedAt,
  ])
}

/** A run matching the CURRENT generation for a freshly seeded transcript. */
function currentRun(overrides: Partial<IngestionRunInput>): IngestionRunInput {
  return {
    transcriptId: 'unset',
    recordingId: 'unset',
    transcriptHash: computeTranscriptHash(TRANSCRIPT_TEXT),
    provider: 'ollama',
    model: 'gemma3:12b',
    promptVersion: CURRENT.promptVersion,
    promptHash: CURRENT.promptHash,
    schemaVersion: CURRENT.schemaVersion,
    parserVersion: CURRENT.parserVersion,
    startedAt: now(),
    completedAt: now(),
    status: 'success',
    acceptedEntityCount: 3,
    privacyFilteredCount: 0,
    ...overrides,
  }
}

function ingestionRunCount(): number {
  return dbQueryOne<{ n: number }>('SELECT COUNT(*) AS n FROM ingestion_run', [])?.n ?? 0
}
function markerCount(): number {
  return dbQueryOne<{ n: number }>('SELECT COUNT(*) AS n FROM graph_ingested_transcripts', [])?.n ?? 0
}

beforeEach(async () => {
  vi.clearAllMocks()
  await initializeDatabase()
  getKnowledgeGraphStore() // ensure tracking tables exist
  dbRun('DELETE FROM ingestion_run', [])
  dbRun('DELETE FROM graph_ingested_transcripts', [])
})

describe('staleness detection (Task 8.5 / Req 5.3)', () => {
  it('is NOT stale when prompt/schema/parser/transcript-hash all match current', () => {
    const { transcriptId, recordingId } = seedTranscript()
    recordIngestionRun(currentRun({ transcriptId, recordingId }))

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(false)
    expect(result.reasons).toEqual([])
    expect(result.ingestionRunId).toBeGreaterThan(0)
  })

  it('detects a prompt_hash mismatch', () => {
    const { transcriptId, recordingId } = seedTranscript()
    recordIngestionRun(currentRun({ transcriptId, recordingId, promptHash: 'fnv1a:deadbeef' }))

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(true)
    expect(result.reasons).toEqual(['prompt_hash'])
  })

  it('detects a schema_version mismatch', () => {
    const { transcriptId, recordingId } = seedTranscript()
    recordIngestionRun(currentRun({ transcriptId, recordingId, schemaVersion: 'schema-OLD' }))

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(true)
    expect(result.reasons).toEqual(['schema_version'])
  })

  it('detects a parser_version mismatch', () => {
    const { transcriptId, recordingId } = seedTranscript()
    recordIngestionRun(currentRun({ transcriptId, recordingId, parserVersion: 'parser-OLD' }))

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(true)
    expect(result.reasons).toEqual(['parser_version'])
  })

  it('detects a transcript_hash mismatch (transcript content changed since extraction)', () => {
    const { transcriptId, recordingId } = seedTranscript()
    // Run stamped with a hash of the OLD content; the transcript now differs.
    recordIngestionRun(
      currentRun({ transcriptId, recordingId, transcriptHash: computeTranscriptHash('older transcript text') })
    )

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(true)
    expect(result.reasons).toEqual(['transcript_hash'])
  })

  it('reports multiple reasons when several fields differ', () => {
    const { transcriptId, recordingId } = seedTranscript()
    recordIngestionRun(
      currentRun({
        transcriptId,
        recordingId,
        promptHash: 'fnv1a:0000',
        schemaVersion: 'schema-OLD',
        parserVersion: 'parser-OLD',
        transcriptHash: computeTranscriptHash('older transcript text'),
      })
    )

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(true)
    expect(result.reasons).toEqual(['prompt_hash', 'schema_version', 'parser_version', 'transcript_hash'])
  })

  it('reports `legacy` (single reason) for a migration-synthesized sentinel row', () => {
    const { transcriptId } = seedTranscript()
    seedLegacyMarker(transcriptId, '2026-05-01T08:00:00.000Z')
    migrateLegacyIngestMarkers()

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(true)
    expect(result.reasons).toEqual(['legacy'])
  })

  it('reports `no_prior_run` when the transcript has no ingestion_run', () => {
    const { transcriptId } = seedTranscript()

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(true)
    expect(result.reasons).toEqual(['no_prior_run'])
    expect(result.ingestionRunId).toBeNull()
  })

  it('uses the newest run when several exist', () => {
    const { transcriptId, recordingId } = seedTranscript()
    // Older stale run first, then a current run.
    recordIngestionRun(currentRun({ transcriptId, recordingId, schemaVersion: 'schema-OLD' }))
    recordIngestionRun(currentRun({ transcriptId, recordingId }))

    const result = isExtractionStale(transcriptId, CURRENT)
    expect(result.stale).toBe(false)
  })

  it('defaults `current` to the live extraction generation descriptor', () => {
    // With no explicit descriptor, a run stamped from getCurrentExtractionProvenance
    // must be considered fresh — proving the comparator uses the SAME source of
    // truth the live path would stamp, not a divergent constant.
    const { transcriptId, recordingId } = seedTranscript()
    recordIngestionRun(currentRun({ transcriptId, recordingId }))

    const result = isExtractionStale(transcriptId) // no explicit `current`
    expect(result.stale).toBe(false)
  })

  it('batch: findStaleMarkedTranscripts returns only stale MARKED transcripts with reasons', () => {
    const fresh = seedTranscript()
    const staleSchema = seedTranscript()
    const legacy = seedTranscript()

    // All three are MARKED (the re-ingestion candidate population).
    seedLegacyMarker(fresh.transcriptId, now())
    seedLegacyMarker(staleSchema.transcriptId, now())
    seedLegacyMarker(legacy.transcriptId, now())

    // Migrate FIRST: synthesizes a legacy sentinel row for every marked
    // transcript. Then record real runs for fresh/staleSchema so those become
    // the NEWEST run (staleness reads newest-first). `legacy` keeps only its
    // migrated sentinel row, so it stays reason `legacy`.
    migrateLegacyIngestMarkers()
    // fresh: current run (newest). staleSchema: schema mismatch (newest).
    recordIngestionRun(currentRun({ transcriptId: fresh.transcriptId, recordingId: fresh.recordingId }))
    recordIngestionRun(
      currentRun({ transcriptId: staleSchema.transcriptId, recordingId: staleSchema.recordingId, schemaVersion: 'schema-OLD' })
    )

    const stale = findStaleMarkedTranscripts(CURRENT)
    const byId = new Map(stale.map((s) => [s.transcriptId, s.reasons]))

    // fresh transcript is NOT reported.
    expect(byId.has(fresh.transcriptId)).toBe(false)
    // staleSchema reported with schema_version.
    expect(byId.get(staleSchema.transcriptId)).toEqual(['schema_version'])
    // legacy reported with legacy.
    expect(byId.get(legacy.transcriptId)).toEqual(['legacy'])
  })

  it('is COMPARISON ONLY: mutates/deletes nothing', () => {
    const { transcriptId, recordingId } = seedTranscript()
    const staleT = seedTranscript()
    recordIngestionRun(currentRun({ transcriptId, recordingId }))
    recordIngestionRun(
      currentRun({ transcriptId: staleT.transcriptId, recordingId: staleT.recordingId, promptHash: 'fnv1a:xxxx' })
    )
    seedLegacyMarker(transcriptId, now())
    seedLegacyMarker(staleT.transcriptId, now())

    // Let the idempotent store-init legacy migration settle FIRST (ensuring the
    // tracking tables exist synthesizes one legacy row per seeded marker). That
    // additive, idempotent migration is Task 8.3's behaviour, not the staleness
    // detector's — snapshot AFTER it so the assertion isolates the detector,
    // which must itself add/remove/change nothing.
    getKnowledgeGraphStore()
    migrateLegacyIngestMarkers()

    const runsBefore = ingestionRunCount()
    const markersBefore = markerCount()
    const runRowsBefore = dbQueryAll<{ id: number; status: string }>(
      'SELECT id, status FROM ingestion_run ORDER BY id',
      []
    )

    // Exercise both entry points, including the always-stale ones.
    isExtractionStale(transcriptId, CURRENT)
    isExtractionStale(staleT.transcriptId, CURRENT)
    isExtractionStale('nonexistent-transcript', CURRENT)
    findStaleMarkedTranscripts(CURRENT)

    // Nothing added, removed, or changed.
    expect(ingestionRunCount()).toBe(runsBefore)
    expect(markerCount()).toBe(markersBefore)
    expect(dbQueryAll<{ id: number; status: string }>('SELECT id, status FROM ingestion_run ORDER BY id', [])).toEqual(
      runRowsBefore
    )
  })
})
