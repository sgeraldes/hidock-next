# Phase 7: Integration Plan

> Wiring all Phase 1-6 components into a working Meeting Assistant application.

## Current State

The app has all individual services built but none are connected:
- `electron\main\index.ts` initializes DB, hydrates credentials, creates the main window, registers IPC handlers, and sets up the tray. No services are instantiated.
- IPC handlers for suggestions, screenshots, notes, and knowledge base use a `setService()` pattern -- they hold a `_service` reference that is `null` until explicitly wired.
- Session handlers use the in-memory `SessionManager` singleton but never trigger audio capture, transcription, or any downstream pipeline.
- Transcript handlers are stub TODO implementations returning empty arrays.
- Audio capture classes (`MicCapture`, `SystemAudioCapture`, `AudioMixer`, `ChunkRecorder`) use Web APIs (`getUserMedia`, `MediaRecorder`, `AudioContext`) and **must run in the renderer process**, not main.
- Transcription (`TranscriptionPipeline`, `CohereEngine`, `Chirp3Engine`) runs in the main process (Node.js child processes / HTTP calls).
- AI provider services (`createProvider`, `embed`) run in the main process.
- All LLM-dependent services (`SuggestionEngine`, `ScreenCaptureService`, `NotesGenerator`) accept a `LanguageModel` via `setModel()` but none have one set.

---

## Part A: Service Orchestration

### A.1 Architecture: Renderer-Main Split

The critical architectural constraint is that **audio capture runs in the renderer** while **transcription and all AI services run in main**. The data flow crosses the IPC boundary:

```
RENDERER PROCESS                          MAIN PROCESS
==================                        ==================
MicCapture.start()
  -> MediaStream
SystemAudioCapture.start()
  -> MediaStream
AudioMixer.addSource(mic, system)
  -> mixed MediaStream
ChunkRecorder.start(mixedStream)
  -> AudioChunk (Blob)
  -> IPC send "audio:chunk" ───────────>  SessionOrchestrator.onAudioChunk()
                                            -> SilenceDetector.analyze(buffer)
                                            -> TranscriptionPipeline.collect(buffer)
                                            -> insertTranscriptSegment() to DB
                                            -> broadcastToAllWindows("transcript:newSegments")
  <- IPC receive "transcript:newSegments" <── broadcast
  -> update UI transcript view
```

### A.2 SessionOrchestrator Class

**File:** `electron\main\services\session-orchestrator.ts`

This is the central wiring class. It does NOT own service logic -- it coordinates existing services.

```typescript
class SessionOrchestrator {
  // Owned service instances
  private sessionManager: SessionManager
  private transcriptionPipeline: TranscriptionPipeline
  private suggestionEngine: SuggestionEngine
  private screenCapture: ScreenCaptureService
  private notesGenerator: NotesGenerator
  private knowledgeBase: KnowledgeBase
  private meetingDetector: MeetingDetector
  private micMonitor: MicMonitor
  private silenceDetector: SilenceDetector

  // AI provider state
  private currentModel: LanguageModel | null
  private currentProvider: AIProviderKey | null

  // Session state
  private activeSessionId: string | null
  private sessionStartTime: number
  private sessionDir: string | null
}
```

**Key methods:**

| Method | Responsibility |
|--------|---------------|
| `initialize()` | Instantiate all services, read settings, configure AI provider, wire IPC handlers, set up event listeners |
| `configureAIProvider()` | Read `ai.provider`, `ai.model`, `ai.apiKey` from `settingsStore` + `credential-store`; call `createProvider()`; set model on all LLM-consuming services |
| `configureEmbedding()` | Read `ai.embeddingProvider`, `ai.embeddingModel`; create embed function; call `knowledgeBase.setEmbedFunction()` |
| `startSession(title?)` | Create DB session via `createSession()`, set `activeSessionId`, create session directory, start screen capture, start suggestion engine, show mini-bar, update tray state, send IPC `session:created` |
| `onAudioChunk(chunk: Buffer, source)` | Run silence detection, if not silent: feed to `transcriptionPipeline.collect()`, insert segments to DB, broadcast `transcript:newSegments` |
| `stopSession()` | Stop suggestion engine, stop screen capture, update session in DB, hide mini-bar, update tray state, optionally trigger notes prompt |
| `onSettingsChanged(key)` | Re-configure affected services when settings change |
| `shutdown()` | Stop all timers, close all services |

### A.3 Service Instantiation (in `initialize()`)

Order matters because of dependencies:

```
1. settingsStore.seedDefaults()                    (already done in DB init)
2. configureAIProvider()                           (creates LanguageModel)
3. configureEmbedding()                            (creates embed function)
4. knowledgeBase = new KnowledgeBase(kbOptions)
   knowledgeBase.setEmbedFunction(embedFn)
5. transcriptionPipeline = new TranscriptionPipeline([cohereEngine, chirp3Engine])
6. suggestionEngine = new SuggestionEngine(sugOptions)
   suggestionEngine.setModel(model)
   suggestionEngine.setKnowledgeSearch(kb.search.bind(kb))
   suggestionEngine.setDataAccessors({ getRecentTranscript, getScreenshots, getMeetingInfo })
7. screenCapture = new ScreenCaptureService(scOptions)
   screenCapture.setModel(model)
   screenCapture.setCaptureFunction(captureScreenFn)
8. notesGenerator = new NotesGenerator(notesOptions)
   notesGenerator.setModel(model)
9. meetingDetector = new MeetingDetector(detectorOptions)
10. micMonitor = new MicMonitor()
```

### A.4 IPC Handler Wiring

After service instantiation, call the existing `setService()` functions:

