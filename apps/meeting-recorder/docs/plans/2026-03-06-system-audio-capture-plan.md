# System Audio Capture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture system audio output (loopback) alongside the microphone and mix them into a single stream for transcription — so the AI hears all participants in a call, not just the local user.

**Architecture:** Use Electron's `session.setDisplayMediaRequestHandler` to intercept `getDisplayMedia()` calls in the renderer without showing a picker dialog. On Windows, pass `audio: 'loopback'` for automatic WASAPI loopback. On macOS, let the system handle the audio permission picker. Mix mic stream + system audio stream using `AudioContext` in the renderer before passing to `MediaRecorder`. If system audio capture fails for any reason, throw and block recording — do NOT fall back to mic-only.

**Tech Stack:** Electron 39 (main), `desktopCapturer` (main), `navigator.mediaDevices.getDisplayMedia` (renderer), `AudioContext` / `createMediaStreamDestination` (renderer Web Audio API), Vitest (tests)

**Design doc:** `docs/plans/2026-03-06-system-audio-capture-design.md`

---

## Task 1: Register display media handler in main process

**Why first:** The renderer's `getDisplayMedia()` calls will fail if this handler isn't registered before the window loads.

**Files:**
- Modify: `electron/main/services/window-manager.ts`

**Step 1: Read the file**

Read `electron/main/services/window-manager.ts` to understand `createMainWindow()`.

**Step 2: Add the handler after BrowserWindow creation**

In `createMainWindow()`, immediately after `const win = new BrowserWindow({...})`, add:

```typescript
import { BrowserWindow, desktopCapturer, screen } from "electron";
```

Then after the `BrowserWindow` is constructed:

```typescript
  // SPEC-008: Intercept getDisplayMedia() to provide system audio loopback.
  // On Windows: audio: 'loopback' = WASAPI loopback (all system audio, automatic).
  // On macOS/Linux: audio: source = system audio picker (user grants once).
  win.webContents.session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        if (sources.length === 0) {
          callback({});
          return;
        }
        const audioConfig =
          process.platform === "win32" ? "loopback" : sources[0];
        callback({ video: sources[0], audio: audioConfig as "loopback" });
      }).catch(() => {
        callback({});
      });
    },
  );
```

**Step 3: Verify TypeScript compiles**

```bash
cd apps/meeting-recorder
npm run typecheck
```

Expected: 0 errors (or only pre-existing errors unrelated to this change).

**Step 4: Commit**

```bash
git add apps/meeting-recorder/electron/main/services/window-manager.ts
git commit -m "feat(audio): register setDisplayMediaRequestHandler for system audio loopback"
```

---

## Task 2: Refactor AudioRecorder to capture and mix system audio

**Why TDD matters here:** The audio mixing logic is subtle. Tests verify that `getDisplayMedia` is called, video tracks are stopped, and the mixed destination stream (not the raw mic stream) goes to `MediaRecorder`.

**Files:**
- Modify: `src/services/audio-recorder.ts`
- Modify: `src/__tests__/audio-recorder.test.ts`

### Step 1: Add `getDisplayMedia` mock to the test file

Open `src/__tests__/audio-recorder.test.ts`. After the existing `mockGetUserMedia` setup, add:

```typescript
const mockDisplayStream = {
  getTracks: () => [
    { kind: 'video', stop: vi.fn() },
    { kind: 'audio', stop: vi.fn() },
  ],
  getVideoTracks: () => [{ kind: 'video', stop: vi.fn() }],
  getAudioTracks: () => [{ kind: 'audio', stop: vi.fn() }],
}

const mockGetDisplayMedia = vi.fn().mockResolvedValue(mockDisplayStream)

Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia: mockGetUserMedia,
    getDisplayMedia: mockGetDisplayMedia,
  },
  writable: true,
})
```

Also mock `AudioContext` since it's a browser API not available in jsdom/node:

```typescript
const mockConnect = vi.fn()
const mockClose = vi.fn().mockResolvedValue(undefined)
const mockDestination = {
  stream: {
    getTracks: () => [],
    getVideoTracks: () => [],
    getAudioTracks: () => [],
  },
}

const mockCreateMediaStreamSource = vi.fn().mockReturnValue({ connect: mockConnect })
const mockCreateMediaStreamDestination = vi.fn().mockReturnValue(mockDestination)

// @ts-expect-error - global mock
global.AudioContext = vi.fn().mockImplementation(() => ({
  createMediaStreamSource: mockCreateMediaStreamSource,
  createMediaStreamDestination: mockCreateMediaStreamDestination,
  close: mockClose,
}))
```

