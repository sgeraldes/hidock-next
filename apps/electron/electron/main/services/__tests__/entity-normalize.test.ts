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
  fuzzyNameScore
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
})
