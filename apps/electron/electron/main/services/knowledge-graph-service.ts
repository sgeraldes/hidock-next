/**
 * Knowledge Graph Service — wires @hidock/knowledge-graph into the Electron app.
 *
 * Provides:
 * - Singleton KnowledgeGraphStore backed by the app's SQLite database
 * - LlmExtractor that uses @hidock/ai-providers complete()
 * - Incremental ingestion from DB transcripts and from a folder of .txt/.md files
 * - Thin query wrappers for IPC handlers
 */

import { resolve, basename, extname } from 'path'
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import {
  KnowledgeGraphStore,
  extractGraphFromTranscript,
  ingestExtraction,
  topAttendeesForProjectOrTopic,
  topSkillDemonstrators,
  personProfile,
  meetingSummaryGraph,
  fullGraph,
  neighborhood,
  pruneGenericNodes,
  lensGraph,
  pickDefaultCenter,
  provenance,
  DEFAULT_OVERVIEW_NODE_LIMIT,
} from '@hidock/knowledge-graph'
import type {
  GraphDb,
  LlmExtractor,
  PersonResolver,
  AttendeeResult,
  SkillDemonstratorResult,
  PersonProfile,
  MeetingGraph,
  GraphNode,
  SubGraph,
  LensGraph,
  Provenance,
} from '@hidock/knowledge-graph'
import { complete } from '@hidock/ai-providers'
import type { ProviderConfig } from '@hidock/ai-providers'
import { getConfig } from './config'
import { run, queryAll, queryOne, getContactById } from './database'
import { resolveContact } from './entity-resolver'

// ---------------------------------------------------------------------------
// GraphDb adapter — bridges the app's database exports to the GraphDb interface
// ---------------------------------------------------------------------------

const graphDbAdapter: GraphDb = {
  run(sql: string, params?: unknown[]) {
    run(sql, (params ?? []) as any[])
  },
  queryAll<T>(sql: string, params?: unknown[]): T[] {
    return queryAll<T>(sql, (params ?? []) as any[])
  },
  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    return queryOne<T>(sql, (params ?? []) as any[])
  },
}

// ---------------------------------------------------------------------------
// Singleton store (lazy init on first use)
// ---------------------------------------------------------------------------

let _store: KnowledgeGraphStore | null = null

export function getKnowledgeGraphStore(): KnowledgeGraphStore {
  if (!_store) {
    _store = new KnowledgeGraphStore(graphDbAdapter)
  }
  // Always (re-)run schema init — idempotent (CREATE TABLE IF NOT EXISTS).
  // This ensures graph tables + tracking table exist even when the DB engine
  // has been re-initialized since the singleton was created (e.g., in tests).
  _store.initSchema()
  _ensureIngestTrackingTable()
  return _store
}

function _ensureIngestTrackingTable(): void {
  try {
    run(
      `CREATE TABLE IF NOT EXISTS graph_ingested_transcripts (
        transcript_id TEXT PRIMARY KEY,
        ingested_at TEXT NOT NULL
      )`
    )
  } catch (e) {
    console.warn('[KnowledgeGraph] Could not create graph_ingested_transcripts table:', e)
  }
}

// ---------------------------------------------------------------------------
// Provider config — reads from app config
// ---------------------------------------------------------------------------

function providerConfigFromSettings(): ProviderConfig | null {
  const cfg = getConfig()

  // Use gemini if api key is set
  if (cfg.chat.provider === 'gemini' && cfg.transcription.geminiApiKey) {
    return {
      provider: 'google',
      model: cfg.chat.geminiModel || 'gemini-3.5-flash',
      apiKey: cfg.transcription.geminiApiKey,
    }
  }

  // No valid provider configured
  return null
}

// ---------------------------------------------------------------------------
// Person identity resolution (R4c — key person nodes by contact id)
// ---------------------------------------------------------------------------

/** The confidence at/above which we key a person node by contact id (the
 *  resolver's auto-link line). Below it, the node stays name-keyed. */
const REKEY_CONFIDENCE = 0.8

/**
 * A PersonResolver for graph ingest: turns a raw name into a canonical contact
 * identity when the shared entity resolver is confident enough, using meeting
 * co-occurrence as context. Returns null (→ name-keyed node) otherwise.
 */
