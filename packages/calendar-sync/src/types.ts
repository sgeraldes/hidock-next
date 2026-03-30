export interface CalendarAttendee {
  name?: string
  email: string
}

export interface CalendarEvent {
  uid: string
  title: string
  startTime: Date
  endTime: Date
  attendees: CalendarAttendee[]
  location?: string
  description?: string
}

export interface CalendarWatcherOptions {
  /** Path to ICS file or calendar URL to watch */
  source: string
  /** How often to poll for changes, in minutes. Default: 5 */
  pollIntervalMinutes?: number
}

export interface CorrelationOptions {
  /**
   * Maximum minutes before/after a recording start to auto-link a single event.
   * Default: 5. Comparison is inclusive (<=).
   */
  autoLinkMinutes?: number
  /**
   * Maximum minutes before/after a recording start to suggest a single event.
   * Default: 120. Comparison is inclusive (<=).
   */
  suggestLinkMinutes?: number
  /**
   * Whether to emit 'suggest' recommendations. When false, single matches
   * outside autoLinkMinutes are suppressed (returns 'none').
   * Default: true
   */
  suggestEnabled?: boolean
}

export interface MeetingMatch {
  event: CalendarEvent
  /** Absolute difference in minutes between recording start and event start */
  offsetMinutes: number
}

export type CorrelationRecommendation =
  | { type: 'none' }
  | { type: 'auto-link'; match: MeetingMatch }
  | { type: 'suggest'; match: MeetingMatch }
  | { type: 'select'; matches: MeetingMatch[] }

export interface CorrelationResult {
  recommendation: CorrelationRecommendation
}