```typescript
// In session-orchestrator.ts initialize():
import { setSuggestionService } from '../ipc/suggestion-handlers'
import { setScreenshotService } from '../ipc/screenshot-handlers'
import { setNotesService } from '../ipc/notes-handlers'
import { setKnowledgeBaseService } from '../ipc/knowledge-handlers'

// Wire suggestion service (adapt SuggestionEngine to SuggestionService interface)
setSuggestionService({
  getActive: async (sessionId) => this.suggestionEngine.getActiveSuggestions(),
  dismiss: async (id) => this.suggestionEngine.dismiss(id),
  trigger: async () => this.suggestionEngine.trigger(),
  setEnabled: async (enabled) => { /* start/stop suggestion engine */ },
})

// Wire screenshot service (adapt ScreenCaptureService)
setScreenshotService({
  capture: async (sessionId) => this.screenCapture.capture(true),
  listForSession: async (sessionId) => getScreenshotsBySession(sessionId),
  getAnalysis: async (id) => { /* query DB */ },
  configure: async (options) => { /* update settings + reconfigure */ },
})

// Wire notes service
setNotesService(this.notesGenerator)

// Wire knowledge base service
setKnowledgeBaseService(this.knowledgeBase)
```

### A.5 Transcript Handler Wiring

The transcript handlers at `electron\main\ipc\transcript-handlers.ts` are currently stubs. They need to be wired to the database query functions:

```typescript
// Replace TODO stubs with:
handler: async (input) => {
  return getTranscriptBySession(input.sessionId)
}

// For getRecent:
handler: async (input) => {
  return getRecentTranscriptSegments(input.sessionId, input.limit ?? 50)
}
```

### A.6 Audio IPC Bridge

New IPC channels needed for renderer-to-main audio chunk transfer:

**New channels to add to `electron\main\ipc\channels.ts`:**
```typescript
audio: {
  sendChunk: "audio:sendChunk",       // renderer -> main (invoke)
  startCapture: "audio:startCapture", // renderer -> main -> renderer starts capture
  stopCapture: "audio:stopCapture",   // renderer -> main -> renderer stops capture
  onCaptureStatus: "audio:captureStatus", // main -> renderer push
}
```

**New file:** `electron\main\ipc\audio-handlers.ts`

Registers `audio:sendChunk` handler that calls `orchestrator.onAudioChunk()`. The chunk data arrives as an `ArrayBuffer` from the renderer (converted from `Blob` via `blob.arrayBuffer()`).

**Renderer-side audio controller** (in `src/` renderer code):
- On `audio:startCapture` signal: instantiate `MicCapture`, `SystemAudioCapture`, `AudioMixer`, `ChunkRecorder`
- `ChunkRecorder` emits `chunk` events; for each chunk, convert `Blob` to `ArrayBuffer`, send via `ipcRenderer.invoke('audio:sendChunk', { data: arrayBuffer, source })`
- On `audio:stopCapture` signal: stop all capture objects, dispose recorder

### A.7 Screen Capture Function Injection

`ScreenCaptureService` requires a `captureScreenFn` that returns `Buffer | null`. Since `desktopCapturer` is available in the main process via Electron, the capture function can be implemented in main:

```typescript
import { desktopCapturer } from 'electron'

async function captureScreen(): Promise<Buffer | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 },
  })
  if (sources.length === 0) return null
  return sources[0].thumbnail.toPng()
}

screenCapture.setCaptureFunction(captureScreen)
```

### A.8 Event Wiring Diagram

```
SessionManager events:
  'session-start'  -> orchestrator starts audio IPC, transcription, suggestions, screen capture, mini-bar
  'session-end'    -> orchestrator stops all, transitions to processing
  'session-complete' -> orchestrator updates tray, may prompt notes

TranscriptionPipeline events:
  'segment'        -> orchestrator inserts to DB, broadcasts to renderer
  'error'          -> orchestrator logs, may show notification
  'engine-switch'  -> orchestrator logs, may notify user

SuggestionEngine events:
  'suggestions-updated' -> orchestrator broadcasts via IPC 'suggestion:updated'
  'error'               -> orchestrator logs

ScreenCaptureService events:
  'screenshot-captured'  -> orchestrator broadcasts 'screenshot:captured'
  'screenshot-analyzed'  -> orchestrator broadcasts 'screenshot:analysisReady'

MeetingDetector events:
  'meeting-upcoming'     -> orchestrator shows notification
  'mic-detected'         -> orchestrator may auto-start session

NotesGenerator events:
  'progress'            -> already handled in notes-handlers.ts via emitter.on('progress')
  'generated'           -> orchestrator broadcasts to renderer

KnowledgeBase events:
  'source-added'         -> orchestrator broadcasts 'kb:indexComplete'
  'reindex-complete'     -> orchestrator broadcasts 'kb:indexComplete'

Settings change (via IPC 'settings:set'):
  ai.provider/model/apiKey changed  -> orchestrator.configureAIProvider(), re-set models
  ai.embeddingProvider/Model changed -> orchestrator.configureEmbedding(), re-set KB embed fn
  suggestions.* changed             -> orchestrator reconfigures suggestion engine
  screenshots.* changed             -> orchestrator reconfigures screen capture
```

### A.9 Updated `electron\main\index.ts`

```typescript
app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.hidock.meeting-assistant")
  // ... existing window shortcuts ...

  await initializeDatabase()
  hydrateCredentials()

  const orchestrator = new SessionOrchestrator()
  await orchestrator.initialize()          // NEW: wires everything

  const mainWindow = createMainWindow()
  registerIpcHandlers()                     // existing, but now services are wired

  // Wire tray callbacks to orchestrator
  setTrayCallbacks({
    onStartRecording: () => orchestrator.startSession(),
    onStopRecording: () => orchestrator.stopSession(),
  })

  initializeTray()
  // ... rest unchanged ...
})

app.on("before-quit", () => {
  orchestrator.shutdown()                   // NEW: clean shutdown
  destroyTray()
  destroyAllWindows()
})
```

---

## Part B: Cross-Platform Considerations

### B.1 Audio Capture

