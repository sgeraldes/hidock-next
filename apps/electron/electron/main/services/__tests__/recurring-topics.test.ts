// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryAll } from '../database'
import { filterEligibleRecordingIds } from '../recording-eligibility'
import { getRecurringTopics } from '../recurring-topics'

vi.mock('../database', () => ({
  queryAll: vi.fn()
}))

vi.mock('../recording-eligibility', () => ({
  filterEligibleRecordingIds: vi.fn()
}))

/** Default eligibility mock: every candidate id is eligible (nothing excluded). */
function allEligible(ids: Iterable<string>) {
  return { eligible: new Set<string>([...ids]), failClosed: false }
}

describe('getRecurringTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(filterEligibleRecordingIds).mockImplementation(allEligible)
  })

  it('normalizes topics and counts each recording only once', () => {
    vi.mocked(queryAll).mockReturnValue([
      {
        recording_id: 'rec-1',
        topics: JSON.stringify([' Security ', 'security', '', 'API Design'])
      },
      {
        recording_id: 'rec-1',
        topics: JSON.stringify(['SECURITY'])
      },
      {
        recording_id: 'rec-2',
        topics: JSON.stringify(['security', 'api design', 'Migration', null])
      },
      {
        recording_id: 'rec-3',
        topics: JSON.stringify(['API Design', 'migration', '  '])
      },
      { recording_id: 'rec-4', topics: null },
      { recording_id: 'rec-5', topics: '' },
      { recording_id: 'rec-6', topics: 'not-json' },
      { recording_id: 'rec-7', topics: JSON.stringify({ topic: 'ignore me' }) },
      { recording_id: 'rec-8', topics: JSON.stringify(['Q1 Planning', 42]) }
    ])

    expect(getRecurringTopics(3)).toEqual([
      { topic: 'API Design', recordingCount: 3 },
      { topic: 'Migration', recordingCount: 2 },
      { topic: 'Security', recordingCount: 2 }
    ])

    expect(queryAll).toHaveBeenCalledWith(
      expect.stringContaining("datetime(r.date_recorded) >= datetime('now', ?)"),
      ['-90 days']
    )
    expect(vi.mocked(queryAll).mock.calls[0][0]).toContain(
      "COALESCE(r.transcription_status, '') NOT IN ('error', 'failed')"
    )
  })

  // ADV14 (merge-gate round 14) — the value predicate is enforced by the shared
  // fail-closed allowlist, not by the SQL. These verify the aggregation only ever
  // counts eligible contributors.
  it('drops topics/counts from recordings the eligibility boundary excludes', () => {
    vi.mocked(queryAll).mockReturnValue([
      { recording_id: 'rec-good', topics: JSON.stringify(['Roadmap', 'Budget']) },
      { recording_id: 'rec-excluded', topics: JSON.stringify(['Roadmap', 'Gossip']) }
    ])
    // rec-excluded (value-excluded/personal/deleted) is not in the eligible set.
    vi.mocked(filterEligibleRecordingIds).mockReturnValue({
      eligible: new Set(['rec-good']),
      failClosed: false
    })

    expect(getRecurringTopics()).toEqual([
      { topic: 'Budget', recordingCount: 1 },
      { topic: 'Roadmap', recordingCount: 1 } // counted ONCE (rec-excluded's copy dropped)
    ])
  })

  it('still surfaces an eligible topic even when excluded rows rank ahead of it', () => {
    // Three excluded recordings all mention "Noise"; one eligible mentions "Signal".
    vi.mocked(queryAll).mockReturnValue([
      { recording_id: 'x1', topics: JSON.stringify(['Noise']) },
      { recording_id: 'x2', topics: JSON.stringify(['Noise']) },
      { recording_id: 'x3', topics: JSON.stringify(['Noise']) },
      { recording_id: 'ok', topics: JSON.stringify(['Signal']) }
    ])
    vi.mocked(filterEligibleRecordingIds).mockReturnValue({
      eligible: new Set(['ok']),
      failClosed: false
    })

    expect(getRecurringTopics(1)).toEqual([{ topic: 'Signal', recordingCount: 1 }])
  })

  it('returns [] when the eligibility lookup fails closed', () => {
    vi.mocked(queryAll).mockReturnValue([
      { recording_id: 'rec-1', topics: JSON.stringify(['Anything']) }
    ])
    vi.mocked(filterEligibleRecordingIds).mockReturnValue({
      eligible: new Set<string>(),
      failClosed: true
    })

    expect(getRecurringTopics()).toEqual([])
  })
})
