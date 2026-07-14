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
  renameNode,
  mergeNodes,
  mergeBlastRadius,
  deleteNode,
  setNodeProps,
  nodeGraphStats,
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
import {
  run,
  runInTransaction,
  queryAll,
  queryOne,
  getContactById,
  getContactByName,
  createContact,
  updateContact,
  upsertContactAlias,
  getContactAliases,
  mergeContacts,
  getMergeImpact,
} from './database'
import { getEventBus } from './event-bus'
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
    WHERE COALESCE(r.personal, 0) = 0 AND r.deleted_at IS NULL
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
      // Graph writes + the ingested marker commit atomically. Without this, a
      // mid-ingest failure half-committed nodes/edges and the retry on the next
      // cycle re-incremented every already-written edge weight — the LLM
      // extraction above stays OUTSIDE the transaction (it's async and slow).
      //
      // The marker is RE-CHECKED inside the transaction: two ingest entry
      // points (debounced graph-sync + manual graph:ingestAll) can both pass
      // the pre-extraction check before either commits, and the loser would
      // re-upsert every edge (weight inflation). The transaction callback is
      // synchronous — no await can interleave — so the recheck+writes+marker
      // are race-free on the single better-sqlite3 connection. The marker
      // INSERT is deliberately NOT "OR IGNORE": after the recheck a conflict
      // is impossible, and if one ever happens it must be loud.
      const ingestedNow = runInTransaction(() => {
        const claimed = queryOne<{ transcript_id: string }>(
          'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
          [row.id]
        )
        if (claimed) return false // lost the race — a concurrent ingest committed first

        ingestExtraction(store, extraction, meta, {
          now: new Date().toISOString(),
          resolvePerson: makePersonResolver(row.meeting_id ?? undefined),
        })

        // Mark as ingested
        run(
          'INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
          [row.id, new Date().toISOString()]
        )
        return true
      })
      if (ingestedNow) result.ingested++
      else result.skipped++
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
      // Atomic + race-checked for the same reasons as ingestFromDbTranscripts
      // above: a mid-ingest failure must not half-commit nodes/edges without
      // the marker, and a concurrent ingest that committed during the await
      // must be detected inside the synchronous transaction, or the loser
      // re-upserts every edge (weight inflation).
      const ingestedNow = runInTransaction(() => {
        const claimed = queryOne<{ transcript_id: string }>(
          'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
          [transcriptId]
        )
        if (claimed) return false // lost the race — a concurrent ingest committed first

        ingestExtraction(store, extraction, meta, {
          now: new Date().toISOString(),
          resolvePerson: makePersonResolver(),
        })

        run(
          'INSERT INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
          [transcriptId, new Date().toISOString()]
        )
        return true
      })
      if (ingestedNow) result.ingested++
      else result.skipped++
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

/** Per-stratum totals-in-scope vs. shown after the lens node budget. */
export interface ContextLensStratumCount {
  stratum: string
  total: number
  shown: number
}

