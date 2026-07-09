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

// ===========================================================================
// Context lens — stratified, time-aware neighborhood + provenance
//
// The whole-graph force layout cannot show REASONING: it renders typed nodes as
// undifferentiated physics. A lens fixes that by (a) scoping to a perspective
// (one entity's neighborhood, or the recent whole graph) and (b) annotating every
// node with the two axes that carry meaning — a STRATUM (abstraction level) and a
// DATE (recency). The renderer lays nodes out in horizontal strata bands ordered
// by time; the structure itself then reads as reasoning, not soup.
// ===========================================================================

/**
 * Abstraction strata, top-down. The renderer stacks these as horizontal bands:
 * strategy at the top, the evidence it rests on at the bottom.
 */
export type Stratum = 'strategic' | 'operational' | 'people' | 'evidence'

/** Bands in top-to-bottom render order. */
export const STRATA: readonly Stratum[] = ['strategic', 'operational', 'people', 'evidence'] as const

/**
 * Which stratum each node type belongs to. Every {@link NodeType} is covered:
 * decisions/risks are the reasoning layer; projects/actions/next steps/topics are
 * the work; people are the actors; meetings are the evidence everything derives
 * from. Skills sit with people (competencies), topics with the work.
 */
export const STRATUM_OF: Record<string, Stratum> = {
  decision: 'strategic',
  risk: 'strategic',
  project: 'operational',
  action_item: 'operational',
  next_step: 'operational',
  topic: 'operational',
  person: 'people',
  skill: 'people',
  meeting: 'evidence',
}

/** The stratum for a node type — unknown types fall to the work band. */
export function stratumOf(type: string): Stratum {
  return STRATUM_OF[type] ?? 'operational'
}

/** A day in milliseconds — the unit for lens time windows. */
export const DAY_MS = 86_400_000

/**
 * Parse a node's own date signal to epoch ms, or null. Meetings carry
 * `props.date` (the recording date); every node carries `created_at`. Returns
 * null when neither parses — callers then derive a date from linked evidence.
 */
