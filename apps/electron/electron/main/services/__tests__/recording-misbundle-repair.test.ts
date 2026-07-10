/**
 * BUG A — gated misbundled-recording repair.
 *
 * findMisbundledRecordings() / repairMisbundledRecordings() clean up STALE bundles
 * (a recording linked to a meeting whose window is weeks away) that predate the
 * fit-based auto-link policy. The rewrite is GATED: a dry run reports count + a
 * sample and rewrites NOTHING; only confirm:true applies the change — rebundling
 * onto the matching sibling occurrence of the same series, or unlinking when none
 * matches. Idempotent.
 *
 * The DB module is mocked; queryAll branches on SQL text and `run` is a spy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
}

let recordingRows: RecRow[] = []
let meetingRows: MtgRow[] = []
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
  meetingBaseUid: (id: string) => (id.includes('::') ? id.slice(0, id.indexOf('::')) : id),
  getAllRecordingPreassignments: () => []
}))

import { findMisbundledRecordings, repairMisbundledRecordings } from '../org-reconciler'

function runCalls(substr: string): unknown[][] {
  return runSpy.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes(substr))
}

const UID = 'UID-EDF-TEAM-1'
const ANCHOR_MAY27 = UID
const OCC_JUL01 = `${UID}::2026-07-01T17:00:00.000Z`
const REC = { id: 'rec-jul01', filename: '2026Jul01-170100-Rec09.wav', date_recorded: '2026-07-01T17:01:00.000Z', duration_seconds: 1500, meeting_id: ANCHOR_MAY27 }

function anchorRow(): MtgRow {
  return { id: ANCHOR_MAY27, subject: 'Engineering EDF team 1', start_time: '2026-05-27T17:00:00.000Z', end_time: '2026-05-27T17:30:00.000Z', is_all_day: 0 }
}
function jul01Row(): MtgRow {
  return { id: OCC_JUL01, subject: 'Engineering EDF team 1', start_time: '2026-07-01T17:00:00.000Z', end_time: '2026-07-01T17:30:00.000Z', is_all_day: 0 }
}

beforeEach(() => {
  recordingRows = []
  meetingRows = []
  runSpy.mockClear()
})

describe('findMisbundledRecordings', () => {
  it('flags a recording bundled to a meeting weeks away and targets the matching sibling', () => {
    recordingRows = [REC]
    meetingRows = [anchorRow(), jul01Row()]

    const found = findMisbundledRecordings()

    expect(found).toHaveLength(1)
    expect(found[0].recordingId).toBe(REC.id)
    expect(found[0].currentMeetingId).toBe(ANCHOR_MAY27)
    expect(found[0].action).toBe('rebundle')
    expect(found[0].targetMeetingId).toBe(OCC_JUL01)
    expect(found[0].gapHours).toBeGreaterThan(24)
  })

  it('marks the recording for unlink when no sibling occurrence matches', () => {
    recordingRows = [REC]
    meetingRows = [anchorRow()] // July-1 occurrence never expanded

    const found = findMisbundledRecordings()

    expect(found).toHaveLength(1)
    expect(found[0].action).toBe('unlink')
    expect(found[0].targetMeetingId).toBeNull()
  })

  it('ignores a recording correctly bundled inside its meeting window', () => {
    recordingRows = [{ ...REC, meeting_id: OCC_JUL01 }]
    meetingRows = [anchorRow(), jul01Row()]

    expect(findMisbundledRecordings()).toHaveLength(0)
  })
})

describe('repairMisbundledRecordings — gated rewrite', () => {
  it('dry run returns the count + sample and rewrites NOTHING', () => {
    recordingRows = [REC]
    meetingRows = [anchorRow(), jul01Row()]

    const report = repairMisbundledRecordings({ confirm: false })

    expect(report.dryRun).toBe(true)
    expect(report.totalCount).toBe(1)
    expect(report.applied).toBe(0)
    expect(report.sample).toHaveLength(1)
    expect(report.sample[0].targetMeetingId).toBe(OCC_JUL01)
    // The gate: no UPDATE ran without confirm.
    expect(runSpy).not.toHaveBeenCalled()
  })

  it('omitting confirm defaults to a dry run (never rewrites implicitly)', () => {
    recordingRows = [REC]
    meetingRows = [anchorRow(), jul01Row()]

    const report = repairMisbundledRecordings()

    expect(report.dryRun).toBe(true)
    expect(report.applied).toBe(0)
    expect(runSpy).not.toHaveBeenCalled()
  })

  it('confirm:true rebundles onto the matching sibling occurrence', () => {
    recordingRows = [REC]
    meetingRows = [anchorRow(), jul01Row()]

    const report = repairMisbundledRecordings({ confirm: true })

    expect(report.dryRun).toBe(false)
    expect(report.applied).toBe(1)
    const rebind = runCalls("correlation_method = 'repair_rebundle'")
    expect(rebind).toHaveLength(1)
    // [targetMeetingId, recordingId, currentMeetingId]
    expect(rebind[0][1]).toEqual([OCC_JUL01, REC.id, ANCHOR_MAY27])
  })

  it('confirm:true unlinks when no sibling matches', () => {
    recordingRows = [REC]
    meetingRows = [anchorRow()]

    const report = repairMisbundledRecordings({ confirm: true })

    expect(report.applied).toBe(1)
    const unlink = runCalls("correlation_method = 'repair_unbundled'")
    expect(unlink).toHaveLength(1)
    expect(unlink[0][1]).toEqual([REC.id, ANCHOR_MAY27])
    expect(runCalls("correlation_method = 'repair_rebundle'")).toHaveLength(0)
  })

  it('is a no-op when nothing is misbundled', () => {
    recordingRows = [{ ...REC, meeting_id: OCC_JUL01 }]
    meetingRows = [anchorRow(), jul01Row()]

    const report = repairMisbundledRecordings({ confirm: true })

    expect(report.totalCount).toBe(0)
    expect(report.applied).toBe(0)
    expect(runSpy).not.toHaveBeenCalled()
  })
})
