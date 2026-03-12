# Standalone Meeting Recorder Implementation Plan

Created: 2026-02-24
Status: VERIFIED
Approved: Yes
Iterations: 2
Worktree: No

> **Status Lifecycle:** PENDING → COMPLETE → VERIFIED
> **Iterations:** Tracks implement→verify cycles (incremented by verify phase)
>
> - PENDING: Initial state, awaiting implementation
> - COMPLETE: All tasks implemented
> - VERIFIED: All checks passed
>
> **Approval Gate:** Implementation CANNOT proceed until `Approved: Yes`
> **Worktree:** Set at plan creation (from dispatcher). `Yes` uses git worktree isolation; `No` works directly on current branch (default)

## Summary

**Goal:** Build a standalone cross-platform (Windows, Linux, macOS) Electron meeting intelligence app. It automatically detects meetings via mic monitoring, records audio, provides real-time AI analysis (transcription, translation, sentiment, speaker ID, topics, action items), and supports multi-session concurrent operation. Users can enrich sessions with notes and file attachments, select meeting type templates for custom end-of-meeting processing, and browse historical recordings. A floating mini control bar provides instant session switching from any context.

**Architecture:** New Electron app (`apps/meeting-recorder/`) in the monorepo. Multi-session architecture where each recording session is independent — new recordings start automatically in the background even while the user reviews a previous session. Audio captured via `getUserMedia()`, processed by multimodal LLMs through the Vercel AI SDK. A persistent floating mini control bar (like Teams/Slack screen-sharing overlay) provides session awareness from any context. All AI is LLM-based (no specialized ASR services).

**Tech Stack:**
- **Runtime:** Electron + electron-vite
- **Frontend:** React 18, TypeScript, Tailwind CSS v3, shadcn/ui, Zustand
- **AI:** Vercel AI SDK (`ai` + provider packages) for multi-provider LLM abstraction
- **Providers supported:** Google Gemini (primary), OpenAI, Anthropic, Amazon Bedrock/Nova, Ollama (local)
- **Database:** sql.js (WebAssembly SQLite port — no native addon, simpler cross-platform builds). Originally planned as better-sqlite3 but switched to sql.js during implementation for WASM portability.
- **Audio:** Web Audio API + MediaRecorder (ogg/opus format) in renderer

## Scope

### In Scope

- New Electron app at `apps/meeting-recorder/`
- Cross-platform mic activity detection (Windows registry, macOS lsof, Linux pactl/PipeWire)
- Automatic recording when mic is active, stops when mic is disconnected/stopped (not muted)
- Real-time audio capture and ogg/opus file storage
- Real-time transcription via multimodal LLM (audio chunks → structured transcript)
- Speaker identification by name (LLM-inferred from audio + meeting context + user edits)
- Real-time translation (configurable target language)
- Real-time sentiment analysis per segment
- Talking points / discussed subjects extraction
- Action items detection
- **Rich context notes panel** — user can add screenshots, text notes, and file attachments (DOCX, PPTX, audio, images) that enrich LLM context
- **Meeting type templates** — user selects meeting type (standup, 1:1, interview, etc.) with custom end-of-meeting prompts
- **End-of-meeting auto-processing** — full summarization, categorization, and template-specific output when recording ends
- **Multi-session concurrent operation** — new recording starts automatically when previous ends; user can switch between active and historical sessions independently
- **Floating mini control bar** — always-on-top compact widget (like Teams/Slack screen-sharing bar) for session switching from any context
- **Recording history browser** — browse, search, and review past sessions
- On-demand summarization during meetings
- Multi-provider AI with user-configurable model selection
- Settings UI for API keys, model selection, language preferences
- System tray support (Windows/macOS/Linux)

### Out of Scope

- Calendar integration (future iteration — manual meeting info for now)
- Voice fingerprinting / voiceprint matching across meetings
- Cloud sync / multi-device
- Video recording
- Integration with Zoom/Teams/Meet APIs
- Mobile apps
- Sharing / collaboration features
- File content extraction (parsing DOCX/PPTX content for LLM — files stored as attachments, content extraction is future)

## Prerequisites

- Node.js 18+ and npm
- Electron 39+ (matches existing app)
- Python and C++ compiler for better-sqlite3 native build
- API keys for at least one supported provider (Gemini recommended for audio support)
- System microphone access permissions

## Context for Implementer

> This section is critical for cross-session continuity.

- **Patterns to follow:** The existing Electron app at `apps/electron/` uses electron-vite with a 3-layer architecture (main/preload/renderer). Follow the same pattern — see `apps/electron/electron.vite.config.ts`.
- **IPC pattern:** Main process handlers in `electron/main/ipc/*-handlers.ts`, registered in `handlers.ts`, exposed via `electron/preload/index.ts`. Channel naming: `domain:camelCaseAction`.
- **Store pattern:** Zustand stores with `persist` middleware for settings that survive restart. Transient state excluded from persistence.
- **Database pattern:** better-sqlite3 (native addon). Requires `electron-rebuild` post-install and `asarUnpack` in electron-builder.yml. Follow the 4-phase boot sequence pattern from `apps/electron/electron/main/services/database.ts`.
- **Key difference from existing app:** This app does NOT use HiDock USB devices. Audio comes from the system microphone via `getUserMedia()`. The LLM does ALL processing (no separate ASR service).

**Audio → LLM Pipeline (core architecture):**
1. Renderer: `getUserMedia({ audio: true })` → MediaRecorder captures ogg/opus chunks (15s intervals)
2. Renderer → Main (IPC): audio chunks sent via `ipcMain.on` (fire-and-forget, NOT handle) — avoids blocking renderer
3. Main process: base64-encodes audio, builds prompt with context (previous transcript, meeting info, known speakers, notes/attachments)
4. Main process: sends to LLM via AI SDK `generateObject()` with Zod schema — structured output mode for reliable JSON
5. Main → Renderer (IPC): structured results pushed via `webContents.send()`
6. Renderer: updates UI in real-time

**Two-tier provider model:**
- **Audio-capable** (Gemini only via AI SDK): Audio → single LLM call → transcript + analysis
- **Text-only** (OpenAI, Claude, Bedrock, Ollama): Requires separate transcription step (Gemini or OpenAI Whisper API), then text → analysis model
- Settings UI clearly indicates which providers support direct audio

**Multi-session architecture:**
- Each recording session is an independent entity with its own transcript, notes, attachments, and AI state
- Sessions are managed by a session manager service in the main process
- The renderer can display any session (active or historical) while recording continues in the background
- The floating mini control bar is a separate BrowserWindow (always-on-top, frameless, small)
- A recording is "active" while the mic is recording. It becomes "inactive" when the mic is stopped/disconnected (NOT muted)
- When a session becomes inactive, end-of-meeting processing triggers automatically

**Audio format:** Use `audio/ogg;codecs=opus` for MediaRecorder (accepted by Gemini API). Fallback to webm + conversion if ogg not supported.

**Backpressure for audio IPC:** Cap chunk queue at 20 items, drop oldest when full. Write chunks to temp files and pass paths over IPC if binary serialization causes issues.

## Runtime Environment

- **Start command:** `cd apps/meeting-recorder && npm run dev`
- **Port:** Electron app (no HTTP port, uses IPC)
- **Build:** `npm run build` → `electron-vite build`
- **Package:** `npm run build:win`, `npm run build:mac`, `npm run build:linux`

## Progress Tracking

- [x] Task 1: Project scaffolding
- [x] Task 2: Database schema and service
- [x] Task 3: Audio capture and mic detection
- [x] Task 4: AI provider service (Vercel AI SDK)
- [x] Task 5: Session management service
- [x] Task 6: Real-time transcription pipeline
- [x] Task 7: Floating mini control bar and window management
- [x] Task 8: Main UI layout and live transcript view
- [x] Task 9: Speaker identification and management
- [x] Task 10: Context notes panel (rich attachments)
- [x] Task 11: Meeting type templates and end-of-meeting processing
- [x] Task 12: Sentiment analysis, talking points, and action items
- [x] Task 13: Real-time translation and on-demand summarization
- [x] Task 14: Recording history browser (calendar + timeline views)
- [x] Task 15: Settings UI and provider configuration