### Step 2: Write failing tests for system audio behavior

In `src/__tests__/audio-recorder.test.ts`, add a new describe block:

```typescript
describe('system audio capture', () => {
  it('calls getDisplayMedia during startRecording', async () => {
    await recorder.startRecording()
    expect(mockGetDisplayMedia).toHaveBeenCalledWith({
      audio: true,
      video: { width: 1, height: 1 },
    })
  })

  it('stops video tracks from display stream immediately', async () => {
    const videoTrackStop = vi.fn()
    mockGetDisplayMedia.mockResolvedValueOnce({
      getTracks: () => [],
      getVideoTracks: () => [{ kind: 'video', stop: videoTrackStop }],
      getAudioTracks: () => [{ kind: 'audio', stop: vi.fn() }],
    })
    await recorder.startRecording()
    expect(videoTrackStop).toHaveBeenCalled()
  })

  it('creates AudioContext and mixes mic + system audio', async () => {
    await recorder.startRecording()
    expect(global.AudioContext).toHaveBeenCalled()
    expect(mockCreateMediaStreamSource).toHaveBeenCalledTimes(2) // mic + system
    expect(mockConnect).toHaveBeenCalledTimes(2) // both connected to destination
  })

  it('uses mixed destination stream for MediaRecorder, not raw mic stream', async () => {
    await recorder.startRecording()
    // The MediaRecorder should be constructed with the destination stream,
    // not directly with the mic stream or display stream.
    const constructedWith = (global.MediaRecorder as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(constructedWith).toBe(mockDestination.stream)
  })

  it('throws if getDisplayMedia rejects — blocks recording', async () => {
    mockGetDisplayMedia.mockRejectedValueOnce(new Error('Permission denied'))
    await expect(recorder.startRecording()).rejects.toThrow('System audio capture failed')
  })

  it('releases mic stream when getDisplayMedia fails', async () => {
    const micTrackStop = vi.fn()
    mockGetUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: micTrackStop }],
    })
    mockGetDisplayMedia.mockRejectedValueOnce(new Error('NotAllowed'))
    await expect(recorder.startRecording()).rejects.toThrow()
    expect(micTrackStop).toHaveBeenCalled()
  })

  it('closes AudioContext on dispose', async () => {
    await recorder.startRecording()
    recorder.dispose()
    expect(mockClose).toHaveBeenCalled()
  })
})
```

Also update the `MockMediaRecorder` constructor to accept `stream` as first arg and record it:
```typescript
class MockMediaRecorder {
  // add:
  stream: MediaStream | null = null
  constructor(stream: MediaStream, _options: { mimeType: string }) {
    this.stream = stream
  }
  // ... rest unchanged
}
```

### Step 3: Run tests to confirm they fail

```bash
cd apps/meeting-recorder
npx vitest run src/__tests__/audio-recorder.test.ts --reporter=verbose
```

Expected: the new system audio tests FAIL (`getDisplayMedia is not a function`, `AudioContext is not defined`, etc.).

### Step 4: Implement system audio capture in AudioRecorder

Open `src/services/audio-recorder.ts`. Make the following changes:

**4a. Add new instance variables** (after `private disposed = false`):

```typescript
  /** Raw microphone stream (source 1 for mixing). */
  private micStream: MediaStream | null = null;
  /** Raw system audio stream from getDisplayMedia (source 2 for mixing). */
  private displayStream: MediaStream | null = null;
  /** AudioContext used for mixing. Closed on dispose(). */
  private audioContext: AudioContext | null = null;
```

**4b. Replace `startRecording()` with the two-stream capture approach.**

Replace the entire `startRecording()` method body with:

