/**
 * Human-readable labels for the fixed value-classification reason tags
 * (F16/spec-001 VALUE_REASON_TAGS, electron/main/services/value-classification.ts).
 *
 * Deliberately does NOT share a type with the main process (which has no
 * exported reason-tag type of its own, only the VALUE_REASON_TAGS runtime
 * array) — this is a renderer-only util, and the reasons arriving over IPC
 * are already plain
 * `string[]` (JSON round-tripped, see mapToKnowledgeCapture's safeParseReasons).
 * The local union below mirrors the fixed vocabulary for exhaustive labeling,
 * while `formatValueReasons` stays defensive against any unrecognized tag (a
 * stale reason from a future/older build) by falling back to the raw string
 * rather than dropping it silently.
 */

export type KnownValueReason =
  | 'personal_family'
  | 'greeting_only_no_show'
  | 'background_ambient'
  | 'no_substance'
  | 'off_topic_chatter'

export const VALUE_REASON_LABELS: Record<KnownValueReason, string> = {
  personal_family: 'Personal / family',
  greeting_only_no_show: 'Greeting only / no-show',
  background_ambient: 'Background / ambient',
  no_substance: 'No substance',
  off_topic_chatter: 'Off-topic chatter'
}

function isKnownValueReason(reason: string): reason is KnownValueReason {
  return Object.prototype.hasOwnProperty.call(VALUE_REASON_LABELS, reason)
}

/**
 * Render a capture's fixed reason tags as a short, comma-separated,
 * human-readable string for the badge tooltip (e.g. "Personal / family,
 * Background / ambient"). Unknown tags fall back to the raw string rather
 * than being dropped, so a badge never silently loses information. Returns
 * an empty string for a missing/empty list — callers should fall back to the
 * "AI-assessed" / "Set by you" line in that case (see SourceRow's ValueBadge).
 */
export function formatValueReasons(reasons: string[] | null | undefined): string {
  if (!reasons || reasons.length === 0) return ''
  return reasons.map((r) => (isKnownValueReason(r) ? VALUE_REASON_LABELS[r] : r)).join(', ')
}
