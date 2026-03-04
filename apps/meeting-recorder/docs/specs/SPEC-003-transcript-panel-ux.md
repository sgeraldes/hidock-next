# SPEC-003: Transcript Panel UX Enhancements

**Created:** 2026-03-03
**Status:** Active
**Components:**
- `src/components/TranscriptPanel.tsx`
- `src/components/AudioPlayer.tsx`
- `src/store/useTranscriptStore.ts`
- `electron/main/services/transcription-pipeline.ts`

## Problem Statement

The transcript panel has 4 UX deficiencies:

1. **Wrong timestamps**: All segments show 0:00, 0:00, 0:01, etc. — these are chunk-boundary estimates (chunkIndex * 3s), not actual speech timing
2. **No audio-text sync**: While playing audio, there's no visual indication of which segment is currently being spoken
3. **No copy to clipboard**: Users can't easily copy transcript text
4. **No speaker renaming**: All speakers show generic "Speaker 1" with no way to rename

## Requirements

### REQ-1: Timestamp Display

1. Segment timestamps MUST reflect actual speech timing from the audio
2. The timestamp format is `M:SS` (e.g., "0:15", "1:22", "8:06")
3. Timestamps are stored as `start_ms` in the database — the renderer formats them for display
4. If the AI does not provide `startMs`, the chunk-boundary estimate (`chunkIndex * 3000ms`) is used as fallback
5. Timestamps MUST be monotonically non-decreasing (each segment's time >= previous segment's time)

### REQ-2: Audio-Text Sync Highlighting

1. During audio playback, the segment whose time range contains the current playback position MUST be visually highlighted
2. The highlight style: `bg-primary/10 ring-1 ring-primary/30` (subtle background + ring)
3. The transcript MUST auto-scroll to keep the active segment visible (unless user has scrolled away)
4. The active segment is determined by: `segment.start_ms <= currentTimeMs < nextSegment.start_ms`
5. When audio is paused or not playing, no segment is highlighted
6. The current playback time is shared via a Zustand store field (not prop drilling)

### REQ-3: Copy to Clipboard

1. A clipboard icon button MUST appear in the top-right corner of the transcript panel (or as a floating action)
2. Clicking it copies ALL transcript text as plain text to the clipboard
3. Format: `[timestamp] Speaker: text\n` for each segment
4. After copying, show a brief visual confirmation (icon changes to checkmark for 2 seconds)
5. The button is only visible when there are segments (not during empty/loading states)

### REQ-4: Speaker Renaming

1. Clicking a speaker name in the transcript MUST open an inline edit field
2. The edit field shows the current speaker name, pre-selected
3. Pressing Enter or clicking away saves the new name
4. Pressing Escape cancels the edit
5. The rename applies to ALL segments with the same original speaker name (batch update)
6. The renamed speaker name persists via IPC to the database
7. Speaker colors remain consistent (mapped by original speaker order, not name)

### REQ-5: Playback Time Store

1. Add `playbackTimeMs: number` to a store (useTranscriptStore or a new lightweight store)
2. The AudioPlayer updates this field on every `timeupdate` event
3. The TranscriptPanel reads this field to determine the active segment
4. The store field is transient (NOT persisted)
5. Set to 0 when audio is not playing or component unmounts

## Acceptance Criteria

- [ ] AC-1: Segments display timestamps based on stored start_ms values
- [ ] AC-2: During playback, the current segment is visually highlighted
- [ ] AC-3: Transcript auto-scrolls to active segment during playback
- [ ] AC-4: A copy button appears and copies full transcript to clipboard
- [ ] AC-5: After copy, icon briefly shows checkmark confirmation
- [ ] AC-6: Clicking speaker name opens inline edit
- [ ] AC-7: Renaming a speaker updates all segments with that name
- [ ] AC-8: Speaker rename persists after reload (stored in database)
- [ ] AC-9: Timestamps are monotonically non-decreasing
- [ ] AC-10: No highlighting when audio is paused

## Test Requirements

### Unit Tests (TranscriptPanel)
1. Renders segment timestamps from data (not hardcoded)
2. Highlights active segment when playbackTimeMs matches
3. Does not highlight when playbackTimeMs is 0 (paused)
4. Copy button appears when segments exist
5. Copy button copies formatted text to clipboard
6. Speaker name is clickable and opens edit mode
7. Editing speaker name and pressing Enter saves

### Unit Tests (AudioPlayer → Store sync)
8. AudioPlayer updates playbackTimeMs store on timeupdate
9. AudioPlayer resets playbackTimeMs to 0 on pause/unmount

## Implementation Notes

### For REQ-2 (sync highlighting):
- The `TranscriptSegment` interface needs `startMs` field (numeric, not just the formatted string `timestamp`)
- Parse timestamps from `useTranscriptionStream` to store both formatted string AND raw ms value
- Binary search for active segment index (segments are sorted by time)

### For REQ-4 (speaker rename):
- New IPC channel: `session:renameSpeaker(sessionId, oldName, newName)`
- Handler: UPDATE transcript_segments SET speaker_name = ? WHERE session_id = ? AND speaker_name = ?
- Broadcast updated segments to renderer after rename

