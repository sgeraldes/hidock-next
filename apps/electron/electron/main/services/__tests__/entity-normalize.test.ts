/**
 * Pure entity-normalization + fuzzy-scoring helpers (Round 4a).
 * No DB — these pin the scoring rules the resolver depends on.
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeName,
  stripDiacritics,
  accentFoldedKey,
  looksLikeEmail,
  isGenericSpeakerLabel,
  levenshtein,
  fuzzyNameScore,
  isOppositeGenderSpanishPair,
  cleanRole,
  isSingleToken,
  hasSurname,
  firstNameNicknameMatch,
  detectAmbiguousName
} from '../entity-normalize'

describe('normalizeName', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeName('  Sebastián   Geraldes ')).toBe('sebastián geraldes')
    expect(normalizeName('SEBAS')).toBe('sebas')
  })
  it('is empty for empty/whitespace input', () => {
    expect(normalizeName('')).toBe('')
    expect(normalizeName('   ')).toBe('')
  })
  it('folds Unicode composition + compatibility forms (NFKC) so equivalent spellings share one key', () => {
    // Composed (NFC) vs decomposed (NFD) accents are DIFFERENT JS strings but the
    // same name. Without NFKC a discovery tombstone written under one form fails
    // to match a re-analysis arriving in the other (the dismiss→reappear bug).
    const composed = 'Café Project' // é = U+00E9
    const decomposed = 'Café Project' // e + U+0301 combining acute
    expect(composed).not.toBe(decomposed)
    expect(normalizeName(composed)).toBe(normalizeName(decomposed))
    expect(normalizeName(decomposed)).toBe('café project')
    // NFKC also folds compatibility forms: the ﬁ ligature (U+FB01) → 'fi', and a
    // non-breaking space (U+00A0) becomes a normal space (then collapses).
    expect(normalizeName('ﬁle sync')).toBe('file sync')
    expect(normalizeName('atlas migration')).toBe('atlas migration')
  })
})

describe('stripDiacritics / accentFoldedKey', () => {
  it('removes combining marks', () => {
    expect(stripDiacritics('Óscar')).toBe('Oscar')
    expect(stripDiacritics('Sebastián')).toBe('Sebastian')
  })
  it('accentFoldedKey normalizes and folds together', () => {
    expect(accentFoldedKey('Óscar')).toBe(accentFoldedKey('oscar'))
    expect(accentFoldedKey('Sebastián')).toBe('sebastian')
  })
})

describe('looksLikeEmail', () => {
  it('accepts real emails, rejects names', () => {
    expect(looksLikeEmail('a@b.com')).toBe(true)
    expect(looksLikeEmail('sebastian.geraldes@dfx5.com')).toBe(true)
    expect(looksLikeEmail('Sebastián')).toBe(false)
    expect(looksLikeEmail('a@b')).toBe(false)
  })
})

describe('isGenericSpeakerLabel', () => {
  it('flags Speaker N labels', () => {
    expect(isGenericSpeakerLabel('Speaker')).toBe(true)
    expect(isGenericSpeakerLabel('Speaker 2')).toBe(true)
    expect(isGenericSpeakerLabel('speaker3')).toBe(true)
    expect(isGenericSpeakerLabel('Javier')).toBe(false)
  })
})

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'kitten')).toBe(0)
    expect(levenshtein('kitten', 'sitten')).toBe(1)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
})

describe('fuzzyNameScore', () => {
  it('scores tiny edits in the 0.7–0.8 band', () => {
    expect(fuzzyNameScore('sebastian', 'sebastan')).toBeGreaterThanOrEqual(0.7) // lev 1
    const two = fuzzyNameScore('sebastian', 'sebastn') // lev 2
    expect(two).toBeGreaterThanOrEqual(0.6)
    expect(two).toBeLessThan(0.75)
  })
  it('scores prefix overlap', () => {
    expect(fuzzyNameScore('sebas', 'sebastian')).toBeGreaterThan(0.6)
  })
  it('scores a shared whole word', () => {
    expect(fuzzyNameScore('project atlas', 'atlas migration')).toBeGreaterThan(0.6)
  })
  it('returns 0 for unrelated names', () => {
    expect(fuzzyNameScore('sebastian', 'monica')).toBe(0)
  })
  it('never exceeds the fuzzy band', () => {
    expect(fuzzyNameScore('a', 'b')).toBeLessThanOrEqual(0.8)
  })

  /**
   * Edit distance is only a typo signal RELATIVE to length. With flat thresholds
   * every short name was a near-miss for every other — "ai" vs "xr" is distance
   * 2 on a 2-char string, i.e. entirely different, yet scored 0.7. With a
   * co-occurrence boost that was enough to auto-link one acronym project onto
   * another. Surfaced by F12 making short acronym projects creatable.
   */
  it('does not treat short unrelated names as edits of each other', () => {
    expect(fuzzyNameScore('ai', 'xr')).toBe(0) // distance 2 on 2 chars
    expect(fuzzyNameScore('crm', 'erp')).toBe(0)
    expect(fuzzyNameScore('ana', 'ane')).toBe(0) // distance 1 on 3 chars
  })

  it('still scores edits on names long enough for the distance to mean a typo', () => {
    expect(fuzzyNameScore('atlas', 'atlus')).toBeGreaterThanOrEqual(0.7) // lev 1, len 5
    expect(fuzzyNameScore('meridian', 'meridain')).toBeGreaterThanOrEqual(0.6) // lev 2, len 8
  })

  it('docks opposite-gender Spanish pairs below a plain edit-1 match', () => {
    // Fernando/Fernanda differ only in the final a↔o — an edit distance of 1 that
    // would otherwise score 0.78; the gender penalty drops it by 0.25.
    const plain = fuzzyNameScore('fernanro', 'fernando') // lev 1, not a gender pair
    expect(plain).toBeCloseTo(0.78, 5)
    const gendered = fuzzyNameScore('fernando', 'fernanda')
    expect(gendered).toBeCloseTo(0.53, 5)
    expect(gendered).toBeLessThan(plain)
    // Below the 0.6·name discovery contribution needed to clear the 0.5 bar alone.
    expect(0.6 * gendered).toBeLessThan(0.5)
  })
})

