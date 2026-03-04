# SPEC-001: Audio Player Behavior

**Created:** 2026-03-03
**Status:** Active
**Component:** `src/components/AudioPlayer.tsx`
**Related IPC:** `audio:readFile`, `audio:getPath`
**Related Service:** `electron/main/services/audio-concatenation.ts`

## Overview

The AudioPlayer renders below the session header for completed (non-active) recording sessions. It loads the concatenated audio file via IPC and provides playback controls, time display, seeking, and speed adjustment.

## Requirements

### REQ-1: Audio Loading

1. When a completed session is selected, the AudioPlayer loads audio via `audio:readFile` IPC
2. While loading, a spinner with "Loading audio..." text is shown
3. If no audio is available, an amber warning banner states the reason
4. The audio blob URL is created from the IPC response and set as the `<audio>` element source
5. The blob URL is revoked when the component unmounts (memory cleanup)

### REQ-2: Duration Display

1. The total duration MUST display correctly (e.g., "1:22" for an 82-second recording)
2. Duration MUST update when the `<audio>` element's `loadedmetadata` or `durationchange` event fires
3. Duration MUST NOT display "0:00" when a valid audio file is loaded
4. Duration MUST NOT display "NaN" or "Infinity"
5. If the audio source is a WebM file re-muxed by ffmpeg, the Duration metadata is embedded in the container — the browser can read it directly

### REQ-3: Playback Time Counter

1. The current time counter MUST update in real-time during playback (via `timeupdate` event)
2. Format: `M:SS` (e.g., "0:00", "1:22", "12:05")
3. The counter MUST reflect the actual `audio.currentTime` property
4. When playback ends, the time counter shows the final position

### REQ-4: Seek Bar (Progress Slider)

1. The seek bar `<input type="range">` MUST have `max` set to the audio duration
2. The seek bar value MUST update in real-time during playback (tracks `currentTime`)
3. Dragging the seek bar handle MUST set `audio.currentTime` to the new position
4. Clicking anywhere on the track MUST jump to that position
5. The slider thumb MUST be visible and draggable at all times when audio is loaded
6. The slider MUST NOT be stuck at position 0 when duration is known

### REQ-5: Play/Pause Button

1. Clicking Play starts playback and shows the Pause icon
2. Clicking Pause pauses playback and shows the Play icon
3. The visual state MUST match the actual audio playback state
4. When playback reaches the end, the button reverts to Play

### REQ-6: Skip Backward/Forward

1. Skip backward button rewinds 10 seconds (clamped to 0)
2. Skip forward button advances 10 seconds (clamped to duration)
3. The time counter and seek bar MUST update immediately after skip

### REQ-7: Playback Speed

1. Clicking the speed button cycles through: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x
2. The displayed speed label MUST match `audio.playbackRate`
3. Speed persists during the current playback session

### REQ-8: Event Listener Lifecycle

1. Audio element event listeners (`timeupdate`, `durationchange`, `ended`) MUST be attached AFTER the `<audio>` element exists in the DOM
2. If the `<audio>` element is conditionally rendered (e.g., waiting for blob URL), listeners MUST be attached when the element appears, not on initial mount
3. Listeners MUST be cleaned up when the component unmounts

### REQ-9: Chunk Cleanup After Concatenation

1. After `AudioConcatenation.concatenateSession()` successfully produces `recording.webm`, the individual `chunk-*.ogg` files MUST be deleted
2. The `recording-raw.webm` temporary file MUST also be deleted (already implemented)
3. If deletion fails, log a warning but do not throw — the concatenated file is the source of truth
4. Chunk files are only needed during the recording session for streaming — once concatenated, they are redundant

### REQ-10: No Chunk Pruning During Recording

1. `AudioStorage.pruneOldChunks()` MUST NOT delete chunk files during an active recording session
2. All chunks must survive until concatenation completes — pruning during recording causes audio gaps for recordings longer than ~2.5 minutes (50 chunks x 3s)
3. The `MAX_CHUNK_FILES` limit should be removed or increased to a very large number (e.g., 10000) to prevent data loss
4. Disk space management should happen only AFTER concatenation, by deleting chunks per REQ-9

### REQ-11: formatTime Safety

