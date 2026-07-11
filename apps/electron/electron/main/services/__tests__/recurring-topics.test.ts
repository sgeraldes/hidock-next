// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryAll } from '../database'
import { getRecurringTopics } from '../recurring-topics'

vi.mock('../database', () => ({
  queryAll: vi.fn()
}))

describe('getRecurringTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
