// @vitest-environment node

/**
 * Re-diarize service — clearing AUTO speaker bindings while preserving MANUAL
 * corrections, and re-queueing one recording for re-segmentation.
 *
 * Exercises the real sql.js engine (temp-file backed) so the clear logic is
 * tested against actual SQL semantics. The heavy transcription service (queue
 * processing) is mocked so the orchestrator can be exercised without touching a
 * provider.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-rediarize-${process.pid}.sqlite`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => dbPath
}))

// Mock the transcription service so reDiarizeRecording's lazy import resolves to
// no-op queue hooks (no real provider / mainWindow needed).
const markUserPriority = vi.fn()
const processQueueManually = vi.fn(() => Promise.resolve())
vi.mock('../transcription', () => ({
  markUserPriority,
  processQueueManually
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  assignSpeaker,
  resolveMention,
  getSpeakerMap,
  setTurnOverride,
  getTurnOverrides,
  assignSpeakerFromHere,
  getSpeakerSplits
} from '../database'
import * as database from '../database'
import {
  clearAutoSpeakerBindingsForReDiarize,
  reDiarizeRecording,
  ReDiarizeError,
  RE_DIARIZE_INELIGIBLE,
  RE_DIARIZE_ENQUEUE_FAILED
} from '../re-diarize'

const SELF_ID_METHOD = 'self-identification'

function seedRecording(id: string, meetingId: string | null = null): void {
  run('INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
    id,
    `${id}.wav`,
    '2026-01-01T10:00:00.000Z',
    meetingId
  ])
}

function seedContact(id: string, name: string): void {
  // round-39: source='user' ⇒ VISIBLE structural contact (a real owner contact). The
  // entity-reference-WRITE gates bind only visible contacts; a bare NULL-source contact
  // is suppressed and would never be offered by a picker in production.
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, source)
     VALUES (?, ?, 'unknown', ?, ?, 0, 'user')`,
    [id, name, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
  )
}

/** Bind label→contact the way the AUTO self-identification pass does: assign +
 *  record a 'self-identification' mention resolution. */
function autoBind(recordingId: string, label: string, contactId: string, name: string): void {
  assignSpeaker(recordingId, label, { contactId })
  resolveMention(recordingId, name, contactId, SELF_ID_METHOD, 0.97)
}