- [x] Task 16: [FIX] useSessionStore persist + useSpeakerStore session-keyed
- [x] Task 17: [FIX] Streaming summarization (streamText)
- [x] Task 18: [FIX] Mini control bar session switcher + auto-appear + always-on-top
- [x] Task 19: [FIX] Two-tier provider model + Settings audio-capable badges
- [x] Task 20: [FIX] MeetingTypeEditor component
- [x] Task 21: [FIX] Dashboard onboarding wired to AI state
- [x] Task 22: [FIX] Translation 429 backoff + display below segments
- [x] Task 23: [FIX] History search via IPC + N+1 fix
- [x] Task 24: [FIX] API keys security - mask in renderer
- [x] Task 25: [FIX] Missing store tests
- [x] Task 26: [FIX] Suggestions batch (sandbox, LanguageModel type, macOS lsof, virtualized scrolling)

> Extended 2026-02-25: Tasks 16-26 added for verification findings (compliance + quality review)

**Total Tasks:** 26 | **Completed:** 26 | **Remaining:** 0

## Implementation Tasks

### Task 1: Project Scaffolding

**Objective:** Create a new Electron app at `apps/meeting-recorder/` with electron-vite, React 18, TypeScript, Tailwind CSS v3, shadcn/ui, and Zustand. App launches and shows a placeholder window.

**Dependencies:** None

**Files:**
- Create: `apps/meeting-recorder/package.json`
- Create: `apps/meeting-recorder/electron.vite.config.ts`
- Create: `apps/meeting-recorder/electron-builder.yml`
- Create: `apps/meeting-recorder/tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `apps/meeting-recorder/tailwind.config.js`, `postcss.config.js`
- Create: `apps/meeting-recorder/components.json` (shadcn config)
- Create: `apps/meeting-recorder/electron/main/index.ts`
- Create: `apps/meeting-recorder/electron/preload/index.ts`
- Create: `apps/meeting-recorder/src/index.html`, `src/main.tsx`, `src/App.tsx`
- Create: `apps/meeting-recorder/src/globals.css`, `src/lib/utils.ts`
- Create: `apps/meeting-recorder/vitest.config.ts`
- Test: `apps/meeting-recorder/src/__tests__/App.test.tsx`

**Key Decisions / Notes:**
- Mirror directory structure of `apps/electron/` (main/preload/src split)
- Path aliases: `@/` → `src/`, `@components/`, `@pages/`, `@hooks/`, `@store/`, `@lib/`
- Install shadcn/ui: `npx shadcn@latest init` then add Button, Dialog, DropdownMenu, Tabs, Toast, ScrollArea, Input, Select, Badge, Card, Separator, Sheet, Tooltip, Popover. Ensure `components.json` path aliases match `tsconfig.web.json` (`@/*` → `./src/*`). Run `npm run build` (not just dev) to verify alias resolution.
- Package name: `meeting-recorder`, App ID: `com.hidock.meeting-recorder`
- electron-builder targets: nsis (Windows), dmg (macOS x64+arm64), AppImage (Linux)
- **macOS entitlements:** Include `NSMicrophoneUsageDescription` in `electron-builder.yml` `mac.extendInfo`. Mirror existing app's entitlements pattern.
- **better-sqlite3 setup:** Add `"postinstall": "electron-rebuild"` to scripts. Add `asarUnpack: ['**/better-sqlite3/**']` to electron-builder.yml.
- **Two BrowserWindows** defined in main/index.ts: main window (1200x800) and mini control bar window (400x48, always-on-top, frameless) — Task 7 implements the control bar UI, but the window creation is set up here.

**Definition of Done:**
- [ ] `npm install` completes without errors (including better-sqlite3 native build)
- [ ] `npm run dev` launches an Electron window showing "Meeting Recorder" placeholder
- [ ] `npm run build` completes without errors (production build alias resolution works)
- [ ] TypeScript compiles cleanly (`npm run typecheck`)
- [ ] shadcn/ui Button component renders in the placeholder page
- [ ] Tailwind classes apply correctly
- [ ] Vitest runs and placeholder test passes

**Verify:**
- `cd apps/meeting-recorder && npm install && npm run build` — builds cleanly
- `cd apps/meeting-recorder && npm run typecheck` — no errors
- `cd apps/meeting-recorder && npx vitest run` — tests pass

---

### Task 2: Database Schema and Service

**Objective:** Create the SQLite database with better-sqlite3, including schema for sessions, recordings, transcript segments, speakers, meetings, attachments, action items, meeting templates, and settings. Include crash recovery on startup.

**Dependencies:** Task 1

**Files:**
- Create: `apps/meeting-recorder/electron/main/services/database.ts`
- Create: `apps/meeting-recorder/electron/main/services/database.types.ts`
- Test: `apps/meeting-recorder/electron/main/__tests__/database.test.ts`

**Key Decisions / Notes:**
- Schema tables:
  - `sessions` — id, status (active|inactive|interrupted|processing|complete), started_at, ended_at, meeting_type_id, title, summary
  - `recordings` — id, session_id, filename, file_path, duration_ms, sample_rate, created_at, status (recording|stopped|interrupted), last_chunk_index
  - `transcript_segments` — id, session_id, speaker_name, text, start_ms, end_ms, sentiment, confidence, language, chunk_index
  - `speakers` — id, name, display_name, created_at
  - `session_speakers` — session_id, speaker_id (many-to-many)
  - `meetings` — id, session_id, subject, attendees_json, notes, created_at
  - `attachments` — id, session_id, type (screenshot|note|file), filename, file_path, mime_type, content_text (for text notes), created_at
  - `action_items` — id, session_id, text, assignee, status (open|done), created_at
  - `talking_points` — id, session_id, topic, first_mentioned_ms
  - `meeting_types` — id, name, description, prompt_template, icon, is_default, created_at
  - `settings` — key-value store for app config
  - `schema_version` — version tracking
- **Crash recovery:** On startup, query for sessions with status='active' or recordings with status='recording'. Mark as 'interrupted'. Log recovery info.
- **Default meeting types** seeded on first run: General Meeting, Standup, 1:1, Interview, Brainstorm, Client Call, All-Hands
- Use Electron's `safeStorage.encryptString()` / `safeStorage.decryptString()` for API key encryption in settings table
- Export typed query functions for all CRUD operations

**Definition of Done:**
- [ ] Database initializes on app startup, creates all tables
- [ ] Default meeting types are seeded on first run
- [ ] CRUD operations work for all tables (verified by tests)
- [ ] Crash recovery detects and marks interrupted sessions on startup
- [ ] API keys are encrypted via safeStorage before storing, decrypted on read
- [ ] All query functions exported with TypeScript types

**Verify:**
- `cd apps/meeting-recorder && npx vitest run electron/main/__tests__/database.test.ts` — all tests pass

---

### Task 3: Audio Capture and Mic Detection

**Objective:** Implement cross-platform mic detection (is mic in use by another app?), audio recording via `getUserMedia`, and audio file storage. Audio chunks sent from renderer to main via fire-and-forget IPC.

**Dependencies:** Task 1, Task 2

**Files:**
- Create: `apps/meeting-recorder/electron/main/services/mic-detector.ts`
- Create: `apps/meeting-recorder/electron/main/services/audio-storage.ts`
- Create: `apps/meeting-recorder/electron/main/ipc/audio-handlers.ts`
- Create: `apps/meeting-recorder/src/hooks/useAudioCapture.ts`
- Create: `apps/meeting-recorder/src/services/audio-recorder.ts`
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/electron/main/__tests__/mic-detector.test.ts`
- Test: `apps/meeting-recorder/src/__tests__/audio-recorder.test.ts`

**Key Decisions / Notes:**
- **Mic detection:**
  - Windows: Poll BOTH `HKCU\...\microphone\NonPackaged` (Win32 apps) AND `HKCU\...\microphone` (packaged/UWP apps like Teams). If any entry has `LastUsedTimeStart > 0` and `LastUsedTimeStop == 0`, mic is active.
  - macOS: `lsof | grep coreaudio` via `child_process.exec`
  - Linux: Fallback chain — try `pactl list source-outputs` (PulseAudio/pipewire-pulse) → `pw-cli list-objects` (native PipeWire) → `/proc/asound/card*/pcm*/sub*/status` (ALSA kernel)
  - Poll interval: configurable, default 3 seconds
  - **Recording lifecycle:** Active when mic is recording. Inactive when mic is **stopped/disconnected** (NOT muted). Grace period (configurable, default 30 seconds) before marking inactive.
- **Audio capture (renderer):**
  - `navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })`
  - MediaRecorder with `audio/ogg;codecs=opus` (accepted by Gemini API). Fallback to webm + main-process conversion if ogg not supported.
  - Emit chunks every 15 seconds via `ondataavailable`
  - Send via fire-and-forget IPC (`ipcMain.on`, NOT `ipcMain.handle`)
- **Backpressure:** Queue cap at 20 chunks. Drop oldest when full with warning log. Pause MediaRecorder when queue > 15, resume when < 10.
- **Storage:** Save audio files to `~/Documents/MeetingRecorder/recordings/<session-id>/`
- Handle macOS `PermissionDeniedError` from `getUserMedia` with platform-specific guidance

**Definition of Done:**
- [ ] `MicDetector.poll()` returns `{ active: boolean, appName?: string }` within 3 seconds. Emits `audio:micStatus` IPC events. On detection failure returns `{ active: false, error: string }` and logs error. Unit tests cover all outcomes with mocked child_process.
- [ ] Audio recording captures microphone input as ogg/opus chunks
- [ ] Chunks sent from renderer to main via fire-and-forget IPC without blocking renderer
- [ ] Recording saves a playable audio file to disk per session
- [ ] Backpressure mechanism caps queue and pauses/resumes MediaRecorder

**Verify:**
- `cd apps/meeting-recorder && npx vitest run electron/main/__tests__/mic-detector.test.ts src/__tests__/audio-recorder.test.ts` — tests pass

---

### Task 4: AI Provider Service (Vercel AI SDK)

**Objective:** Multi-provider AI abstraction via Vercel AI SDK. Support Gemini, OpenAI, Anthropic, Bedrock, Ollama with unified interface. Use `generateObject()` with Zod schemas for structured output.

**Dependencies:** Task 1, Task 2

**Files:**
- Create: `apps/meeting-recorder/electron/main/services/ai-provider.ts`
- Create: `apps/meeting-recorder/electron/main/services/ai-provider.types.ts`
- Create: `apps/meeting-recorder/electron/main/services/ai-schemas.ts` (Zod schemas)
- Create: `apps/meeting-recorder/electron/main/services/ai-prompts.ts`
- Create: `apps/meeting-recorder/electron/main/ipc/ai-handlers.ts`
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/electron/main/__tests__/ai-provider.test.ts`

