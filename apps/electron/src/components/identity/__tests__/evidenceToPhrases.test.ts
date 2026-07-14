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

  it('falls back to the legacy method note only when names are unrelated and unsignalled', () => {
    expect(evidenceToPhrases({ method: 'fuzzy_context' }, 'X', 'Zzz')).toEqual(['matched by fuzzy context'])
  })

  it('describes accent-only differences from the names alone (no signal needed)', () => {
    expect(evidenceToPhrases({}, 'Oscar', 'Óscar')).toContain('same name with/without accents')
    expect(evidenceToPhrases({ method: 'fuzzy' }, 'Jose', 'José')).toContain('same name with/without accents')
  })

  it('describes a one-letter spelling difference concretely', () => {
    expect(evidenceToPhrases({ method: 'fuzzy' }, 'Nouman', 'Nauman')[0]).toBe(
      "'Nouman' is one letter from 'Nauman'"
    )
  })

  it('describes a two-letter spelling difference concretely', () => {
    expect(evidenceToPhrases({}, 'Kevin', 'Kavon')[0]).toBe("'Kevin' is two letters from 'Kavon'")
  })

  it('reports identical names', () => {
    expect(evidenceToPhrases({}, 'Ana', 'Ana')[0]).toBe('identical names')
  })

  it('never emits "matched by fuzzy" for a fuzzy name match — it computes a human phrase', () => {
    const phrases = evidenceToPhrases({ method: 'fuzzy', signals: { name: 0.72 } }, 'Nouman', 'Numan')
    expect(phrases.some((p) => /matched by/.test(p))).toBe(false)
    expect(phrases[0]).toBe("'Nouman' is one letter from 'Numan'")
  })

  it('falls back to "similar names" when a signal exists but no concrete relationship applies', () => {
    expect(evidenceToPhrases({ signals: { name: 0.7 } }, 'Bill', 'William')).toContain('similar names')
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
