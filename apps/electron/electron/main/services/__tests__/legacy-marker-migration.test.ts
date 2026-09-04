/**
 * hidock-graph-extraction-hardening Task 8.3 (Req 5.2) — backward-compatible
 * legacy-marker migration.
 *
 * Verifies that `migrateLegacyIngestMarkers`:
 *  - (a) represents EVERY legacy `graph_ingested_transcripts` marker in the new
 *        `ingestion_run` provenance model WITHOUT data loss (transcript_id +
 *        ingested_at preserved; recording_id resolved when available);
 *  - (b) leaves the legacy markers READABLE and intact — no drop/rename/delete;
 *  - (c) is IDEMPOTENT — re-running produces no duplicate migrated provenance;
 *  - synthesized rows are distinguishable from genuine runs via the migration
 *    sentinels (never mistaken for a real/current extraction);
 *  - runs additively at store init.
 *
 * Harness mirrors ingestion-run-provenance.test.ts / reingestion-discovery.test.ts:
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
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-legacy-marker-migration-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

import { initializeDatabase, run as dbRun, queryAll as dbQueryAll, queryOne as dbQueryOne } from '../database'
import {
  migrateLegacyIngestMarkers,
  getIngestionRunsForTranscript,
  getKnowledgeGraphStore,
  LEGACY_MARKER_PROMPT_HASH,
  LEGACY_MARKER_SENTINEL,
} from '../knowledge-graph-service'

const now = () => new Date().toISOString()

/** recording + transcript, so the migration can resolve a recording_id. */
function seedTranscript(fullText = 'Some transcript text'): { recordingId: string; transcriptId: string } {
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

/** Insert a legacy graph_ingested_transcripts marker directly. */
function seedLegacyMarker(transcriptId: string, ingestedAt: string): void {
  dbRun(`INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)`, [
    transcriptId,
    ingestedAt,
  ])
}

function readMarkers(): Array<{ transcript_id: string; ingested_at: string }> {
  return dbQueryAll<{ transcript_id: string; ingested_at: string }>(
    'SELECT transcript_id, ingested_at FROM graph_ingested_transcripts ORDER BY transcript_id',
    []
  )
}

describe('legacy marker migration (Task 8.3 / Req 5.2)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await initializeDatabase()
    // The graph_ingested_transcripts / ingestion_run tracking tables are created
    // lazily by the store, not by initializeDatabase(). Ensure they exist before
    // seeding markers. (This also runs the migration once — harmless with no data.)
    getKnowledgeGraphStore()
    // Clear any migration rows produced by the init-time run so each test starts
    // from the markers it seeds itself.
    dbRun('DELETE FROM ingestion_run', [])
    dbRun('DELETE FROM graph_ingested_transcripts', [])
  })

  it('(a) represents every legacy marker in the new model without data loss', () => {
    const seeded = [
      { ...seedTranscript('Transcript A'), ingestedAt: '2026-05-01T08:00:00.000Z' },
      { ...seedTranscript('Transcript B'), ingestedAt: '2026-05-02T09:30:00.000Z' },
      { ...seedTranscript('Transcript C'), ingestedAt: '2026-05-03T11:15:00.000Z' },
    ]
    for (const s of seeded) seedLegacyMarker(s.transcriptId, s.ingestedAt)

    const report = migrateLegacyIngestMarkers()
    expect(report.totalMarkers).toBe(3)
    expect(report.migrated).toBe(3)
    expect(report.alreadyMigrated).toBe(0)

    for (const s of seeded) {
      const runs = getIngestionRunsForTranscript(s.transcriptId)
      const migrated = runs.filter((r) => r.promptHash === LEGACY_MARKER_PROMPT_HASH)
      expect(migrated).toHaveLength(1)
      const row = migrated[0]
      // No data loss: the two real datums (transcript id + ingested_at) survive.
      expect(row.transcriptId).toBe(s.transcriptId)
      expect(row.startedAt).toBe(s.ingestedAt)
      expect(row.completedAt).toBe(s.ingestedAt)
      // recording_id resolved from the transcripts table.
      expect(row.recordingId).toBe(s.recordingId)
      // Synthesized, distinguishable from a genuine fresh run.
      expect(row.transcriptHash).toBe(LEGACY_MARKER_SENTINEL)
      expect(row.provider).toBe(LEGACY_MARKER_SENTINEL)
      expect(row.model).toBe(LEGACY_MARKER_SENTINEL)
      expect(row.promptVersion).toBe(LEGACY_MARKER_SENTINEL)
      expect(row.schemaVersion).toBe(LEGACY_MARKER_SENTINEL)
      expect(row.parserVersion).toBe(LEGACY_MARKER_SENTINEL)
      expect(row.status).toBe('success')
    }
  })

  it('resolves a sentinel recording_id when the transcript row is absent', () => {
    // A marker whose transcript no longer exists must still migrate (no loss).
    const orphanId = randomUUID()
    seedLegacyMarker(orphanId, '2026-05-04T12:00:00.000Z')

    const report = migrateLegacyIngestMarkers()
    expect(report.migrated).toBe(1)

    const runs = getIngestionRunsForTranscript(orphanId)
    expect(runs).toHaveLength(1)
    expect(runs[0].recordingId).toBe(LEGACY_MARKER_SENTINEL)
    expect(runs[0].startedAt).toBe('2026-05-04T12:00:00.000Z')
  })

  it('(b) leaves the legacy markers intact and readable (no blanket deletion)', () => {
    const seeded = [
      { ...seedTranscript(), ingestedAt: '2026-05-01T08:00:00.000Z' },
      { ...seedTranscript(), ingestedAt: '2026-05-02T09:30:00.000Z' },
    ]
    for (const s of seeded) seedLegacyMarker(s.transcriptId, s.ingestedAt)

    const before = readMarkers()
    migrateLegacyIngestMarkers()
    const after = readMarkers()

    // The table still exists, and every row is byte-for-byte preserved.
    expect(after).toEqual(before)
    expect(after).toHaveLength(2)
    for (const s of seeded) {
      const marker = dbQueryOne<{ transcript_id: string; ingested_at: string }>(
        'SELECT transcript_id, ingested_at FROM graph_ingested_transcripts WHERE transcript_id = ?',
        [s.transcriptId]
      )
      expect(marker).toBeDefined()
      expect(marker!.ingested_at).toBe(s.ingestedAt)
    }
  })

  it('(c) is idempotent — re-running produces no duplicate migrated provenance', () => {
    const seeded = [
      { ...seedTranscript(), ingestedAt: '2026-05-01T08:00:00.000Z' },
      { ...seedTranscript(), ingestedAt: '2026-05-02T09:30:00.000Z' },
    ]
    for (const s of seeded) seedLegacyMarker(s.transcriptId, s.ingestedAt)

    const first = migrateLegacyIngestMarkers()
    expect(first.migrated).toBe(2)
    expect(first.alreadyMigrated).toBe(0)

    const second = migrateLegacyIngestMarkers()
    expect(second.totalMarkers).toBe(2)
    expect(second.migrated).toBe(0)
    expect(second.alreadyMigrated).toBe(2)

    // Exactly one migrated row per transcript after two runs.
    for (const s of seeded) {
      const migrated = getIngestionRunsForTranscript(s.transcriptId).filter(
        (r) => r.promptHash === LEGACY_MARKER_PROMPT_HASH
      )
      expect(migrated).toHaveLength(1)
    }
    const totalMigratedRows = dbQueryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM ingestion_run WHERE prompt_hash = ?',
      [LEGACY_MARKER_PROMPT_HASH]
    )
    expect(totalMigratedRows?.n).toBe(2)
  })

  it('does not overwrite a genuine fresh run for the same transcript when re-run', () => {
    const { transcriptId } = seedTranscript()
    seedLegacyMarker(transcriptId, '2026-05-01T08:00:00.000Z')
    migrateLegacyIngestMarkers()

    // Simulate a genuine fresh extraction run recorded later (distinct prompt_hash).
    dbRun(
      `INSERT INTO ingestion_run (
         transcript_id, recording_id, transcript_hash, provider, model,
         prompt_version, prompt_hash, schema_version, parser_version,
         started_at, completed_at, status, error_summary,
         accepted_entity_count, privacy_filtered_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transcriptId, 'rec-real', 'sha256:realhash', 'ollama', 'gemma3:12b',
        'v2', 'sha256:realprompt', 'schema-v2', 'parser-v2',
        now(), now(), 'success', null, 5, 0,
      ]
    )

    // Re-running the migration must not touch the genuine run and must not
    // add a second migrated row.
    const report = migrateLegacyIngestMarkers()
    expect(report.migrated).toBe(0)
    expect(report.alreadyMigrated).toBe(1)

    const runs = getIngestionRunsForTranscript(transcriptId)
    expect(runs).toHaveLength(2)
    expect(runs.filter((r) => r.promptHash === LEGACY_MARKER_PROMPT_HASH)).toHaveLength(1)
    expect(runs.filter((r) => r.promptHash === 'sha256:realprompt')).toHaveLength(1)
  })

  it('runs additively at store init (idempotent, migrates seeded markers)', () => {
    const { transcriptId } = seedTranscript()
    seedLegacyMarker(transcriptId, '2026-05-01T08:00:00.000Z')

    // Store init should run the migration idempotently.
    getKnowledgeGraphStore()
    const migrated = getIngestionRunsForTranscript(transcriptId).filter(
      (r) => r.promptHash === LEGACY_MARKER_PROMPT_HASH
    )
    expect(migrated).toHaveLength(1)

    // A second init must not duplicate.
    getKnowledgeGraphStore()
    const after = getIngestionRunsForTranscript(transcriptId).filter(
      (r) => r.promptHash === LEGACY_MARKER_PROMPT_HASH
    )
    expect(after).toHaveLength(1)
  })

  it('handles an empty marker table without error', () => {
    const report = migrateLegacyIngestMarkers()
    expect(report.totalMarkers).toBe(0)
    expect(report.migrated).toBe(0)
    expect(report.alreadyMigrated).toBe(0)
  })
})
