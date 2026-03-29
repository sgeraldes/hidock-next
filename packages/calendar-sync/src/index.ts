export type {
  CalendarAttendee,
  CalendarEvent,
  CalendarWatcherOptions,
  CorrelationOptions,
  CorrelationRecommendation,
  CorrelationResult,
  MeetingMatch
} from './types.js'

export { parseICS } from './ics-parser.js'
export { CalendarWatcher } from './calendar-watcher.js'
export { correlate } from './meeting-correlator.js'
