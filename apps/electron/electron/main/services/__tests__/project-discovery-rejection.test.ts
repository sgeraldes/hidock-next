/**
 * F9 follow-up (v41): durable dismissal of auto-discovered projects.
 *
 * Regression: dismissing a discovered project used to be a bare delete, so the
 * next transcript re-analysis (applyTranscriptEntities) silently re-created the
 * same project — a dismiss→reappear loop. The v41 tombstone
 * (project_discovery_rejections) must block the reconciler's AUTO-create path,
 * while an explicit manual create with the same name still wins (and clears the
 * tombstone). Runs against the REAL database.ts engine.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-discovery-rejection-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryAll,
  queryOne,
  createProject,
  deleteProject,
  addProjectDiscoveryRejection,
  isProjectDiscoveryRejected,
  clearProjectDiscoveryRejection
} from '../database'
import { applyTranscriptEntities } from '../org-reconciler'

const NAME = 'Phantom Initiative'

function projectRowsByName(name: string): Array<{ id: string; name: string }> {
  return queryAll<{ id: string; name: string }>('SELECT id, name FROM projects WHERE LOWER(name) = LOWER(?)', [name])
}

describe('project discovery rejection tombstones (v41)', () => {
  beforeAll(async () => {
    await initializeDatabase()
    run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES ('m1', 'Weekly Sync', '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`)
  })

  afterAll(() => {
    closeDatabase()
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath) } catch { /* ignore */ }
    }
  })

  it('a transcript mention auto-creates and links the project (baseline)', () => {
    const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: NAME } })
    expect(res.projectLinked).toBe(true)
    const rows = projectRowsByName(NAME)
    expect(rows).toHaveLength(1)
    const link = queryOne<{ meeting_id: string }>(
      'SELECT meeting_id FROM meeting_projects WHERE project_id = ?',
      [rows[0].id]
    )
    expect(link?.meeting_id).toBe('m1')
  })

  it('dismiss (tombstone + delete) prevents re-analysis from re-creating it', () => {
    const [row] = projectRowsByName(NAME)
    expect(row).toBeDefined()

    // What projects:dismissDiscovered does: record the tombstone, then delete.
    addProjectDiscoveryRejection(NAME, 'm1')
    deleteProject(row.id)
    expect(projectRowsByName(NAME)).toHaveLength(0)
    expect(isProjectDiscoveryRejected(NAME)).toBe(true)

    // The dismiss→reappear loop: re-running the same extraction must NOT
    // re-create the project, link anything, or report a link.
    const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: NAME } })
    expect(res.projectLinked).toBe(false)
    expect(projectRowsByName(NAME)).toHaveLength(0)
  })

  it('tombstone matching is name-normalized (case/whitespace-insensitive)', () => {
    const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: '  phantom   INITIATIVE ' } })
    expect(res.projectLinked).toBe(false)
    expect(projectRowsByName(NAME)).toHaveLength(0)
  })

  it('manual create beats rejection: allowed, clears the tombstone, and future mentions link to it', () => {
    // Explicit user create with the dismissed name must succeed…
    createProject({ id: 'manual-1', name: NAME, description: null, status: 'active' })
    expect(projectRowsByName(NAME)).toHaveLength(1)
    // …and clear the tombstone (manual beats rejection).
    expect(isProjectDiscoveryRejected(NAME)).toBe(false)

    // A later mention now resolves (exact-name) and links — no duplicate created.
    const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: NAME } })
    expect(res.projectLinked).toBe(true)
    expect(projectRowsByName(NAME)).toHaveLength(1)
    const link = queryOne<{ project_id: string }>(
      `SELECT project_id FROM meeting_projects WHERE meeting_id = 'm1' AND project_id = 'manual-1'`
    )
    expect(link?.project_id).toBe('manual-1')
  })

  it('clearProjectDiscoveryRejection removes a tombstone directly', () => {
    addProjectDiscoveryRejection('Temp Reject', null)
    expect(isProjectDiscoveryRejected('Temp Reject')).toBe(true)
    clearProjectDiscoveryRejection('temp reject')
    expect(isProjectDiscoveryRejected('Temp Reject')).toBe(false)
  })
})
