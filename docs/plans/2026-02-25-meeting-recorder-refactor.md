# Meeting Recorder Complete Refactor Implementation Plan

Created: 2026-02-25
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No

> **Status Lifecycle:** PENDING → COMPLETE → VERIFIED
> **Iterations:** Tracks implement→verify cycles (incremented by verify phase)
>
> - PENDING: Initial state, awaiting implementation
> - COMPLETE: All tasks implemented
> - VERIFIED: All checks passed
>
> **Approval Gate:** Implementation CANNOT proceed until `Approved: Yes`
> **Worktree:** No — working directly on current branch

## Summary

**Goal:** Make the meeting-recorder app a fully functional, polished, zero-error standalone product. Currently the app was assembled by multiple isolated agents — no piece works with any other piece. Dependencies were never installed, ESLint has no config, 2 test files crash, there's no navigation between pages, no audio capture wiring, no transcription pipeline integration, hardcoded theme colors, and every integration point is disconnected. This plan treats EVERY existing file as broken/incomplete until proven otherwise by running it.

**Architecture:** Electron 39 + electron-vite. Main process: sql.js database, session management, mic detection, transcription pipeline, AI providers, summarization, translation. Renderer: React 18 + TypeScript with Dashboard, History, Settings pages. Zustand stores. Preload bridge for all IPC channels.

**Tech Stack:** Electron 39, electron-vite, React 18, TypeScript, Zustand, Radix UI, Tailwind CSS, sql.js, AI SDK (multi-provider), Vitest

## Verified Current State (2026-02-25)

**After `npm install`:**

| Check | Result | Details |
|-------|--------|---------|
| `npm install` | Was never run | No `node_modules` existed at all |
| `typecheck:node` | PASS | 0 errors (after install) |
| `typecheck:web` | PASS | 0 errors (after install) |
| `npm run lint` | BROKEN | ESLint 9 installed but NO `eslint.config.js` — "Oops! Something went wrong!" |
| `vitest run` | 2 ERRORS | 51 files pass (426 tests), but `TranscriptPanel.test.tsx` and `TalkingPointsPanel.test.tsx` crash with worker timeouts |
| `electron-vite build` | PASS | main (65KB), preload (6KB), renderer (153KB+228KB) all build |
| App runs | UNKNOWN | Cannot verify without display — but based on code analysis, nothing is wired |

**Critical broken integrations found by reading code:**

1. **No ESLint config file** — ESLint 9 needs `eslint.config.js`, none exists
2. **2 test files crash** — `TranscriptPanel.test.tsx` and `TalkingPointsPanel.test.tsx` timeout (worker fork failures)
3. **No page navigation** — `App.tsx` has `<Routes>` but no links/buttons to navigate between Dashboard/History/Settings
4. **Settings unreachable** — Dashboard shows "Configure an AI provider" but user literally cannot get to Settings page
5. **Dashboard never loads sessions** — No `useEffect` to call `session:list` on mount. Session list stays empty forever.
6. **Audio capture not connected** — `useAudioCapture` hook exists but Dashboard never calls it. Recording button calls `session:create` but doesn't start mic capture.
7. **Audio chunks not fed to transcription** — `audio-handlers.ts:17-24` saves chunks via `audioStorage.saveChunk()` but NEVER passes them to `TranscriptionPipeline`
8. **Mic detector not connected to session manager** — `audio-handlers.ts:27-29` broadcasts mic status to windows but never calls `sessionManager.onMicStatusChange()`
9. **Elapsed time hardcoded** — `Dashboard.tsx:172` passes `elapsedTime={0}` to `RecordingControls`
10. **Hardcoded dark theme colors** — `Settings.tsx:103` uses `bg-gray-900 text-gray-100`, `History.tsx` similar
11. **Dark mode class never applied** — `index.html` has no `.dark` class on `<html>`, no code applies it
12. **Summarization UI not wired** — `SummaryPanel.tsx` exists but nothing triggers summarization or subscribes to streaming chunks
13. **No error/loading states** — Transcription errors broadcast via IPC but never displayed to user
14. **Auto-record toggle is a no-op** — `Dashboard.tsx:186`: `onToggleAutoRecord={() => {}}`

## Scope

### In Scope

- Fix ESLint configuration (create `eslint.config.js` for ESLint 9)
- Fix all crashing test files (`TranscriptPanel.test.tsx`, `TalkingPointsPanel.test.tsx`)
- Add page navigation (sidebar with Dashboard/History/Settings tabs)
- Wire session loading from database on Dashboard mount
- Wire audio capture to recording sessions (MediaRecorder → IPC → main process)
- Wire audio chunks from main process to transcription pipeline
- Wire mic detector to session manager for auto-record
- Add elapsed recording time (real timer, not hardcoded 0)
- Unify theme system — replace ALL hardcoded colors with CSS variables, apply `.dark` class
- Wire summarization streaming UI
- Add error states and loading states throughout
- Full lint/typecheck/test/build verification — zero errors, zero warnings
- E2E verification with Electron MCP / playwright-cli

### Out of Scope

- New features beyond what's scaffolded
- HiDock USB device integration (standalone recorder)
- Calendar integration
- Deployment/packaging/signing
- Performance optimization

## Prerequisites

- Node.js 18+ installed
- `npm install` in `apps/meeting-recorder/` (dependencies now installed)

## Context for Implementer

