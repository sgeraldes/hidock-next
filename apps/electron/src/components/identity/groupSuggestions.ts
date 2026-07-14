/**
 * Clusters identity suggestions that share the same target (keeper) into one group
 * card, so "3 names may be Saraví" reads as a single decision rather than three
 * disconnected yes/no prompts. Pure and unit-tested.
 */

export type SuggestionTier = 'likely' | 'review'

/** Confidence → review tier. ≥80% is "Likely"; the 50–79% band "Needs review". */
export function tierOf(confidence: number | null | undefined): SuggestionTier {
  return (confidence ?? 0) >= 0.8 ? 'likely' : 'review'
}

export const TIER_LABEL: Record<SuggestionTier, string> = {
  likely: 'Likely (≥80%)',
  review: 'Needs review (50–79%)'
}

/** Minimal shape needed to group + sort; the real suggestion satisfies it. */
export interface GroupableSuggestion {
  target_id: string
  kind: 'person' | 'project'
  confidence: number | null
}

export interface SuggestionGroup<T extends GroupableSuggestion> {
  targetId: string
  kind: 'person' | 'project'
  /** Candidate suggestions for this keeper, highest confidence first. */
  candidates: T[]
  /** Confidence of the group's strongest candidate. */
  maxConfidence: number
  tier: SuggestionTier
}

const TIER_RANK: Record<SuggestionTier, number> = { likely: 1, review: 0 }

/**
 * Group by `target_id` and order for review: stronger tier first, then
 * multi-candidate groups (they carry more decision weight) ahead of singletons,
 * then by confidence descending. Candidates inside a group are sorted the same way.
 */
export function groupSuggestions<T extends GroupableSuggestion>(suggestions: T[]): SuggestionGroup<T>[] {
  const byTarget = new Map<string, T[]>()
  for (const s of suggestions) {
    const arr = byTarget.get(s.target_id)
    if (arr) arr.push(s)
    else byTarget.set(s.target_id, [s])
  }

  const groups: SuggestionGroup<T>[] = []
  for (const [targetId, candidates] of byTarget) {
    const sorted = [...candidates].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    const maxConfidence = sorted[0]?.confidence ?? 0
    groups.push({ targetId, kind: sorted[0].kind, candidates: sorted, maxConfidence, tier: tierOf(maxConfidence) })
  }

  groups.sort((a, b) => {
    if (a.tier !== b.tier) return TIER_RANK[b.tier] - TIER_RANK[a.tier]
    const aMulti = a.candidates.length > 1 ? 1 : 0
    const bMulti = b.candidates.length > 1 ? 1 : 0
    if (aMulti !== bMulti) return bMulti - aMulti
    return b.maxConfidence - a.maxConfidence
  })

  return groups
}
