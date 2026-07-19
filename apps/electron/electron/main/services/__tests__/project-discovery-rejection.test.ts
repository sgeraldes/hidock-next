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
  DismissDiscoveredError,
  mergeProjects,
  unmergeProjects
} from '../database'
import { applyTranscriptEntities } from '../org-reconciler'

const NAME = 'PhantomOps'

function projectRowsByName(name: string): Array<{ id: string; name: string }> {
  return queryAll<{ id: string; name: string }>('SELECT id, name FROM projects WHERE LOWER(name) = LOWER(?)', [name])
}

/**
 * Drive a project into existence through the reconciler's DISCOVERY path.
 *
 * F12 (v43) gates that path: a name is only auto-created once it clears the
 * plausibility floor AND recurs across >= 2 DISTINCT sources. So every case below
 * that needs a *discovered* project now drives two sightings — the first (from
 * `m2`) is deferred to the discovery queue, the second (from `m1`) creates and
 * links it. The provenance/tombstone semantics under test are unchanged; only the
 * precondition for reaching the create branch is.
 */
function discoverProject(name: string): void {
  const first = applyTranscriptEntities({ meetingId: 'm2', project: { name } })
  expect(first.projectLinked).toBe(false) // one mention is not evidence of a project
  expect(projectRowsByName(name)).toHaveLength(0)
  const second = applyTranscriptEntities({ meetingId: 'm1', project: { name } })
  expect(second.projectLinked).toBe(true)
}