**Key Decisions / Notes:**
- **Dependencies:** `ai`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/amazon-bedrock`, `zod`
- **Provider config in settings table:**
  - `ai.provider` — active provider key
  - `ai.model` — model ID
  - `ai.apiKey.<provider>` — per-provider API keys (encrypted via safeStorage)
  - `ai.ollama.baseUrl` — default `http://localhost:11434`
  - `ai.bedrock.region`, `ai.bedrock.accessKeyId`, `ai.bedrock.secretAccessKey`, `ai.bedrock.sessionToken` (optional)
  - `ai.transcriptionProvider` — for text-only providers, which audio-capable model handles transcription
- **Use `generateObject()` with Zod schema** for ALL structured LLM responses. `TranscriptionResultSchema`:
  ```
  segments: [{ speaker, text, startMs?, endMs?, sentiment, language }]
  topics: string[]
  actionItems: [{ text, assignee? }]
  ```
  `startMs`/`endMs` are optional — derive from `chunk_index * chunk_duration` if omitted.
- **Graceful degradation:** If `generateObject()` fails, fall back to raw text as single "Unknown" speaker segment.
- **Sanitize** all user-provided context (meeting notes, attendee names) before prompt injection.
- **Prompt templates** in `ai-prompts.ts`: TRANSCRIPTION, SUMMARIZATION, TRANSLATION, END_OF_MEETING (uses meeting type template)

**Definition of Done:**
- [ ] Provider factory creates correct AI SDK model instance for each of the 5 providers
- [ ] Audio-capable providers (Gemini) accept audio input and return structured TranscriptionResult via generateObject()
- [ ] Text-only providers use transcription model fallback correctly
- [ ] When `ai.provider` setting changes via `settings:save` IPC, the service re-initializes its model instance without app restart. Verified by unit test switching between providers.
- [ ] API key validation returns clear error messages per provider
- [ ] Zod schema validation catches malformed LLM responses gracefully

**Verify:**
- `cd apps/meeting-recorder && npx vitest run electron/main/__tests__/ai-provider.test.ts` — tests pass

---

### Task 5: Session Management Service

**Objective:** Implement the multi-session lifecycle. Sessions are created automatically when mic activates, run concurrently, and transition through states. New sessions start in the background independently of what the user is viewing.

**Dependencies:** Task 2, Task 3

**Files:**
- Create: `apps/meeting-recorder/electron/main/services/session-manager.ts`
- Create: `apps/meeting-recorder/electron/main/ipc/session-handlers.ts`
- Create: `apps/meeting-recorder/src/store/useSessionStore.ts`
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/electron/main/__tests__/session-manager.test.ts`

**Key Decisions / Notes:**
- **Session lifecycle:** `active` → `inactive` → `processing` → `complete`
  - `active`: Mic is recording, transcription pipeline running
  - `inactive`: Mic stopped/disconnected (after grace period). End-of-meeting processing queued.
  - `processing`: End-of-meeting summarization/categorization running
  - `complete`: All processing done, session is historical
  - `interrupted`: Recovered after crash (set on startup)
- **Multi-session behavior:**
  - Only ONE session is actively recording at a time (one mic)
  - When current session becomes inactive, the session manager is immediately ready for a new session
  - If mic reactivates within the grace period, the SAME session resumes
  - If mic reactivates AFTER the grace period, a NEW session starts
  - User can view any session (active or historical) while recording continues in background
  - The "viewed session" and "active recording session" are independent concepts
- **IPC events (push to renderer):**
  - `session:created` — new session started
  - `session:statusChanged` — session transitioned state
  - `session:list` — updated session list
- **useSessionStore (Zustand):**
  - `activeSessionId` — currently recording session (null if none)
  - `viewingSessionId` — session the user is looking at (can differ from active)
  - `sessions` — Map of session metadata (id, status, title, startedAt, meetingType)
  - Actions: `switchView(sessionId)`, `setActiveSession(id)`, etc.
  - Persist: only `viewingSessionId` (restore last viewed on restart)

**Definition of Done:**
- [ ] Sessions are created automatically when mic activates
- [ ] Session transitions through lifecycle states correctly (active → inactive → processing → complete)
- [ ] Grace period prevents new session on brief mic interruptions
- [ ] New session starts immediately when mic reactivates after grace period expires
- [ ] User can view historical sessions while a new recording runs in background
- [ ] Session store correctly tracks activeSessionId and viewingSessionId independently

**Verify:**
- `cd apps/meeting-recorder && npx vitest run electron/main/__tests__/session-manager.test.ts` — tests pass

---

### Task 6: Real-Time Transcription Pipeline

**Objective:** Wire audio capture → AI provider → database → UI into a per-session real-time pipeline. Audio chunks flow to the LLM, responses are stored per session, and results are pushed to renderer.

**Dependencies:** Task 2, Task 3, Task 4, Task 5

**Files:**
- Create: `apps/meeting-recorder/electron/main/services/transcription-pipeline.ts`
- Create: `apps/meeting-recorder/electron/main/ipc/transcription-handlers.ts`
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/electron/main/__tests__/transcription-pipeline.test.ts`

