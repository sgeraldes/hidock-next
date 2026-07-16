// @vitest-environment node

/**
 * ADV37-1 / ADV37-2 (round-39) — entity-reference WRITES must not REANIMATE a
 * SUPPRESSED entity. Root cause: a source='calendar' membership row is treated
 * ALWAYS-ELIGIBLE by the visible-identity boundary, so ANY write that (a) resolves an
 * existing entity by raw name/email/id and reuses it, or (b) inserts a calendar
 * membership/reference to an existing entity, could re-expose a transcript-derived
 * entity whose sole source recording is excluded/deleted/personal/hard-purged.
 *
 * Covered writes (each gated through filterVisibleEntityIds):
 *   • addMeetingAttendee (meetings:addAttendee) — resolve by email/name, reuse-only-
 *     visible / create-new-if-suppressed; return never a suppressed entity.
 *   • assignSpeaker (transcripts:assignSpeaker) — newName reuse-only-visible /
 *     create-new; explicit contactId must be visible.
 *   • setTurnOverride (turn-speakers) — resolveContactForBinding, same rule.
 *   • projects:tagMeeting — refuse a suppressed/hard-purged project (no membership).
 *   • identity:resolveMention — refuse a suppressed chosen contact.
 *   • knowledge:setProjects — refuse a suppressed project reference.
 *
 * REAL temp DB, real database.ts (better-sqlite3), real handlers end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const dbPath = join(tmpdir(), `hidock-r39-entity-ref-write-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } },
  shell: { openPath: vi.fn(async () => '') }
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  addMeetingAttendee,
  assignSpeaker,
  setTurnOverride,
  EntityVisibilityUnavailableError
} from '../../services/database'
import { registerMeetingsHandlers } from '../meetings-handlers'
import { registerProjectsHandlers } from '../projects-handlers'
import { registerIdentityHandlers } from '../identity-handlers'
import { registerKnowledgeHandlers } from '../knowledge-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

// --- seed helpers -----------------------------------------------------------

function seedContact(id: string, name: string, source: string | null, recId: string | null = null, email: string | null = null): void {
  run(
    `INSERT INTO contacts (id, name, email, type, first_seen_at, last_seen_at, meeting_count, source, source_recording_id, created_at)
     VALUES (?, ?, ?, 'unknown', '2026-01-01', '2026-01-01', 0, ?, ?, '2026-01-01T00:00:00Z')`,
    [id, name, email, source, recId]
  )
}
function seedProject(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO projects (id, name, status, source, source_recording_id) VALUES (?, ?, 'active', ?, ?)`, [id, name, source, recId])
}
function seedMeeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean; meetingId?: string } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null, opts.meetingId ?? null]
  )
}
function seedCapture(id: string): void {
  run(`INSERT INTO knowledge_captures (id, title, captured_at) VALUES (?, 'Cap', '2026-06-01')`, [id])
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerMeetingsHandlers()
  registerProjectsHandlers()
  registerIdentityHandlers()
  registerKnowledgeHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------
// addMeetingAttendee — reuse-only-visible / create-new-if-suppressed (ADV37-1)
// ---------------------------------------------------------------------------

describe('addMeetingAttendee — reanimation-safe contact resolution', () => {
  it('SUPPRESSED name-match ⇒ NOT reused; a NEW distinct contact created, no raw suppressed fields returned', () => {
    seedMeeting('m1')
    seedRecording('r-del', { deleted: true })
    seedContact('c-hidden', 'Sam', 'transcript', 'r-del') // suppressed
    const contact = addMeetingAttendee('m1', { name: 'sam' })
    expect(contact.id).not.toBe('c-hidden')
    // The hidden contact keeps NO calendar membership (not reanimated).
    const hiddenLinks = queryAll('SELECT 1 FROM meeting_contacts WHERE contact_id = ?', ['c-hidden'])
    expect(hiddenLinks.length).toBe(0)
    // The NEW contact is a structural (user) entity, linked to the meeting.
    const newRow = queryOne<{ source: string }>('SELECT source FROM contacts WHERE id = ?', [contact.id])
    expect(newRow?.source).toBe('user')
    const newLink = queryOne('SELECT 1 FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', ['m1', contact.id])
    expect(newLink).toBeTruthy()
  })

  it('VISIBLE name-match ⇒ reused (no duplicate minted)', () => {
    seedMeeting('m1')
    seedContact('c-user', 'Alice', 'user')
    const contact = addMeetingAttendee('m1', { name: 'alice' })
    expect(contact.id).toBe('c-user')
    expect(queryAll('SELECT id FROM contacts WHERE LOWER(name) = ?', ['alice']).length).toBe(1)
  })

  it('SUPPRESSED email-match ⇒ NOT reused; a NEW contact created', () => {
    seedMeeting('m1')
    seedRecording('r-personal', { personal: true })
    seedContact('c-hidden', 'Bob', 'transcript', 'r-personal', 'bob@x.com') // suppressed w/ email
    const contact = addMeetingAttendee('m1', { name: 'Bob', email: 'bob@x.com' })
    expect(contact.id).not.toBe('c-hidden')
    expect(queryAll('SELECT 1 FROM meeting_contacts WHERE contact_id = ?', ['c-hidden']).length).toBe(0)
  })

  it('genuine NEW calendar attendee (no prior match) ⇒ created (no regression)', () => {
    seedMeeting('m1')
    const contact = addMeetingAttendee('m1', { name: 'Fresh Person', email: 'fresh@x.com' })
    expect(contact.name).toBe('Fresh Person')
    expect(contact.email).toBe('fresh@x.com')
    const link = queryOne('SELECT 1 FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', ['m1', contact.id])
    expect(link).toBeTruthy()
  })

  it('visibility lookup FAILURE ⇒ throws (retryable abort), no write', () => {
    seedMeeting('m1')
    seedContact('c-x', 'Zed', 'transcript', 'r-any')
    run('DROP TABLE meeting_contacts') // filterVisibleEntityIds throws ⇒ failClosed
    expect(() => addMeetingAttendee('m1', { name: 'zed' })).toThrow(EntityVisibilityUnavailableError)
    // No new contact minted.
    expect(queryAll('SELECT id FROM contacts', []).length).toBe(1)
  })

  it('meetings:addAttendee handler maps a fail-closed abort to RETRYABLE_ERROR', async () => {
    const mid = randomUUID()
    seedMeeting(mid)
    seedContact('c-x', 'Zed', 'transcript', 'r-any')
    run('DROP TABLE meeting_contacts')
    const res = await invoke('meetings:addAttendee', { meetingId: mid, name: 'zed' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('RETRYABLE_ERROR')
  })

  it('meetings:addAttendee handler reuses a VISIBLE match (end to end)', async () => {
    const mid = randomUUID()
    const cid = randomUUID()
    seedMeeting(mid)
    seedContact(cid, 'Alice', 'user')
    const res = await invoke('meetings:addAttendee', { meetingId: mid, name: 'alice' })
    expect(res.success).toBe(true)
    expect(res.data.id).toBe(cid)
  })
})

// ---------------------------------------------------------------------------
// assignSpeaker — newName reuse-only-visible; contactId must be visible (ADV37)
// ---------------------------------------------------------------------------

describe('assignSpeaker — reanimation-safe speaker binding', () => {
  it('newName matching a SUPPRESSED contact ⇒ NEW contact (suppressed not reanimated)', () => {
    seedMeeting('m1')
    seedRecording('rec1', { meetingId: 'm1' })
    seedRecording('r-del', { deleted: true })
    seedContact('c-hidden', 'Nora', 'transcript', 'r-del') // suppressed
    const contact = assignSpeaker('rec1', 'Speaker 1', { newName: 'nora' })
    expect(contact.id).not.toBe('c-hidden')
    expect(queryAll('SELECT 1 FROM meeting_contacts WHERE contact_id = ?', ['c-hidden']).length).toBe(0)
  })

  it('newName matching a VISIBLE contact ⇒ reused', () => {
    seedMeeting('m1')
    seedRecording('rec1', { meetingId: 'm1' })
    seedContact('c-user', 'Vic', 'user')
    const contact = assignSpeaker('rec1', 'Speaker 1', { newName: 'vic' })
    expect(contact.id).toBe('c-user')
  })

  it('explicit SUPPRESSED contactId ⇒ refused (treated as not-found)', () => {
    seedMeeting('m1')
    seedRecording('rec1', { meetingId: 'm1' })
    seedRecording('r-del', { deleted: true })
    seedContact('c-hidden', 'Ghost', 'transcript', 'r-del')
    expect(() => assignSpeaker('rec1', 'Speaker 1', { contactId: 'c-hidden' })).toThrow(/not found/)
    expect(queryAll('SELECT 1 FROM transcript_speakers WHERE recording_id = ?', ['rec1']).length).toBe(0)
  })

  it('explicit VISIBLE contactId ⇒ bound', () => {
    seedMeeting('m1')
    seedRecording('rec1', { meetingId: 'm1' })
    seedContact('c-user', 'RealPerson', 'user')
    const contact = assignSpeaker('rec1', 'Speaker 1', { contactId: 'c-user' })
    expect(contact.id).toBe('c-user')
    expect(queryOne('SELECT 1 FROM transcript_speakers WHERE recording_id = ? AND contact_id = ?', ['rec1', 'c-user'])).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// setTurnOverride — resolveContactForBinding, same rule
// ---------------------------------------------------------------------------

describe('setTurnOverride — reanimation-safe per-turn binding', () => {
  it('newName matching a SUPPRESSED contact ⇒ NEW contact', () => {
    seedMeeting('m1')
    seedRecording('rec1', { meetingId: 'm1' })
    seedRecording('r-personal', { personal: true })
    seedContact('c-hidden', 'Pat', 'transcript', 'r-personal')
    const contact = setTurnOverride('rec1', 3, { newName: 'pat' })
    expect(contact.id).not.toBe('c-hidden')
  })

  it('explicit SUPPRESSED contactId ⇒ refused', () => {
    seedMeeting('m1')
    seedRecording('rec1', { meetingId: 'm1' })
    seedRecording('r-del', { deleted: true })
    seedContact('c-hidden', 'Ghost', 'transcript', 'r-del')
    expect(() => setTurnOverride('rec1', 3, { contactId: 'c-hidden' })).toThrow(/not found/)
  })
})

// ---------------------------------------------------------------------------
// projects:tagMeeting — refuse a suppressed project (ADV37-2)
// ---------------------------------------------------------------------------

describe('projects:tagMeeting — gates the project through the visible-identity boundary', () => {
  async function expectRefused(recOpts: { personal?: boolean; deleted?: boolean } | 'purged' | 'value'): Promise<void> {
    const mid = randomUUID()
    const pid = randomUUID()
    seedMeeting(mid)
    if (recOpts === 'purged') {
      seedProject(pid, 'Ghost', 'transcript', 'r-gone') // no recordings row ⇒ suppressed
    } else if (recOpts === 'value') {
      seedRecording('r-val')
      run(`INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES ('cap-val', 'C', '2026-06-01', 'r-val', 'garbage')`)
      seedProject(pid, 'Ghost', 'transcript', 'r-val')
    } else {
      seedRecording('r-x', recOpts)
      seedProject(pid, 'Ghost', 'transcript', 'r-x')
    }
    const res = await invoke('projects:tagMeeting', { meetingId: mid, projectId: pid })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
    expect(queryAll('SELECT 1 FROM meeting_projects WHERE project_id = ?', [pid]).length).toBe(0)
  }

  it('soft-deleted-backed project ⇒ refused, no membership', () => expectRefused({ deleted: true }))
  it('personal-backed project ⇒ refused', () => expectRefused({ personal: true }))
  it('value-excluded-backed project ⇒ refused', () => expectRefused('value'))
  it('hard-purged (recording row gone) project ⇒ refused', () => expectRefused('purged'))

  it('visibility lookup FAILURE ⇒ refused (fail-closed)', async () => {
    const mid = randomUUID()
    const pid = randomUUID()
    seedMeeting(mid)
    seedProject(pid, 'Real', 'user')
    run('DROP TABLE meeting_projects') // filterVisibleEntityIds throws ⇒ failClosed
    const res = await invoke('projects:tagMeeting', { meetingId: mid, projectId: pid })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })

  it('VISIBLE project ⇒ tagged', async () => {
    const mid = randomUUID()
    const pid = randomUUID()
    seedMeeting(mid)
    seedProject(pid, 'Real', 'user')
    const res = await invoke('projects:tagMeeting', { meetingId: mid, projectId: pid })
    expect(res.success).toBe(true)
    expect(queryOne('SELECT 1 FROM meeting_projects WHERE meeting_id = ? AND project_id = ?', [mid, pid])).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// identity:resolveMention — refuse a suppressed chosen contact (ADV37)
// ---------------------------------------------------------------------------

describe('identity:resolveMention — gates the chosen contact', () => {
  it('SUPPRESSED contactId ⇒ CONTACT_INELIGIBLE, no membership written', async () => {
    seedMeeting('m1')
    seedRecording('rec1', { meetingId: 'm1' })
    seedRecording('r-del', { deleted: true })
    seedContact('c-hidden', 'Ghost', 'transcript', 'r-del')
    const res = await invoke('identity:resolveMention', {
      recordingId: 'rec1',
      sourceName: 'Ghost',
      contactId: 'c-hidden',
      method: 'manual'
    })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('CONTACT_INELIGIBLE')
    expect(queryAll('SELECT 1 FROM meeting_contacts WHERE contact_id = ?', ['c-hidden']).length).toBe(0)
  })

  it('VISIBLE contactId ⇒ resolved + membership written', async () => {
    seedMeeting('m1')
    seedRecording('rec1', { meetingId: 'm1' })
    seedContact('c-user', 'RealPerson', 'user')
    const res = await invoke('identity:resolveMention', {
      recordingId: 'rec1',
      sourceName: 'RealPerson',
      contactId: 'c-user',
      method: 'manual'
    })
    expect(res.success).toBe(true)
    expect(queryOne('SELECT 1 FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', ['m1', 'c-user'])).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// knowledge:setProjects — refuse a suppressed project reference (ADV37 sweep)
// ---------------------------------------------------------------------------

describe('knowledge:setProjects — gates referenced projects', () => {
  it('SUPPRESSED project ⇒ NOT_FOUND, no knowledge_projects link', async () => {
    const cap = randomUUID()
    const pid = randomUUID()
    seedCapture(cap)
    seedRecording('r-del', { deleted: true })
    seedProject(pid, 'Ghost', 'transcript', 'r-del')
    const res = await invoke('knowledge:setProjects', { knowledgeCaptureId: cap, projectIds: [pid] })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
    expect(queryAll('SELECT 1 FROM knowledge_projects WHERE project_id = ?', [pid]).length).toBe(0)
  })

  it('VISIBLE project ⇒ linked', async () => {
    const cap = randomUUID()
    const pid = randomUUID()
    seedCapture(cap)
    seedProject(pid, 'Real', 'user')
    const res = await invoke('knowledge:setProjects', { knowledgeCaptureId: cap, projectIds: [pid] })
    expect(res.success).toBe(true)
    expect(queryOne('SELECT 1 FROM knowledge_projects WHERE knowledge_capture_id = ? AND project_id = ?', [cap, pid])).toBeTruthy()
  })

  it('empty projectIds ⇒ clears assignments (no gate needed)', async () => {
    const cap = randomUUID()
    const pid = randomUUID()
    seedCapture(cap)
    seedProject(pid, 'Real', 'user')
    await invoke('knowledge:setProjects', { knowledgeCaptureId: cap, projectIds: [pid] })
    const res = await invoke('knowledge:setProjects', { knowledgeCaptureId: cap, projectIds: [] })
    expect(res.success).toBe(true)
    expect(queryAll('SELECT 1 FROM knowledge_projects WHERE knowledge_capture_id = ?', [cap]).length).toBe(0)
  })
})
