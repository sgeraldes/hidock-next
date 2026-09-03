import { createHash, randomUUID } from 'crypto'
import { isAbsolute } from 'path'
import { readFile, stat } from 'fs/promises'
import { activateCalendarSyncToken, upsertMeetingsBatch, type Meeting } from './database'
import { updateConfig } from './config'
import { whenBootTasksSettled, areBootTasksSettled } from './boot-scheduler'
import { emitActivityLog } from './activity-log'
import { getEventBus } from './event-bus'
import type { CalendarSyncResult } from './calendar-sync'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_EVENTS = 5000
const MAX_EVENT_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const BOOT_WAIT_MS = 45000
const DB_CHUNK_SIZE = 200

const HEADER = ['title', 'start', 'end', 'location', 'url'] as const

/**
 * Parse the deliberately small file format produced by the iPhone Shortcut.
 *
 * The import is fail-closed: one malformed row rejects the complete snapshot,
 * so a partially synced iCloud file can never replace the active calendar used
 * for automatic recording attribution.
 */
export function parseShortcutCalendarFile(
  text: string
): Omit<Meeting, 'created_at' | 'updated_at'>[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    throw new Error('Calendar file is larger than 5 MB')
  }

  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []

  const delimiter = lines[0].includes('\t') ? '\t' : '|||'
  // The official Shortcut format ends with END|||<event count>. iCloud may make
  // a file visible while it is still being replaced; requiring this trailer
  // prevents a valid-looking prefix from becoming the active snapshot.
  let expectedCount: number | null = null
  if (delimiter === '|||') {
    // Shortcuts may preserve spaces placed around magic variables and text
    // separators (for example, `END ||| 500`). Treat that formatting as
    // equivalent while keeping the required complete-snapshot marker strict.
    const trailer = lines.at(-1)?.match(/^END\s*\|\|\|\s*(\d+)\s*$/)
    if (!trailer) throw new Error('Calendar file is incomplete (missing END count)')
    expectedCount = Number(trailer[1])
    lines.pop()
  }

  if (lines.length === 0) throw new Error('Calendar file has no header')
  const first = lines[0].split(delimiter).map((value) => value.trim().toLowerCase())
  const hasHeader = HEADER.every((value, index) => first[index] === value)
  const dataLines = hasHeader ? lines.slice(1) : lines

  if (expectedCount !== null && dataLines.length !== expectedCount) {
    throw new Error(
      `Calendar file is incomplete (expected ${expectedCount} events, found ${dataLines.length})`
    )
  }

  if (dataLines.length > MAX_EVENTS) {
    throw new Error(`Calendar file contains more than ${MAX_EVENTS} events`)
  }

  return dataLines.map((line, index) => {
    const lineNumber = index + (hasHeader ? 2 : 1)
    const fields = line.split(delimiter)
    if (fields.length !== HEADER.length) {
      throw new Error(
        `Calendar file line ${lineNumber} must contain title, start, end, location and URL`
      )
    }

    const [rawTitle, rawStart, rawEnd, rawLocation, rawUrl] = fields
    const title = cleanField(rawTitle, 500)
    const location = cleanField(rawLocation, 1000)
    const rawMeetingUrl = cleanField(rawUrl, 4000)
    if (!title) throw new Error(`Calendar file line ${lineNumber} has no meeting title`)

    const start = parseDate(rawStart, lineNumber, 'start')
    const end = parseDate(rawEnd, lineNumber, 'end')
    const duration = end.getTime() - start.getTime()
    if (duration <= 0 || duration > MAX_EVENT_DURATION_MS) {
      throw new Error(`Calendar file line ${lineNumber} has an invalid meeting duration`)
    }

    const meetingUrl = validateMeetingUrl(rawMeetingUrl, lineNumber)
    const stableKey = [title, start.toISOString(), end.toISOString()].join('\u001f')
    const id = `iphone-calendar:${createHash('sha256').update(stableKey).digest('hex').slice(0, 32)}`

    return {
      id,
      subject: title,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      location: location || undefined,
      meeting_url: meetingUrl,
      is_recurring: 0,
      is_all_day: 0
    }
  })
}

function cleanField(value: string, maxLength: number): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .trim()
    .slice(0, maxLength)
}

