import { describe, it, expect } from 'vitest'
import { evidenceToPhrases, topicChips, parseEvidence } from '../evidenceToPhrases'

describe('evidenceToPhrases', () => {
  it('describes name containment concretely', () => {
    const phrases = evidenceToPhrases({ signals: { name: 0.68 } }, 'Sergi', 'Sergio')
    expect(phrases[0]).toBe("'Sergi' is part of 'Sergio'")
  })

  it('composes role, meetings and email reasons in order', () => {
    const phrases = evidenceToPhrases(
      {
        signals: { name: 0.78 },
        roleOverlap: ['project', 'manager'],
        sharedMeetings: 3,
        emailMatch: 'exact'
      },
      'Edu',
      'Eduardo'
    )
    expect(phrases).toContain('both Project Manager')
    expect(phrases).toContain('3 shared meetings')
    expect(phrases).toContain('same email address')
    // "'Edu' is part of 'Eduardo'" leads.
    expect(phrases[0]).toBe("'Edu' is part of 'Eduardo'")
  })

  it('singularizes a single shared meeting', () => {
    expect(evidenceToPhrases({ sharedMeetings: 1 }, 'A', 'B')).toContain('1 shared meeting')
  })

  it('flags a conflicting email as a caution', () => {
    const phrases = evidenceToPhrases({ emailMatch: 'conflict' }, 'Ana', 'Ana')
    expect(phrases).toContain('different email addresses (caution)')
  })

  it('falls back to the legacy method note when there are no signals', () => {
    expect(evidenceToPhrases({ method: 'fuzzy_context' }, 'X', 'Zzz')).toEqual(['matched by fuzzy context'])
  })

  it('describes accent-only differences', () => {
    expect(evidenceToPhrases({ signals: { name: 0.9 } }, 'Oscar', 'Óscar')).toContain(
      'the same name spelled differently'
    )
  })

  it('caps topic chips at the requested max', () => {
    const ev = { sharedTopics: ['a', 'b', 'c', 'd', 'e'] }
    expect(topicChips(ev)).toEqual(['a', 'b', 'c'])
    expect(topicChips(ev, 2)).toEqual(['a', 'b'])
  })
})

describe('parseEvidence', () => {
  it('returns an empty object for null/invalid JSON', () => {
    expect(parseEvidence(null)).toEqual({})
    expect(parseEvidence('{not json')).toEqual({})
  })
  it('parses a valid blob', () => {
    expect(parseEvidence('{"loserId":"x"}')).toEqual({ loserId: 'x' })
  })
})