describe('project discovery rejection tombstones (v41)', () => {
  beforeAll(async () => {
    await initializeDatabase()
    run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES ('m1', 'Weekly Sync', '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`)
    // Second source so the F12 recurrence gate (>= 2 distinct meetings) can be met.
    run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES ('m2', 'Kickoff', '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')`)
  })

  afterAll(() => {
    closeDatabase()
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath) } catch { /* ignore */ }
    }
  })

  it('a RECURRING transcript mention auto-creates and links the project (baseline)', () => {
    discoverProject(NAME)
    const rows = projectRowsByName(NAME)
    expect(rows).toHaveLength(1)
    // Both corroborating meetings are linked (F12 backfill), not just the one
    // whose sighting crossed the recurrence threshold.
    const linked = queryAll<{ meeting_id: string }>(
      'SELECT meeting_id FROM meeting_projects WHERE project_id = ?',
      [rows[0].id]
    ).map((r) => r.meeting_id)
    expect(linked.sort()).toEqual(['m1', 'm2'])
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
    const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: '  PHANTOMOPS ' } })
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
      const name = 'MeridianOne'
      // Recurring transcript mentions auto-create it → origin='discovered'.
      discoverProject(name)
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
      const name = 'VerdantFour'
      // 1) discovered → dismiss → tombstone.
      discoverProject(name)
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

  /**
   * v42 follow-up (adversarial review, HIGH): merging projects must not launder
   * manual data into a dismissable row. mergeProjects folds provenance with
   * MANUAL dominance: the merged row stays 'discovered' only when BOTH inputs
   * were 'discovered'; 'manual' on either side wins, and NULL (legacy/unknown)
   * beats 'discovered' fail-closed. Otherwise a discovered keeper absorbing a
   * manual loser would keep origin='discovered' and dismissDiscoveredProject
   * would happily delete the combined hub. Both orderings are covered.
   */
  describe('v42: merge provenance dominance (manual data never becomes dismissable)', () => {
    /** Auto-create a discovered project via the reconciler and return its row id. */
    function createDiscovered(name: string): string {
      discoverProject(name)
      const [row] = projectRowsByName(name)
      expect(row).toBeDefined()
      expect(originOf(row.id)).toBe('discovered')
      return row.id
    }
    function originOf(id: string): string | null {
      return queryOne<{ origin: string | null }>('SELECT origin FROM projects WHERE id = ?', [id])?.origin ?? null
    }
    function expectNotDismissable(id: string): void {
      let caught: DismissDiscoveredError | undefined
      try {
        dismissDiscoveredProject(id)
      } catch (e) {
        caught = e as DismissDiscoveredError
      }
      expect(caught?.code).toBe('NOT_DISCOVERED')
      expect(queryOne('SELECT 1 FROM projects WHERE id = ?', [id])).toBeDefined()
    }

    it('DISCOVERED keeper + MANUAL loser -> merged row becomes manual and cannot be dismissed (the review ordering)', () => {
      const keeperId = createDiscovered('ZephyrMill')
      createProject({ id: 'manual-brook', name: 'Cobalt Brook', description: null, status: 'active' })

      mergeProjects(keeperId, 'manual-brook')

      // Manual dominates: the combined row now carries manual data.
      expect(originOf(keeperId)).toBe('manual')
      expectNotDismissable(keeperId)
    })

    it('MANUAL keeper + DISCOVERED loser -> merged row stays manual and cannot be dismissed', () => {
      createProject({ id: 'manual-quill', name: 'Umber Quill', description: null, status: 'active' })
      const loserId = createDiscovered('RussetLantern')

      mergeProjects('manual-quill', loserId)

      expect(originOf('manual-quill')).toBe('manual')
      expectNotDismissable('manual-quill')
    })

    it('DISCOVERED + DISCOVERED -> merged row remains discovered and dismissable', () => {
      const keeperId = createDiscovered('JuniperKes')
      const loserId = createDiscovered('BasaltOtter')

      mergeProjects(keeperId, loserId)

      expect(originOf(keeperId)).toBe('discovered')
      dismissDiscoveredProject(keeperId)
      expect(queryOne('SELECT 1 FROM projects WHERE id = ?', [keeperId])).toBeUndefined()
      expect(isProjectDiscoveryRejected('JuniperKes')).toBe(true)
    })

    it('LEGACY NULL keeper + DISCOVERED loser -> merged row stays NULL (fail-closed) and cannot be dismissed', () => {
      run("INSERT INTO projects (id, name, status) VALUES ('legacy-fjord', 'Tundra Fjord', 'active')")
      expect(originOf('legacy-fjord')).toBeNull()
      const loserId = createDiscovered('SableMesa')

      mergeProjects('legacy-fjord', loserId)

      // Unknown provenance must not be upgraded to 'discovered' by absorbing one.
      expect(originOf('legacy-fjord')).toBeNull()
      expectNotDismissable('legacy-fjord')
    })

    it('unmerge restores the keeper\'s own discovered origin (fold is journaled)', () => {
      const keeperId = createDiscovered('VermilionOsprey')
      createProject({ id: 'manual-dune', name: 'Ochre Dune', description: null, status: 'active' })

      mergeProjects(keeperId, 'manual-dune')
      expect(originOf(keeperId)).toBe('manual')

      const journal = queryOne<{ id: string }>(
        "SELECT id FROM merge_journal WHERE kind = 'project' AND keeper_id = ? ORDER BY created_at DESC LIMIT 1",
        [keeperId]
      )
      expect(journal).toBeDefined()
      unmergeProjects(journal!.id)

      // Keeper is discovered (and dismissable) again; the recreated loser is manual.
      expect(originOf(keeperId)).toBe('discovered')
      expect(originOf('manual-dune')).toBe('manual')
    })

    it('out-of-order unmerge is rejected (newest-first): stacked manual merges cannot be laundered back to discovered', () => {
      // The composition attack: D absorbs M1 (origin fold discovered->manual
      // journaled), then absorbs M2 (origin already manual, nothing journaled).
      // Unmerging M1 FIRST would restore D to 'discovered' while M2's manual
      // data is still folded in — making the hub dismissable. The LIFO guard
      // rejects it; only newest-first unwinding is allowed.
      const keeperId = createDiscovered('CinderFalcon')
      createProject({ id: 'manual-anchor', name: 'Pewter Anchor', description: null, status: 'active' })
      createProject({ id: 'manual-kite', name: 'Saffron Kite', description: null, status: 'active' })

      mergeProjects(keeperId, 'manual-anchor') // J1: discovered -> manual (fold journaled)
      mergeProjects(keeperId, 'manual-kite') // J2: manual -> manual (no origin fold)
      expect(originOf(keeperId)).toBe('manual')

      const journals = queryAll<{ id: string }>(
        "SELECT id FROM merge_journal WHERE kind = 'project' AND keeper_id = ? AND undone_at IS NULL ORDER BY rowid",
        [keeperId]
      )
      expect(journals).toHaveLength(2)
      const [j1, j2] = journals

      // Unmerging the OLDER merge first must be rejected…
      expect(() => unmergeProjects(j1.id)).toThrow(/newest-first/)
      // …and provenance is untouched: still manual, still guarded against dismissal.
      expect(originOf(keeperId)).toBe('manual')
      expectNotDismissable(keeperId)

      // The legal order works: pop J2 (keeper stays manual — M1 is still folded
      // in), then J1 (restores the keeper's own discovered provenance).
      unmergeProjects(j2.id)
      expect(originOf(keeperId)).toBe('manual')
      unmergeProjects(j1.id)
      expect(originOf(keeperId)).toBe('discovered')

      // Only with every merge unwound is the keeper dismissable again.
      dismissDiscoveredProject(keeperId)
      expect(queryOne('SELECT 1 FROM projects WHERE id = ?', [keeperId])).toBeUndefined()
      expect(isProjectDiscoveryRejected('CinderFalcon')).toBe(true)
    })
  })
})
