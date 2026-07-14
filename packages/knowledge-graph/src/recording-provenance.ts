import { deleteEdgesCleanly, type KnowledgeGraphStore } from './graph-store.js'

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
  /**
   * Edges kept because their weight exceeds this recording's summed
   * assertion_count while NO other recording has source rows (CX-T4-1): the
   * excess weight is an unattributed co-assertion — a legacy edge predating
   * provenance that this recording later re-asserted, or a folder-ingest
   * re-assertion of an attributed edge — so the edge is treated like a shared
   * edge (weight decremented by this recording's sum, floor 1), never
   * deleted. This is AR2-3's no-unattributed-deletion rule applied to the
   * WEIGHT dimension, not just the row dimension.
   */
  unattributedResidueKept: number
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

  // Step 1: edges this recording actually asserted (with their current
  // weight, needed by step 3's full-attribution check). The JOIN drops any
  // source row whose edge_id no longer exists (a residual not yet swept by
  // pruneOrphanEdgeSources) — never phantom-counted or -deleted.
  const attributedEdges = db.queryAll<{ edge_id: string; weight: number }>(
    `SELECT DISTINCT s.edge_id AS edge_id, e.weight AS weight
       FROM graph_edge_sources s
       JOIN graph_edges e ON e.id = s.edge_id
      WHERE s.recording_id = ?`,
    [recordingId]
  )

  // Step 2: total source rows for this recording (its own count, independent
  // of how many distinct edges they span).
  const edgeSourceRowsRemoved =
    db.queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM graph_edge_sources WHERE recording_id = ?',
      [recordingId]
    )?.c ?? 0

  // Step 3: classify each attributed edge. Deletable ⇔ no OTHER recording's
  // source rows AND this recording's summed assertion_count accounts for the
  // edge's FULL weight (CX-T4-1): weight is bumped by EVERY upsertEdge, but
  // only attributed ingests write source rows — so weight in excess of this
  // recording's own sum is an unattributed co-assertion (a legacy edge this
  // recording later re-asserted, or a folder-ingest re-assertion). Deleting
  // such an edge would wipe the unattributed assertion along with ours,
  // violating AR2-3. A kept edge (shared OR unattributed-residue) has its
  // weight decremented by the SUM of this recording's assertion_counts
  // (AR2-4 — covers duplicate-entity extraction and multi-transcript
  // re-ingest of the same recording), floored at 1 so a surviving edge's
  // weight never hits 0.
  const soleSourceEdgeIds: string[] = []
  let sharedEdgesKept = 0
  let unattributedResidueKept = 0
  const weightDecrements: Array<{ edgeId: string; amount: number }> = []
  for (const { edge_id: edgeId, weight } of attributedEdges) {
    const remaining =
      db.queryOne<{ c: number }>(
        'SELECT COUNT(*) AS c FROM graph_edge_sources WHERE edge_id = ? AND recording_id <> ?',
        [edgeId, recordingId]
      )?.c ?? 0
    const removedForE =
      db.queryOne<{ s: number }>(
        'SELECT COALESCE(SUM(assertion_count), 0) AS s FROM graph_edge_sources WHERE edge_id = ? AND recording_id = ?',
        [edgeId, recordingId]
      )?.s ?? 0
    if (remaining === 0) {
      if (removedForE >= weight) {
        soleSourceEdgeIds.push(edgeId)
        continue
      }
      // CX-T4-1: unattributed residue — keep, decrement, count separately.
      unattributedResidueKept++
      weightDecrements.push({ edgeId, amount: removedForE })
      continue
    }
    sharedEdgesKept++
    weightDecrements.push({ edgeId, amount: removedForE })
  }

  // AR2-3: the deletion set is ONLY fully-attributed sole-source edges — no
  // unattributed-edge sweep of any kind. An edge with zero source rows at all
  // is, by definition, never in `attributedEdges` and is therefore never
  // touched; an edge with unattributed EXCESS weight was diverted to the
  // residue branch above.
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
    // deleteEdgesCleanly (CX-T4-3) removes each deleted edge's source rows
    // with it; a fully-attributed sole-source edge's rows all belong to this
    // recording, so the recording-wide delete below would catch them anyway —
    // routed through the shared helper for the one-sanctioned-way uniformity.
    for (const edgeId of edgesToDelete) deleteEdgesCleanly(db, 'id = ?', [edgeId])
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
    unattributedResidueKept,
  }
}

/**
 * Backstop hygiene sweep: delete `graph_edge_sources` rows whose `edge_id` no
 * longer exists in `graph_edges`. Since CX-T4-3 every sanctioned edge-deletion
 * path (`deleteEdgesCleanly`, `KnowledgeGraphStore.clear`) removes its rows
 * inline, so this sweep normally finds nothing — it exists to catch rows
 * orphaned by any historical deletion (pre-fix data) or an unknown/manual
 * writer bypassing the helper. Idempotent; safe to run after every ingest
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