function setMarker(key: string): void {
  run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, 'x'])
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  seedRecording('rec1')
  seedContact('memo', 'Memo')
  seedContact('seba', 'Sebastian')
  seedContact('oscar', 'Oscar')
  markUserPriority.mockClear()
  processQueueManually.mockClear()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('clearAutoSpeakerBindingsForReDiarize', () => {
  it('clears auto label bindings but preserves manual ones', () => {
    // Auto: bound by the self-id pass (has a self-identification mention).
    autoBind('rec1', 'Speaker 1', 'memo', 'Memo')
    autoBind('rec1', 'Speaker 2', 'seba', 'Sebastian')
    // Manual: user assigned this label directly (no self-id mention).
    assignSpeaker('rec1', 'Speaker 3', { contactId: 'oscar' })

    const res = clearAutoSpeakerBindingsForReDiarize('rec1')

    expect(res.clearedLabelBindings).toBe(2)
    const remaining = getSpeakerMap('rec1')
    expect(remaining.map((r) => r.speaker_label)).toEqual(['Speaker 3'])
    expect(remaining[0].contact_id).toBe('oscar')
  })

  it('clears self-identification mentions but keeps manual mentions', () => {
    autoBind('rec1', 'Speaker 1', 'memo', 'Memo')
    resolveMention('rec1', 'Somebody', 'seba', 'manual', 1.0)

    const res = clearAutoSpeakerBindingsForReDiarize('rec1')

    expect(res.clearedMentions).toBe(1)
    const mentions = queryAll<{ method: string }>('SELECT method FROM mention_resolutions WHERE recording_id = ?', [
      'rec1'
    ])
    expect(mentions.map((m) => m.method)).toEqual(['manual'])
  })

  it('clears self-id config markers (scanned + merge-suspected)', () => {
    setMarker('self_id:scanned:rec1')
    setMarker('self_id:merge_suspected:rec1:Speaker 1')
    setMarker('self_id:merge_suspected:rec1:Speaker 2')
    // A marker for a DIFFERENT recording must survive.
    setMarker('self_id:scanned:rec2')

    const res = clearAutoSpeakerBindingsForReDiarize('rec1')

    expect(res.clearedMarkers).toBe(3)
    expect(queryOne('SELECT key FROM config WHERE key = ?', ['self_id:scanned:rec1'])).toBeUndefined()
    expect(queryOne('SELECT key FROM config WHERE key = ?', ['self_id:scanned:rec2'])).toBeTruthy()
  })

  it('preserves per-turn overrides and speaker splits (manual corrections)', () => {
    autoBind('rec1', 'Speaker 1', 'memo', 'Memo')
    // Manual per-turn override.
    setTurnOverride('rec1', 5, { contactId: 'seba' })
    // Manual split: forks Speaker 1 into a derived label bound to Oscar.
    const { derivedLabel } = assignSpeakerFromHere('rec1', 'Speaker 1', 10, { contactId: 'oscar' })

    clearAutoSpeakerBindingsForReDiarize('rec1')

    // Turn override intact.
    expect(getTurnOverrides('rec1').map((o) => o.turn_index)).toEqual([5])
    // Split intact.
    expect(getSpeakerSplits('rec1').map((s) => s.derived_label)).toEqual([derivedLabel])
    // The split-derived label binding is manual and must survive even though its
    // contact (oscar) could be auto-bound elsewhere.
    const labels = getSpeakerMap('rec1').map((r) => r.speaker_label)
    expect(labels).toContain(derivedLabel)
  })

  it('does not clear a split-derived binding whose contact is also auto-bound', () => {
    // Auto-bind Oscar to a plain label AND have a derived split bound to Oscar.
    autoBind('rec1', 'Speaker 1', 'oscar', 'Oscar')
    const { derivedLabel } = assignSpeakerFromHere('rec1', 'Speaker 2', 3, { contactId: 'oscar' })

    clearAutoSpeakerBindingsForReDiarize('rec1')

    const labels = getSpeakerMap('rec1').map((r) => r.speaker_label)
    expect(labels).not.toContain('Speaker 1') // auto — cleared
    expect(labels).toContain(derivedLabel) // manual split — preserved
  })

  it('is idempotent — a second run clears nothing', () => {
    autoBind('rec1', 'Speaker 1', 'memo', 'Memo')
    setMarker('self_id:scanned:rec1')

    const first = clearAutoSpeakerBindingsForReDiarize('rec1')
    expect(first.clearedLabelBindings + first.clearedMentions + first.clearedMarkers).toBeGreaterThan(0)

    const second = clearAutoSpeakerBindingsForReDiarize('rec1')
    expect(second).toEqual({ clearedLabelBindings: 0, clearedMentions: 0, clearedMarkers: 0 })
  })

  it('is a no-op on a recording with no bindings', () => {
    const res = clearAutoSpeakerBindingsForReDiarize('rec1')
    expect(res).toEqual({ clearedLabelBindings: 0, clearedMentions: 0, clearedMarkers: 0 })
  })
})

describe('reDiarizeRecording', () => {
  it('clears auto bindings, enqueues, marks priority, and kicks the queue', async () => {
    autoBind('rec1', 'Speaker 1', 'memo', 'Memo')
    assignSpeaker('rec1', 'Speaker 2', { contactId: 'seba' }) // manual — preserved

    const result = await reDiarizeRecording('rec1', 'gemini')

    // Cleared exactly the one auto binding.
    expect(result.cleared.clearedLabelBindings).toBe(1)
    expect(getSpeakerMap('rec1').map((r) => r.speaker_label)).toEqual(['Speaker 2'])

    // Enqueued a real queue item with the requested provider.
    expect(result.queueItemId).toBeTruthy()
    const item = queryOne<{ recording_id: string; provider: string }>(
      'SELECT recording_id, provider FROM transcription_queue WHERE id = ?',
      [result.queueItemId]
    )
    expect(item?.recording_id).toBe('rec1')
    expect(item?.provider).toBe('gemini')

    // Recording marked queued, priority hint + queue kick invoked.
    const rec = queryOne<{ transcription_status: string }>(
      'SELECT transcription_status FROM recordings WHERE id = ?',
      ['rec1']
    )
    expect(rec?.transcription_status).toBe('queued')
    expect(markUserPriority).toHaveBeenCalledWith('rec1')
    expect(processQueueManually).toHaveBeenCalled()
  })
})