1. `formatTime()` MUST return "0:00" for NaN, Infinity, negative, or undefined inputs
2. MUST NOT display "NaN:aN" or "Infinity:aN" under any circumstance

### REQ-12: Play Error Handling

1. `togglePlay()` MUST wrap `audio.play()` in try/catch
2. If play fails, log the error and keep isPlaying as false

## Acceptance Criteria

- [ ] AC-1: Audio player shows correct duration (e.g., "1:22") for a session with audio
- [ ] AC-2: Time counter updates in real-time during playback
- [ ] AC-3: Seek bar thumb moves during playback, reflecting current position
- [ ] AC-4: Dragging seek bar changes audio playback position
- [ ] AC-5: Play/pause button toggles correctly with visual feedback
- [ ] AC-6: Skip buttons work and update time display immediately
- [ ] AC-7: Speed button cycles and applies playback rate
- [ ] AC-8: Event listeners are attached when audio element renders, not on mount
- [ ] AC-9: Chunk files are deleted after successful concatenation
- [ ] AC-10: No "0:00 / 0:00" displayed when valid audio is loaded
- [ ] AC-11: formatTime returns "0:00" for NaN/Infinity inputs
- [ ] AC-12: Recordings >2.5 min have complete audio (no gaps from pruning)
- [ ] AC-13: play() errors are caught and logged

## Test Requirements

### Unit Tests (AudioPlayer component)
1. Renders loading state while audio is being fetched
2. Renders error state when audio is unavailable
3. Displays correct duration after audio loads
4. Updates current time during simulated playback
5. Seek bar max value matches duration
6. Seek bar onChange updates audio.currentTime
7. Play button toggles to Pause on click
8. Skip buttons adjust currentTime by 10s
9. Speed button cycles through speed values
10. Event listeners are attached after audio element renders

### Unit Tests (AudioConcatenation)
11. Deletes chunk files after successful concatenation
12. Does not delete chunks if concatenation fails
13. Logs warning if chunk deletion fails (does not throw)

## Non-Functional Requirements

- Audio loading should complete within 2 seconds for files under 50 MB
- Seek bar updates should be visually smooth (no visible lag)
- Memory: blob URL must be revoked on unmount to prevent memory leaks

## Architect Review

**Reviewer:** Claude (Architect)
**Date:** 2026-03-03
**Verdict:** REQUEST_CHANGES

### 1. Root Cause Validation

**Root Cause 1 (Event listeners with `[]` deps) -- CONFIRMED, with nuances.**

The spec correctly identifies the core issue. In `AudioPlayer.tsx`, the event listener `useEffect` at line 68 has `[]` as its dependency array. The `<audio>` element is conditionally rendered on line 152 (`{audioSrc && <audio ref={audioRef} src={audioSrc} />}`), which means:

- On initial mount, the component shows the loading spinner (line 127-136). The `<audio>` element does not exist in the DOM.
- The `useEffect(fn, [])` runs once on mount, reads `audioRef.current` as `null`, and exits immediately (`if (!audio) return`).
- When `audioSrc` is set (line 47), React re-renders, the `<audio>` element appears, but the `useEffect` never re-runs because its deps are `[]`.
- Result: `timeupdate`, `durationchange`, and `ended` listeners are never attached. Duration stays at 0, time counter never updates, play/pause visual state does not track `ended`.

The fix described (making the useEffect depend on `audioSrc`) is correct. However, the spec mentions `loadedmetadata` in REQ-2 and REQ-8 as a required event listener, but the actual implementation at line 73 only listens for `durationchange`, not `loadedmetadata`. This is not necessarily wrong -- `durationchange` fires when duration becomes available -- but the spec should either:
(a) Require adding a `loadedmetadata` listener to match REQ-2/REQ-8 text, or
(b) Remove `loadedmetadata` from REQ-2/REQ-8 to match reality. Since `durationchange` is sufficient for duration display, option (b) is recommended, but adding `loadedmetadata` as a belt-and-suspenders approach is harmless.

**Root Cause 2 (Chunks not deleted after concatenation) -- CONFIRMED.**

`concatenateSession()` in `audio-concatenation.ts` reads chunk files, concatenates them, re-muxes with ffmpeg, and deletes the `recording-raw.webm` temp file. But it never deletes the `chunk-*.ogg` files. This is a genuine resource leak -- for a 1-hour meeting at 3s timeslice, that is 1200 chunk files left on disk.

