// @vitest-environment node

/**
 * Unlink recording from meeting (2026-07-24).
 *
 * The old unlink wrote meeting_id = '' via linkRecordingToMeeting — an empty
 * string is neither a valid meetings.id (the recordings.meeting_id FK can
 * reject the UPDATE, surfacing as "Failed to unlink recording") nor NULL (so
 * `meeting_id IS NULL` checks kept treating the row as linked, and the
 * auto-linker could re-link what the user deliberately disconnected).
 *
 * Covers:
 *  - unlinkRecordingFromMeeting NULLs the link on BOTH recordings and
 *    knowledge_captures and stamps the standalone marker;
 *  - the standalone marker keeps the batch auto-linker from re-linking;
 *  - recordings:selectMeeting(null) routes to the NULL-based unlink;
 *  - repairEmptyMeetingLinks normalizes legacy '' rows to the same shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-unlink-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  app: { getPath: () => 'test-path' },
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  unlinkRecordingFromMeeting,
  getRecordingById
} from '../../services/database'
import { registerRecordingHandlers } from '../recording-handlers'
import { getIntegrityService } from '../../services/integrity-service'
import { autoLinkRecordingsToMeetings } from '../../services/org-reconciler'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

const MEETING_ID = 'm-1'

function seed(): void {
  run(
    `INSERT INTO meetings (id, subject, start_time, end_time, is_recurring, created_at, updated_at)
     VALUES (?, 'Sync interna TSC', '2026-07-23T22:00:00.000Z', '2026-07-23T22:30:00.000Z', 0, '2026-01-01', '2026-01-01')`,
    [MEETING_ID]
  )
  run(
    `INSERT INTO recordings (id, filename, date_recorded, meeting_id, correlation_confidence, correlation_method, duration_seconds)
     VALUES ('rec-1', 'a.mp3', '2026-07-23T22:08:39.000Z', ?, 0.9, 'time_overlap', 3600)`,
    [MEETING_ID]
  )
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, meeting_id)
     VALUES ('cap-1', 'Cap', '2026-07-23', 'rec-1', ?)`,
    [MEETING_ID]
  )
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerRecordingHandlers()
  seed()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('unlinkRecordingFromMeeting', () => {
  it('NULLs the link on both tables and stamps the standalone marker', () => {
    unlinkRecordingFromMeeting('rec-1')
    const rec = getRecordingById('rec-1')!
    expect(rec.meeting_id).toBeNull()
    expect(rec.correlation_confidence).toBeNull()
    expect(rec.correlation_method).toBe('user_preassign_standalone')
    const cap = queryOne<{ meeting_id: string | null }>(
      'SELECT meeting_id FROM knowledge_captures WHERE id = ?',
      ['cap-1']
    )
    expect(cap!.meeting_id).toBeNull()
  })

  it('the batch auto-linker does NOT re-link an explicitly unlinked recording', () => {
    unlinkRecordingFromMeeting('rec-1')
    const linked = autoLinkRecordingsToMeetings()
    expect(linked).toBe(0)
    expect(getRecordingById('rec-1')!.meeting_id).toBeNull()
  })
})

describe('recordings:selectMeeting with null meetingId', () => {
  it('unlinks via NULL (never an empty-string id)', async () => {
    const res = await invoke('recordings:selectMeeting', 'rec-1', null)
    expect(res.success).toBe(true)
    const rec = getRecordingById('rec-1')!
    expect(rec.meeting_id).toBeNull()
    expect(rec.correlation_method).toBe('user_preassign_standalone')
  })

  it('still links when a meetingId is given', async () => {
    await invoke('recordings:selectMeeting', 'rec-1', null)
    const res = await invoke('recordings:selectMeeting', 'rec-1', MEETING_ID)
    expect(res.success).toBe(true)
    const rec = getRecordingById('rec-1')!
    expect(rec.meeting_id).toBe(MEETING_ID)
    // selectMeetingForRecordingByUser records the more specific 'user_override'
    // rather than the older generic 'manual'.
    expect(rec.correlation_method).toBe('user_override')
  })
})

describe("repairEmptyMeetingLinks (legacy '' rows)", () => {
  it('normalizes an empty-string link to NULL + standalone marker', async () => {
    // FK is enforced, so the legacy '' value can only be seeded with checks off
    // (which is exactly why the OLD unlink path threw at runtime).
    run('PRAGMA foreign_keys = OFF')
    run(`UPDATE recordings SET meeting_id = '', correlation_confidence = 0, correlation_method = '' WHERE id = 'rec-1'`)
    run(`UPDATE knowledge_captures SET meeting_id = '' WHERE id = 'cap-1'`)
    run('PRAGMA foreign_keys = ON')

    const result = getIntegrityService().repairEmptyMeetingLinks()
    expect(result).toEqual({ found: 1, fixed: 1 })

    const rec = getRecordingById('rec-1')!
    expect(rec.meeting_id).toBeNull()
    expect(rec.correlation_method).toBe('user_preassign_standalone')
    const cap = queryOne<{ meeting_id: string | null }>(
      'SELECT meeting_id FROM knowledge_captures WHERE id = ?',
      ['cap-1']
    )
    expect(cap!.meeting_id).toBeNull()
  })
})
