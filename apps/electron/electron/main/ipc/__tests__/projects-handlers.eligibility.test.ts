// @vitest-environment node

/**
 * ADV15 (round-16) — projects read surfaces route through the shared boundaries.
 *
 * ADV15-4: projects:getById topics — every topic row's source recording runs
 * through filterEligibleRecordingIds; topics are derived ONLY from eligible
 * recordings (the recurring-topics trap on Projects).
 * ADV15-5: projects:getActionables — actionables route through the shared
 * CAPTURE-aware boundary (excluded recording / soft-deleted capture / standalone
 * garbage all dropped).
 *
 * REAL handlers against a REAL temp DB (only electron + file-storage mocked).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv15-projects-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } },
  shell: { openPath: vi.fn(async () => '') }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerProjectsHandlers } from '../projects-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'

function seedProject(): void {
  run('INSERT INTO projects (id, name, status) VALUES (?, ?, ?)', [PROJECT_ID, 'Proj', 'active'])
}
function seedMeeting(id: string): void {
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [id, `M ${id}`, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'])
  run('INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', [id, PROJECT_ID])
}
function seedRecording(id: string, meetingId: string | null, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id) VALUES (?, ?, ?, ?, ?, ?)', [
    id, `${id}.hda`, '2026-06-01', opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00.000Z' : null, meetingId
  ])
}
function seedTranscript(recordingId: string, topics: string[]): void {
  run('INSERT INTO transcripts (id, recording_id, full_text, topics) VALUES (?, ?, ?, ?)', [
    `t-${recordingId}`, recordingId, 'text', JSON.stringify(topics)
  ])
}
let capSeq = 0
function seedCapture(opts: { source?: string | null; quality?: string | null; deletedAt?: string | null; meetingId?: string | null } = {}): string {
  const id = `cap-${++capSeq}`
  run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, deleted_at, meeting_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, `Cap ${id}`, '2026-06-01', opts.source ?? null, opts.quality ?? null, opts.deletedAt ?? null, opts.meetingId ?? null
  ])
  return id
}
function seedActionable(id: string, skid: string): void {
  run('INSERT INTO actionables (id, type, title, source_knowledge_id, status) VALUES (?, ?, ?, ?, ?)', [id, 'email', id, skid, 'pending'])
}
function linkKnowledgeProject(captureId: string): void {
  run('INSERT INTO knowledge_projects (knowledge_capture_id, project_id) VALUES (?, ?)', [captureId, PROJECT_ID])
}

beforeEach(async () => {
  handlers.clear()
  capSeq = 0
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  seedProject()
  registerProjectsHandlers()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('ADV15-4 — projects:getById topics gated by recording eligibility', () => {
  it('derives topics ONLY from eligible recordings', async () => {
    seedMeeting('m-1')
    seedRecording('rec-ok', 'm-1')
    seedTranscript('rec-ok', ['Roadmap', 'Budget'])
    seedRecording('rec-del', 'm-1', { deleted: true })
    seedTranscript('rec-del', ['SecretDeleted'])
    seedRecording('rec-personal', 'm-1', { personal: true })
    seedTranscript('rec-personal', ['SecretPersonal'])
    // value-excluded recording: attach a garbage capture (no keep) to rec-garbage.
    seedRecording('rec-garbage', 'm-1')
    seedTranscript('rec-garbage', ['SecretGarbage'])
    seedCapture({ source: 'rec-garbage', quality: 'garbage' })

    const res = await invoke('projects:getById', PROJECT_ID)
    expect(res.success).toBe(true)
    expect(res.data.topics.sort()).toEqual(['Budget', 'Roadmap'])
    expect(res.data.topics).not.toContain('SecretDeleted')
    expect(res.data.topics).not.toContain('SecretPersonal')
    expect(res.data.topics).not.toContain('SecretGarbage')
  })

  // NOTE: the topic gate's FAIL-CLOSED behavior (a filterEligibleRecordingIds
  // lookup error → zero topics) can't be isolated inside projects:getById because
  // its sibling reads (getKnowledgeIdsForProject/getTopicsForProjectMeetings) share
  // the same tables; that fail-closed path is exhaustively covered directly in
  // recording-eligibility.test.ts / capture-eligibility.test.ts.
})

describe('ADV15-5 — projects:getActionables gated by the capture boundary', () => {
  it('drops actionables from excluded recordings / soft-deleted / standalone-garbage captures', async () => {
    seedMeeting('m-1')
    seedRecording('rec-ok', 'm-1')
    const capOk = seedCapture({ source: 'rec-ok', meetingId: 'm-1' })
    seedActionable('a-ok', capOk)

    seedRecording('rec-del', 'm-1', { deleted: true })
    const capDel = seedCapture({ source: 'rec-del', meetingId: 'm-1' })
    seedActionable('a-del', capDel)

    // Soft-deleted capture from an eligible recording, linked directly to project.
    const capSoftDel = seedCapture({ source: 'rec-ok', deletedAt: '2026-07-10T00:00:00.000Z' })
    linkKnowledgeProject(capSoftDel)
    seedActionable('a-softdel', capSoftDel)

    // Standalone garbage capture, linked directly to the project.
    const capGarbage = seedCapture({ source: null, quality: 'garbage' })
    linkKnowledgeProject(capGarbage)
    seedActionable('a-garbage', capGarbage)

    // Eligible standalone capture, linked directly to the project.
    const capStand = seedCapture({ source: null, quality: 'valuable' })
    linkKnowledgeProject(capStand)
    seedActionable('a-stand', capStand)

    const res = await invoke('projects:getActionables', PROJECT_ID)
    expect(res.success).toBe(true)
    expect(res.data.map((a: any) => a.id).sort()).toEqual(['a-ok', 'a-stand'])
  })
})