| Component | Windows | macOS | Linux |
|-----------|---------|-------|-------|
| Mic capture | `getUserMedia` via Chromium (WASAPI backend) | `getUserMedia` via Chromium (CoreAudio) | `getUserMedia` via Chromium (PulseAudio) |
| System audio | `getDisplayMedia` with audio: WASAPI loopback works natively | `getDisplayMedia`: requires screen recording permission grant; system audio capture may require additional virtual audio device (e.g., BlackHole) on older macOS | `getDisplayMedia` with PulseAudio monitor source |
| Permission model | No explicit permission needed for mic in Electron (auto-granted) | macOS requires `NSMicrophoneUsageDescription` in Info.plist + user prompt; screen recording requires `NSScreenCaptureUsageDescription` | No explicit OS permission needed |
| Electron config | `sandbox: false` on BrowserWindow (already set) | Same + Info.plist entries | Same |

**Implementation notes:**
- `MicCapture` and `SystemAudioCapture` already use standard Web APIs and are platform-agnostic in code.
- `SystemAudioCapture.isSupported()` checks for `getDisplayMedia` existence, which is correct.
- macOS system audio limitation: `getDisplayMedia` may not include system audio on macOS depending on OS version. Mitigation: detect macOS in the renderer audio controller and warn the user that a virtual audio driver may be needed, or fall back to mic-only mode.

### B.2 Transcription Engines

| Engine | Requirements | Platform Notes |
|--------|-------------|----------------|
| `CohereEngine` (local) | Python 3.x, `asr_mcp` package, HuggingFace model downloaded | Spawns `python -m asr_mcp.cli`. Path configured via `pythonPath` option. Windows uses `python.exe`, macOS/Linux use `python3`. GPU optional but recommended. |
| `Chirp3Engine` (cloud) | Google Cloud API key, internet connection | No platform-specific concerns. Uses `fetch()` (available in Node.js 18+). |

**Failover strategy:** Pipeline tries local (Cohere) first, falls back to cloud (Chirp3). Already implemented in `TranscriptionPipeline.selectEngine()` and `run()`.

**Configuration mapping from settings:**
```
settingsStore.get('ai.gcp.apiKey')  -> Chirp3Engine apiKey
CohereEngine pythonPath             -> detect via `which python3` or registry on Windows
```

### B.3 Screen Capture

| Platform | Implementation | Notes |
|----------|---------------|-------|
| Windows | `desktopCapturer.getSources({ types: ['screen'] })` | Works out of the box |
| macOS | Same API | Requires screen recording permission. First call triggers system prompt. `systemPreferences.getMediaAccessStatus('screen')` can check status. |
| Linux | Same API on X11. On Wayland, `desktopCapturer` may not work. | May need `xdg-desktop-portal` on Wayland. PipeWire-based capture possible but Electron support varies. |

### B.4 Content Protection

`win.setContentProtection(true)` is called on the mini-bar window (line 79 of `mini-bar-window.ts`).

| Platform | Behavior |
|----------|----------|
| Windows | Uses `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`. Window appears black in screen recordings/screenshots. |
| macOS | Uses `NSWindow.sharingType = .none`. Window excluded from screen capture. |
| Linux | No reliable equivalent. `setContentProtection` is a no-op on most Linux WMs. |

### B.5 Credential Storage

`credential-store.ts` uses `safeStorage` from Electron.

| Platform | Backend | Notes |
|----------|---------|-------|
| Windows | DPAPI (Data Protection API) | Tied to user account. No additional setup needed. |
| macOS | Keychain | Uses login keychain. User may see keychain access prompt on first use. |
| Linux | libsecret (via GNOME Keyring or KDE Wallet) | Requires `libsecret-1-dev` installed and a running secret service daemon. Falls back gracefully (`isAvailable()` returns false). |

### B.6 System Tray

| Platform | Behavior |
|----------|----------|
| Windows | Standard system tray icon. Left-click shows window, right-click shows context menu. |
| macOS | Menu bar icon. Click shows context menu. No separate left/right click distinction (use `tray.on('click')` for window toggle). Icon should be 16x16 @2x template image. |
| Linux | AppIndicator on Ubuntu/GNOME. May not appear on some minimal DEs. Fallback: no tray, use main window only. |

**Current implementation note:** The tray uses programmatically generated 16x16 colored squares. For macOS, these should be template images (monochrome with alpha channel) to match the system menu bar aesthetic.

### B.7 File Paths