/**
 * ADV46-1 (round-48) — re-diarize must ASSERT recording eligibility BEFORE it
 * destroys any identity state, and clear+enqueue+status must be ONE atomic
 * transaction that rolls back on any enqueue/status failure. Re-diarize feeds the
 * transcription/analysis AI pipeline, so an excluded recording must not be
 * re-diarized/re-queued (like `transcribe`) — this is NOT a deletion control.
 */
describe('reDiarizeRecording — eligibility gate + atomicity (ADV46-1)', () => {
  const SCANNED_KEY = (recId: string): string => `self_id:scanned:${recId}`

  /** Seed an ELIGIBLE recording carrying AUTO identity state (bindings + mention
   *  + self-id marker). Bindings are created while the recording is eligible
   *  (round-47's speaker-mutation gate blocks creating them on an excluded
   *  recording), matching the real world: state exists, THEN the recording is
   *  excluded, THEN a stale reDiarize arrives. */
  function seedWithAutoState(recId: string): void {
    seedRecording(recId)
    autoBind(recId, 'Speaker 1', 'memo', 'Memo') // 1 binding + 1 self-id mention
    setMarker(SCANNED_KEY(recId))
  }

  /** True iff the auto identity state seeded by {@link seedWithAutoState} is all
   *  still present (nothing was cleared). */
  function autoStateIntact(recId: string): boolean {
    const bindings = getSpeakerMap(recId).length
    const mentions = queryAll('SELECT id FROM mention_resolutions WHERE recording_id = ?', [recId]).length
    const marker = queryAll('SELECT key FROM config WHERE key = ?', [SCANNED_KEY(recId)]).length
    return bindings === 1 && mentions === 1 && marker === 1
  }

  function isQueued(recId: string): boolean {
    return queryAll('SELECT id FROM transcription_queue WHERE recording_id = ?', [recId]).length > 0
  }

  function statusOf(recId: string): string | null | undefined {
    return queryOne<{ transcription_status: string | null }>(
      'SELECT transcription_status FROM recordings WHERE id = ?',
      [recId]
    )?.transcription_status
  }

  it('REFUSES a soft-deleted recording — nothing cleared, not queued, honest failure', async () => {
    seedWithAutoState('rec-del')
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-01T00:00:00Z', 'rec-del'])
    const statusBefore = statusOf('rec-del')

    await expect(reDiarizeRecording('rec-del', 'gemini')).rejects.toMatchObject({
      code: RE_DIARIZE_INELIGIBLE
    })

    expect(autoStateIntact('rec-del')).toBe(true)
    expect(isQueued('rec-del')).toBe(false)
    expect(statusOf('rec-del')).toBe(statusBefore)
    expect(markUserPriority).not.toHaveBeenCalled()
    expect(processQueueManually).not.toHaveBeenCalled()
  })

  it('REFUSES a personal recording — nothing cleared, not queued', async () => {
    seedWithAutoState('rec-pers')
    run('UPDATE recordings SET personal = 1 WHERE id = ?', ['rec-pers'])

    await expect(reDiarizeRecording('rec-pers')).rejects.toMatchObject({ code: RE_DIARIZE_INELIGIBLE })

    expect(autoStateIntact('rec-pers')).toBe(true)
    expect(isQueued('rec-pers')).toBe(false)
  })

  it('REFUSES a value-excluded recording — nothing cleared, not queued', async () => {
    seedWithAutoState('rec-val')
    // A garbage capture with no keep-rated sibling ⇒ recording value-excluded.
    run(
      `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating)
       VALUES (?, 'C', '2026-06-01', ?, 'garbage')`,
      ['cap-rec-val', 'rec-val']
    )

    await expect(reDiarizeRecording('rec-val')).rejects.toMatchObject({ code: RE_DIARIZE_INELIGIBLE })

    expect(autoStateIntact('rec-val')).toBe(true)
    expect(isQueued('rec-val')).toBe(false)
  })

  it('REFUSES a hard-purged recording — marker left intact, not queued', async () => {
    // Self-id config marker for a recording whose row is gone (hard-purged). The
    // marker is NOT FK-linked to recordings, so it survives and must NOT be
    // cleared by a refused re-diarize.
    setMarker(SCANNED_KEY('rec-gone'))

    await expect(reDiarizeRecording('rec-gone')).rejects.toMatchObject({ code: RE_DIARIZE_INELIGIBLE })

    expect(queryAll('SELECT key FROM config WHERE key = ?', [SCANNED_KEY('rec-gone')]).length).toBe(1)
    expect(isQueued('rec-gone')).toBe(false)
  })

  it('FAILS CLOSED when the eligibility lookup cannot complete — nothing cleared', async () => {
    seedWithAutoState('rec-fc')
    expect(queryAll('SELECT key FROM config WHERE key = ?', [SCANNED_KEY('rec-fc')]).length).toBe(1)
    // Force the recording-eligibility lookup to throw ⇒ isRecordingEligible
    // returns false (fail-closed) ⇒ re-diarize must refuse BEFORE the clear step.
    // NOTE: DROP TABLE recordings does an implicit DELETE that cascades to the
    // FK-linked identity tables (transcript_speakers / mention_resolutions), so
    // those rows vanish as a TEST artifact — not from re-diarize. The self-id
    // config marker is NOT FK-linked, so its survival is the true proof that the
    // clear (which deletes that marker) never ran.
    run('DROP TABLE recordings')

    await expect(reDiarizeRecording('rec-fc')).rejects.toBeInstanceOf(ReDiarizeError)

    // Clear never ran ⇒ the (non-cascaded) self-id marker is untouched.
    expect(queryAll('SELECT key FROM config WHERE key = ?', [SCANNED_KEY('rec-fc')]).length).toBe(1)
    // Not queued; queue never kicked.
    expect(queryAll('SELECT id FROM transcription_queue WHERE recording_id = ?', ['rec-fc']).length).toBe(0)
    expect(markUserPriority).not.toHaveBeenCalled()
    expect(processQueueManually).not.toHaveBeenCalled()
  })

  it('ROLLS BACK everything when enqueue returns an empty id on an ELIGIBLE recording', async () => {
    seedWithAutoState('rec-enq')
    const statusBefore = statusOf('rec-enq')
    // Inject an enqueue failure: addToQueue returns '' though the recording is eligible.
    const spy = vi.spyOn(database, 'addToQueue').mockReturnValue('')
    try {
      await expect(reDiarizeRecording('rec-enq', 'gemini')).rejects.toMatchObject({
        code: RE_DIARIZE_ENQUEUE_FAILED
      })
    } finally {
      spy.mockRestore()
    }

    // FULL rollback: the clear was undone (bindings/mention/marker intact),
    // status unchanged, nothing queued, queue never kicked.
    expect(autoStateIntact('rec-enq')).toBe(true)
    expect(statusOf('rec-enq')).toBe(statusBefore)
    expect(isQueued('rec-enq')).toBe(false)
    expect(markUserPriority).not.toHaveBeenCalled()
    expect(processQueueManually).not.toHaveBeenCalled()
  })

  it('happy path — an ELIGIBLE recording is cleared, queued, and marked (unchanged behavior)', async () => {
    seedWithAutoState('rec-ok')

    const result = await reDiarizeRecording('rec-ok', 'gemini')

    expect(result.cleared.clearedLabelBindings).toBe(1)
    expect(result.cleared.clearedMentions).toBe(1)
    expect(result.cleared.clearedMarkers).toBe(1)
    expect(getSpeakerMap('rec-ok').length).toBe(0)
    expect(result.queueItemId).toBeTruthy()
    expect(isQueued('rec-ok')).toBe(true)
    expect(statusOf('rec-ok')).toBe('queued')
    expect(markUserPriority).toHaveBeenCalledWith('rec-ok')
    expect(processQueueManually).toHaveBeenCalled()
  })
})
