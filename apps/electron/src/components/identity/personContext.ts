/**
 * Graph-neighborhood context for the two sides of an identity merge card (B7
 * symmetric context / base-rate awareness). Each side carries the people it most
 * co-attends with and the topics/projects closest to it; SHARED entries are merge
 * evidence (same circle), fully disjoint context is a "different circles" caution.
 * Pure and unit-tested; the backend (identity:getPersonContext) supplies the raw
 * {@link PersonContext} for each side.
 *
 * People are matched by exact (case-insensitive) label — a person either is or is
 * not the same node. Topics are matched SEMANTICALLY ({@link topicsShare}): free-text
 * topic labels like "Code Review Bottlenecks and Peer Reviews" and "Process for Peer
 * Review and Evidence Uploads" describe the same subject and must count as shared,
 * so exact-string intersection badly under-reports overlap and mislabels same-circle
 * pairs as "different circles".
 */

/** Raw context for one person, from identity:getPersonContext. */
export interface PersonContext {
  people: string[]
  topics: string[]
}

/** A context entry tagged with whether the other side shares it. */
export interface ContextChip {
  label: string
  shared: boolean
}

/** One side's chips, split by kind. */
export interface SideContext {
  people: ContextChip[]
  topics: ContextChip[]
}

export interface ContextComparison {
  a: SideContext
  b: SideContext
  /** At least one entry appears on both sides — corroborating merge evidence. */
  hasShared: boolean
  /**
   * Topics on the two sides are semantically related (fuzzy overlap) — a POSITIVE
   * "related topics" signal even when no label matches verbatim. Always implies
   * `hasShared`, and always suppresses `disjoint`.
   */
  relatedTopics: boolean
  /** Both sides have context yet share nothing (people or topics) — "different circles". */
  disjoint: boolean
}

const key = (s: string): string => s.trim().toLowerCase()

/** Combining diacritical marks (U+0300–U+036F); built from escapes to keep the source ASCII. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

/** Drop diacritics for accent-insensitive comparison ("Peña" → "pena"). */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARKS, '')
}

/**
 * Function words to ignore when comparing topic labels, English + Spanish (topics are
 * bilingual in this corpus). Kept deliberately small: only true connectors, never
 * subject-bearing nouns like "process" or "review".
 */
const TOPIC_STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'without',
  'from', 'into', 'about', 'over', 'under', 'per', 'via', 'vs', 'as', 'is', 'are', 'be', 'this',
  'that', 'these', 'those', 'it', 'its',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'y', 'o', 'u', 'para', 'por',
  'con', 'sin', 'en', 'a', 'al', 'que', 'sobre', 'como', 'su', 'sus', 'lo'
])

/** A shared token this length or longer, on its own, marks two topics as the same subject. */
const DISTINCTIVE_TOKEN_LEN = 4

/** Token overlap at or above this Jaccard ratio marks two topics as the same subject. */
const TOPIC_JACCARD_THRESHOLD = 0.4

/**
 * Light suffix trim so plural/gerund variants collapse ("reviews" → "review",
 * "uploads" → "upload", "bottlenecks" → "bottleneck", "procesos" → "proceso"). Not a
 * real stemmer — just enough to align the endings that show up in topic phrases.
 */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  // Plural 's', but not the many words that legitimately end in s ("process", "status",
  // "analysis") — over-stemming those would break their token equality.
  if (
    token.length > 3 &&
    token.endsWith('s') &&
    !token.endsWith('ss') &&
    !token.endsWith('us') &&
    !token.endsWith('is')
  ) {
    return token.slice(0, -1)
  }
  return token
}

/** Lowercase, de-accent, split on non-alphanumerics, drop stopwords, stem. Deduped set. */
export function topicTokens(topic: string): Set<string> {
  const out = new Set<string>()
  for (const raw of stripAccents((topic || '').toLowerCase()).split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue
    if (TOPIC_STOPWORDS.has(raw)) continue
    out.add(stem(raw))
  }
  return out
}

/**
 * Do two free-text topic labels describe the same subject? True when they share a
 * distinctive token (length ≥ 4, e.g. "review", "jira", "peer") OR their token sets
 * overlap by Jaccard ≥ 0.4. Purely lexical and symmetric.
 */
export function topicsShare(a: string, b: string): boolean {
  const ta = topicTokens(a)
  const tb = topicTokens(b)
  if (ta.size === 0 || tb.size === 0) return false

  let intersection = 0
  for (const t of ta) {
    if (tb.has(t)) {
      intersection++
      if (t.length >= DISTINCTIVE_TOKEN_LEN) return true // a single strong shared word is enough
    }
  }
  if (intersection === 0) return false

  const union = ta.size + tb.size - intersection
  return intersection / union >= TOPIC_JACCARD_THRESHOLD
}

/** Tag each of `mine` with whether `theirs` contains it (exact, case-insensitive), deduped. */
function toPeopleChips(mine: string[], theirs: string[]): ContextChip[] {
  const other = new Set(theirs.map(key))
  const seen = new Set<string>()
  const out: ContextChip[] = []
  for (const label of mine) {
    const k = key(label)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push({ label, shared: other.has(k) })
  }
  return out
}

/** Tag each of `mine` with whether any of `theirs` is the same subject ({@link topicsShare}), deduped. */
function toTopicChips(mine: string[], theirs: string[]): ContextChip[] {
  const seen = new Set<string>()
  const out: ContextChip[] = []
  for (const label of mine) {
    const k = key(label)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push({ label, shared: theirs.some((t) => topicsShare(label, t)) })
  }
  return out
}

/**
 * Compare two persons' context into highlighted chip rows. A `shared` chip is
 * corroboration; people match exactly, topics match semantically. When both sides
 * carry context but overlap in nothing, `disjoint` flags "different circles";
 * `relatedTopics` surfaces a positive signal whenever the topics are fuzzy-shared.
 */
export function computeSharedContext(a: PersonContext, b: PersonContext): ContextComparison {
  const aPeople = toPeopleChips(a.people, b.people)
  const bPeople = toPeopleChips(b.people, a.people)
  const aTopics = toTopicChips(a.topics, b.topics)
  const bTopics = toTopicChips(b.topics, a.topics)

  const relatedTopics = aTopics.some((c) => c.shared)
  const hasShared = relatedTopics || aPeople.some((c) => c.shared)
  const aCount = aPeople.length + aTopics.length
  const bCount = bPeople.length + bTopics.length
  const disjoint = aCount > 0 && bCount > 0 && !hasShared

  return {
    a: { people: aPeople, topics: aTopics },
    b: { people: bPeople, topics: bTopics },
    hasShared,
    relatedTopics,
    disjoint
  }
}