```typescript
  async startRecording(): Promise<void> {
    if (this.state !== AudioRecorderState.Idle) {
      throw new Error(`Cannot start recording in state: ${this.state}`);
    }
    if (this.disposed) {
      console.warn('[AudioRecorder] startRecording called on disposed recorder, ignoring');
      return;
    }

    // Step 1: Capture microphone (raw, no browser processing)
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    if (this.disposed) {
      console.warn('[AudioRecorder] Disposed during getUserMedia, releasing mic stream');
      micStream.getTracks().forEach((t) => t.stop());
      return;
    }

    // Step 2: Capture system audio (loopback via setDisplayMediaRequestHandler in main process)
    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1 },
      });
    } catch (err) {
      // Release mic before rethrowing — recording is blocked, not degraded
      micStream.getTracks().forEach((t) => t.stop());
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`System audio capture failed: ${reason}`);
    }

    // Stop video tracks — only audio is needed
    displayStream.getVideoTracks().forEach((t) => t.stop());

    if (this.disposed) {
      console.warn('[AudioRecorder] Disposed during getDisplayMedia, releasing streams');
      micStream.getTracks().forEach((t) => t.stop());
      displayStream.getAudioTracks().forEach((t) => t.stop());
      return;
    }

    this.micStream = micStream;
    this.displayStream = displayStream;

    // Step 3: Mix mic + system audio using Web Audio API
    const audioCtx = new AudioContext();
    this.audioContext = audioCtx;

    const micSource = audioCtx.createMediaStreamSource(micStream);
    const sysSource = audioCtx.createMediaStreamSource(displayStream);
    const destination = audioCtx.createMediaStreamDestination();

    micSource.connect(destination);
    sysSource.connect(destination);

    // The mixed stream is what MediaRecorder records
    this.stream = destination.stream;

    this.mimeType = this.selectMimeType();
    this.chunkIndex = 0;
    this.pendingChunks = 0;

    this.stoppedPromise = new Promise<void>((resolve) => {
      this.stoppedResolve = resolve;
    });

    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      console.log(`[AudioRecorder] ondataavailable fired: size=${event.data.size}, type=${event.data.type}`);
      if (event.data.size === 0) {
        console.warn('[AudioRecorder] Empty chunk, skipping');
        return;
      }
      if (this.pendingChunks >= this.maxQueueSize) {
        console.warn(`[AudioRecorder] Queue full (${this.pendingChunks}/${this.maxQueueSize}), dropping chunk`);
        return;
      }
      const idx = this.chunkIndex++;
      this.pendingChunks++;
      console.log(`[AudioRecorder] Sending chunk ${idx} (${event.data.size} bytes) to onChunk callback`);
      this.onChunk?.(event.data, idx);
      if (this.pendingChunks >= this.pauseThreshold && this.mediaRecorder?.state === "recording") {
        console.warn(`[AudioRecorder] Backpressure: pausing at ${this.pendingChunks} pending chunks`);
        this.mediaRecorder.pause();
        this.state = AudioRecorderState.Paused;
      }
    };

    this.mediaRecorder.onerror = (event: Event) => {
      console.error('[AudioRecorder] MediaRecorder error event:', event);
      const error = event instanceof ErrorEvent ? event.error : new Error("MediaRecorder error");
      this.onError?.(error);
    };

    this.mediaRecorder.onstop = () => {
      console.log('[AudioRecorder] MediaRecorder stopped, releasing stream');
      this.releaseStream();
      this.stoppedResolve?.();
      this.stoppedResolve = null;
    };

    console.log(`[AudioRecorder] Starting MediaRecorder with timeslice=${this.timesliceMs}ms, mimeType=${this.mimeType}`);
    this.mediaRecorder.start(this.timesliceMs);
    this.state = AudioRecorderState.Recording;
    console.log(`[AudioRecorder] MediaRecorder state: ${this.mediaRecorder.state}`);
  }
```

**4c. Replace `releaseStream()` to clean up all three streams + AudioContext:**

```typescript
  private releaseStream(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.displayStream) {
      this.displayStream.getTracks().forEach((t) => t.stop());
      this.displayStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    // The mixed destination stream (this.stream) is owned by the AudioContext;
    // its tracks stop when the context closes.
    this.stream = null;
  }
```

### Step 5: Run tests — verify they pass

```bash
npx vitest run src/__tests__/audio-recorder.test.ts --reporter=verbose
```

Expected: All tests pass, including all new system audio tests.

**Step 6: Run full suite to check for regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -8
```

Expected: All tests pass.

**Step 7: Commit**

```bash
git add apps/meeting-recorder/src/services/audio-recorder.ts \
        apps/meeting-recorder/src/__tests__/audio-recorder.test.ts
