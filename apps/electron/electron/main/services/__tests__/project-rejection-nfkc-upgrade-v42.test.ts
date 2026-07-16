/**
 * Pre-NFKC → NFKC upgrade path: re-key of discovery-rejection tombstones.
 * This heal shipped originally as migration 42 and was renumbered to 49 during
 * the beta/meeting-intelligence merge; the runtime code lives in v49.
 *
 * Adversarial review (MEDIUM): the pre-NFKC schema wrote
 * project_discovery_rejections.name_norm with the pre-NFKC normalizeName, so
 * once lookups switched to NFKC keys a tombstone recorded under a decomposed
 * (NFD) or compatibility form no longer matched — re-analysis would resurrect
 * the dismissed project, and a manual re-create could never clear the stranded
 * key. Migration 49 must transactionally re-key every existing rejection from
 * original_name, resolving NFKC collisions by keeping the NEWEST rejection per
 * collided key.
 *
 * This test simulates the REAL upgrade: initialize, seed v41-style rows (keys
 * computed with the old non-NFKC normalization), roll schema_version back to
 * 41, close, and re-open — the engine then runs migration 42 against the same
 * on-disk database, exactly as a user's app would on update.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-nfkc-upgrade-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryAll,
  queryOne,
  createProject,
  isProjectDiscoveryRejected
} from '../database'
import { applyTranscriptEntities } from '../org-reconciler'

// NOTE: the two accent forms below are byte-distinct on disk (NFC vs NFD) —
// verified by the beforeAll sanity assertion, which fails loudly if any tool
// ever normalizes this file and collapses them.
const COMPOSED = 'Café Project' // e-acute U+00E9 (NFC)
const DECOMPOSED = 'Café Project' // e + U+0301 combining acute (NFD)
const LIGATURE = 'ﬁle sync' // fi ligature U+FB01 -> NFKC 'file sync'

/** The v41 normalization: lowercase/trim/collapse, NO Unicode normalization. */
const v41Norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ')

function tombstones(): Array<{ name_norm: string; original_name: string; rejected_at: string | null }> {
  return queryAll('SELECT name_norm, original_name, rejected_at FROM project_discovery_rejections ORDER BY name_norm')
}

describe('migration v49 re-keys pre-NFKC tombstones to NFKC', () => {
  beforeAll(async () => {
    await initializeDatabase()
    run(
      `INSERT INTO meetings (id, subject, start_time, end_time) VALUES ('m1', 'Sync', '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`
    )

    // Seed v41-STYLE tombstones: keys computed with the OLD normalization.
    // (a) a decomposed-form dismissal (older)…
    run(
      `INSERT INTO project_discovery_rejections (name_norm, original_name, source_meeting_id, rejected_at) VALUES (?, ?, 'm1', ?)`,
      [v41Norm(DECOMPOSED), DECOMPOSED, '2026-01-01T00:00:00Z']
    )
    // (b) …and a composed twin of the SAME visual name (newer) — an NFKC collision.
    run(
      `INSERT INTO project_discovery_rejections (name_norm, original_name, source_meeting_id, rejected_at) VALUES (?, ?, 'm1', ?)`,
      [v41Norm(COMPOSED), COMPOSED, '2026-01-03T00:00:00Z']
    )
    // (c) a compatibility-form (ligature) dismissal, no collision.
    run(
      `INSERT INTO project_discovery_rejections (name_norm, original_name, source_meeting_id, rejected_at) VALUES (?, ?, NULL, ?)`,
      [v41Norm(LIGATURE), LIGATURE, '2026-01-02T00:00:00Z']
    )

    // Sanity: under v41 keys these are three DISTINCT rows.
    expect(tombstones()).toHaveLength(3)
    expect(v41Norm(DECOMPOSED)).not.toBe(v41Norm(COMPOSED))

    // Roll the schema back below v49 and re-open: the engine re-runs migration
    // 49 — the NFKC tombstone re-key, renumbered here from its original v42
    // during the beta/meeting-intelligence merge — against this same on-disk
    // DB, the real upgrade path.
    run('DELETE FROM schema_version WHERE version >= 49')
    closeDatabase()
    await initializeDatabase()
  })

  afterAll(() => {
    closeDatabase()
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(p)) {
        try {
          unlinkSync(p)
        } catch {
          /* ignore */
        }
      }
    }
  })

  it('re-keys every tombstone from original_name and collapses NFKC collisions to the newest row', () => {
    const rows = tombstones()
    // 3 v41 rows → 2 v42 rows: the composed/decomposed twins collide on one key.
    expect(rows).toHaveLength(2)

    const cafe = rows.find((r) => r.name_norm === COMPOSED.normalize('NFKC').toLowerCase())
    expect(cafe).toBeDefined()
    // Collision resolution: the NEWEST rejection (2026-01-03, composed) survives.
    expect(cafe!.original_name).toBe(COMPOSED)
    expect(cafe!.rejected_at).toBe('2026-01-03T00:00:00Z')

    // The ligature key is now the folded ASCII form.
    const lig = rows.find((r) => r.name_norm === 'file sync')
    expect(lig).toBeDefined()
    expect(lig!.original_name).toBe(LIGATURE)
  })

  it('both accent forms hit the tombstone after the upgrade', () => {
    expect(isProjectDiscoveryRejected(COMPOSED)).toBe(true)
    expect(isProjectDiscoveryRejected(DECOMPOSED)).toBe(true)
    expect(isProjectDiscoveryRejected('file sync')).toBe(true)
    expect(isProjectDiscoveryRejected(LIGATURE)).toBe(true)
  })

  it('re-analysis stays blocked: a mention in EITHER form does not resurrect the dismissed project', () => {
    for (const form of [DECOMPOSED, COMPOSED]) {
      const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: form } })
      expect(res.projectLinked).toBe(false)
    }
    expect(queryAll("SELECT id FROM projects WHERE name LIKE 'Caf%'")).toHaveLength(0)
  })

  it('manual re-creation clears the re-keyed tombstone (manual beats rejection, in any form)', () => {
    // The user types the DECOMPOSED form; the tombstone is keyed NFKC-composed —
    // exactly the mismatch that stranded v41 keys before the re-key.
    createProject({ id: 'manual-cafe', name: DECOMPOSED, description: null, status: 'active' })
    expect(isProjectDiscoveryRejected(COMPOSED)).toBe(false)
    expect(isProjectDiscoveryRejected(DECOMPOSED)).toBe(false)

    // And a later mention (composed form) resolves to the manual row.
    const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: COMPOSED } })
    expect(res.projectLinked).toBe(true)
    const link = queryOne<{ project_id: string }>(
      "SELECT project_id FROM meeting_projects WHERE meeting_id = 'm1' AND project_id = 'manual-cafe'"
    )
    expect(link?.project_id).toBe('manual-cafe')
  })
})
