import { describe, it, expect } from 'vitest'
import { groupSuggestions, tierOf, TIER_LABEL } from '../groupSuggestions'

type S = { target_id: string; kind: 'person' | 'project'; confidence: number | null; id: string }
const s = (id: string, target_id: string, confidence: number): S => ({ id, target_id, kind: 'person', confidence })

describe('tierOf', () => {
  it('splits at 80%', () => {
    expect(tierOf(0.8)).toBe('likely')
    expect(tierOf(0.79)).toBe('review')
    expect(tierOf(null)).toBe('review')
  })
  it('labels both tiers', () => {
    expect(TIER_LABEL.likely).toMatch(/Likely/)
    expect(TIER_LABEL.review).toMatch(/Needs review/)
  })
})

describe('groupSuggestions', () => {
  it('clusters suggestions by target and sorts candidates by confidence desc', () => {
    const groups = groupSuggestions([s('a', 't1', 0.6), s('b', 't1', 0.8), s('c', 't2', 0.7)])
    expect(groups).toHaveLength(2)
    const t1 = groups.find((g) => g.targetId === 't1')!
    expect(t1.candidates.map((c) => c.id)).toEqual(['b', 'a'])
    expect(t1.maxConfidence).toBe(0.8)
    expect(t1.tier).toBe('likely')
  })

  it('orders multi-candidate groups ahead of singletons within a tier', () => {
    // t2 singleton (0.85) vs t1 pair (max 0.82): both "likely", pair comes first.
    const groups = groupSuggestions([s('a', 't1', 0.82), s('b', 't1', 0.6), s('c', 't2', 0.85)])
    expect(groups.map((g) => g.targetId)).toEqual(['t1', 't2'])
  })

  it('orders the stronger tier first', () => {
    const groups = groupSuggestions([s('a', 't-low', 0.55), s('b', 't-high', 0.9)])
    expect(groups.map((g) => g.tier)).toEqual(['likely', 'review'])
    expect(groups[0].targetId).toBe('t-high')
  })
})