**Key Decisions / Notes:**
- **Pipeline is per-session:** Each active session has its own pipeline instance
- **Flow:** chunk arrives → build context (last 10 segments + meeting info + speaker names + attachment metadata) → `generateObject()` with Zod schema → store segments in DB → push to renderer
- **Context management:** Keep last 10 transcript segments as LLM context. Include meeting attendee names, user-corrected speaker names, session notes text, meeting type context.
- **Queue:** Chunks queued if previous still processing. Track chunk_index for ordering. Retry once on LLM error, then skip with warning.
- **IPC events:** `transcription:newSegments`, `transcription:topicsUpdated`, `transcription:actionItemsUpdated`, `transcription:error`, `transcription:status`

**Definition of Done:**
- [ ] Audio chunks processed through full pipeline per session (capture → LLM → DB → UI)
- [ ] After chunk sent via IPC, `transcription:newSegments` emitted within 500ms of LLM response (excluding network latency). Verified by unit test with mocked AI provider.
- [ ] Previous context included in each LLM call for continuity
- [ ] Speaker names persist across chunks within a session
- [ ] Pipeline handles LLM errors without crashing (retry + skip)
- [ ] Pipeline is session-scoped — multiple pipelines don't interfere

**Verify:**
- `cd apps/meeting-recorder && npx vitest run electron/main/__tests__/transcription-pipeline.test.ts` — tests pass

---

### Task 7: Floating Mini Control Bar and Window Management

**Objective:** Build the always-on-top floating mini control bar — a small, frameless window (like Teams/Slack screen-sharing bar) that shows recording status, elapsed time, and provides instant session switching. Also implement the two-window management (main window + control bar).

**Dependencies:** Task 1, Task 5

**Files:**
- Create: `apps/meeting-recorder/src/components/MiniControlBar.tsx`
- Create: `apps/meeting-recorder/src/mini-control-bar.html` (separate entry point)
- Create: `apps/meeting-recorder/src/mini-control-bar.tsx` (renderer entry for control bar window)
- Create: `apps/meeting-recorder/electron/main/services/window-manager.ts`
- Modify: `apps/meeting-recorder/electron/main/index.ts` (two-window setup)
- Modify: `apps/meeting-recorder/electron.vite.config.ts` (add mini-control-bar entry)
- Modify: `apps/meeting-recorder/electron/preload/index.ts` (shared preload)
- Test: `apps/meeting-recorder/src/__tests__/MiniControlBar.test.tsx`

**Key Decisions / Notes:**
- **Mini control bar window:**
  - Frameless, always-on-top, ~400×48px, draggable
  - Position: top-center of screen (configurable)
  - Shows: recording indicator (red dot + pulse animation), elapsed time, active session title, session switcher dropdown
  - Buttons: pause/resume, switch to main window, end recording, minimize bar
  - Appears automatically when recording starts
  - Can be hidden/shown via tray menu or keyboard shortcut
- **Two-window architecture:**
  - Main window: full UI (transcript, notes, history, settings)
  - Control bar: tiny floating overlay for session awareness
  - Both windows share the same Zustand store via IPC sync (main process is source of truth)
  - Control bar actions (switch session, end recording) go through IPC to main process
- **Session switcher** in control bar: dropdown showing active session + recent sessions, click to switch viewing context in main window
- **Always-on-top for main window:** Automatically enabled when recording starts, restored to user preference when stopped

**Definition of Done:**
- [ ] Mini control bar renders as a separate frameless always-on-top window
- [ ] Control bar shows recording status, elapsed time, and session title
- [ ] Session switcher dropdown allows switching between active and recent sessions
- [ ] Control bar appears automatically when recording starts
- [ ] Actions in control bar (end recording, switch session) correctly update main window
- [ ] Main window always-on-top auto-enables during recording, restores on stop

**Verify:**
- `cd apps/meeting-recorder && npx vitest run src/__tests__/MiniControlBar.test.tsx` — tests pass
- Start app via Electron MCP, verify control bar appears on recording, verify session switching via console inspection

---

### Task 8: Main UI Layout and Live Transcript View

**Objective:** Build the main application UI with dashboard layout, live transcript panel with speaker labels and timestamps, recording controls, and sidebar structure.

**Dependencies:** Task 1, Task 5, Task 6

**Files:**
- Create: `apps/meeting-recorder/src/pages/Dashboard.tsx`
- Create: `apps/meeting-recorder/src/components/TranscriptPanel.tsx`
- Create: `apps/meeting-recorder/src/components/RecordingControls.tsx`
- Create: `apps/meeting-recorder/src/components/RecordingIndicator.tsx`
- Create: `apps/meeting-recorder/src/components/SessionHeader.tsx` (shows current session info)
- Create: `apps/meeting-recorder/src/components/layout/AppLayout.tsx`
- Create: `apps/meeting-recorder/src/store/useTranscriptStore.ts`
- Create: `apps/meeting-recorder/src/hooks/useTranscriptionStream.ts`
- Test: `apps/meeting-recorder/src/__tests__/TranscriptPanel.test.tsx`
- Test: `apps/meeting-recorder/src/__tests__/RecordingControls.test.tsx`

**Key Decisions / Notes:**
- **Layout:** Three-column layout:
  - **Left sidebar:** Session list (active + recent), session switcher
  - **Center:** Live transcript panel — auto-scrolling, speaker names as colored labels, timestamps, sentiment badges
  - **Right sidebar:** Tabbed panels (Topics, Actions, Notes, Summary)
- **Session-aware:** Dashboard displays whichever session `viewingSessionId` points to. If viewing the active session, transcript updates in real-time. If viewing a historical session, shows stored data.
- **TranscriptPanel:** Virtualized scrolling (`@tanstack/react-virtual`). Auto-scroll with "scroll lock" on user scroll-up. Empty state with onboarding prompt if no provider configured.
- **RecordingControls:** Manual start/stop, auto-record toggle, mic status, elapsed time
- **If no AI provider configured:** Dashboard shows onboarding prompt linking to Settings. Auto-recording disabled.

**Definition of Done:**
- [ ] Dashboard renders with left sidebar, transcript center, right sidebar
- [ ] Session list shows active and recent sessions with status indicators
- [ ] Live transcript displays segments with speaker names, text, timestamps
- [ ] Transcript auto-scrolls and pauses when user scrolls up
- [ ] Session switching updates the displayed transcript
- [ ] Recording controls function (start/stop, auto toggle)
- [ ] Onboarding prompt shown when no AI provider configured

**Verify:**
- `cd apps/meeting-recorder && npx vitest run src/__tests__/TranscriptPanel.test.tsx src/__tests__/RecordingControls.test.tsx` — tests pass

---

### Task 9: Speaker Identification and Management

**Objective:** LLM-based speaker identification (names inferred from audio/context), UI for viewing and editing speaker names, and meeting attendee context.

**Dependencies:** Task 6, Task 8

