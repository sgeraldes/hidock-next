import { CalendarWatcher, correlate, type CalendarEvent, type CorrelationResult } from '@hidock/calendar-sync'

export interface MeetingDetectorOptions {
  calendarSource?: string          // ICS file/URL
  calendarPollMinutes?: number     // default 15
  calendarEnabled?: boolean        // default true
  micEnabled?: boolean             // default true
  micDefaultAction?: 'ask' | 'always_record' | 'ignore'  // default 'ask'
  autoRecordWithCalendar?: boolean // default true
  autoRecordOnMeeting?: boolean    // default false
  correlationAutoLinkMinutes?: number   // default 5
  correlationSuggestLinkMinutes?: number // default 120
  correlationSuggestEnabled?: boolean    // default true
  preNotificationSeconds?: number  // default 15
}

type DetectorListener = (event: MeetingDetectorEvent) => void

export type MeetingDetectorEvent =
  | { type: 'meeting-upcoming'; event: CalendarEvent; startsInSeconds: number }
  | { type: 'meeting-started'; event: CalendarEvent }
  | { type: 'mic-detected'; action: 'ask' | 'auto-record' | 'ignore' }
  | { type: 'correlation'; result: CorrelationResult }
  | { type: 'error'; error: Error }

export class MeetingDetector {
  private calendarWatcher: CalendarWatcher | null = null
  private cachedEvents: CalendarEvent[] = []
  private listeners: Set<DetectorListener> = new Set()
  private notificationTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(private options: MeetingDetectorOptions = {}) {}

  start(): void {
    if (this.running) return
    this.running = true

    // Start calendar watcher if enabled and source provided
    if (this.options.calendarEnabled !== false && this.options.calendarSource) {
      this.calendarWatcher = new CalendarWatcher({
        source: this.options.calendarSource,
        pollIntervalMinutes: this.options.calendarPollMinutes ?? 15,
      })
      this.calendarWatcher.on('events', (events) => {
        this.cachedEvents = events
        this.scheduleUpcomingNotifications()
      })
      this.calendarWatcher.on('error', (err) => {
        this.notify({ type: 'error', error: err })
      })
      this.calendarWatcher.start()
    }
  }

  stop(): void {
    this.running = false
    this.calendarWatcher?.stop()
    this.calendarWatcher = null
    if (this.notificationTimer) {
      clearTimeout(this.notificationTimer)
      this.notificationTimer = null
    }
  }

  /** Called when mic activity is detected */
  onMicActivity(): void {
    if (this.options.micEnabled === false) return

    const now = new Date()
    const hasUpcomingMeeting = this.cachedEvents.some(e => {
      const diff = Math.abs(e.startTime.getTime() - now.getTime()) / 60_000
      return diff <= (this.options.correlationAutoLinkMinutes ?? 5)
    })

    if (hasUpcomingMeeting && this.options.autoRecordWithCalendar !== false) {
      this.notify({ type: 'mic-detected', action: 'auto-record' })
    } else {
      const action = this.options.micDefaultAction ?? 'ask'
      this.notify({ type: 'mic-detected', action: action === 'always_record' ? 'auto-record' : action })
    }
  }

  /** Correlate a session start time with calendar events */
  correlateSession(sessionStartTime: Date): CorrelationResult {
    const result = correlate(sessionStartTime, this.cachedEvents, {
      autoLinkMinutes: this.options.correlationAutoLinkMinutes,
      suggestLinkMinutes: this.options.correlationSuggestLinkMinutes,
      suggestEnabled: this.options.correlationSuggestEnabled,
    })
    this.notify({ type: 'correlation', result })
    return result
  }

  /** Get currently cached calendar events */
  getEvents(): CalendarEvent[] {
    return [...this.cachedEvents]
  }

  on(listener: DetectorListener): void {
    this.listeners.add(listener)
  }

  off(listener: DetectorListener): void {
    this.listeners.delete(listener)
  }

  private notify(event: MeetingDetectorEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* don't crash */ }
    }
  }

  private scheduleUpcomingNotifications(): void {
    if (this.notificationTimer) {
      clearTimeout(this.notificationTimer)
    }

    const preNotifyMs = (this.options.preNotificationSeconds ?? 15) * 1000
    const now = Date.now()

    for (const event of this.cachedEvents) {
      const eventStart = event.startTime.getTime()
      const notifyAt = eventStart - preNotifyMs

      if (notifyAt > now) {
        const delay = notifyAt - now
        this.notificationTimer = setTimeout(() => {
          this.notify({
            type: 'meeting-upcoming',
            event,
            startsInSeconds: Math.round((eventStart - Date.now()) / 1000),
          })
        }, delay)
        break  // Only schedule the nearest upcoming meeting
      }
    }
  }
}
