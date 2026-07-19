import {
  deleteEdgesCleanly,
  runInGraphTransaction,
  type KnowledgeGraphStore,
  type GraphNode,
  type GraphDb,
} from './graph-store.js'
import { ownDateMs, neighborhood } from './queries.js'

/**
 * Direct, LLM-free graph mutations addressed BY NODE ID. These power the Context
 * Graph's editing affordances (rename-as-correction, merge two nodes, remove a
 * junk node) and its discoverability (per-node graph stats). They are pure
 * surgery on the injected store — no event bus, no LLM — so they unit-test against
 * an in-memory graph. Host-level policy (routing a linked-person rename through
 * the contact record, reusing the contacts merge journal, etc.) lives in the
 * Electron service that calls these.
 */

/** Normalize a label into a stable key — MUST match graph-store's normalizeLabel. */
function normalizeLabel(label: string): string {
  return label.toLowerCase().trim().replace(/\s+/g, ' ')
}

// ---------------------------------------------------------------------------
// Rename (or merge) a node by id
// ---------------------------------------------------------------------------

export interface RenameNodeResult {
  /** What happened: nothing, an in-place relabel, or a fold into an existing node. */
  outcome: 'noop' | 'renamed' | 'merged'
  /** The surviving node id (the keeper when merged; the same id when renamed). */
  nodeId: string | null
}

/**
 * Rename node `nodeId` to `newLabel`. This is a CORRECTION, not an alias: the
 * node's identity key changes to the new spelling. If a same-type node already
 * carries the new key, the two are the same entity under different spellings —
 * fold this one into it (repoint edges, drop the loser). Otherwise relabel in
 * place (edges reference the id, which is unchanged).
 *
 * Idempotent-ish: renaming to the current label/key is a no-op.
 */
export function renameNode(
  store: KnowledgeGraphStore,
  nodeId: string,
  newLabel: string
): RenameNodeResult {
  const db = store.db
  const label = (newLabel || '').trim()
  if (!label) return { outcome: 'noop', nodeId }

  const node = db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE id = ?', [nodeId])
  if (!node) return { outcome: 'noop', nodeId: null }

  const newKey = normalizeLabel(label)
  if (newKey === node.norm_key) {
    // Same identity — refresh the display label only (e.g. casing), never merge.
    if (label !== node.label) {
      db.run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [
        label,
        new Date().toISOString(),
        node.id,
      ])
    }
    return { outcome: 'noop', nodeId: node.id }
  }

  const keeper = db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE type = ? AND norm_key = ?', [
    node.type,
    newKey,
  ])
  const now = new Date().toISOString()

  if (!keeper) {
    db.run('UPDATE graph_nodes SET label = ?, norm_key = ?, updated_at = ? WHERE id = ?', [
      label,
      newKey,
      now,
      node.id,
    ])
    return { outcome: 'renamed', nodeId: node.id }
  }

  if (keeper.id === node.id) return { outcome: 'noop', nodeId: node.id }

  mergeNodes(store, keeper.id, node.id)
  return { outcome: 'merged', nodeId: keeper.id }
}

// ---------------------------------------------------------------------------
// Merge two nodes (fold loser → keeper)
// ---------------------------------------------------------------------------

export interface MergeNodesResult {
  keeperId: string
  /** Edges that pointed at the loser before the merge (its full blast radius). */
  movedEdges: number
  merged: boolean
}

/**
 * Move every `graph_edge_sources` row from `fromEdgeId` onto `toEdgeId`,
 * summing `assertion_count` when the keeper edge already has a row for the
 * same (recording, transcript) — then delete the now-empty source rows under
 * `fromEdgeId`. Used only for a COLLIDING repoint (AR2-1): the non-colliding
 * case needs no transfer because `UPDATE OR IGNORE` preserves the edge's id,
 * so its existing `graph_edge_sources` rows stay correctly attributed as-is.
 */
