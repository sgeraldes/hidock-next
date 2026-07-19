/**
 * F12 — the discovery gate wired through applyTranscriptEntities, against the
 * REAL database.ts engine.
 *
 * Before v43 the reconciler minted a `projects` row for ANY extracted name the
 * resolver failed to match, so one-off phrases became zero-item dead-end
 * projects. Now a name must clear BOTH bars — plausible name AND >= 2 distinct
 * sources — before anything is created; everything else lands in the deferred
 * discovery queue instead.
 *
 * This file also pins the interaction with Lane B's v41/v42 provenance system:
 * the tombstone still short-circuits ahead of the gate, auto-created rows still
 * carry origin='discovered', and manual projects are untouched by any of it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

const dbPath = join(tmpdir(), `hidock-discovery-gate-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryAll,
  queryOne,
  createProject,
  addProjectDiscoveryRejection,
  isProjectDiscoveryRejected,
  countProjectDiscoverySources,
  getPendingProjectDiscoveries
} from '../database'
import { applyTranscriptEntities, mergeDuplicateMeetingOccurrences } from '../org-reconciler'
import { MIN_DISTINCT_SOURCES } from '../project-discovery-gate'

/** Twin rows for ONE real occurrence: a bare-uid row and its `uid::slotISO` twin. */
const TWIN_SLOT_ISO = '2026-03-01T10:00:00Z'
const TWIN_BARE = 'twin-series'
const TWIN_SLOT = `twin-series::${TWIN_SLOT_ISO}`

function projectRowsByName(name: string): Array<{ id: string; name: string; origin: string | null }> {
  return queryAll<{ id: string; name: string; origin: string | null }>(
    'SELECT id, name, origin FROM projects WHERE LOWER(name) = LOWER(?)',
    [name]
  )
}

function pendingNames(): string[] {
  return getPendingProjectDiscoveries().map((d) => d.nameNorm)
}