**Files:**
- Create: `apps/meeting-recorder/src/components/SpeakerList.tsx`
- Create: `apps/meeting-recorder/src/components/MeetingInfoDialog.tsx`
- Create: `apps/meeting-recorder/src/store/useSpeakerStore.ts`
- Create: `apps/meeting-recorder/electron/main/ipc/speaker-handlers.ts`
- Modify: `apps/meeting-recorder/electron/main/services/ai-prompts.ts`
- Modify: `apps/meeting-recorder/electron/main/services/transcription-pipeline.ts`
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/src/__tests__/SpeakerList.test.tsx`

**Key Decisions / Notes:**
- LLM infers names from audio cues ("Hi, I'm Sarah"), meeting attendee context, and conversation flow
- If meeting attendees provided, included in prompt: "Known attendees: John Smith, Sarah Jones..."
- Unknown speakers get "Speaker 1", "Speaker 2"
- User clicks speaker name to edit — update propagates to ALL segments with that label
- Updated names fed back as context for subsequent chunks
- MeetingInfoDialog: enter subject and attendee names per session

**Definition of Done:**
- [ ] LLM-inferred speaker names appear in transcript segments
- [ ] User can edit speaker names; edits propagate to all segments
- [ ] Meeting attendee info dialog feeds names into LLM context
- [ ] Updated names used as context for subsequent audio chunks
- [ ] Speakers persisted in database per session

**Verify:**
- `cd apps/meeting-recorder && npx vitest run src/__tests__/SpeakerList.test.tsx` — tests pass

---

### Task 10: Context Notes Panel (Rich Attachments)

**Objective:** Build a notes panel where users can add screenshots, text notes, and file attachments (DOCX, PPTX, images, audio files) to enrich the session context. Attachment metadata is included in LLM prompts.

**Dependencies:** Task 2, Task 8

**Files:**
- Create: `apps/meeting-recorder/src/components/NotesPanel.tsx`
- Create: `apps/meeting-recorder/src/components/AttachmentItem.tsx`
- Create: `apps/meeting-recorder/src/components/NoteEditor.tsx` (rich text input)
- Create: `apps/meeting-recorder/electron/main/services/attachment-service.ts`
- Create: `apps/meeting-recorder/electron/main/ipc/attachment-handlers.ts`
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Modify: `apps/meeting-recorder/electron/main/services/transcription-pipeline.ts` (include notes context)
- Test: `apps/meeting-recorder/src/__tests__/NotesPanel.test.tsx`

**Key Decisions / Notes:**
- **Notes panel** lives in the right sidebar as a tab
- **Text notes:** Simple rich text editor (could use a textarea for POC). Notes are stored in `attachments` table with type='note'.
- **File attachments:** Drag-and-drop or file picker. Files copied to session directory. Supported types: images (PNG, JPG), documents (DOCX, PPTX, PDF), audio files. Stored as references in `attachments` table.
- **Screenshots:** Button to capture screen region (future) or paste from clipboard. For POC, paste from clipboard into notes.
- **LLM context enrichment:** Text notes are included directly in the LLM prompt context. File attachments are listed as metadata (filename, type) — actual content extraction from DOCX/PPTX is out of scope for POC.
- **Session-scoped:** Each session has its own notes and attachments

**Definition of Done:**
- [ ] Notes panel renders in right sidebar with text editor and attachment list
- [ ] User can add text notes that persist in the database
- [ ] User can drag-and-drop or pick files to attach to the session
- [ ] Attached files are copied to the session directory and listed in the panel
- [ ] Text notes are included in the LLM transcription prompt context
- [ ] Clipboard paste works for images

**Verify:**
- `cd apps/meeting-recorder && npx vitest run src/__tests__/NotesPanel.test.tsx` — tests pass

---

### Task 11: Meeting Type Templates and End-of-Meeting Processing

**Objective:** Implement meeting type selection (each with custom end-of-meeting prompts) and automatic end-of-meeting processing that generates a comprehensive summary, categorization, and template-specific outputs when a session ends.

**Dependencies:** Task 2, Task 4, Task 5

**Files:**
- Create: `apps/meeting-recorder/src/components/MeetingTypeSelector.tsx`
- Create: `apps/meeting-recorder/src/components/MeetingTypeEditor.tsx` (create/edit templates)
- Create: `apps/meeting-recorder/electron/main/services/end-of-meeting-processor.ts`
- Create: `apps/meeting-recorder/electron/main/ipc/meeting-type-handlers.ts`
- Modify: `apps/meeting-recorder/electron/main/services/session-manager.ts` (trigger processing on inactive)
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/electron/main/__tests__/end-of-meeting-processor.test.ts`
- Test: `apps/meeting-recorder/src/__tests__/MeetingTypeSelector.test.tsx`

**Key Decisions / Notes:**
- **Meeting types** (seeded defaults with editable prompt templates):
  - **General Meeting:** Summary, decisions, action items, key takeaways
  - **Standup/Daily:** Per-person updates (yesterday, today, blockers), team action items
  - **1:1:** Discussion points, feedback, agreed actions, follow-ups
  - **Interview:** Candidate assessment, strengths/weaknesses, recommendation, key quotes
  - **Brainstorm:** Ideas generated, themes, next steps, priority ranking
  - **Client Call:** Client requests, commitments made, deliverables, timeline
  - **All-Hands:** Announcements, Q&A summary, action items, sentiment overview
- **User can select meeting type** at any time during or before a session (dropdown in SessionHeader)
- **User can create/edit custom templates** — each template has: name, description, prompt template (with `{{transcript}}`, `{{speakers}}`, `{{notes}}`, `{{attachments}}` placeholders)
- **End-of-meeting processing:** Triggered when session becomes inactive. Sends full transcript + all notes/attachment metadata + meeting type prompt to LLM. Response stored as session summary. Session status transitions: inactive → processing → complete.
- **Processing is non-blocking:** Runs in background. User sees "Processing..." indicator on the session. They can still browse the transcript and notes while processing runs.

**Definition of Done:**
- [ ] Meeting type selector dropdown shows all available types
- [ ] User can change meeting type during a session
- [ ] Custom meeting type templates can be created and edited
- [ ] End-of-meeting processing triggers automatically when session becomes inactive
- [ ] Processing sends full context (transcript + notes + template prompt) to LLM
- [ ] Summary and template outputs stored in database and displayed in session
- [ ] Processing runs in background without blocking UI

**Verify:**
- `cd apps/meeting-recorder && npx vitest run electron/main/__tests__/end-of-meeting-processor.test.ts src/__tests__/MeetingTypeSelector.test.tsx` — tests pass

---

### Task 12: Sentiment Analysis, Talking Points, and Action Items

**Objective:** Display real-time sentiment per segment, accumulated talking points, and detected action items in sidebar panels.

**Dependencies:** Task 6, Task 8

**Files:**
- Create: `apps/meeting-recorder/src/components/SentimentBadge.tsx`
- Create: `apps/meeting-recorder/src/components/TalkingPointsPanel.tsx`
- Create: `apps/meeting-recorder/src/components/ActionItemsPanel.tsx`
- Create: `apps/meeting-recorder/src/components/SidebarTabs.tsx`
- Modify: `apps/meeting-recorder/src/components/TranscriptPanel.tsx` (add sentiment badges)
- Modify: `apps/meeting-recorder/src/store/useTranscriptStore.ts`
- Test: `apps/meeting-recorder/src/__tests__/TalkingPointsPanel.test.tsx`
- Test: `apps/meeting-recorder/src/__tests__/ActionItemsPanel.test.tsx`

**Key Decisions / Notes:**
- **Sentiment:** Colored badge per segment (green=positive, yellow=neutral, red=negative, orange=mixed)
- **Talking points:** Accumulated topics with first-mentioned timestamp. Click scrolls transcript.
- **Action items:** Text + optional assignee + checkbox. User can manually add/edit items.
- All extracted by the LLM in the transcription pipeline (already structured in TranscriptionResult). This task is display-only.
- **SidebarTabs:** Topics, Actions, Notes (Task 10), Summary (Task 13)

**Definition of Done:**
- [ ] Sentiment badges on each transcript segment with correct colors
- [ ] Talking points panel shows topics with timestamps; clicking scrolls transcript
- [ ] Action items panel with extracted items, assignee, and checkbox
- [ ] User can manually add/edit/complete action items
- [ ] All panels update in real-time as new LLM responses arrive

**Verify:**
- `cd apps/meeting-recorder && npx vitest run src/__tests__/TalkingPointsPanel.test.tsx src/__tests__/ActionItemsPanel.test.tsx` — tests pass

---

### Task 13: Real-Time Translation and On-Demand Summarization

**Objective:** Real-time translation of transcript segments and on-demand meeting summary generation, both displayed in the UI.

**Dependencies:** Task 4, Task 6, Task 8