function transferEdgeSources(db: GraphDb, fromEdgeId: string, toEdgeId: string): void {
  db.run(
    `INSERT INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at)
     SELECT ?, recording_id, transcript_id, assertion_count, created_at
       FROM graph_edge_sources WHERE edge_id = ?
     ON CONFLICT(edge_id, recording_id, transcript_id)
     DO UPDATE SET assertion_count = assertion_count + excluded.assertion_count`,
    [toEdgeId, fromEdgeId]
  )
  db.run('DELETE FROM graph_edge_sources WHERE edge_id = ?', [fromEdgeId])
}

/**
 * Before the repoint runs, find every edge incident to the loser that WOULD
 * collide with an edge the keeper already has (same (source,target,type)
 * after repoint) — those are the edges `UPDATE OR IGNORE` silently drops
 * (the subsequent unconditional DELETE then removes the loser's still-present
 * row). For each such collision, fold the dropped edge's weight into the
 * surviving keeper edge and transfer its `graph_edge_sources` rows (AR2-1)
 * BEFORE the repoint/delete executes, so per-recording attribution is never
 * silently lost at a merge. Edges that would become a keeper→keeper self-loop
 * are skipped here (they are deleted outright by the merge's final self-loop
 * cleanup, not kept by anyone, so there is no keeper edge to transfer onto).
 */
function transferCollidingEdgeProvenance(db: GraphDb, keeperId: string, loserId: string): void {
  interface EdgeRow {
    id: string
    source_id: string
    target_id: string
    type: string
    weight: number
  }

  const asSource = db.queryAll<EdgeRow>('SELECT * FROM graph_edges WHERE source_id = ?', [loserId])
  for (const e of asSource) {
    if (e.target_id === keeperId) continue
    const collision = db.queryOne<{ id: string; weight: number }>(
      'SELECT id, weight FROM graph_edges WHERE source_id = ? AND target_id = ? AND type = ?',
      [keeperId, e.target_id, e.type]
    )
    if (!collision) continue
    transferEdgeSources(db, e.id, collision.id)
    db.run('UPDATE graph_edges SET weight = ? WHERE id = ?', [collision.weight + e.weight, collision.id])
  }

  const asTarget = db.queryAll<EdgeRow>('SELECT * FROM graph_edges WHERE target_id = ?', [loserId])
  for (const e of asTarget) {
    if (e.source_id === keeperId) continue
    const collision = db.queryOne<{ id: string; weight: number }>(
      'SELECT id, weight FROM graph_edges WHERE source_id = ? AND target_id = ? AND type = ?',
      [e.source_id, keeperId, e.type]
    )
    if (!collision) continue
    transferEdgeSources(db, e.id, collision.id)
    db.run('UPDATE graph_edges SET weight = ? WHERE id = ?', [collision.weight + e.weight, collision.id])
  }
}

/**
 * Fold `loserId` into `keeperId`: repoint every edge that touched the loser onto
 * the keeper, then delete the loser node. UNIQUE(source,target,type) collisions
 * are dropped (the keeper already had that relation), so a repointed edge that
 * would duplicate an existing one is discarded rather than erroring — but its
 * per-recording provenance (graph_edge_sources) and weight are folded into the
 * surviving keeper edge first (AR2-1), so a later recording-scoped cleanup
 * still sees the merged history correctly.
 */