### For REQ-5 (playback time store):
- Add to `useTranscriptStore`: `playbackTimeMs: number` (transient)
- `setPlaybackTimeMs(ms: number)` action
- AudioPlayer calls this on `timeupdate` event: `setPlaybackTimeMs(audio.currentTime * 1000)`

---

## Code Review

**Reviewed:** 2026-03-03
**Reviewer:** Claude Opus 4.6
**Verdict:** REQUEST_CHANGES

### Review Summary

The spec is well-structured and the requirements are sound. Five specific concerns need resolution before implementation.

### Finding 1: Playback Time via Zustand Store — Performance Risk (REQ-5)

**Spec says:** "The current playback time is shared via a Zustand store field (not prop drilling)" — REQ-2.6, REQ-5.

**Concern:** The `timeupdate` event fires 4-15 times per second (browser-dependent). Calling `useTranscriptStore.setState({ playbackTimeMs: ... })` on each event triggers a Zustand notification cycle. The `TranscriptPanel` subscribes to this field, so it will re-render at that frequency. With the virtualizer in place this is survivable, but it is unnecessary churn.

**Recommendation:** Use a **React ref + callback pattern** instead of a store field. The `AudioPlayer` exposes a ref (or uses `useImperativeHandle`) containing the current time. The `TranscriptPanel` reads this ref inside a `requestAnimationFrame` loop (or a `setInterval` at ~250ms) to determine the active segment, only calling `setState` on a local `activeSegmentIndex` when it actually changes. This decouples the 15Hz time update from React's render cycle.

Alternatively, if the store approach is kept, **throttle** the `setPlaybackTimeMs` calls to at most 4 per second (250ms interval) and use a dedicated selector that only triggers a re-render when the active segment index changes, not when the raw ms value changes. Add this as an explicit requirement.

**Severity:** Medium — will work but may cause janky scrolling on lower-end hardware.

### Finding 2: TranscriptSegment Interface Already Has `start_ms` in DB but Not in Renderer (REQ-1, REQ-2)

**What exists now:**
- **Database `TranscriptSegment` type** (`database.types.ts` line 35-47): Has `start_ms: number` and `end_ms: number`.
- **Renderer `TranscriptSegment` interface** (`TranscriptPanel.tsx` line 6-12 and `useTranscriptStore.ts` line 3-9): Has only `timestamp: string` (formatted). No numeric `startMs` field.
- **`useTranscriptionStream.ts`** (line 29-41): When loading historical data, it reads `seg.start_ms` from the IPC response and calls `formatTimestamp(seg.start_ms)` — but only stores the formatted string result. The raw ms value is discarded.
- **Live segments** (line 76-85): Same problem — `payload.chunkIndex * TIMESLICE_MS` is formatted to string and the numeric value is lost.

**What the spec says** (Implementation Notes): "The `TranscriptSegment` interface needs `startMs` field (numeric, not just the formatted string `timestamp`)." This is correct but understated.

**Required changes:**
1. Add `startMs: number` to the renderer-side `TranscriptSegment` interface in both `TranscriptPanel.tsx` and `useTranscriptStore.ts`.
2. In `useTranscriptionStream.ts`, store `startMs` alongside `timestamp` in both the historical load path and the live segment path.
3. The broadcast payload from `transcription-pipeline.ts` (line 642-645) sends `result.segments` which includes `startMs?: number` from `ai-provider.types.ts`. This is already available for live segments — the renderer just needs to capture it.

**Severity:** High — this is a prerequisite for both REQ-1 (accurate timestamps) and REQ-2 (sync highlighting). The spec mentions it in notes but should elevate it to an explicit requirement step.

### Finding 3: Speaker Rename IPC — No Handler Exists Yet (REQ-4)

**What exists:**
- `speaker-handlers.ts`: Has `speaker:list`, `speaker:create`, `speaker:getForSession`, `speaker:linkToSession`. **No rename handler.**
- `useSpeakerStore.ts`: Has a client-side `renameSpeaker` action that updates `displayName` in the store but does **not** call any IPC.
- Database: The `transcript_segments` table stores `speaker_name` directly (not a foreign key to `speakers`). The `speakers` table has `display_name` but is a separate entity from the segment-level speaker names.

**The spec proposes** (Implementation Notes): `UPDATE transcript_segments SET speaker_name = ? WHERE session_id = ? AND speaker_name = ?`

**This is correct but incomplete.** The spec should explicitly address:
1. A new IPC handler is needed: `session:renameSpeaker` (or `speaker:rename`). Neither exists.
2. The SQL updates `transcript_segments.speaker_name`, which is the right table — segments store speaker names inline, not via FK.
3. After the DB update, the renderer's `useTranscriptStore.segments` map for that session needs to be refreshed. Either re-fetch from DB or do a local batch update. The spec says "broadcast updated segments to renderer after rename" — clarify whether this means a full re-fetch or a targeted update event.
4. The existing `useSpeakerStore.renameSpeaker` updates `displayName` on a `SpeakerInfo` object, which is a different concept from the `speaker_name` column in `transcript_segments`. These two systems (speaker registry vs. inline segment names) are not connected. The spec should clarify which one to update, or both.