**Files:**
- Create: `apps/meeting-recorder/electron/main/services/translation-service.ts`
- Create: `apps/meeting-recorder/electron/main/services/summarization-service.ts`
- Create: `apps/meeting-recorder/src/components/TranslationToggle.tsx`
- Create: `apps/meeting-recorder/src/components/SummaryPanel.tsx`
- Modify: `apps/meeting-recorder/src/components/TranscriptPanel.tsx` (translated text below original)
- Modify: `apps/meeting-recorder/src/components/SidebarTabs.tsx` (add Summary tab)
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/electron/main/__tests__/translation-service.test.ts`
- Test: `apps/meeting-recorder/src/__tests__/SummaryPanel.test.tsx`

**Key Decisions / Notes:**
- **Translation:** Toggle + language selector. Translated text appears below original in each segment. Separate LLM call per batch (3-5 segments batched every 30-45s to reduce API calls). Rate limiting: max 2 concurrent translation calls, exponential backoff on 429.
- **Summarization:** "Generate Summary" button in Summary tab. Streams response via AI SDK `streamText()`. Can be regenerated at any point. Saved to database.
- Both use the configured AI provider.

**Definition of Done:**
- [ ] Translation toggle with language selector works
- [ ] Translated text appears below each segment when enabled
- [ ] Translation batches segments to reduce API calls
- [ ] Rate limiting with exponential backoff on 429 errors
- [ ] "Generate Summary" button streams summary into Summary tab
- [ ] Summary saved to database and persists

**Verify:**
- `cd apps/meeting-recorder && npx vitest run electron/main/__tests__/translation-service.test.ts src/__tests__/SummaryPanel.test.tsx` — tests pass

---

### Task 14: Recording History Browser (Calendar + Timeline Views)

**Objective:** Build a history view with two display modes: a **calendar view** (default, similar to the existing Electron app's Calendar page) showing sessions placed on a time-grid, and a **vertical timeline/list view** as an alternative. Users can browse, search, and review past sessions.

**Dependencies:** Task 2, Task 5, Task 8

**Files:**
- Create: `apps/meeting-recorder/src/pages/History.tsx`
- Create: `apps/meeting-recorder/src/components/history/CalendarView.tsx` (calendar grid with time slots)
- Create: `apps/meeting-recorder/src/components/history/TimelineView.tsx` (vertical chronological list)
- Create: `apps/meeting-recorder/src/components/history/SessionCard.tsx` (card used in both views)
- Create: `apps/meeting-recorder/src/components/history/CalendarHeader.tsx` (navigation, view switcher)
- Create: `apps/meeting-recorder/src/components/history/SessionSearch.tsx`
- Create: `apps/meeting-recorder/src/lib/calendar-utils.ts` (date helpers, time grid math)
- Create: `apps/meeting-recorder/src/store/useHistoryStore.ts` (view mode, date range, filters)
- Create: `apps/meeting-recorder/electron/main/ipc/history-handlers.ts`
- Modify: `apps/meeting-recorder/src/App.tsx` (add routing)
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/src/__tests__/CalendarView.test.tsx`
- Test: `apps/meeting-recorder/src/__tests__/TimelineView.test.tsx`