> Every file must be assumed broken until verified. Tests pass because everything is mocked — test-passing says nothing about runtime behavior.

- **Patterns to follow:** IPC handler pattern in `electron/main/ipc/session-handlers.ts` — register via `ipcMain.handle`, export getter functions. Renderer accesses via `window.electronAPI.*` (typed in `src/env.d.ts`).
- **Conventions:** Zustand stores in `src/store/`, components in `src/components/`, pages in `src/pages/`. Tailwind CSS with shadcn/ui CSS variable system (`bg-background`, `text-foreground`, `border-border`). Dark mode via `.dark` class on root element.
- **Key files:**
  - `electron/main/index.ts` — App bootstrap (database → IPC → window → tray)
  - `electron/preload/index.ts` — Full IPC bridge (all channels exposed)
  - `src/App.tsx` — React router (Dashboard, History, Settings) — **has NO navigation UI**
  - `src/pages/Dashboard.tsx` — Main recording view — **sessions never loaded, audio not wired, elapsed=0**
  - `src/pages/Settings.tsx` — Settings form — **exists but unreachable, hardcoded colors**
  - `src/pages/History.tsx` — History view — **hardcoded colors**
  - `src/store/useSessionStore.ts` — Session state (Map-based, transient)
  - `src/store/useSettingsStore.ts` — Settings with IPC sync
  - `src/store/useTranscriptStore.ts` — Transcript segments, topics, action items
  - `electron/main/services/database.ts` — sql.js initialization with schema
  - `electron/main/services/session-manager.ts` — Session lifecycle + `onMicStatusChange`
  - `electron/main/services/transcription-pipeline.ts` — AI transcription with retry
  - `electron/main/ipc/audio-handlers.ts` — Audio chunk saving — **NOT connected to transcription**
  - `electron/main/ipc/session-handlers.ts` — Session CRUD — **NOT starting transcription**
  - `electron/main/services/ai-provider.ts` — Multi-provider AI service (248 lines)
- **Gotchas:**
  - `useSessionStore` uses `Map<string, SessionMeta>` — can't be persisted (only `viewingSessionId` is persisted)
  - `sandbox: true` in BrowserWindow config — renderer has no Node.js access
  - CSP in `src/index.html` restricts script sources
  - `RecordingControls` takes `elapsedTime` as prop (hardcoded to `0`)
  - History and Settings hardcode `bg-gray-900 text-gray-100` — must use CSS variable system
  - ESLint 9 requires `eslint.config.js` format — the old `.eslintrc` format doesn't work
  - `@electron-toolkit/eslint-config-ts` and `@electron-toolkit/eslint-config-prettier` are in devDeps but need ESLint 9 flat config to be referenced

## Runtime Environment

- **Start command:** `cd apps/meeting-recorder && npm run dev`
- **Port:** electron-vite dev server (auto-assigned, typically 5173)
- **Health check:** Window appears with Dashboard UI
- **Restart procedure:** Ctrl+C → `npm run dev`

## Quality Standard

**Zero tolerance for errors of ANY kind.** Every task must leave the codebase in a state where:
- `npm run lint` produces zero errors AND zero warnings
- `npm run typecheck` produces zero errors
- `npm run test:run` passes ALL tests with zero failures and zero crashes
- `npm run build` succeeds cleanly

No workarounds. No "pre-existing" excuses. No cutting corners. No `eslint-disable` without justification. No `@ts-ignore`. No `any` types where avoidable. If a file is touched, ALL issues in that file are fixed. If a test crashes, it is fixed. If linting flags something, it is resolved properly.

**100% test coverage for acceptance criteria.** Every task's acceptance criteria must have corresponding tests that:
1. Are written FIRST (TDD red phase)
2. Fail before implementation (verified)
3. Pass after implementation (verified)
4. Cover the actual runtime behavior, not just mock responses

## Progress Tracking

**MANDATORY: Update this checklist as tasks complete. Change `[ ]` to `[x]`.**

- [x] Task 1: Fix ESLint configuration and crashing tests
- [x] Task 2: Add page navigation with sidebar tabs
- [x] Task 3: Unify theme system across all pages
- [x] Task 4: Wire session loading and lifecycle in Dashboard
- [x] Task 5: Wire audio capture to recording sessions and transcription pipeline
- [x] Task 6: Add elapsed recording time tracker
- [x] Task 7: Wire auto-record via mic detection
- [x] Task 8: Integrate summarization streaming UI
- [x] Task 9: Add error states and loading states
- [x] Task 10: E2E launch verification and final polish

**Total Tasks:** 10 | **Completed:** 10 | **Remaining:** 0

## Implementation Tasks

### Task 1: Fix ESLint configuration and crashing tests

**Objective:** Make ALL tooling work: lint, typecheck, tests, build — all with zero errors. Currently ESLint has no config file (ESLint 9 requires `eslint.config.js`), and 2 test files crash with worker fork timeouts.

**Dependencies:** None

**Files:**
- Create: `eslint.config.js` — ESLint 9 flat config using `@electron-toolkit/eslint-config-ts` and `@electron-toolkit/eslint-config-prettier`
- Modify: `src/__tests__/TranscriptPanel.test.tsx` — fix worker timeout (likely infinite loop, excessive DOM, or missing mock)
- Modify: `src/__tests__/TalkingPointsPanel.test.tsx` — fix worker timeout (same likely cause)
- Test: ALL existing test files must pass after changes

