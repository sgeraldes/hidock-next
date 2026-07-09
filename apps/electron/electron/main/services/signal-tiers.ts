/**
 * Identity signal hierarchy (design principle, Sebastián 2026-07-09):
 * "this is better and easier if there is a meeting related, with calendar, emails,
 * than if we rely completely on context."
 *
 * Prefer objective meeting/calendar/email evidence over transcript context, and
 * NEVER auto-link on LLM inference. The tiers below are the single source of truth
 * for how a mention-resolution's `method` string ranks — used to make the auto-split
 * sweep UPGRADE-ONLY (a higher-tier signal may overwrite a lower-tier resolution,
 * never the reverse) and to let a re-sweep upgrade resolutions when the M365
 * connector backfills real attendee emails.
 *
 *   TIER 1  connector-email   1.00   connector-confirmed identity (email match from a
 *                                    connector source: M365, Slack, Bamboo…)
 *   TIER 2  attendee-email    0.90   linked-meeting attendee, from CALENDAR data
 *                                    (meetings.attendees / organizer_email present)
 *   —       manual            (user) an explicit human pick in the "Resolve per
 *                                    meeting" UI. Sovereign: never auto-overwritten.
 *   TIER 3  speaker-map       0.85   a user-confirmed transcript speaker assignment
 *                                    (transcript_speakers)
 *   TIER 4  attendee-context  0.70   sole candidate among the meeting's people, but
 *                                    those people are TRANSCRIPT-derived, not calendar
 *                                    (the current reality until M365 lands — weak)
 *   TIER 5  lexical           0.60   full-name mention / co-presence in the transcript
 *   TIER 6  inferred          —      anything LLM-inferred. NEVER auto-links.
 *
 * CRITICAL (verified read-only on the live DB, 2026-07-09): 0 of 1,951 meetings carry
 * attendee JSON or organizer_email — the Outlook ICS feed strips them, so ALL current
 * meeting_contacts links are transcript-derived. That is why 'attendee-context' sits
 * at TIER 4 (weak) today and 'attendee-email' (TIER 2) only appears once a connector
 * backfills real attendees; a re-sweep then upgrades those recordings.
 */

export type ResolutionMethod =
  | 'connector-email'
  | 'attendee-email'
  | 'manual'
  | 'speaker-map'
  | 'attendee-context'
  | 'lexical'
  | 'inferred'
  | string

/** Ranking of each method. Higher wins. 'manual' is sovereign (user intent). */
export const METHOD_PRIORITY: Record<string, number> = {
  manual: 100,
  'connector-email': 90,
  'attendee-email': 80,
  'speaker-map': 65,
  'attendee-context': 55,
  lexical: 50,
  inferred: 10,
}

/** Default rank for an unrecognized method — mid-low, above inferred, below signals. */
const UNKNOWN_PRIORITY = 40

/** Priority of a method (0 for none/empty). */
export function methodPriority(method: string | null | undefined): number {
  if (!method) return 0
  return METHOD_PRIORITY[method] ?? UNKNOWN_PRIORITY
}

/** The rough confidence a method implies, for display/storage when not measured. */
export function methodConfidence(method: string | null | undefined): number {
  switch (method) {
    case 'connector-email':
      return 1.0
    case 'attendee-email':
      return 0.9
    case 'manual':
      return 1.0
    case 'speaker-map':
      return 0.85
    case 'attendee-context':
      return 0.7
    case 'lexical':
      return 0.6
    default:
      return 0.5
  }
}

/**
 * Whether an automatic sweep may overwrite an existing stored resolution with a new
 * signal. Upgrade-only: a higher-tier method wins; an equal/lower one is left alone
 * (idempotent re-runs); a 'manual' user decision is NEVER auto-overwritten.
 */
export function canUpgrade(existingMethod: string | null | undefined, newMethod: string): boolean {
  if (!existingMethod) return true
  if (existingMethod === 'manual') return false
  return methodPriority(newMethod) > methodPriority(existingMethod)
}