**Key Decisions / Notes:**
- **Calendar view (default):** Follow the existing app's Calendar pattern at `apps/electron/src/pages/Calendar.tsx`:
  - Time-grid layout with hours on Y-axis, days on X-axis
  - Sessions shown as colored blocks positioned by start time and duration
  - View modes: Day, Work Week, Week, Month (like existing app's `CalendarViewType`)
  - Date navigation (prev/next, today button)
  - Sessions color-coded by meeting type
  - Clicking a session block opens it in the Dashboard
  - Reference `apps/electron/src/lib/calendar-utils.ts` for time-grid math (HOUR_HEIGHT, START_HOUR, END_HOUR, getWeekDates, etc.)
- **Timeline view (alternative):** Vertical chronological list grouped by day
  - Each day header shows date
  - Sessions listed chronologically with: title, time range, duration, meeting type badge, speaker count, action item count, status badge
  - More compact, better for scanning many sessions quickly
- **View toggle:** Button group in header (Calendar | Timeline), persisted in store
- **Search:** Full-text search across session titles, transcript text, and notes
- **Filtering:** By date range, meeting type, speaker
- **Deletion:** Delete sessions with confirmation dialog
- **useHistoryStore (Zustand, persisted):** viewMode (calendar|timeline), calendarViewType (day|workweek|week|month), currentDate, filters
- Use react-router-dom: `/` = Dashboard, `/history` = History, `/settings` = Settings

**Definition of Done:**
- [ ] Calendar view renders sessions on a time-grid matching the existing app's calendar pattern
- [ ] Calendar supports Day, Work Week, Week, Month view modes
- [ ] Timeline view renders sessions as a chronological grouped list
- [ ] View toggle switches between Calendar and Timeline (persisted)
- [ ] Date navigation (prev/next, today) works in calendar view
- [ ] Clicking a session navigates to Dashboard with that session loaded
- [ ] Search and filter (date, type, speaker) work in both views
- [ ] Session deletion with confirmation dialog
- [ ] Navigation between Dashboard, History, Settings works

**Verify:**
- `cd apps/meeting-recorder && npx vitest run src/__tests__/CalendarView.test.tsx src/__tests__/TimelineView.test.tsx` — tests pass

---

### Task 15: Settings UI and Provider Configuration

**Objective:** Settings page for AI providers (API keys, model selection), recording preferences, meeting type management, and general app preferences.

**Dependencies:** Task 1, Task 2, Task 4

**Files:**
- Create: `apps/meeting-recorder/src/pages/Settings.tsx`
- Create: `apps/meeting-recorder/src/components/settings/ProviderSettings.tsx`
- Create: `apps/meeting-recorder/src/components/settings/RecordingSettings.tsx`
- Create: `apps/meeting-recorder/src/components/settings/GeneralSettings.tsx`
- Create: `apps/meeting-recorder/src/store/useSettingsStore.ts`
- Create: `apps/meeting-recorder/electron/main/ipc/settings-handlers.ts`
- Create: `apps/meeting-recorder/electron/main/services/tray-manager.ts`
- Modify: `apps/meeting-recorder/electron/main/index.ts` (initialize tray)
- Modify: `apps/meeting-recorder/electron/main/ipc/handlers.ts`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Test: `apps/meeting-recorder/src/__tests__/Settings.test.tsx`

**Key Decisions / Notes:**
- **Provider settings:** Active provider dropdown, per-provider API key input (masked, test button), model selection, Ollama base URL, Bedrock AWS credentials (region, access key, secret key, session token), transcription model for text-only providers
- **Recording settings:** Auto-record toggle, mic poll interval (1-10s), grace period (5-60s), chunk interval (10-30s), save directory picker
- **General settings:** Default transcription language, translation target language, theme (light/dark/system), start minimized to tray, control bar position
- **System tray:** Tray icon (normal + recording variant), context menu (show/hide, start/stop, settings, quit), close-to-tray behavior
- **If no provider configured:** Dashboard shows onboarding prompt linking to Settings

**Definition of Done:**
- [ ] Settings page renders with Provider, Recording, and General sections
- [ ] AI provider selection, API keys, and model config persist and update AI service
- [ ] Bedrock AWS credentials (region, keys) configurable
- [ ] Recording preferences saved and respected
- [ ] System tray icon appears, changes during recording, context menu works
- [ ] Close-to-tray behavior works (configurable)
- [ ] Settings persist across app restarts
- [ ] If no provider configured, Dashboard shows onboarding prompt with Settings link

**Verify:**
- `cd apps/meeting-recorder && npx vitest run src/__tests__/Settings.test.tsx` — tests pass

---

### Task 16: [FIX] useSessionStore persist + useSpeakerStore session-keyed

**Objective:** Fix useSessionStore to persist `viewingSessionId` via Zustand persist middleware (plan requirement). Fix useSpeakerStore to key speakers by sessionId so `getSpeakersForSession` returns correct data.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/src/store/useSessionStore.ts`
- Modify: `apps/meeting-recorder/src/store/useSpeakerStore.ts`
- Modify: `apps/meeting-recorder/src/__tests__/useSessionStore.test.ts`
- Test: `apps/meeting-recorder/src/__tests__/useSpeakerStore.test.ts`

**Key Decisions / Notes:**
- useSessionStore: Wrap with `persist` middleware, `partialize` to only persist `viewingSessionId`. Exclude `sessions` Map and `activeSessionId` (transient).
- useSpeakerStore: Change internal storage from `Map<string, SpeakerInfo>` to `Map<string, SpeakerInfo[]>` keyed by sessionId. Update `setSpeakers(sessionId, speakers)`, `getSpeakersForSession(sessionId)`, and `renameSpeaker(sessionId, oldName, newName)`.

**Definition of Done:**
- [ ] viewingSessionId persists across app restart (verified by test)
- [ ] getSpeakersForSession returns only speakers for that session
- [ ] Sessions Map and activeSessionId NOT persisted

**Verify:**
- `npx vitest run src/__tests__/useSessionStore.test.ts src/__tests__/useSpeakerStore.test.ts`

---

### Task 17: [FIX] Streaming summarization (streamText)

**Objective:** Switch SummarizationService from `generateObject()` to `streamText()` per plan requirement. Push streamed chunks to renderer via IPC.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/electron/main/services/summarization-service.ts`
- Modify: `apps/meeting-recorder/electron/main/services/ai-schemas.ts` (add SummarizationResultSchema if missing)
- Modify: `apps/meeting-recorder/electron/preload/index.ts` (add summarization:chunk listener)
- Test: `apps/meeting-recorder/electron/main/__tests__/summarization-service.test.ts`

**Key Decisions / Notes:**
- Use `streamText()` from AI SDK instead of `generateObject()`. Push partial text via `webContents.send('summarization:chunk', { sessionId, text })`.
- After stream completes, parse the full text as JSON and save structured result to database.
- SummaryPanel accumulates streamed chunks for live display.

**Definition of Done:**
- [ ] SummarizationService uses streamText() for streaming output
- [ ] Partial text pushed to renderer via IPC as it arrives
- [ ] Complete summary saved to database after stream ends
- [ ] Tests verify streaming behavior with mocked streamText

**Verify:**
- `npx vitest run electron/main/__tests__/summarization-service.test.ts`

---

### Task 18: [FIX] Mini control bar session switcher + auto-appear + always-on-top

**Objective:** Implement the session switcher dropdown in MiniControlBar (props defined but unused). Wire control bar auto-show on recording start. Wire main window always-on-top during recording.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/src/components/MiniControlBar.tsx`
- Modify: `apps/meeting-recorder/electron/main/ipc/audio-handlers.ts` (call showControlBar on recording)
- Modify: `apps/meeting-recorder/electron/main/services/window-manager.ts` (wire always-on-top to session events)
- Modify: `apps/meeting-recorder/src/__tests__/MiniControlBar.test.tsx`

**Key Decisions / Notes:**
- Session switcher: Use existing `sessions` and `onSwitchSession` props. Render a `<select>` styled with no-drag CSS showing session titles.
- Auto-appear: In audio-handlers or session-handlers, call `showControlBar()` when a new session starts and `hideControlBar()` when active session count drops to 0.
- Always-on-top: Call `setMainWindowAlwaysOnTop(true)` when recording starts, `setMainWindowAlwaysOnTop(false)` when it stops.

**Definition of Done:**
- [ ] Session switcher dropdown renders active + recent sessions
- [ ] Clicking a session in dropdown calls onSwitchSession
- [ ] Control bar appears automatically when recording starts
- [ ] Control bar hides when no active sessions
- [ ] Main window always-on-top enables during recording, restores on stop

**Verify:**
- `npx vitest run src/__tests__/MiniControlBar.test.tsx`

---

### Task 19: [FIX] Two-tier provider model + Settings audio-capable badges

**Objective:** Implement transcription fallback for text-only providers. Add audio-capable badges to Settings provider dropdown.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/electron/main/services/ai-provider.ts`
- Modify: `apps/meeting-recorder/src/components/settings/ProviderSettings.tsx`
- Modify: `apps/meeting-recorder/electron/main/__tests__/ai-provider.test.ts`

**Key Decisions / Notes:**
- When `isAudioCapable()` is false and audio transcription is requested, route through a secondary transcription provider. Add `ai.transcriptionProvider` setting. If set to 'gemini', create a Gemini model for transcription while using the main provider for text analysis. If set to 'whisper', note this is out of scope for POC — just throw a clear error.
- ProviderSettings: Add "(Audio-capable)" badge next to Google Gemini, "(Text only)" next to others. Show transcription provider dropdown when a text-only provider is selected.

**Definition of Done:**
- [ ] Text-only providers show clear error or use transcription fallback
- [ ] Settings UI shows audio-capable badge per provider
- [ ] Transcription provider setting exposed when text-only provider selected
- [ ] Tests cover fallback behavior

**Verify:**
- `npx vitest run electron/main/__tests__/ai-provider.test.ts`

---

### Task 20: [FIX] MeetingTypeEditor component

**Objective:** Create MeetingTypeEditor for creating and editing custom meeting type templates (plan requirement, DoD unmet).

**Dependencies:** None

**Files:**
- Create: `apps/meeting-recorder/src/components/MeetingTypeEditor.tsx`
- Modify: `apps/meeting-recorder/src/pages/Settings.tsx` (add "New Template" button)
- Test: `apps/meeting-recorder/src/__tests__/MeetingTypeEditor.test.tsx`

**Key Decisions / Notes:**
- Form with: name, description, prompt_template (textarea with placeholder docs: `{{transcript}}`, `{{speakers}}`, `{{notes}}`, `{{attachments}}`).
- Wire to `meetingType:create` IPC handler already in meeting-type-handlers.ts.
- Show via Dialog from a "New Template" button in Settings page.

**Definition of Done:**
- [ ] MeetingTypeEditor renders with name, description, prompt_template fields
- [ ] Creating a template calls meetingType:create IPC and refreshes the list
- [ ] Accessible from Settings page
- [ ] Tests verify form rendering and submission

**Verify:**
- `npx vitest run src/__tests__/MeetingTypeEditor.test.tsx`

---

### Task 21: [FIX] Dashboard onboarding wired to AI state

**Objective:** Wire Dashboard's onboarding prompt to actual AI provider configuration state. Disable auto-record when no provider is configured.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/src/pages/Dashboard.tsx`
- Modify: `apps/meeting-recorder/src/__tests__/Dashboard.test.tsx`

**Key Decisions / Notes:**
- Read from useSettingsStore to check if apiKey is non-empty (or provider is 'ollama' which needs no key).
- Pass `providerConfigured={isConfigured}` to TranscriptPanel.
- Disable auto-record in RecordingControls when not configured.

**Definition of Done:**
- [ ] Onboarding prompt shows when no API key configured
- [ ] Auto-record disabled when no provider configured
- [ ] Tests verify both states

**Verify:**
- `npx vitest run src/__tests__/Dashboard.test.tsx`

---

### Task 22: [FIX] Translation 429 backoff + display below segments

**Objective:** Add exponential backoff retry on 429 errors in TranslationService. Display translated text below each transcript segment when enabled.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/electron/main/services/translation-service.ts`
- Modify: `apps/meeting-recorder/src/components/TranscriptPanel.tsx`
- Modify: `apps/meeting-recorder/src/store/useTranscriptStore.ts` (add translation map)
- Modify: `apps/meeting-recorder/electron/main/__tests__/translation-service.test.ts`

**Key Decisions / Notes:**
- In `callWithBackoff()`, catch errors containing '429' or 'rate'. Retry up to 3 times with exponential delays (1s, 2s, 4s).
- TranscriptPanel: When translation is enabled, show `translatedText` below each segment in a lighter color.
- Store translations in useTranscriptStore as a Map<segmentId, translatedText>.

**Definition of Done:**
- [ ] 429 errors trigger exponential backoff retry (up to 3 attempts)
- [ ] Translated text renders below original in TranscriptPanel
- [ ] Tests verify retry/backoff behavior

**Verify:**
- `npx vitest run electron/main/__tests__/translation-service.test.ts`

---

### Task 23: [FIX] History search via IPC + N+1 fix

**Objective:** Wire History.tsx to use history:search IPC instead of client-side filtering. Expose history:search and history:delete in preload. Fix N+1 query pattern in history search handler.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/src/pages/History.tsx`
- Modify: `apps/meeting-recorder/electron/preload/index.ts`
- Modify: `apps/meeting-recorder/electron/main/ipc/history-handlers.ts`
- Modify: `apps/meeting-recorder/electron/main/services/database-queries.ts` (add searchSessions)
- Test: `apps/meeting-recorder/electron/main/ipc/__tests__/history-handlers.test.ts`

**Key Decisions / Notes:**
- Add `history.search` and `history.delete` to preload electronAPI.
- Replace N+1 loop with single SQL query: `SELECT DISTINCT s.* FROM sessions s LEFT JOIN transcript_segments t ON s.id = t.session_id WHERE s.title LIKE ? OR t.text LIKE ?`.
- History.tsx calls `window.electronAPI.history.search(query)` on search input change.
- database-queries.ts is at 303 lines — the new searchSessions function should be in a new file or the existing file needs to be split.

**Definition of Done:**
- [ ] history:search and history:delete exposed in preload
- [ ] History.tsx uses IPC search instead of local filtering
- [ ] Search query finds matches in transcript text and session titles
- [ ] N+1 query replaced with single JOIN query
- [ ] Tests verify search handler behavior

**Verify:**
- `npx vitest run electron/main/ipc/__tests__/history-handlers.test.ts`

---

### Task 24: [FIX] API keys security - mask in renderer

**Objective:** Never send decrypted API keys to the renderer. Return masked values for display, keep actual keys in main process only.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/electron/main/ipc/settings-handlers.ts`
- Modify: `apps/meeting-recorder/src/store/useSettingsStore.ts`
- Modify: `apps/meeting-recorder/src/components/settings/ProviderSettings.tsx`
- Test: `apps/meeting-recorder/electron/main/ipc/__tests__/settings-handlers.test.ts`

**Key Decisions / Notes:**
- settings:getAll masks sensitive fields: return `'****' + key.slice(-4)` for API keys.
- Add `settings:testConnection` IPC that accepts provider name and tests the key from the main process without exposing it.
- When user enters a new key, send it via `settings:save` (already exists) which stores it encrypted.
- ProviderSettings shows masked value in display mode, raw input field only when editing.

**Definition of Done:**
- [ ] Decrypted API keys never sent to renderer
- [ ] Masked values displayed for existing keys
- [ ] Test connection works without exposing keys to renderer
- [ ] Tests verify masking behavior

**Verify:**
- `npx vitest run electron/main/ipc/__tests__/settings-handlers.test.ts`

---

### Task 25: [FIX] Missing store tests

**Objective:** Add tests for useSettingsStore, useTranscriptStore, useHistoryStore, useSpeakerStore.

**Dependencies:** Task 16 (useSpeakerStore changes)

**Files:**
- Create: `apps/meeting-recorder/src/__tests__/useSettingsStore.test.ts`
- Create: `apps/meeting-recorder/src/__tests__/useTranscriptStore.test.ts`
- Create: `apps/meeting-recorder/src/__tests__/useHistoryStore.test.ts`
- Create: `apps/meeting-recorder/src/__tests__/useSpeakerStore.test.ts`

**Key Decisions / Notes:**
- useSettingsStore: Test loadFromIPC parsing (NaN handling for parseInt, boolean string parsing), saveToIPC error handling.
- useTranscriptStore: Test addSegments, clearSession, getSegments.
- useHistoryStore: Test shiftDate for all CalendarViewType values, navigatePrev/Next/Today.
- useSpeakerStore: Test setSpeakers, renameSpeaker, getSpeakersForSession.

**Definition of Done:**
- [ ] All 4 stores have dedicated test files
- [ ] Tests cover main business logic and edge cases
- [ ] All tests pass

**Verify:**
- `npx vitest run src/__tests__/useSettingsStore.test.ts src/__tests__/useTranscriptStore.test.ts src/__tests__/useHistoryStore.test.ts src/__tests__/useSpeakerStore.test.ts`

---

### Task 26: [FIX] Suggestions batch (sandbox, LanguageModel type, macOS lsof, virtualized scrolling)

**Objective:** Implement quality suggestions: enable Electron sandbox, properly type LanguageModel, optimize macOS lsof, add virtualized scrolling to TranscriptPanel.

**Dependencies:** None

**Files:**
- Modify: `apps/meeting-recorder/electron/main/services/window-manager.ts` (sandbox: true)
- Modify: `apps/meeting-recorder/electron/main/services/ai-provider.ts` (LanguageModel type)
- Modify: `apps/meeting-recorder/electron/main/services/summarization-service.ts` (LanguageModel type)
- Modify: `apps/meeting-recorder/electron/main/services/translation-service.ts` (LanguageModel type)
- Modify: `apps/meeting-recorder/electron/main/services/end-of-meeting-processor.ts` (LanguageModel type)
- Modify: `apps/meeting-recorder/electron/main/services/mic-detector.ts` (optimized macOS lsof)
- Modify: `apps/meeting-recorder/src/components/TranscriptPanel.tsx` (virtualized scrolling)

**Key Decisions / Notes:**
- Sandbox: Set `sandbox: true` in both BrowserWindow webPreferences.
- LanguageModel: Import `LanguageModelV1` from 'ai' package, replace `type LanguageModel = any`.
- macOS: Use `lsof -c coreaudiod` instead of full `lsof | grep coreaudio`.
- TranscriptPanel: Use `useVirtualizer` from @tanstack/react-virtual (already installed).

**Definition of Done:**
- [ ] Both windows have sandbox: true
- [ ] LanguageModel properly typed from AI SDK in all 4 services
- [ ] macOS mic detection uses targeted lsof command
- [ ] TranscriptPanel uses virtual scrolling for long transcripts
- [ ] All existing tests still pass

**Verify:**
- `npx vitest run --pool=forks`

---

## Testing Strategy

- **Unit tests:** All services, React components, Zustand stores — mocked AI SDK, mocked child_process, in-memory SQLite
- **Integration tests:** Audio capture → pipeline → database flow, session lifecycle transitions
- **E2E tests:** App launches, recording starts/stops, transcript appears, session switching, settings save — via Electron MCP tools
- **Framework:** Vitest + Testing Library + jsdom
- **Coverage target:** 80%+ for services, 70%+ for components

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Audio format incompatibility with Gemini | High | High | Capture as ogg/opus (Gemini-accepted). Validate format before sending. Convert via AudioContext/ffmpeg if needed. |
| Only Gemini supports audio via AI SDK | High | Medium | Two-tier model: Gemini for audio-capable tier, Whisper API for OpenAI, text-only for others. Settings UI clearly indicates capabilities. |
| IPC binary serialization overhead for audio | Medium | Medium | Fire-and-forget IPC, backpressure queue, write chunks to temp files and pass paths if perf is an issue. |
| LLM structured output unreliability | Medium | Medium | Use `generateObject()` with Zod schema. Graceful fallback to raw text on parse failure. Sanitize user input in prompts. |
| Chunk boundaries break speaker attribution | Medium | Medium | 15-second chunks with 2s overlap. Include previous context in prompt. Consider longer chunks (30s) if attribution is poor. |
| API key security | Medium | Medium | Use Electron `safeStorage.encryptString()`/`decryptString()` for encryption. Keys never stored as plaintext. |
| Linux mic detection fails on PipeWire | Medium | Low | Fallback chain: pactl → pw-cli → /proc/asound. Graceful fallback to manual recording if all fail. |
| Windows mic detection misses UWP apps | Medium | Low | Check both NonPackaged and packaged registry paths under HKCU. |
| Multi-session memory usage | Low | Medium | Only active session loads full transcript in memory. Historical sessions load on demand. Limit stored chunk audio to 50 most recent. |
| Crash during recording loses data | Low | High | Recording state tracked in DB (not just Zustand). Crash recovery on startup detects interrupted sessions. ogg/opus format is partially playable even if truncated. |
| better-sqlite3 native build failures | Low | Medium | electron-rebuild in postinstall, asarUnpack in builder config. Document build prerequisites per platform. |

## Open Questions

- Should end-of-meeting processing run automatically or require user confirmation? (Currently: automatic)
- Should the mini control bar be repositionable or fixed at top-center? (Currently: top-center, configurable later)
- Maximum number of concurrent sessions to display in the control bar dropdown?

### Deferred Ideas

- Calendar integration (Google Calendar, Outlook) for automatic meeting info and attendee names
- File content extraction (parse DOCX/PPTX/PDF content for deeper LLM context)
- Voice fingerprinting for cross-meeting speaker recognition
- Export to PDF/Markdown/email
- Keyboard shortcuts for common actions
- Whisper.cpp local transcription
- Cloud backup / sync
- Collaboration / shared meeting notes
- Video/screen recording
- Voice Activity Detection (VAD) for smarter chunk boundaries
