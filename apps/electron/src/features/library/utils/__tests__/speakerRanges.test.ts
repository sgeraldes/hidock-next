/**
 * Tests for deriveSpeakerRanges — the client-side per-speaker color bands that
 * paint the full-mode waveform timeline.
 */

import { describe, it, expect } from 'vitest'
import { deriveSpeakerRanges, SPEAKER_PALETTE } from '../speakerRanges'
import type { StoredSegment } from '../../components/TranscriptViewer'

const segs: StoredSegment[] = [
  { speaker: 'Speaker 1', start: 0, end: 10, text: 'hello' },
  { speaker: 'Speaker 2', start: 10, end: 20, text: 'hi there' },
  { speaker: 'Speaker 1', start: 20, end: 30, text: 'again' },
]

describe('deriveSpeakerRanges', () => {
  it('returns empty for no segments', () => {
    const r = deriveSpeakerRanges(undefined, 30)
    expect(r.ranges).toEqual([])
    expect(r.legend).toEqual([])
    expect(r.colorByKey.size).toBe(0)
  })

  it('colors each bar/range by its speaker segment', () => {
    const { ranges } = deriveSpeakerRanges(segs, 30)
    expect(ranges).toHaveLength(3)
    expect(ranges[0]).toMatchObject({ startSec: 0, endSec: 10, speakerKey: 'l:Speaker 1' })
    expect(ranges[1]).toMatchObject({ startSec: 10, endSec: 20, speakerKey: 'l:Speaker 2' })
    expect(ranges[2]).toMatchObject({ startSec: 20, endSec: 30, speakerKey: 'l:Speaker 1' })
  })

  it('assigns ONE stable color per distinct speaker (first-appearance order)', () => {
    const { ranges, colorByKey } = deriveSpeakerRanges(segs, 30)
    expect(colorByKey.get('l:Speaker 1')).toBe(SPEAKER_PALETTE[0])
    expect(colorByKey.get('l:Speaker 2')).toBe(SPEAKER_PALETTE[1])
    // Both Speaker 1 turns share the same color.
    expect(ranges[0].color).toBe(ranges[2].color)
    expect(ranges[0].color).not.toBe(ranges[1].color)
  })

  it('builds a legend aggregating turns per speaker', () => {
    const { legend } = deriveSpeakerRanges(segs, 30)
    expect(legend).toHaveLength(2)
    expect(legend[0]).toMatchObject({ speakerKey: 'l:Speaker 1', name: 'Speaker 1', turnCount: 2 })
    expect(legend[1]).toMatchObject({ speakerKey: 'l:Speaker 2', name: 'Speaker 2', turnCount: 1 })
  })

  it('resolves labels to the shared {key,name} so colors match participant chips', () => {
    const resolve = (base: string) =>
      base === 'Speaker 1' ? { key: 'c:alice', name: 'Alice' } : undefined
    const { ranges, legend, colorByKey } = deriveSpeakerRanges(segs, 30, resolve)
    // Speaker 1's ranges now carry the contact key + name.
    expect(ranges[0]).toMatchObject({ speakerKey: 'c:alice', name: 'Alice' })
    expect(colorByKey.get('c:alice')).toBe(SPEAKER_PALETTE[0])
    expect(legend.find((l) => l.speakerKey === 'c:alice')?.name).toBe('Alice')
  })

  it('resolves PER TURN (passes the turn index) so a split label yields distinct keys per side', () => {
    // Same base label throughout, but the resolver — like the reader's shared
    // split/override resolution — maps turns ≥ 2 to a different person.
    const resolve = (base: string, turnIndex: number) =>
      base === 'Speaker 1'
        ? turnIndex >= 2
          ? { key: 'c:bob', name: 'Bob' }
          : { key: 'c:alice', name: 'Alice' }
        : undefined
    const { ranges, colorByKey } = deriveSpeakerRanges(segs, 30, resolve)
    // Turn 0 (pre-split) → Alice; turn 2 (post-split) → Bob; different colors.
    expect(ranges[0]).toMatchObject({ speakerKey: 'c:alice', name: 'Alice' })
    expect(ranges[2]).toMatchObject({ speakerKey: 'c:bob', name: 'Bob' })
    expect(colorByKey.get('c:alice')).not.toBe(colorByKey.get('c:bob'))
  })

  it('closes an open final turn at the duration and chains missing ends', () => {
    const open: StoredSegment[] = [
      { speaker: 'Speaker 1', start: 0, text: 'a' }, // no end → next start (5)
      { speaker: 'Speaker 2', start: 5, text: 'b' }, // no end → duration (12)
    ]
    const { ranges } = deriveSpeakerRanges(open, 12)
    expect(ranges[0]).toMatchObject({ startSec: 0, endSec: 5 })
    expect(ranges[1]).toMatchObject({ startSec: 5, endSec: 12 })
  })

  it('clamps ranges to the duration and drops zero-width turns', () => {
    const over: StoredSegment[] = [
      { speaker: 'Speaker 1', start: 0, end: 100, text: 'x' },
      { speaker: 'Speaker 2', start: 50, end: 50, text: 'zero' }, // zero-width → dropped
    ]
    const { ranges } = deriveSpeakerRanges(over, 30)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].endSec).toBe(30)
  })

  it('skips untagged turns (no speaker) leaving a color gap', () => {
    const mixed: StoredSegment[] = [
      { start: 0, end: 5, text: 'no speaker' },
      { speaker: 'Speaker 1', start: 5, end: 10, text: 'tagged' },
    ]
    const { ranges } = deriveSpeakerRanges(mixed, 10)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].speakerKey).toBe('l:Speaker 1')
  })
})
