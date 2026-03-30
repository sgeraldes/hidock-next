# SPEC-005: Audio Player & Waveform UX

## Problem Statement
The current audio player and waveform visualization in HiDock Next suffer from several UX issues that hinder usability. The player is invisible until a user explicitly clicks "Play", even if a recording is selected. Clicking "Stop" in the main panel not only stops the audio but also clears the recording selection entirely, which is unexpected. Furthermore, waveform loading is currently coupled too tightly with playback state, leading to unnecessary delays and confusing UI states where the waveform area remains empty or shows incorrect "Select a recording" messages even when a recording is active in the viewer.

## Bugs Addressed
- **BUG-011 (P2): Audio player/waveform not visible when recording selected**
  - Users must click "Play" to see the player interface.
  - "Select a recording to view waveform" displays even when a recording *is* selected if it hasn't been played yet.
  - Root Cause: `SourceReader.tsx` uses `{canPlay && isPlaying && ...}` to guard the `AudioPlayer` component, and `AudioPlayer.tsx` logic for showing the loading skeleton or waveform is tied to `currentlyPlayingId`.
- **BUG-012 (P1): Stop button deselects recording**
  - In `Library.tsx`, `handleClosePlayer` calls `audioControls.stop()` and `setSelectedSourceId(null)`.
  - The `SourceReader` component's `onStop` prop is wired to this `handleClosePlayer` function, conflating "stop audio" with "dismiss viewer/player".
  - This results in the user losing their place in the library simply by wanting to stop playback.

## User Stories
- As a user, when I select a recording, I want to see the audio player interface and the waveform immediately (if available locally) so I can see the visual structure of the audio before playing.
- As a user, when I click the "Stop" button in the audio player, I want the audio to stop and return to the beginning, but I want the recording to stay selected in the viewer so I can continue reading the transcript or perform other actions.
- As a user, I want a clear "Close" or "Dismiss" action if I actually want to hide the player/viewer and return to the empty state.

## Current Behavior (Broken)
1. User selects a recording in the Library list.
2. The `SourceReader` opens on the right, but the top area where the waveform should be is empty or missing (hidden by `isPlaying` check).
3. User clicks "Play".
4. The `AudioPlayer` component is finally rendered.
5. The waveform starts loading (because `isPlaying` triggered the render).
6. User clicks "Stop" (the square icon) in the player or center panel.
7. `handleClosePlayer` is triggered, which stops audio AND sets `selectedSourceId` to `null`.
8. The entire `SourceReader` disappears, and the UI returns to the "No recording selected" state.

## Expected Behavior (Target)
1. User selects a recording in the Library list.
2. The `SourceReader` opens. The `AudioPlayer` is rendered immediately at the top (if the file is local).
3. The waveform starts loading automatically in the background as soon as the row is selected.
4. User sees the waveform and can even seek to a specific spot before clicking play.
5. User clicks "Play" → audio starts.
6. User clicks "Stop" → audio stops, playhead returns to 0, but `SourceReader` stays open and the recording remains selected.
7. User clicks a separate "Close" button (the 'X') → `SourceReader` closes and selection is cleared.

## Acceptance Criteria
- [ ] The `AudioPlayer` (including waveform area) is visible in `SourceReader` whenever a recording with a local file is selected, regardless of `isPlaying` state.
- [ ] Waveform loading begins immediately upon selecting a recording in the library list.
- [ ] Clicking the "Stop" (Square) button in `AudioPlayer` stops playback and resets the current time to 0, but maintains the current selection.
- [ ] Clicking the "Close" (X) button in `AudioPlayer` (or a dedicated close button in the panel) stops playback and deselects the recording (`setSelectedSourceId(null)`).
- [ ] The "Select a recording to view waveform" placeholder in `AudioPlayer` is only shown when no recording ID is passed to the component.
- [ ] The loading skeleton for the waveform shows correctly while the waveform is being generated, tied to the `waveformLoadingId` rather than `currentlyPlayingId`.

## Technical Approach