function parseDate(value: string, lineNumber: number, field: 'start' | 'end'): Date {
  const clean = value.trim()
  const parsed = new Date(clean)
  if (!clean || !Number.isFinite(parsed.getTime())) {
    throw new Error(`Calendar file line ${lineNumber} has an invalid ${field} date`)
  }
  return parsed
}

function validateMeetingUrl(value: string, lineNumber: number): string | undefined {
  if (!value) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    console.warn(`[calendar-file-sync] Ignoring invalid URL on line ${lineNumber}`)
    return undefined
  }
  if (parsed.protocol !== 'https:') {
    return undefined
  }

  const hostname = parsed.hostname.toLowerCase()
  const allowed =
    hostname === 'teams.microsoft.com' ||
    hostname.endsWith('.teams.microsoft.com') ||
    hostname === 'teams.live.com'
  if (!allowed) {
    return undefined
  }
  return parsed.toString()
}

let currentFileSync: Promise<CalendarSyncResult> | null = null

export function isCalendarFileSyncActive(): boolean {
  return currentFileSync !== null
}

export async function syncCalendarFile(
  filePath: string,
  options: { waitForBootMs?: number; fresh?: boolean; isStillWanted?: () => boolean } = {}
): Promise<CalendarSyncResult> {
  if (currentFileSync && !options.fresh) return currentFileSync

  const previous = currentFileSync
  const pass = (async (): Promise<CalendarSyncResult> => {
    if (previous) await previous.catch(() => undefined)

    const waitForBootMs = options.waitForBootMs ?? BOOT_WAIT_MS
    if (waitForBootMs > 0 && !areBootTasksSettled()) {
      emitActivityLog('info', 'Calendar file sync queued', 'Waiting for startup tasks to finish')
      await whenBootTasksSettled(waitForBootMs)
    }
    if (options.isStillWanted && !options.isStillWanted()) return cancelledResult()

    emitActivityLog('info', 'Syncing iPhone calendar...', 'Reading the local calendar file')
    try {
      if (!filePath.trim() || !isAbsolute(filePath)) {
        throw new Error('Choose an absolute calendar file path')
      }

      const info = await stat(filePath)
      if (!info.isFile()) throw new Error('The selected calendar path is not a file')
      if (info.size > MAX_FILE_BYTES) throw new Error('Calendar file is larger than 5 MB')

      const text = await readFile(filePath, 'utf8')
      const meetings = parseShortcutCalendarFile(text)
      if (meetings.length === 0) {
        throw new Error('Calendar file contains no events; the previous calendar was kept')
      }
      if (options.isStillWanted && !options.isStillWanted()) return cancelledResult()

      const token = randomUUID()
      for (let i = 0; i < meetings.length; i += DB_CHUNK_SIZE) {
        upsertMeetingsBatch(meetings.slice(i, i + DB_CHUNK_SIZE), token)
        if (i + DB_CHUNK_SIZE < meetings.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      }
      activateCalendarSyncToken(token)

      try {
        const { reconcileOrganization } = await import('./org-reconciler')
        reconcileOrganization()
      } catch (error) {
        console.error('Post-import calendar reconciliation failed:', error)
      }

      const now = new Date().toISOString()
      await updateConfig('calendar', { lastSyncAt: now })
      emitActivityLog('success', 'iPhone calendar synced', `Loaded ${meetings.length} meetings`)
      getEventBus().emitDomainEvent({
        type: 'calendar:synced',
        timestamp: now,
        payload: { meetingsCount: meetings.length }
      })
      return { success: true, meetingsCount: meetings.length, lastSync: now }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown calendar file error'
      console.error('Calendar file sync failed:', error)
      emitActivityLog('error', 'iPhone calendar sync failed', message)
      return { success: false, meetingsCount: 0, error: message, errorCategory: 'validation' }
    }
  })()

  currentFileSync = pass
  try {
    return await pass
  } finally {
    if (currentFileSync === pass) currentFileSync = null
  }
}

function cancelledResult(): CalendarSyncResult {
  return {
    success: false,
    meetingsCount: 0,
    error: 'Calendar sync cancelled before it made any changes',
    errorCategory: 'cancelled'
  }
}
