/**
 * BUG A — a recording must bind to the recurring-series occurrence whose window
 * actually matches its timestamp, never a sibling occurrence weeks away.
 *
 * Reproduces the dogfood report: a recurring meeting "Engineering EDF team 1"
 * with a May-27 anchor occurrence (bare uid) AND a July-1 occurrence
 * (`uid::slotISO`), plus a July-1 recording. The recording must land on the
 * July-1 occurrence, NEVER the May-27 anchor.
 *
 * This exercises the two live paths that write recordings.meeting_id for a
 * recurring series:
 *   1. autoLinkRecordingsToMeetings() — time-overlap auto-correlation
 *   2. mergeDuplicateMeetingOccurrences() — occurrence-twin collapse/repointing
 *
 * Verdict driver: if both paths keep the recording on July-1, the live code is
 * CORRECT and any May-27 bundle in a real DB is STALE DATA (pre-fix), to be
 * healed by the gated repair — not a live bug.
 *
 * The DB module is mocked so the logic runs offline; queryAll branches on SQL
 * text and `run` is a spy we assert against.
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
  is_all_day?: number
  is_recurring?: number
  recurrence_rule?: string | null
  created_at?: string | null
  updated_at?: string | null
}

let recordingRows: RecRow[] = []
let meetingRows: MtgRow[] = []
let preassignRows: RecordingPreassignment[] = []
let linkedMeetingIds: string[] = []
let tableNames: string[] = []
const runSpy = vi.fn()

vi.mock('../database', () => ({
  queryAll: vi.fn((sql: string) => {
    if (/FROM sqlite_master/i.test(sql)) return tableNames.map((name) => ({ name }))
    // The merge path selects DISTINCT meeting_id from recordings; the auto-link
    // path selects full recording rows. Distinguish by the projected column.
    if (/FROM recordings/i.test(sql)) {
      if (/DISTINCT meeting_id/i.test(sql)) return linkedMeetingIds.map((meeting_id) => ({ meeting_id }))
      return recordingRows
    }
    if (/FROM meetings/i.test(sql)) return meetingRows
    return []
  }),
  queryOne: vi.fn(() => undefined),
  run: (...args: unknown[]) => runSpy(...args),
  runInTransaction: (fn: () => unknown) => fn(),
  mergeContacts: vi.fn(),
  insertIdentitySuggestion: vi.fn(),
  meetingBaseUid: (id: string) => (id.includes('::') ? id.slice(0, id.indexOf('::')) : id),
  getAllRecordingPreassignments: () => preassignRows
}))

import { autoLinkRecordingsToMeetings, mergeDuplicateMeetingOccurrences } from '../org-reconciler'

/** run() calls whose SQL contains `substr`. */
function runCalls(substr: string): unknown[][] {
  return runSpy.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes(substr))
}

// "Engineering EDF team 1" recurring series.
const UID = 'UID-EDF-TEAM-1'
const MAY27_START = '2026-05-27T17:00:00.000Z'
const MAY27_END = '2026-05-27T17:30:00.000Z'
const JUL01_START = '2026-07-01T17:00:00.000Z'
const JUL01_END = '2026-07-01T17:30:00.000Z'
// Occurrence at the master DTSTART keeps the bare uid; later occurrences get uid::slot.
const ANCHOR_MAY27 = UID
const OCC_JUL01 = `${UID}::${JUL01_START}`
// Recording made July 1 17:01 — inside the July-1 occurrence, ~5 weeks after May-27.
const REC = { id: 'rec-jul01', filename: '2026Jul01-170100-Rec09.wav', date_recorded: '2026-07-01T17:01:00.000Z', duration_seconds: 1500 }

function seriesRows(): MtgRow[] {
  return [
    { id: ANCHOR_MAY27, subject: 'Engineering EDF team 1', start_time: MAY27_START, end_time: MAY27_END, is_all_day: 0, is_recurring: 1, recurrence_rule: 'FREQ=WEEKLY', created_at: '2026-05-20 09:00:00', updated_at: '2026-05-20 09:00:00' },
    { id: OCC_JUL01, subject: 'Engineering EDF team 1', start_time: JUL01_START, end_time: JUL01_END, is_all_day: 0, is_recurring: 1, recurrence_rule: 'FREQ=WEEKLY', created_at: '2026-06-28 09:00:00', updated_at: '2026-06-28 09:00:00' }
  ]
}

beforeEach(() => {
  recordingRows = []
  meetingRows = []
  preassignRows = []
  linkedMeetingIds = []
  tableNames = ['meetings', 'recordings']
  runSpy.mockClear()
})

describe('BUG A — recurring-series occurrence binding', () => {
  it('auto-links a July-1 recording to the July-1 occurrence, never the May-27 anchor', () => {
    meetingRows = seriesRows()
    recordingRows = [REC]

    const linked = autoLinkRecordingsToMeetings()

    expect(linked).toBe(1)
    const overlapLinks = runCalls('correlation_method = \'time_overlap\'')
    expect(overlapLinks).toHaveLength(1)
    // meeting_id bound = the July-1 occurrence, recording id second.
    expect(overlapLinks[0][1]).toEqual([OCC_JUL01, REC.id])
    // The May-27 anchor must NEVER be the bound meeting.
    expect(overlapLinks[0][1]).not.toContain(ANCHOR_MAY27)
  })

  it('leaves a recording uncorrelated when the only overlapping occurrence is weeks away', () => {
    // Only the May-27 anchor exists (July-1 occurrence not yet expanded). The
    // July-1 recording overlaps nothing near it → it must stay UNLINKED, never
    // forced onto the far anchor.
    meetingRows = [seriesRows()[0]]
    recordingRows = [REC]

    const linked = autoLinkRecordingsToMeetings()

    expect(linked).toBe(0)
    expect(runCalls('SET meeting_id')).toHaveLength(0)
  })

  it('occurrence-merge does NOT repoint the July-1 recording onto the May-27 anchor', () => {
    // Both occurrences present; recording already correctly on July-1. The merge
    // groups by baseUid + start_time, so different-slot occurrences never merge.
    meetingRows = seriesRows()
    linkedMeetingIds = [OCC_JUL01]

    const merged = mergeDuplicateMeetingOccurrences()

    expect(merged).toBe(0)
    expect(runCalls('UPDATE recordings SET meeting_id')).toHaveLength(0)
  })
})