export interface ContextLensData {
  center: string | null
  nodes: ContextLensNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
  /** Newest activity in the lens — the reference the time chips measure back from. */
  referenceMs: number | null
  /** Per-stratum totals-vs-shown — drives the "20 of 214" truncation affordance. */
  strata: ContextLensStratumCount[]
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
  const strata: ContextLensStratumCount[] = lens.strata.map((s) => ({
    stratum: s.stratum,
    total: s.total,
    shown: s.shown,
  }))
  return { center: lens.center?.id ?? null, nodes, edges, referenceMs: lens.referenceMs, strata }
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
    if (!centerNodeId) return { center: null, nodes: [], edges: [], referenceMs: null, strata: [] }
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

// ===========================================================================
// Node editing — rename-as-correction, convert/link to a contact, merge, remove
//
// The Context Graph's editing affordances. Graph surgery is delegated to the
// package's mutations; identity policy (routing a linked-person rename through
// the contact record, binding at the resolver's sovereign 'manual' tier, reusing
// the contacts merge journal) lives HERE and reuses the existing identity
// platform (entity-resolver / contact aliases / contacts merge) rather than
// duplicating it.
// ===========================================================================

/** The contact id a person node is bound to: explicit prop, or its `contact:<id>` key. */
function contactIdOfNode(node: GraphNode): string | null {
  const props = parseProps(node.props)
  if (typeof props.contactId === 'string' && props.contactId) return props.contactId
  if (node.type === 'person' && node.norm_key.startsWith('contact:')) {
    return node.norm_key.slice('contact:'.length)
  }
  return null
}

/** Detail DTO for the node inspector — what a bare label cannot show. */
export interface NodeDetailDTO {
  node: LensCenter | null
  /** True when this person node is bound to a real, saved contact. */
  linked: boolean
  contactId: string | null
  /** Preferred pronouns (from the node's props), when set. */
  pronouns: string | null
  role: string | null
  company: string | null
  email: string | null
  meetingCount: number
  firstSeenMs: number | null
  lastSeenMs: number | null
  peopleCount: number
  projectCount: number
  degree: number
  /** Known spellings folded onto this identity (contact aliases). */
  aliases: string[]
  /** One-line provenance narrative — where this entity comes from. */
  narrative: string
}

/**
 * Everything the inspector needs to answer "what IS this node?": identity
 * (linked contact vs. raw extracted name), the contact's role/org/email + known
 * aliases when linked, pronouns, graph-derived stats (meetings, first/last seen,
 * neighborhood), and the provenance narrative. Accepts any id form.
 */
export function getNodeDetail(entityId: string): NodeDetailDTO {
  const store = getKnowledgeGraphStore()
  const empty: NodeDetailDTO = {
    node: null,
    linked: false,
    contactId: null,
    pronouns: null,
    role: null,
    company: null,
    email: null,
    meetingCount: 0,
    firstSeenMs: null,
    lastSeenMs: null,
    peopleCount: 0,
    projectCount: 0,
    degree: 0,
    aliases: [],
    narrative: '',
  }
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return empty
  const node = store.getNode(nodeId)
  if (!node) return empty

  const projects = projectNameIndex()
  const dto = nodeToDTO({ ...node, degree: 0 }, projects)
  const props = parseProps(node.props)
  const pronouns = typeof props.pronouns === 'string' && props.pronouns ? props.pronouns : null

  const contactId = contactIdOfNode(node)
  let role: string | null = null
  let company: string | null = null
  let email: string | null = null
  let aliases: string[] = []
  const linked = node.type === 'person' && !!contactId
  if (contactId) {
    const contact = getContactById(contactId)
    if (contact) {
      role = contact.role
      company = contact.company
      email = contact.email
      dto.contactId = contactId
    }
    try {
      aliases = getContactAliases(contactId)
        .filter((a) => a.source !== 'rejected')
        .map((a) => a.alias)
    } catch {
      aliases = []
    }
  }

  const stats = nodeGraphStats(store, nodeId)
  let narrative = ''
  try {
    narrative = provenance(store, nodeId).narrative
  } catch {
    narrative = ''
  }

  return {
    node: { id: dto.id, type: dto.type, label: dto.label, contactId: dto.contactId, meetingId: dto.meetingId, projectId: dto.projectId },
    linked,
    contactId: contactId ?? null,
    pronouns,
    role,
    company,
    email,
    meetingCount: stats.meetingCount,
    firstSeenMs: stats.firstSeenMs,
    lastSeenMs: stats.lastSeenMs,
    peopleCount: stats.peopleCount,
    projectCount: stats.projectCount,
    degree: stats.degree,
    aliases,
    narrative,
  }
}

export interface RenameEntityResult {
  outcome: 'noop' | 'renamed' | 'merged'
  /** 'contact' when the rename propagated through the contact record app-wide;
   *  'graph' when it was a graph-only correction of a name-only node. */
  scope: 'contact' | 'graph'
  nodeId: string | null
}

/**
 * Correct an entity's name (Jiarabi → Yaraví). NOT an alias — a canonical rename.
 * A linked person is renamed through its CONTACT record (updateContact + the
 * entity:contact-changed event), so the correction propagates everywhere the app
 * uses that contact. A name-only node is corrected directly in the graph (rename,
 * or fold into an existing node already under the correct spelling).
 */
export function renameGraphEntity(entityId: string, newLabel: string): RenameEntityResult {
  const store = getKnowledgeGraphStore()
  const label = (newLabel || '').trim()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId || !label) return { outcome: 'noop', scope: 'graph', nodeId: nodeId ?? null }
  const node = store.getNode(nodeId)
  if (!node) return { outcome: 'noop', scope: 'graph', nodeId: null }

