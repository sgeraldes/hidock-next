import type { KnowledgeGraphStore, GraphNode } from './graph-store.js'
import { isGenericEntityLabel } from './stop-list.js'

/**
 * Default node cap for the OVERVIEW render. The graph can hold tens of thousands
 * of nodes; rendering them all is an unreadable hairball. The overview shows only
 * the top-N highest-degree hubs (see {@link fullGraph}) — a digestible entry
 * point. Deeper exploration happens via search + click-to-focus, or an explicit
 * "show more" that raises this cap.
 */
export const DEFAULT_OVERVIEW_NODE_LIMIT = 150

export interface AttendeeResult {
  person: string
  personId: string
  meetings: number
}

export interface SkillDemonstratorResult {
  person: string
  personId: string
  weight: number
}

export interface PersonProfile {
  personId: string
  personLabel: string
  meetings: GraphNode[]
  skills: GraphNode[]
  actionItems: GraphNode[]
}

export interface MeetingGraph {
  meeting: GraphNode | undefined
  nodes: GraphNode[]
  edges: Array<{ id: string; source_id: string; target_id: string; type: string; weight: number }>
}

export interface GraphEdgeLite {
  id: string
  source_id: string
  target_id: string
  type: string
  weight: number
}

/** A node with its total (undirected) degree — how many edges touch it. */
export interface GraphNodeWithDegree extends GraphNode {
  degree: number
}

export interface SubGraph {
  /** The seed node the neighborhood was expanded from (undefined if not found). */
  center: GraphNode | undefined
  nodes: GraphNodeWithDegree[]
  edges: GraphEdgeLite[]
}

/** Global edge-degree map: node id → number of incident edges (both directions). */
function degreeMap(store: KnowledgeGraphStore): Map<string, number> {
  const rows = store.db.queryAll<{ node_id: string; c: number }>(
    `SELECT node_id, COUNT(*) AS c FROM (
       SELECT source_id AS node_id FROM graph_edges
       UNION ALL
       SELECT target_id AS node_id FROM graph_edges
     ) GROUP BY node_id`
  )
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.node_id, r.c)
  return m
}

/**
 * The full graph: every node (annotated with its global degree) and every edge.
 * `limit` caps the node count, keeping the highest-degree nodes (the hubs) plus
 * every edge that connects two kept nodes — enough for an overview render.
 */
export function fullGraph(store: KnowledgeGraphStore, limit?: number): SubGraph {
  const degrees = degreeMap(store)
  const allNodes = store.db
    .queryAll<GraphNode>('SELECT * FROM graph_nodes')
    .map((n) => ({ ...n, degree: degrees.get(n.id) ?? 0 }))

  let nodes = allNodes
  if (limit != null && allNodes.length > limit) {
    nodes = [...allNodes].sort((a, b) => b.degree - a.degree).slice(0, limit)
  }
  const kept = new Set(nodes.map((n) => n.id))

  const edges = store.db
    .queryAll<GraphEdgeLite>('SELECT id, source_id, target_id, type, weight FROM graph_edges')
    .filter((e) => kept.has(e.source_id) && kept.has(e.target_id))

  return { center: undefined, nodes, edges }
}

export interface PruneResult {
  removedNodes: number
  removedEdges: number
}

/**
 * One-time maintenance: delete already-ingested "garbage" person nodes whose
 * label is a generic collective/role word (see {@link isGenericEntityLabel}),
 * along with every edge touching them. Complements the ingest-time stop-list,
 * cleaning the live graph without a full re-ingest.
 *
 * Conservative (person nodes only, curated multilingual predicate) and
 * IDEMPOTENT — a second run removes nothing.
 */
export function pruneGenericNodes(store: KnowledgeGraphStore): PruneResult {
  const persons = store.db.queryAll<{ id: string; label: string }>(
    "SELECT id, label FROM graph_nodes WHERE type = 'person'"
  )

  let removedNodes = 0
  let removedEdges = 0

  for (const p of persons) {
    if (!isGenericEntityLabel(p.label)) continue
    const counted = store.db.queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM graph_edges WHERE source_id = ? OR target_id = ?',
      [p.id, p.id]
    )
    removedEdges += counted?.c ?? 0
    store.db.run('DELETE FROM graph_edges WHERE source_id = ? OR target_id = ?', [p.id, p.id])
    store.db.run('DELETE FROM graph_nodes WHERE id = ?', [p.id])
    removedNodes++
  }

  return { removedNodes, removedEdges }
}

/**
 * BFS neighborhood around a node id, expanding up to `hops` (default 1, clamped
 * 1–3). Returns the reachable nodes (with degree) and the edges among them.
 * The graph is treated as undirected for traversal.
 */