| Concern | Windows | macOS | Linux |
|---------|---------|-------|-------|
| App data | `%APPDATA%\meeting-assistant` | `~/Library/Application Support/meeting-assistant` | `~/.config/meeting-assistant` |
| Temp files | `%TEMP%` | `/tmp` | `/tmp` |
| Path separator | `\` (but Node.js `path.join` handles this) | `/` | `/` |
| Home dir | `os.homedir()` returns `C:\Users\<name>` | `/Users/<name>` | `/home/<name>` |

Use `app.getPath('userData')` for all persistent storage. Already handled by `database.ts`.

### B.8 Notifications

All platforms support `new Notification()` from Electron's main process. Behavior differences:

| Platform | Style | Persistence |
|----------|-------|-------------|
| Windows | Toast notification via Action Center | Persists until dismissed |
| macOS | Banner or alert (configurable in System Settings) | May auto-dismiss |
| Linux | Via `libnotify`. Styling depends on DE. | Usually auto-dismiss |

---

## Part C: Integration Test Plan

### C.1 Module Tests (vitest, mock IPC)

**Test file:** `electron\main\services\__tests__\session-orchestrator.test.ts`

| Test Case | What to Verify |
|-----------|---------------|
| `initialize()` creates all services | All service instances are non-null after init |
| `initialize()` reads AI settings and creates provider | `createProvider` called with correct config from `settingsStore` |
| `initialize()` wires IPC handler services | `setSuggestionService`, `setNotesService`, etc. called with non-null adapters |
| `initialize()` sets embed function on KB | `knowledgeBase.setEmbedFunction` called |
| `startSession()` creates DB session | `createSession()` called, returns valid session |
| `startSession()` sends IPC signal to start audio capture | `broadcastToAllWindows('audio:startCapture')` called |
| `startSession()` starts suggestion engine | `suggestionEngine.start(sessionId)` called |
| `startSession()` starts screen auto-capture | `screenCapture.startAutoCapture()` called |
| `startSession()` shows mini-bar | `showMiniBar()` called |
| `startSession()` updates tray state | `updateTrayState('recording')` called |
| `onAudioChunk()` with non-silent audio triggers transcription | `pipeline.collect()` called with buffer |
| `onAudioChunk()` with silent audio skips transcription | `pipeline.collect()` NOT called |
| `onAudioChunk()` inserts segments to DB | `insertTranscriptSegment()` called for each segment |
| `onAudioChunk()` broadcasts new segments | `broadcastToAllWindows('transcript:newSegments')` called |
| `stopSession()` stops all services | suggestion, screen capture, audio stopped |
| `stopSession()` updates DB session | `updateSession()` called with `ended_at` and status `processing` |
| `stopSession()` hides mini-bar | `hideMiniBar()` called |
| `onSettingsChanged('ai.provider')` reconfigures AI | `createProvider` called again, models re-set on all services |
| `onSettingsChanged('ai.embeddingModel')` reconfigures embed | `knowledgeBase.setEmbedFunction` called with new function |
| `shutdown()` stops all timers and services | No timers running, no pending promises |

**Test file:** `electron\main\ipc\__tests__\transcript-handlers.test.ts`

| Test Case | What to Verify |
|-----------|---------------|
| `getSegments` returns segments from DB | Calls `getTranscriptBySession()`, returns array |
| `getRecent` returns last N segments | Calls `getRecentTranscriptSegments()` with correct limit |

**Test file:** `electron\main\ipc\__tests__\audio-handlers.test.ts`

| Test Case | What to Verify |
|-----------|---------------|
| `audio:sendChunk` forwards to orchestrator | `orchestrator.onAudioChunk()` called with Buffer |
| `audio:sendChunk` with no active session returns error | Returns error, does not crash |

### C.2 Integration Tests (vitest, real services, mock Electron)

**Test file:** `electron\main\services\__tests__\session-flow.integration.test.ts`

| Test Case | What to Verify |
|-----------|---------------|
| Full session: create -> mock audio chunks -> transcription (mocked engine) -> segments in DB -> stop -> notes | DB contains session, transcript segments, and generated notes |
| Settings change mid-session: change AI provider | New provider used for next suggestion cycle |
| KB roundtrip: add source file -> embed (mocked) -> search -> results contain source text | KB search returns relevant chunks |
| Suggestion trigger with real transcript data (mocked LLM) | Suggestion engine emits `suggestions-updated` with parsed suggestions |
| Multiple sessions: start -> stop -> start -> stop | Each session has its own ID, segments, no cross-contamination |
| Engine failover: primary engine throws -> fallback engine succeeds | Transcript segments still produced, `engine-switch` event emitted |

**Test file:** `electron\main\services\__tests__\ai-config.integration.test.ts`

| Test Case | What to Verify |
|-----------|---------------|
| Configure with Ollama (default) | `createProvider({ provider: 'ollama', model: 'llama3.2' })` succeeds |
| Configure with OpenAI | `createProvider({ provider: 'openai', model: 'gpt-4', apiKey: '...' })` succeeds |
| Configure with Anthropic | Provider created, model set on all services |
| Missing API key for cloud provider | Graceful error, services remain in unconfigured state |
| Embedding provider != LLM provider | Both configured independently |

### C.3 End-to-End Tests (Electron MCP)

| Test Case | Steps | Verification |
|-----------|-------|-------------|
| App starts clean | Launch app | No console errors, main window renders, tray icon visible |
| Navigate all pages | Click Dashboard, Sessions, Notes, Knowledge Base, Settings | Each page renders without errors |
| Settings: configure AI provider | Go to Settings, select provider, enter API key, save | Settings persisted, connection test (if available) passes |
| Start recording via tray | Right-click tray -> Start Recording | Mini-bar appears, tray icon turns red, session appears in Sessions page |
| Verify transcript updates | During recording, speak into mic | Transcript segments appear in real-time in mini-bar and main window |
| Stop recording via tray | Right-click tray -> Stop Recording | Mini-bar hides, tray returns to idle, session status changes to "completed" |
| Generate notes | Go to Sessions, select completed session, click Generate Notes | Notes generated, visible in Notes page |
| Knowledge Base: add source | Go to KB page, add a .txt file | File indexed, chunks visible |
| Knowledge Base: search | Enter search query | Relevant results returned |
| Dark mode toggle | Toggle dark mode in settings | UI theme changes without errors |
| Keyboard shortcuts | Press Ctrl+Shift+S (screenshot), Ctrl+Shift+N (notes) | Actions triggered correctly |
| Window controls | Minimize, maximize, close main window | Window responds correctly, app stays in tray |
| Multiple sessions | Start, stop, start, stop | Both sessions visible in Sessions list with separate transcripts |

### C.4 System Tests (platform-specific)

**Windows:**
- WASAPI loopback capture: verify system audio appears in transcript
- DPAPI credential storage: store and retrieve API key across app restarts
- NSIS installer: install, run, uninstall cycle
- Content protection: mini-bar excluded from screen capture

**macOS:**
- CoreAudio mic capture
- Screen recording permission prompt appears on first screen capture
- Keychain credential storage across restarts
- DMG creation and notarization
- Menu bar tray icon appearance (template image)
- `getDisplayMedia` system audio (may need virtual audio driver)

**Linux:**
- PulseAudio mic capture
- libsecret credential storage (with GNOME Keyring)
- AppImage packaging and execution
- System tray on Ubuntu/GNOME with AppIndicator
- Wayland screen capture compatibility

---

## Part D: Implementation Phases

### Phase 7A: Core Orchestrator (no dependencies, ~2 days)

**Goal:** Create `SessionOrchestrator`, wire AI providers, wire IPC handlers.

**Files to create:**
- `electron\main\services\session-orchestrator.ts`

**Files to modify:**
- `electron\main\index.ts` -- instantiate orchestrator in `app.whenReady()`, call `initialize()`, wire tray callbacks, call `shutdown()` on quit
- `electron\main\ipc\handlers.ts` -- may need to accept orchestrator reference or be called after orchestrator init
- `electron\main\ipc\transcript-handlers.ts` -- replace TODO stubs with DB queries (`getTranscriptBySession`, `getRecentTranscriptSegments`)

**Implementation details:**

1. `SessionOrchestrator` constructor takes `settingsStore` reference
2. `initialize()`:
   - Read AI settings from `settingsStore`
   - Read API key from credential store: `retrieve('ai.apiKey', settingsStore.get('ai.apiKey'))`
   - Call `createProvider(config)` from `@hidock/ai-providers` to get `LanguageModel`
   - Create embed function: `(text) => embed(text, embeddingConfig).then(r => r.embedding)`
   - Instantiate `KnowledgeBase` with `{ chunkSize, chunkOverlap }` from settings
   - Call `knowledgeBase.setEmbedFunction(embedFn)`
   - Instantiate `SuggestionEngine`, `ScreenCaptureService`, `NotesGenerator` with settings
   - Set model on each via `.setModel(model)`
   - Wire data accessors on `SuggestionEngine`:
     - `getRecentTranscript`: calls `getRecentTranscriptSegments(sessionId, limit)`
     - `getScreenshots`: calls `getScreenshotsBySession(sessionId)`
     - `getMeetingInfo`: returns null for now (meeting linking TBD)
   - Call `setSuggestionService()`, `setScreenshotService()`, `setNotesService()`, `setKnowledgeBaseService()` with adapter objects
   - Instantiate `MeetingDetector` with calendar settings (optional, can be deferred)
   - Instantiate `MicMonitor` (optional, can be deferred)
3. Listen for settings changes: subscribe to a `settings:changed` event from settings handlers, call `onSettingsChanged(key)` to reconfigure affected services
4. Implement `shutdown()`: stop all active sessions, clear all timers

**Acceptance criteria:**
- App starts without errors
- IPC handlers for suggestions, screenshots, notes, KB are wired (non-null services)
- Transcript IPC returns real DB data (empty until segments exist)
- AI provider configured from settings

### Phase 7B: Audio-to-Transcription Pipeline (depends on 7A, ~3 days)

**Goal:** Audio captured in renderer flows through to transcription in main, segments stored and broadcast.

**Files to create:**
- `electron\main\ipc\audio-handlers.ts` -- IPC handlers for `audio:sendChunk`, `audio:startCapture`, `audio:stopCapture`
- `src\lib\audio-controller.ts` (renderer) -- manages `MicCapture`, `SystemAudioCapture`, `AudioMixer`, `ChunkRecorder`; sends chunks to main via IPC

**Files to modify:**
- `electron\main\ipc\channels.ts` -- add `audio` channel group
- `electron\main\ipc\handlers.ts` -- register audio handlers
- `electron\main\services\session-orchestrator.ts` -- add `onAudioChunk()` method
- `electron\preload\index.ts` (if exists) -- expose audio IPC channels

**Implementation details:**

1. **Renderer-side `AudioController`:**
   ```typescript
   class AudioController {
     private micCapture: MicCapture
     private systemCapture: SystemAudioCapture
     private mixer: AudioMixer
     private recorder: ChunkRecorder

     async startCapture(options: { micDeviceId?: string }): Promise<void> {
       const micHandle = await this.micCapture.start()
       this.mixer.addSource('mic', micHandle.stream)

       try {
         const sysHandle = await this.systemCapture.start()
         this.mixer.addSource('system', sysHandle.stream)
       } catch {
         // System audio optional -- continue with mic only
         console.warn('System audio capture unavailable')
       }

       const mixedStream = this.mixer.getOutputStream()
       this.recorder = new ChunkRecorder({ timesliceMs: 3000 })
       this.recorder.on('chunk', this.handleChunk.bind(this))
       await this.recorder.start(mixedStream, 'mixed')
     }

     private async handleChunk(chunk: AudioChunk): Promise<void> {
       const arrayBuffer = await chunk.data.arrayBuffer()
       await window.electronAPI.sendAudioChunk(arrayBuffer, chunk.source)
       this.recorder.acknowledgeChunk()
     }

     async stopCapture(): Promise<void> {
       await this.recorder?.stop()
       this.recorder?.dispose()
       await this.mixer.stop()
       await this.micCapture.stop()
       await this.systemCapture.stop()
     }
   }
   ```

2. **Main-side `onAudioChunk()`:**
   ```typescript
   async onAudioChunk(data: ArrayBuffer, source: 'mic' | 'system' | 'mixed'): Promise<void> {
     if (!this.activeSessionId) return
     const buffer = Buffer.from(data)

     // Silence detection
     const silenceResult = await this.silenceDetector.analyze(buffer)
     if (silenceResult.isSilent) return

     // Transcription
     const timeOffset = (Date.now() - this.sessionStartTime) / 1000
     const segments = await this.transcriptionPipeline.collect(buffer, {
       source: source === 'mixed' ? 'mic' : source,
       timeOffset,
       diarize: true,
     })

     // Store segments
     for (const seg of segments) {
       insertTranscriptSegment({
         session_id: this.activeSessionId,
         speaker: seg.speaker,
         text: seg.text,
         start_time: seg.startTime,
         end_time: seg.endTime,
         confidence: seg.confidence,
         source: seg.source,
       })
     }
     saveDatabase()

     // Broadcast to renderer
     broadcastToAllWindows(CHANNELS.transcript.onNewSegments, {
       sessionId: this.activeSessionId,
       segments,
     })
   }
   ```

3. **Transcription engine configuration:**
   - `CohereEngine`: detect Python path (platform-specific), check `asr_mcp` availability on init
   - `Chirp3Engine`: use API key from credential store (`ai.gcp.apiKey` or `ai.transcriptionApiKey`)
   - Pipeline ordering: `[cohereEngine, chirp3Engine]` (local first, cloud fallback)

**Acceptance criteria:**
- Audio chunks flow from renderer to main via IPC
- Silent chunks are filtered out
- Non-silent chunks produce transcript segments in the DB
- Segments broadcast to renderer via `transcript:newSegments`
- Engine failover works (if Cohere unavailable, falls back to Chirp3)

### Phase 7C: Session Lifecycle (depends on 7B, ~2 days)

**Goal:** Full start-to-stop session flow with UI integration.

**Files to modify:**
- `electron\main\services\session-orchestrator.ts` -- implement `startSession()`, `stopSession()`, session directory management
- `electron\main\services\session-manager.ts` -- may need to use DB-backed sessions instead of in-memory only
- `electron\main\ipc\session-handlers.ts` -- wire to orchestrator for create/end, use DB queries for list/get
- `electron\main\services\tray-manager.ts` -- wire tray callbacks to orchestrator

**Implementation details:**

1. **Session directory creation:**
   ```typescript
   const sessionDir = join(app.getPath('userData'), 'sessions', sessionId)
   mkdirSync(sessionDir, { recursive: true })
   // Subfolders: screenshots/, audio/ (for optional raw audio saving)
   ```

2. **Start session flow:**
   ```
   orchestrator.startSession(title?)
     -> createSession({ title }) in DB
     -> set activeSessionId
     -> create session directory
     -> broadcastToAllWindows('audio:startCapture', { sessionId })
        (renderer AudioController responds by starting capture)
     -> screenCapture.startAutoCapture(sessionId, sessionDir)
     -> suggestionEngine.start(sessionId)
     -> showMiniBar()
     -> updateTrayState('recording')
     -> broadcastToAllWindows('session:created', session)
   ```

3. **Stop session flow:**
   ```
   orchestrator.stopSession()
     -> broadcastToAllWindows('audio:stopCapture')
        (renderer AudioController stops capture)
     -> suggestionEngine.stop()
     -> screenCapture.stopAutoCapture()
     -> updateSession(sessionId, { ended_at: Date.now(), status: 'processing' })
     -> hideMiniBar()
     -> updateTrayState('processing')
     -> broadcastToAllWindows('session:statusChanged', { status: 'processing' })
     -> if settingsStore.get('notes.showPostSessionPrompt'):
          broadcastToAllWindows('session:promptNotes', { sessionId })
     -> completeSession()
     -> updateTrayState('idle')
   ```

4. **Session handler migration:**
   - `session:list` should query `getAllSessions()` from DB, not just the in-memory manager
   - `session:get` should use `getSession(id)` from DB
   - `session:create` should call `orchestrator.startSession()` instead of just `sessionManager.startSession()`
   - `session:end` should call `orchestrator.stopSession()`
   - `session:delete` should call `deleteSession()` from DB

**Acceptance criteria:**
- Start/stop session via tray and via IPC both work
- Sessions persisted in DB and survive app restart
- Mini-bar shows/hides correctly with session state
- Tray icon reflects current state (idle/recording/processing)
- Post-session notes prompt appears if enabled in settings

### Phase 7D: Intelligence Wiring (depends on 7B, ~2 days)

**Goal:** Suggestions, screenshots, and notes all receive correct context and produce output.

**Files to modify:**
- `electron\main\services\session-orchestrator.ts` -- wire suggestion triggers, screenshot analysis, notes generation context

**Implementation details:**

1. **Suggestion engine receives transcript + KB context:**
   - Already configured via `setDataAccessors()` and `setKnowledgeSearch()` in Phase 7A
   - Verify `getRecentTranscript` adapter correctly calls `getRecentTranscriptSegments()` and maps fields
   - Verify `getScreenshots` adapter correctly calls `getScreenshotsBySession()`
   - Subscribe to `suggestions-updated` event: `broadcastToAllWindows(CHANNELS.suggestion.onUpdated, suggestions)`

2. **Screen capture integration:**
   - `captureScreenFn` set up in Phase 7A
   - Auto-capture started in `startSession()` (Phase 7C)
   - Subscribe to `screenshot-analyzed` event: broadcast to renderer
   - Manual screenshot capture: already handled by `screenshot:capture` IPC handler calling `screenCapture.capture(true)`

3. **Notes generator with full context:**
   - Already reads transcript, screenshots, meeting info from DB via its own imports of `database-queries`
   - `setModel()` done in Phase 7A
   - Notes IPC handler already handles progress events
   - Verify the full pipeline: categorize -> select template -> generate -> save to DB

4. **Meeting detector integration (stretch goal):**
   - `MeetingDetector.start()` during orchestrator init
   - On `meeting-upcoming`: show system notification
   - On `mic-detected` with `auto-record`: auto-start session
   - On session start: call `meetingDetector.correlateSession(startTime)` to auto-link calendar event
   - If auto-link: call `orchestrator.linkMeeting(sessionId, meetingId)`, create Meeting in DB

**Acceptance criteria:**
- Suggestions appear during active session based on transcript content
- Screenshots captured automatically at configured interval
- Screenshot analysis results visible in UI
- Notes generation produces structured output from real transcript
- Meeting detection notifications work (if calendar configured)

### Phase 7E: Cross-Platform Validation (depends on 7C, 7D, ~3 days)

**Goal:** Verify the integrated app works on all three platforms.

**Files to modify/create:**
- Platform-specific adjustments as discovered during testing
- Build configuration files for each platform

**Implementation details:**

1. **Windows validation:**
   - Test WASAPI mic capture via `getUserMedia`
   - Test system audio loopback via `getDisplayMedia`
   - Verify DPAPI credential encryption/decryption
   - Test NSIS installer build: `electron-builder --win`
   - Verify content protection on mini-bar
   - Test Python path detection for CohereEngine (check `PATH`, `py.exe` launcher)

2. **macOS validation:**
   - Test CoreAudio mic capture
   - Test screen recording permission flow (first-time prompt)
   - Verify Keychain credential storage
   - Test DMG build: `electron-builder --mac`
   - Verify `entitlements.plist` includes audio and screen recording
   - Test system audio (may need virtual audio driver)
   - Verify tray icon in menu bar

3. **Linux validation:**
   - Test PulseAudio mic capture
   - Test `libsecret` credential storage availability
   - Test AppImage build: `electron-builder --linux`
   - Test system tray on GNOME (Ubuntu) and KDE
   - Test Wayland screen capture limitations

4. **Cross-platform regression:**
   - File path handling (use `path.join` everywhere, verify no hardcoded separators)
   - `os.homedir()` used consistently
   - `app.getPath('userData')` for all persistent data
   - Python path resolution per platform

**Acceptance criteria:**
- App builds and runs on Windows, macOS, and Linux
- Core flow (start session, capture audio, transcribe, generate notes) works on all platforms
- Platform-specific features gracefully degrade where unsupported

### Phase 7F: Test Suite (parallel with 7A-7E, ~3 days)

**Goal:** Comprehensive test coverage for the integration layer.

**Files to create:**
- `electron\main\services\__tests__\session-orchestrator.test.ts` -- module tests
- `electron\main\services\__tests__\session-flow.integration.test.ts` -- integration tests
- `electron\main\services\__tests__\ai-config.integration.test.ts` -- AI provider tests
- `electron\main\ipc\__tests__\audio-handlers.test.ts` -- audio IPC tests
- `electron\main\ipc\__tests__\transcript-handlers.test.ts` -- transcript handler tests

**Implementation approach:**

1. **Module tests:** Use vitest with mocked dependencies.
   - Mock `@hidock/ai-providers` (`createProvider`, `embed`)
   - Mock `database-queries` functions
   - Mock Electron APIs (`BrowserWindow`, `desktopCapturer`, `safeStorage`)
   - Mock `broadcastToAllWindows`
   - Verify orchestrator method calls propagate correctly

2. **Integration tests:** Use vitest with real service instances, mock Electron and external APIs.
   - Use in-memory SQLite database (real `sql.js`)
   - Mock LLM responses (return canned text)
   - Mock audio input (provide pre-recorded buffer)
   - Verify end-to-end data flow: audio -> transcription -> DB -> IPC broadcast

3. **E2E tests:** Use Electron MCP tools.
   - Launch app, navigate pages, check console for errors
   - Screenshot verification of UI states
   - Interact with settings, verify persistence

**Test data:**
- Pre-recorded audio chunks (short WebM/Opus files) for transcription tests
- Sample `.txt` and `.md` files for KB indexing tests
- Canned LLM responses for suggestion/notes tests

**Acceptance criteria:**
- All module tests pass
- All integration tests pass
- E2E tests cover core user flows
- No test relies on real API keys or external services

---

## Part E: Risk Assessment

### E.1 High Risk: Audio IPC Performance

**Problem:** Audio chunks (~3s of audio each) cross the renderer-main IPC boundary. `Blob.arrayBuffer()` serialization + IPC overhead could cause latency or dropped chunks.

**Impact:** Delayed or missing transcription, choppy user experience.

**Mitigation:**
- Use `ipcRenderer.invoke()` with `ArrayBuffer` transfer (Electron supports structured clone, which can transfer ArrayBuffers zero-copy)
- Keep chunk size at 3s (current default in `ChunkRecorder`) -- balances latency vs overhead
- `ChunkRecorder` has built-in backpressure (pause at 15 pending, resume at 10) -- ensure `acknowledgeChunk()` is called after main process processes each chunk
- Monitor IPC throughput in dev tools; if bottlenecked, consider `MessagePort` for direct renderer-main streaming

### E.2 High Risk: Transcription Latency

**Problem:** `CohereEngine` spawns a Python process per chunk. Cold start is slow (model loading), and each invocation has subprocess overhead.

**Impact:** Transcript updates lag behind speech by many seconds.

**Mitigation:**
- Keep the Python process warm: start it once and send audio via stdin/pipe instead of spawning per-chunk. This requires modifying `CohereEngine` to support a long-running process mode. **ACTION ITEM: Modify CohereEngine to support persistent process mode.**
- If Python process unavailable, fall back to Chirp3 (cloud, <2s latency per request)
- Consider batching: accumulate 2-3 chunks before sending to engine (reduces overhead at cost of slightly higher latency)
- Show interim/buffering indicator in UI while transcription is in-flight

### E.3 High Risk: macOS System Audio

**Problem:** macOS does not natively expose system audio through `getDisplayMedia`. Users need a virtual audio driver (e.g., BlackHole, Soundflower) to capture system audio.

**Impact:** System audio capture fails silently on macOS, user only gets mic audio.

**Mitigation:**
- Detect macOS in renderer audio controller
- If `getDisplayMedia` audio tracks are empty, show user-facing message explaining virtual audio driver requirement
- Provide setup instructions link in the app
- Gracefully degrade to mic-only mode

### E.4 Medium Risk: AI Provider Configuration Errors

**Problem:** Users may enter invalid API keys, select wrong models, or have no internet for cloud providers. Services that depend on `LanguageModel` will fail.

**Impact:** Suggestions, notes, screenshot analysis, and KB embeddings all break.

**Mitigation:**
- `settings:testConnection` IPC handler already exists in channels but needs implementation: call `generateText` with a simple prompt, catch errors, return success/failure
- UI should show connection status after provider configuration
- All LLM-calling services already handle errors via try/catch and emit `error` events
- If no model configured, services should remain in a safe "disabled" state (return empty results, not crash)
- `SuggestionEngine.trigger()` already checks `if (!this.model) return`
- `NotesGenerator.generate()` already throws descriptive error if no model set

### E.5 Medium Risk: Session State Recovery After Crash

**Problem:** If the app crashes during an active session, audio is lost (renderer-only), session stays in "recording" status in DB forever.

**Impact:** Orphaned sessions, lost recordings.

**Mitigation:**
- On app startup, check DB for sessions with `status = 'recording'`. If found, update to `'interrupted'` or `'completed'` with `ended_at = started_at + last_segment_end_time`
- Consider saving raw audio chunks to disk as they arrive (in session directory), so partial recordings survive crashes
- This is a Phase 7C concern -- implement session recovery in `orchestrator.initialize()`

### E.6 Medium Risk: Concurrent Service Access

**Problem:** Multiple IPC handlers and event callbacks access the same service instances. Node.js is single-threaded so no data races, but re-entrant calls (e.g., `trigger()` called while previous `trigger()` is still awaiting LLM response) could cause duplicate suggestions.

**Impact:** Duplicate suggestions, wasted API calls.

**Mitigation:**
- Add a `_triggering` guard flag in `SuggestionEngine.trigger()` to prevent concurrent invocations
- `ScreenCaptureService.capture()` should check if a capture is already in-flight
- All async service methods should be idempotent or guarded

### E.7 Low Risk: ChunkRecorder MIME Type Compatibility

**Problem:** `ChunkRecorder` selects MIME type based on `MediaRecorder.isTypeSupported()`. The chosen type must be compatible with the transcription engine's expected input format.

**Impact:** Transcription engine receives incompatible audio format, fails to parse.

**Mitigation:**
- Both `CohereEngine` (ffmpeg-based) and `Chirp3Engine` (Google API, expects WEBM_OPUS) support the default `audio/webm;codecs=opus`
- `ogg;codecs=opus` is also supported by both
- Validate in integration tests that the chunk format matches engine expectations

### E.8 Low Risk: Database Write Contention

**Problem:** `saveDatabase()` is called after each transcript segment insert, each screenshot, etc. With 3-second audio chunks producing segments, this means frequent DB writes.

**Impact:** Performance degradation, potential file system bottleneck.

**Mitigation:**
- Batch `saveDatabase()` calls: accumulate changes and flush every N seconds or N operations
- `sql.js` operates in-memory with periodic file flushes, so individual inserts are fast
- Only the `saveDatabase()` (write to disk) is potentially slow; debounce it

---

## Dependency Graph

```
Phase 7A: Core Orchestrator
    |
    v
