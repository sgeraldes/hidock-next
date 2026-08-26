# T2 — F16: Downstream gates for low-value captures

## Objective
A capture rated `low-value`/`garbage` (by T1 or by the user) stops polluting the intelligence surfaces: no graph ingestion, no actionable extraction, excluded from RAG retrieval.

## Current state (verified facts)
- Graph ingest: `ingestFromDbTranscripts()` (apps/electron/electron/main/services/knowledge-graph-service.ts ~:181-241) selects transcripts with `WHERE COALESCE(r.personal,0)=0 AND r.deleted_at IS NULL` — no rating filter. Also an event-driven path: graph-sync.ts subscribes `entity:transcript-ready` (60 s debounce) → same ingest function.
- RAG: vector store filters query results against `getExcludedRecordingIds()` (database.ts ~:3018 — personal OR soft-deleted). Chunks for low-value captures still retrievable (motivating case: 20 chunks of cooking chatter).
- Actionables/action items extraction: locate where action_items/actionables get extracted post-transcription (knowledge capture analysis); currently unconditional.
- The user can also set ratings manually (Library UI) — gates must respect BOTH sources of rating, live (no re-index required), and be REVERSIBLE (user upgrades rating → content flows again; for graph that means the transcript becomes ingestable again — it was never marked in `graph_ingested_transcripts` if skipped).

## What's missing
1. Rating-aware exclusion set: extend `getExcludedRecordingIds()` (or add a sibling used by the vector store + graph ingest) to include recordings whose capture is rated `garbage` (hard exclude) and `low-value` (exclude from RAG + graph by default — decide + document; keep it simple and symmetric unless there's a strong case for downweighting).
2. Graph ingest WHERE clause + event path: skip transcripts whose capture rating is below threshold; do NOT insert into `graph_ingested_transcripts` when skipped (so a later upgrade re-ingests naturally).
3. Actionable extraction: skip when below threshold (and document what happens on upgrade — next analysis run extracts).
4. Timing: T1 classification runs in the SAME analysis step that precedes graph ingest scheduling — validate ordering so the 60 s debounced ingest sees the fresh rating (if ordering can race, gate must re-check rating at ingest time — it does, since the WHERE clause reads current DB state).
5. Unit tests: rated-garbage capture → not ingested, not embedded/retrievable, no actionables; upgrade to unrated/valuable → flows again.

## Dependencies
- T1 (rating exists). Manual ratings already exist, so gates are testable independently of the classifier.

## Constraints
- Fixture/temp DBs only. Non-interactive commands only.