function makePersonResolver(meetingId?: string): PersonResolver {
  return (name: string) => {
    try {
      const r = resolveContact(name, meetingId ? { meetingId } : undefined)
      if (r.id && r.confidence >= REKEY_CONFIDENCE) {
        const contact = getContactById(r.id)
        return { id: r.id, label: contact?.name ?? name }
      }
    } catch (e) {
      console.warn('[KnowledgeGraph] person resolve failed:', e)
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Ingestion from DB transcripts
// ---------------------------------------------------------------------------

interface TranscriptRow {
  id: string
  full_text: string
  recording_id: string
  date_recorded: string | null
  meeting_id: string | null
  subject: string | null
}

export interface IngestResult {
  ingested: number
  skipped: number
  errors: Array<{ transcriptId: string; error: string }>
}

export async function ingestFromDbTranscripts(): Promise<IngestResult> {
  const providerConfig = providerConfigFromSettings()
  if (!providerConfig) {
    throw new Error('No AI provider configured. Please set a provider API key in Settings.')
  }

  const store = getKnowledgeGraphStore()
  const llm: LlmExtractor = (prompt: string) => complete(prompt, providerConfig)

  // Get all transcripts with recording + meeting meta
  const rows = queryAll<TranscriptRow>(`
    SELECT
      t.id,
      t.full_text,
      t.recording_id,
      r.date_recorded,
      r.meeting_id,
      m.subject
    FROM transcripts t
    JOIN recordings r ON r.id = t.recording_id
    LEFT JOIN meetings m ON m.id = r.meeting_id
  `)

  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] }

  for (const row of rows) {
    // Check if already ingested (incremental)
    const already = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [row.id]
    )
    if (already) {
      result.skipped++
      continue
    }

    try {
      const meta = {
        meetingId: row.meeting_id ?? row.recording_id,
        title: row.subject ?? undefined,
        date: row.date_recorded ?? undefined,
      }
      const extraction = await extractGraphFromTranscript(row.full_text, meta, llm)
      ingestExtraction(store, extraction, meta, {
        now: new Date().toISOString(),
        resolvePerson: makePersonResolver(row.meeting_id ?? undefined),
      })

      // Mark as ingested
      run(
        'INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
        [row.id, new Date().toISOString()]
      )
      result.ingested++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: row.id, error: msg })
      console.error(`[KnowledgeGraph] Failed to ingest transcript ${row.id}:`, e)
    }
  }

  // Bring any legacy name-keyed person nodes onto the contact-id identity.
  try {
    const rk = rekeyExistingPersonNodes()
    if (rk.rekeyed + rk.merged > 0) {
      console.log(`[KnowledgeGraph] Re-keyed ${rk.rekeyed} + merged ${rk.merged} person node(s) by contact id`)
    }
  } catch (e) {
    console.warn('[KnowledgeGraph] Person re-key pass failed (non-fatal):', e)
  }

  return result
}

// ---------------------------------------------------------------------------
// Ingestion from folder (text/markdown files)
// ---------------------------------------------------------------------------

