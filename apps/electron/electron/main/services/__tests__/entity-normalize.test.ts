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
  cleanRole
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
