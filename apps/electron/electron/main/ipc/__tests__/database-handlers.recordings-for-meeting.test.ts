// @vitest-environment node

/**
 * ADV24-3 (round-25) — db:get-recordings-for-meeting is a NON-OWNER accessor
 * (Today, meeting-recording-intelligence hover, RecordingLinkDialog). It GATES
 * linked recordings through the shared FAIL-CLOSED positive allowlist: a personal
 * / soft-deleted / value-excluded / hard-purged recording — and therefore its
 * existence + linked/recorded/transcribed STATE — is omitted from the returned
 * rows. REAL handler, REAL temp DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv24-recs-for-meeting-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))
vi.mock('../../services/org-reconciler', () => ({ autoLinkRecordingsToMeetings: () => {} }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerDatabaseHandlers } from '../database-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function seedMeeting(id: string): void {
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [id, `M ${id}`, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'])
}
function seedRecording(id: string, meetingId: string, opts: { personal?: boolean; deleted?: boolean; status?: string } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, `${id}.hda`, '2026-06-01', opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00.000Z' : null, meetingId, opts.status ?? 'transcribed'
  ])
}
function valueExclude(recordingId: string): void {
  run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)', [
    `cap-${recordingId}`, 'Cap', '2026-06-01', recordingId, 'garbage'
  ])
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerDatabaseHandlers()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('ADV24-3 — db:get-recordings-for-meeting gates non-owner linked recordings', () => {
  it('returns eligible recordings; omits personal/deleted/value-excluded/state', async () => {
    seedMeeting('m-1')
    seedRecording('rec-ok', 'm-1')
    seedRecording('rec-del', 'm-1', { deleted: true })
    seedRecording('rec-personal', 'm-1', { personal: true })
    seedRecording('rec-garbage', 'm-1')
    valueExclude('rec-garbage')

    const rows = await invoke('db:get-recordings-for-meeting', 'm-1')
    expect(rows.map((r: any) => r.id).sort()).toEqual(['rec-ok'])
    // The transcribed STATE of an excluded recording must not leak either.
    expect(rows.every((r: any) => r.id === 'rec-ok')).toBe(true)
  })

  it('returns [] for a meeting whose only linked recording is excluded', async () => {
    seedMeeting('m-2')
    seedRecording('rec-only-personal', 'm-2', { personal: true })
    const rows = await invoke('db:get-recordings-for-meeting', 'm-2')
    expect(rows).toEqual([])
  })

  it('fails closed — no recordings when the eligibility lookup throws', async () => {
    seedMeeting('m-3')
    seedRecording('rec-ok', 'm-3')
    const before = await invoke('db:get-recordings-for-meeting', 'm-3')
    expect(before.map((r: any) => r.id)).toEqual(['rec-ok'])

    // getRecordingsForMeeting returns rows, then the allowlist query fails once
    // knowledge_captures can't be read.
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')
    const res = await invoke('db:get-recordings-for-meeting', 'm-3')
    expect(res).toEqual([])
  })
})
