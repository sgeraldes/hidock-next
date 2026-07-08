/**
 * Pure name-normalization + fuzzy-scoring helpers for entity resolution (Round 4a).
 *
 * Kept dependency-free (no DB, no electron) so both database.ts and
 * entity-resolver.ts can share them without a circular import, and so the
 * scoring rules can be unit-tested in isolation.
 */

/** Lowercase, trim, collapse internal whitespace. Matches the graph store's key. */
export function normalizeName(name: string): string {
  return (name || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/** Combining-marks range U+0300–U+036F, built without literal marks in source. */
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g')

/** Strip diacritics/combining marks (NFD decompose + drop U+0300–U+036F). */
export function stripDiacritics(value: string): string {
  return (value || '').normalize('NFD').replace(COMBINING_MARKS, '')
}

/** Accent-insensitive normalized key: normalizeName + stripDiacritics. */
export function accentFoldedKey(name: string): string {
  return stripDiacritics(normalizeName(name))
}

/** Whether a raw string looks like an email address (used to gate the email tier). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim())
}

/** A generic transcript speaker label ("Speaker", "Speaker 2") carries no identity. */
export function isGenericSpeakerLabel(value: string): boolean {
  return /^speaker\s*\d*$/i.test((value || '').trim())
}

/** Classic Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

/** Whether either normalized string is a whole-word member of the other. */
function sharesWord(a: string, b: string): boolean {
  const aw = a.split(' ').filter((w) => w.length >= 3)
  const bw = b.split(' ').filter((w) => w.length >= 3)
  return aw.some((w) => bw.includes(w))
}

/** How much an opposite-gender Spanish name pair is docked from its fuzzy score. */
const GENDER_PAIR_PENALTY = 0.25

/** True when two ≥3-char tokens are identical but for a final a↔o (Sergio/Sergia). */
function isGenderVowelSwap(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 3) return false
  const al = a[a.length - 1]
  const bl = b[b.length - 1]
  const swapped = (al === 'a' && bl === 'o') || (al === 'o' && bl === 'a')
  return swapped && a.slice(0, -1) === b.slice(0, -1)
}

/**
 * Two normalized names that differ in exactly one token, where that token is an
 * opposite-gender Spanish pair (Fernando/Fernanda, Sergio/Sergia, and the same
 * swap inside an otherwise-identical full name). These read as a near-miss to a
 * pure edit-distance check but are almost always *different people*, so callers
 * dock the fuzzy score to keep them out of the auto-suggest band.
 */
export function isOppositeGenderSpanishPair(aNorm: string, bNorm: string): boolean {
  if (!aNorm || !bNorm) return false
  const at = aNorm.split(' ')
  const bt = bNorm.split(' ')
  if (at.length !== bt.length) return false
  let diffs = 0
  let gendered = false
  for (let i = 0; i < at.length; i++) {
    if (at[i] === bt[i]) continue
    if (++diffs > 1) return false
    gendered = isGenderVowelSwap(at[i], bt[i])
  }
  return diffs === 1 && gendered
}

/**
 * Fuzzy similarity of two already-normalized names, returning a base confidence
 * in the 0.6–0.8 band (0 = not a fuzzy match). Rules (INTELLIGENCE.md §2):
 * Levenshtein ≤2, or a prefix/contained-word overlap on the normalized names.
 * The caller adds a context boost and applies the tier thresholds.
 *
 * Opposite-gender Spanish pairs (Fernando/Fernanda) match by edit distance but
 * are docked {@link GENDER_PAIR_PENALTY} so they fall below the suggestion bar
 * unless another signal (email/graph) independently corroborates the pairing.
 */
export function fuzzyNameScore(aNorm: string, bNorm: string): number {
  if (!aNorm || !bNorm) return 0

  let score: number
  if (aNorm === bNorm) {
    score = 0.8
  } else {
    const dist = levenshtein(aNorm, bNorm)
    const minLen = Math.min(aNorm.length, bNorm.length)
    if (dist === 1) score = 0.78
    else if (dist === 2) score = 0.7
    else if (minLen >= 3 && (aNorm.startsWith(bNorm) || bNorm.startsWith(aNorm))) score = 0.68
    else if (sharesWord(aNorm, bNorm)) score = 0.62
    else return 0
  }

  if (isOppositeGenderSpanishPair(aNorm, bNorm)) {
    score = Math.max(0, score - GENDER_PAIR_PENALTY)
  }
  return score
}
