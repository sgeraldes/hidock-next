/**
 * Round-6 FOUNDATION — THE shared recording-eligibility boundary.
 *
 * Every recording-backed read surface that feeds an LLM or the UI (vector
 * search primitives, RAG pinned/knowledge search, output generation, graph
 * grounding/views) MUST route the recording ids it is about to surface through
 * this boundary. It is FAIL-CLOSED: if the exclusion lookup cannot complete
 * (personal/deleted OR value sub-lookup failure — see database.ts
 * getExcludedRecordingIds), it treats EVERYTHING as ineligible rather than
 * leaking excluded content on a transient DB error.
 *
 * There is deliberately ONE choke-point so a new read surface inherits the
 * exact same policy instead of re-deriving it (the root cause of the
 * whack-a-mole: many independent readers, no shared boundary).
 */

import { getEligibleRecordingIds } from './database'

export interface EligibilityResult {
  /** The subset of the input ids that are eligible to surface. Empty when failClosed. */
  eligible: Set<string>
  /** True when the eligibility lookup could not complete → treat all as ineligible. */
  failClosed: boolean
}

/**
 * ADV9 (round-9) — POSITIVE ALLOWLIST. Given candidate recording ids, return the
 * subset eligible for AI/UI/export surfacing. An id is eligible ONLY if it
 * resolves to an EXISTING recording that is non-personal, non-deleted, and not
 * value-excluded (see database.ts getEligibleRecordingIds). A hard-purged /
 * unknown id — whose `recordings` row is gone, so it was never in the old
 * exclusion blocklist and used to slip through as "eligible" — is now correctly
 * ineligible. Fail-closed: on any lookup failure the eligible set is empty and
 * `failClosed` is true.
 */
export function filterEligibleRecordingIds(candidateIds: Iterable<string>): EligibilityResult {
  try {
    const { eligible, failClosed } = getEligibleRecordingIds(candidateIds)
    if (failClosed) return { eligible: new Set<string>(), failClosed: true }
    return { eligible, failClosed: false }
  } catch (e) {
    // Any unexpected failure computing the allowlist → fail closed.
    console.error('[Eligibility] positive allowlist threw — failing closed:', e)
    return { eligible: new Set<string>(), failClosed: true }
  }
}

/**
 * Single-recording convenience for point-of-use gating (pinned context, output
 * generation, LLM callers). Positive allowlist + fail-closed: eligible ONLY when
 * the id resolves to an existing, non-personal, non-deleted, non-value-excluded
 * recording; any lookup failure → false (not eligible).
 */
export function isRecordingEligible(recordingId: string): boolean {
  try {
    const { eligible, failClosed } = getEligibleRecordingIds([recordingId])
    return !failClosed && eligible.has(recordingId)
  } catch (e) {
    console.error('[Eligibility] positive allowlist threw — failing closed:', e)
    return false
  }
}
