// @vitest-environment node

/**
 * Round 3a — deep-editability backend (migration v26).
 *
 * Exercises the real sql.js engine (temp-file backed) so the project-merge,
 * knowledge↔project assignment, action-item assignee and contact-name lookup
 * logic is tested against actual SQL semantics (UNIQUE collisions, OR IGNORE
 * repointing, UNION dedupe), not mocks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-r3a-deepedit-${process.pid}.sqlite`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => dbPath
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  mergeProjects,
  setKnowledgeProjects,
  getProjectsForKnowledge,
  getKnowledgeIdsForProject,
  setActionItemAssignee,
  getContactByName,
  Project
} from '../database'

// --- seed helpers -----------------------------------------------------------

function seedProject(id: string, name: string, description: string | null = null, status = 'active'): void {
  run('INSERT INTO projects (id, name, description, status) VALUES (?, ?, ?, ?)', [id, name, description, status])
}

function seedMeeting(id: string, subject = 'Sync'): void {
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [
    id,
    subject,
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T11:00:00.000Z'
  ])
}

function seedRecording(id: string, meetingId: string | null): void {
  run('INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
    id,
    `${id}.wav`,
    '2026-01-01T10:00:00.000Z',
    meetingId
  ])
}

function seedCapture(id: string, sourceRecordingId: string | null = null): void {
  run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id) VALUES (?, ?, ?, ?)', [
    id,
    `Capture ${id}`,
    '2026-01-01T10:30:00.000Z',
    sourceRecordingId
  ])
}

function seedActionItem(id: string, captureId: string, assignee: string | null = null): void {
  run('INSERT INTO action_items (id, knowledge_capture_id, content, assignee) VALUES (?, ?, ?, ?)', [
    id,
    captureId,
    'Do the thing',
    assignee
  ])
}

function seedContact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count)
     VALUES (?, ?, 'unknown', ?, ?, 0)`,
    [id, name, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
  )
}

function tagMeetingProject(meetingId: string, projectId: string): void {
  run('INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', [meetingId, projectId])
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------

describe('migration v26 objects', () => {
  it('creates the knowledge_projects table', () => {
    const info = queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_projects'")
    expect(info).toHaveLength(1)
  })

  it('adds assignee_contact_id to action_items', () => {
    const cols = queryAll<{ name: string }>("PRAGMA table_info(action_items)").map((c) => c.name)
    expect(cols).toContain('assignee_contact_id')
  })

  it('is at schema version 35', () => {
    const row = queryOne<{ version: number }>('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    expect(row?.version).toBe(35)
  })
})

describe('mergeProjects', () => {
  it('repoints meeting_projects (OR IGNORE collisions) and knowledge_projects, folds description/status, deletes loser', () => {
    seedProject('k', 'Keeper', null, 'active')
    seedProject('l', 'Loser', 'loser desc', 'archived')
    seedMeeting('m1')
    seedMeeting('m2')
    seedCapture('c1')
    seedCapture('c2')

    tagMeetingProject('m1', 'k') // keeper already tagged m1
    tagMeetingProject('m1', 'l') // collision on repoint → dropped
    tagMeetingProject('m2', 'l') // repoints cleanly to keeper

    setKnowledgeProjects('c1', ['k']) // keeper already has c1
    // give loser c1 (collision) + c2 (clean) directly
    run('INSERT OR IGNORE INTO knowledge_projects (knowledge_capture_id, project_id) VALUES (?, ?)', ['c1', 'l'])
    run('INSERT OR IGNORE INTO knowledge_projects (knowledge_capture_id, project_id) VALUES (?, ?)', ['c2', 'l'])

    const merged = mergeProjects('k', 'l')

    // description null-filled from loser; status keeper wins (was non-empty 'active')
    expect(merged.description).toBe('loser desc')
    expect(merged.status).toBe('active')

    const meetingLinks = queryAll<{ meeting_id: string }>(
      'SELECT meeting_id FROM meeting_projects WHERE project_id = ? ORDER BY meeting_id',
      ['k']
    )
    expect(meetingLinks.map((r) => r.meeting_id)).toEqual(['m1', 'm2'])
    expect(queryAll('SELECT 1 FROM meeting_projects WHERE project_id = ?', ['l'])).toHaveLength(0)

    const knowledgeLinks = queryAll<{ knowledge_capture_id: string }>(
      'SELECT knowledge_capture_id FROM knowledge_projects WHERE project_id = ? ORDER BY knowledge_capture_id',
      ['k']
    )
    expect(knowledgeLinks.map((r) => r.knowledge_capture_id)).toEqual(['c1', 'c2'])
    expect(queryAll('SELECT 1 FROM knowledge_projects WHERE project_id = ?', ['l'])).toHaveLength(0)

    expect(queryOne('SELECT 1 FROM projects WHERE id = ?', ['l'])).toBeUndefined()
  })

  it('keeps the keeper description when present', () => {
    seedProject('k', 'K', 'keeper desc')
    seedProject('l', 'L', 'loser desc')
    const merged = mergeProjects('k', 'l')
    expect(merged.description).toBe('keeper desc')
  })

  it('throws when ids are equal or a project is missing', () => {
    seedProject('k', 'K')
    expect(() => mergeProjects('k', 'k')).toThrow()
    expect(() => mergeProjects('k', 'missing')).toThrow()
    expect(() => mergeProjects('missing', 'k')).toThrow()
  })
})

describe('setKnowledgeProjects / getProjectsForKnowledge (replace-set)', () => {
  it('replaces the full assignment set for a capture', () => {
    seedProject('p1', 'P1')
    seedProject('p2', 'P2')
    seedProject('p3', 'P3')
    seedCapture('c1')

    setKnowledgeProjects('c1', ['p1', 'p2'])
    expect(getProjectsForKnowledge('c1').map((p: Project) => p.id).sort()).toEqual(['p1', 'p2'])

    // replace with a different set — old rows gone
    setKnowledgeProjects('c1', ['p3'])
    expect(getProjectsForKnowledge('c1').map((p: Project) => p.id)).toEqual(['p3'])

    // empty array clears all
    setKnowledgeProjects('c1', [])
    expect(getProjectsForKnowledge('c1')).toHaveLength(0)
  })

  it('dedupes repeated ids in the input', () => {
    seedProject('p1', 'P1')
    seedCapture('c1')
    setKnowledgeProjects('c1', ['p1', 'p1', 'p1'])
    expect(queryAll('SELECT 1 FROM knowledge_projects WHERE knowledge_capture_id = ?', ['c1'])).toHaveLength(1)
  })
})

describe('getKnowledgeIdsForProject (union direct + transitive)', () => {
  it('unions transitive (via meeting) and direct assignments without duplicates', () => {
    seedProject('proj', 'Proj')
    seedMeeting('m1')
    tagMeetingProject('m1', 'proj')
    seedRecording('r1', 'm1')
    seedCapture('cap-transitive', 'r1') // reachable via meeting → recording → capture
    seedCapture('cap-direct') // reachable only via knowledge_projects
    seedCapture('cap-both', 'r1') // reachable both ways

    setKnowledgeProjects('cap-direct', ['proj'])
    setKnowledgeProjects('cap-both', ['proj'])

    const ids = getKnowledgeIdsForProject('proj').sort()
    expect(ids).toEqual(['cap-both', 'cap-direct', 'cap-transitive'])
  })
})

describe('setActionItemAssignee', () => {
  it('binds and clears the contact without touching the raw assignee name', () => {
    seedCapture('c1')
    seedContact('bob', 'Bob')
    seedActionItem('ai1', 'c1', 'Bob')

    const bound = setActionItemAssignee('ai1', 'bob')
    expect(bound.assignee_contact_id).toBe('bob')
    expect(bound.assignee).toBe('Bob') // raw name untouched

    const cleared = setActionItemAssignee('ai1', null)
    expect(cleared.assignee_contact_id).toBeNull()
    expect(cleared.assignee).toBe('Bob')
  })

  it('throws when the action item is missing', () => {
    expect(() => setActionItemAssignee('missing', null)).toThrow()
  })
})

describe('getContactByName', () => {
  it('resolves case-insensitively and returns undefined for no match', () => {
    seedContact('alice', 'Alice Smith')
    expect(getContactByName('alice smith')?.id).toBe('alice')
    expect(getContactByName('ALICE SMITH')?.id).toBe('alice')
    expect(getContactByName('Nobody')).toBeUndefined()
  })
})