**Key Decisions / Notes:**
- ESLint 9 flat config uses `export default [...]` syntax. The `@electron-toolkit` packages provide flat config presets — check their docs. If they don't support flat config, create config from scratch using `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`.
- The 2 crashing test files timeout at worker fork level — this means the test file itself hangs during import or setup. Read the test files and their imports carefully. Likely causes: importing a component that triggers an infinite render, missing mock for an API that hangs, or `@tanstack/react-virtual` needing specific DOM dimensions.
- After fix: `npx eslint .` must produce zero errors and zero warnings across the ENTIRE codebase, not just new files.

**Definition of Done:**
- [ ] `eslint.config.js` exists and is valid ESLint 9 flat config
- [ ] `npm run lint` passes with zero errors AND zero warnings
- [ ] `npm run test:run` passes ALL test files (zero failures, zero worker crashes, zero unhandled errors)
- [ ] `npm run typecheck` still passes (zero errors)
- [ ] `npm run build` still succeeds

**Verify:**
- `cd apps/meeting-recorder && npm run lint` — zero output
- `cd apps/meeting-recorder && npm run test:run` — all files pass, 0 errors
- `cd apps/meeting-recorder && npm run typecheck` — clean
- `cd apps/meeting-recorder && npm run build` — succeeds

### Task 2: Add page navigation with sidebar tabs

**Objective:** Users must be able to navigate between Dashboard, History, and Settings pages. Currently there is NO way to reach Settings (or History) from the Dashboard — the app has routes but zero navigation UI. The user's #1 complaint was: "there is a big message of 'configure your llm in settings' and THERE IS NO SETTING ANYWHERE."

**Dependencies:** Task 1 (all tooling must work first)

**Files:**
- Create: `src/components/layout/NavSidebar.tsx` — navigation sidebar with Dashboard/History/Settings icons+labels
- Create: `src/__tests__/NavSidebar.test.tsx` — tests for nav component (rendering, active state, navigation)
- Modify: `src/App.tsx` — wrap routes in a layout with NavSidebar
- Modify: `src/pages/Dashboard.tsx` — adjust layout to work inside global nav layout
- Modify: `src/pages/History.tsx` — remove standalone header, use shared layout
- Modify: `src/pages/Settings.tsx` — remove standalone back-button/header, use shared layout

**Key Decisions / Notes:**
- Use `react-router-dom` `NavLink` for active state highlighting
- Navigation sidebar: vertical with icons + labels — Dashboard (Home icon), History (Clock icon), Settings (Gear icon)
- Use `lucide-react` icons (already in dependencies): `Home`, `Clock`, `Settings` from lucide-react
- Dashboard's internal sidebar (session list) stays inside the main content area — the NavSidebar is the app-level nav
- The existing `SidebarTabs.tsx` may exist — check if it can be repurposed, but don't assume it works
- Settings page currently has a "Back" button with `navigate("/")` — replace with consistent NavSidebar nav

**Definition of Done:**
- [ ] NavSidebar renders with 3 items: Dashboard, History, Settings
- [ ] Clicking each nav item navigates to the correct page (verified by test)
- [ ] Active page is visually highlighted in nav (verified by test)
- [ ] Settings page is reachable from Dashboard (the core user complaint is resolved)
- [ ] All pages render without layout issues inside the new nav layout
- [ ] `npm run lint` still passes (zero errors)
- [ ] `npm run typecheck` still passes
- [ ] `npm run test:run` — all tests pass including new NavSidebar tests

**Verify:**
- `cd apps/meeting-recorder && npm run test:run` — all pass
- `cd apps/meeting-recorder && npm run typecheck` — clean
- `cd apps/meeting-recorder && npm run lint` — zero errors

### Task 3: Unify theme system across all pages

**Objective:** Replace ALL hardcoded color classes with CSS variable classes. Apply `.dark` class by default. Currently History and Settings use `bg-gray-900 text-gray-100 border-gray-700` while Dashboard uses the correct CSS variable system. The app must have consistent dark theming everywhere.

**Dependencies:** Task 2 (navigation must be in place so all pages are reachable)

**Files:**
- Modify: `src/pages/History.tsx` — replace all hardcoded gray/blue classes
- Modify: `src/pages/Settings.tsx` — replace all hardcoded gray/blue classes
- Modify: `src/components/history/CalendarHeader.tsx` — replace hardcoded colors (if any)
- Modify: `src/components/history/CalendarView.tsx` — replace hardcoded colors (if any)
- Modify: `src/components/history/TimelineView.tsx` — replace hardcoded colors (if any)
- Modify: `src/components/history/SessionSearch.tsx` — replace hardcoded colors (if any)
- Modify: `src/components/settings/ProviderSettings.tsx` — replace hardcoded colors (if any)
- Modify: `src/components/settings/RecordingSettings.tsx` — replace hardcoded colors (if any)
- Modify: `src/components/settings/GeneralSettings.tsx` — replace hardcoded colors (if any)
- Modify: `src/components/SummaryPanel.tsx` — replace hardcoded `text-yellow-400`, `text-gray-200`, `text-gray-500`, `bg-blue-600`
- Modify: `src/components/SidebarTabs.tsx` — replace hardcoded `border-gray-700`, `text-blue-400`, `text-gray-400`, `border-blue-500`
- Modify: `src/index.html` — add `class="dark"` to `<html>` element
- Modify: `src/App.tsx` — add `useEffect` to dynamically apply/remove `.dark` class on `document.documentElement` based on `useSettingsStore.theme`
- Create: `src/__tests__/ThemeIntegration.test.tsx` — verify no hardcoded colors remain, dark class applied, theme toggle works

