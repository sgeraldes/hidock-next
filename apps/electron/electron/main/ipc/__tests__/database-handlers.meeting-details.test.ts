// @vitest-environment node

/**
 * ADV15-1 (round-16) — db:get-meeting-details is a meeting-AGGREGATION DISPLAY
 * surface (NOT the single-recording owner reader). It GATES linked recordings
 * through the shared FAIL-CLOSED positive allowlist: a personal / soft-deleted /
 * value-excluded / hard-purged recording — and its transcript — is omitted from
 * the returned linked-recordings entirely. REAL handler, REAL temp DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv15-meetingdetails-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))
// Keep the auto-linker a no-op so the test controls the recording↔meeting links.
vi.mock('../../services/org-reconciler', () => ({ autoLinkRecordingsToMeetings: () => {} }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run, insertTranscript } from '../../services/database'
import { registerDatabaseHandlers } from '../database-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function seedMeeting(id: string): void {
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [id, `M ${id}`, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'])
}
function seedRecording(id: string, meetingId: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id) VALUES (?, ?, ?, ?, ?, ?)', [
    id, `${id}.hda`, '2026-06-01', opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00.000Z' : null, meetingId
  ])
}
function seedTranscript(recordingId: string, text: string): void {
  insertTranscript({ id: `t-${recordingId}`, recording_id: recordingId, full_text: text, language: 'en' })
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

describe('ADV15-1 — db:get-meeting-details gates linked recordings', () => {
  it('returns eligible recordings with transcripts, omits excluded ones', async () => {
    seedMeeting('m-1')
    seedRecording('rec-ok', 'm-1')
    seedTranscript('rec-ok', 'planning notes')
    seedRecording('rec-del', 'm-1', { deleted: true })
    seedTranscript('rec-del', 'deleted secret')
    seedRecording('rec-personal', 'm-1', { personal: true })
    seedTranscript('rec-personal', 'personal secret')
    seedRecording('rec-garbage', 'm-1')
    seedTranscript('rec-garbage', 'garbage secret')
    valueExclude('rec-garbage')

    const res = await invoke('db:get-meeting-details', 'm-1')
    expect(res.meeting.id).toBe('m-1')
    const ids = res.recordings.map((r: any) => r.id).sort()
    expect(ids).toEqual(['rec-ok'])
    expect(res.recordings[0].transcript?.full_text).toBe('planning notes')
  })

  it('fails closed — no linked recordings when the eligibility lookup throws', async () => {
    seedMeeting('m-1')
    seedRecording('rec-ok', 'm-1')
    seedTranscript('rec-ok', 'text')
    const meetingBefore = await invoke('db:get-meeting-details', 'm-1')
    expect(meetingBefore.recordings.map((r: any) => r.id)).toEqual(['rec-ok'])

    // Break the eligibility lookup without removing the meeting linkage read:
    // getRecordingsForMeeting runs first (returns rows), then the allowlist query
    // fails once recordings' eligibility columns can't be read.
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')
    const res = await invoke('db:get-meeting-details', 'm-1')
    expect(res.meeting.id).toBe('m-1')
    expect(res.recordings).toEqual([])
  })
})
