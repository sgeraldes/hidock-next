// @vitest-environment node

/**
 * F18 (spec-004): removeRecordingProvenance / pruneOrphanEdgeSources — the
 * per-recording graph cleanup engine, plus the AR2-1 merge-collision
 * provenance transfer (mutations.ts::mergeNodes) it depends on.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import Database from 'better-sqlite3'
import { DatabaseEngine } from '@hidock/database'
import { KnowledgeGraphStore } from '../src/graph-store.js'
import { mergeNodes } from '../src/mutations.js'
import { removeRecordingProvenance, pruneOrphanEdgeSources } from '../src/recording-provenance.js'

function tempPath(name: string) {
  return join(tmpdir(), `hidock-kg-prov-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
}

// better-sqlite3 (unlike the old sql.js engine) holds a native OS file handle
// open until closeDatabase() runs — on Windows, rmSync() on a still-open file
// fails with EPERM. Track every engine created by makeStore() and close them
// all before removing files.
const engines: DatabaseEngine[] = []

async function makeStore(name: string) {
  const dbPath = tempPath(name)
  const engine = new DatabaseEngine({
    betterSqlite3: Database,
    dbPathProvider: () => dbPath,
    schemaVersion: 1,
    schema: 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
    migrations: {},
  })
  await engine.initialize()
  engines.push(engine)
  const store = new KnowledgeGraphStore(engine)
  store.initSchema()
  return { store, dbPath }
}

function closeEngines(): void {
  for (const e of engines) {
    try {
      e.closeDatabase()
    } catch {
      /* already closed */
    }
  }
  engines.length = 0
}

const ZERO_RESULT = {
  edgesRemoved: 0,
  edgeSourceRowsRemoved: 0,
  meetingNodesRemoved: 0,
  orphanNodesRemoved: 0,
  orphanNodesByType: {},
  sharedEdgesKept: 0,
  unattributedResidueKept: 0,
}