### 2. Additional Issues Found

**ISSUE A: `pruneOldChunks` causes data loss during long recordings (CRITICAL).**

`AudioStorage.pruneOldChunks()` (audio-storage.ts line 57-70) runs on every `saveChunk()` call and limits the session directory to 50 chunk files (MAX_CHUNK_FILES = 50). It preserves `chunk-000.ogg` (the EBML header) but deletes earlier chunks when the count exceeds 50.

This means for any recording longer than ~2.5 minutes (50 chunks x 3s timeslice = 150 seconds), chunks 1 through N-50 are deleted during recording. When `concatenateSession()` later runs, it calls `getChunkFiles()` which returns only the surviving chunks. The binary concatenation will join chunk-000 + chunk-051 + chunk-052 + ..., producing a corrupt or gap-filled audio file.

The spec does not identify this issue. The concatenation service will "succeed" (ffmpeg may or may not error on the gap), but playback will have missing audio segments. This is arguably a more severe bug than the two root causes identified.

**Recommendation:** The spec should add a REQ-10 or expand REQ-9 to address this. Options:
1. Remove the pruning entirely (chunks are small OGG/WebM fragments; 1200 x ~50KB = ~60MB is acceptable for a 1-hour meeting).
2. Only prune after concatenation succeeds (i.e., move pruning to post-concatenation, which is effectively what REQ-9 already asks for).
3. If pruning during recording is necessary for memory constraints, the concatenation service must use the cumulative buffer approach instead of reading chunk files.

**ISSUE B: MIME type mismatch -- `.ogg` extension vs WebM container (LOW RISK).**

Chunks are saved with `.ogg` extension (audio-storage.ts line 41) regardless of the actual MediaRecorder MIME type. The preferred MIME type list in audio-recorder.ts is `["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"]`. On Electron's Chromium, `audio/ogg;codecs=opus` is not typically supported by MediaRecorder (Chrome uses WebM containers). So the actual recording MIME type is likely `audio/webm;codecs=opus`, but chunks are saved as `.ogg`.

This does not cause a functional problem because:
- Binary concatenation does not care about the extension
- ffmpeg reads the container header, not the extension
- The `audio:readFile` handler correctly determines MIME type from the final `recording.webm` extension

However, the `.ogg` extension is misleading and could confuse debugging. The spec does not need to address this but should be aware.

**ISSUE C: `audio:readFile` returns `buffer.buffer` which may include extra bytes (LOW RISK).**

Line 347 of audio-handlers.ts:
```typescript
return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), mimeType };
```

This correctly handles the Node.js Buffer-to-ArrayBuffer conversion with offset/length slicing. The implementation is correct. No issue here.

**ISSUE D: No `loadedmetadata` listener (MINOR).**

As noted above, the implementation only listens for `durationchange`, not `loadedmetadata`. The `durationchange` event fires when the browser determines duration, which is sufficient. However, some WebM files may expose duration only after full decode (if the Duration element is at the end of the file). Since ffmpeg re-mux places Duration in the header (Segment/Info element), `durationchange` should fire immediately on `loadedmetadata`. No action required, but the spec should be consistent about which events are required.

**ISSUE E: Race condition between `setAudioSrc` and audio element loading (NOT A REAL ISSUE).**

There is no race condition. React's render cycle ensures:
1. `setAudioSrc(blobUrl)` triggers re-render
2. Re-render creates `<audio ref={audioRef} src={audioSrc} />`
3. After DOM commit, useEffect runs (if deps match)

With the fix (adding `audioSrc` to the event listener useEffect deps), the listener attachment happens in the same commit cycle as the audio element appearing. The browser then loads the src and fires `loadedmetadata`/`durationchange` while the listeners are already attached. No race.

**ISSUE F: `formatTime` does not guard against NaN/Infinity (MINOR).**

Line 8-11 of AudioPlayer.tsx:
```typescript
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
```

If `duration` is `NaN` or `Infinity` (e.g., if the WebM lacks duration metadata or ffmpeg fallback is used without re-mux), `formatTime(NaN)` returns `"NaN:aN"` and `formatTime(Infinity)` returns `"Infinity:aN"`. REQ-2.4 says "Duration MUST NOT display NaN or Infinity" but the current code does not enforce this. The fix should add a guard:

