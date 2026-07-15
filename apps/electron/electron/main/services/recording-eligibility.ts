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

import {
  getEligibleRecordingIds,
  getExistingRecordingIds,
  getExistingCaptureIds,
  getCaptureEligibilityRows
} from './database'

export interface EligibilityResult {
  /** The subset of the input ids that are eligible to surface. Empty when failClosed. */
  eligible: Set<string>
  /** True when the eligibility lookup could not complete → treat all as ineligible. */
  failClosed: boolean
}

/** ADV11 (round-12) — id-existence result shared by the boundary. */
export interface ExistenceResult {
  ids: Set<string>
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
 * ADV11 (round-12) — POSITIVE PROVENANCE existence probes, routed through the
 * shared boundary so every consumer (not just the vector store) resolves
 * recording/artifact provenance against the DB rather than trusting a
 * renderer-settable field. `existingRecordings` = which candidate ids name REAL
 * recordings (any state); `existingCaptures` = which name REAL knowledge
 * captures. Both fail closed. See vector-store.ts filterEligibleDocs for why
 * trusting `captureId` PRESENCE (round-11) was a privacy bypass: a renderer
 * could forge a `captureId` to make an excluded recording's chunks skip the
 * recording allowlist. Resolving provenance positively against the DB closes it.
 */
export function existingRecordings(candidateIds: Iterable<string>): ExistenceResult {
  try {
    return getExistingRecordingIds(candidateIds)
  } catch (e) {
    console.error('[Eligibility] existingRecordings threw — failing closed:', e)
    return { ids: new Set<string>(), failClosed: true }
  }
}

export function existingCaptures(candidateIds: Iterable<string>): ExistenceResult {
  try {
    return getExistingCaptureIds(candidateIds)
  } catch (e) {
    console.error('[Eligibility] existingCaptures threw — failing closed:', e)
    return { ids: new Set<string>(), failClosed: true }
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

/**
 * ADV15 (round-16) — F16 value ratings that exclude a STANDALONE capture (one
 * with NO source recording) from assistant/DISPLAY surfaces. Mirrors
 * database.ts VALUE_EXCLUDED_RATINGS; kept here as the single source of truth for
 * the capture boundary so the knowledge/actionables/projects handlers don't each
 * re-declare (and drift on) the excluded set. Keep 'valuable' | 'archived' |
 * null/unrated.
 */
export const CAPTURE_VALUE_EXCLUDED_RATINGS: ReadonlySet<string> = new Set(['garbage', 'low-value'])

/**
 * ADV15 (round-16) — THE shared, central capture-eligibility boundary. Exactly
 * as recordings got {@link filterEligibleRecordingIds} at round 6, every
 * capture-derived read surface (knowledge:getAll/getById/getByIds, actionables
 * lists + Today briefing, project actionables) MUST route the capture ids it is
 * about to surface through THIS one choke-point instead of re-deriving a
 * per-handler predicate (the recurring trap: each handler missed a case —
 * deleted_at, or standalone quality, or value exclusion).
 *
 * A capture is ELIGIBLE iff:
 *   • its own `deleted_at IS NULL` (the capture is not soft-deleted), AND
 *   • EITHER it is RECORDING-DERIVED (has a `source_recording_id`) and that
 *     recording passes {@link filterEligibleRecordingIds} — inheriting the
 *     recording's personal / soft-deleted / value-excluded / hard-purged
 *     exclusion — OR it is STANDALONE (no source recording) and its OWN
 *     `quality_rating` is not value-excluded (not garbage/low-value).
 *
 * FAIL-CLOSED, precisely:
 *   • If the CAPTURE-ROW lookup itself fails, nothing can be determined → empty
 *     eligible set with `failClosed = true` so callers drop EVERYTHING.
 *   • If the RECORDING sub-lookup fails, only the RECORDING-DERIVED captures
 *     cannot be verified → they are conservatively DROPPED (never leaked), while
 *     STANDALONE captures — which do not depend on the recording lookup — are
 *     still evaluated. `failClosed` stays `false` because the returned eligible
 *     set is complete for what is verifiable and never over-includes. This keeps
 *     the RE7-P2c invariant (a standalone capture stays visible when a recording
 *     exclusion lookup has a transient failure) without a leak.
 * A capture id that does not resolve to a live capture row is simply absent from
 * `eligible` (positive allowlist — hard-purged/orphan ⇒ ineligible).
 */
export function filterEligibleCaptureIds(captureIds: Iterable<string>): EligibilityResult {
  try {
    const unique = [...new Set([...captureIds].filter((id): id is string => !!id))]
    if (unique.length === 0) return { eligible: new Set<string>(), failClosed: false }

    const { rows, failClosed } = getCaptureEligibilityRows(unique)
    if (failClosed) return { eligible: new Set<string>(), failClosed: true }

    // Only non-soft-deleted captures can be eligible.
    const live = rows.filter((r) => r.deleted_at == null)

    // Recording-derived captures delegate to the recording allowlist. A recording
    // sub-lookup failure drops ONLY recording-derived captures (conservative), not
    // standalone ones.
    const sourceIds = live.map((r) => r.source_recording_id).filter((id): id is string => !!id)
    const { eligible: eligibleRecs, failClosed: recFailClosed } = filterEligibleRecordingIds(sourceIds)

    const eligible = new Set<string>()
    for (const r of live) {
      if (r.source_recording_id) {
        if (!recFailClosed && eligibleRecs.has(r.source_recording_id)) eligible.add(r.id)
      } else if (!CAPTURE_VALUE_EXCLUDED_RATINGS.has(r.quality_rating ?? '')) {
        eligible.add(r.id)
      }
    }
    return { eligible, failClosed: false }
  } catch (e) {
    console.error('[Eligibility] filterEligibleCaptureIds threw — failing closed:', e)
    return { eligible: new Set<string>(), failClosed: true }
  }
}

/**
 * Single-capture convenience for point-of-use gating. Positive allowlist +
 * fail-closed: true only when the id resolves to an eligible capture.
 */
export function isCaptureEligible(captureId: string): boolean {
  const { eligible, failClosed } = filterEligibleCaptureIds([captureId])
  return !failClosed && eligible.has(captureId)
}
