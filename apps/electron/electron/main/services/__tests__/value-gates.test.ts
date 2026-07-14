// @vitest-environment node

/**
 * F16/spec-002 (T2) — downstream gates for low-value captures.
 *
 * A capture rated `garbage`/`low-value` (by T1's AI classifier or by a user in
 * the Library) must stop polluting the intelligence surfaces: no graph
 * ingestion, no actionable extraction, and exclusion from RAG retrieval
 * (covered separately in vector-store-exclusion.test.ts, which mocks
 * getExcludedRecordingIds directly). This file covers the DB-level predicate
 * + the graph-ingest gate against a REAL better-sqlite3 engine (temp DB),
 * following the recording-deletion.test.ts harness pattern.
 *
 * Covers:
 *  - getValueExcludedRecordingIds() / isValueExcludedRecording(): the
 *    garbage/low-value exclusion matrix (valuable/archived/unrated never
 *    excluded, a soft-deleted capture is ignored, a multi-capture recording
 *    with an explicit "keep" is rescued, AI-set and user-set ratings gate
 *    identically).
 *  - getExcludedRecordingIds(): now the UNION of privacy exclusions
 *    (personal/soft-deleted recordings) and value exclusions.
 *  - Graph ingest gate (ingestFromDbTranscripts): a rated-garbage transcript
 *    is skipped and never marked ingested; upgrading the rating afterwards
 *    lets a later call ingest it (reversibility via the un-marked marker
 *    table).
 *  - REQUIRED race test (Codex adversarial review AR-1): eligibility is
 *    decided with a FRESH point-read inside the same transaction as the
 *    persistence write, not from the once-per-run pre-filter Set — a rating
 *    committed between the (mocked) LLM extraction call resolving and the
 *    transactional persist step is honored in BOTH directions.
 *  - Actionable-gate predicate: isValueExcludedRecording() is the exact
 *    predicate transcription.ts's inline actionable-detection block gates on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted before imports) — mirrors knowledge-graph-service.test.ts
// so the same file can exercise both the pure DB predicates (real engine) and
// the graph-ingest gate (real engine + mocked LLM).
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    chat: { provider: 'gemini', geminiModel: 'gemini-2.0-flash', ollamaModel: '', maxContextChunks: 10 },
    transcription: { geminiApiKey: 'test-api-key', geminiModel: '' }, // pragma: allowlist secret
    storage: { dataPath: tmpdir(), maxRecordingsGB: 50 },
    calendar: { icsUrl: '', syncEnabled: false, syncIntervalMinutes: 15, lastSyncAt: null },
    embeddings: { provider: 'ollama', ollamaBaseUrl: '', ollamaModel: '', chunkSize: 500, chunkOverlap: 50 },
    device: { autoConnect: false, autoDownload: false },
    ui: { theme: 'system', defaultView: 'week', startOfWeek: 1, calendarView: 'week', hideEmptyMeetings: false, showListView: false },
    version: '1.0.0'
  }))
}))

vi.mock('@hidock/ai-providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hidock/ai-providers')>()
  return { ...mod, complete: vi.fn() }
})

let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-valuegates-test-${Date.now()}-${++_dbCounter}.sqlite`))
}))

// ---------------------------------------------------------------------------
// Imports (after mocks so they pick up the mocked versions)
// ---------------------------------------------------------------------------

import { complete } from '@hidock/ai-providers'
import {
  initializeDatabase,
  run as dbRun,
  queryOne as dbQueryOne,
  getExcludedRecordingIds,
  getValueExcludedRecordingIds,
  isValueExcludedRecording
} from '../database'
import { ingestFromDbTranscripts, getKnowledgeGraphStore } from '../knowledge-graph-service'

// Minimal-but-valid extraction JSON (same shape as knowledge-graph-service.test.ts).
const FAKE_JSON = JSON.stringify({
  people: [],
  topics: [],
  projects: [],
  decisions: [],
  action_items: [],
  risks: [],
  next_steps: []
})

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedRecording(
  id: string,
  opts: { personal?: number; deleted_at?: string | null; meeting_id?: string | null } = {}
): void {
  dbRun(
    `INSERT OR IGNORE INTO recordings (id, filename, date_recorded, meeting_id, personal, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, `${id}.hda`, '2026-06-01', opts.meeting_id ?? null, opts.personal ?? 0, opts.deleted_at ?? null]
  )
}

function seedCapture(
  id: string,
  recordingId: string,
  rating: string,
  opts: { deleted_at?: string | null; quality_source?: 'ai' | 'user' } = {}
): void {
  dbRun(
    `INSERT OR IGNORE INTO knowledge_captures
       (id, title, source_recording_id, quality_rating, quality_source, captured_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, `capture-${id}`, recordingId, rating, opts.quality_source ?? null, '2026-06-01T10:00:00.000Z', opts.deleted_at ?? null]
  )
}

function seedTranscript(id: string, recordingId: string, text = 'hello world'): void {
  dbRun(`INSERT OR IGNORE INTO transcripts (id, recording_id, full_text) VALUES (?, ?, ?)`, [id, recordingId, text])
}

function ingestMarker(transcriptId: string): { transcript_id: string } | undefined {
  return dbQueryOne<{ transcript_id: string }>(
    'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
    [transcriptId]
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  ;(complete as any).mockResolvedValue(FAKE_JSON)
  // Fresh temp DB per test (file-storage mock returns a new unique path each call).
  await initializeDatabase()
})

// =============================================================================
// getValueExcludedRecordingIds() / isValueExcludedRecording() matrix
// =============================================================================

describe('getValueExcludedRecordingIds() / isValueExcludedRecording()', () => {
  it('excludes a recording whose only capture is garbage', () => {
    seedRecording('r-garbage')
    seedCapture('cap-garbage', 'r-garbage', 'garbage')

    expect(getValueExcludedRecordingIds().has('r-garbage')).toBe(true)
    expect(isValueExcludedRecording('r-garbage')).toBe(true)
  })

  it('excludes a recording whose only capture is low-value', () => {
    seedRecording('r-lowvalue')
    seedCapture('cap-lowvalue', 'r-lowvalue', 'low-value')

    expect(getValueExcludedRecordingIds().has('r-lowvalue')).toBe(true)
    expect(isValueExcludedRecording('r-lowvalue')).toBe(true)
  })

  it('does NOT exclude a recording whose only capture is valuable', () => {
    seedRecording('r-valuable')
    seedCapture('cap-valuable', 'r-valuable', 'valuable')

    expect(getValueExcludedRecordingIds().has('r-valuable')).toBe(false)
    expect(isValueExcludedRecording('r-valuable')).toBe(false)
  })

  it('does NOT exclude a recording whose only capture is archived', () => {
    seedRecording('r-archived')
    seedCapture('cap-archived', 'r-archived', 'archived')

    expect(getValueExcludedRecordingIds().has('r-archived')).toBe(false)
    expect(isValueExcludedRecording('r-archived')).toBe(false)
  })

  it('does NOT exclude a recording whose only capture is unrated', () => {
    seedRecording('r-unrated')
    seedCapture('cap-unrated', 'r-unrated', 'unrated')

    expect(getValueExcludedRecordingIds().has('r-unrated')).toBe(false)
    expect(isValueExcludedRecording('r-unrated')).toBe(false)
  })

  it('does NOT exclude a multi-capture recording that also has a valuable capture (explicit keep wins)', () => {
    seedRecording('r-multi')
    seedCapture('cap-multi-garbage', 'r-multi', 'garbage')
    seedCapture('cap-multi-valuable', 'r-multi', 'valuable')

    expect(getValueExcludedRecordingIds().has('r-multi')).toBe(false)
    expect(isValueExcludedRecording('r-multi')).toBe(false)
  })

  it('does NOT exclude a multi-capture recording that also has an archived capture (explicit keep wins)', () => {
    seedRecording('r-multi-archived')
    seedCapture('cap-ma-lowvalue', 'r-multi-archived', 'low-value')
    seedCapture('cap-ma-archived', 'r-multi-archived', 'archived')

    expect(getValueExcludedRecordingIds().has('r-multi-archived')).toBe(false)
    expect(isValueExcludedRecording('r-multi-archived')).toBe(false)
  })

  it('ignores a soft-deleted garbage capture (does not exclude the recording)', () => {
    seedRecording('r-softdeleted')
    seedCapture('cap-softdeleted', 'r-softdeleted', 'garbage', { deleted_at: '2026-07-01T00:00:00.000Z' })

    expect(getValueExcludedRecordingIds().has('r-softdeleted')).toBe(false)
    expect(isValueExcludedRecording('r-softdeleted')).toBe(false)
  })

  it('a rating flip (garbage -> valuable) is reflected immediately by the point-read', () => {
    seedRecording('r-flip')
    seedCapture('cap-flip', 'r-flip', 'garbage')

    expect(isValueExcludedRecording('r-flip')).toBe(true)

    dbRun(`UPDATE knowledge_captures SET quality_rating = 'valuable' WHERE id = 'cap-flip'`)

    expect(isValueExcludedRecording('r-flip')).toBe(false)
  })

  it('AI-set and user-set garbage ratings gate identically (both key on quality_rating only)', () => {
    seedRecording('r-ai-rated')
    seedCapture('cap-ai-rated', 'r-ai-rated', 'garbage', { quality_source: 'ai' })
    seedRecording('r-user-rated')
    seedCapture('cap-user-rated', 'r-user-rated', 'garbage', { quality_source: 'user' })

    expect(isValueExcludedRecording('r-ai-rated')).toBe(true)
    expect(isValueExcludedRecording('r-user-rated')).toBe(true)
    const excluded = getValueExcludedRecordingIds()
    expect(excluded.has('r-ai-rated')).toBe(true)
    expect(excluded.has('r-user-rated')).toBe(true)
  })
})

// =============================================================================
// getExcludedRecordingIds() — union of privacy + value exclusions
// =============================================================================

describe('getExcludedRecordingIds() — privacy UNION value exclusions', () => {
  it('unions personal/soft-deleted recordings with value-excluded recordings', () => {
    seedRecording('r-personal', { personal: 1 })
    seedRecording('r-deleted', { deleted_at: '2026-07-01T00:00:00.000Z' })
    seedRecording('r-garbage2')
    seedCapture('cap-garbage2', 'r-garbage2', 'garbage')
    seedRecording('r-normal')

    const excluded = getExcludedRecordingIds()

    expect(excluded.has('r-personal')).toBe(true)
    expect(excluded.has('r-deleted')).toBe(true)
    expect(excluded.has('r-garbage2')).toBe(true)
    expect(excluded.has('r-normal')).toBe(false)
  })

  it('privacy exclusion survives even when there are zero knowledge_captures at all', () => {
    seedRecording('r-personal-only', { personal: 1 })

    expect(getExcludedRecordingIds().has('r-personal-only')).toBe(true)
  })
})

// =============================================================================
// Graph ingest gate (ingestFromDbTranscripts)
// =============================================================================

describe('ingestFromDbTranscripts() — value gate', () => {
  it('skips a rated-garbage transcript, writes NO ingest marker, and creates no graph nodes', async () => {
    seedRecording('r-gate1')
    seedCapture('cap-gate1', 'r-gate1', 'garbage')
    seedTranscript('tx-gate1', 'r-gate1', 'Alice discussed TypeScript.')

    const result = await ingestFromDbTranscripts()

    expect(result.ingested).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(0)
    expect(ingestMarker('tx-gate1')).toBeUndefined()

    const store = getKnowledgeGraphStore()
    expect(store.findNodes({ type: 'meeting', label: 'r-gate1' })).toHaveLength(0)
  })

  it('ingests and marks the SAME transcript once the rating is upgraded to unrated (reversibility)', async () => {
    seedRecording('r-gate2')
    seedCapture('cap-gate2', 'r-gate2', 'garbage')
    seedTranscript('tx-gate2', 'r-gate2', 'Bob discussed Python.')

    const r1 = await ingestFromDbTranscripts()
    expect(r1.skipped).toBe(1)
    expect(r1.ingested).toBe(0)
    expect(ingestMarker('tx-gate2')).toBeUndefined()

    // Upgrade the rating — the transcript was never marked ingested, so it is
    // still eligible; a later call (here: a second call to the same
    // function, standing in for the next debounced/boot ingest) re-ingests it.
    dbRun(`UPDATE knowledge_captures SET quality_rating = 'unrated' WHERE id = 'cap-gate2'`)

    const r2 = await ingestFromDbTranscripts()
    expect(r2.ingested).toBe(1)
    expect(r2.skipped).toBe(0)
    expect(ingestMarker('tx-gate2')).toBeDefined()

    const store = getKnowledgeGraphStore()
    expect(store.findNodes({ type: 'meeting', label: 'r-gate2' })).toHaveLength(1)
  })

  it('ingests a non-excluded transcript normally (control case)', async () => {
    seedRecording('r-gate3')
    seedTranscript('tx-gate3', 'r-gate3', 'Carol discussed the roadmap.')

    const result = await ingestFromDbTranscripts()

    expect(result.ingested).toBe(1)
    expect(result.skipped).toBe(0)
    expect(ingestMarker('tx-gate3')).toBeDefined()
  })
})

// =============================================================================
// REQUIRED race test (Codex adversarial review AR-1) — pause-after-extraction
// harness. The mocked complete() call stands in for "the LLM extraction call
// resolving": performing a DB write inside its resolution and THEN resolving
// deterministically simulates a rating committed in the window between
// extraction finishing and the transactional persist step, since the real
// implementation has no other await between them.
// =============================================================================

describe('ingestFromDbTranscripts() — AR-1 race: fresh point-read at persistence time', () => {
  it('a garbage rating committed between extraction and persistence blocks ingestion (no rows, no marker)', async () => {
    seedRecording('r-race1')
    seedCapture('cap-race1', 'r-race1', 'unrated') // starts NOT excluded
    seedTranscript('tx-race1', 'r-race1', 'Some real meeting content.')

    ;(complete as any).mockImplementationOnce(async () => {
      // Simulates a rating write landing WHILE this row's extraction call was
      // still in flight (i.e. after the pre-filter/row-fetch, before persist).
      dbRun(`UPDATE knowledge_captures SET quality_rating = 'garbage' WHERE id = 'cap-race1'`)
      return FAKE_JSON
    })

    const result = await ingestFromDbTranscripts()

    expect(result.ingested).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(0)
    expect(ingestMarker('tx-race1')).toBeUndefined()

    const store = getKnowledgeGraphStore()
    expect(store.findNodes({ type: 'meeting', label: 'r-race1' })).toHaveLength(0)
  })

  it('a valuable flip committed between extraction and persistence still lets it ingest', async () => {
    seedRecording('r-race2')
    seedCapture('cap-race2', 'r-race2', 'garbage') // starts excluded
    seedTranscript('tx-race2', 'r-race2', 'Some real meeting content.')

    ;(complete as any).mockImplementationOnce(async () => {
      // Reverses the exclusion while this row's extraction call was in flight.
      dbRun(`UPDATE knowledge_captures SET quality_rating = 'valuable' WHERE id = 'cap-race2'`)
      return FAKE_JSON
    })

    const result = await ingestFromDbTranscripts()

    expect(result.ingested).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(ingestMarker('tx-race2')).toBeDefined()

    const store = getKnowledgeGraphStore()
    expect(store.findNodes({ type: 'meeting', label: 'r-race2' })).toHaveLength(1)
  })
})

// =============================================================================
// Actionable-gate predicate (transcription.ts wiring) — spec-002 step 4 /
// A3: the inline actionable-detection block in transcribeRecording gates on
// isValueExcludedRecording(recordingId). Full pipeline mocking lives in
// transcription-value-classification.test.ts / transcription.test.ts (which
// stub isValueExcludedRecording directly); this asserts the predicate those
// stubs stand in for is correct against a real DB.
// =============================================================================

describe('actionable-gate predicate (transcription.ts gates the inline block on this)', () => {
  it('returns true for a rated-garbage recording (actionable extraction is skipped)', () => {
    seedRecording('r-act-garbage')
    seedCapture('cap-act-garbage', 'r-act-garbage', 'garbage')

    expect(isValueExcludedRecording('r-act-garbage')).toBe(true)
  })

  it('returns false for an above-threshold (valuable) recording (actionable extraction runs)', () => {
    seedRecording('r-act-valuable')
    seedCapture('cap-act-valuable', 'r-act-valuable', 'valuable')

    expect(isValueExcludedRecording('r-act-valuable')).toBe(false)
  })

  it('returns false for a recording with no capture at all (fresh transcription, not yet rated)', () => {
    seedRecording('r-act-fresh')

    expect(isValueExcludedRecording('r-act-fresh')).toBe(false)
  })
})
