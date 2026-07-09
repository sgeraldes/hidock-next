/**
 * Transcript-upgrade service tests.
 *
 * Runs against a real in-memory sql.js DB with '../database' mocked to delegate
 * query/run to it, and '../chat-llm' mocked so the reformat path uses a fake
 * model. Covers: assess-and-persist counts + flagging, the text-only reformat
 * write (speakers updated, full_text preserved), lowest-priority gating behind
 * the audio queue, and recommended-recording surfacing.
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
  getQueueItems: (status?: string) => (queueBusy && status === 'pending' ? [{ id: 'q1' }] : [])
}))

const mockGenerate = vi.fn()
vi.mock('../chat-llm', () => ({
  getChatLLMService: () => ({ generate: mockGenerate })
}))

import {
  assessAndPersistAll,
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
    CREATE TABLE transcript_triage (
      transcript_id TEXT PRIMARY KEY, recording_id TEXT, is_legacy_format INTEGER DEFAULT 0,
      triage_score INTEGER, triage_band TEXT, triage_signals TEXT,
      recommended_retranscription INTEGER DEFAULT 0, reformat_status TEXT DEFAULT 'none',
      reformat_error TEXT, reformatted_at TEXT, assessed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
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

function triageRow(transcriptId: string): any {
  return rowsFrom(dbInstance.exec(`SELECT * FROM transcript_triage WHERE transcript_id = ?`, [transcriptId]))[0]
}

beforeEach(async () => {
  const SQL = await initSqlJs()
  dbInstance = new SQL.Database()
  seedSchema()
  queueBusy = false
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

describe('assessAndPersistAll — triage counts, flagging, queueing', () => {
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
      meeting: { attendees: JSON.stringify([{ email: 'a@acme.com' }, { email: 'b@client.com' }]), organizerEmail: 'me@acme.com' },
      capture: { category: 'interview' }
    })
    dbInstance.run(`INSERT INTO meeting_projects (meeting_id, project_id) VALUES ('m1','p1')`)
    // A structured (non-legacy) transcript → ignored.
    addTranscript({
      id: 't-structured',
      fullText: 'Speaker 1: hola\nSpeaker 2: qué tal',
      speakers: JSON.stringify([{ speaker: 'Speaker 1', start: 0, text: 'hola' }])
    })
  })

  it('counts legacy/reformat/recommended correctly and ignores structured transcripts', () => {
    queueBusy = true // keep the worker from processing during assertions
    const res = assessAndPersistAll()
    expect(res.legacyTotal).toBe(2)
    expect(res.toReformat).toBe(1)
    expect(res.recommendedRetranscription).toBe(1)
    expect(res.totalTranscripts).toBe(3)
  })

  it('queues the low-importance transcript for reformat and flags the high-importance one', () => {
    queueBusy = true
    assessAndPersistAll()

    const low = triageRow('t-flat-low')
    expect(low.is_legacy_format).toBe(1)
    expect(low.reformat_status).toBe('queued')
    expect(low.recommended_retranscription).toBe(0)

    const high = triageRow('t-flat-high')
    expect(high.recommended_retranscription).toBe(1)
    expect(high.triage_band).toBe('recommend-retranscribe')
    expect(high.reformat_status).toBe('none') // recommended band is NOT auto-reformatted

    const structured = triageRow('t-structured')
    expect(structured.is_legacy_format).toBe(0)
  })

  it('scanOldTranscripts is read-only (no triage rows written)', () => {
    const res = scanOldTranscripts()
    expect(res.legacyTotal).toBe(2)
    expect(rowsFrom(dbInstance.exec(`SELECT COUNT(*) AS c FROM transcript_triage`))[0].c).toBe(0)
  })
})

describe('reformatOne — text-only reformat write', () => {
  beforeEach(() => {
    addTranscript({ id: 't1', fullText: 'hola qué tal bien y tú aquí seguimos trabajando en el proyecto' })
    dbInstance.run(
      `INSERT INTO transcript_triage (transcript_id, recording_id, is_legacy_format, reformat_status)
       VALUES ('t1','rec-t1',1,'queued')`
    )
  })

  it('writes reformatted speaker turns into speakers and preserves full_text', async () => {
    mockGenerate.mockResolvedValue(
      '[{"speaker":"Speaker 1","text":"hola qué tal"},{"speaker":"Speaker 2","text":"bien y tú"}]'
    )
    const result = await reformatOne('t1')
    expect(result).toBe('done')

    const t = rowsFrom(dbInstance.exec(`SELECT full_text, speakers FROM transcripts WHERE id = 't1'`))[0]
    expect(t.full_text).toBe('hola qué tal bien y tú aquí seguimos trabajando en el proyecto') // untouched
    const segs = JSON.parse(t.speakers)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ speaker: 'Speaker 1', start: 0, text: 'hola qué tal' })

    const row = triageRow('t1')
    expect(row.reformat_status).toBe('done')
    expect(row.reformatted_at).toBeTruthy()
  })

  it('marks failed (and records the error) when the model call throws', async () => {
    mockGenerate.mockRejectedValue(new Error('quota exceeded'))
    const result = await reformatOne('t1')
    expect(result).toBe('failed')
    const row = triageRow('t1')
    expect(row.reformat_status).toBe('failed')
    expect(row.reformat_error).toContain('quota')
  })

  it('keeps the block text as a plain turn when the model returns nothing usable', async () => {
    mockGenerate.mockResolvedValue('[]')
    const result = await reformatOne('t1')
    expect(result).toBe('done')
    const t = rowsFrom(dbInstance.exec(`SELECT speakers FROM transcripts WHERE id = 't1'`))[0]
    const segs = JSON.parse(t.speakers)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toContain('hola qué tal')
  })
})

describe('kickReformatProcessing — lowest-priority gating behind the audio queue', () => {
  beforeEach(() => {
    addTranscript({ id: 't1', fullText: 'texto plano para reformatear' })
    dbInstance.run(
      `INSERT INTO transcript_triage (transcript_id, recording_id, is_legacy_format, reformat_status)
       VALUES ('t1','rec-t1',1,'queued')`
    )
    mockGenerate.mockResolvedValue('[{"speaker":"Speaker 1","text":"texto plano para reformatear"}]')
  })

  it('does NOT reformat while the audio queue is busy', async () => {
    queueBusy = true
    void kickReformatProcessing(5000)
    await vi.advanceTimersByTimeAsync(12000) // two poll cycles
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(triageRow('t1').reformat_status).toBe('queued')
  })

  it('reformats once the audio queue is idle', async () => {
    queueBusy = false
    await kickReformatProcessing(5000)
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(triageRow('t1').reformat_status).toBe('done')
  })
})

describe('getRecommendedRecordingIds / getUpgradeStatus', () => {
  it('returns recording ids flagged for re-transcription', () => {
    dbInstance.run(
      `INSERT INTO transcript_triage (transcript_id, recording_id, recommended_retranscription) VALUES ('t1','rec-1',1)`
    )
    dbInstance.run(
      `INSERT INTO transcript_triage (transcript_id, recording_id, recommended_retranscription) VALUES ('t2','rec-2',0)`
    )
    expect(getRecommendedRecordingIds()).toEqual(['rec-1'])
  })

  it('reports a reformat-status breakdown', () => {
    dbInstance.run(
      `INSERT INTO transcript_triage (transcript_id, recording_id, is_legacy_format, reformat_status) VALUES ('t1','rec-1',1,'queued')`
    )
    const status = getUpgradeStatus()
    expect(status.reformat.queued).toBe(1)
  })
})
