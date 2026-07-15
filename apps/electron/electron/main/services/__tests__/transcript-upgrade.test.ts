/**
 * Transcript-upgrade service tests.
 *
 * Runs against a real in-memory sql.js DB with '../database' mocked to delegate
 * query/run to it, and '../chat-llm' mocked so the reformat path uses a fake
 * model. The service keeps NO triage state — everything is computed on the fly
 * and the only write is the reformatted turns into transcripts.speakers. Covers:
 * on-the-fly counts + flagging, the text-only reformat write (speakers updated,
 * full_text preserved, row flips out of 'legacy'), lowest-priority gating behind
 * the audio queue, and flagged-recording surfacing.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import initSqlJs from 'sql.js'

let dbInstance: any = null
let queueBusy = false

function rowsFrom(result: any[]): any[] {
  if (!result || result.length === 0) return []
  const { columns, values } = result[0]
  return values.map((v: any[]) => {
    const row: any = {}
    columns.forEach((c: string, i: number) => (row[c] = v[i]))
    return row
  })
}

vi.mock('../database', () => ({
  queryAll: (sql: string, params: any[] = []) => (dbInstance ? rowsFrom(dbInstance.exec(sql, params)) : []),
  queryOne: (sql: string, params: any[] = []) =>
    dbInstance ? rowsFrom(dbInstance.exec(sql, params))[0] : undefined,
  run: (sql: string, params: any[] = []) => dbInstance.run(sql, params),
  runInTransaction: (fn: () => unknown) => fn(),
  saveDatabase: () => {},
  // Simulate the audio transcription backlog: when busy, 'pending' is non-empty.
  getQueueItems: (status?: string) => (queueBusy && status === 'pending' ? [{ id: 'q1' }] : []),
  // RE8-1 (round-8) — reformatOne + the work-list filter route recording ids
  // through the eligibility boundary, which reads getExcludedRecordingIds.
  // Default: nothing excluded, not fail-closed (all eligible).
  getExcludedRecordingIds: () => excludedResult
}))

// RE8-1 (round-8) — mutable so eligibility-gating tests can exclude a recording
// / force fail-closed.
let excludedResult: { ids: Set<string>; failClosed: boolean } = { ids: new Set<string>(), failClosed: false }

const mockGenerate = vi.fn()
vi.mock('../chat-llm', () => ({
  getChatLLMService: () => ({ generate: mockGenerate })
}))

import {
  runUpgrade,
  scanOldTranscripts,
  reformatOne,
  kickReformatProcessing,
  stopReformatProcessing,
  getRecommendedRecordingIds,
  getUpgradeStatus
} from '../transcript-upgrade'

function seedSchema(): void {
  dbInstance.run(`
    CREATE TABLE transcripts (
      id TEXT PRIMARY KEY, recording_id TEXT, full_text TEXT, speakers TEXT,
      word_count INTEGER, action_items TEXT, topics TEXT
    );
    CREATE TABLE recordings (
      id TEXT PRIMARY KEY, date_recorded TEXT, meeting_id TEXT, migrated_to_capture_id TEXT
    );
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY, attendees TEXT, organizer_email TEXT, is_recurring INTEGER
    );
    CREATE TABLE knowledge_captures (id TEXT PRIMARY KEY, category TEXT);
    CREATE TABLE meeting_projects (meeting_id TEXT, project_id TEXT);
    CREATE TABLE knowledge_projects (knowledge_capture_id TEXT, project_id TEXT);
  `)
}

/** Insert a transcript (+ optional recording context). */
function addTranscript(opts: {
  id: string
  fullText: string
  speakers?: string | null
  wordCount?: number
  actionItems?: string
  topics?: string
  recording?: { date?: string; meetingId?: string; captureId?: string }
  meeting?: { attendees?: string; organizerEmail?: string; recurring?: boolean }
  capture?: { category?: string }
}): void {
  const recId = `rec-${opts.id}`
  dbInstance.run(
    `INSERT INTO transcripts (id, recording_id, full_text, speakers, word_count, action_items, topics)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [opts.id, recId, opts.fullText, opts.speakers ?? null, opts.wordCount ?? null, opts.actionItems ?? null, opts.topics ?? null]
  )
  dbInstance.run(
    `INSERT INTO recordings (id, date_recorded, meeting_id, migrated_to_capture_id) VALUES (?, ?, ?, ?)`,
    [recId, opts.recording?.date ?? null, opts.recording?.meetingId ?? null, opts.recording?.captureId ?? null]
  )
  if (opts.recording?.meetingId) {
    dbInstance.run(`INSERT INTO meetings (id, attendees, organizer_email, is_recurring) VALUES (?, ?, ?, ?)`, [
      opts.recording.meetingId,
      opts.meeting?.attendees ?? null,
      opts.meeting?.organizerEmail ?? null,
      opts.meeting?.recurring ? 1 : 0
    ])
  }
  if (opts.recording?.captureId) {
    dbInstance.run(`INSERT INTO knowledge_captures (id, category) VALUES (?, ?)`, [
      opts.recording.captureId,
      opts.capture?.category ?? null
    ])
  }
}

function transcriptRow(id: string): any {
  return rowsFrom(dbInstance.exec(`SELECT full_text, speakers FROM transcripts WHERE id = ?`, [id]))[0]
}

beforeEach(async () => {
  const SQL = await initSqlJs()
  dbInstance = new SQL.Database()
  seedSchema()
  queueBusy = false
  excludedResult = { ids: new Set<string>(), failClosed: false }
  mockGenerate.mockReset()
  vi.useFakeTimers()
})

afterEach(async () => {
  // Ensure the background reformat worker exits so no timer leaks between tests.
  stopReformatProcessing()
  await vi.advanceTimersByTimeAsync(60000)
  vi.useRealTimers()
  dbInstance?.close()
  dbInstance = null
})

describe('scan / runUpgrade — on-the-fly triage counts + flagging', () => {
  beforeEach(() => {
    // A flat, low-importance transcript → reformat band.
    addTranscript({
      id: 't-flat-low',
      fullText: 'una charla informal sin decisiones ni compromisos, solo hablamos del clima un rato',
      wordCount: 120
    })
    // A flat, high-importance transcript → recommend-retranscribe band.
    addTranscript({
      id: 't-flat-high',
      fullText:
        'Al final decidimos avanzar con el proyecto. Acordamos la fecha límite y firmamos el contrato. ' +
        'El presupuesto fue aprobado y quedamos en los próximos pasos. '.repeat(30),
      wordCount: 4000,
      actionItems: JSON.stringify(['a', 'b', 'c', 'd']),
      topics: JSON.stringify(['x', 'y', 'z', 'w']),
      recording: { date: new Date().toISOString(), meetingId: 'm1', captureId: 'c1' },
      meeting: {
        attendees: JSON.stringify([{ email: 'a@acme.com' }, { email: 'b@client.com' }]),
        organizerEmail: 'me@acme.com'
      },
      capture: { category: 'interview' }
    })
    dbInstance.run(`INSERT INTO meeting_projects (meeting_id, project_id) VALUES ('m1','p1')`)
    // An already-reformatted transcript: flat full_text but speakers carry turns.
    addTranscript({
      id: 't-reformatted',
      fullText: 'bloque plano ya reformateado en turnos guardados en speakers',
      speakers: JSON.stringify([{ speaker: 'Speaker 1', start: 0, text: 'bloque plano' }])
    })
    // A genuinely structured transcript (full_text carries speaker lines).
    addTranscript({
      id: 't-structured',
      fullText: 'Speaker 1: hola\nSpeaker 2: qué tal',
      speakers: JSON.stringify([{ speaker: 'Speaker 1', start: 0, text: 'hola' }])
    })
  })

  it('counts legacy/reformat/recommended/alreadyReformatted and ignores structured rows', () => {
    const res = scanOldTranscripts()
    expect(res.totalTranscripts).toBe(4)
    expect(res.legacyTotal).toBe(2)
    expect(res.toReformat).toBe(1)
    expect(res.recommendedRetranscription).toBe(1)
    expect(res.alreadyReformatted).toBe(1)
  })

  it('scanOldTranscripts writes nothing (speakers untouched)', () => {
    scanOldTranscripts()
    expect(transcriptRow('t-flat-low').speakers).toBeNull()
  })

  it('runUpgrade returns the same counts and does not auto-reformat the flagged band', () => {
    queueBusy = true // keep the worker from processing during assertions
    const res = runUpgrade()
    expect(res.legacyTotal).toBe(2)
    expect(res.toReformat).toBe(1)
    expect(res.recommendedRetranscription).toBe(1)
    // The high-importance row is flagged, never text-reformatted.
    expect(transcriptRow('t-flat-high').speakers).toBeNull()
  })

  it('getRecommendedRecordingIds returns only the flagged legacy recordings', () => {
    expect(getRecommendedRecordingIds()).toEqual(['rec-t-flat-high'])
  })

  it('a custom (low) threshold flags more transcripts for re-transcription', () => {
    // At threshold 5 the low-importance flat row also clears the bar.
    const res = scanOldTranscripts(5)
    expect(res.recommendedRetranscription).toBe(2)
    expect(res.toReformat).toBe(0)
  })
})

describe('reformatOne — text-only reformat write + idempotency', () => {
  beforeEach(() => {
    addTranscript({ id: 't1', fullText: 'hola qué tal bien y tú aquí seguimos trabajando en el proyecto' })
  })

  it('writes reformatted speaker turns into speakers, preserves full_text, and flips out of legacy', async () => {
    mockGenerate.mockResolvedValue(
      '[{"speaker":"Speaker 1","text":"hola qué tal"},{"speaker":"Speaker 2","text":"bien y tú"}]'
    )
    expect(await reformatOne('t1')).toBe('done')

    const t = transcriptRow('t1')
    expect(t.full_text).toBe('hola qué tal bien y tú aquí seguimos trabajando en el proyecto') // untouched
    const segs = JSON.parse(t.speakers)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ speaker: 'Speaker 1', start: 0, text: 'hola qué tal' })

    // Idempotency: the row is no longer legacy, so a re-scan won't re-pick it.
    const res = scanOldTranscripts()
    expect(res.legacyTotal).toBe(0)
    expect(res.alreadyReformatted).toBe(1)
  })

  it('marks failed and leaves speakers untouched when the model call throws', async () => {
    mockGenerate.mockRejectedValue(new Error('quota exceeded'))
    expect(await reformatOne('t1')).toBe('failed')
    expect(transcriptRow('t1').speakers).toBeNull()
  })

  it('fails (does not persist) when the model returns no labelled turns', async () => {
    mockGenerate.mockResolvedValue('[]')
    expect(await reformatOne('t1')).toBe('failed')
    // Unlabelled/degenerate output would still render flat — must not be stored.
    expect(transcriptRow('t1').speakers).toBeNull()
  })
})

describe('kickReformatProcessing — lowest-priority gating behind the audio queue', () => {
  beforeEach(() => {
    addTranscript({ id: 't1', fullText: 'texto plano para reformatear sin estructura alguna' })
    mockGenerate.mockResolvedValue('[{"speaker":"Speaker 1","text":"texto plano para reformatear"}]')
  })

  it('does NOT reformat while the audio queue is busy', async () => {
    queueBusy = true
    void kickReformatProcessing(60, 5000)
    await vi.advanceTimersByTimeAsync(12000) // two poll cycles
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(transcriptRow('t1').speakers).toBeNull()
  })

  it('reformats once the audio queue is idle', async () => {
    queueBusy = false
    await kickReformatProcessing(60, 5000)
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(transcriptRow('t1').speakers).not.toBeNull()
  })
})

describe('getUpgradeStatus', () => {
  it('reports scan counts plus the worker-active flag', () => {
    addTranscript({ id: 't1', fullText: 'un bloque plano sin estructura para reformatear' })
    const status = getUpgradeStatus()
    expect(status.legacyTotal).toBe(1)
    expect(status.reformattingActive).toBe(false)
  })
})

/**
 * RE8-1 (round-8) — reformatOne sends the stored transcript to the chat LLM, so
 * an excluded (personal / trashed / value-excluded) recording must never reach
 * the provider and must never be persisted. The gate is INTERNAL + MANDATORY, so
 * even a direct caller (not just the filtered worker) is fail-closed.
 */
describe('reformatOne — eligibility gate (RE8-1)', () => {
  beforeEach(() => {
    addTranscript({ id: 't1', fullText: 'texto plano para reformatear sin estructura alguna' })
    mockGenerate.mockResolvedValue('[{"speaker":"Speaker 1","text":"texto plano"}]')
  })

  it('skips WITHOUT calling the LLM when the recording is excluded', async () => {
    excludedResult = { ids: new Set(['rec-t1']), failClosed: false }
    expect(await reformatOne('t1')).toBe('skipped')
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(transcriptRow('t1').speakers).toBeNull()
  })

  it('fails closed (skips, no LLM) when eligibility cannot be verified', async () => {
    excludedResult = { ids: new Set<string>(), failClosed: true }
    expect(await reformatOne('t1')).toBe('skipped')
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(transcriptRow('t1').speakers).toBeNull()
  })

  it('does not persist when the recording becomes excluded mid-run (after the LLM await)', async () => {
    // Eligible at entry, but a trash/exclusion lands during the provider round-trip.
    mockGenerate.mockImplementation(async () => {
      excludedResult = { ids: new Set(['rec-t1']), failClosed: false }
      return '[{"speaker":"Speaker 1","text":"texto plano"}]'
    })
    expect(await reformatOne('t1')).toBe('skipped')
    expect(transcriptRow('t1').speakers).toBeNull()
  })

  it('kickReformatProcessing never enqueues an excluded transcript for the LLM', async () => {
    excludedResult = { ids: new Set(['rec-t1']), failClosed: false }
    queueBusy = false
    await kickReformatProcessing(60, 5000)
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(transcriptRow('t1').speakers).toBeNull()
  })

  it('kickReformatProcessing suppresses the whole work list when eligibility is unavailable', async () => {
    excludedResult = { ids: new Set<string>(), failClosed: true }
    queueBusy = false
    await kickReformatProcessing(60, 5000)
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})
