import { GRAPH_SCHEMA, type NodeType, type EdgeType } from './schema.js'

/**
 * Minimal DB interface — injected at construction time. Never import @hidock/database here.
 * DatabaseEngine from @hidock/database satisfies this interface.
 */
export interface GraphDb {
  run(sql: string, params?: unknown[]): void
  queryAll<T>(sql: string, params?: unknown[]): T[]
  queryOne<T>(sql: string, params?: unknown[]): T | undefined
  /**
   * OPTIONAL atomic-execution primitive (ADV52-1 / round-54). When the injected
   * db exposes it, {@link runInGraphTransaction} routes a multi-statement graph
   * mutation through it so a partial failure rolls back cleanly. The host's
   * DatabaseEngine implements this as a RE-ENTRANT BEGIN/COMMIT/ROLLBACK (a
   * nested call joins the open transaction rather than erroring). A bare GraphDb
   * (test harness over raw sql.js) omits it and gets the SAVEPOINT fallback.
   */
  runInTransaction?<T>(fn: () => T): T
}

/**
 * Run `fn` atomically against `db` (ADV52-1 / round-54): all of `fn`'s writes
 * commit together, or — on ANY throw — roll back together so the graph, weights,
 * and graph_edge_sources are restored to their pre-`fn` state, and the error is
 * rethrown to the caller.
 *
 * Prefers the host db's own {@link GraphDb.runInTransaction} (re-entrant on the
 * shared engine, so calling this while an outer transaction is open simply joins
 * it). When the db has no such primitive (a bare GraphDb over raw sql.js, e.g.
 * the package's unit tests) it falls back to a SAVEPOINT, which nests safely
 * whether or not an outer transaction is already open — so this helper never
 * issues a bare BEGIN that would fail inside an existing transaction.
 */
export function runInGraphTransaction<T>(db: GraphDb, fn: () => T): T {
  if (typeof db.runInTransaction === 'function') {
    return db.runInTransaction(fn)
  }
  db.run('SAVEPOINT graph_txn')
  try {
    const result = fn()
    db.run('RELEASE SAVEPOINT graph_txn')
    return result
  } catch (error) {
    // ROLLBACK TO rewinds every write since the savepoint but leaves the
    // savepoint on the stack; the following RELEASE pops it. Guard the unwind
    // so a rollback error never masks the original failure.
    try {
      db.run('ROLLBACK TO SAVEPOINT graph_txn')
      db.run('RELEASE SAVEPOINT graph_txn')
    } catch {
      /* savepoint already unwound */
    }
    throw error
  }
}

export interface GraphNode {
  id: string
  type: NodeType
  label: string
  norm_key: string
  props?: string | null
  created_at?: string | null
  updated_at?: string | null
  /** ADV35-1 (round-37) — NODE-LEVEL provenance: 'derived' | 'manual' | null (legacy). */
  origin?: 'derived' | 'manual' | string | null
  /** ADV35-1 (round-37) — the recording a 'derived' node was extracted from (NULL for manual/legacy). */
  source_recording_id?: string | null
}

export interface GraphEdge {
  id: string
  source_id: string
  target_id: string
  type: EdgeType
  props?: string | null
  weight: number
  created_at?: string | null
}

export interface UpsertNodeInput {
  type: NodeType
  label: string
  /**
   * Stable identity key for dedup, independent of the display label. When
   * omitted the label is the key (the historical, name-keyed behaviour). Supply
   * it to key a node by a canonical id — e.g. a person by contact id
   * (`contact:<id>`) so every name variant folds into one node.
   */
  key?: string
  props?: Record<string, unknown>
  now?: string
  /**
   * ADV35-1 (F18/round-37) — NODE-LEVEL provenance, written on INSERT only (an
   * existing node keeps its FIRST recorded origin/source — best-effort for the
   * isolated case; when a node accretes edges, edge-provenance governs). 'derived'
   * = extracted from a recording's transcript (supply `sourceRecordingId`);
   * 'manual' = a source with no recording identity (folder import / user path) —
   * always visible on non-owner surfaces. Omit for legacy/untracked call sites.
   */
  origin?: 'derived' | 'manual'
  sourceRecordingId?: string | null
}

export interface UpsertEdgeInput {
  sourceId: string
  targetId: string
  type: EdgeType
  props?: Record<string, unknown>
  now?: string
}