Phase 7B: Audio -> Transcription Pipeline
    |         \
    v          v
Phase 7C    Phase 7D
Session     Intelligence
Lifecycle   Wiring
    \         /
     v       v
Phase 7E: Cross-Platform Validation

Phase 7F: Test Suite (runs parallel with 7A-7E)
```

## Estimated Timeline

| Phase | Duration | Dependencies |
|-------|----------|-------------|
| 7A | 2 days | None |
| 7B | 3 days | 7A |
| 7C | 2 days | 7B |
| 7D | 2 days | 7B |
| 7E | 3 days | 7C + 7D |
| 7F | 3 days | Parallel |
| **Total** | **~10 days** (7C and 7D parallel, 7F parallel) | |

## Key File Reference

| File | Role |
|------|------|
| `electron\main\index.ts` | App entry, orchestrator bootstrap |
| `electron\main\services\session-orchestrator.ts` | **NEW** - Central wiring |
| `electron\main\services\session-manager.ts` | In-memory session state |
| `electron\main\services\knowledge-base.ts` | KB with embeddings |
| `electron\main\services\suggestion-engine.ts` | LLM suggestions |
| `electron\main\services\screen-capture.ts` | Screenshot + analysis |
| `electron\main\services\notes-generator.ts` | LLM notes generation |
| `electron\main\services\meeting-detector.ts` | Calendar + mic detection |
| `electron\main\services\mic-monitor.ts` | Platform mic activity |
| `electron\main\services\settings-store.ts` | Type-safe settings |
| `electron\main\services\credential-store.ts` | Encrypted credential storage |
| `electron\main\services\tray-manager.ts` | System tray with callbacks |
| `electron\main\services\database-queries.ts` | All DB CRUD operations |
| `electron\main\ipc\handlers.ts` | Central IPC registration |
| `electron\main\ipc\channels.ts` | All IPC channel constants |
| `electron\main\ipc\broadcast.ts` | Main -> renderer push |
| `electron\main\ipc\suggestion-handlers.ts` | Suggestion IPC (setService pattern) |
| `electron\main\ipc\screenshot-handlers.ts` | Screenshot IPC (setService pattern) |
| `electron\main\ipc\notes-handlers.ts` | Notes IPC (setService pattern) |
| `electron\main\ipc\knowledge-handlers.ts` | KB IPC (setService pattern) |
| `electron\main\ipc\transcript-handlers.ts` | Transcript IPC (TODO stubs) |
| `electron\main\ipc\session-handlers.ts` | Session IPC (in-memory only) |
| `electron\main\ipc\audio-handlers.ts` | **NEW** - Audio chunk IPC |
| `electron\main\windows\mini-bar-window.ts` | Mini-bar window management |
| `electron\main\windows\index.ts` | Window exports |
| `packages\audio-capture\src\mic-capture.ts` | Web API mic capture (renderer) |
| `packages\audio-capture\src\system-audio-capture.ts` | Web API system audio (renderer) |
| `packages\audio-capture\src\audio-mixer.ts` | WebAudio mixer (renderer) |
| `packages\audio-capture\src\chunk-recorder.ts` | MediaRecorder chunking (renderer) |
| `packages\audio-capture\src\silence-detector.ts` | ffmpeg-based silence detection (main) |
| `packages\transcription\src\pipeline.ts` | Engine orchestration with fallback |
| `packages\transcription\src\engines\cohere-engine.ts` | Local Python ASR |
| `packages\transcription\src\engines\chirp3-engine.ts` | Google Cloud ASR |
| `packages\ai-providers\src\provider-factory.ts` | LLM provider creation |
| `packages\ai-providers\src\embed.ts` | Embedding function |
| `packages\ai-providers\src\types.ts` | Provider config types |
| `src\lib\audio-controller.ts` | **NEW** - Renderer audio management |
