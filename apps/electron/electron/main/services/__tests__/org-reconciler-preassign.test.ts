/**
 * Org Reconciler — recording pre-assignment consumption (v31).
 *
 * autoLinkRecordingsToMeetings normally links an unlinked recording to the
 * meeting it overlaps in time. A user pre-assignment (attribution chosen IN
 * ADVANCE while the device was recording) overrides that:
 *   - an explicit meeting_id wins over any time-overlap match
 *   - an explicit NULL forces the recording standalone (blocks auto-link)
 * In both cases the preassignment row is consumed (deleted) after it is applied.
 *
 * The DB module is mocked so the logic runs offline; queryAll branches on the SQL
 * text (recordings vs meetings) and `run` is a spy we assert against.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RecordingPreassignment } from '../database'

interface RecRow {
  id: string
  filename?: string
  date_recorded: string
  duration_seconds?: number
  meeting_id?: string | null
}
interface MtgRow {
  id: string
  subject: string
  start_time: string
  end_time: string
}

let recordingRows: RecRow[] = []
let meetingRows: MtgRow[] = []
let preassignRows: RecordingPreassignment[] = []
const runSpy = vi.fn()

vi.mock('../database', () => ({
  queryAll: vi.fn((sql: string) => {
    if (/FROM recordings/i.test(sql)) return recordingRows
    if (/FROM meetings/i.test(sql)) return meetingRows
    return []
  }),
  queryOne: vi.fn(() => undefined),
  run: (...args: unknown[]) => runSpy(...args),
  runInTransaction: (fn: () => unknown) => fn(),
  mergeContacts: vi.fn(),
  insertIdentitySuggestion: vi.fn(),
  getAllRecordingPreassignments: () => preassignRows
}))

import { autoLinkRecordingsToMeetings } from '../org-reconciler'

/** run() calls whose SQL contains `substr`. */
function runCalls(substr: string): unknown[][] {
  return runSpy.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes(substr))
}

beforeEach(() => {
  recordingRows = []
  meetingRows = []
  preassignRows = []
  runSpy.mockClear()
})

describe('autoLinkRecordingsToMeetings — pre-assignment consumption', () => {
  it('explicit meeting wins over a time-overlapping meeting', () => {
    // Recording overlaps m-overlap in time, but the user pre-assigned it to
    // m-explicit (which it does NOT overlap). The explicit choice must win.
    recordingRows = [
      { id: 'rec-A', filename: 'RecA.wav', date_recorded: '2026-07-08T10:00:00Z', duration_seconds: 1800 }
    ]
    meetingRows = [
      { id: 'm-overlap', subject: 'Standup', start_time: '2026-07-08T10:00:00Z', end_time: '2026-07-08T11:00:00Z' },
      { id: 'm-explicit', subject: 'Client call', start_time: '2026-07-08T15:00:00Z', end_time: '2026-07-08T16:00:00Z' }
    ]
    // Preassignment keyed by the DEVICE filename (.hda) must still match the .wav row.
    preassignRows = [{ filename: 'RecA.hda', meeting_id: 'm-explicit' }]

    const linked = autoLinkRecordingsToMeetings()

    expect(linked).toBe(1)
    const preassignLinks = runCalls("correlation_method = 'user_preassign'")
    expect(preassignLinks).toHaveLength(1)
    expect(preassignLinks[0][1]).toEqual(['m-explicit', 'rec-A'])
    // The overlap link must NOT have fired for this recording.
    expect(runCalls("correlation_method = 'time_overlap'")).toHaveLength(0)
    // The preassignment row is consumed by its original (device) filename.
    const deletes = runCalls('DELETE FROM recording_preassignments')
    expect(deletes).toHaveLength(1)
    expect(deletes[0][1]).toEqual(['RecA.hda'])
  })

  it('explicit NULL forces standalone and blocks time-overlap linking', () => {
    recordingRows = [
      { id: 'rec-B', filename: 'RecB.wav', date_recorded: '2026-07-08T10:00:00Z', duration_seconds: 1800 }
    ]
    meetingRows = [
      { id: 'm-overlap', subject: 'Standup', start_time: '2026-07-08T10:00:00Z', end_time: '2026-07-08T11:00:00Z' }
    ]
    preassignRows = [{ filename: 'RecB.hda', meeting_id: null }]

    const linked = autoLinkRecordingsToMeetings()

    expect(linked).toBe(0)
    // Marked standalone, not linked to any meeting.
    const standalone = runCalls("correlation_method = 'user_preassign_standalone'")
    expect(standalone).toHaveLength(1)
    expect(standalone[0][1]).toEqual(['rec-B'])
    expect(runCalls("correlation_method = 'time_overlap'")).toHaveLength(0)
    expect(runCalls("correlation_method = 'user_preassign'")).toHaveLength(0)
    // Preassignment consumed.
    const deletes = runCalls('DELETE FROM recording_preassignments')
    expect(deletes[0][1]).toEqual(['RecB.hda'])
  })

  it('falls back to time-overlap when there is no pre-assignment', () => {
    recordingRows = [
      { id: 'rec-C', filename: 'RecC.wav', date_recorded: '2026-07-08T10:00:00Z', duration_seconds: 1800 }
    ]
    meetingRows = [
      { id: 'm-overlap', subject: 'Standup', start_time: '2026-07-08T10:00:00Z', end_time: '2026-07-08T11:00:00Z' }
    ]
    preassignRows = []

    const linked = autoLinkRecordingsToMeetings()

    expect(linked).toBe(1)
    const overlap = runCalls("correlation_method = 'time_overlap'")
    expect(overlap).toHaveLength(1)
    expect(overlap[0][1]).toEqual(['m-overlap', 'rec-C'])
    expect(runCalls('DELETE FROM recording_preassignments')).toHaveLength(0)
  })
})
