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

import { getExcludedRecordingIds } from './database'

export interface EligibilityResult {
  /** The subset of the input ids that are eligible to surface. Empty when failClosed. */
  eligible: Set<string>
  /** True when the exclusion lookup could not complete → treat all as ineligible. */
  failClosed: boolean
}

/**
 * Given candidate recording ids, return the subset eligible for AI/UI
 * surfacing. Fail-closed: on any exclusion-lookup failure the eligible set is
 * empty and `failClosed` is true.
 */
export function filterEligibleRecordingIds(candidateIds: Iterable<string>): EligibilityResult {
  let excluded: Set<string>
  let failClosed: boolean
  try {
    ;({ ids: excluded, failClosed } = getExcludedRecordingIds())
  } catch (e) {
    // Any unexpected failure computing the exclusion set → fail closed.
    console.error('[Eligibility] exclusion lookup threw — failing closed:', e)
    return { eligible: new Set<string>(), failClosed: true }
  }
  if (failClosed) return { eligible: new Set<string>(), failClosed: true }
  const eligible = new Set<string>()
  for (const id of candidateIds) {
    if (id && !excluded.has(id)) eligible.add(id)
  }
  return { eligible, failClosed: false }
}

/**
 * Single-recording convenience for point-of-use gating (pinned context, output
 * generation). Fail-closed: any lookup failure → false (not eligible).
 */
export function isRecordingEligible(recordingId: string): boolean {
  try {
    const { ids: excluded, failClosed } = getExcludedRecordingIds()
    return !failClosed && !excluded.has(recordingId)
  } catch (e) {
    console.error('[Eligibility] exclusion lookup threw — failing closed:', e)
    return false
  }
}
