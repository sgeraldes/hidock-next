/**
 * RE-2 (Codex adversarial re-review round 2) — reanalyzeFailedTranscripts must
 * NOT re-upload trashed / personal / value-excluded transcripts to the provider
 * on boot. Real better-sqlite3 engine + real database; only the provider
 * (@google/generative-ai) and leaf side-effects are mocked. Proves the
 * query-level exclusion (soft-deleted + personal), the value-exclusion
 * pre-filter, and the post-await eligibility re-check (in-flight delete).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() }
}))

let mockConfig: any = {
  transcription: {
    provider: 'gemini',
    geminiApiKey: 'test-api-key', // pragma: allowlist secret
    geminiModel: 'gemini-2.0-flash',
    // Keep the value-classification path OUT of this test — it is covered
    // elsewhere; here we focus on the exclusion gates.
    valueClassificationEnabled: false
  }
}
vi.mock('../config', () => ({ getConfig: vi.fn(() => mockConfig) }))

const mockGenerateContent = vi.fn()
vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    getGenerativeModel() {
      return { generateContent: (...args: any[]) => mockGenerateContent(...args) }
    }
  }
  return { GoogleGenerativeAI: MockGoogleGenerativeAI }
})

vi.mock('@hidock/transcription', () => {
  // eslint-disable-next-line require-yield
  const gen = async function* () {
    throw new Error('unused in this suite')
  }
  function GeminiEngine() {
    return { isAvailable: async () => true, isStreaming: false, isLocal: false, transcribe: gen }
  }
  return { GeminiEngine }
})

vi.mock('../brains', () => ({
  getBrainRegistry: () => ({ get: () => ({ generate: vi.fn() }) }),
  resolveGeminiApiKey: () => 'test-api-key' // pragma: allowlist secret
}))

vi.mock('../vector-store', () => ({ getVectorStore: vi.fn(() => null) }))

const exportMeetingWikiMock = vi.fn(() => null)
vi.mock('../meeting-wiki', () => ({ exportMeetingWiki: exportMeetingWikiMock }))

let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-reanalyze-excl-${Date.now()}-${++_dbCounter}.sqlite`))
}))

import {
  initializeDatabase,
  run as dbRun,
  queryOne as dbQueryOne,
  setRecordingPersonal,
  deleteRecordingCascade
} from '../database'
import { reanalyzeFailedTranscripts } from '../transcription'

function geminiJsonResponse(json: Record<string, unknown>) {
  return { response: { text: () => JSON.stringify(json) } }
}
const HEALED = {
  summary: 'Healed summary.',
  action_items: [],
  topics: [],
  key_points: [],
  title_suggestion: 'Healed Title',
  question_suggestions: [],
  language: 'en'
}

function seedRecording(id: string, opts: { personal?: number } = {}): void {
  dbRun(
    `INSERT INTO recordings (id, filename, date_recorded, personal) VALUES (?, ?, ?, ?)`,
    [id, `${id}.hda`, '2026-06-01', opts.personal ?? 0]
  )
}
// A transcript with a NULL summary — selected by the reanalyze backfill query.
function seedFailedTranscript(id: string, recordingId: string): void {
  dbRun(
    `INSERT INTO transcripts (id, recording_id, full_text, summary, title_suggestion)
     VALUES (?, ?, ?, NULL, NULL)`,
    [id, recordingId, 'some real transcript body worth analyzing']
  )
}
function summaryOf(recordingId: string): string | null {
  return dbQueryOne<{ summary: string | null }>(
    'SELECT summary FROM transcripts WHERE recording_id = ?',
    [recordingId]
  )?.summary ?? null
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockConfig.transcription.valueClassificationEnabled = false
  mockGenerateContent.mockResolvedValue(geminiJsonResponse(HEALED))
  await initializeDatabase()
})

describe('RE-2 — reanalyzeFailedTranscripts excludes trashed/personal/value-excluded', () => {
  it('heals an eligible recording (control)', async () => {
    seedRecording('ok')
    seedFailedTranscript('t-ok', 'ok')

    const healed = await reanalyzeFailedTranscripts(10)

    expect(healed).toBe(1)
    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    expect(summaryOf('ok')).toBe('Healed summary.')
  })

  it('does NOT select or re-upload a soft-deleted recording', async () => {
    seedRecording('trashed')
    seedFailedTranscript('t-trashed', 'trashed')
    deleteRecordingCascade('trashed', { hard: false }) // soft delete

    const healed = await reanalyzeFailedTranscripts(10)

    expect(healed).toBe(0)
    // The transcript's full_text was NEVER sent to the provider.
    expect(mockGenerateContent).not.toHaveBeenCalled()
    expect(summaryOf('trashed')).toBeNull()
  })

  it('does NOT select or re-upload a personal recording', async () => {
    seedRecording('mine')
    seedFailedTranscript('t-mine', 'mine')
    setRecordingPersonal('mine', true)

    const healed = await reanalyzeFailedTranscripts(10)

    expect(healed).toBe(0)
    expect(mockGenerateContent).not.toHaveBeenCalled()
    expect(summaryOf('mine')).toBeNull()
  })

  it('does NOT re-upload a value-excluded recording (pre-filter Set, no provider call)', async () => {
    seedRecording('garbage')
    seedFailedTranscript('t-garbage', 'garbage')
    // A garbage capture with no "keep" capture ⇒ value-excluded.
    dbRun(
      'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)',
      ['cap-g', 'Cap', '2026-06-01', 'garbage', 'garbage']
    )

    const healed = await reanalyzeFailedTranscripts(10)

    expect(healed).toBe(0)
    expect(mockGenerateContent).not.toHaveBeenCalled()
    expect(summaryOf('garbage')).toBeNull()
  })

  it('a delete that lands mid-analysis blocks the heal (post-await re-check)', async () => {
    seedRecording('race')
    seedFailedTranscript('t-race', 'race')
    // The provider call resolves AFTER the recording is soft-deleted, exactly
    // simulating a trash committed while full_text was in flight.
    mockGenerateContent.mockImplementationOnce(async () => {
      deleteRecordingCascade('race', { hard: false })
      return geminiJsonResponse(HEALED)
    })

    const healed = await reanalyzeFailedTranscripts(10)

    // Provider WAS called (eligible at select time) but the heal is discarded.
    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    expect(healed).toBe(0)
    expect(summaryOf('race')).toBeNull()
  })

  it('heals only the eligible one when eligible + excluded rows are mixed', async () => {
    seedRecording('keep')
    seedFailedTranscript('t-keep', 'keep')
    seedRecording('drop')
    seedFailedTranscript('t-drop', 'drop')
    setRecordingPersonal('drop', true)

    const healed = await reanalyzeFailedTranscripts(10)

    expect(healed).toBe(1)
    expect(mockGenerateContent).toHaveBeenCalledTimes(1) // only for 'keep'
    expect(summaryOf('keep')).toBe('Healed summary.')
    expect(summaryOf('drop')).toBeNull()
  })

  it('INC-3 — an eligible failed transcript behind N NEWER garbage rows still gets reanalyzed', async () => {
    // 3 value-excluded (garbage) failed transcripts, all NEWER than the eligible
    // one. Under the old LIMIT-before-exclusion bug, the newest N garbage rows
    // filled the slot and the eligible transcript starved forever.
    for (const g of ['g1', 'g2', 'g3']) {
      seedRecording(g)
      seedFailedTranscript(`t-${g}`, g)
      dbRun("UPDATE transcripts SET created_at = '2026-06-10T00:00:00Z' WHERE recording_id = ?", [g])
      dbRun(
        'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)',
        [`c-${g}`, 'C', '2026-06-01', g, 'garbage']
      )
    }
    seedRecording('eligible')
    seedFailedTranscript('t-eligible', 'eligible')
    dbRun("UPDATE transcripts SET created_at = '2026-06-01T00:00:00Z' WHERE recording_id = ?", ['eligible'])

    // Tight limit — the exclusion is baked into the query, so LIMIT counts only
    // eligible rows and the eligible transcript is reached.
    const healed = await reanalyzeFailedTranscripts(2)

    expect(healed).toBe(1)
    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    expect(summaryOf('eligible')).toBe('Healed summary.')
    expect(summaryOf('g1')).toBeNull()
  })

  it('P1 — aborts the run (zero provider calls) when the eligibility query fails', async () => {
    seedRecording('ok')
    seedFailedTranscript('t-ok', 'ok')
    dbRun('DROP TABLE transcripts') // force getFailedTranscriptsForReanalysis to throw

    const healed = await reanalyzeFailedTranscripts(10)

    expect(healed).toBe(0)
    expect(mockGenerateContent).not.toHaveBeenCalled() // fail CLOSED — no upload
  })
})