describe('removeRecordingProvenance', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('sole-source edges + their orphaned derived nodes are removed; a person node is NEVER removed', async () => {
    const { store, dbPath } = await makeStore('sole-source')
    paths.push(dbPath)
    const now = '2026-01-01'

    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:m1',
      props: { meetingId: 'm1' },
      now,
    })
    const topic = store.upsertNode({ type: 'topic', label: 'Roadmap', now })
    const decision = store.upsertNode({ type: 'decision', label: 'Ship it', now })
    const actionItem = store.upsertNode({ type: 'action_item', label: 'Draft plan', now })
    const nextStep = store.upsertNode({ type: 'next_step', label: 'Follow up', now })
    const skill = store.upsertNode({ type: 'skill', label: 'SQL', now })
    const risk = store.upsertNode({ type: 'risk', label: 'Timeline', now })

    const eAttended = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now })
    const eAbout = store.upsertEdge({ sourceId: meeting, targetId: topic, type: 'ABOUT', now })
    const eMadeIn = store.upsertEdge({ sourceId: decision, targetId: meeting, type: 'MADE_IN', now })
    const eOwns = store.upsertEdge({ sourceId: person, targetId: actionItem, type: 'OWNS', now })
    const eNextStep = store.upsertEdge({ sourceId: meeting, targetId: nextStep, type: 'HAS_NEXT_STEP', now })
    const eDemo = store.upsertEdge({ sourceId: person, targetId: skill, type: 'DEMONSTRATED', now })
    const eRaised = store.upsertEdge({ sourceId: person, targetId: risk, type: 'RAISED', now })

    for (const e of [eAttended, eAbout, eMadeIn, eOwns, eNextStep, eDemo, eRaised]) {
      store.recordEdgeSource(e, 'R1', 'T1', now)
    }

    const res = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
    expect(res.edgesRemoved).toBe(7)
    expect(res.edgeSourceRowsRemoved).toBe(7)
    expect(res.meetingNodesRemoved).toBe(1)
    expect(res.sharedEdgesKept).toBe(0)
    expect(res.orphanNodesRemoved).toBe(6)
    expect(res.orphanNodesByType).toEqual({
      topic: 1,
      decision: 1,
      action_item: 1,
      next_step: 1,
      skill: 1,
      risk: 1,
    })

    expect(store.getNode(person)).toBeDefined()
    expect(store.getNode(meeting)).toBeUndefined()
    for (const id of [topic, decision, actionItem, nextStep, skill, risk]) {
      expect(store.getNode(id)).toBeUndefined()
    }
  })

  it('an edge re-asserted by two recordings survives cleanup of one; weight decremented; sharedEdgesKept=1', async () => {
    const { store, dbPath } = await makeStore('shared-edge')
    paths.push(dbPath)
    const now = '2026-01-01'
    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Standup',
      key: 'meeting:m1',
      props: { meetingId: 'm1' },
      now,
    })

    const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now }) // weight 1
    store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now }) // weight -> 2 (R2's assertion)
    store.recordEdgeSource(edgeId, 'R1', 'T1', now)
    store.recordEdgeSource(edgeId, 'R2', 'T2', now)

    const res = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
    expect(res.edgesRemoved).toBe(0)
    expect(res.sharedEdgesKept).toBe(1)
    expect(res.edgeSourceRowsRemoved).toBe(1) // only R1's row

    const edge = store.db.queryOne<{ weight: number }>('SELECT weight FROM graph_edges WHERE id = ?', [edgeId])
    expect(edge?.weight).toBe(1) // 2 - R1's assertion_count(1) = 1
    expect(store.getNode(meeting)).toBeDefined() // R2's edge keeps it alive
  })

  it('CX-T4-1: a legacy edge (weight predating provenance) re-asserted by R survives cleanup(R) with the legacy weight intact', async () => {
    const { store, dbPath } = await makeStore('legacy-weight')
    paths.push(dbPath)
    const now = '2026-01-01'
    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:m1',
      props: { meetingId: 'm1' },
      now,
    })

    // Legacy history: the edge was asserted TWICE before provenance existed
    // (weight 2, zero source rows) ...
    const legacyEdge = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now }) // weight 1
    store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now }) // weight -> 2
    // ... then recording R re-asserts it post-F18 (weight -> 3, R's count 1).
    store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now }) // weight -> 3
    store.recordEdgeSource(legacyEdge, 'R1', 'T1', now)

    // Contrast control in the same run: a second, FULLY-attributed edge
    // (weight 1, R's count 1) must still be deleted.
    const topic = store.upsertNode({ type: 'topic', label: 'Roadmap', now })
    const attributedEdge = store.upsertEdge({ sourceId: meeting, targetId: topic, type: 'ABOUT', now })
    store.recordEdgeSource(attributedEdge, 'R1', 'T1', now)

    // Dry-run first — the plan must classify identically without writing.
    const dry = removeRecordingProvenance(store, 'R1', { meetingId: 'm1', dryRun: true })
    const res = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
    expect(res).toEqual(dry)

    expect(res.edgesRemoved).toBe(1) // only the fully-attributed ABOUT edge
    expect(res.unattributedResidueKept).toBe(1) // the legacy-weight ATTENDED edge
    expect(res.sharedEdgesKept).toBe(0)
    expect(res.meetingNodesRemoved).toBe(0) // the kept residue edge keeps M alive
    expect(res.orphanNodesRemoved).toBe(1) // the topic (its only edge was deleted)

    // The legacy edge survives at its pre-R weight (3 - R's count 1 = 2),
    // with R's source row gone.
    const edge = store.db.queryOne<{ weight: number }>('SELECT weight FROM graph_edges WHERE id = ?', [
      legacyEdge,
    ])
    expect(edge?.weight).toBe(2)
    expect(
      store.db.queryAll('SELECT * FROM graph_edge_sources WHERE edge_id = ?', [legacyEdge])
    ).toHaveLength(0)
    expect(store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', [attributedEdge])).toBeUndefined()
    expect(store.getNode(meeting)).toBeDefined()
  })

  it('a topic shared by two recordings survives cleanup of one (only the sole-sourced meeting-edge is removed)', async () => {
    const { store, dbPath } = await makeStore('shared-topic')
    paths.push(dbPath)
    const now = '2026-01-01'
    const m1 = store.upsertNode({ type: 'meeting', label: 'M1', key: 'meeting:m1', props: { meetingId: 'm1' }, now })
    const m2 = store.upsertNode({ type: 'meeting', label: 'M2', key: 'meeting:m2', props: { meetingId: 'm2' }, now })
    const topic = store.upsertNode({ type: 'topic', label: 'Roadmap', now })

    const e1 = store.upsertEdge({ sourceId: m1, targetId: topic, type: 'ABOUT', now })
    const e2 = store.upsertEdge({ sourceId: m2, targetId: topic, type: 'ABOUT', now })
    store.recordEdgeSource(e1, 'R1', 'T1', now)
    store.recordEdgeSource(e2, 'R2', 'T2', now)

    const res = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
    expect(res.edgesRemoved).toBe(1)
    expect(res.meetingNodesRemoved).toBe(1) // m1 has 0 edges left
    expect(res.orphanNodesRemoved).toBe(0) // topic still has m2's edge

    expect(store.getNode(topic)).toBeDefined()
    expect(store.getNode(m1)).toBeUndefined()
    expect(store.getNode(m2)).toBeDefined()
  })

  it('a legacy label-keyed meeting node (no source rows at all) is left untouched', async () => {
    const { store, dbPath } = await makeStore('legacy')
    paths.push(dbPath)
    const now = '2026-01-01'
    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    // Pre-F18 style: label-keyed (no `key`), no provenance ever recorded.
    const meeting = store.upsertNode({ type: 'meeting', label: 'Almuerzo', now })
    store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now })

    const res = removeRecordingProvenance(store, 'R-legacy')
    expect(res).toEqual(ZERO_RESULT)
    expect(store.getNode(meeting)).toBeDefined()
    expect(store.getNode(person)).toBeDefined()
  })

  it('a meeting node shared by two recordings on the SAME occurrence is kept until both are removed', async () => {
    const { store, dbPath } = await makeStore('shared-occurrence')
    paths.push(dbPath)
    const now = '2026-01-01'
    const p1 = store.upsertNode({ type: 'person', label: 'Alice', now })
    const p2 = store.upsertNode({ type: 'person', label: 'Bob', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Standup',
      key: 'meeting:shared-m',
      props: { meetingId: 'shared-m' },
      now,
    })

    const e1 = store.upsertEdge({ sourceId: p1, targetId: meeting, type: 'ATTENDED', now })
    const e2 = store.upsertEdge({ sourceId: p2, targetId: meeting, type: 'ATTENDED', now })
    store.recordEdgeSource(e1, 'R1', 'T1', now)
    store.recordEdgeSource(e2, 'R2', 'T2', now)

    const res1 = removeRecordingProvenance(store, 'R1', { meetingId: 'shared-m' })
    expect(res1.meetingNodesRemoved).toBe(0)
    expect(store.getNode(meeting)).toBeDefined()

    const res2 = removeRecordingProvenance(store, 'R2', { meetingId: 'shared-m' })
    expect(res2.meetingNodesRemoved).toBe(1)
    expect(store.getNode(meeting)).toBeUndefined()
  })

  it('AR2-3: an id-keyed meeting node with one sourced + one unattributed edge — purge deletes only the sourced edge; node + unattributed edge survive', async () => {
    const { store, dbPath } = await makeStore('unattributed')
    paths.push(dbPath)
    const now = '2026-01-01'
    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    const topic = store.upsertNode({ type: 'topic', label: 'Roadmap', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:m-unattr',
      props: { meetingId: 'm-unattr' },
      now,
    })

    const sourcedEdge = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now })
    store.recordEdgeSource(sourcedEdge, 'R1', 'T1', now)
    // No graph_edge_sources row at all for this one (e.g. a manual Context
    // Graph edit, or an edge pre-dating provenance).
    const unattributedEdge = store.upsertEdge({ sourceId: meeting, targetId: topic, type: 'ABOUT', now })

    const res = removeRecordingProvenance(store, 'R1', { meetingId: 'm-unattr' })
    expect(res.edgesRemoved).toBe(1)
    expect(res.meetingNodesRemoved).toBe(0) // the unattributed ABOUT edge keeps it alive
    expect(res.orphanNodesRemoved).toBe(0)

    expect(store.getNode(meeting)).toBeDefined()
    expect(store.getNode(topic)).toBeDefined()
    expect(store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', [unattributedEdge])).toBeDefined()
    expect(store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', [sourcedEdge])).toBeUndefined()
  })

  it('a zero-edge meeting node is resolved via opts.meetingId and removed', async () => {
    const { store, dbPath } = await makeStore('zero-edge')
    paths.push(dbPath)
    const now = '2026-01-01'
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Empty',
      key: 'meeting:m-empty',
      props: { meetingId: 'm-empty' },
      now,
    })

    const res = removeRecordingProvenance(store, 'R-empty', { meetingId: 'm-empty' })
    expect(res.meetingNodesRemoved).toBe(1)
    expect(store.getNode(meeting)).toBeUndefined()
  })

  it('dryRun returns the same counts as a subsequent real run, and mutates nothing', async () => {
    const { store, dbPath } = await makeStore('dryrun-parity')
    paths.push(dbPath)
    const now = '2026-01-01'
    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:m1',
      props: { meetingId: 'm1' },
      now,
    })
    const topic = store.upsertNode({ type: 'topic', label: 'Roadmap', now })
    const eAttended = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now })
    const eAbout = store.upsertEdge({ sourceId: meeting, targetId: topic, type: 'ABOUT', now })
    store.recordEdgeSource(eAttended, 'R1', 'T1', now)
    store.recordEdgeSource(eAbout, 'R1', 'T1', now)

    const snapshot = () => ({
      nodes: store.db.queryAll('SELECT * FROM graph_nodes ORDER BY id'),
      edges: store.db.queryAll('SELECT * FROM graph_edges ORDER BY id'),
      sources: store.db.queryAll(
        'SELECT * FROM graph_edge_sources ORDER BY edge_id, recording_id, transcript_id'
      ),
    })

    const before = snapshot()
    const dry = removeRecordingProvenance(store, 'R1', { meetingId: 'm1', dryRun: true })
    const after = snapshot()
    expect(after).toEqual(before) // zero mutations

    const real = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
    expect(real).toEqual(dry)
  })

  it('is idempotent: a second call on the same recording returns all-zero', async () => {
    const { store, dbPath } = await makeStore('idempotent')
    paths.push(dbPath)
    const now = '2026-01-01'
    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:m1',
      props: { meetingId: 'm1' },
      now,
    })
    const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now })
    store.recordEdgeSource(edgeId, 'R1', 'T1', now)

    const first = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
    expect(first.edgesRemoved).toBe(1)

    const second = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
    expect(second).toEqual(ZERO_RESULT)
  })

  describe('project-node GC gate', () => {
    it('isProjectProtected=>true protects; =>false GCs it', async () => {
      const { store, dbPath } = await makeStore('project-protect')
      paths.push(dbPath)
      const now = '2026-01-01'
      const project = store.upsertNode({ type: 'project', label: 'Phoenix', now })

      const m1 = store.upsertNode({ type: 'meeting', label: 'K1', key: 'meeting:m1', props: { meetingId: 'm1' }, now })
      const e1 = store.upsertEdge({ sourceId: m1, targetId: project, type: 'ABOUT', now })
      store.recordEdgeSource(e1, 'R1', 'T1', now)

      const protectedRes = removeRecordingProvenance(store, 'R1', {
        meetingId: 'm1',
        isProjectProtected: () => true,
      })
      expect(protectedRes.orphanNodesRemoved).toBe(0)
      expect(store.getNode(project)).toBeDefined()

      const m2 = store.upsertNode({ type: 'meeting', label: 'K2', key: 'meeting:m2', props: { meetingId: 'm2' }, now })
      const e2 = store.upsertEdge({ sourceId: m2, targetId: project, type: 'ABOUT', now })
      store.recordEdgeSource(e2, 'R2', 'T2', now)

      const unprotectedRes = removeRecordingProvenance(store, 'R2', {
        meetingId: 'm2',
        isProjectProtected: () => false,
      })
      expect(unprotectedRes.orphanNodesRemoved).toBe(1)
      expect(unprotectedRes.orphanNodesByType).toEqual({ project: 1 })
      expect(store.getNode(project)).toBeUndefined()
    })

    it('default (no callback) always protects a project node', async () => {
      const { store, dbPath } = await makeStore('project-default')
      paths.push(dbPath)
      const now = '2026-01-01'
      const project = store.upsertNode({ type: 'project', label: 'Phoenix', now })
      const meeting = store.upsertNode({
        type: 'meeting',
        label: 'Kickoff',
        key: 'meeting:m1',
        props: { meetingId: 'm1' },
        now,
      })
      const edgeId = store.upsertEdge({ sourceId: meeting, targetId: project, type: 'ABOUT', now })
      store.recordEdgeSource(edgeId, 'R1', 'T1', now)

      const res = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
      expect(res.orphanNodesRemoved).toBe(0)
      expect(store.getNode(project)).toBeDefined()
    })
  })

  describe('assertion_count math (AR2-4)', () => {
    it('weight decrement sums assertion_count across multiple transcripts of the SAME recording', async () => {
      const { store, dbPath } = await makeStore('assertion-multi-transcript')
      paths.push(dbPath)
      const now = '2026-01-01'
      const person = store.upsertNode({ type: 'person', label: 'Alice', now })
      const meeting = store.upsertNode({
        type: 'meeting',
        label: 'Kickoff',
        key: 'meeting:m1',
        props: { meetingId: 'm1' },
        now,
      })

      // R1 asserts under T1, then again under T2 (re-transcription, §3.7);
      // R2 also asserts it (keeps it shared).
      const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now }) // weight 1
      store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now }) // weight -> 2
      store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now }) // weight -> 3
      store.recordEdgeSource(edgeId, 'R1', 'T1', now)
      store.recordEdgeSource(edgeId, 'R1', 'T2', now)
      store.recordEdgeSource(edgeId, 'R2', 'T3', now)

      const res = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
      expect(res.sharedEdgesKept).toBe(1)
      expect(res.edgeSourceRowsRemoved).toBe(2) // R1's two rows (T1, T2)

      const edge = store.db.queryOne<{ weight: number }>('SELECT weight FROM graph_edges WHERE id = ?', [edgeId])
      expect(edge?.weight).toBe(1) // 3 - (1 + 1) = 1

      const remaining = store.db.queryAll<{ recording_id: string }>(
        'SELECT recording_id FROM graph_edge_sources WHERE edge_id = ?',
        [edgeId]
      )
      expect(remaining.map((r) => r.recording_id)).toEqual(['R2'])
    })

    it('duplicate assertion of the SAME (edge,recording,transcript) bumps assertion_count instead of duplicating the row', async () => {
      const { store, dbPath } = await makeStore('assertion-duplicate')
      paths.push(dbPath)
      const now = '2026-01-01'
      const person = store.upsertNode({ type: 'person', label: 'Alice', now })
      const meeting = store.upsertNode({
        type: 'meeting',
        label: 'Kickoff',
        key: 'meeting:m1',
        props: { meetingId: 'm1' },
        now,
      })
      const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now })
      store.recordEdgeSource(edgeId, 'R1', 'T1', now)
      store.recordEdgeSource(edgeId, 'R1', 'T1', now) // duplicate-entity extraction: same triple twice

      const row = store.db.queryOne<{ assertion_count: number }>(
        'SELECT assertion_count FROM graph_edge_sources WHERE edge_id = ? AND recording_id = ? AND transcript_id = ?',
        [edgeId, 'R1', 'T1']
      )
      expect(row?.assertion_count).toBe(2)

      const all = store.db.queryAll('SELECT * FROM graph_edge_sources WHERE edge_id = ?', [edgeId])
      expect(all).toHaveLength(1) // one row, not two
    })
  })

  describe('merge-collision provenance transfer (AR2-1)', () => {
    it('keeper edge sourced by R1, colliding loser edge sourced by R2: after merge, cleanup(R1) keeps the edge; cleanup(R2) then removes it', async () => {
      const { store, dbPath } = await makeStore('merge-collision')
      paths.push(dbPath)
      const now = '2026-01-01'

      const meeting = store.upsertNode({
        type: 'meeting',
        label: 'Kickoff',
        key: 'meeting:m1',
        props: { meetingId: 'm1' },
        now,
      })
      const keeper = store.upsertNode({ type: 'topic', label: 'Roadmap', now })
      const loser = store.upsertNode({ type: 'topic', label: 'Road-map', now })

      const keeperEdge = store.upsertEdge({ sourceId: meeting, targetId: keeper, type: 'ABOUT', now })
      store.recordEdgeSource(keeperEdge, 'R1', 'T1', now)

      const loserEdge = store.upsertEdge({ sourceId: meeting, targetId: loser, type: 'ABOUT', now })
      store.recordEdgeSource(loserEdge, 'R2', 'T2', now)

      mergeNodes(store, keeper, loser) // meeting->loser collides with meeting->keeper after repoint

      // The surviving keeper edge now carries BOTH recordings' provenance.
      const rows = store.db.queryAll<{ recording_id: string }>(
        'SELECT recording_id FROM graph_edge_sources WHERE edge_id = ?',
        [keeperEdge]
      )
      expect(rows.map((r) => r.recording_id).sort()).toEqual(['R1', 'R2'])
      // The dropped loser edge's rows were moved, not left dangling.
      expect(
        store.db.queryAll('SELECT * FROM graph_edge_sources WHERE edge_id = ?', [loserEdge])
      ).toHaveLength(0)

      const cleanR1 = removeRecordingProvenance(store, 'R1', { meetingId: 'm1' })
      expect(cleanR1.edgesRemoved).toBe(0)
      expect(cleanR1.sharedEdgesKept).toBe(1)
      expect(store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', [keeperEdge])).toBeDefined()

      const cleanR2 = removeRecordingProvenance(store, 'R2', { meetingId: 'm1' })
      expect(cleanR2.edgesRemoved).toBe(1)
      expect(store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', [keeperEdge])).toBeUndefined()
    })
  })
})

describe('pruneOrphanEdgeSources', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('deletes only rows whose edge_id no longer exists in graph_edges', async () => {
    const { store, dbPath } = await makeStore('prune-orphan')
    paths.push(dbPath)
    const now = '2026-01-01'
    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:m1',
      props: { meetingId: 'm1' },
      now,
    })
    const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now })
    store.recordEdgeSource(edgeId, 'R1', 'T1', now)
    // Orphan: a source row for an edge id that doesn't exist (a collision residual).
    store.recordEdgeSource('edge:phantom', 'R2', 'T2', now)

    const res = pruneOrphanEdgeSources(store)
    expect(res.removed).toBe(1)

    const remaining = store.db.queryAll<{ edge_id: string }>('SELECT edge_id FROM graph_edge_sources')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].edge_id).toBe(edgeId)

    expect(pruneOrphanEdgeSources(store).removed).toBe(0) // idempotent
  })
})