**Key Decisions / Notes:**
- CSS variable system is in `src/globals.css` with `:root` (light) and `.dark` (dark) variants
- Mapping: `bg-gray-900` → `bg-background`, `text-gray-100` → `text-foreground`, `border-gray-700` → `border-border`, `text-gray-400` → `text-muted-foreground`, `bg-gray-800` → `bg-card`, `text-blue-400` → `text-primary`, `text-gray-200` → `text-card-foreground`, `hover:text-blue-300` → `hover:text-primary/80`
- Default to dark theme. `index.html` gets `class="dark"` on `<html>`.
- Add `useEffect` in `App.tsx` that reads `useSettingsStore.theme` and dynamically applies/removes `.dark` class: when "dark" apply `.dark`, when "light" remove it, when "system" check `window.matchMedia('(prefers-color-scheme: dark)')`.
- Theme must work dynamically: changing Settings.theme from "dark" to "light" removes `.dark` immediately.
- EVERY file in ALL of `src/` with hardcoded `gray-*`, `blue-*`, `yellow-*` classes must be found and fixed. Use grep across ALL of `src/`. No exceptions.

**Definition of Done:**
- [ ] Zero hardcoded `gray-*`, `blue-*`, `yellow-*` color classes in any `.tsx` file under `src/` (pages AND components)
- [ ] All pages and components use CSS variable classes from globals.css
- [ ] `.dark` class applied to `<html>` element by default
- [ ] When Settings.theme is changed to "light", `.dark` class is removed and app renders with `:root` light variables — without app restart (test: verify class toggle)
- [ ] When Settings.theme is changed to "dark", `.dark` class is applied and dark variables activate (test: verify class toggle)
- [ ] Visual consistency across Dashboard, History, Settings (all use same color system)
- [ ] `npm run lint` passes, `npm run typecheck` passes, `npm run test:run` — all pass

**Verify:**
- `grep -rE "bg-gray-|text-gray-|border-gray-|bg-blue-|text-blue-|border-blue-|text-yellow-" apps/meeting-recorder/src/ --include="*.tsx" --include="*.ts"` — returns ZERO results (excluding test files and globals.css)
- `cd apps/meeting-recorder && npm run test:run` — all pass
- `cd apps/meeting-recorder && npm run typecheck` — clean

### Task 4: Wire session loading and lifecycle in Dashboard

**Objective:** Dashboard must load existing sessions from the database on mount, react to session create/status events from IPC, and auto-select the active session. Currently the session list is permanently empty because nothing calls `session:list`.

**Dependencies:** Task 1 (tooling works), Task 2 (nav in place)

**Files:**
- Modify: `src/pages/Dashboard.tsx` — add `useEffect` to load sessions on mount, subscribe to IPC events
- Modify: `src/store/useSessionStore.ts` — add `loadSessions()` action, add event subscription actions
- Create: `src/__tests__/useSessionStore.integration.test.ts` — test session loading, event handling, auto-selection
- Modify: `src/__tests__/Dashboard.test.tsx` — extend with session loading tests

**Key Decisions / Notes:**
- On mount: call `window.electronAPI.session.list()` → populate `useSessionStore.sessions` Map
- Subscribe to `window.electronAPI.session.onCreated(callback)` → add session to Map, set as active
- Subscribe to `window.electronAPI.session.onStatusChanged(callback)` → update session status in Map
- Auto-select: If no session is being viewed, select the most recent active session
- Clean up IPC subscriptions on unmount (return cleanup functions from listeners)
- The `preload/index.ts` already exposes `session.onCreated`, `session.onStatusChanged` as event listeners
- **CRITICAL:** `onCreated` handler must call BOTH `addSession(session)` AND `setActiveSession(session.id)`. Without `setActiveSession`, `activeSessionId` stays null, and the entire recording flow (audio capture, elapsed timer, transcription) is broken.
- **CRITICAL:** Dashboard.tsx line 177 calls `session.create()` without using the returned `{ id }`. The `onStartRecording` handler must `await` the create call and use the returned session ID to set active state.
- **Auto-select logic:** If an active session exists, select it for viewing. If no active session, select the most recently started session (sorted by `started_at` descending). If no sessions exist, `viewingSessionId` remains null.
- **History URL param:** `History.tsx` navigates to `/?session=${sessionId}` when clicking a session. Dashboard must read `useSearchParams()` for a `session` param and call `switchView(sessionId)`.

**Definition of Done:**
- [ ] Existing sessions appear in Dashboard sidebar on app launch (test: mock `session.list()` to return sessions, verify they render)
- [ ] New session events add sessions to the list in real-time (test: simulate `session.onCreated` callback)
- [ ] Clicking Record sets `activeSessionId` in session store to the new session ID (test: verify `getState().activeSessionId` is non-null after Record click)
- [ ] Session status changes reflect immediately (test: simulate `session.onStatusChanged` callback)
- [ ] Active session is auto-selected for viewing (active first, then most recent)
- [ ] History session click navigates to Dashboard with that session selected (test: navigate with ?session=id, verify switchView called)
- [ ] Cleanup functions remove IPC listeners on unmount
- [ ] `npm run lint` passes, `npm run typecheck` passes, `npm run test:run` — all pass

