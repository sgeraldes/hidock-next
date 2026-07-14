/**
 * Graph schema: nodes + edges tables, indexes for entity resolution and dedup.
 * Node types: person | meeting | topic | project | decision | action_item | risk | next_step | skill
 * Edge types: ATTENDED | ABOUT | OWNS | MADE_IN | DEMONSTRATED | RAISED | HAS_NEXT_STEP | MENTIONED | RELATES_TO
 */

export const NODE_TYPES = [
  'person',
  'meeting',
  'topic',
  'project',
  'decision',
  'action_item',
  'risk',
  'next_step',
  'skill',
] as const

export type NodeType = (typeof NODE_TYPES)[number]

export const EDGE_TYPES = [
  'ATTENDED',      // person -> meeting
  'ABOUT',         // meeting -> topic | project
  'OWNS',          // person -> action_item
  'MADE_IN',       // decision -> meeting
  'DEMONSTRATED',  // person -> skill
  'RAISED',        // person -> risk
  'HAS_NEXT_STEP', // meeting -> next_step
  'MENTIONED',     // meeting -> person
  'RELATES_TO',    // topic -> project
] as const

export type EdgeType = (typeof EDGE_TYPES)[number]

/** DDL for the knowledge graph. Run via initSchema() — idempotent. */
export const GRAPH_SCHEMA = `
CREATE TABLE IF NOT EXISTS graph_nodes (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  label      TEXT NOT NULL,
  norm_key   TEXT NOT NULL,
  props      TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_graph_nodes_type_norm ON graph_nodes(type, norm_key);

CREATE TABLE IF NOT EXISTS graph_edges (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  type       TEXT NOT NULL,
  props      TEXT,
  weight     REAL DEFAULT 1,
  created_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_graph_edges_src_tgt_type ON graph_edges(source_id, target_id, type);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);

CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);

CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(type);

-- F18 (spec-004): per-edge provenance — which (recording, transcript) asserted
-- an edge, so a hard-deleted recording's graph traces can be removed
-- precisely. assertion_count (AR2-4) tracks how many times this exact
-- (edge, recording, transcript) triple was asserted (duplicate-entity
-- extraction, re-ingest) — mirrors upsertEdge's own weight bump, and is what
-- the cleanup engine sums to decrement a shared edge's weight correctly.
CREATE TABLE IF NOT EXISTS graph_edge_sources (
  edge_id         TEXT NOT NULL,
  recording_id    TEXT NOT NULL,
  transcript_id   TEXT NOT NULL,
  assertion_count INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_graph_edge_sources
  ON graph_edge_sources(edge_id, recording_id, transcript_id);

CREATE INDEX IF NOT EXISTS idx_graph_edge_sources_edge ON graph_edge_sources(edge_id);

CREATE INDEX IF NOT EXISTS idx_graph_edge_sources_recording ON graph_edge_sources(recording_id)
`
