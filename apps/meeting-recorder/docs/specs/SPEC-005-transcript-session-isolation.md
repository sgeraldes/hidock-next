# SPEC-005: Transcript Session Isolation

**Created:** 2026-03-04
**Status:** Active
**Addresses:** Audit finding SR-004 (SPEAKER_RENAME_BUG_AUDIT.md)
**Components:**
- `electron/main/services/transcription-pipeline.ts`
- `electron/preload/index.ts`
- `src/hooks/useTranscriptionStream.ts`

---

## Problem Statement

The `transcription:newSegments` IPC event is broadcast without a `sessionId` in its payload. The renderer's `handleSegments` listener in `useTranscriptionStream` writes all incoming segments directly to the store using the `sessionId` captured at effect-mount time.

During rapid session switching, the following race is possible:
1. Session A is active and being transcribed. Its `useEffect` fires and registers a `handleSegments` listener with `sessionId = "A"`.
2. User switches to Session B. The cleanup for A runs and removes the listener. A new `useEffect` fires for B, registering a listener with `sessionId = "B"`.
3. While B's effect is setting up, the main process emits `transcription:newSegments` for A (live transcription is still running).
4. If the timing is close, the new B-listener receives the A-segments and writes them into B's store entry.

This is inconsistent with `transcription:topicsUpdated` and `transcription:actionItemsUpdated`, which both include `sessionId` in their payload and are guarded in the renderer with `if (data.sessionId === sessionId)`.

---

## Requirements

### REQ-1: Session-scoped broadcast payload

1. The `transcription:newSegments` broadcast MUST include `sessionId` in its payload alongside the existing fields.
2. The payload shape after the fix:
   ```typescript
   {
     sessionId: string;   // NEW — the session this chunk belongs to
     chunkIndex: number;
     segments: SegmentResult[];
   }
   ```
3. The `sessionId` is available as `this.sessionId` on the `TranscriptionPipeline` instance at the point of broadcast (`transcription-pipeline.ts` line ~642).

### REQ-2: Renderer-side session guard

1. `handleSegments` in `useTranscriptionStream` MUST check `data.sessionId === sessionId` before calling `addSegments`.
2. If the session IDs do not match, the event is silently discarded (no store write, no error).
3. This guard pattern MUST match the existing pattern used in `handleTopics` and `handleActions`.

### REQ-3: Preload type update

1. The `onNewSegments` callback in `electron/preload/index.ts` currently types its argument as `unknown[]` (an array).
2. The type MUST be updated to reflect the new payload object shape:
   ```typescript
   onNewSegments: (callback: (data: {
     sessionId: string;
     chunkIndex: number;
     segments: unknown[];
   }) => void) => () => void
   ```

### REQ-4: No functional change to segment processing

1. When the session IDs match, the segment processing logic MUST be identical to the current behaviour.
2. The chunk offset calculation (`chunkIndex * TIMESLICE_MS`) is unchanged.
3. No segments are lost for the active session.

---

## Acceptance Criteria

- [ ] AC-1: `transcription:newSegments` payload includes `sessionId`
- [ ] AC-2: `handleSegments` discards events whose `sessionId` does not match the active session
- [ ] AC-3: `handleTopics`, `handleActions`, `handleSegments` all use the same guard pattern
- [ ] AC-4: During single-session recording (normal case), no segments are lost
- [ ] AC-5: Preload type reflects the new payload shape

---

## Test Requirements

### Unit tests (`useTranscriptionStream`)

1. **Guard: mismatched sessionId is discarded** — When a `newSegments` event arrives with `sessionId = "session-B"` while the hook is mounted for `sessionId = "session-A"`, no segments are added to either session's store.
2. **Guard: matching sessionId is processed** — When the sessionId matches, segments are added to the correct session's store as before.
3. **Consistency check** — `handleTopics`, `handleActions`, `handleSegments` all require `data.sessionId === sessionId` before writing to the store.

### Integration test (`transcription-pipeline.ts`)

4. **Broadcast includes sessionId** — After `processChunk` runs, the emitted `transcription:newSegments` event payload contains the pipeline's `sessionId`.

---

## Implementation Notes

- The `TranscriptionPipeline` class already stores `this.sessionId` (set at construction). The fix is a one-field addition to the existing `broadcastToAllWindows` call.
- The renderer fix mirrors the existing `handleTopics` pattern exactly.
- No database changes required.
- No schema version bump required.