export function neighborhood(
  store: KnowledgeGraphStore,
  nodeId: string,
  hops = 1
): SubGraph {
  const center = store.db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE id = ?', [nodeId])
  if (!center) return { center: undefined, nodes: [], edges: [] }

  const maxHops = Math.max(1, Math.min(hops, 3))
  const reached = new Set<string>([nodeId])
  let frontier = [nodeId]

  for (let depth = 0; depth < maxHops && frontier.length > 0; depth++) {
    const placeholders = frontier.map(() => '?').join(',')
    const rows = store.db.queryAll<{ source_id: string; target_id: string }>(
      `SELECT source_id, target_id FROM graph_edges
       WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
      [...frontier, ...frontier]
    )
    const next: string[] = []
    for (const r of rows) {
      for (const nid of [r.source_id, r.target_id]) {
        if (!reached.has(nid)) {
          reached.add(nid)
          next.push(nid)
        }
      }
    }
    frontier = next
  }

  const ids = [...reached]
  const degrees = degreeMap(store)
  const nodes: GraphNodeWithDegree[] = []
  for (const id of ids) {
    const node = store.db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE id = ?', [id])
    if (node) nodes.push({ ...node, degree: degrees.get(node.id) ?? 0 })
  }

  const kept = new Set(ids)
  const edges = store.db
    .queryAll<GraphEdgeLite>('SELECT id, source_id, target_id, type, weight FROM graph_edges')
    .filter((e) => kept.has(e.source_id) && kept.has(e.target_id))

  return { center, nodes, edges }
}

/**
 * People who ATTENDED meetings ABOUT a given topic or project (by label, fuzzy match),
 * ranked by number of meetings attended.
 */
export function topAttendeesForProjectOrTopic(
  store: KnowledgeGraphStore,
  name: string
): AttendeeResult[] {
  const normName = name.toLowerCase().trim()

  const rows = store.db.queryAll<{ person_id: string; person_label: string; meeting_count: number }>(`
    SELECT p.id AS person_id, p.label AS person_label, COUNT(DISTINCT m.id) AS meeting_count
    FROM graph_nodes p
    JOIN graph_edges ea ON ea.source_id = p.id AND ea.type = 'ATTENDED'
    JOIN graph_nodes m  ON m.id = ea.target_id AND m.type = 'meeting'
    JOIN graph_edges ab ON ab.source_id = m.id AND ab.type = 'ABOUT'
    JOIN graph_nodes t  ON t.id = ab.target_id AND (t.type = 'topic' OR t.type = 'project')
    WHERE p.type = 'person'
      AND LOWER(t.norm_key) LIKE ?
    GROUP BY p.id, p.label
    ORDER BY meeting_count DESC
  `, [`%${normName}%`])

  return rows.map((r) => ({
    person: r.person_label,
    personId: r.person_id,
    meetings: r.meeting_count,
  }))
}

/**
 * People with DEMONSTRATED edges to a skill (fuzzy match on skill label),
 * ranked by total weight (number of demonstrations).
 */
export function topSkillDemonstrators(
  store: KnowledgeGraphStore,
  skill: string
): SkillDemonstratorResult[] {
  const normSkill = skill.toLowerCase().trim()

  const rows = store.db.queryAll<{ person_id: string; person_label: string; total_weight: number }>(`
    SELECT p.id AS person_id, p.label AS person_label, SUM(e.weight) AS total_weight
    FROM graph_nodes p
    JOIN graph_edges e ON e.source_id = p.id AND e.type = 'DEMONSTRATED'
    JOIN graph_nodes s ON s.id = e.target_id AND s.type = 'skill'
    WHERE p.type = 'person'
      AND LOWER(s.norm_key) LIKE ?
    GROUP BY p.id, p.label
    ORDER BY total_weight DESC
  `, [`%${normSkill}%`])

  return rows.map((r) => ({
    person: r.person_label,
    personId: r.person_id,
    weight: r.total_weight,
  }))
}

/**
 * Full profile for a person by name (fuzzy match).
 */
export function personProfile(store: KnowledgeGraphStore, personName: string): PersonProfile | undefined {
  const normName = personName.toLowerCase().trim()
  // Match on label as well as norm_key: contact-keyed person nodes carry
  // `contact:<id>` as their norm_key, so a name search must fall back to label.
  const personNode = store.db.queryOne<GraphNode>(
    `SELECT * FROM graph_nodes WHERE type = 'person' AND (norm_key LIKE ? OR LOWER(label) LIKE ?)`,
    [`%${normName}%`, `%${normName}%`]
  )
  if (!personNode) return undefined

  const meetings = store.db.queryAll<GraphNode>(`
    SELECT n.* FROM graph_nodes n
    JOIN graph_edges e ON e.target_id = n.id AND e.type = 'ATTENDED'
    WHERE e.source_id = ?
  `, [personNode.id])

  const skills = store.db.queryAll<GraphNode>(`
    SELECT n.* FROM graph_nodes n
    JOIN graph_edges e ON e.target_id = n.id AND e.type = 'DEMONSTRATED'
    WHERE e.source_id = ?
  `, [personNode.id])

  const actionItems = store.db.queryAll<GraphNode>(`
    SELECT n.* FROM graph_nodes n
    JOIN graph_edges e ON e.target_id = n.id AND e.type = 'OWNS'
    WHERE e.source_id = ?
  `, [personNode.id])

  return {
    personId: personNode.id,
    personLabel: personNode.label,
    meetings,
    skills,
    actionItems,
  }
}

/**
 * All nodes and edges related to a specific meeting.
 * meetingId can be either the graph node id (type:slug) or the props.meetingId value.
 */
export function meetingSummaryGraph(store: KnowledgeGraphStore, meetingId: string): MeetingGraph {
  const meeting = store.db.queryOne<GraphNode>(
    `SELECT * FROM graph_nodes WHERE id = ? OR (type = 'meeting' AND JSON_EXTRACT(props, '$.meetingId') = ?)`,
    [meetingId, meetingId]
  )
  if (!meeting) return { meeting: undefined, nodes: [], edges: [] }

  type EdgeRow = { id: string; source_id: string; target_id: string; type: string; weight: number }
  const edges = store.db.queryAll<EdgeRow>(
    `SELECT * FROM graph_edges WHERE source_id = ? OR target_id = ?`,
    [meeting.id, meeting.id]
  )

  const nodeIds = new Set<string>([meeting.id])
  for (const e of edges) {
    nodeIds.add(e.source_id)
    nodeIds.add(e.target_id)
  }

  const nodes: GraphNode[] = []
  for (const nid of nodeIds) {
    const node = store.db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE id = ?', [nid])
    if (node) nodes.push(node)
  }

  return { meeting, nodes, edges }
}
