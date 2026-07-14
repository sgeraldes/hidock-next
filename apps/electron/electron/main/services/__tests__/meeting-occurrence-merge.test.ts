/**
 * Org Reconciler — duplicate meeting-occurrence merge (duplicate-meeting fix).
 *
 * mergeDuplicateMeetingOccurrences collapses twin rows that describe the SAME
 * real occurrence of a recurring series — a stale pre-expansion bare-uid row and
 * a new `uid::slotISO` row that both survived the recurrence-expansion rollout.
 * It keeps the row carrying child links (or the bare-uid / oldest row), repoints
 * every meeting FK off the losers, and deletes the losers.
 *
 * The DB module is mocked so the logic runs offline: queryAll branches on the SQL
 * text and `run` is a spy we assert against. pickKeeperMeeting is pure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface MtgRow {
  id: string
  subject: string
  start_time: string
  end_time: string
  is_recurring: number
  recurrence_rule?: string | null
  created_at?: string | null
  updated_at?: string | null
}

let meetingRows: MtgRow[] = []
let linkedMeetingIds: string[] = []
let tableNames: string[] = []
const runSpy = vi.fn()

vi.mock('../database', () => ({
  queryAll: vi.fn((sql: string) => {
    if (/FROM sqlite_master/i.test(sql)) return tableNames.map((name) => ({ name }))
    if (/FROM recordings/i.test(sql)) return linkedMeetingIds.map((meeting_id) => ({ meeting_id }))
    if (/FROM meetings/i.test(sql)) return meetingRows
    return []
  }),
  queryOne: vi.fn(() => undefined),
  run: (...args: unknown[]) => runSpy(...args),
  runInTransaction: (fn: () => unknown) => fn(),
  mergeContacts: vi.fn(),
  meetingBaseUid: (id: string) => (id.includes('::') ? id.slice(0, id.indexOf('::')) : id),
  insertIdentitySuggestion: vi.fn(),
  getAllRecordingPreassignments: () => []
}))

import { mergeDuplicateMeetingOccurrences, pickKeeperMeeting } from '../org-reconciler'

/** run() calls whose SQL contains `substr`. */
function runCalls(substr: string): unknown[][] {
  return runSpy.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes(substr))
}

const START = '2026-07-08T16:00:00.000Z'
const UID = 'UID-CX'
const BARE = UID
const SLOT = `${UID}::${START}`
const ALL_TABLES = ['meetings', 'recordings', 'knowledge_captures', 'follow_ups', 'recording_preassignments']

function twinRows(): MtgRow[] {
  return [
    // stale pre-expansion bare-uid row (older, is_recurring=0)
    { id: BARE, subject: 'CX - Weekly', start_time: START, end_time: '2026-07-08T17:00:00.000Z', is_recurring: 0, created_at: '2026-07-08 04:33:29', updated_at: '2026-07-08 22:24:13' },
    // new expanded occurrence (newer, correct is_recurring=1)
    { id: SLOT, subject: 'CX - Weekly', start_time: START, end_time: '2026-07-08T17:00:00.000Z', is_recurring: 1, recurrence_rule: 'FREQ=WEEKLY', created_at: '2026-07-08 22:28:01', updated_at: '2026-07-08 23:04:10' }
  ]
}

beforeEach(() => {
  meetingRows = []
  linkedMeetingIds = []
  tableNames = ALL_TABLES
  runSpy.mockClear()
})

