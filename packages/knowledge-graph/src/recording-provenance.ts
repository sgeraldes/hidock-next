import type { KnowledgeGraphStore } from './graph-store.js'

/**
 * F18 (spec-004): per-recording graph-provenance removal engine.
 *
 * Named `recording-provenance.ts` (not `provenance.ts`) to avoid shadowing the
 * existing `provenance()` query in queries.ts, which answers a different
 * question ("what evidence explains this node?") from this module's ("what did
 * THIS recording contribute, and can it be precisely un-contributed?").
 */

export interface RecordingProvenanceRemoval {
  /** Sole-source (fully attributed to this recording) edges removed. */
  edgesRemoved: number
  /** graph_edge_sources rows removed for this recording (all its edges, incl. shared ones). */
  edgeSourceRowsRemoved: number
  /** 0 or 1 — the id-keyed meeting node, removed only when it reaches 0 incident edges. */
  meetingNodesRemoved: number
  /** Derived nodes (topic/decision/action_item/next_step/skill/risk/project) orphaned by the removal. */
  orphanNodesRemoved: number
  orphanNodesByType: Record<string, number>
  /** Edges kept because another recording also sourced them (weight decremented, never deleted). */
  sharedEdgesKept: number
}

export interface RemoveRecordingProvenanceOptions {
  /** Compute the plan without writing anything. */
  dryRun?: boolean
  /** The id-keyed meeting node's `props.meetingId` to resolve (norm_key LIKE 'meeting:%'). */
  meetingId?: string
  /**
   * Project-node GC gate: return true to PROTECT a candidate project node
   * (never GC it — e.g. it is linked to a real `projects` DB row), false to
   * allow GC. Omitted → always protected (never GC a project node without an
   * explicit callback saying it's safe).
   */
  isProjectProtected?: (node: { id: string; label: string; type: string }) => boolean
}

export interface PruneOrphanEdgeSourcesResult {
  /** graph_edge_sources rows removed because their edge_id no longer exists. */
  removed: number
}

/** Node types eligible for orphan GC (0 remaining incident edges). Person is
 *  NEVER eligible (checked separately); project is conditionally eligible via
 *  `isProjectProtected`; every other type (meeting) is left alone here — the
 *  id-keyed meeting node has its own dedicated step. */
const GC_ELIGIBLE_TYPES = new Set(['topic', 'decision', 'action_item', 'next_step', 'skill', 'risk'])

interface EdgeEndpoints {
  id: string
  source_id: string
  target_id: string
}

/**
 * Remove exactly recording `recordingId`'s graph provenance: its sole-source
 * (solely-attributed) edges, the id-keyed meeting node once it reaches 0
 * incident edges, and any node this orphans — never touching a shared or
 * unattributed edge (AR2-3: NO unattributed-edge deletion, ever — only
 * sole-SOURCE edges are deleted; a node keeping even one unattributed edge is
 * honest residue, same policy as a pre-F18 legacy node).
 *
 * TRANSACTION-NEUTRAL (AR2-2): pure sequential surgery on the injected store's
 * GraphDb — no transaction of its own, no app-table access (recordings /
 * transcripts / graph_ingested_transcripts are the host's concern; the host
 * resolves `opts.meetingId` and wraps the call in its own transaction).
 *
 * dryRun-safe by construction: every returned count is derived from a single
 * in-memory PLAN computed from reads taken BEFORE any write — never from a
 * post-write re-SELECT. When `!dryRun` the plan is then executed verbatim, so
 * a dry-run and a subsequent real run (against a quiescent DB) report
 * IDENTICAL counts.
 */
