/**
 * Graph-neighborhood context for the two sides of an identity merge card (B7
 * symmetric context / base-rate awareness). Each side carries the people it most
 * co-attends with and the topics/projects closest to it; SHARED entries are merge
 * evidence (same circle), fully disjoint context is a "different circles" caution.
 * Pure and unit-tested; the backend (identity:getPersonContext) supplies the raw
 * {@link PersonContext} for each side.
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
  /** Both sides have context yet share nothing — a "different circles" warning. */
  disjoint: boolean
}

const key = (s: string): string => s.trim().toLowerCase()

/** Tag each of `mine` with whether `theirs` contains it (case-insensitive), deduped. */
function toChips(mine: string[], theirs: string[]): ContextChip[] {
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

/**
 * Compare two persons' context into highlighted chip rows. `shared` chips (present
 * on both sides, matched within their kind) are the corroboration; when both sides
 * carry context but overlap in nothing, `disjoint` flags "different circles".
 */
export function computeSharedContext(a: PersonContext, b: PersonContext): ContextComparison {
  const aPeople = toChips(a.people, b.people)
  const bPeople = toChips(b.people, a.people)
  const aTopics = toChips(a.topics, b.topics)
  const bTopics = toChips(b.topics, a.topics)

  const hasShared = [...aPeople, ...aTopics].some((c) => c.shared)
  const aCount = aPeople.length + aTopics.length
  const bCount = bPeople.length + bTopics.length
  const disjoint = aCount > 0 && bCount > 0 && !hasShared

  return {
    a: { people: aPeople, topics: aTopics },
    b: { people: bPeople, topics: bTopics },
    hasShared,
    disjoint,
  }
}