**Verify:**
- `cd apps/meeting-recorder && npm run test:run` — all pass including new integration tests
- `cd apps/meeting-recorder && npm run typecheck` — clean

### Task 5: Wire audio capture to recording sessions and transcription pipeline

**Objective:** This is the critical missing integration. Three disconnected pieces need to be wired together: (1) Dashboard's record button → audio capture via `useAudioCapture`, (2) audio chunks from renderer → main process, (3) main process → transcription pipeline. Currently: clicking Record calls `session:create` but doesn't start audio capture, audio-handlers saves chunks but doesn't feed them to transcription, and session-handlers doesn't start the transcription pipeline.

**Dependencies:** Task 4 (session lifecycle wired)

**Files:**
- Modify: `electron/preload/index.ts` — expose `transcription.start(sessionId)`, `transcription.stop(sessionId)`, `transcription.processChunk(sessionId, text, index)` in preload bridge
- Modify: `src/env.d.ts` — add `start`, `stop`, `processChunk` to `ElectronAPI.transcription` type
- Modify: `src/pages/Dashboard.tsx` — integrate `useAudioCapture` hook with recording flow via conditional child component
- Modify: `src/hooks/useAudioCapture.ts` — accept `sessionId | null`, only start recording when non-null. Wire `acknowledgeChunk` to prevent backpressure pause.
- Modify: `electron/main/ipc/audio-handlers.ts` — after saving chunk, feed to transcription pipeline AND send `audio:chunkAck` back to renderer
- Modify: `electron/main/ipc/session-handlers.ts` — start `TranscriptionPipeline` when session is created, stop on end
- Modify: `electron/main/services/ai-provider.ts` — verify `configure()` is called with settings before transcription
- Create: `src/__tests__/AudioCaptureIntegration.test.ts` — test full flow: record → chunks → IPC
- Modify: `electron/main/__tests__/audio-handlers.test.ts` — test chunk → transcription pipeline wiring and chunkAck
- Modify: `electron/main/ipc/__tests__/session-handlers.test.ts` — test pipeline start/stop on session create/end

**Key Decisions / Notes:**
- **CRITICAL: Preload bridge missing transcription channels.** `transcription:start`, `transcription:stop`, `transcription:processChunk` are registered as `ipcMain.handle` in `transcription-handlers.ts` but NOT exposed in `preload/index.ts` and NOT typed in `env.d.ts`. Must add them before any wiring works.
- **Dashboard flow:** Record button click → `await session:create` IPC → receive `{ id }` → set `activeSessionId` → render `<ActiveSessionRecorder sessionId={id} />` child → `useAudioCapture(id)` starts MediaRecorder → `audio:chunk` events sent to main process
- **useAudioCapture lifecycle:** The hook takes a required `sessionId` but React hooks can't be called conditionally. Solution: render a child component `<ActiveSessionRecorder>` only when `activeSessionId` is non-null. This component calls `useAudioCapture(sessionId)` — avoiding the empty-string sessionId problem. No audio chunks are ever sent with an empty/undefined sessionId.
- **AudioRecorder.acknowledgeChunk() MUST be called.** `AudioRecorder` implements backpressure: when `pendingChunks >= 15`, it pauses MediaRecorder. It only resumes when `acknowledgeChunk()` is called and `pendingChunks <= 10`. With 15-second chunks, recording pauses after ~3.75 minutes if acks are never sent. Fix: main process sends `audio:chunkAck` after saving each chunk. Preload exposes `audio.onChunkAck(callback)`. `useAudioCapture` subscribes and calls `recorder.acknowledgeChunk()`.
- **Main process flow:** `session-handlers.ts` on `session:create` → create session → call `reconfigureAIIfNeeded()` → instantiate `TranscriptionPipeline(sessionId, aiProvider)` → store reference
- **Audio-to-transcription flow:** `audio-handlers.ts` receives ArrayBuffer chunk → saves via `audioStorage.saveChunk()` → gets active pipeline from `session-handlers` → if AI provider is audio-capable (`transcribeAudio` method), calls `pipeline.processAudioChunk(buffer, mimeType, chunkIndex)`. The `TranscriptionPipeline.processAudioChunk()` already handles the AI call and broadcasts results.
- **Stop flow:** Stop button → `session:end` IPC → stop pipeline → stop audio capture → end session in DB
- Need to import `getAIService` from `ai-handlers.ts` in `session-handlers.ts` to get the configured provider

**Definition of Done:**
- [ ] `transcription.start`, `transcription.stop`, `transcription.processChunk` exposed in preload and typed in `env.d.ts`
- [ ] Clicking "Record" starts MediaRecorder audio capture (test: verify audio capture starts after session creation)
- [ ] Audio chunks are sent to main process with valid sessionId — never empty string (test: verify sessionId is UUID)
- [ ] Main process creates TranscriptionPipeline on session start (test: verify pipeline instantiation)
- [ ] When `session:create` resolves, `transcription:start` is invoked with the session ID before audio chunks are sent (test: verify pipeline exists in handler map)
- [ ] Audio chunks are fed to transcription pipeline in main process (test: mock pipeline, verify `processAudioChunk` called)
- [ ] Main process sends `audio:chunkAck` after saving each chunk (test: verify ack sent)
- [ ] `AudioRecorder.acknowledgeChunk()` is called on ack receipt — backpressure works correctly for recordings longer than 4 minutes (test: send 20 chunks, verify recorder not paused)
- [ ] Clicking "Stop" stops recording, pipeline, and ends session (test: verify cleanup sequence)
- [ ] AI provider is configured from settings before transcription starts (test: verify `configure()` called)
- [ ] `npm run lint` passes, `npm run typecheck` passes, `npm run test:run` — all pass