export function removeRecordingProvenance(
  store: KnowledgeGraphStore,
  recordingId: string,
  opts: RemoveRecordingProvenanceOptions = {}
): RecordingProvenanceRemoval {
  const db = store.db
  const dryRun = !!opts.dryRun
  const isProjectProtected = opts.isProjectProtected ?? (() => true)

  // Step 1: edges this recording actually asserted. The JOIN drops any source
  // row whose edge_id no longer exists (a merge-collision residual not yet
  // swept by pruneOrphanEdgeSources) — never phantom-counted or -deleted.
  const attributedEdgeIds = db
    .queryAll<{ edge_id: string }>(
      `SELECT DISTINCT s.edge_id AS edge_id
         FROM graph_edge_sources s
         JOIN graph_edges e ON e.id = s.edge_id
        WHERE s.recording_id = ?`,
      [recordingId]
    )
    .map((r) => r.edge_id)

  // Step 2: total source rows for this recording (its own count, independent
  // of how many distinct edges they span).
  const edgeSourceRowsRemoved =
    db.queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM graph_edge_sources WHERE recording_id = ?',
      [recordingId]
    )?.c ?? 0

  // Step 3: classify each attributed edge sole-source vs shared. A shared
  // edge is never deleted; its weight is decremented by the SUM of this
  // recording's assertion_counts for it (AR2-4 — covers duplicate-entity
  // extraction and multi-transcript re-ingest of the same recording), floored
  // at 1 so a surviving shared edge's weight never hits 0.
  const soleSourceEdgeIds: string[] = []
  let sharedEdgesKept = 0
  const weightDecrements: Array<{ edgeId: string; amount: number }> = []
  for (const edgeId of attributedEdgeIds) {
    const remaining =
      db.queryOne<{ c: number }>(
        'SELECT COUNT(*) AS c FROM graph_edge_sources WHERE edge_id = ? AND recording_id <> ?',
        [edgeId, recordingId]
      )?.c ?? 0
    if (remaining === 0) {
      soleSourceEdgeIds.push(edgeId)
      continue
    }
    sharedEdgesKept++
    const removedForE =
      db.queryOne<{ s: number }>(
        'SELECT COALESCE(SUM(assertion_count), 0) AS s FROM graph_edge_sources WHERE edge_id = ? AND recording_id = ?',
        [edgeId, recordingId]
      )?.s ?? 0
    weightDecrements.push({ edgeId, amount: removedForE })
  }

  // AR2-3: the deletion set is ONLY sole-source edges — no unattributed-edge
  // sweep of any kind. An edge with zero source rows at all is, by
  // definition, never in `attributedEdgeIds` and is therefore never touched.
  const edgesToDelete = soleSourceEdgeIds
  const edgesRemoved = edgesToDelete.length

  const edgeRows = edgesToDelete.length
    ? db.queryAll<EdgeEndpoints>(
        `SELECT id, source_id, target_id FROM graph_edges WHERE id IN (${edgesToDelete.map(() => '?').join(',')})`,
        edgesToDelete
      )
    : []

  // Resolve the id-keyed meeting node M, when a meetingId was given.
  let meetingNodeId: string | null = null
  if (opts.meetingId) {
    const m = db.queryOne<{ id: string }>(
      `SELECT id FROM graph_nodes
        WHERE type = 'meeting' AND norm_key LIKE 'meeting:%' AND JSON_EXTRACT(props, '$.meetingId') = ?`,
      [opts.meetingId]
    )
    meetingNodeId = m?.id ?? null
  }

  // Candidate orphan node ids: every endpoint of edgesToDelete, excluding M
  // itself (M is evaluated on its own, immediately below). This set is
  // complete — a node loses incidence only when an incident edge is deleted,
  // and every deleted edge is in edgesToDelete.
  const candidateIds = new Set<string>()
  for (const e of edgeRows) {
    if (e.source_id !== meetingNodeId) candidateIds.add(e.source_id)
    if (e.target_id !== meetingNodeId) candidateIds.add(e.target_id)
  }

  const deletedIncidentCount = (nodeId: string): number =>
    edgeRows.reduce((n, e) => n + (e.source_id === nodeId || e.target_id === nodeId ? 1 : 0), 0)

  const currentIncidentCount = (nodeId: string): number =>
    db.queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM graph_edges WHERE source_id = ? OR target_id = ?',
      [nodeId, nodeId]
    )?.c ?? 0

  // Post-plan incidence = current (pre-write) incidence minus what this run's
  // planned deletes will remove — computed from reads only, so dry-run and a
  // real run derive IDENTICAL numbers without ever re-querying post-delete.
  let meetingNodesRemoved = 0
  if (meetingNodeId) {
    const postPlan = currentIncidentCount(meetingNodeId) - deletedIncidentCount(meetingNodeId)
    if (postPlan <= 0) meetingNodesRemoved = 1
  }

  const orphanNodesByType: Record<string, number> = {}
  const nodesToDelete: string[] = []
  for (const nodeId of candidateIds) {
    const postPlan = currentIncidentCount(nodeId) - deletedIncidentCount(nodeId)
    if (postPlan > 0) continue // still has at least one (possibly unattributed) edge — keep it
    const node = db.queryOne<{ id: string; type: string; label: string }>(
      'SELECT id, type, label FROM graph_nodes WHERE id = ?',
      [nodeId]
    )
    if (!node) continue
    if (node.type === 'person') continue // never GC a person node
    if (node.type === 'project') {
      if (isProjectProtected(node)) continue
    } else if (!GC_ELIGIBLE_TYPES.has(node.type)) {
      continue
    }
    nodesToDelete.push(nodeId)
    orphanNodesByType[node.type] = (orphanNodesByType[node.type] ?? 0) + 1
  }
  const orphanNodesRemoved = nodesToDelete.length

  if (!dryRun) {
    for (const edgeId of edgesToDelete) db.run('DELETE FROM graph_edges WHERE id = ?', [edgeId])
    db.run('DELETE FROM graph_edge_sources WHERE recording_id = ?', [recordingId])
    for (const { edgeId, amount } of weightDecrements) {
      db.run('UPDATE graph_edges SET weight = MAX(1, weight - ?) WHERE id = ?', [amount, edgeId])
    }
    if (meetingNodeId && meetingNodesRemoved === 1) {
      db.run('DELETE FROM graph_nodes WHERE id = ?', [meetingNodeId])
    }
    for (const nodeId of nodesToDelete) {
      db.run('DELETE FROM graph_nodes WHERE id = ?', [nodeId])
    }
  }

  return {
    edgesRemoved,
    edgeSourceRowsRemoved,
    meetingNodesRemoved,
    orphanNodesRemoved,
    orphanNodesByType,
    sharedEdgesKept,
  }
}

/**
 * Hygiene sweep: delete `graph_edge_sources` rows whose `edge_id` no longer
 * exists in `graph_edges` — the residue of a merge-collision repoint that
 * dropped an edge without a keeper to transfer onto (a self-loop collapse;
 * see mutations.ts::mergeNodes). Idempotent; safe to run after every ingest
 * pass. `removeRecordingProvenance`'s own reads already JOIN against
 * `graph_edges`, so orphaned rows are never phantom-counted/deleted even
 * without this sweep — this is pure hygiene, not a correctness dependency.
 */
export function pruneOrphanEdgeSources(store: KnowledgeGraphStore): PruneOrphanEdgeSourcesResult {
  const db = store.db
  const before =
    db.queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM graph_edge_sources WHERE edge_id NOT IN (SELECT id FROM graph_edges)'
    )?.c ?? 0
  db.run('DELETE FROM graph_edge_sources WHERE edge_id NOT IN (SELECT id FROM graph_edges)')
  return { removed: before }
}
