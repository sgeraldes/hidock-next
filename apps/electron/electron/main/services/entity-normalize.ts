/**
 * Pure name-normalization + fuzzy-scoring helpers for entity resolution (Round 4a).
 *
 * Kept dependency-free (no DB, no electron) so both database.ts and
 * entity-resolver.ts can share them without a circular import, and so the
 * scoring rules can be unit-tested in isolation.
 */

/**
 * Canonical name key: Unicode-normalize (NFKC), lowercase, trim, collapse
 * internal whitespace. Matches the graph store's key.
 *
 * NFKC matters for identity: composed vs decomposed accents ("café" typed as
 * NFC vs NFD) are DIFFERENT JS strings but the same name — without folding
 * them, a discovery-rejection tombstone written under one form fails to match
 * a re-analysis arriving in the other, and createProject can clear a different
 * key than the reconciler checks. NFKC also folds compatibility forms
 * (ligatures like ﬁ → fi, fullwidth chars, NBSP → space) so visually-identical
 * spellings share one key.
 */
export function normalizeName(name: string): string {
  return (name || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
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

/**
 * Words that mark a role parenthetical as an extraction artifact ("Engineer
 * (mencionado)") rather than a meaningful qualifier ("VP (Sales)"). EN + ES. Kept in
 * sync with the renderer helper in src/lib/roleHygiene.ts.
 */
const ROLE_ARTIFACT_PARENS = new RegExp(
  '\\s*\\((?:[^)]*\\b(?:mencionad[oa]s?|mentioned|inferred|inferid[oa]s?|assumed|asumid[oa]s?|' +
    'posible|possible|probable|likely|guess(?:ed)?|unverified|unconfirmed|no confirmad[oa]|' +
    'sin confirmar|unknown|desconocid[oa]|implied|implicad[oa])\\b[^)]*)\\)',
  'gi'
)

/** Strip extraction-artifact parentheticals from a role before storing it. Idempotent. */
export function cleanRole(role: string | null | undefined): string {
  if (!role) return ''
  return role
    .replace(ROLE_ARTIFACT_PARENS, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[-–—,·|/]\s*$/, '')
    .trim()
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

/**
 * Shortest name for which a 1- or 2-character edit distance still reads as a
 * misspelling rather than a different word. Below these, distance is noise:
 * every 2-char string is within distance 2 of every other.
 */
const MIN_LEN_FOR_EDIT_1 = 4
const MIN_LEN_FOR_EDIT_2 = 5

/**
 * For a SHORT name, a prefix match must be a genuine expansion rather than a
 * one-or-two-character variant. Without this the prefix rule quietly undoes the
 * length-gated edit-distance rule above: "crm" vs "crmx" is rejected as an edit
 * (distance 1 on 3 chars) but still scored 0.68 as a prefix, and the resolver's
 * co-occurrence boost (+0.15) carried it to 0.83 — over the 0.8 auto-link line —
 * silently attaching one short acronym project to a different one in the same
 * meeting. Nickname expansions are unaffected: "edu"/"eduardo" grows by 4.
 */
const MIN_PREFIX_GROWTH = 2

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
    // An edit distance only signals a typo RELATIVE to length. Flat thresholds
    // made every short name a near-miss for every other: "AI" vs "XR" is
    // distance 2 on a 2-char string — i.e. entirely different — yet scored 0.7
    // and, with a context boost, auto-linked one acronym project onto another.
    // Require the shorter name to be long enough for the distance to mean
    // "misspelling" rather than "different word".
    if (dist === 1 && minLen >= MIN_LEN_FOR_EDIT_1) score = 0.78
    else if (dist === 2 && minLen >= MIN_LEN_FOR_EDIT_2) score = 0.7
    else if (
      minLen >= 3 &&
      (aNorm.startsWith(bNorm) || bNorm.startsWith(aNorm)) &&
      // Short names must GROW meaningfully to count as a prefix expansion.
      (minLen >= MIN_LEN_FOR_EDIT_2 || Math.max(aNorm.length, bNorm.length) - minLen >= MIN_PREFIX_GROWTH)
    )
      score = 0.68
    else if (sharesWord(aNorm, bNorm)) score = 0.62
    else return 0
  }

  if (isOppositeGenderSpanishPair(aNorm, bNorm)) {
    score = Math.max(0, score - GENDER_PAIR_PENALTY)
  }
  return score
}

// ---------------------------------------------------------------------------
// Ambiguous-name ("mention bucket") detection
// ---------------------------------------------------------------------------
//
// A bare first name or nickname ("Sergio", "Sergi", "Santi") is NOT a person — it
// is an unresolved MENTION BUCKET when the corpus holds several distinct
// surname-bearing people it could denote (Sergio Hurtado, Sergio Reyes). Merging
// those real people into the bucket, or the bucket into one of them, is wrong for
// roughly half the mentions. These pure helpers let the resolver, the discovery
// sweep, and the DB layer agree on what counts as an ambiguous bucket.

/** Accent-folded whitespace tokens of a name (lowercased, marks stripped, ≥1 char). */
export function nameTokens(name: string): string[] {
  return accentFoldedKey(name).split(' ').filter(Boolean)
}

/** A name is a single token when it has exactly one whitespace-delimited word. */
export function isSingleToken(name: string): boolean {
  return nameTokens(name).length === 1
}

/** A name "bears a surname" when it carries ≥2 tokens (a first name plus more). */
export function hasSurname(name: string): boolean {
  return nameTokens(name).length >= 2
}

/**
 * Whether a bare first-name/nickname token identifies the first name of a full name.
 * Accent-folded; matches when the full name's first token equals the bucket token, or
 * one is a prefix of the other — a Spanish nickname is a prefix of the full first
 * name (Sergi→Sergio, Santi→Santiago, Sebas→Sebastián). Requires ≥3 chars on each so
 * a two-letter fragment never collides half the directory.
 */
export function firstNameNicknameMatch(bucketToken: string, fullName: string): boolean {
  const b = stripDiacritics(normalizeName(bucketToken))
  const first = nameTokens(fullName)[0] || ''
  if (b.length < 3 || first.length < 3) return false
  return b === first || first.startsWith(b) || b.startsWith(first)
}

export interface AmbiguityMatch {
  id: string
  name: string
}

export interface AmbiguityResult {
  /** True when the name is a single-token/nickname matching ≥2 distinct surname bearers. */
  ambiguous: boolean
  /** Accent-folded bucket token (empty when the name is not a single token). */
  token: string
  /** The distinct surname-bearing contacts the bucket first name fits, by id. */
  matches: AmbiguityMatch[]
}

/** Minimum token length for a bucket to be considered (guards against "Al"/"Jo"). */
const MIN_BUCKET_TOKEN = 3

/**
 * Classify a name against a contact corpus as an ambiguous mention bucket. Pure:
 * it takes the candidate list so it can be unit-tested and shared by the resolver,
 * discovery, and the DB layer without a cycle. A name is an ambiguous bucket when
 * it is a single token (or nickname prefix) that {@link firstNameNicknameMatch}es
 * ≥2 DISTINCT surname-bearing contacts. Distinctness is by accent-folded full name
 * (so duplicate rows of one person do not manufacture ambiguity); `selfId` excludes
 * the bucket's own row.
 */
export function detectAmbiguousName(
  name: string,
  contacts: Array<{ id: string; name: string }>,
  selfId?: string
): AmbiguityResult {
  if (!isSingleToken(name)) return { ambiguous: false, token: '', matches: [] }
  const token = nameTokens(name)[0] || ''
  if (token.length < MIN_BUCKET_TOKEN) return { ambiguous: false, token, matches: [] }

  const matches: AmbiguityMatch[] = []
  const seenNames = new Set<string>()
  for (const c of contacts) {
    if (selfId && c.id === selfId) continue
    if (!hasSurname(c.name)) continue
    if (!firstNameNicknameMatch(token, c.name)) continue
    const key = accentFoldedKey(c.name)
    if (seenNames.has(key)) continue
    seenNames.add(key)
    matches.push({ id: c.id, name: c.name })
  }
  return { ambiguous: matches.length >= 2, token, matches }
}