describe('isOppositeGenderSpanishPair', () => {
  it('flags single-token a↔o pairs', () => {
    expect(isOppositeGenderSpanishPair('fernando', 'fernanda')).toBe(true)
    expect(isOppositeGenderSpanishPair('sergio', 'sergia')).toBe(true)
    expect(isOppositeGenderSpanishPair('mario', 'maria')).toBe(true)
  })
  it('flags the swap inside an otherwise-identical full name', () => {
    expect(isOppositeGenderSpanishPair('fernando garcia', 'fernanda garcia')).toBe(true)
  })
  it('does not flag genuine typos or unrelated names', () => {
    expect(isOppositeGenderSpanishPair('sebastian', 'sebastan')).toBe(false) // dropped letter, not a/o
    expect(isOppositeGenderSpanishPair('carlos', 'carlas')).toBe(false) // ends s, not a/o
    expect(isOppositeGenderSpanishPair('ana', 'ano')).toBe(true) // short but valid a/o swap
    expect(isOppositeGenderSpanishPair('fernando lopez', 'fernanda garcia')).toBe(false) // two tokens differ
  })
})

describe('cleanRole', () => {
  it('strips extraction-artifact parentheticals (EN + ES)', () => {
    expect(cleanRole('Engineer (mencionado)')).toBe('Engineer')
    expect(cleanRole('Product Manager (mentioned)')).toBe('Product Manager')
    expect(cleanRole('Designer (inferred)')).toBe('Designer')
    expect(cleanRole('PM · Client (inferido)')).toBe('PM · Client')
  })
  it('keeps meaningful parentheticals and is empty-safe', () => {
    expect(cleanRole('VP (Sales)')).toBe('VP (Sales)')
    expect(cleanRole(null)).toBe('')
    expect(cleanRole(undefined)).toBe('')
  })
})

