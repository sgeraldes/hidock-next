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
  clearProjectDiscoveryRejection,
  dismissDiscoveredProject,
  DismissDiscoveredError
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

  /**
   * v42: provenance is enforced in the DATABASE layer, not the renderer.
   * dismissDiscoveredProject verifies the row's origin, writes the tombstone, and
   * deletes — atomically — so a stale UI, a bug, or a compromised renderer that
   * calls the IPC channel directly with a manual project's id gets a hard
   * rejection instead of a cascade delete. Runs against the REAL engine. (Nested
   * so it reuses the parent's open DB + seeded meeting m1.)
   */
  describe('v42: dismissDiscoveredProject enforces discovery provenance (fail-closed)', () => {
    it('a DISCOVERED project CAN be dismissed: tombstone + delete, and re-analysis does not re-create it', () => {
      const name = 'Meridian Alpha'
      // A transcript mention auto-creates it → origin='discovered'.
      const created = applyTranscriptEntities({ meetingId: 'm1', project: { name } })
      expect(created.projectLinked).toBe(true)
      const [row] = projectRowsByName(name)
      expect(row).toBeDefined()
      expect(
        queryOne<{ origin: string | null }>('SELECT origin FROM projects WHERE id = ?', [row.id])?.origin
      ).toBe('discovered')

      // The real dismiss path: provenance check + tombstone + delete, atomic.
      dismissDiscoveredProject(row.id)
      expect(projectRowsByName(name)).toHaveLength(0)
      expect(isProjectDiscoveryRejected(name)).toBe(true)
      // The tombstone records the source meeting (join through meeting_projects).
      const tomb = queryOne<{ source_meeting_id: string | null }>(
        'SELECT source_meeting_id FROM project_discovery_rejections WHERE name_norm = ?',
        [name.toLowerCase()]
      )
      expect(tomb?.source_meeting_id).toBe('m1')

      // Tombstone survives re-analysis: the reconciler must NOT re-create it.
      const reanalyze = applyTranscriptEntities({ meetingId: 'm1', project: { name } })
      expect(reanalyze.projectLinked).toBe(false)
      expect(projectRowsByName(name)).toHaveLength(0)
    })

    it('a MANUALLY created project CANNOT be dismissed (server-side rejection), and nothing is deleted or tombstoned', () => {
      const name = 'Halcyon Bravo'
      // createProject stamps origin='manual'.
      createProject({ id: 'halcyon-manual', name, description: null, status: 'active' })
      expect(projectRowsByName(name)).toHaveLength(1)

      let caught: DismissDiscoveredError | undefined
      try {
        dismissDiscoveredProject('halcyon-manual')
      } catch (e) {
        caught = e as DismissDiscoveredError
      }
      expect(caught).toBeInstanceOf(DismissDiscoveredError)
      expect(caught?.code).toBe('NOT_DISCOVERED')

      // The transaction rolled back: the row survives and NO tombstone was written.
      expect(projectRowsByName(name)).toHaveLength(1)
      expect(isProjectDiscoveryRejected(name)).toBe(false)
    })

    it('a LEGACY project with NULL origin CANNOT be dismissed (fail-closed on unproven provenance)', () => {
      const id = 'legacy-null-origin'
      const name = 'Obsidian Charlie'
      // Simulate a pre-v42 row inserted before provenance existed: origin stays NULL.
      run('INSERT INTO projects (id, name, status) VALUES (?, ?, ?)', [id, name, 'active'])
      expect(
        queryOne<{ origin: string | null }>('SELECT origin FROM projects WHERE id = ?', [id])?.origin
      ).toBeNull()

      let caught: DismissDiscoveredError | undefined
      try {
        dismissDiscoveredProject(id)
      } catch (e) {
        caught = e as DismissDiscoveredError
      }
      expect(caught?.code).toBe('NOT_DISCOVERED')
      expect(projectRowsByName(name)).toHaveLength(1)
      expect(isProjectDiscoveryRejected(name)).toBe(false)
    })

    it('throws NOT_FOUND for an unknown id (and writes no tombstone)', () => {
      let caught: DismissDiscoveredError | undefined
      try {
        dismissDiscoveredProject('does-not-exist')
      } catch (e) {
        caught = e as DismissDiscoveredError
      }
      expect(caught).toBeInstanceOf(DismissDiscoveredError)
      expect(caught?.code).toBe('NOT_FOUND')
    })

    it('manual re-create after a discovered dismissal clears the tombstone, re-links, and is itself no longer dismissable', () => {
      const name = 'Verdant Delta'
      // 1) discovered → dismiss → tombstone.
      const created = applyTranscriptEntities({ meetingId: 'm1', project: { name } })
      expect(created.projectLinked).toBe(true)
      const [row] = projectRowsByName(name)
      dismissDiscoveredProject(row.id)
      expect(isProjectDiscoveryRejected(name)).toBe(true)

      // 2) explicit manual re-create with the same name: allowed, clears the tombstone.
      createProject({ id: 'verdant-manual', name, description: null, status: 'active' })
      expect(projectRowsByName(name)).toHaveLength(1)
      expect(isProjectDiscoveryRejected(name)).toBe(false)

      // 3) a later mention resolves to the manual row (no duplicate)…
      const relink = applyTranscriptEntities({ meetingId: 'm1', project: { name } })
      expect(relink.projectLinked).toBe(true)
      expect(projectRowsByName(name)).toHaveLength(1)
      // …and that manual row is fail-closed against the dismiss path.
      let caught: DismissDiscoveredError | undefined
      try {
        dismissDiscoveredProject('verdant-manual')
      } catch (e) {
        caught = e as DismissDiscoveredError
      }
      expect(caught?.code).toBe('NOT_DISCOVERED')
      expect(projectRowsByName(name)).toHaveLength(1)
    })
  })
})