**Verify:**
- `cd apps/meeting-recorder && npm run test:run` — all pass
- `cd apps/meeting-recorder && npm run typecheck` — clean

### Task 6: Add elapsed recording time tracker

**Objective:** Show actual elapsed recording time instead of hardcoded `0`. Create a timer hook that starts when recording begins and stops when it ends.

**Dependencies:** Task 5 (audio capture wired, so recording state is real)

**Files:**
- Create: `src/hooks/useElapsedTime.ts` — interval-based timer hook
- Create: `src/__tests__/useElapsedTime.test.ts` — TDD tests for timer hook
- Modify: `src/pages/Dashboard.tsx` — use timer hook, pass real elapsed time to `RecordingControls`

**Key Decisions / Notes:**
- Hook signature: `useElapsedTime(isActive: boolean): number` — returns seconds
- Uses `setInterval` at 1-second resolution
- Starts when `isActive` becomes true (recording active), stops when false
- Resets to 0 when recording stops
- Must clean up interval on unmount (prevent memory leaks)
- Test with fake timers (`vi.useFakeTimers()`)

**Definition of Done:**
- [ ] Timer shows 0:00 when not recording (test: verify initial state)
- [ ] Timer increments every second during recording (test: advance fake timers, check value)
- [ ] Timer resets to 0:00 when recording stops (test: toggle isActive, verify reset)
- [ ] No memory leaks — interval cleaned up on unmount (test: unmount, verify clearInterval)
- [ ] `npm run lint` passes, `npm run typecheck` passes, `npm run test:run` — all pass

**Verify:**
- `cd apps/meeting-recorder && npm run test:run -- src/__tests__/useElapsedTime.test.ts` — passes
- `cd apps/meeting-recorder && npm run test:run` — all pass

### Task 7: Wire auto-record via mic detection

**Objective:** When a microphone becomes active (another app starts using it), auto-start a recording session. The `MicDetector` and `SessionManager.onMicStatusChange()` both exist but are NOT connected. Currently `audio-handlers.ts:27-29` broadcasts mic status to renderer windows but never calls the session manager.

**Dependencies:** Task 5 (audio capture and pipeline wired)

**Files:**
- Modify: `electron/main/ipc/audio-handlers.ts` — connect mic detector callback to session manager's `onMicStatusChange()`
- Modify: `electron/main/ipc/session-handlers.ts` — expose `getSessionManager()` for use by audio handlers
- Modify: `src/pages/Dashboard.tsx` — subscribe to `audio:micStatus` IPC events, update mic indicator, respect auto-record toggle
- Modify: `src/store/useSessionStore.ts` — add `micActive` state field
- Create: `electron/main/ipc/__tests__/audio-session-integration.test.ts` — test mic → session manager wiring
- Create: `src/__tests__/AutoRecordIntegration.test.ts` — test auto-record toggle UI