### Waveform on Selection (Not Just Playback)
- **Decouple from `isPlaying`**: Remove the `isPlaying` requirement in `SourceReader.tsx` for rendering the `AudioPlayer`. The condition should simply be `canPlay` (meaning it has a local path).
- **Auto-load on Select**: Ensure `Library.tsx`'s `handleRowClick` correctly calls `audioControls.loadWaveformOnly` if the recording is local. (Note: Existing logic does this, but `AudioPlayer` isn't visible to show the result until play is clicked).
- **Store Updates**: `AudioPlayer` should use `waveformLoadedForId` and `waveformLoadingId` to determine what to show, instead of relying on `currentlyPlayingId`.

### Stop vs Close Separation
- **Modify `AudioPlayer` Props**: Ensure `AudioPlayer` has distinct callbacks for `onStop` (reset playback) and `onClose` (deselect).
- **Update `Library.tsx`**: 
  - `handleStopCallback`: Should only call `audioControls.stop()`.
  - `handleClosePlayer`: Should remain as is (stop + deselect) but only be called by "Close" actions.
- **Wiring in `SourceReader`**:
  - Pass `onStop` to the player's stop button logic.
  - Add or maintain an `onClose` prop that triggers the selection clear.

### Player Visibility Logic
- In `SourceReader.tsx`, change:
  ```tsx
  {canPlay && isPlaying && ( ... )}
  ```
  to:
  ```tsx
  {canPlay && ( ... )}
  ```
- In `AudioPlayer.tsx`, update the conditional rendering:
  - If `waveformData` exists AND matches the `id` of the selected recording → Show waveform.
  - Else if `waveformLoadingId` matches the selected recording → Show skeleton.
  - Else → Show "Failed" or "Processing" placeholder.

### State Model
1. **Selected**: `selectedSourceId` is set. `AudioPlayer` mounts.
2. **Loading Waveform**: `waveformLoadingId === selectedSourceId`. `AudioPlayer` shows pulse animation.
3. **Waveform Ready**: `waveformLoadedForId === selectedSourceId`. `AudioPlayer` shows `WaveformCanvas`.
4. **Playing**: `isPlaying === true`. Playhead moves.
5. **Paused**: `isPlaying === false`, `currentTime > 0`. Playhead stays.
6. **Stopped**: `isPlaying === false`, `currentTime === 0`. Playhead resets to start.
7. **Deselected**: `selectedSourceId === null`. `SourceReader` unmounts.

## UI/UX Requirements
- **Idle State**: When selected but not playing, the player area should show the full waveform, "00:00 / [Duration]", and a Play button.
- **Button States**: 
  - Play button toggles between Play/Pause icons.
  - Stop button (Square) is enabled whenever `currentTime > 0` or `isPlaying` is true.
  - Close button (X) is always visible in the player header or top-right.
- **Waveform Interaction**: Users should be able to click on the waveform to "pre-seek" the audio before they even hit Play.

## Testing Strategy
- **Manual Verification**:
  - Select row → Verify player appears immediately with loading animation.
  - Verify waveform appears once loaded.
  - Click Play → Audio starts.
  - Click Stop → Audio stops, time goes to 0, player stays visible.
  - Click Close → Player and reader disappear.
- **Automated Tests**:
  - Test `useAudioPlayback` to ensure `stopAudio` does not clear `selectedSourceId` (it shouldn't, as it's a playback hook, but verify store actions).
  - Component test for `AudioPlayer` to ensure correct rendering based on `waveformLoadingId`.

## Dependencies & Risks
- **Performance**: Loading waveforms immediately on selection might add slight overhead if the user is rapidly clicking through rows. However, the current `loadWaveformOnly` uses an `AbortController` which mitigates this.
- **Memory**: Ensure `playbackWaveformData` is cleared when switching recordings to avoid holding multiple large Float32Arrays in the UI store.

## Out of Scope
- Waveform generation for remote files (must be downloaded first).
- Editing/Trimming audio from the waveform.
- Multi-track waveform display.