/** Normalize a label into a stable key: lowercase, trim, collapse whitespace. */
function normalizeLabel(label: string): string {
  return label.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Deterministic ID from type + norm_key — no Date.now() or Math.random().
 * Slug: replace non-alphanumeric chars with underscores, strip leading/trailing
 * underscores, truncate to 64 chars.
 */
function makeNodeId(type: string, normKey: string): string {
  const slug = normKey.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
  return `${type}:${slug}`
}

function makeEdgeId(sourceId: string, targetId: string, type: string): string {
  const combined = `${sourceId}|||${targetId}|||${type}`
  const slug = combined.replace(/[^a-z0-9_|:]+/g, '_').slice(0, 120)
  return `edge:${slug}`
}

/**
 * Delete every graph edge matching `where` AND its `graph_edge_sources` rows —
 * the ONE sanctioned way to delete edges (CX-T4-3). Edge ids are deterministic
 * (`makeEdgeId`), so an edge deleted with its source rows left behind can be
 * RE-CREATED by a later ingest under the exact same id and silently inherit
 * the stale provenance (before the `pruneOrphanEdgeSources` backstop runs).
 * `where` is a caller-supplied LITERAL SQL fragment (never external input);
 * all values are bound via `params`. The source-row delete runs first, while
 * the edges still exist for the subquery to match.
 */
export function deleteEdgesCleanly(db: GraphDb, where: string, params: unknown[] = []): void {
  db.run(
    `DELETE FROM graph_edge_sources WHERE edge_id IN (SELECT id FROM graph_edges WHERE ${where})`,
    params
  )
  db.run(`DELETE FROM graph_edges WHERE ${where}`, params)
}

/**
 * Short deterministic hash of a string (FNV-1a, base36). Used to disambiguate
 * a node id when two distinct norm_keys slugify to the same id — keeps ids
 * stable and collision-free without a random component.
 */
function shortHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export class KnowledgeGraphStore {
  /** Exposed publicly so query functions can access it directly. */
  readonly db: GraphDb

  constructor(db: GraphDb) {
    this.db = db
  }

  /** Run the graph DDL — idempotent. */
  initSchema(): void {
    const statements = GRAPH_SCHEMA.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const sql of statements) {
      try {
        this.db.run(sql)
      } catch (e) {
        // Every GRAPH_SCHEMA statement already uses IF NOT EXISTS, so a
        // genuine "already exists" error should never actually fire here —
        // this tolerance is defensive only, for a driver that races the
        // conditional check. spec-006/F17 T6 AR3-3(b): anything ELSE (a
        // corrupt DB, disk full, permission denied, a real syntax error from
        // a future schema edit) is a real failure and MUST surface. Silently
        // swallowing it here previously let downstream graph operations fail
        // in confusing ways far from the actual cause — including, for the
        // hard-purge cleanup seam, initSchema being re-run INSIDE the delete
        // transaction (see ensureGraphReady in the app's
        // knowledge-graph-service.ts), where a swallowed failure could look
        // like a successful purge.
        const message = e instanceof Error ? e.message : String(e)
        if (!/already exists/i.test(message)) {
          throw e
        }
      }
    }
  }

  /**
   * Upsert a node by (type, norm_key).
   * If a node with the same type+norm_key exists: merge props + refresh label, return existing id.
   * If not: insert with deterministic id derived from type+norm_key.
   * Returns the node id.
   */
  upsertNode({ type, label, key, props, now = '', origin, sourceRecordingId }: UpsertNodeInput): string {
    // Identity key drives dedup; the label is display-only. Defaults to label.
    const normKey = normalizeLabel(key ?? label)
    const propsJson = props != null ? JSON.stringify(props) : null

    const existing = this.db.queryOne<{ id: string; props: string | null }>(
      'SELECT id, props FROM graph_nodes WHERE type = ? AND norm_key = ?',
      [type, normKey]
    )

    if (existing) {
      let merged: Record<string, unknown> | null = null
      if (existing.props) {
        const prev = JSON.parse(existing.props) as Record<string, unknown>
        merged = props != null ? { ...prev, ...props } : prev
      } else if (props != null) {
        merged = props
      }
      this.db.run(
        'UPDATE graph_nodes SET label = ?, props = ?, updated_at = ? WHERE id = ?',
        [label, merged != null ? JSON.stringify(merged) : null, now, existing.id]
      )
      return existing.id
    }

    // New node. The id is a slug of norm_key, but two distinct norm_keys can
    // slugify to the same id (collapsed punctuation, 64-char truncation). That
    // is the root cause of the "UNIQUE constraint failed: graph_nodes.id" ingest
    // error: the (type,norm_key) lookup above misses, then the INSERT collides
    // on the primary key. Detect a taken id and derive a stable, hashed variant.
    let id = makeNodeId(type, normKey)
    const clash = this.db.queryOne<{ norm_key: string }>(
      'SELECT norm_key FROM graph_nodes WHERE id = ?',
      [id]
    )
    if (clash && clash.norm_key !== normKey) {
      id = `${id}__${shortHash(normKey)}`.slice(0, 96)
    }

    // ADV35-1 (round-37): stamp NODE-LEVEL provenance on INSERT. A 'derived' node
    // carries its source recording; a 'manual' node (no recording identity) carries
    // NULL. Omitted (legacy call sites) ⇒ both NULL. The UPDATE branch above never
    // rewrites these, so an existing node keeps its FIRST recorded provenance.
    this.db.run(
      'INSERT INTO graph_nodes (id, type, label, norm_key, props, origin, source_recording_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, type, label, normKey, propsJson, origin ?? null, sourceRecordingId ?? null, now, now]
    )
    return id
  }

  /**
   * Upsert an edge by (source_id, target_id, type).
   * On conflict: increment weight by 1.
   * Returns the edge id.
   */
  upsertEdge({ sourceId, targetId, type, props, now = '' }: UpsertEdgeInput): string {
    const edgeId = makeEdgeId(sourceId, targetId, type)
    const propsJson = props != null ? JSON.stringify(props) : null

    const existing = this.db.queryOne<{ id: string; weight: number }>(
      'SELECT id, weight FROM graph_edges WHERE source_id = ? AND target_id = ? AND type = ?',
      [sourceId, targetId, type]
    )

    if (existing) {
      this.db.run('UPDATE graph_edges SET weight = ? WHERE id = ?', [existing.weight + 1, existing.id])
      return existing.id
    }

    this.db.run(
      'INSERT INTO graph_edges (id, source_id, target_id, type, props, weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [edgeId, sourceId, targetId, type, propsJson, 1, now]
    )
    return edgeId
  }

  /**
   * Record that (recordingId, transcriptId) asserted edge `edgeId` (F18,
   * spec-004). Upserts on the (edge_id, recording_id, transcript_id) triple:
   * a first assertion inserts assertion_count=1; a repeat of the EXACT same
   * triple (duplicate-entity extraction within one transcript, or a re-ingest
   * pass) bumps assertion_count by 1 (AR2-4) — mirroring upsertEdge's own
   * weight bump. This is the hook the cleanup engine sums to decrement a
   * shared edge's weight by exactly what this recording contributed.
   */
  recordEdgeSource(edgeId: string, recordingId: string, transcriptId: string, now = ''): void {
    this.db.run(
      `INSERT INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(edge_id, recording_id, transcript_id)
       DO UPDATE SET assertion_count = assertion_count + 1`,
      [edgeId, recordingId, transcriptId, now]
    )
  }

  getNode(id: string): GraphNode | undefined {
    return this.db.queryOne<GraphNode>('SELECT * FROM graph_nodes WHERE id = ?', [id])
  }

  findNodes({ type, label }: { type?: NodeType; label?: string } = {}): GraphNode[] {
    if (type != null && label != null) {
      const normKey = normalizeLabel(label)
      return this.db.queryAll<GraphNode>(
        'SELECT * FROM graph_nodes WHERE type = ? AND norm_key LIKE ?',
        [type, `%${normKey}%`]
      )
    }
    if (type != null) {
      return this.db.queryAll<GraphNode>('SELECT * FROM graph_nodes WHERE type = ?', [type])
    }
    if (label != null) {
      const normKey = normalizeLabel(label)
      return this.db.queryAll<GraphNode>(
        'SELECT * FROM graph_nodes WHERE norm_key LIKE ?',
        [`%${normKey}%`]
      )
    }
    return this.db.queryAll<GraphNode>('SELECT * FROM graph_nodes')
  }

  neighbors(id: string, edgeType?: EdgeType): GraphNode[] {
    if (edgeType != null) {
      return this.db.queryAll<GraphNode>(
        `SELECT n.* FROM graph_nodes n
         JOIN graph_edges e ON e.target_id = n.id
         WHERE e.source_id = ? AND e.type = ?
         UNION
         SELECT n.* FROM graph_nodes n
         JOIN graph_edges e ON e.source_id = n.id
         WHERE e.target_id = ? AND e.type = ?`,
        [id, edgeType, id, edgeType]
      )
    }
    return this.db.queryAll<GraphNode>(
      `SELECT n.* FROM graph_nodes n
       JOIN graph_edges e ON e.target_id = n.id
       WHERE e.source_id = ?
       UNION
       SELECT n.* FROM graph_nodes n
       JOIN graph_edges e ON e.source_id = n.id
       WHERE e.target_id = ?`,
      [id, id]
    )
  }

  clear(): void {
    // Source rows first (CX-T4-3): deterministic edge ids mean a re-ingested
    // edge would otherwise inherit the stale provenance of its predecessor.
    this.db.run('DELETE FROM graph_edge_sources')
    this.db.run('DELETE FROM graph_edges')
    this.db.run('DELETE FROM graph_nodes')
  }
}
