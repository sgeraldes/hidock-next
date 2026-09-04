/**
 * hidock-graph-extraction-hardening Task 8.7 (Req 5.4) — ATOMIC current-marking.
 *
 * Req 5.4 / design §5 / Property 23: a transcript is marked "current" ONLY when
 * graph writes, promotion, and marker/provenance persistence all complete in ONE
 * transaction; ANY sub-step failure rolls back and leaves NOTHING marked current.
 *
 * This suite proves the atomicity end-to-end against the real sql.js engine:
 *
 *  (a) SUCCESS — a successful `ingestFromDbTranscripts` atomically co-persists
 *      ALL FOUR: graph rows (ingestExtraction), promotion rows
 *      (promoteExtractionToFirstClassTables), the `graph_ingested_transcripts`
 *      marker, AND a CURRENT-provenance `ingestion_run` row. Afterwards
 *      `isExtractionStale` reports the transcript NOT stale — the operational
 *      definition of "current".
 *
 *  (b) ROLLBACK — a forced failure in a sub-step (here: promotion throws) rolls
 *      back ALL FOUR: no marker, no `ingestion_run` row, no graph rows, no
 *      promotion rows. Nothing is marked current and the transcript stays
 *      unmarked/retryable.
 *
 * Harness mirrors knowledge-graph-service.test.ts / ingestion-run-provenance.test.ts:
 * mock electron/config/ai-providers/file-storage so a fresh temp SQLite DB is
 * minted per test and the real service exports run against the real engine. The
 * ONLY behavioural mock is a TOGGLEABLE throw injected into
 * `promoteExtractionToFirstClassTables` (default: real passthrough) so the
 * rollback test can fail exactly one sub-step without touching any other
 * `../database` export. Uses `initializeDatabase`, NOT the recording-provenance
 * ABI harness (task 14) — no native rebuild needed.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    chat: { provider: 'ollama', ollamaModel: 'llama3.2', extractionOllamaModel: 'gemma3:12b', maxContextChunks: 10 },
    transcription: { geminiApiKey: '', geminiModel: '' }, // pragma: allowlist secret
  })),
}))

// ai-providers — mock complete() so we never hit a real LLM.
vi.mock('@hidock/ai-providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hidock/ai-providers')>()
  return { ...mod, complete: vi.fn() }
})

let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-atomic-marking-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

// Toggleable promotion-failure injection. Default: real passthrough. When the
// flag is set, the FIRST (and only) sub-step we force to fail is the promotion,
// so the rollback test proves a mid-transaction failure discards ALL co-persisted
// writes. Every other `../database` export is the genuine one.
const promotionShouldThrow = { value: false }
vi.mock('../database', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../database')>()
  return {
    ...mod,
    promoteExtractionToFirstClassTables: vi.fn((...args: Parameters<typeof mod.promoteExtractionToFirstClassTables>) => {
      if (promotionShouldThrow.value) {
        throw new Error('INJECTED promotion failure (atomic-marking rollback test)')
      }
      return mod.promoteExtractionToFirstClassTables(...args)
    }),
  }
})

import { complete } from '@hidock/ai-providers'
import { initializeDatabase, run as dbRun, queryOne } from '../database'
import {
  ingestFromDbTranscripts,
  isExtractionStale,
  computeTranscriptHash,
  getIngestionRunsForTranscript,
  getKnowledgeGraphStore,
} from '../knowledge-graph-service'
import { getCurrentExtractionProvenance } from '@hidock/knowledge-graph'

const FAKE_JSON = JSON.stringify({
  people: [
    { name: 'Alice', skills: ['TypeScript'], category: 'work' },
    { name: 'Bob', skills: ['Python'], category: 'work' },
  ],
  topics: [{ text: 'AI Strategy', category: 'work' }],
  projects: [{ text: 'Project Alpha', category: 'work' }],
  decisions: [{ text: 'Use TypeScript', category: 'work' }],
  action_items: [{ text: 'Write docs', owner: 'Alice', category: 'work' }],
  risks: [{ text: 'Data breach', raised_by: 'Bob', category: 'work' }],
  next_steps: [{ text: 'Schedule follow-up', category: 'work' }],
})

const TRANSCRIPT_TEXT = 'Alice and Bob discussed TypeScript and Project Alpha.'

function seedTranscript(recordingId: string, transcriptId: string): void {
  dbRun(`INSERT OR IGNORE INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)`, [
    recordingId,
    `${recordingId}.hda`,
    '2026-06-01',
    null,
  ])
  dbRun(`INSERT OR IGNORE INTO transcripts (id, recording_id, full_text, language) VALUES (?, ?, ?, ?)`, [
    transcriptId,
    recordingId,
    TRANSCRIPT_TEXT,
    'en',
  ])
  // A knowledge_capture backed by this recording so promotion
  // (promoteExtractionToFirstClassTables) has a capture to attach decisions /
  // action_items to — without it, promotion is a no-op and the atomicity of the
  // promotion sub-step could not be observed.
  dbRun(
    `INSERT OR IGNORE INTO knowledge_captures (id, title, category, status, quality_rating, source_recording_id, captured_at)
     VALUES (?, ?, 'meeting', 'ready', 'unrated', ?, ?)`,
    [`cap-${recordingId}`, `Capture for ${recordingId}`, recordingId, '2026-06-01T10:00:00.000Z']
  )
}

function markerFor(transcriptId: string) {
  return queryOne<{ transcript_id: string }>(
    'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
    [transcriptId]
  )
}
function graphNodeCount(): number {
  return queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM graph_nodes', [])?.n ?? 0
}
function decisionRowCount(): number {
  // Promotion writes decisions into the first-class `decisions` table.
  return queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM decisions', [])?.n ?? 0
}

beforeEach(async () => {
  vi.clearAllMocks()
  promotionShouldThrow.value = false
  ;(complete as any).mockResolvedValue(FAKE_JSON)
  await initializeDatabase()
  // Ensure the graph + tracking tables exist so pre-ingest baseline COUNT(*)s
  // (graph_nodes / ingestion_run) can be read even before any ingest runs.
  getKnowledgeGraphStore()
})

describe('atomic current-marking (Task 8.7 / Req 5.4)', () => {
  it('SUCCESS: co-persists graph + promotion + marker + a CURRENT ingestion_run row, and is NOT stale afterwards', async () => {
    seedTranscript('rec-ok', 'tx-ok')

    const result = await ingestFromDbTranscripts()
    expect(result.ingested).toBe(1)
    expect(result.errors).toHaveLength(0)

    // (1) graph rows written.
    expect(graphNodeCount()).toBeGreaterThan(0)
    // (2) promotion rows written (a decision was extracted).
    expect(decisionRowCount()).toBeGreaterThan(0)
    // (3) marker written.
    expect(markerFor('tx-ok')).toMatchObject({ transcript_id: 'tx-ok' })

    // (4) a CURRENT-provenance ingestion_run row written, stamped `success`
    // with the current descriptor + content hash + model config + counts.
    const runs = getIngestionRunsForTranscript('tx-ok')
    expect(runs).toHaveLength(1)
    const current = getCurrentExtractionProvenance()
    expect(runs[0]).toMatchObject({
      transcriptId: 'tx-ok',
      recordingId: 'rec-ok',
      transcriptHash: computeTranscriptHash(TRANSCRIPT_TEXT),
      provider: 'ollama',
      model: 'gemma3:12b',
      promptVersion: current.promptVersion,
      promptHash: current.promptHash,
      schemaVersion: current.schemaVersion,
      parserVersion: current.parserVersion,
      status: 'success',
      privacyFilteredCount: 0,
    })
    expect(runs[0].completedAt).toBeDefined()
    // Accepted count = all seven work-tagged entities from FAKE_JSON.
    expect(runs[0].acceptedEntityCount).toBe(8)

    // The operational definition of "current": the atomic co-persistence makes
    // isExtractionStale report the transcript NOT stale.
    const staleness = isExtractionStale('tx-ok')
    expect(staleness.stale).toBe(false)
    expect(staleness.reasons).toEqual([])
  })

  it('ROLLBACK: a sub-step failure (promotion throws) rolls back ALL of graph + promotion + marker + ingestion_run — nothing marked current', async () => {
    seedTranscript('rec-fail', 'tx-fail')

    // Baseline: clean DB before the failing ingest.
    expect(graphNodeCount()).toBe(0)
    expect(decisionRowCount()).toBe(0)

    // Force the promotion sub-step to throw INSIDE the ingest transaction.
    promotionShouldThrow.value = true

    const result = await ingestFromDbTranscripts()

    // The failure is collected per-transcript; the pass does not crash.
    expect(result.ingested).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].transcriptId).toBe('tx-fail')
    expect(result.errors[0].error).toContain('INJECTED promotion failure')

    // NOTHING marked current — all four writes rolled back together:
    // (1) no graph rows.
    expect(graphNodeCount()).toBe(0)
    // (2) no promotion rows.
    expect(decisionRowCount()).toBe(0)
    // (3) no marker → still retryable.
    expect(markerFor('tx-fail')).toBeUndefined()
    // (4) no ingestion_run row.
    expect(getIngestionRunsForTranscript('tx-fail')).toHaveLength(0)

    // Because nothing current was recorded, staleness reports `no_prior_run`
    // (the transcript is NOT considered current).
    const staleness = isExtractionStale('tx-fail')
    expect(staleness.stale).toBe(true)
    expect(staleness.reasons).toEqual(['no_prior_run'])
  })

  it('ROLLBACK then RETRY: once the injected failure clears, a later pass ingests and marks current atomically', async () => {
    seedTranscript('rec-retry', 'tx-retry')

    // First pass fails the promotion sub-step → nothing persisted.
    promotionShouldThrow.value = true
    const r1 = await ingestFromDbTranscripts()
    expect(r1.ingested).toBe(0)
    expect(markerFor('tx-retry')).toBeUndefined()
    expect(getIngestionRunsForTranscript('tx-retry')).toHaveLength(0)

    // Second pass: failure cleared → the still-unmarked transcript ingests and
    // records exactly one CURRENT ingestion_run row.
    promotionShouldThrow.value = false
    const r2 = await ingestFromDbTranscripts()
    expect(r2.ingested).toBe(1)
    expect(markerFor('tx-retry')).toMatchObject({ transcript_id: 'tx-retry' })
    const runs = getIngestionRunsForTranscript('tx-retry')
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('success')
    expect(isExtractionStale('tx-retry').stale).toBe(false)
  })
})