/** NFKC key, matching database.ts's normalizeName (collapses internal whitespace). */
function norm(name: string): string {
  return name.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Projects whose NORMALIZED name matches. The reconciler stores the extractor's
 * own spelling verbatim, so a mention arriving as "basalt   ORCHARD" creates a row
 * whose raw name still carries the double space — a plain LOWER(name) comparison
 * would miss it even though it is the same project.
 */
function projectRowsByNormalizedName(name: string): Array<{ id: string; name: string }> {
  const target = norm(name)
  return queryAll<{ id: string; name: string }>('SELECT id, name FROM projects').filter(
    (p) => norm(p.name) === target
  )
}

/** One transcript analysis mentioning `name`, attributed to meeting `meetingId`. */
function mention(name: string, meetingId: string): boolean {
  return applyTranscriptEntities({ meetingId, project: { name } }).projectLinked
}

describe('F12: project discovery gate (v43)', () => {
  beforeAll(async () => {
    await initializeDatabase()
    for (const [id, subject, day] of [
      ['m1', 'Kickoff', '01'],
      ['m2', 'Weekly Sync', '02'],
      ['m3', 'Retro', '03']
    ]) {
      run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)`, [
        id,
        subject,
        `2026-02-${day}T10:00:00Z`,
        `2026-02-${day}T11:00:00Z`
      ])
    }
    // Twin occurrence rows for ONE real meeting slot — mergeDuplicateMeetingOccurrences
    // groups on (base uid, start_time), so these two collapse into the bare-uid keeper.
    for (const id of [TWIN_BARE, TWIN_SLOT]) {
      run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)`, [
        id,
        'Recurring Standup',
        TWIN_SLOT_ISO,
        '2026-03-01T11:00:00Z'
      ])
    }
    run(`INSERT INTO recordings (id, filename, date_recorded) VALUES ('r1', 'a.wav', '2026-02-01T10:00:00Z')`)
    run(`INSERT INTO recordings (id, filename, date_recorded) VALUES ('r2', 'b.wav', '2026-02-02T10:00:00Z')`)
  })

  afterAll(() => {
    // Temp DB files are swept by src/test/setup-db.ts's tracker — just close.
    closeDatabase()
  })

  describe('confidence floor', () => {
    it('never creates a project for a below-floor name, however often it recurs', () => {
      const name = 'next steps'
      expect(mention(name, 'm1')).toBe(false)
      expect(mention(name, 'm2')).toBe(false)
      expect(mention(name, 'm3')).toBe(false)

      expect(projectRowsByName(name)).toHaveLength(0)
      // It is remembered, though — the user can still promote it.
      expect(countProjectDiscoverySources(name)).toBe(3)
      expect(pendingNames()).toContain('next steps')
    })

    it('drops structural noise without even remembering it', () => {
      const junk = 'so what do we do about all of this then?'
      expect(mention(junk, 'm1')).toBe(false)
      expect(mention(junk, 'm2')).toBe(false)

      expect(projectRowsByName(junk)).toHaveLength(0)
      expect(countProjectDiscoverySources(junk)).toBe(0)
    })
  })

  describe('recurrence requirement', () => {
    it('does not create a project from a single mention', () => {
      const name = 'Solstice Beacon'
      expect(mention(name, 'm1')).toBe(false)

      expect(projectRowsByName(name)).toHaveLength(0)
      expect(countProjectDiscoverySources(name)).toBe(1)
      expect(pendingNames()).toContain('solstice beacon')
    })

    it('re-analysing the SAME meeting never manufactures recurrence', () => {
      const name = 'Cobalt Harbor'
      expect(mention(name, 'm1')).toBe(false)
      expect(mention(name, 'm1')).toBe(false)
      expect(mention(name, 'm1')).toBe(false)

      expect(countProjectDiscoverySources(name)).toBe(1)
      expect(projectRowsByName(name)).toHaveLength(0)
    })

    it('two recordings of ONE meeting count as a single source', () => {
      const name = 'Amber Foundry'
      expect(applyTranscriptEntities({ meetingId: 'm1', recordingId: 'r1', project: { name } }).projectLinked).toBe(
        false
      )
      expect(applyTranscriptEntities({ meetingId: 'm1', recordingId: 'r2', project: { name } }).projectLinked).toBe(
        false
      )

      expect(countProjectDiscoverySources(name)).toBe(1)
      expect(projectRowsByName(name)).toHaveLength(0)
    })

    it('standalone recordings with no meeting are distinct sources', () => {
      const name = 'Granite Weaver'
      expect(applyTranscriptEntities({ recordingId: 'r1', project: { name } }).projectLinked).toBe(false)
      expect(countProjectDiscoverySources(name)).toBe(1)

      // Second recording corroborates: the gate opens (no meeting to link to).
      applyTranscriptEntities({ recordingId: 'r2', project: { name } })
      expect(projectRowsByName(name)).toHaveLength(1)
    })

    /**
     * Adversarial review finding: the ledger key must be stable across
     * re-processing. It first keyed on the MEETING, so a recording analysed
     * before correlation ('r:x') and again after ('m:y') banked TWO sightings —
     * one conversation clearing the recurrence bar by itself, defeating the gate.
     */
    it('late meeting correlation updates the existing sighting instead of banking a second', () => {
      const name = 'Lantern Grove'
      // Pass 1: transcribed before the recording was correlated to a meeting.
      expect(applyTranscriptEntities({ recordingId: 'r1', project: { name } }).projectLinked).toBe(false)
      expect(countProjectDiscoverySources(name)).toBe(1)

      // Pass 2: same recording re-analysed, now correlated to m1.
      expect(
        applyTranscriptEntities({ meetingId: 'm1', recordingId: 'r1', project: { name } }).projectLinked
      ).toBe(false)

      expect(countProjectDiscoverySources(name)).toBe(1)
      expect(projectRowsByName(name)).toHaveLength(0)
      // The row was updated in place, and now carries the meeting.
      expect(
        queryOne<{ n: number }>(
          `SELECT COUNT(*) AS n FROM project_discovery_observations WHERE name_norm = 'lantern grove'`
        )?.n
      ).toBe(1)
      expect(
        queryOne<{ meeting_id: string | null }>(
          `SELECT meeting_id FROM project_discovery_observations WHERE name_norm = 'lantern grove'`
        )?.meeting_id
      ).toBe('m1')
    })

    /**
     * Same class, via the other path: mergeDuplicateMeetingOccurrences collapses
     * two rows describing ONE real occurrence. Their ledger sightings must
     * collapse with them, or the merged-away meeting id keeps double-counting a
     * single conversation.
     *
     * Driven with a below-floor name so the evidence stays observable — a name
     * that clears the floor is created the instant it reaches two distinct
     * meetings, which is before any merge could run. (That residual is real but
     * bounded: reconcileOrganization() merges occurrences on every pass, so the
     * twin window is short, and anything created inside it is a normal
     * origin='discovered' row the user can dismiss.)
     */
    it('merging duplicate meeting occurrences collapses their sightings into one source', () => {
      const name = 'the recurring update' // all-generic: recorded, never created
      // Two recordings, each attributed to one of the twin occurrence rows
      // (the bare-uid row and its `uid::slotISO` twin — same base uid, same slot).
      applyTranscriptEntities({ meetingId: TWIN_BARE, recordingId: 'r1', project: { name } })
      applyTranscriptEntities({ meetingId: TWIN_SLOT, recordingId: 'r2', project: { name } })
      // Before the merge they look like two conversations.
      expect(countProjectDiscoverySources(name)).toBe(2)

      mergeDuplicateMeetingOccurrences()

      // After it, one conversation — the phantom corroboration is gone.
      expect(countProjectDiscoverySources(name)).toBe(1)
      expect(projectRowsByName(name)).toHaveLength(0)
    })

    it('creates nothing when the mention carries no source identity at all', () => {
      const name = 'Driftwood Compass'
      expect(applyTranscriptEntities({ project: { name } }).projectLinked).toBe(false)
      expect(applyTranscriptEntities({ project: { name } }).projectLinked).toBe(false)

      expect(projectRowsByName(name)).toHaveLength(0)
      expect(countProjectDiscoverySources(name)).toBe(0)
    })
  })

  describe('recurring + confident → created', () => {
    it('creates the project on the second distinct source, stamped origin=discovered', () => {
      const name = 'Meridian Falcon'
      expect(mention(name, 'm1')).toBe(false)
      expect(projectRowsByName(name)).toHaveLength(0)

      expect(mention(name, 'm2')).toBe(true)

      const rows = projectRowsByName(name)
      expect(rows).toHaveLength(1)
      // Lane B (v42) provenance must survive the gate.
      expect(rows[0].origin).toBe('discovered')

      // BOTH corroborating meetings are linked — not just the one that tipped it
      // over. The first sighting IS the evidence that earned the project; before
      // the backfill it was discarded with the ledger and m1 could only ever be
      // linked by reprocessing its transcript.
      const linked = queryAll<{ meeting_id: string }>(
        'SELECT meeting_id FROM meeting_projects WHERE project_id = ?',
        [rows[0].id]
      ).map((r) => r.meeting_id)
      expect(linked.sort()).toEqual(['m1', 'm2'])
    })

    it('clears the deferred evidence once the project exists', () => {
      expect(countProjectDiscoverySources('Meridian Falcon')).toBe(0)
      expect(pendingNames()).not.toContain('meridian falcon')
    })

    it('a later mention links to the existing project instead of re-discovering it', () => {
      expect(mention('Meridian Falcon', 'm3')).toBe(true)
      expect(projectRowsByName('Meridian Falcon')).toHaveLength(1)
      expect(countProjectDiscoverySources('Meridian Falcon')).toBe(0)
    })

    it('counts sources by NFKC-normalized name, so spelling variants corroborate each other', () => {
      const name = 'Basalt Orchard'
      expect(mention(name, 'm1')).toBe(false)
      // Same name, different case/whitespace — the same discovery, not a new one.
      expect(mention('  basalt   ORCHARD ', 'm2')).toBe(true)
      // Exactly ONE project, not one per spelling.
      expect(projectRowsByNormalizedName(name)).toHaveLength(1)
    })

    it('needs exactly MIN_DISTINCT_SOURCES sources — not more', () => {
      const name = 'Quartz Lantern'
      const meetings = ['m1', 'm2', 'm3']
      let created = 0
      for (let i = 0; i < MIN_DISTINCT_SOURCES; i++) {
        if (mention(name, meetings[i])) created++
      }
      expect(created).toBe(1)
      expect(projectRowsByName(name)).toHaveLength(1)
    })
  })

  /**
   * End-to-end adversarial fixtures for the recalibrated scorer, in both
   * directions. The earlier calibration cleared the floor on blocklist-absence
   * alone (so recurring common nouns auto-created) and hard-dropped anything
   * under 3 code units (so "AI" and CJK names were discarded, not deferred).
   */
  describe('recurring extraction noise never becomes a project', () => {
    it.each(['budget', 'customer feedback', 'headcount'])(
      '%j recurs across three meetings and is still only a suggestion',
      (name) => {
        expect(mention(name, 'm1')).toBe(false)
        expect(mention(name, 'm2')).toBe(false)
        expect(mention(name, 'm3')).toBe(false)

        expect(projectRowsByName(name)).toHaveLength(0)
        // Remembered, not discarded — the user can still promote it.
        expect(countProjectDiscoverySources(name)).toBe(3)
        expect(pendingNames()).toContain(norm(name))
      }
    )
  })

  describe('short and non-Latin names are deferred, then creatable', () => {
    it.each(['AI', 'XR', '研究'])('%j defers on one source and is created on the second', (name) => {
      // Never dropped: the sighting is remembered from the first mention.
      expect(mention(name, 'm1')).toBe(false)
      expect(projectRowsByName(name)).toHaveLength(0)
      expect(countProjectDiscoverySources(name)).toBe(1)

      // Structure (acronym / caseless script) plus recurrence opens the gate.
      expect(mention(name, 'm2')).toBe(true)
      const rows = projectRowsByName(name)
      expect(rows).toHaveLength(1)
      expect(rows[0].origin).toBe('discovered')
    })
  })

  describe('Lane B interaction: tombstones short-circuit ahead of the gate', () => {
    it('a tombstoned name stays un-created no matter how strong the signal', () => {
      const name = 'Phantom Trellis'
      addProjectDiscoveryRejection(name, 'm1')
      expect(isProjectDiscoveryRejected(name)).toBe(true)

      // Plausible name, mentioned in every meeting — still nothing.
      expect(mention(name, 'm1')).toBe(false)
      expect(mention(name, 'm2')).toBe(false)
      expect(mention(name, 'm3')).toBe(false)

      expect(projectRowsByName(name)).toHaveLength(0)
      // And it never re-enters the deferred queue either: a dismissed name must
      // not climb back in through the suggestion surface.
      expect(countProjectDiscoverySources(name)).toBe(0)
      expect(pendingNames()).not.toContain('phantom trellis')
    })

    it('dismissing a name also clears the evidence it had already accumulated', () => {
      const name = 'Ember Sundial'
      expect(mention(name, 'm1')).toBe(false)
      expect(countProjectDiscoverySources(name)).toBe(1)

      addProjectDiscoveryRejection(name, 'm1')

      expect(countProjectDiscoverySources(name)).toBe(0)
      expect(pendingNames()).not.toContain('ember sundial')
    })
  })

  describe('manual projects are untouched by the gate', () => {
    it('a manual create succeeds immediately — no plausibility or recurrence bar', () => {
      // A name the gate would never auto-create (all-generic, single source).
      createProject({ id: 'manual-generic', name: 'next steps', description: null, status: 'active' })

      const rows = projectRowsByName('next steps')
      expect(rows).toHaveLength(1)
      expect(rows[0].origin).toBe('manual')
    })

    it('a manual create settles the name: its deferred evidence is dropped', () => {
      // 'next steps' had 3 accumulated sightings from the confidence-floor case.
      expect(countProjectDiscoverySources('next steps')).toBe(0)
      expect(pendingNames()).not.toContain('next steps')
    })

    it('later mentions resolve to the manual project rather than re-entering the gate', () => {
      expect(mention('next steps', 'm2')).toBe(true)
      expect(projectRowsByName('next steps')).toHaveLength(1)
      expect(countProjectDiscoverySources('next steps')).toBe(0)
    })

    it('a manual project is never listed as a pending discovery', () => {
      createProject({ id: 'manual-orchid', name: 'Orchid Kestrel', description: null, status: 'active' })
      expect(pendingNames()).not.toContain('orchid kestrel')
    })
  })

  describe('the deferred discovery queue', () => {
    it('reports accumulated evidence strongest-first', () => {
      const pending = getPendingProjectDiscoveries()
      expect(pending.length).toBeGreaterThan(0)
      for (let i = 1; i < pending.length; i++) {
        expect(pending[i - 1].sourceCount).toBeGreaterThanOrEqual(pending[i].sourceCount)
      }
      for (const d of pending) {
        expect(d.sourceCount).toBeGreaterThan(0)
        expect(d.name).toBeTruthy()
        expect(d.firstSeenAt).toBeTruthy()
        expect(d.lastSeenAt).toBeTruthy()
      }
    })

    it('excludes names that already exist as a project', () => {
      const existing = queryAll<{ name: string }>('SELECT name FROM projects').map((p) => p.name.toLowerCase())
      for (const norm of pendingNames()) {
        expect(existing).not.toContain(norm)
      }
    })

    it('respects the limit', () => {
      expect(getPendingProjectDiscoveries(1).length).toBeLessThanOrEqual(1)
    })

    /**
     * Review finding: the display name was MAX(original_name) — SQL's
     * LEXICOGRAPHIC max, not the most recent spelling the field documents. With
     * sightings spelled "Zenith Coil" then "Aurora Coil", MAX() returns the
     * alphabetically-last ("Zenith Coil") regardless of which arrived last.
     */
    it('reports the most RECENTLY seen spelling, not the alphabetically last', () => {
      applyTranscriptEntities({ meetingId: 'm1', recordingId: 'r1', project: { name: 'Zenith Coil' } })
      // Same normalized key is required for these to be one discovery, so vary
      // only the case — a later sighting whose spelling sorts BEFORE the first.
      run(
        `UPDATE project_discovery_observations SET original_name = 'ZENITH COIL', last_seen_at = '2000-01-01T00:00:00Z'
           WHERE name_norm = 'zenith coil'`
      )
      run(
        `INSERT INTO project_discovery_observations
           (name_norm, source_key, meeting_id, original_name, score, first_seen_at, last_seen_at)
         VALUES ('zenith coil', 'r:late', NULL, 'Zenith Coil (renamed)', 0.9, '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z')`
      )

      const entry = getPendingProjectDiscoveries().find((d) => d.nameNorm === 'zenith coil')
      expect(entry).toBeDefined()
      expect(entry!.name).toBe('Zenith Coil (renamed)')
    })

    /**
     * Review finding: the already-a-project filter used
     * `name_norm NOT IN (SELECT LOWER(name) FROM projects)`. SQLite's LOWER() is
     * ASCII-only — no NFKC folding, no whitespace collapsing — so a project whose
     * stored name differs from the NFKC key only by accent composition or spacing
     * slipped through and was offered as a brand-new discovery. Same trap
     * resolveProject's tier 1b exists to close.
     */
    it('excludes an existing project whose stored name differs only by Unicode form or spacing', () => {
      // Two Unicode forms of the same name. The assertions below pin the
      // premise at runtime, so if anything ever re-normalizes this file the test
      // fails loudly instead of silently passing for the wrong reason.
      const NFC = 'Café Motor' // composed e-acute
      const NFD = 'Café  Motor' // decomposed e + combining acute, double space
      // Pin the premise: genuinely different strings, identical NFKC key.
      expect(NFD).not.toBe(NFC)
      expect(norm(NFD)).toBe(norm(NFC))

      // A project stored in the DECOMPOSED, double-spaced form. SQLite's
      // ASCII-only LOWER(name) can never match the NFKC ledger key, so the old
      // `name_norm NOT IN (SELECT LOWER(name) FROM projects)` filter let this
      // already-existing project resurface as a brand-new discovery.
      run(`INSERT INTO projects (id, name, status, origin) VALUES ('nfkc-proj', ?, 'active', 'manual')`, [NFD])
      run(
        `INSERT INTO project_discovery_observations
           (name_norm, source_key, meeting_id, original_name, score, first_seen_at, last_seen_at)
         VALUES (?, 'r:nfkc', NULL, ?, 0.9, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [norm(NFC), NFC]
      )

      expect(pendingNames()).not.toContain(norm(NFC))
    })
  })
})