**Key Decisions / Notes:**
- **Current state:** `audio-handlers.ts` line 27-29 starts mic detector with a callback that only broadcasts `audio:micStatus` to windows. It does NOT call `sessionManager.onMicStatusChange()`.
- **Fix:** Import `getSessionManager` from `session-handlers.ts` in `audio-handlers.ts`. In the mic callback, BOTH broadcast to windows AND call `sessionManager.onMicStatusChange(status)`.
- **Auto-record toggle:** The `onToggleAutoRecord` handler in Dashboard is currently `() => {}` (no-op). Wire it to update `useSettingsStore.autoRecord` and save via IPC.
- **Conditional:** Only call `sessionManager.onMicStatusChange()` if `autoRecord` setting is enabled. Read the setting from database via `getSetting('recording.autoRecord')` — NOT from the renderer store (main process has no access to Zustand). Import `getSetting` from `database-extras.ts`.
- **Mic detector starts unconditionally** at app launch (inside `registerAudioHandlers`). This is fine — it just polls for mic status. The gating must happen at the callback level: broadcast status to windows always, but only call `sessionManager.onMicStatusChange()` when `autoRecord` is true.
- **Grace period:** `SessionManager.onMicStatusChange` already handles start/stop — mic goes active → start session, mic goes inactive → end session. No grace period logic needed here (it's in MicDetector itself).

**Definition of Done:**
- [ ] When mic becomes active, `sessionManager.onMicStatusChange()` is called (test: verify callback chain)
- [ ] When mic goes inactive, session auto-ends (test: simulate inactive status)
- [ ] When autoRecord is false in database settings, mic detection events do NOT create sessions (test: set `recording.autoRecord` to "false", simulate mic active, verify `sessionManager.onMicStatusChange` NOT called)
- [ ] Mic status indicator in Dashboard reflects real mic state (test: simulate micStatus event)
- [ ] Toggle auto-record actually saves the setting (test: toggle and verify `settings.set` called)
- [ ] `npm run lint` passes, `npm run typecheck` passes, `npm run test:run` — all pass

**Verify:**
- `cd apps/meeting-recorder && npm run test:run` — all pass
- `cd apps/meeting-recorder && npm run typecheck` — clean

### Task 8: Integrate summarization streaming UI

**Objective:** Wire the summarization feature end-to-end. Users must be able to request a summary of a completed session and see it stream in. The backend `SummarizationService` and preload channels exist but the renderer never uses them.

**Dependencies:** Task 4 (session lifecycle), Task 3 (theme)

**Files:**
- Modify: `src/components/SummaryPanel.tsx` — wire to IPC: trigger `summarization.generate()`, subscribe to `summarization.onChunk()`
- Modify: `src/pages/Dashboard.tsx` — show SummaryPanel for completed/inactive sessions
- Modify: `src/store/useTranscriptStore.ts` — add summary state (text per session, loading flag)
- Create: `src/__tests__/SummarizationIntegration.test.ts` — test full summarization flow
- Modify: `src/__tests__/SummaryPanel.test.tsx` — extend with IPC wiring tests

**Key Decisions / Notes:**
- Summarization is triggered via `window.electronAPI.summarization.generate(sessionId)`
- Streaming chunks arrive via `window.electronAPI.summarization.onChunk(callback)`
- Completion via `window.electronAPI.summarization.onComplete(callback)`
- **Rendering location:** Add a "Summary" tab to the `RightPanel` component in `Dashboard.tsx` alongside the existing "Topics" and "Actions" tabs. The `SummaryPanel` component renders as the content of the Summary tab. The "Generate Summary" button is inside `SummaryPanel`.
- Show the "Generate Summary" button only for completed/inactive sessions (not active ones)
- While summarizing, show streaming text with a loading indicator
- After complete, persist summary text in store per session
- SummaryPanel already exists — read it to understand its current interface, then wire it

**Definition of Done:**
- [ ] Completed sessions show a "Summarize" button (test: render with completed session, verify button)
- [ ] Clicking summarize triggers `summarization.generate()` via IPC (test: mock IPC, verify call)
- [ ] Streaming chunks display progressively (test: simulate onChunk callbacks, verify text updates)
- [ ] Final summary persists in store per session (test: verify store state after onComplete)
- [ ] Summary display uses CSS variable theme system (visual check via test snapshot or class assertion)
- [ ] `npm run lint` passes, `npm run typecheck` passes, `npm run test:run` — all pass

**Verify:**
- `cd apps/meeting-recorder && npm run test:run` — all pass
- `cd apps/meeting-recorder && npm run typecheck` — clean

### Task 9: Add error states and loading states

**Objective:** Every user-facing operation must have proper error display and loading feedback. Currently: transcription errors are broadcast but never shown, no loading spinners anywhere, "Configure AI" message shows but links nowhere, settings test-connection has no feedback mechanism visible.

**Dependencies:** Task 4, Task 5, Task 8

**Files:**
- Modify: `src/pages/Dashboard.tsx` — add loading state for sessions, error display for transcription, "configure AI" link to Settings
- Modify: `src/pages/History.tsx` — add loading state for search results
- Modify: `src/pages/Settings.tsx` — verify test-connection feedback works
- Modify: `src/components/TranscriptPanel.tsx` — show transcription errors from IPC events, link to Settings when unconfigured
- Modify: `src/store/useSessionStore.ts` — add `loading` and `error` fields
- Modify: `src/store/useTranscriptStore.ts` — add `transcriptionError` field per session
- Modify: `electron/preload/index.ts` — expose `session.onProcessingComplete` and `session.onProcessingError` events
- Modify: `src/env.d.ts` — add `onProcessingComplete`, `onProcessingError` to `ElectronAPI.session` type
- Create: `src/__tests__/ErrorStates.test.tsx` — test all error and loading states

**Key Decisions / Notes:**
- Transcription errors arrive via `transcription:error` IPC event — subscribe and display
- Transcription status arrives via `transcription:status` (processing/idle/error) — show inline indicator
- "Configure an AI provider in settings" message in TranscriptPanel should be a LINK to `/settings` (using react-router-dom `Link`)
- Loading: show spinner while `session:list` is fetching, while history search runs
- Settings test-connection result: already implemented in `Settings.tsx` with `testResult` state — verify it actually works by checking `ProviderSettings` component accepts and displays it
- **Error display:** Use the Radix UI Toast component (`@radix-ui/react-toast` already in `package.json`) for transcription errors. A toast appears at the bottom of the screen containing the error text when `transcription:error` IPC event fires. Auto-dismiss after 5 seconds.
- **Post-processing errors:** `EndOfMeetingProcessor` broadcasts `session:processingComplete` and `session:processingError` IPC events, but these are NOT exposed in preload or typed in `env.d.ts`. Add them to the preload bridge and subscribe to `session:processingError` in Dashboard to show a toast.

**Definition of Done:**
- [ ] Transcription errors display as Radix UI Toast at bottom of screen (test: simulate error event, verify Toast rendered with error text)
- [ ] Loading spinner shows while sessions load from IPC (test: verify loading state during fetch)
- [ ] "Configure AI provider" message is a link that navigates to Settings (test: verify Link renders with href="/settings")
- [ ] Settings test-connection shows success/failure result (test: mock `testConnection`, verify result display)
- [ ] No unhandled promise rejections in any normal flow (test: verify all async operations have error handling)
- [ ] `npm run lint` passes, `npm run typecheck` passes, `npm run test:run` — all pass

**Verify:**
- `cd apps/meeting-recorder && npm run test:run` — all pass
- `cd apps/meeting-recorder && npm run typecheck` — clean

### Task 10: E2E launch verification and final polish

**Objective:** Final comprehensive verification. The app must launch, render all pages, and have zero errors in console. Every previous task's work is validated end-to-end. Fix ANY remaining issues — no "pre-existing" exceptions.

**Dependencies:** All previous tasks

**Files:**
- Verify and fix: ALL files from previous tasks
- Modify: any file with issues found during E2E testing or final lint pass

**Key Decisions / Notes:**
- Run full lint: `npm run lint` — fix ALL warnings and errors
- Run full typecheck: `npm run typecheck` — zero errors
- Run full test suite: `npm run test:run` — all tests pass, zero crashes, zero unhandled errors
- Run production build: `npm run build` — succeeds
- Start app with `npm run dev` and verify with Electron MCP / playwright-cli:
  - Take screenshot of Dashboard — verify layout, recording controls, session list, nav sidebar
  - Navigate to Settings — verify provider form renders, all fields visible
  - Navigate to History — verify calendar/timeline view renders
  - Navigate back to Dashboard — verify state preserved
  - Check console: `playwright-cli console` — ZERO errors
- If Electron MCP is not available (headless environment), at minimum verify build succeeds and no console errors in test environment
- Fix everything found. No exceptions.

**Definition of Done:**
- [ ] `npm run lint` — zero errors AND zero warnings
- [ ] `npm run typecheck` — zero errors (both tsconfig.node.json and tsconfig.web.json)
- [ ] `npm run test:run` — ALL test files pass, zero failures, zero crashes, zero unhandled errors
- [ ] `npm run build` — main, preload, renderer all build cleanly
- [ ] App launches via `npm run dev` — window appears
- [ ] All three pages render correctly with consistent theme
- [ ] Navigation between pages works
- [ ] No console errors during normal operation
- [ ] No unhandled promise rejections in main process logs

**Verify:**
- `cd apps/meeting-recorder && npm run lint` — zero output
- `cd apps/meeting-recorder && npm run typecheck` — clean
- `cd apps/meeting-recorder && npm run test:run` — all pass
- `cd apps/meeting-recorder && npm run build` — succeeds
- Start app, use Electron MCP / playwright-cli to take screenshots and verify console is clean

## Testing Strategy

- **TDD mandatory:** Every task writes failing tests FIRST, then implements. Tests must verify actual behavior, not mock responses.
- **100% acceptance criteria coverage:** Every DoD bullet point has a corresponding test.
- **Unit tests:** Each new hook, component, and integration point gets unit tests.
- **Integration tests:** IPC wiring tested with mocked `ipcMain`/`BrowserWindow` following existing test patterns.
- **E2E:** App launched and verified with Electron MCP / playwright-cli — screenshots and console inspection.
- **Regression:** After EVERY task: `npm run test:run && npm run typecheck && npm run lint`. Any failure blocks task completion.
- **Zero tolerance:** No skipped tests, no worker crashes, no unhandled errors.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| sql.js WASM fails to load in Electron | Medium | High | `initSqlJs()` without `locateFile` uses bundled WASM via npm; verify by actually starting the app in Task 10 |
| ESLint 9 flat config incompatible with @electron-toolkit presets | Medium | Medium | Check package docs first; if incompatible, create config from scratch with `@typescript-eslint` directly |
| MediaRecorder not available in test environment | Low | Medium | Mock MediaRecorder in test setup (jsdom doesn't have it); integration tested by verifying IPC calls |
| TranscriptPanel/TalkingPointsPanel test crashes may be deep bugs | Medium | Medium | Read the test files line-by-line, identify what causes worker hang. May need to mock @tanstack/react-virtual or simplify component under test |
| Mic detection not testable in CI/headless | Medium | Low | Test the session-manager callback wiring in unit tests; mic detection itself is cross-platform polling that can be mocked |
| AI provider API calls fail without real API key | Expected | Low | All AI interactions go through main process IPC — mock the AI provider in tests; actual transcription requires a key and is tested manually |
| AudioRecorder backpressure permanently pauses recording after ~4 min | High | High | Wire `audio:chunkAck` IPC from main process back to renderer. `useAudioCapture` subscribes and calls `recorder.acknowledgeChunk()`. Without this, `pendingChunks` reaches 15 and recording silently stops. Task 5 addresses this explicitly. |
| Transcription IPC channels not in preload bridge | Certain | High | `transcription:start/stop/processChunk` registered in main but not exposed in preload. Task 5 adds them to preload and env.d.ts before any wiring. |
| session:create return value discarded in Dashboard | Certain | High | Dashboard's `onStartRecording` calls `session.create()` without using the returned `{ id }`. Task 4 fixes this by awaiting and setting `activeSessionId`. |

## Open Questions

- None — scope and approach are clear. Every broken piece has been identified and has a task.

### Deferred Ideas

- Light/dark theme toggle UI (currently dark-only; CSS variables support both, toggle wiring is in Task 3)
- Keyboard shortcuts for recording start/stop
- Notification when auto-recording starts
- Export transcripts to various formats
