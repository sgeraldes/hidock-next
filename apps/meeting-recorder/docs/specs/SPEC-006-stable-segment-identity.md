# SPEC-006: Stable Segment Identity

**Created:** 2026-03-04
**Status:** Active
**Addresses:** Audit finding SR-009 (SPEAKER_RENAME_BUG_AUDIT.md)
**Components:**
- `src/hooks/useTranscriptionStream.ts`
- `src/store/useTranscriptStore.ts`

---

## Problem Statement

Segment IDs used in the renderer are generated from a module-level counter (`let nextSegmentId = 0` in `useTranscriptionStream.ts`). This counter increments monotonically across all sessions and all reloads within a single app session. Two concrete bugs result:

### Bug A: React key churn on session revisit

The virtualizer in `TranscriptPanel` uses `virtualItem.key` (which maps to the segment `id`) as the React reconciliation key. When a session is revisited, `loadHistoricalData` re-maps the same DB rows with fresh synthetic IDs (`seg-47`, `seg-48`, ...) instead of the IDs assigned on the first visit (`seg-0`, `seg-1`, ...`). React sees entirely different keys and unmounts/remounts every row, discarding DOM state (scroll positions, focus, animation state) unnecessarily.

### Bug B: Orphaned translation entries

The `translations` map in `useTranscriptStore` is keyed by `segmentId`. When `clearSession` is called (e.g., on retranscribe), it deletes the session's segments, topics, action items, summaries, and interim results — but NOT the `translations` map entries, because that map is keyed by segment ID rather than by session ID.

After `clearSession` + reload, new synthetic IDs are generated. The old translation entries (keyed by the prior run's IDs) remain in the `translations` map indefinitely. Since the counter never decrements, those old IDs will never appear again, so the entries are permanently orphaned. Over time, the `translations` map grows unboundedly.

---

## Requirements

### REQ-1: Use database row IDs as renderer segment IDs

1. `loadHistoricalData` in `useTranscriptionStream` MUST use the `id` field from the IPC `getTranscript` response as the segment ID in the renderer store.
2. The `getTranscript` IPC handler already returns `id` as part of `SEGMENT_COLS` — no backend change is required.
3. Mapping: `id: seg.id` (not `id: \`seg-${nextSegmentId++}\``).
4. The module-level `nextSegmentId` counter MUST NOT be used for historical loads. It MAY continue to be used for live streaming segments (where there is no DB row ID yet), but SHOULD be replaced with a deterministic key (see REQ-3).

### REQ-2: `clearSession` must clear associated translation entries

1. When `clearSession(sessionId)` is called, it MUST also remove all entries from the `translations` map whose `segmentId` belongs to a segment in that session.
2. Implementation approach: iterate the `translations` map and delete any key that matches a segment ID from the cleared session's segment list (captured before deletion).
3. After `clearSession`, the `translations` map MUST contain zero entries for any segment that belonged to the cleared session.

### REQ-3: Live streaming segments use session-scoped IDs

1. Live segments (arriving via `transcription:newSegments` during active recording) do not yet have a DB row ID at the time they are received by the renderer.
2. These segments MUST use a deterministic, session-scoped ID: `\`${sessionId}:live:${chunkIndex}:${segmentIndexWithinChunk}\``.
3. This ensures IDs do not collide across sessions and remain human-readable for debugging.
4. The module-level `nextSegmentId` counter MUST be removed entirely.

---

## Acceptance Criteria

- [ ] AC-1: After `loadHistoricalData`, segments in the store have IDs that match the DB row `id` values
- [ ] AC-2: Revisiting a session produces the same segment IDs as the first visit (stable across reloads)
- [ ] AC-3: After `clearSession`, the `translations` map contains no entries for the cleared session
- [ ] AC-4: Live streaming segments have session-scoped IDs (no module-level counter)
- [ ] AC-5: The module-level `nextSegmentId` counter is removed from `useTranscriptionStream.ts`

---

## Test Requirements

### Unit tests (`useTranscriptStore`)

1. **`clearSession` removes translations** — After adding a translation for a segment in session A and calling `clearSession("A")`, the translation is gone from the store.
2. **`clearSession` does not remove translations for other sessions** — Translations for session B are unaffected when session A is cleared.

### Unit tests (`useTranscriptionStream` — with mocked IPC)

3. **Historical load uses DB IDs** — After `loadHistoricalData` for a session whose `getTranscript` returns segments with `id: "db-uuid-1"`, the store contains a segment with `id: "db-uuid-1"`.
4. **Stable IDs across revisits** — Calling `loadHistoricalData` twice for the same session (same DB response) produces the same segment IDs both times (no counter drift).
5. **Live segments use session-scoped IDs** — A `newSegments` event with `chunkIndex: 2` and one segment produces a segment ID of `"session-A:live:2:0"`, not `"seg-N"`.

---

## Implementation Notes

- `SEGMENT_COLS` in `database-queries.ts` already includes `id` as the first column. No backend change needed.
- The `clearSession` fix requires capturing the segment IDs for the session before clearing them (one extra `map.get(sessionId) ?? []` call inside the `set()` callback).
- The session-scoped live ID format `${sessionId}:live:${chunkIndex}:${i}` provides: uniqueness across sessions, determinism within a session, debuggability.
