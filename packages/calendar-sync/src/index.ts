export type {
  CalendarAttendee,
  CalendarEvent,
  CalendarOrganizer,
  CalendarWatcherOptions,
  CorrelationOptions,
  CorrelationRecommendation,
  CorrelationResult,
  MeetingMatch
} from './types.js'

export { parseICS, unescapeIcsText } from './ics-parser.js'
export { CalendarWatcher } from './calendar-watcher.js'
export { correlate } from './meeting-correlator.js'
