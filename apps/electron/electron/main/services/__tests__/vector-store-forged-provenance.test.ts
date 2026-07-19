// @vitest-environment node

/**
 * ADV11 (round-12) — captureId-trust provenance bypass, closed by POSITIVE
 * DB resolution. Runs the REAL vector store against a REAL temp DB (real
 * getExistingRecordingIds / getEligibleRecordingIds / getExistingCaptureIds).
 *
 * Round-11 decided recording-backed-ness by `captureId` PRESENCE, trusting a
 * field the renderer can set (the rag:index-transcript IPC forwarded renderer
 * metadata unstripped). A renderer could index `{recordingId: <excludedId>,
 * captureId: <forged>}` so an excluded recording's chunks masqueraded as an
 * artifact and skipped the recording allowlist. The fix resolves provenance
 * positively against the DB: a real recording id ALWAYS obeys the allowlist (a
 * forged captureId cannot exempt it); a non-recording id is a genuine artifact
 * ONLY when its captureId names a real knowledge_captures row.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv11-forged-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

// Deterministic offline embeddings so search runs without a provider.
vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: async () => [1, 0, 0],
    generateEmbeddings: async (texts: string[]) => texts.map(() => [1, 0, 0])
  })
}))

import { initializeDatabase, closeDatabase, run } from '../database'
import { VectorStore } from '../vector-store'

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    `${id}.hda`,
    '2026-06-01',
    opts.personal ? 1 : 0,
    opts.deleted ? '2026-07-01T00:00:00.000Z' : null
  ])
}

function seedCapture(id: string, recordingId: string | null, rating = 'unrated'): void {
  run(
    'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)',
    [id, 'Cap', '2026-06-01', recordingId, rating]
  )
}

async function newStore(): Promise<VectorStore> {
  const store = new VectorStore()
  await store.initialize()
  return store
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('ADV11 — forged captureId cannot bypass the recording allowlist', () => {
  it('a value-excluded recording with a FORGED captureId is dropped from search', async () => {
    // A real recording that is value-excluded (garbage-rated capture, no keep).
    seedRecording('rec-excluded')
    seedCapture('cap-garbage', 'rec-excluded', 'garbage')

    const store = await newStore()
    // Attacker indexes the excluded recording's content pretending it is an
    // artifact by attaching a captureId that does NOT belong to it.
    await store.addDocument('secret excluded transcript content', {
      recordingId: 'rec-excluded',
      captureId: 'forged-xyz',
      chunkIndex: 0
    })

    const ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId)
    // recordingId resolves to a REAL recording ⇒ obeys the allowlist ⇒ excluded.
    expect(ids).not.toContain('rec-excluded')
    expect(ids).toEqual([])
  })

  it('a hard-purged recordingId with a FORGED captureId is dropped (orphan)', async () => {
    const store = await newStore()
    // No recording row and no capture row exist for these ids.
    await store.addDocument('orphaned excluded content', {
      recordingId: 'rec-hard-purged',
      captureId: 'forged-xyz',
      chunkIndex: 0
    })

    const ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId)
    // recordingId does not resolve to a recording AND captureId is not a real
    // capture ⇒ forged/orphan ⇒ dropped.
    expect(ids).toEqual([])
  })

  it('a GENUINE artifact (real capture, non-recording id) is retained', async () => {
    // A real standalone capture; the artifact chunk carries the artifact id in
    // recordingId (never a recording row) and the real capture id in captureId.
    seedCapture('cap-real', null)
    const store = await newStore()
    await store.addDocument('genuine pdf artifact text', {
      recordingId: 'art-pdf',
      captureId: 'cap-real',
      sourceType: 'pdf',
      chunkIndex: 0
    })

    const ids = (await store.search('anything', 10)).map((r) => r.document.metadata.captureId)
    expect(ids).toEqual(['cap-real'])
  })

  it('a clean recording transcript is retained, then dropped once value-excluded', async () => {
    seedRecording('rec-clean')
    const store = await newStore()
    // Real transcript indexing NEVER sets captureId.
    await store.addDocument('a clean meeting transcript', {
      recordingId: 'rec-clean',
      chunkIndex: 0
    })

    let ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId)
    expect(ids).toEqual(['rec-clean'])

    // The same recording becomes value-excluded (garbage rating, no keep).
    seedCapture('cap-garbage', 'rec-clean', 'garbage')
    ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId)
    expect(ids).toEqual([])
  })

  it('the forged chunk cannot leak via meeting-scoped retrieval either', async () => {
    seedRecording('rec-excluded')
    seedCapture('cap-garbage', 'rec-excluded', 'garbage')
    const store = await newStore()
    await store.addDocument('secret excluded content', {
      recordingId: 'rec-excluded',
      captureId: 'forged-xyz',
      meetingId: 'm-1',
      chunkIndex: 0
    })
    const docs = await store.searchByMeeting('m-1')
    expect(docs).toEqual([])
  })
})

describe('ADV23-1 (round-24) — null-provenance rows require POSITIVE provenance', () => {
  it('a doc with NEITHER recordingId nor captureId is absent from search, searchByMeeting AND getAllDocuments', async () => {
    const store = await newStore()
    // A legacy null-provenance row (the removed optional-metadata index path could
    // create these): no recordingId, no captureId — unassociable, so it survived
    // every exclusion/hard-purge and still reached RAG + the chunk viewer.
    await store.addDocument('legacy null-provenance content', {
      meetingId: 'm-legacy',
      chunkIndex: 0
    })
    // Absent everywhere: no positive provenance to prove eligibility.
    expect(await store.search('anything', 10)).toEqual([])
    expect(await store.searchByMeeting('m-legacy')).toEqual([])
    expect(store.getAllDocuments()).toEqual([])
  })

  it('a genuine eligible transcript AND a genuine eligible artifact still surface', async () => {
    seedRecording('rec-live')
    seedCapture('cap-live', null) // standalone eligible capture
    const store = await newStore()
    await store.addDocument('a real transcript', { recordingId: 'rec-live', chunkIndex: 0 })
    await store.addDocument('a real pdf artifact', {
      recordingId: 'art-pdf',
      captureId: 'cap-live',
      sourceType: 'pdf',
      chunkIndex: 0
    })
    // Both positive-provenance docs survive; the neither-id row (if any) would not.
    await store.addDocument('legacy null-provenance content', { chunkIndex: 0 })

    const recIds = store.getAllDocuments().map((d) => d.metadata.recordingId).sort()
    expect(recIds).toEqual(['art-pdf', 'rec-live'])
    const searchIds = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId).sort()
    expect(searchIds).toEqual(['art-pdf', 'rec-live'])
  })
})