export function mergeNodes(
  store: KnowledgeGraphStore,
  keeperId: string,
  loserId: string
): MergeNodesResult {
  const db = store.db
  if (keeperId === loserId) return { keeperId, movedEdges: 0, merged: false }

  const keeper = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE id = ?', [keeperId])
  const loser = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE id = ?', [loserId])
  if (!keeper || !loser) return { keeperId, movedEdges: 0, merged: false }

  const before = db.queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM graph_edges WHERE source_id = ? OR target_id = ?',
    [loserId, loserId]
  )
  const movedEdges = before?.c ?? 0

  // ADV52-1 (round-54): the whole mutation below — provenance + weight transfer,
  // edge repoints, cleanup deletes, and the loser-node delete — is ONE atomic
  // transaction. A partial failure (e.g. a repoint or delete throws AFTER
  // transferCollidingEdgeProvenance has already moved graph_edge_sources rows
  // onto the keeper) would otherwise leave the loser edge present with its
  // provenance gone, or the keeper with duplicated attribution/weight — either
  // way a later recording-scoped deletion retains OR removes the WRONG facts and
  // corrupts F18 honest-deletion topology. runInGraphTransaction rolls back
  // graph_nodes, graph_edges, and graph_edge_sources together on any error and
  // rethrows, so both the interactive merge and the automatic rekey path see the
  // failure with the graph fully restored to its pre-merge state.
  runInGraphTransaction(db, () => {
    // AR2-1: transfer provenance + weight for every edge the repoint below is
    // about to drop, BEFORE it runs.
    transferCollidingEdgeProvenance(db, keeperId, loserId)

    // Every edge delete goes through deleteEdgesCleanly (CX-T4-3) so the edge's
    // graph_edge_sources rows die with it — never left to be inherited by a
    // later re-created edge under the same deterministic id. The two leftover
    // deletes remove only COLLIDING edges (whose rows the transfer above
    // already moved — the cascade is a no-op there, kept for uniformity); the
    // self-loop delete is the live case: a loser→keeper edge repointed into a
    // keeper→keeper self-loop keeps its id (and rows) through the UPDATE, and
    // is destroyed here WITH its rows.
    db.run('UPDATE OR IGNORE graph_edges SET source_id = ? WHERE source_id = ?', [keeperId, loserId])
    deleteEdgesCleanly(db, 'source_id = ?', [loserId])
    db.run('UPDATE OR IGNORE graph_edges SET target_id = ? WHERE target_id = ?', [keeperId, loserId])
    deleteEdgesCleanly(db, 'target_id = ?', [loserId])
    // A self-loop (keeper→keeper) can form when loser and keeper were connected.
    deleteEdgesCleanly(db, 'source_id = target_id')
    db.run('DELETE FROM graph_nodes WHERE id = ?', [loserId])
  })

  return { keeperId, movedEdges, merged: true }
}

// ---------------------------------------------------------------------------
// Merge blast radius (preview before committing)
// ---------------------------------------------------------------------------

export interface NodeBlast {
  id: string
  label: string
  type: string
  edges: number
}

export interface MergeBlastRadius {
  a: NodeBlast | null
  b: NodeBlast | null
  /** Relations both nodes share (would collapse to one on merge). */
  shared: number
  /** Distinct edges after the merge. */
  resulting: number
}

function edgeKeys(store: KnowledgeGraphStore, nodeId: string): Set<string> {
  const rows = store.db.queryAll<{ source_id: string; target_id: string; type: string }>(
    'SELECT source_id, target_id, type FROM graph_edges WHERE source_id = ? OR target_id = ?',
    [nodeId, nodeId]
  )
  const keys = new Set<string>()
  for (const r of rows) {
    // Normalize each edge to "the OTHER endpoint + relation", direction-preserving,
    // so a shared relation to the same neighbor collapses on merge.
    if (r.source_id === nodeId) keys.add(`out:${r.type}:${r.target_id}`)
    if (r.target_id === nodeId) keys.add(`in:${r.type}:${r.source_id}`)
  }
  return keys
}

/** Preview a merge of two nodes: each side's edge count, the overlap, and the
 *  resulting edge count — so the UI can show WHAT gets merged before committing. */
export function mergeBlastRadius(
  store: KnowledgeGraphStore,
  aId: string,
  bId: string
): MergeBlastRadius {
  const db = store.db
  const a = db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE id = ?', [aId])
  const b = db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE id = ?', [bId])
  const toBlast = (n: GraphNode | undefined, keys: Set<string>): NodeBlast | null =>
    n ? { id: n.id, label: n.label, type: n.type, edges: keys.size } : null

  const aKeys = a ? edgeKeys(store, aId) : new Set<string>()
  const bKeys = b ? edgeKeys(store, bId) : new Set<string>()

  // Keys are neighbor-relative ("dir:type:otherId"), so a relation to the SAME
  // third-party neighbor collapses in the union automatically. `shared` counts how
  // many such relations overlap (informational). The a↔b relations become
  // self-loops on merge and are dropped, so subtract them from the resulting count.
  let shared = 0
  const union = new Set<string>(aKeys)
  for (const k of bKeys) {
    if (aKeys.has(k)) shared++
    union.add(k)
  }
  let selfLoops = 0
  for (const k of union) if (k.endsWith(`:${aId}`) || k.endsWith(`:${bId}`)) selfLoops++

  const resulting = Math.max(0, union.size - selfLoops)

  return { a: toBlast(a, aKeys), b: toBlast(b, bKeys), shared, resulting }
}