git commit -m "feat(audio): mix mic + system audio using AudioContext and getDisplayMedia"
```

---

## Task 3: Update error messages in useAudioCapture for system audio failures

The existing `useAudioCapture.ts` already catches errors from `startRecording()` and shows notifications. It needs specific messaging for system audio failures.

**Files:**
- Modify: `src/hooks/useAudioCapture.ts`

### Step 1: Replace the error notification block in `start()`

Find the `catch` block in `useAudioCapture.start()` (lines 88-109). Replace the notification logic:

```typescript
    } catch (err) {
      console.error('[useAudioCapture] Recording failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof DOMException ? err.name : "";
      setError(msg);

      if (msg.includes("System audio capture failed")) {
        // Main failure mode: system audio unavailable (permission, platform, no sources)
        const inner = msg.replace("System audio capture failed: ", "");
        if (inner.includes("NotAllowed") || inner.includes("permission") || inner.includes("denied")) {
          showNotification(
            "error",
            "Screen recording permission denied. Grant permission in System Settings → Privacy → Screen Recording, then restart the app.",
            10000,
          );
        } else {
          showNotification(
            "error",
            "System audio capture is unavailable on this device. This app requires system audio to record all meeting participants.",
            10000,
          );
        }
      } else if (errName === "NotAllowedError" || msg.includes("permission")) {
        showNotification(
          "error",
          "Microphone permission denied. Please enable microphone access and try again.",
          7000,
        );
      } else if (errName === "NotFoundError") {
        showNotification(
          "error",
          "No microphone found. Please connect a microphone and try again.",
        );
      } else {
        showNotification("error", `Failed to start recording: ${msg}`);
      }
    }
```

### Step 2: TypeScript check

```bash
npm run typecheck
```

Expected: 0 errors.

### Step 3: Commit

```bash
git add apps/meeting-recorder/src/hooks/useAudioCapture.ts
git commit -m "feat(audio): surface system audio permission errors with clear user messages"
```

---

## Task 4: Manual verification checklist

These steps confirm the feature works end-to-end. Run after the app restarts with the new code.

**Step 1: Restart the dev server**

```bash
cd apps/meeting-recorder
npm run dev
```

The Electron main process must restart (not just HMR) because `window-manager.ts` changed.

**Step 2: Check console for handler registration**

In the Electron DevTools (Ctrl+Shift+I), confirm no errors related to `setDisplayMediaRequestHandler`.

**Step 3: Start a recording**

Click Record. Expected:
- No picker dialog appears
- Recording starts immediately
- Console shows `[AudioRecorder] Starting MediaRecorder` with the mixed stream

**Step 4: Verify system audio is captured**

While recording, play audio through the system (YouTube, music player, etc.) and speak into the mic. Stop recording. In the transcript, both the played audio AND the microphone audio should be transcribed.

**Step 5: Verify error on permission denial (macOS only)**

On macOS, if Screen Recording permission is not granted, clicking Record should:
- Show a notification: "Screen recording permission denied..."
- NOT start recording silently with mic-only

---

## Task 5: TypeScript types for `setDisplayMediaRequestHandler` (if needed)

Electron 39 types should include `setDisplayMediaRequestHandler`. If TypeScript reports errors on that call, add a type assertion or ambient declaration.

**Files:**
- Modify: `electron/main/services/window-manager.ts` (add cast if needed)

If `session.setDisplayMediaRequestHandler` isn't typed in your electron version's types:

```typescript
// Temporary cast until @types/electron catches up
(win.webContents.session as unknown as {
  setDisplayMediaRequestHandler: (
    handler: (
      request: unknown,
      callback: (response: { video?: unknown; audio?: unknown | 'loopback' }) => void
    ) => void
  ) => void;
}).setDisplayMediaRequestHandler((_request, callback) => {
  // ... existing implementation
});
```

---

## Summary

| Task | File | What changes |
|------|------|------|
| 1 | `window-manager.ts` | Register `setDisplayMediaRequestHandler` — intercepts `getDisplayMedia`, provides loopback |
| 2 | `audio-recorder.ts` | Two-stream capture + AudioContext mix; throw on system audio failure |
| 2 | `audio-recorder.test.ts` | Mock `getDisplayMedia` + `AudioContext`; tests for mixing, video stop, error throw |
| 3 | `useAudioCapture.ts` | Specific error messages for system audio failures |
| 4 | — | Manual end-to-end verification |
| 5 | `window-manager.ts` | TypeScript cast if needed |

**Platform behavior after this change:**
- **Windows:** Automatic WASAPI loopback — no user interaction
- **macOS:** One-time screen recording permission picker — user must enable audio
- **Linux:** `getDisplayMedia` with PipeWire portal (may work on modern distros); explicit error if not
