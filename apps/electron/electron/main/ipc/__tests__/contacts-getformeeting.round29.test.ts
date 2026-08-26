// @vitest-environment node

/**
 * Round-29 FINAL identity sub-sweep — meeting-scoped participant reads.
 *
 * R28-RES-1 — contacts:getForMeeting is a two-tier meeting-scoped membership read:
 *   • the GATED default (contacts:getForMeeting) routes each meeting_contacts ROW
 *     through filterEligibleMembershipRows: a transcript-extracted attendee whose
 *     source recording is personal / soft-deleted / value-excluded / hard-purged is
 *     ABSENT (assistant / hover / Today tier); a calendar/manual attendee is present;
 *     a hard lookup failure fails closed (empty).
 *   • the OWNER accessor (contacts:getForMeetingOwner) is existence-scoped: the owner
 *     sees every participant of their own meeting, including excluded-recording-
 *     derived ones (MeetingDetail + SourceReader/useReaderPeople repoint here).
 *
 * R28-RES-1 sub-sweep — projects:getForMeeting (the projects twin) is gated the same
 * fail-closed way.
 *
 * REAL temp DB, real database.ts (better-sqlite3), real handlers end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-r29-getformeeting-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } },
  shell: { openPath: vi.fn(async () => '') }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerContactsHandlers } from '../contacts-handlers'
import { registerProjectsHandlers } from '../projects-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

// --- seed helpers -----------------------------------------------------------

function contact(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, source, source_recording_id)
     VALUES (?, ?, 'unknown', '2026-01-01', '2026-01-01', 0, ?, ?)`,
    [id, name, source, recId]
  )
}
function project(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO projects (id, name, status, source, source_recording_id) VALUES (?, ?, 'active', ?, ?)`, [id, name, source, recId])
}
function meeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
function recording(id: string, meetingId: string | null, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null, meetingId]
  )
}
function valueExclude(recordingId: string): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, 'Cap', '2026-06-01', ?, 'garbage')`,
    [`cap-${recordingId}`, recordingId]
  )
}
function mc(meetingId: string, contactId: string, source: string | null, recId: string | null = null): void {
  run(
    `INSERT INTO meeting_contacts (meeting_id, contact_id, role, source, source_recording_id) VALUES (?, ?, 'attendee', ?, ?)`,
    [meetingId, contactId, source, recId]
  )
}
function mp(meetingId: string, projectId: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO meeting_projects (meeting_id, project_id, source, source_recording_id) VALUES (?, ?, ?, ?)`, [meetingId, projectId, source, recId])
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerContactsHandlers()
  registerProjectsHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------
// R28-RES-1 — contacts:getForMeeting GATED default (assistant / hover / Today)
// ---------------------------------------------------------------------------

describe('R28-RES-1 — contacts:getForMeeting (gated default)', () => {
  it('drops a transcript attendee from a PERSONAL recording, keeps a calendar attendee', async () => {
    meeting('m1')
    recording('r-bad', 'm1', { personal: true })
    contact('c-ghost', 'Ghost', 'transcript', 'r-bad')
    mc('m1', 'c-ghost', 'transcript', 'r-bad')
    contact('c-cal', 'Calendar Carol', 'calendar')
    mc('m1', 'c-cal', 'calendar')

    const res = await invoke('contacts:getForMeeting', 'm1')
    expect(res.success).toBe(true)
    const ids = res.data.map((p: any) => p.id)
    expect(ids).toContain('c-cal')
    expect(ids).not.toContain('c-ghost')
  })

  it('drops a transcript attendee from a SOFT-DELETED recording', async () => {
    meeting('m1')
    recording('r-del', 'm1', { deleted: true })
    contact('c-ghost', 'Ghost', 'transcript', 'r-del')
    mc('m1', 'c-ghost', 'transcript', 'r-del')

    const res = await invoke('contacts:getForMeeting', 'm1')
    expect(res.data.map((p: any) => p.id)).not.toContain('c-ghost')
  })

  it('drops a transcript attendee from a VALUE-EXCLUDED recording', async () => {
    meeting('m1')
    recording('r-val', 'm1'); valueExclude('r-val')
    contact('c-ghost', 'Ghost', 'transcript', 'r-val')
    mc('m1', 'c-ghost', 'transcript', 'r-val')

    const res = await invoke('contacts:getForMeeting', 'm1')
    expect(res.data.map((p: any) => p.id)).not.toContain('c-ghost')
  })

  it('drops a transcript attendee from a HARD-PURGED recording (no recording row)', async () => {
    meeting('m1')
    contact('c-ghost', 'Ghost', 'transcript', 'r-gone') // r-gone never inserted
    mc('m1', 'c-ghost', 'transcript', 'r-gone')

    const res = await invoke('contacts:getForMeeting', 'm1')
    expect(res.data.map((p: any) => p.id)).not.toContain('c-ghost')
  })

  it('drops a legacy NULL-provenance membership row (fail-closed)', async () => {
    meeting('m1')
    contact('c-legacy', 'Legacy Larry', null)
    mc('m1', 'c-legacy', null)

    const res = await invoke('contacts:getForMeeting', 'm1')
    expect(res.data.map((p: any) => p.id)).not.toContain('c-legacy')
  })

  it('keeps a transcript attendee whose source recording is ELIGIBLE', async () => {
    meeting('m1')
    recording('r-ok', 'm1')
    contact('c-real', 'Real Rita', 'transcript', 'r-ok')
    mc('m1', 'c-real', 'transcript', 'r-ok')

    const res = await invoke('contacts:getForMeeting', 'm1')
    expect(res.data.map((p: any) => p.id)).toContain('c-real')
  })

  it('fails closed (empty) when the eligibility lookup throws', async () => {
    meeting('m1')
    recording('r-ok', 'm1')
    contact('c-real', 'Real Rita', 'transcript', 'r-ok')
    mc('m1', 'c-real', 'transcript', 'r-ok')
    // Break the value-exclusion sub-lookup (knowledge_captures NOT-EXISTS) → fail-closed.
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')

    const res = await invoke('contacts:getForMeeting', 'm1')
    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// R28-RES-1 — contacts:getForMeetingOwner (existence-scoped owner accessor)
// ---------------------------------------------------------------------------

describe('R28-RES-1 — contacts:getForMeetingOwner (owner accessor)', () => {
  it('returns the excluded-recording-derived attendee for the owner', async () => {
    meeting('m1')
    recording('r-bad', 'm1', { personal: true })
    contact('c-ghost', 'Ghost', 'transcript', 'r-bad')
    mc('m1', 'c-ghost', 'transcript', 'r-bad')
    contact('c-cal', 'Calendar Carol', 'calendar')
    mc('m1', 'c-cal', 'calendar')

    const res = await invoke('contacts:getForMeetingOwner', 'm1')
    expect(res.success).toBe(true)
    const ids = res.data.map((p: any) => p.id)
    expect(ids).toContain('c-ghost') // owner sees the excluded-derived attendee
    expect(ids).toContain('c-cal')
  })
})

// ---------------------------------------------------------------------------
// R28-RES-1 sub-sweep — projects:getForMeeting (projects twin) gated
// ---------------------------------------------------------------------------

describe('R28-RES-1 sub-sweep — projects:getForMeeting (gated)', () => {
  it('drops a transcript-derived project tag from an excluded recording, keeps a manual tag', async () => {
    meeting('m1')
    recording('r-bad', 'm1', { personal: true })
    project('p-ghost', 'Ghost Project', 'transcript', 'r-bad')
    mp('m1', 'p-ghost', 'transcript', 'r-bad')
    project('p-manual', 'Manual Project', 'calendar')
    mp('m1', 'p-manual', 'calendar')

    const res = await invoke('projects:getForMeeting', 'm1')
    expect(res.success).toBe(true)
    const ids = res.data.map((p: any) => p.id)
    expect(ids).toContain('p-manual')
    expect(ids).not.toContain('p-ghost')
  })
})
