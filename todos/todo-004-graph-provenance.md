# T4 — F18-minimal: Graph provenance + per-recording cleanup API (Phase 2)

## Objective
The knowledge graph can attribute what each recording contributed, so a hard-deleted recording's graph traces can be removed precisely. Recurring-title node merging stops for NEW ingests.

## Current state (verified facts)
- Graph tables in main hidock.db: `graph_nodes(id,type,label,norm_key,props,created_at,updated_at)`, `graph_edges(id,source_id,target_id,type,props,weight,created_at)` — schema in packages/knowledge-graph/src/schema.ts. UNIQUE(type,norm_key) on nodes; UNIQUE(source,target,type) on edges.
- `ingestExtraction()` (packages/knowledge-graph/src/ingest.ts:27+) upserts the meeting node WITHOUT a `key` → `upsertNode` (graph-store.ts:118) dedups by `normalizeLabel(label)` → ALL recurring meetings with the same title fold into ONE node; `props.meetingId` is last-writer-wins. Person nodes already use identity keys (`contact:<id>`).
- Ingest is tracked in `graph_ingested_transcripts(transcript_id, ingested_at)` (created by knowledge-graph-service.ts). `meta.meetingId = recordings.meeting_id ?? recording_id`.
- Live data has label-keyed legacy nodes (e.g., one 'Almuerzo' node with 54 edges spanning multiple days/recordings). Retroactive split is impossible — accept merged history; design cleanup to be safe on legacy data (best-effort, never delete shared entities).
- graph-sync.ts does node surgery on contact rename/merge — keep compatible.

## What's missing
1. **Meeting-node identity**: key meeting nodes by `meeting:<meta.meetingId>` (mirror the `contact:` pattern). Label stays the display title. Consequence: recurring meetings get one node PER calendar occurrence id (meeting_id includes occurrence timestamp) or per recording when uncorrelated — verify meta.meetingId shape and document the granularity decision.
2. **Per-edge provenance**: record the source (recording_id + transcript_id) for every edge an ingest creates. Options: (a) side table `graph_edge_sources(edge_id, recording_id, transcript_id)` (n:m — an upserted edge can be re-asserted by several recordings), or (b) props JSON array. Prefer (a) for SQL-deletability; keep writes inside the same ingest path. Node provenance: nodes are shared entities — do NOT provenance-delete nodes except the meeting node itself + orphan GC.
3. **Cleanup API** (new function in @hidock/knowledge-graph, wired via knowledge-graph-service): `removeRecordingFromGraph(recordingId)`:
   - Delete edge-source rows for the recording; delete edges that have NO remaining sources (legacy edges without any source rows: only delete when attached to this recording's id-keyed meeting node — best-effort rule).
   - Delete the recording's meeting node when its id-keyed and no remaining edges reference it (legacy label-keyed nodes: leave unless ALL their edges were removed).
   - GC orphaned topic/decision/action_item/next_step/skill nodes (no remaining edges). Never GC person nodes (identity-owned) or project nodes with DB-side projects rows — check knowledge-projects linkage first.
   - Remove `graph_ingested_transcripts` rows for the recording's transcripts.
   - Return counts (nodes/edges removed) for the deletion-impact dialog.
4. **Schema/DDL**: additive CREATE TABLE IF NOT EXISTS for the side table in GRAPH_SCHEMA init (idempotent, matches existing pattern — no versioned migration needed if the package owns its DDL; verify how graph DDL evolves in this repo).
5. Tests (vitest, in-memory/temp DB): ingest twice with same title different meetings → two nodes; shared topic across recordings survives one recording's cleanup; edge re-asserted by two recordings survives one cleanup; legacy label-keyed node untouched unless fully orphaned; GC never touches person/project-linked nodes; counts accurate.

## Dependencies
- None on Phase 1 (parallel-safe), but Phase 3 (F17) consumes the cleanup API.

## Constraints
- Fixture/temp DBs only; non-interactive commands; additive schema only; keep graph-sync.ts rename/merge surgery working (update it if node keys change its lookups — it queries `type='person'` by norm_key, unaffected by meeting-key change, but VERIFY).

## Phase-1 learnings addendum (Stage-9 refinement, 2026-07-14 — binding for the T4 spec)
- Next migration version = 44 (v42+v43 used by Phase 1); tables need lazy CREATE TABLE IF NOT EXISTS
  besides SCHEMA + MIGRATIONS (repairPhase only re-adds columns). Graph DDL itself lives in
  GRAPH_SCHEMA (initSchema, idempotent) — decide which home the side table gets and justify it.
- removeRecordingFromGraph must be TRANSACTIONAL (decide + delete in one runInTransaction; no awaits
  inside) and return explicit counts/errors — never silent catches (CX-T3-7 lesson).
- Hard-purge integration point: deleteRecordingCascade's explicit child list (now includes
  value_backfill_state) — F17/T6 will call the cleanup there; design the API to be callable inside
  that transaction OR as a guarded pre/post step (justify).
- The two-layer race pattern (pre-filter + transactional point-read) applies to any new
  eligibility/cleanup decision vs concurrent ingest — cleanup must not race the 60s-debounced ingest
  (a transcript being ingested while its recording is purged: define the winner; the marker +
  edge-source writes are transactional, so cleanup after commit must remove them — consider cleanup
  deleting graph_ingested_transcripts FIRST inside its txn so a concurrent ingest can't mark after).