describe('mergeDuplicateMeetingOccurrences', () => {
  it('keeps the bare-uid row when it holds the recording link and repoints the loser', () => {
    meetingRows = twinRows()
    linkedMeetingIds = [BARE] // recording attributed to the stale bare-uid row

    const merged = mergeDuplicateMeetingOccurrences()

    expect(merged).toBe(1)
    // The ::slot twin is deleted; the bare-uid row survives.
    const deletes = runCalls('DELETE FROM meetings')
    expect(deletes).toHaveLength(1)
    expect(deletes[0][1]).toEqual([SLOT])
    // Child FKs repointed off the loser onto the keeper.
    const recRepoint = runCalls('UPDATE recordings SET meeting_id')
    expect(recRepoint[0][1]).toEqual([BARE, SLOT])
    // Keeper content refreshed from the most-recently-synced row (is_recurring=1).
    const refresh = runCalls('UPDATE meetings SET subject')
    expect(refresh).toHaveLength(1)
    expect(refresh[0][1]).toEqual(['CX - Weekly', START, '2026-07-08T17:00:00.000Z', 1, 'FREQ=WEEKLY', BARE])
  })

  it('keeps the ::slot row when the recording is attributed to it', () => {
    meetingRows = twinRows()
    linkedMeetingIds = [SLOT]

    const merged = mergeDuplicateMeetingOccurrences()

    expect(merged).toBe(1)
    const deletes = runCalls('DELETE FROM meetings')
    expect(deletes[0][1]).toEqual([BARE]) // bare-uid loser deleted
    expect(runCalls('UPDATE recordings SET meeting_id')[0][1]).toEqual([SLOT, BARE])
  })

  it('prefers the bare-uid row when neither has a recording (converges with remap)', () => {
    meetingRows = twinRows()
    linkedMeetingIds = []

    mergeDuplicateMeetingOccurrences()

    expect(runCalls('DELETE FROM meetings')[0][1]).toEqual([SLOT])
  })

  it('repoints composite-key link tables with UPDATE OR IGNORE then drops leftovers', () => {
    meetingRows = twinRows()
    linkedMeetingIds = [BARE]

    mergeDuplicateMeetingOccurrences()

    // meeting_contacts / meeting_projects / recording_meeting_candidates each get
    // a move-what-fits UPDATE OR IGNORE and a leftover DELETE.
    expect(runCalls('UPDATE OR IGNORE meeting_contacts SET meeting_id')[0][1]).toEqual([BARE, SLOT])
    expect(runCalls('DELETE FROM meeting_contacts')[0][1]).toEqual([SLOT])
    expect(runCalls('UPDATE OR IGNORE meeting_projects SET meeting_id')[0][1]).toEqual([BARE, SLOT])
    expect(runCalls('UPDATE OR IGNORE recording_meeting_candidates SET meeting_id')[0][1]).toEqual([BARE, SLOT])
  })

  it('is idempotent — a group with a single row is left untouched', () => {
    meetingRows = [twinRows()[0]] // only the bare-uid row remains
    const merged = mergeDuplicateMeetingOccurrences()
    expect(merged).toBe(0)
    expect(runCalls('DELETE FROM meetings')).toHaveLength(0)
  })

  it('never merges occurrences at different slots of the same series', () => {
    meetingRows = [
      { id: `${UID}::${START}`, subject: 'CX', start_time: START, end_time: '2026-07-08T17:00:00.000Z', is_recurring: 1 },
      { id: `${UID}::2026-07-15T16:00:00.000Z`, subject: 'CX', start_time: '2026-07-15T16:00:00.000Z', end_time: '2026-07-15T17:00:00.000Z', is_recurring: 1 }
    ]
    const merged = mergeDuplicateMeetingOccurrences()
    expect(merged).toBe(0)
  })

  it('skips a lazily-created table that does not exist yet', () => {
    meetingRows = twinRows()
    linkedMeetingIds = [BARE]
    tableNames = ['meetings', 'recordings'] // no knowledge_captures / follow_ups

    mergeDuplicateMeetingOccurrences()

    expect(runCalls('UPDATE knowledge_captures')).toHaveLength(0)
    expect(runCalls('UPDATE follow_ups')).toHaveLength(0)
    // The always-present tables are still repointed.
    expect(runCalls('UPDATE recordings SET meeting_id')).toHaveLength(1)
  })
})

describe('pickKeeperMeeting', () => {
  const bare = { id: 'UID', created_at: '2026-07-08 04:33:29' }
  const slot = { id: 'UID::2026-07-08T16:00:00.000Z', created_at: '2026-07-08 22:28:01' }

  it('keeps the row with a linked recording over a bare-uid row', () => {
    expect(pickKeeperMeeting([bare, slot], new Set([slot.id])).id).toBe(slot.id)
  })

  it('prefers the bare-uid row when neither has a recording', () => {
    expect(pickKeeperMeeting([slot, bare], new Set()).id).toBe(bare.id)
  })

  it('falls back to the oldest created_at when neither is bare nor linked', () => {
    const a = { id: 'UID::a', created_at: '2026-07-08 22:28:01' }
    const b = { id: 'UID::b', created_at: '2026-07-08 04:33:29' }
    expect(pickKeeperMeeting([a, b], new Set()).id).toBe('UID::b')
  })

  it('does not mutate the input array order', () => {
    const rows = [slot, bare]
    pickKeeperMeeting(rows, new Set())
    expect(rows.map((r) => r.id)).toEqual([slot.id, bare.id])
  })
})