// ---------------------------------------------------------------------------
// Delete (remove) a node
// ---------------------------------------------------------------------------

export interface DeleteNodeResult {
  removed: boolean
  removedEdges: number
}

/** Remove a node and every edge touching it (with the edges' provenance rows —
 *  CX-T4-3). Idempotent (a missing node is a no-op). */
export function deleteNode(store: KnowledgeGraphStore, nodeId: string): DeleteNodeResult {
  const db = store.db
  const node = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE id = ?', [nodeId])
  if (!node) return { removed: false, removedEdges: 0 }

  const counted = db.queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM graph_edges WHERE source_id = ? OR target_id = ?',
    [nodeId, nodeId]
  )
  const removedEdges = counted?.c ?? 0
  deleteEdgesCleanly(db, 'source_id = ? OR target_id = ?', [nodeId, nodeId])
  db.run('DELETE FROM graph_nodes WHERE id = ?', [nodeId])
  return { removed: true, removedEdges }
}

// ---------------------------------------------------------------------------
// Merge / patch a node's props
// ---------------------------------------------------------------------------

/** Shallow-merge `patch` into a node's props JSON. A null value deletes the key. */
export function setNodeProps(
  store: KnowledgeGraphStore,
  nodeId: string,
  patch: Record<string, unknown>
): boolean {
  const db = store.db
  const node = db.queryOne<{ props: string | null }>('SELECT props FROM graph_nodes WHERE id = ?', [
    nodeId,
  ])
  if (!node) return false
  let props: Record<string, unknown> = {}
  if (node.props) {
    try {
      props = JSON.parse(node.props) as Record<string, unknown>
    } catch {
      props = {}
    }
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete props[k]
    else props[k] = v
  }
  db.run('UPDATE graph_nodes SET props = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(props),
    new Date().toISOString(),
    nodeId,
  ])
  return true
}

// ---------------------------------------------------------------------------
// Per-node graph stats (discoverability)
// ---------------------------------------------------------------------------

export interface NodeGraphStats {
  /** Distinct meetings this node touches (its evidence). */
  meetingCount: number
  /** Earliest / latest evidence date (epoch ms) among touched meetings, or null. */
  firstSeenMs: number | null
  lastSeenMs: number | null
  /** Distinct people / projects in the immediate neighborhood. */
  peopleCount: number
  projectCount: number
  /** Total incident edges. */
  degree: number
}

/**
 * Graph-derived facts about a node's neighborhood — what a bare label CANNOT show:
 * how many meetings it appears in, when it was first/last seen, and how many
 * people/projects sit next to it. Powers the node inspector's "what this is".
 */
export function nodeGraphStats(store: KnowledgeGraphStore, nodeId: string): NodeGraphStats {
  const empty: NodeGraphStats = {
    meetingCount: 0,
    firstSeenMs: null,
    lastSeenMs: null,
    peopleCount: 0,
    projectCount: 0,
    degree: 0,
  }
  const sub = neighborhood(store, nodeId, 1)
  if (!sub.center) return empty

  let meetingCount = 0
  let peopleCount = 0
  let projectCount = 0
  let firstSeenMs: number | null = null
  let lastSeenMs: number | null = null
  let degree = 0

  for (const n of sub.nodes) {
    if (n.id === sub.center.id) {
      degree = n.degree
      continue
    }
    if (n.type === 'meeting') {
      meetingCount++
      const d = ownDateMs(n)
      if (d != null) {
        if (firstSeenMs == null || d < firstSeenMs) firstSeenMs = d
        if (lastSeenMs == null || d > lastSeenMs) lastSeenMs = d
      }
    } else if (n.type === 'person') {
      peopleCount++
    } else if (n.type === 'project') {
      projectCount++
    }
  }

  return { meetingCount, firstSeenMs, lastSeenMs, peopleCount, projectCount, degree }
}