  const contactId = contactIdOfNode(node)
  if (node.type === 'person' && contactId) {
    const contact = getContactById(contactId)
    if (contact) {
      const oldName = contact.name
      if (normalizeGraphLabel(oldName) === normalizeGraphLabel(label)) {
        return { outcome: 'noop', scope: 'contact', nodeId }
      }
      updateContact(contactId, { name: label })
      // The contact-keyed graph node's label is display-only (its key stays
      // contact:<id>); refresh it in place so the graph shows the correction now.
      run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [
        label,
        new Date().toISOString(),
        nodeId,
      ])
      try {
        getEventBus().emitDomainEvent({
          type: 'entity:contact-changed',
          timestamp: new Date().toISOString(),
          payload: { contactId, change: 'updated', oldName, newName: label },
        })
      } catch (e) {
        console.warn('[knowledge-graph] rename contact-changed emit failed:', e)
      }
      return { outcome: 'renamed', scope: 'contact', nodeId }
    }
  }

  const res = renameNode(store, nodeId, label)
  return { outcome: res.outcome, scope: 'graph', nodeId: res.nodeId }
}

/** normalizeName lives app-side; a local copy matching the graph key rule. */
function normalizeGraphLabel(label: string): string {
  return (label || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Bind a graph node to a contact at the resolver's sovereign 'manual' tier: write
 * a manual alias (so future extractions of this spelling resolve to the contact)
 * and re-key the node onto the contact identity — folding it into an existing
 * contact-keyed node when one already exists.
 */
function bindNodeToContact(nodeId: string, contactId: string): { outcome: 'linked' | 'merged'; nodeId: string } {
  const store = getKnowledgeGraphStore()
  const node = store.getNode(nodeId)
  if (!node) return { outcome: 'linked', nodeId }
  const canonicalName = getContactById(contactId)?.name ?? node.label

  // Sovereign manual bind so the resolver links this spelling from now on.
  try {
    upsertContactAlias(contactId, node.label, 'manual', 1.0)
  } catch (e) {
    console.warn('[knowledge-graph] manual alias write failed:', e)
  }

  const contactKey = `contact:${contactId}`
  const keeper = queryOne<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE type = 'person' AND norm_key = ?",
    [contactKey]
  )
  const now = new Date().toISOString()

  if (keeper && keeper.id !== nodeId) {
    mergeNodes(store, keeper.id, nodeId)
    run('UPDATE graph_nodes SET label = ?, updated_at = ? WHERE id = ?', [canonicalName, now, keeper.id])
    setNodeProps(store, keeper.id, { contactId })
    return { outcome: 'merged', nodeId: keeper.id }
  }

  run('UPDATE graph_nodes SET norm_key = ?, label = ?, updated_at = ? WHERE id = ?', [
    contactKey,
    canonicalName,
    now,
    nodeId,
  ])
  setNodeProps(store, nodeId, { contactId })
  return { outcome: 'linked', nodeId }
}

export interface LinkContactResult {
  contactId: string
  outcome: 'linked' | 'merged'
  nodeId: string
  /** True when an existing contact was reused instead of a new one being created. */
  reusedExisting?: boolean
}

/**
 * "This node IS person X." Bind an extracted person node to an existing contact
 * (manual/sovereign tier). Reuses the contacts identity platform — no new store.
 */
export function linkNodeToContact(entityId: string, contactId: string): LinkContactResult {
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) throw new Error('Node not found')
  const contact = getContactById(contactId)
  if (!contact) throw new Error('Contact not found')
  const r = bindNodeToContact(nodeId, contactId)
  return { contactId, outcome: r.outcome, nodeId: r.nodeId }
}

/**
 * Convert a name-only person node into a real contact: create the contact (or
 * reuse an exact-name match), then bind the node at the sovereign manual tier.
 * This is the fix for "there is no contact behind Jiarabi today."
 */
export function convertNodeToContact(
  entityId: string,
  opts?: { role?: string | null; company?: string | null; email?: string | null }
): LinkContactResult {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) throw new Error('Node not found')
  const node = store.getNode(nodeId)
  if (!node) throw new Error('Node not found')
  if (node.type !== 'person') throw new Error('Only person nodes can become contacts')

  const existingContactId = contactIdOfNode(node)
  if (existingContactId && getContactById(existingContactId)) {
    // Already a contact — nothing to create; treat as a no-op link.
    return { contactId: existingContactId, outcome: 'linked', nodeId, reusedExisting: true }
  }

  // Reuse an exact-name contact rather than minting a twin.
  const existing = getContactByName(node.label)
  if (existing) {
    const r = bindNodeToContact(nodeId, existing.id)
    return { contactId: existing.id, outcome: r.outcome, nodeId: r.nodeId, reusedExisting: true }
  }

  // contacts.type is CHECK-constrained: team|candidate|customer|external|unknown.
  // An extracted person is an 'external' contact.
  const contact = createContact({
    name: node.label,
    type: 'external',
    role: opts?.role ?? null,
    company: opts?.company ?? null,
    email: opts?.email ?? null,
  })
  const r = bindNodeToContact(nodeId, contact.id)
  return { contactId: contact.id, outcome: r.outcome, nodeId: r.nodeId, reusedExisting: false }
}