```typescript
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
```

The spec should list this as an acceptance criterion implementation detail.

**ISSUE G: `togglePlay` does not handle play() promise rejection (MINOR).**

Line 87-97: `await audioRef.current.play()` can throw (e.g., if autoplay policy blocks it, though unlikely in Electron). If it throws, `setIsPlaying(true)` on line 95 is never reached, which is correct. However, the error is unhandled and will appear as an uncaught promise rejection. A try/catch should wrap the play call.

### 3. Fix Approach Assessment

**Fix 1 (Event listener useEffect depends on `audioSrc`) -- SOUND.**

Changing `useEffect(fn, [])` to `useEffect(fn, [audioSrc])` is the correct fix. When `audioSrc` transitions from `null` to a blob URL, React re-renders, the `<audio>` element appears in the DOM, and the useEffect re-runs. At that point `audioRef.current` is non-null and listeners are attached.

One consideration: the cleanup function from the previous useEffect invocation will run before the new one. Since the previous run exited early (audio was null, no listeners attached, no cleanup returned), this is fine. But if `sessionId` changes and triggers a new audio load, the old listeners need to be cleaned up. The current structure handles this correctly because:
1. The first useEffect (line 24) creates a new blob URL per sessionId
2. The second useEffect cleanup removes listeners from the old audio element
3. React unmounts the old `<audio>` and mounts a new one

**Fix 2 (Add chunk deletion to `concatenateSession()`) -- SOUND, with caveats.**

Adding chunk deletion after successful concatenation is correct. However, given ISSUE A above (pruneOldChunks already deletes chunks during recording), the deletion code must handle the case where some chunk files no longer exist. The spec's instruction to "log a warning but do not throw" on deletion failure covers this.

**However**, the spec should explicitly address ISSUE A (pruning during recording) as a prerequisite or companion fix. Without fixing the pruning, the concatenated audio will have gaps for long recordings regardless of whether chunks are cleaned up afterward.

### 4. Risks and Edge Cases

1. **Long recordings (>2.5 min):** ISSUE A above. Pruning destroys chunks needed for concatenation. This is the highest-priority issue.

2. **Session directory already has `recording.webm`:** The concatenation service deletes stale outputs at line 43-47 before re-concatenating. If `audio:readFile` is called and `recording.webm` already exists (from a previous concatenation), it reads it directly without re-concatenating. This is correct behavior.

3. **Concurrent playback requests:** If `audio:readFile` is called while concatenation is already in progress (e.g., user rapidly switches sessions), there is no lock/mutex. Two concurrent `concatenateSession()` calls for the same session could race. This is unlikely in practice but could produce a corrupt file. Consider adding a per-session concatenation lock.

4. **Blob URL memory:** The spec correctly requires blob URL revocation on unmount (REQ-1.5). The implementation handles this via the cleanup function at line 59-65. However, if `sessionId` changes (selecting a different session), the old blob URL is revoked in the cleanup, and a new one is created. This is correct.

5. **ffmpeg re-mux fallback:** If ffmpeg fails, the concatenation service falls back to `recording-raw.webm` (renamed to `recording.webm`). This raw file lacks Duration metadata, so the browser will report `duration: Infinity` until it finishes buffering the entire file. The `formatTime` guard (ISSUE F) would prevent displaying "Infinity" in this case.

### 5. Summary of Required Changes

| Priority | Item | Action |
|----------|------|--------|
| **CRITICAL** | ISSUE A: `pruneOldChunks` deletes chunks needed for concatenation | Add REQ-10 or modify REQ-9 to address pruning. Either disable pruning during recording or switch concatenation to not rely on chunk files. |
| **MEDIUM** | ISSUE F: `formatTime` NaN/Infinity guard | Add to implementation requirements under REQ-2 |
| **LOW** | ISSUE G: Unhandled play() rejection | Add try/catch to togglePlay, mention in REQ-5 |
| **EDITORIAL** | `loadedmetadata` inconsistency | Either add the listener or remove from REQ-2/REQ-8 text. Pick one. |
| **EDITORIAL** | AC for formatTime guard | Add AC-11: `formatTime` returns "0:00" for NaN/Infinity inputs |
