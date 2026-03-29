import type {
  CalendarEvent,
  CorrelationOptions,
  CorrelationRecommendation,
  CorrelationResult,
  MeetingMatch
} from './types.js'

const DEFAULT_AUTO_LINK_MINUTES = 5
const DEFAULT_SUGGEST_LINK_MINUTES = 120

/**
 * Pure function: given a recording start time and a list of calendar events,
 * returns a CorrelationResult with the best recommendation.
 *
 * Decision rules (evaluated in order):
 *  - 2+ candidates within suggestLinkMinutes  → {type:'select'}
 *  - 1 candidate within autoLinkMinutes       → {type:'auto-link'}
 *  - 1 candidate within suggestLinkMinutes    → {type:'suggest'} (unless suggestEnabled=false)
 *  - otherwise                                → {type:'none'}
 */
export function correlate(
  recordingStart: Date,
  events: CalendarEvent[],
  options: CorrelationOptions = {}
): CorrelationResult {
  const autoLinkMinutes = options.autoLinkMinutes ?? DEFAULT_AUTO_LINK_MINUTES
  const suggestLinkMinutes =
    options.suggestLinkMinutes ?? DEFAULT_SUGGEST_LINK_MINUTES
  const suggestEnabled = options.suggestEnabled ?? true

  const recordingMs = recordingStart.getTime()

  const candidates: MeetingMatch[] = events
    .map((event): MeetingMatch => ({
      event,
      offsetMinutes: Math.abs(event.startTime.getTime() - recordingMs) / 60_000
    }))
    .filter((m) => m.offsetMinutes <= suggestLinkMinutes)

  let recommendation: CorrelationRecommendation

  if (candidates.length === 0) {
    recommendation = { type: 'none' }
  } else if (candidates.length >= 2) {
    recommendation = { type: 'select', matches: candidates }
  } else {
    // Exactly one candidate
    const match = candidates[0]
    if (match.offsetMinutes <= autoLinkMinutes) {
      recommendation = { type: 'auto-link', match }
    } else if (suggestEnabled) {
      recommendation = { type: 'suggest', match }
    } else {
      recommendation = { type: 'none' }
    }
  }

  return { recommendation }
}
