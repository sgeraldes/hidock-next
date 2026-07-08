import { describe, it, expect } from 'vitest'
import { computeSharedContext, type PersonContext } from '../personContext'

const ctx = (people: string[], topics: string[]): PersonContext => ({ people, topics })

describe('computeSharedContext', () => {
  it('highlights entries shared by both sides within their kind', () => {
    const c = computeSharedContext(ctx(['Bob', 'Carol'], ['Atlas']), ctx(['Bob'], ['Atlas', 'Nimbus']))
    const aPeople = c.a.people
    expect(aPeople.find((x) => x.label === 'Bob')?.shared).toBe(true)
    expect(aPeople.find((x) => x.label === 'Carol')?.shared).toBe(false)
    expect(c.a.topics.find((x) => x.label === 'Atlas')?.shared).toBe(true)
    // Symmetric: Bob is shared on side B too.
    expect(c.b.people.find((x) => x.label === 'Bob')?.shared).toBe(true)
    expect(c.hasShared).toBe(true)
    expect(c.disjoint).toBe(false)
  })

  it('matches case-insensitively and dedupes within a side', () => {
    const c = computeSharedContext(ctx(['bob', 'Bob'], []), ctx(['BOB'], []))
    // Deduped to one chip, and it is shared.
    expect(c.a.people).toHaveLength(1)
    expect(c.a.people[0].shared).toBe(true)
  })

  it('flags "different circles" when both sides have context but share nothing', () => {
    const c = computeSharedContext(ctx(['Alice'], ['Atlas']), ctx(['Zoe'], ['Nimbus']))
    expect(c.hasShared).toBe(false)
    expect(c.disjoint).toBe(true)
  })

  it('does not flag disjoint when a side has no context', () => {
    const c = computeSharedContext(ctx(['Alice'], ['Atlas']), ctx([], []))
    expect(c.disjoint).toBe(false)
    expect(c.hasShared).toBe(false)
  })

  it('does not cross-match a person against a topic of the same label', () => {
    // 'Atlas' as a person on A must not count as shared with 'Atlas' topic on B.
    const c = computeSharedContext(ctx(['Atlas'], []), ctx([], ['Atlas']))
    expect(c.hasShared).toBe(false)
    expect(c.a.people[0].shared).toBe(false)
  })
})