**Severity:** High — implementation will be blocked without clarity on the data model.

### Finding 4: Clipboard API Availability (REQ-3)

**Spec says:** Copy to clipboard.

**Current state:** The Electron window uses `contextIsolation: true` and `nodeIntegration: false` (confirmed in `window-manager.ts` lines 20-22). The renderer runs in a web context.

**Good news:** `navigator.clipboard.writeText()` is available in the Electron renderer process without any special configuration. It works just like in a browser. Context isolation does not block the Clipboard API — it is a standard Web API, not a Node.js API.

**No IPC channel is needed** for copy-to-clipboard. The spec's approach of using `navigator.clipboard.writeText()` directly in the React component is correct. No changes needed.

**Severity:** None — this is fine as specified.

### Finding 5: Virtual Scroller Auto-Scroll Conflict (REQ-2, REQ-3)

**Current auto-scroll behavior** (`TranscriptPanel.tsx` lines 68-79): The virtualizer scrolls to the **last item** (`totalCount - 1`) whenever `totalCount` changes. The `isAutoScrolling` ref is set to `true` when the user is within 50px of the bottom.

**The spec adds a second auto-scroll trigger:** Scroll to the **active segment** during playback (REQ-2.3).

**Risks:**
1. **Conflicting scroll targets:** During a live recording with playback happening simultaneously (unlikely but possible if reviewing while recording continues), the "scroll to newest segment" and "scroll to active playback segment" will fight each other.
2. **User scroll override:** The spec says "unless user has scrolled away" — the current `isAutoScrolling` flag tracks proximity to the **bottom**. For playback sync, the concept is different: the user might scroll away from the **active segment** (which could be in the middle of the list). A second `isUserScrolledAway` flag is needed, based on whether the active segment is visible in the viewport, not based on bottom proximity.
3. **`scrollToIndex` during measurement:** The virtualizer uses `measureElement` for dynamic row heights. Calling `scrollToIndex` immediately after a state change can scroll to a stale offset if the target row hasn't been measured yet. Use `{ behavior: 'smooth' }` and debounce slightly to let measurement settle.

**Recommendation:** Add explicit requirements:
- During playback of a completed session (no live recording), only playback-sync scroll is active.
- During live recording with no playback, only new-segment scroll is active.
- If both would be active (edge case), playback-sync takes priority.
- Define "user scrolled away" as: the active segment is not within the visible viewport bounds (not just "not at bottom").

**Severity:** Medium — without this, the two scroll behaviors will conflict.

### Additional Observations

1. **Duplicate `TranscriptSegment` interface:** The interface is defined in three places: `TranscriptPanel.tsx` (line 6-12), `useTranscriptStore.ts` (line 3-9), and `database.types.ts` (line 35-47). When adding `startMs`, all three must stay in sync. Consider extracting a shared renderer-side type to a single file (e.g., `src/types/transcript.ts`).

2. **`startMs` from AI is optional:** The Zod schema (`ai-schemas.ts` line 6) defines `startMs: z.number().optional()`. When the AI does not return it, the pipeline falls back to `chunkIndex * TIMESLICE_MS` (`transcription-pipeline.ts` line 603). The spec correctly addresses this fallback in REQ-1.4. The broadcast to the renderer (`result.segments`) will have the AI-returned value or `undefined` — the renderer's `handleSegments` in `useTranscriptionStream.ts` currently ignores it and always uses `chunkIndex * TIMESLICE_MS`. After the fix, it should use `segment.startMs ?? chunkIndex * TIMESLICE_MS` to match what the DB stores.

3. **Speaker color stability (REQ-4.7):** The current `getSpeakerColor` function (`TranscriptPanel.tsx` line 36-39) derives color from `speakers.indexOf(speaker)` where `speakers` is built from `segments.map(s => s.speaker)`. After a rename, the speaker name changes, which changes the `speakers` array ordering. To keep colors stable, the color map should be built from the **first-seen order** of speakers across the entire session, not re-derived on each render. Store the speaker-to-color mapping when segments first arrive.

### Required Changes Before Approval

1. **REQ-5 (playback time):** Add a throttle requirement (max 4 updates/sec) or switch to ref+rAF pattern. Add a requirement that re-renders only fire when the active segment index changes.
2. **REQ-1/REQ-2 (startMs):** Elevate the `startMs` field addition from "Implementation Notes" to an explicit requirement. Specify that `useTranscriptionStream.ts` must propagate the numeric value from both the live broadcast and the historical load path.
3. **REQ-4 (speaker rename):** Clarify that a new IPC handler must be created. Specify whether `transcript_segments.speaker_name` or `speakers.display_name` (or both) is updated. Specify refresh strategy (re-fetch vs. local patch).
4. **REQ-2.3 (auto-scroll):** Add requirements to resolve the dual-scroll conflict with the existing new-segment auto-scroll.
5. **General:** Extract the `TranscriptSegment` renderer-side interface to a shared file to avoid triple-definition drift.
