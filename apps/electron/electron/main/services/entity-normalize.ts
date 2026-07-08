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

/**
 * Fuzzy similarity of two already-normalized names, returning a base confidence
 * in the 0.6–0.8 band (0 = not a fuzzy match). Rules (INTELLIGENCE.md §2):
 * Levenshtein ≤2, or a prefix/contained-word overlap on the normalized names.
 * The caller adds a context boost and applies the tier thresholds.
 */
export function fuzzyNameScore(aNorm: string, bNorm: string): number {
  if (!aNorm || !bNorm) return 0
  if (aNorm === bNorm) return 0.8

  const dist = levenshtein(aNorm, bNorm)
  if (dist === 1) return 0.78
  if (dist === 2) return 0.7

  const minLen = Math.min(aNorm.length, bNorm.length)
  if (minLen >= 3 && (aNorm.startsWith(bNorm) || bNorm.startsWith(aNorm))) return 0.68
  if (sharesWord(aNorm, bNorm)) return 0.62

  return 0
}
