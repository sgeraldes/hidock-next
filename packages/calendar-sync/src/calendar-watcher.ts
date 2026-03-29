import type { CalendarEvent, CalendarWatcherOptions } from './types.js'
import { parseICS } from './ics-parser.js'

type EventsListener = (events: CalendarEvent[]) => void
type ErrorListener = (error: Error) => void

/**
 * Polls a calendar source (ICS file or URL) at a configurable interval and
 * emits `events` whenever the event list changes, or `error` on failure.
 */
export class CalendarWatcher {
  private readonly source: string
  private readonly pollIntervalMinutes: number
  private timerId: ReturnType<typeof setInterval> | null = null
  private eventsListeners: Set<EventsListener> = new Set()
  private errorListeners: Set<ErrorListener> = new Set()

  constructor(options: CalendarWatcherOptions) {
    this.source = options.source
    this.pollIntervalMinutes = options.pollIntervalMinutes ?? 5
  }

  on(event: 'events', listener: EventsListener): this
  on(event: 'error', listener: ErrorListener): this
  on(event: 'events' | 'error', listener: EventsListener | ErrorListener): this {
    if (event === 'events') {
      this.eventsListeners.add(listener as EventsListener)
    } else {
      this.errorListeners.add(listener as ErrorListener)
    }
    return this
  }

  off(event: 'events', listener: EventsListener): this
  off(event: 'error', listener: ErrorListener): this
  off(event: 'events' | 'error', listener: EventsListener | ErrorListener): this {
    if (event === 'events') {
      this.eventsListeners.delete(listener as EventsListener)
    } else {
      this.errorListeners.delete(listener as ErrorListener)
    }
    return this
  }

  /** Start polling. No-op if already running. */
  start(): void {
    if (this.timerId !== null) return
    const intervalMs = this.pollIntervalMinutes * 60 * 1000
    this.timerId = setInterval(() => void this.poll(), intervalMs)
    // Run an initial poll immediately
    void this.poll()
  }

  /** Stop polling. No-op if not running. */
  stop(): void {
    if (this.timerId === null) return
    clearInterval(this.timerId)
    this.timerId = null
  }

  /** Returns true if the watcher is currently running. */
  get isRunning(): boolean {
    return this.timerId !== null
  }

  private async poll(): Promise<void> {
    try {
      let icsContent: string
      if (this.source.startsWith('http://') || this.source.startsWith('https://')) {
        const response = await fetch(this.source)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        icsContent = await response.text()
      } else {
        const { readFile } = await import('node:fs/promises')
        icsContent = await readFile(this.source, 'utf-8')
      }
      const events = parseICS(icsContent)
      for (const listener of this.eventsListeners) {
        listener(events)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      for (const listener of this.errorListeners) {
        listener(error)
      }
    }
  }
}
