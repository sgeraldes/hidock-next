import type { KnowledgeGraphStore, GraphNode } from './graph-store.js'

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
  const personNode = store.db.queryOne<GraphNode>(
    `SELECT * FROM graph_nodes WHERE type = 'person' AND norm_key LIKE ?`,
    [`%${normName}%`]
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