/** Set (or clear, with '') a person node's pronouns. Stored on the node props. */
export function setNodePronouns(entityId: string, pronouns: string): boolean {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return false
  const value = (pronouns || '').trim()
  return setNodeProps(store, nodeId, { pronouns: value ? value : null })
}

export interface MergePreviewDTO {
  a: { id: string; label: string; type: string; edges: number } | null
  b: { id: string; label: string; type: string; edges: number } | null
  shared: number
  resulting: number
  /** True when BOTH nodes are linked contacts — the merge folds contacts (undoable). */
  contactMerge: boolean
  /** Contact link counts for a contact-merge, so the UI can gate a heavy merge. */
  contactImpact?: { keeper: number; loser: number }
}

/** Preview merging two nodes: the blast radius (what collapses) BEFORE committing. */
export function mergeGraphPreview(keeperEntityId: string, loserEntityId: string): MergePreviewDTO {
  const store = getKnowledgeGraphStore()
  const keeperId = resolveEntityToNodeId(keeperEntityId)
  const loserId = resolveEntityToNodeId(loserEntityId)
  if (!keeperId || !loserId) {
    return { a: null, b: null, shared: 0, resulting: 0, contactMerge: false }
  }
  const blast = mergeBlastRadius(store, keeperId, loserId)
  const keeperNode = store.getNode(keeperId)
  const loserNode = store.getNode(loserId)
  const keeperContact = keeperNode ? contactIdOfNode(keeperNode) : null
  const loserContact = loserNode ? contactIdOfNode(loserNode) : null
  const contactMerge = !!keeperContact && !!loserContact && keeperContact !== loserContact
  let contactImpact: { keeper: number; loser: number } | undefined
  if (contactMerge && keeperContact && loserContact) {
    try {
      contactImpact = getMergeImpact('contact', keeperContact, loserContact)
    } catch {
      contactImpact = undefined
    }
  }
  return { a: blast.a, b: blast.b, shared: blast.shared, resulting: blast.resulting, contactMerge, contactImpact }
}

export interface MergeNodesResultDTO {
  keeperId: string
  movedEdges: number
  /** 'contact' when the underlying contacts were merged (journaled, undoable);
   *  'graph' when only the graph nodes were folded. */
  path: 'contact' | 'graph'
}

/**
 * Merge the LOSER node into the KEEPER. When both are linked contacts, the
 * contacts are merged through the existing journaled contacts flow (undoable),
 * then their graph nodes are folded. Otherwise the graph nodes are folded directly.
 */
export function mergeGraphNodes(keeperEntityId: string, loserEntityId: string): MergeNodesResultDTO {
  const store = getKnowledgeGraphStore()
  const keeperId = resolveEntityToNodeId(keeperEntityId)
  const loserId = resolveEntityToNodeId(loserEntityId)
  if (!keeperId || !loserId) throw new Error('Node not found')
  if (keeperId === loserId) throw new Error('Cannot merge a node into itself')

  const keeperNode = store.getNode(keeperId)
  const loserNode = store.getNode(loserId)
  const keeperContact = keeperNode ? contactIdOfNode(keeperNode) : null
  const loserContact = loserNode ? contactIdOfNode(loserNode) : null

  if (keeperContact && loserContact && keeperContact !== loserContact) {
    // Real, journaled contacts merge (undoable) — then fold the graph nodes.
    mergeContacts(keeperContact, loserContact)
    const r = mergeNodes(store, keeperId, loserId)
    return { keeperId: r.keeperId, movedEdges: r.movedEdges, path: 'contact' }
  }

  const r = mergeNodes(store, keeperId, loserId)
  return { keeperId: r.keeperId, movedEdges: r.movedEdges, path: 'graph' }
}

/** Remove a junk node from the graph (and its edges). Idempotent. */
export function deleteGraphNode(entityId: string): { removed: boolean; removedEdges: number } {
  const store = getKnowledgeGraphStore()
  const nodeId = resolveEntityToNodeId(entityId)
  if (!nodeId) return { removed: false, removedEdges: 0 }
  return deleteNode(store, nodeId)
}
