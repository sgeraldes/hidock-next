import { GRAPH_SCHEMA, type NodeType, type EdgeType } from './schema.js'

/**
 * Minimal DB interface — injected at construction time. Never import @hidock/database here.
 * DatabaseEngine from @hidock/database satisfies this interface.
 */
export interface GraphDb {
  run(sql: string, params?: unknown[]): void
  queryAll<T>(sql: string, params?: unknown[]): T[]
  queryOne<T>(sql: string, params?: unknown[]): T | undefined
}

export interface GraphNode {
  id: string
  type: NodeType
  label: string
  norm_key: string
  props?: string | null
  created_at?: string | null
  updated_at?: string | null
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
  props?: Record<string, unknown>
  now?: string
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
      } catch {
        // Ignore "already exists" errors — schema is idempotent
      }
    }
  }

  /**
   * Upsert a node by (type, norm_key).
   * If a node with the same type+norm_key exists: merge props + refresh label, return existing id.
   * If not: insert with deterministic id derived from type+norm_key.
   * Returns the node id.
   */
  upsertNode({ type, label, props, now = '' }: UpsertNodeInput): string {
    const normKey = normalizeLabel(label)
    const id = makeNodeId(type, normKey)
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

    this.db.run(
      'INSERT INTO graph_nodes (id, type, label, norm_key, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, type, label, normKey, propsJson, now, now]
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
    this.db.run('DELETE FROM graph_edges')
    this.db.run('DELETE FROM graph_nodes')
  }
}
