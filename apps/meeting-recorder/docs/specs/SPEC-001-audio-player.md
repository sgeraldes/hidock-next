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

1. Audio element event listeners (`timeupdate`, `durationchange`, `loadedmetadata`, `ended`) MUST be attached AFTER the `<audio>` element exists in the DOM
2. If the `<audio>` element is conditionally rendered (e.g., waiting for blob URL), listeners MUST be attached when the element appears, not on initial mount
3. Listeners MUST be cleaned up when the component unmounts

### REQ-9: Chunk Cleanup After Concatenation

1. After `AudioConcatenation.concatenateSession()` successfully produces `recording.webm`, the individual `chunk-*.ogg` files MUST be deleted
2. The `recording-raw.webm` temporary file MUST also be deleted (already implemented)
3. If deletion fails, log a warning but do not throw — the concatenated file is the source of truth
4. Chunk files are only needed during the recording session for streaming — once concatenated, they are redundant

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