export function ownDateMs(node: GraphNode): number | null {
  const props = node.props ? safeParse(node.props) : {}
  const raw = (typeof props.date === 'string' && props.date) || node.created_at || ''
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : t
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** A lens node: a graph node annotated with its stratum and effective date. */
export interface LensNode extends GraphNodeWithDegree {
  stratum: Stratum
  /**
   * Effective recency (epoch ms) or null. A meeting uses its own date; any other
   * node inherits the newest date among the meetings it touches in this lens,
   * falling back to its own `created_at`. This is what the renderer orders x by.
   */
  dateMs: number | null
}

export interface LensGraph {
  /** The seed entity the lens is centered on (undefined for a whole-graph lens). */
  center: GraphNode | undefined
  nodes: LensNode[]
  edges: GraphEdgeLite[]
  /**
   * The most recent activity across the lens (epoch ms) — the reference "now"
   * that time-window chips (7d/30d/90d) are measured back from. Anchoring to the
   * newest activity (not the wall clock) keeps a "last 30 days" lens meaningful
   * for historical data instead of silently empty.
   */
  referenceMs: number | null
}

export interface LensOptions {
  /** Hops to expand a centered lens (default 2 — reaches evidence→work→strategy). */
  hops?: number
  /** Node cap for a whole-graph lens (centerId null). Ignored when centered. */
  cap?: number
  /**
   * Keep only nodes whose effective date is within this many days of the lens's
   * newest activity (undated nodes and the center are always kept). null/undefined
   * = no time filter (the "All" chip).
   */
  windowDays?: number | null
}

/** Assign each subgraph node a stratum + an effective date derived from evidence. */
function annotateLens(sub: SubGraph): LensNode[] {
  // Map every meeting node to its date up front.
  const meetingDate = new Map<string, number | null>()
  for (const n of sub.nodes) {
    if (n.type === 'meeting') meetingDate.set(n.id, ownDateMs(n))
  }

  // Undirected adjacency within the subgraph.
  const adj = new Map<string, Set<string>>()
  for (const e of sub.edges) {
    if (!adj.has(e.source_id)) adj.set(e.source_id, new Set())
    if (!adj.has(e.target_id)) adj.set(e.target_id, new Set())
    adj.get(e.source_id)!.add(e.target_id)
    adj.get(e.target_id)!.add(e.source_id)
  }

  return sub.nodes.map((n) => {
    let dateMs: number | null
    if (n.type === 'meeting') {
      dateMs = meetingDate.get(n.id) ?? ownDateMs(n)
    } else {
      // Newest date among adjacent meetings (the evidence this node emerged from).
      let best: number | null = null
      for (const nbr of adj.get(n.id) ?? []) {
        const md = meetingDate.get(nbr)
        if (md != null && (best == null || md > best)) best = md
      }
      dateMs = best ?? ownDateMs(n)
    }
    return { ...n, stratum: stratumOf(n.type), dateMs }
  })
}

/**
 * Build a stratified, time-aware lens. When `centerId` is given, the lens is that
 * node's neighborhood; when null, it's the top-degree slice of the whole graph.
 * Nodes are annotated with stratum + effective date, and optionally filtered to a
 * recent time window (measured back from the newest activity in the lens).
 */
export function lensGraph(
  store: KnowledgeGraphStore,
  centerId: string | null,
  opts: LensOptions = {}
): LensGraph {
  const hops = opts.hops ?? 2
  const sub = centerId
    ? neighborhood(store, centerId, hops)
    : fullGraph(store, opts.cap ?? 200)

  let nodes = annotateLens(sub)

  // Reference "now" = newest activity in the lens.
  let referenceMs: number | null = null
  for (const n of nodes) {
    if (n.dateMs != null && (referenceMs == null || n.dateMs > referenceMs)) referenceMs = n.dateMs
  }

  // Time-window filter: drop dated nodes older than the window; always keep the
  // center and undated nodes.
  const windowDays = opts.windowDays
  if (windowDays != null && windowDays > 0 && referenceMs != null) {
    const cutoff = referenceMs - windowDays * DAY_MS
    const centerNodeId = sub.center?.id ?? null
    nodes = nodes.filter(
      (n) => n.id === centerNodeId || n.dateMs == null || n.dateMs >= cutoff
    )
  }

  const kept = new Set(nodes.map((n) => n.id))
  const edges = sub.edges.filter((e) => kept.has(e.source_id) && kept.has(e.target_id))

  return { center: sub.center, nodes, edges, referenceMs }
}

/**
 * Choose the default lens center: the graph node for the app owner when known
 * (a person keyed by `contact:<ownerContactId>`), otherwise the highest-degree
 * person — the natural ego of the user's own context. Returns undefined when the
 * graph has no people yet.
 */
export function pickDefaultCenter(
  store: KnowledgeGraphStore,
  ownerContactId?: string | null
): GraphNode | undefined {
  if (ownerContactId) {
    const key = `contact:${ownerContactId}`.toLowerCase().trim()
    const owner = store.db.queryOne<GraphNode>(
      "SELECT * FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
      [key]
    )
    if (owner) return owner
  }
  const degrees = degreeMap(store)
  const persons = store.db.queryAll<GraphNode>("SELECT * FROM graph_nodes WHERE type = 'person'")
  let best: GraphNode | undefined
  let bestDeg = -1
  for (const p of persons) {
    const d = degrees.get(p.id) ?? 0
    // Deterministic tie-break: higher degree, then lexicographically smaller id.
    if (d > bestDeg || (d === bestDeg && best && p.id < best.id)) {
      bestDeg = d
      best = p
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Provenance — the "why" behind a decision / risk / action
// ---------------------------------------------------------------------------

export interface ProvenanceEntity {
  id: string
  type: string
  label: string
  dateMs: number | null
}

export interface Provenance {
  /** The node whose provenance this is (null when the id is unknown). */
  node: ProvenanceEntity | null
  /** The meeting(s) this node emerged from — the evidence. */
  meetings: ProvenanceEntity[]
  /** People present / responsible. */
  people: ProvenanceEntity[]
  /** Project(s) it belongs to. */
  projects: ProvenanceEntity[]
  /** Downstream actions it led to (for decisions/risks). */
  actions: ProvenanceEntity[]
  /** Every node on the evidence path (incl. the node itself) — the highlight set. */
  pathIds: string[]
  /** One-line human narrative, e.g. `Decided in "Kickoff" · 2026-06-01 · with Alice`. */
  narrative: string
  /** The primary date of the evidence path. */
  dateMs: number | null
}

/** Format an epoch-ms date as YYYY-MM-DD (UTC), or '' when null. Deterministic. */
export function formatDateMs(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function joinNames(entities: ProvenanceEntity[], max = 3): string {
  const names = entities.slice(0, max).map((e) => e.label)
  const extra = entities.length - names.length
  const base = names.join(', ')
  return extra > 0 ? `${base} +${extra}` : base
}

/**
 * Derive the evidence path for a node: the meeting(s) it emerged from, the people
 * present, the project it belongs to, and the actions it led to — plus a one-line
 * narrative. Powers the provenance trail (highlight + side panel) in the UI.
 */
export function provenance(store: KnowledgeGraphStore, nodeId: string): Provenance {
  const empty: Provenance = {
    node: null,
    meetings: [],
    people: [],
    projects: [],
    actions: [],
    pathIds: [],
    narrative: '',
    dateMs: null,
  }
  const centerNode = store.db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE id = ?', [nodeId])
  if (!centerNode) return empty

  const sub = neighborhood(store, nodeId, 2)
  const dateFor = new Map<string, number | null>()
  for (const n of sub.nodes) {
    if (n.type === 'meeting') dateFor.set(n.id, ownDateMs(n))
  }

  const asEntity = (n: GraphNode): ProvenanceEntity => ({
    id: n.id,
    type: n.type,
    label: n.label,
    dateMs: n.type === 'meeting' ? (dateFor.get(n.id) ?? ownDateMs(n)) : ownDateMs(n),
  })

  const meetings: ProvenanceEntity[] = []
  const people: ProvenanceEntity[] = []
  const projects: ProvenanceEntity[] = []
  const actions: ProvenanceEntity[] = []
  for (const n of sub.nodes) {
    if (n.id === centerNode.id) continue
    if (n.type === 'meeting') meetings.push(asEntity(n))
    else if (n.type === 'person') people.push(asEntity(n))
    else if (n.type === 'project') projects.push(asEntity(n))
    else if (n.type === 'action_item' || n.type === 'next_step') actions.push(asEntity(n))
  }

  // Newest meeting is the primary evidence.
  meetings.sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0))
  const primaryMeeting = meetings[0]
  const dateMs = primaryMeeting?.dateMs ?? ownDateMs(centerNode)
  const dateStr = formatDateMs(dateMs)

  const mtg = primaryMeeting ? `"${primaryMeeting.label}"` : ''
  const names = joinNames(people)
  let narrative: string
  switch (centerNode.type) {
    case 'decision': {
      const parts = [`Decided${mtg ? ` in ${mtg}` : ''}`]
      if (dateStr) parts.push(dateStr)
      if (names) parts.push(`with ${names}`)
      narrative = parts.join(' · ')
      if (actions.length > 0) narrative += ` → led to ${actions.length} action${actions.length === 1 ? '' : 's'}`
      break
    }
    case 'risk': {
      const parts = [`Raised${names ? ` by ${names}` : ''}`]
      if (mtg) parts.push(`in ${mtg}`)
      if (dateStr) parts.push(dateStr)
      narrative = parts.join(' · ')
      break
    }
    case 'action_item':
    case 'next_step': {
      const parts = [mtg ? `From ${mtg}` : 'Action']
      if (dateStr) parts.push(dateStr)
      if (names) parts.push(`owned by ${names}`)
      narrative = parts.join(' · ')
      break
    }
    case 'meeting': {
      const parts = ['Meeting']
      if (dateStr) parts.push(dateStr)
      if (people.length) parts.push(`${people.length} ${people.length === 1 ? 'person' : 'people'}`)
      if (projects.length) parts.push(joinNames(projects))
      narrative = parts.join(' · ')
      break
    }
    default: {
      const parts = [centerNode.label]
      if (dateStr) parts.push(dateStr)
      if (meetings.length) parts.push(`${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`)
      narrative = parts.join(' · ')
    }
  }

  const pathIds = [
    centerNode.id,
    ...meetings.map((m) => m.id),
    ...people.map((p) => p.id),
    ...projects.map((p) => p.id),
    ...actions.map((a) => a.id),
  ]

  return {
    node: asEntity(centerNode),
    meetings,
    people,
    projects,
    actions,
    pathIds: [...new Set(pathIds)],
    narrative,
    dateMs,
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
