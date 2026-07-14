/**
 * Type declarations for @hidock/calendar-sync
 * Generated stub — resolves TS2307 when the workspace package is not built.
 */
declare module '@hidock/calendar-sync' {
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
    source: string
    pollIntervalMinutes?: number
  }

  export interface CorrelationOptions {
    autoLinkMinutes?: number
    suggestLinkMinutes?: number
    suggestEnabled?: boolean
  }

  export interface MeetingMatch {
    event: CalendarEvent
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

  export function parseICS(icsContent: string): CalendarEvent[]
  export function correlate(
    recordingStart: Date,
    events: CalendarEvent[],
    options?: CorrelationOptions,
  ): CorrelationResult

  export class CalendarWatcher {
    constructor(options: CalendarWatcherOptions)
    on(event: 'events', listener: (events: CalendarEvent[]) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    off(event: 'events', listener: (events: CalendarEvent[]) => void): this
    off(event: 'error', listener: (error: Error) => void): this
    start(): void
    stop(): void
    get isRunning(): boolean
  }
}
