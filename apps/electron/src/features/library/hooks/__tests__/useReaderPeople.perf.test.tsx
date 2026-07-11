/**
 * Round-3 finding 3 — per-turn range-key resolution must be cheap.
 *
 * resolveRangeKey used to replay the split scan (O(splits)) and a linear
 * contacts.find (O(contacts)) for EVERY turn. It now runs off precomputed
 * indexes (sorted split boundaries → binary search; name→contact map → O(1)),
 * so a full hour-long transcript (1000+ turns, several splits) resolves all of
 * its ranges well inside the 50ms budget — and still resolves CORRECTLY on
 * both sides of each split boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useReaderPeople } from '../useReaderPeople'
import { deriveSpeakerRanges } from '../../utils/speakerRanges'
import type { StoredSegment } from '../../components/TranscriptViewer'

vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

const TURNS = 1200
const DURATION_SEC = 3600

/** An hour-long transcript: 1200 turns, 4 rotating speakers, 3s each. */
function makeSegments(): StoredSegment[] {
  const segs: StoredSegment[] = []
  for (let i = 0; i < TURNS; i++) {
    segs.push({
      speaker: `Speaker ${(i % 4) + 1}`,
      start: i * 3,
      end: i * 3 + 3,
      text: `Turn ${i} of the hour-long meeting, with enough text to be realistic.`,
    })
  }
  return segs
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    value: {
      transcripts: {
        getSpeakerMap: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { speaker_label: 'Speaker 1', contact_id: 'c-early', name: 'Early Alice' },
            { speaker_label: 'Speaker 1 · B', contact_id: 'c-mid', name: 'Middle Bob' },
            { speaker_label: 'Speaker 1 · C', contact_id: 'c-late', name: 'Late Carol' },
          ],
        }),
      },
      turnSpeakers: {
        getOverrides: vi.fn().mockResolvedValue({ success: true, data: [] }),
        // 3 splits on the same base label across the hour.
        getSplits: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { base_label: 'Speaker 1', from_turn_index: 400, derived_label: 'Speaker 1 · B' },
            { base_label: 'Speaker 1', from_turn_index: 800, derived_label: 'Speaker 1 · C' },
            { base_label: 'Speaker 2', from_turn_index: 600, derived_label: 'Speaker 2 · B' },
          ],
        }),
        getMergeHints: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      contacts: {
        getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getAll: vi.fn().mockResolvedValue({ success: true, data: { contacts: [] } }),
      },
    },
    writable: true,
    configurable: true,
  })
})

describe('useReaderPeople.resolveRangeKey — performance + split correctness at scale', () => {
  it('resolves an hour-long transcript (1200 turns, 3 splits) in under 50ms', async () => {
    const segments = makeSegments()
    const { result } = renderHook(() =>
      useReaderPeople({ recordingId: 'rec-perf', segments })
    )

    // Wait for the async speaker data (splits + label map) to land.
    await waitFor(() => {
      expect(result.current.resolveRangeKey('Speaker 1', 400)?.key).toBe('c:c-mid')
    })

    const t0 = performance.now()
    const { ranges } = deriveSpeakerRanges(segments, DURATION_SEC, result.current.resolveRangeKey)
    const elapsed = performance.now() - t0

    expect(ranges).toHaveLength(TURNS)
    expect(elapsed).toBeLessThan(50)

    // Split correctness at scale: Speaker 1's turns key by their side of each
    // boundary (turns 0,4,8… are Speaker 1's; boundaries at 400 and 800).
    const s1 = ranges.filter((_, i) => i % 4 === 0)
    expect(s1[0].speakerKey).toBe('c:c-early') // turn 0
    expect(ranges[400].speakerKey).toBe('c:c-mid') // turn 400 (first split)
    expect(ranges[800].speakerKey).toBe('c:c-late') // turn 800 (second split)
    // An unbound split half falls back to its derived label key.
    expect(ranges[601].speakerKey).toBe('l:Speaker 2 · B') // turn 601 is Speaker 2's
  })
})