export async function ingestFromFolder(folderPath: string): Promise<IngestResult> {
  // Security: validate path (no traversal)
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path')
  }

  const resolved = resolve(folderPath)

  // Reject paths that contain traversal segments
  if (folderPath.includes('..')) {
    throw new Error('Path traversal not allowed')
  }

  if (!existsSync(resolved)) {
    throw new Error(`Folder does not exist: ${resolved}`)
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`)
  }

  const providerConfig = providerConfigFromSettings()
  if (!providerConfig) {
    throw new Error('No AI provider configured. Please set a provider API key in Settings.')
  }

  const store = getKnowledgeGraphStore()
  const llm: LlmExtractor = (prompt: string) => complete(prompt, providerConfig)

  const files = readdirSync(resolved).filter((f) => {
    const ext = extname(f).toLowerCase()
    return ext === '.txt' || ext === '.md'
  })

  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] }

  for (const file of files) {
    const filePath = resolve(resolved, file)
    const transcriptId = `folder:${resolved}:${file}`

    // Incremental check
    const already = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [transcriptId]
    )
    if (already) {
      result.skipped++
      continue
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const nameWithoutExt = basename(file, extname(file))
      const meta = {
        meetingId: transcriptId,
        title: nameWithoutExt,
        date: undefined,
      }

      const extraction = await extractGraphFromTranscript(content, meta, llm)
      ingestExtraction(store, extraction, meta, {
        now: new Date().toISOString(),
        resolvePerson: makePersonResolver(),
      })

      run(
        'INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
        [transcriptId, new Date().toISOString()]
      )
      result.ingested++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: file, error: msg })
      console.error(`[KnowledgeGraph] Failed to ingest file ${file}:`, e)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Query wrappers
// ---------------------------------------------------------------------------

export function queryTopAttendees(name: string): AttendeeResult[] {
  const store = getKnowledgeGraphStore()
  return topAttendeesForProjectOrTopic(store, name)
}

export function queryTopSkill(skill: string): SkillDemonstratorResult[] {
  const store = getKnowledgeGraphStore()
  return topSkillDemonstrators(store, skill)
}

export function queryPersonProfile(name: string): PersonProfile | undefined {
  const store = getKnowledgeGraphStore()
  return personProfile(store, name)
}

export function queryMeetingGraph(meetingId: string): MeetingGraph {
  const store = getKnowledgeGraphStore()
  return meetingSummaryGraph(store, meetingId)
}

export function queryStats(): { nodes: number; edges: number; nodesByType: Record<string, number> } {
  const store = getKnowledgeGraphStore()
  const nodes = store.db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM graph_nodes')
  const edges = store.db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM graph_edges')
  const byType = store.db.queryAll<{ type: string; count: number }>(
    'SELECT type, COUNT(*) AS count FROM graph_nodes GROUP BY type'
  )
  const nodesByType: Record<string, number> = {}
  for (const row of byType) {
    nodesByType[row.type] = row.count
  }
  return {
    nodes: nodes[0]?.count ?? 0,
    edges: edges[0]?.count ?? 0,
    nodesByType,
  }
}

export function queryListNodes(type?: string): GraphNode[] {
  const store = getKnowledgeGraphStore()
  return store.findNodes(type ? { type: type as any } : {})
}

// ---------------------------------------------------------------------------
// R4c migration — re-key existing name-keyed person nodes by contact id
// ---------------------------------------------------------------------------

interface PersonNodeRow {
  id: string
  label: string
  norm_key: string
  props: string | null
}

/**
 * LLM-free surgery that brings already-ingested (name-keyed) person nodes onto
 * the contact-id identity. For each person node not yet keyed by `contact:*`,
 * resolve its label to a contact; if confident, either fold it into the
 * existing contact-keyed node (repointing edges) or relabel it in place.
 *
 * Idempotent: contact-keyed nodes are skipped, so re-running is a no-op.
 */
export function rekeyExistingPersonNodes(): { rekeyed: number; merged: number; skipped: number } {
  const store = getKnowledgeGraphStore()
  const db = store.db
  const result = { rekeyed: 0, merged: 0, skipped: 0 }

  const nameKeyed = db.queryAll<PersonNodeRow>(
    "SELECT id, label, norm_key, props FROM graph_nodes WHERE type = 'person' AND norm_key NOT LIKE 'contact:%'"
  )

  for (const node of nameKeyed) {
    let contactId: string | null = null
    try {
      const r = resolveContact(node.label)
      if (r.id && r.confidence >= REKEY_CONFIDENCE) contactId = r.id
    } catch {
      contactId = null
    }
    if (!contactId) {
      result.skipped++
      continue
    }

    const contactKey = `contact:${contactId}`
    const canonicalLabel = getContactById(contactId)?.name ?? node.label
    const keeper = db.queryOne<{ id: string }>(
      "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
      [contactKey]
    )

    if (keeper && keeper.id !== node.id) {
      // Fold this node into the existing contact-keyed node. Repoint edges
      // (UNIQUE(source,target,type) collisions are ignored → move what fits,
      // drop the rest), then delete the loser.
      db.run('UPDATE OR IGNORE graph_edges SET source_id = ? WHERE source_id = ?', [keeper.id, node.id])
      db.run('DELETE FROM graph_edges WHERE source_id = ?', [node.id])
      db.run('UPDATE OR IGNORE graph_edges SET target_id = ? WHERE target_id = ?', [keeper.id, node.id])
      db.run('DELETE FROM graph_edges WHERE target_id = ?', [node.id])
      db.run('DELETE FROM graph_nodes WHERE id = ?', [node.id])
      result.merged++
    } else if (!keeper) {
      // No contact-keyed node yet — relabel this one in place. Edges reference
      // the node id (unchanged), so nothing else needs repointing.
      let props: Record<string, unknown> = {}
      if (node.props) {
        try {
          props = JSON.parse(node.props) as Record<string, unknown>
        } catch {
          props = {}
        }
      }
      props.contactId = contactId
      db.run('UPDATE graph_nodes SET norm_key = ?, label = ?, props = ?, updated_at = ? WHERE id = ?', [
        contactKey,
        canonicalLabel,
        JSON.stringify(props),
        new Date().toISOString(),
        node.id,
      ])
      result.rekeyed++
    } else {
      result.skipped++
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Context Graph — visualization + neighborhood retrieval
// ---------------------------------------------------------------------------

export interface ContextGraphNode {
  id: string
  type: string
  label: string
  degree: number
  /** Click-through target ids, present per node type. */
  contactId?: string
  meetingId?: string
  projectId?: string
}

export interface ContextGraphData {
  center: string | null
  nodes: ContextGraphNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
}

function parseProps(props: string | null | undefined): Record<string, unknown> {
  if (!props) return {}
  try {
    return JSON.parse(props) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Cache of lowercased project name → id, rebuilt per graph assembly (cheap). */
function projectNameIndex(): Map<string, string> {
  const rows = queryAll<{ id: string; name: string }>('SELECT id, name FROM projects')
  const m = new Map<string, string>()
  for (const r of rows) m.set((r.name || '').toLowerCase().trim(), r.id)
  return m
}

/** Enrich a raw graph node into a context DTO node with click-through ids. */
function nodeToDTO(n: GraphNode & { degree?: number }, projects: Map<string, string>): ContextGraphNode {
  const props = parseProps(n.props)
  const dto: ContextGraphNode = {
    id: n.id,
    type: n.type,
    label: n.label,
    degree: n.degree ?? 0,
  }
  if (n.type === 'person' && typeof props.contactId === 'string') dto.contactId = props.contactId
  if (n.type === 'meeting' && typeof props.meetingId === 'string') dto.meetingId = props.meetingId
  if (n.type === 'project') {
    const pid = projects.get((n.label || '').toLowerCase().trim())
    if (pid) dto.projectId = pid
  }
  return dto
}

function toDTO(sub: SubGraph): ContextGraphData {
  const projects = projectNameIndex()
  const nodes: ContextGraphNode[] = sub.nodes.map((n) => nodeToDTO(n, projects))
  const edges = sub.edges.map((e) => ({
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: e.type,
    weight: e.weight,
  }))
  return { center: sub.center?.id ?? null, nodes, edges }
}

/**
 * The overview graph — capped to the highest-degree `limit` nodes so the initial
 * render is a digestible set of hubs, not an unreadable whole-graph hairball.
 * Defaults to {@link DEFAULT_OVERVIEW_NODE_LIMIT}; callers pass a larger cap only
 * for an explicit "show more" expansion.
 */
export function queryContextGraph(limit: number = DEFAULT_OVERVIEW_NODE_LIMIT): ContextGraphData {
  const store = getKnowledgeGraphStore()
  return toDTO(fullGraph(store, limit))
}

/**
 * One-time maintenance: prune generic "garbage" person nodes (collective/role
 * words) and their edges from the live graph. Idempotent.
 */
export function pruneGenericGraphNodes(): { removedNodes: number; removedEdges: number } {
  const store = getKnowledgeGraphStore()
  return pruneGenericNodes(store)
}

/**
 * Resolve an arbitrary entity id (graph node id, contact id, meeting id, project
 * id, or a bare name) to a graph node id, so callers can pass a domain id.
 */
export function resolveEntityToNodeId(entityId: string): string | null {
  const store = getKnowledgeGraphStore()
  const db = store.db

  // 1. Direct graph node id.
  const direct = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE id = ?', [entityId])
  if (direct) return direct.id

  // 2. Person node carrying this contact id.
  const person = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND JSON_EXTRACT(props, '$.contactId') = ?",
    [entityId]
  )
  if (person) return person.id

  // 3. Meeting node carrying this meeting id.
  const meeting = db.queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'meeting' AND JSON_EXTRACT(props, '$.meetingId') = ?",
    [entityId]
  )
  if (meeting) return meeting.id

  // 4. Project id → project name → project node (name-keyed).
  const project = queryOne<{ name: string }>('SELECT name FROM projects WHERE id = ?', [entityId])
  if (project) {
    const norm = project.name.toLowerCase().trim().replace(/\s+/g, ' ')
    const pnode = db.queryOne<{ id: string }>(
      "SELECT id FROM graph_nodes WHERE type = 'project' AND norm_key = ?",
      [norm]
    )
    if (pnode) return pnode.id
  }

  // 5. Bare name → any node whose label matches.
  const byLabel = db.queryOne<{ id: string }>('SELECT id FROM graph_nodes WHERE LOWER(label) = ?', [
    entityId.toLowerCase().trim(),
  ])
  return byLabel?.id ?? null
}

/** Neighborhood (1–3 hops) around an entity, resolved from any id form. */
export function queryNeighborhood(entityId: string, hops = 1): ContextGraphData {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return { center: null, nodes: [], edges: [] }
  return toDTO(neighborhood(store, nodeId, hops))
}

/** Find graph nodes whose label matches a query — powers search-to-focus. */
export function searchGraphNodes(query: string, limit = 12): ContextGraphNode[] {
  const store = getKnowledgeGraphStore()
  const q = query.trim().toLowerCase()
  if (!q) return []
  const rows = store.db.queryAll<GraphNode>(
    'SELECT * FROM graph_nodes WHERE LOWER(label) LIKE ? ORDER BY LENGTH(label) ASC LIMIT ?',
    [`%${q}%`, limit]
  )
  return toDTO({ center: undefined, nodes: rows.map((n) => ({ ...n, degree: 0 })), edges: [] }).nodes
}

/**
 * Find the person/project graph node whose label is named in a block of text
 * (longest label wins). Precise substring match — powers the RAG grounding hook
 * without over-triggering on stray words. Returns null when nothing is named.
 */
export function findMentionedEntity(text: string): ContextGraphNode | null {
  const haystack = ` ${text.toLowerCase()} `
  const store = getKnowledgeGraphStore()
  const rows = store.db.queryAll<GraphNode>(
    "SELECT * FROM graph_nodes WHERE type IN ('person', 'project')"
  )
  let best: GraphNode | null = null
  for (const n of rows) {
    const label = (n.label || '').trim().toLowerCase()
    if (label.length < 3) continue
    if (haystack.includes(` ${label} `) || haystack.includes(` ${label}`) || haystack.includes(`${label} `)) {
      if (!best || label.length > best.label.trim().length) best = n
    }
  }
  if (!best) return null
  return toDTO({ center: undefined, nodes: [{ ...best, degree: 0 }], edges: [] }).nodes[0]
}

/**
 * Compact, human-readable facts about an entity's neighborhood — one line per
 * connected entity. Used to ground the assistant/RAG with graph context.
 * Returns '' when nothing is found (caller appends nothing).
 */
export function neighborhoodFacts(entityId: string, hops = 1, maxFacts = 20): string {
  const data = queryNeighborhood(entityId, hops)
  if (!data.center || data.nodes.length <= 1) return ''

  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const center = byId.get(data.center)
  if (!center) return ''

  const lines: string[] = []
  for (const e of data.edges) {
    if (lines.length >= maxFacts) break
    const src = byId.get(e.source)
    const tgt = byId.get(e.target)
    if (!src || !tgt) continue
    if (src.id !== center.id && tgt.id !== center.id) continue
    const rel = e.type.toLowerCase().replace(/_/g, ' ')
    lines.push(`- ${src.label} ${rel} ${tgt.label}`)
  }
  if (lines.length === 0) return ''
  return `Context graph — ${center.label} (${center.type}):\n${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// Context Lens — stratified, time-aware perspective + provenance
// ---------------------------------------------------------------------------

export interface ContextLensNode extends ContextGraphNode {
  /** Abstraction band: strategic | operational | people | evidence. */
  stratum: string
  /** Effective recency (epoch ms) for time ordering + age decay, or null. */
  dateMs: number | null
}

export interface ContextLensData {
  center: string | null
  nodes: ContextLensNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
  /** Newest activity in the lens — the reference the time chips measure back from. */
  referenceMs: number | null
}

/** A one-line entity descriptor for the lens center / provenance nodes. */
export interface LensCenter {
  id: string
  type: string
  label: string
  contactId?: string
  meetingId?: string
  projectId?: string
}

export interface ProvenanceDTO {
  node: (LensCenter & { dateMs: number | null }) | null
  meetings: Array<LensCenter & { dateMs: number | null }>
  people: Array<LensCenter & { dateMs: number | null }>
  projects: Array<LensCenter & { dateMs: number | null }>
  actions: Array<LensCenter & { dateMs: number | null }>
  pathIds: string[]
  narrative: string
  dateMs: number | null
}

function toLensDTO(lens: LensGraph): ContextLensData {
  const projects = projectNameIndex()
  const nodes: ContextLensNode[] = lens.nodes.map((n) => ({
    ...nodeToDTO(n, projects),
    stratum: n.stratum,
    dateMs: n.dateMs,
  }))
  const edges = lens.edges.map((e) => ({
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: e.type,
    weight: e.weight,
  }))
  return { center: lens.center?.id ?? null, nodes, edges, referenceMs: lens.referenceMs }
}

/**
 * A stratified, time-aware lens. `centerEntityId` accepts any id form (graph
 * node id, contact id, meeting id, project id, or bare name); null builds a
 * whole-graph lens capped to the highest-degree hubs. `windowDays` filters to
 * recent activity (null = All).
 */
export function queryLens(
  centerEntityId: string | null,
  opts: { hops?: number; cap?: number; windowDays?: number | null } = {}
): ContextLensData {
  const store = getKnowledgeGraphStore()
  let centerNodeId: string | null = null
  if (centerEntityId) {
    centerNodeId = resolveEntityToNodeId(centerEntityId)
    if (!centerNodeId) return { center: null, nodes: [], edges: [], referenceMs: null }
  }
  return toLensDTO(lensGraph(store, centerNodeId, opts))
}

/**
 * The default lens center — the app owner's person node when known, else the
 * highest-degree person (the natural ego of the user's own context). Returns
 * null when the graph has no people yet.
 */
export function pickLensCenter(ownerContactId?: string | null): LensCenter | null {
  const store = getKnowledgeGraphStore()
  const node = pickDefaultCenter(store, ownerContactId ?? undefined)
  if (!node) return null
  const projects = projectNameIndex()
  const dto = nodeToDTO({ ...node, degree: 0 }, projects)
  return { id: dto.id, type: dto.type, label: dto.label, contactId: dto.contactId }
}

/**
 * Provenance for an entity: the meeting(s) it emerged from, people present, the
 * project it belongs to, downstream actions, and a one-line narrative. Accepts
 * any id form. Returns an empty provenance when the entity is unknown.
 */
export function queryProvenance(entityId: string): ProvenanceDTO {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  const empty: ProvenanceDTO = {
    node: null,
    meetings: [],
    people: [],
    projects: [],
    actions: [],
    pathIds: [],
    narrative: '',
    dateMs: null,
  }
  if (!nodeId) return empty
  const prov: Provenance = provenance(store, nodeId)
  const projects = projectNameIndex()
  const mapEntity = (e: {
    id: string
    type: string
    label: string
    dateMs: number | null
  }): LensCenter & { dateMs: number | null } => {
    // Reuse click-through enrichment by looking up the full node for ids.
    const full = store.getNode(e.id)
    const base = full ? nodeToDTO({ ...full, degree: 0 }, projects) : { id: e.id, type: e.type, label: e.label, degree: 0 }
    return {
      id: base.id,
      type: base.type,
      label: base.label,
      contactId: base.contactId,
      meetingId: base.meetingId,
      projectId: base.projectId,
      dateMs: e.dateMs,
    }
  }
  return {
    node: prov.node ? mapEntity(prov.node) : null,
    meetings: prov.meetings.map(mapEntity),
    people: prov.people.map(mapEntity),
    projects: prov.projects.map(mapEntity),
    actions: prov.actions.map(mapEntity),
    pathIds: prov.pathIds,
    narrative: prov.narrative,
    dateMs: prov.dateMs,
  }
}
