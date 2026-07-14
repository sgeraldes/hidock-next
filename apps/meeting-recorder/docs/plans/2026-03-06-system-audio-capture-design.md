# System Audio Capture Design

**Date:** 2026-03-06
**Status:** Approved
**Spec:** SPEC-008 (to be created)

---

## Problem

The app captures only the microphone. In a meeting or call, the other participants' voices play through the system speakers and are not recorded. The AI transcription pipeline only hears the local user — missing all incoming dialogue. This makes the meeting recorder functionally useless for multi-party calls.

## Requirements

1. Capture system audio output (WASAPI loopback) alongside the microphone
2. Mix both streams into a single audio stream for `MediaRecorder`
3. If system audio capture fails for any reason, **block recording and surface an error** — do NOT silently fall back to mic-only
4. No user interaction required during normal operation (fully automatic)
5. Works on Windows (target platform)

## Architecture

### Audio Mixing Pipeline

```
getUserMedia (mic)      ──► AudioContext.createMediaStreamSource() ──┐
getDisplayMedia (system) ──► AudioContext.createMediaStreamSource() ──┼──► createMediaStreamDestination() ──► MediaRecorder ──► chunks
                                                                       │
                                                                (stop video tracks immediately)
```

### Why This Approach

Electron 39 supports `session.setDisplayMediaRequestHandler` with `audio: 'loopback'`. This:
- Intercepts `getDisplayMedia()` calls from the renderer before any system picker dialog appears
- Provides Windows WASAPI loopback audio (all system audio output)
- Requires no user interaction
- Needs no new IPC channels

This is the official Electron API for system audio capture on Windows.

---

## Implementation

### File 1: `electron/main/services/window-manager.ts`

After `BrowserWindow` is created, register the display media handler on its session:

```typescript
import { BrowserWindow, desktopCapturer, session } from 'electron'

win.webContents.session.setDisplayMediaRequestHandler(
  (request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // Use the first screen source; audio: 'loopback' = Windows WASAPI loopback
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => {
      callback({});  // Let the renderer handle the empty result as an error
    });
  }
);
```

This intercepts before any dialog shows. `audio: 'loopback'` is Windows-only and captures all system audio.

### File 2: `src/services/audio-recorder.ts`

Replace `startRecording()` with a two-stream capture approach:

```typescript
async startRecording(): Promise<void> {
  // 1. Capture microphone
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  });

  // 2. Capture system audio via getDisplayMedia (intercepted by main process handler)
  //    Throws if system audio is unavailable — caller must handle this.
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
  });
  // Stop video tracks — we only need audio
  displayStream.getVideoTracks().forEach(t => t.stop());

  // 3. Mix mic + system audio using Web Audio API
  const audioCtx = new AudioContext();
  const micSource = audioCtx.createMediaStreamSource(micStream);
  const sysSource = audioCtx.createMediaStreamSource(displayStream);
  const destination = audioCtx.createMediaStreamDestination();
  micSource.connect(destination);
  sysSource.connect(destination);

  // 4. Record the mixed stream
  this.stream = destination.stream;
  // ... existing MediaRecorder setup ...
}
```

Key: if `getDisplayMedia` rejects (system audio unavailable), the error propagates up to the caller (`useAudioCapture.ts`), which surfaces it to the UI.

### File 3: `src/hooks/useAudioCapture.ts`

The existing error handler in `startRecording()` catches the thrown error. Update it to pass the error message to the UI (via `onError` callback or a new `startError` state field).

### File 4: `src/__tests__/audio-recorder.test.ts`

New tests:
1. `startRecording()` calls `getDisplayMedia` and stops video tracks
2. Mixed stream is used for `MediaRecorder` (not just mic stream)
3. If `getDisplayMedia` rejects, `startRecording()` throws (error propagates)
4. Mic stream is released on `dispose()` even if `getDisplayMedia` had already succeeded

---

## Error Handling

If `getDisplayMedia` fails:
- `startRecording()` throws
- `useAudioCapture.start()` catches the error
- An error message is set in the recording state
- The recording UI shows the error and blocks starting

**Error message to show:** "System audio capture unavailable. Check that the app has screen recording permissions, then try again."

---

## Platform Strategy

System audio capture works differently per OS. The app must detect the platform and use the appropriate mechanism.

### Windows — Fully Automatic

`audio: 'loopback'` in `setDisplayMediaRequestHandler` = Windows WASAPI loopback.
No user interaction required. Captures all system audio output automatically.

### macOS — One-time User Permission

macOS requires an explicit user permission grant for system audio capture (Screen Recording permission + the "Share audio" toggle in the display picker). There is no way to fully automate this.

**Approach:**
1. `setDisplayMediaRequestHandler` is set with `video: sources[0]` (auto-selects first screen)
2. `getDisplayMedia({ audio: true, video: true })` is called from the renderer
3. On first use, macOS shows a one-time permission dialog — the user must enable the "Share audio" toggle
4. After granting, subsequent recordings capture system audio automatically
5. If the user declines: recording is blocked with a message explaining the required permission

**One-time onboarding:** Before the first recording on macOS, show a setup screen explaining the permission that will be requested.

### Linux — Not Supported in This Phase

Linux audio capture (PipeWire/PulseAudio loopback) requires either:
- A virtual loopback sink (user must configure PulseAudio/PipeWire manually)
- Or a native addon (complex, out of scope)

**Approach for Linux:** `getDisplayMedia` with `audio: true` — on modern Linux with PipeWire this may work via the xdg-desktop-portal. If it fails, show a clear error: "System audio capture is not supported on your Linux distribution. Configure a PulseAudio loopback sink and try again."

### Platform Detection

In the main process (`setDisplayMediaRequestHandler` setup):
```typescript
import { platform } from 'process'

// Windows: auto loopback, macOS: screen picker with audio, Linux: best-effort portal
const audioConfig = platform === 'win32' ? 'loopback' : sources[0];
callback({ video: sources[0], audio: audioConfig });
```

---

## What Does NOT Change

- Audio chunk format (WebM/Opus) — unchanged
- IPC channel for sending chunks — unchanged
- Transcription pipeline — unchanged
- No new IPC handlers needed
