/**
 * Name base-rate ("rarity") scoring for entity resolution (Round 4c).
 *
 * A fuzzy string match on a RARE name is strong evidence; the same match on a
 * COMMON short token ('Juan', 'Sebas', 'Ale') is weak — its collision probability
 * is high, so two people sharing it is unremarkable. This pure helper turns a
 * name's base-rate signals (how many contacts bear its token, how short it is, how
 * often it is spoken in transcripts) into a confidence delta the resolver and the
 * discovery sweep both apply, and a `rarity` label the merge card frames with.
 *
 * Kept dependency-free (no DB, no electron) so it can be unit-tested in isolation
 * and shared by entity-resolver.ts and identity-discovery.ts without a cycle.
 */

export type Rarity = 'common' | 'rare' | 'normal'

export interface RarityStats {
  /** Distinct entities (contacts/projects) that bear this token — the base rate. */
  bearers: number
  /** Length of the token whose base rate is measured (short tokens collide more). */
  tokenLength: number
  /** Optional transcript mention count — a very-often-spoken token is ambiguous too. */
  mentions?: number
}

export interface RarityResult {
  rarity: Rarity
  /** Confidence delta to add to the fuzzy/composite score (0 for 'normal'). */
  delta: number
}

// Thresholds — the single source of truth for tuning.
/** ≥ this many bearers ⇒ the token is common regardless of length. */
export const COMMON_BEARERS = 3
/** Tokens this short with ≥2 bearers are common (first-name nicknames collide). */
export const SHORT_TOKEN_LEN = 4
/** ≤ this many bearers (and not a short token) ⇒ the token is rare. */
export const RARE_BEARERS = 2
/** A token spoken in at least this many transcripts is treated as common/ambiguous. */
export const COMMON_MENTIONS = 40
/** Common names are demoted by this much — pushes a weak fuzzy below the suggest bar. */
export const COMMON_DELTA = -0.15
/** Rare names get a small corroborating boost — a rare fuzzy match rarely collides. */
export const RARE_DELTA = 0.05

/**
 * Classify a token by base rate and return the confidence delta to apply.
 *   common  → −0.15 (many bearers, a ≤4-char token with multiple bearers, or heavy
 *             transcript use): "different circles could still be one person, but the
 *             name alone proves nothing — verify".
 *   rare    → +0.05 (1–2 bearers, longer than a nickname): the match stands.
 *   normal  → 0.
 */
export function nameRarity(stats: RarityStats): RarityResult {
  const bearers = Math.max(0, stats.bearers)
  const tokenLength = Math.max(0, stats.tokenLength)
  const mentions = Math.max(0, stats.mentions ?? 0)

  const isCommon =
    bearers >= COMMON_BEARERS ||
    (tokenLength > 0 && tokenLength <= SHORT_TOKEN_LEN && bearers >= 2) ||
    mentions >= COMMON_MENTIONS
  if (isCommon) return { rarity: 'common', delta: COMMON_DELTA }

  const isRare = bearers <= RARE_BEARERS && tokenLength > SHORT_TOKEN_LEN && mentions < COMMON_MENTIONS
  if (isRare) return { rarity: 'rare', delta: RARE_DELTA }

  return { rarity: 'normal', delta: 0 }
}