describe('single-token / surname helpers', () => {
  it('detects single-token names', () => {
    expect(isSingleToken('Sergio')).toBe(true)
    expect(isSingleToken('  Sergi  ')).toBe(true)
    expect(isSingleToken('Sergio Hurtado')).toBe(false)
    expect(isSingleToken('')).toBe(false)
  })

  it('detects surname-bearing names', () => {
    expect(hasSurname('Sergio Hurtado')).toBe(true)
    expect(hasSurname('Sergio')).toBe(false)
  })

  it('matches a first name / nickname against a full name (accent + prefix aware)', () => {
    expect(firstNameNicknameMatch('Sergio', 'Sergio Hurtado')).toBe(true)
    expect(firstNameNicknameMatch('Sergi', 'Sergio Hurtado')).toBe(true) // nickname prefix
    expect(firstNameNicknameMatch('Santi', 'Santiago Rojas')).toBe(true)
    expect(firstNameNicknameMatch('Sebas', 'Sebastián Herrera')).toBe(true) // accent-folded
    expect(firstNameNicknameMatch('Sergio', 'Reyes Sergio')).toBe(false) // first token is Reyes
    expect(firstNameNicknameMatch('Al', 'Alejandro Ruiz')).toBe(false) // too short
  })
})

describe('detectAmbiguousName', () => {
  const corpus = [
    { id: 'c-sh', name: 'Sergio Hurtado' },
    { id: 'c-sr', name: 'Sergio Reyes' },
    { id: 'c-o', name: 'Oscar Ruiz' },
    { id: 'c-santi1', name: 'Santiago Rojas' },
    { id: 'c-santi2', name: 'Santiago Arboleda' },
    { id: 'c-seb1', name: 'Sebastián Geraldes' },
    { id: 'c-seb2', name: 'Sebastián Herrera' }
  ]

  it('flags a bare first name that fits two distinct surname-bearers', () => {
    const r = detectAmbiguousName('Sergio', corpus)
    expect(r.ambiguous).toBe(true)
    expect(r.matches.map((m) => m.id).sort()).toEqual(['c-sh', 'c-sr'])
  })

  it('flags nicknames (Sergi/Santi/Sebas) as the same bucket', () => {
    expect(detectAmbiguousName('Sergi', corpus).ambiguous).toBe(true)
    expect(detectAmbiguousName('Santi', corpus).ambiguous).toBe(true)
    expect(detectAmbiguousName('Sebas', corpus).ambiguous).toBe(true)
  })

  it('does NOT flag a bare name with a single match', () => {
    expect(detectAmbiguousName('Oscar', corpus).ambiguous).toBe(false)
  })

  it('does NOT flag a full (surname-bearing) name', () => {
    expect(detectAmbiguousName('Sergio Hurtado', corpus).ambiguous).toBe(false)
  })

  it('counts duplicate rows of one person as a single distinct match', () => {
    const dup = [
      { id: 'c-1', name: 'Sergio Hurtado' },
      { id: 'c-2', name: 'Sergio Hurtado' } // duplicate contact, same person
    ]
    expect(detectAmbiguousName('Sergio', dup).ambiguous).toBe(false)
  })

  it('excludes the bucket contact itself via selfId', () => {
    const withBucket = [...corpus, { id: 'c-bucket', name: 'Sergio' }]
    const r = detectAmbiguousName('Sergio', withBucket, 'c-bucket')
    expect(r.matches.some((m) => m.id === 'c-bucket')).toBe(false)
    expect(r.ambiguous).toBe(true)
  })
})
