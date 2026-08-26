// @vitest-environment node

/**
 * Retracting an automatic meeting link the current gate no longer supports.
 *
 * Live failure (Rec91, 2026-08-18): one capture ran across the end of a
 * Delivery-Framework 1:1 and the whole of a candidate interview, because the
 * device does not cut when you jump between meetings. It was split by hand into
 * "- Part 1" / "- Part 2" so each part would be its own meeting. Part 1 is a
 * complete separate meeting that is not even on the calendar — but it stayed
 * attached to the INTERVIEW at confidence 0.80, written by an older gate whose
 * threshold was 0.40. The current gate (0.85 + margin + content evidence)
 * correctly refuses to select it, and the candidate rows say so, yet nothing
 * cleared the old link: auto-linking only ever ADDED.
 *
 * Covers:
 *  - a machine-made link below the current gate is retracted;
 *  - retraction leaves the recording eligible for future auto-linking
 *    (method NULL, NOT the user's standalone marker);
 *  - a user's link is never retracted;
 *  - knowledge_captures follows the recording.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-stale-autolink-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))
vi.mock('electron', () => ({
  app: { getPath: () => 'test-path' },
  ipcMain: { handle: () => {} }
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  getRecordingById,
  clearAutomaticMeetingLink,
  isAutomaticCorrelationMethod,
  findContradictedAutomaticLinks,
  repairContradictedAutomaticLinks
} from '../../services/database'

const INTERVIEW = 'm-interview'

function seedRecording(id: string, method: string | null, confidence: number | null): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, meeting_id, correlation_confidence,
       correlation_method, duration_seconds)
     VALUES (?, ?, '2026-08-18T17:25:05.000Z', ?, ?, ?, 1474)`,
    [id, `${id}.flac`, INTERVIEW, confidence, method]
  )
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  run(
    `INSERT INTO meetings (id, subject, start_time, end_time, is_recurring, created_at, updated_at)
     VALUES (?, 'DFX5 Interview is scheduled', '2026-08-18T17:45:00.000Z',
             '2026-08-18T18:45:00.000Z', 0, '2026-01-01', '2026-01-01')`,
    [INTERVIEW]
  )
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('isAutomaticCorrelationMethod', () => {
  it('recognises machine-made links', () => {
    for (const m of ['ai_transcript_match', 'time_overlap', 'calendar', 'auto']) {
      expect(isAutomaticCorrelationMethod(m)).toBe(true)
    }
  })

  it('never claims a human decision as automatic', () => {
    for (const m of ['manual', 'user_override', 'user_preassign', 'user_preassign_standalone']) {
      expect(isAutomaticCorrelationMethod(m)).toBe(false)
    }
    expect(isAutomaticCorrelationMethod(null)).toBe(false)
    expect(isAutomaticCorrelationMethod(undefined)).toBe(false)
  })
})

describe('clearAutomaticMeetingLink', () => {
  it('retracts the stale ai_transcript_match link (the Part 1 failure)', () => {
    seedRecording('part-1', 'ai_transcript_match', 0.8)

    expect(clearAutomaticMeetingLink('part-1')).toBe(true)

    const rec = getRecordingById('part-1')!
    expect(rec.meeting_id).toBeNull()
    expect(rec.correlation_confidence).toBeNull()
  })

  it('leaves the recording eligible for future auto-linking', () => {
    seedRecording('part-1', 'ai_transcript_match', 0.8)
    clearAutomaticMeetingLink('part-1')

    // NOT 'user_preassign_standalone' — that marker means the USER said this
    // belongs to no meeting and permanently blocks the batch auto-linker.
    expect(getRecordingById('part-1')!.correlation_method).toBeNull()
  })

  it('never retracts a link the user made', () => {
    for (const method of ['manual', 'user_override', 'user_preassign']) {
      const id = `rec-${method}`
      seedRecording(id, method, 1.0)
      expect(clearAutomaticMeetingLink(id)).toBe(false)
      expect(getRecordingById(id)!.meeting_id).toBe(INTERVIEW)
      expect(getRecordingById(id)!.correlation_method).toBe(method)
    }
  })

  it('clears the matching knowledge capture too', () => {
    seedRecording('part-1', 'ai_transcript_match', 0.8)
    run(
      `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, meeting_id)
       VALUES ('cap-1', 'Part 1', '2026-08-18', 'part-1', ?)`,
      [INTERVIEW]
    )

    clearAutomaticMeetingLink('part-1')

    const cap = queryOne<{ meeting_id: string | null }>(
      'SELECT meeting_id FROM knowledge_captures WHERE id = ?',
      ['cap-1']
    )
    expect(cap!.meeting_id).toBeNull()
  })

  it('is a no-op on an already-unlinked recording', () => {
    run(
      `INSERT INTO recordings (id, filename, date_recorded, duration_seconds)
       VALUES ('solo', 'solo.flac', '2026-08-18T17:25:05.000Z', 100)`
    )
    expect(clearAutomaticMeetingLink('solo')).toBe(false)
  })
})

describe('repairContradictedAutomaticLinks', () => {
  function addCandidate(recordingId: string, meetingId: string, selected: 0 | 1): void {
    run(
      `INSERT INTO recording_meeting_candidates (id, recording_id, meeting_id, confidence_score,
         match_reason, is_selected)
       VALUES (?, ?, ?, 0.53, 'Overlaps 19% of the recording', ?)`,
      [`cand-${recordingId}-${meetingId}-${selected}`, recordingId, meetingId, selected]
    )
  }

  it('finds a link no candidate row supports (the live Part 1 row)', () => {
    seedRecording('part-1', 'ai_transcript_match', 0.8)
    addCandidate('part-1', INTERVIEW, 0)

    const found = findContradictedAutomaticLinks()
    expect(found).toHaveLength(1)
    expect(found[0].recordingId).toBe('part-1')
    expect(found[0].correlationConfidence).toBe(0.8)
  })

  it('leaves a link the candidate evidence DOES support', () => {
    seedRecording('good', 'ai_transcript_match', 0.95)
    addCandidate('good', INTERVIEW, 1)

    expect(findContradictedAutomaticLinks()).toEqual([])
  })

  it('never judges a recording that was never analysed', () => {
    // No candidate rows at all = not yet evaluated, not contradicted.
    seedRecording('unanalysed', 'ai_transcript_match', 0.8)
    expect(findContradictedAutomaticLinks()).toEqual([])
  })

  it('never touches a link the user made', () => {
    seedRecording('mine', 'user_override', 1.0)
    addCandidate('mine', INTERVIEW, 0)
    expect(findContradictedAutomaticLinks()).toEqual([])
  })

  it('retracts what it finds and reports it', () => {
    seedRecording('part-1', 'ai_transcript_match', 0.8)
    addCandidate('part-1', INTERVIEW, 0)

    const repaired = repairContradictedAutomaticLinks()

    expect(repaired.map((r) => r.recordingId)).toEqual(['part-1'])
    expect(getRecordingById('part-1')!.meeting_id).toBeNull()
    expect(getRecordingById('part-1')!.correlation_method).toBeNull()
    // Idempotent.
    expect(repairContradictedAutomaticLinks()).toEqual([])
  })

  it('ignores a soft-deleted recording', () => {
    seedRecording('trashed', 'ai_transcript_match', 0.8)
    addCandidate('trashed', INTERVIEW, 0)
    run("UPDATE recordings SET deleted_at = '2026-08-20' WHERE id = 'trashed'")
    expect(findContradictedAutomaticLinks()).toEqual([])
  })
})
