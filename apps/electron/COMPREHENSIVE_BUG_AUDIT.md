# Comprehensive Bug Audit — HiDock Electron App

**Date:** 2026-02-25
**Scope:** Complete inventory of all bugs, architecture issues, and missing features found across all audit waves.
**App:** `apps/electron/` — Universal Knowledge Hub (Electron + React + TypeScript)

---

## Table of Contents

1. [Previously Fixed Issues (FIX-001 to FIX-015, ARCH-001 to ARCH-006)](#section-1-previously-fixed-issues)
2. [Phase 5: Type Hardening Findings](#section-2-phase-5-type-hardening)
3. [Wave 1 Audit: Comprehensive Code Audit (4 agents)](#section-3-wave-1-audit)
4. [Wave 2 Audit: Per-Page & Backend Audit (8 agents)](#section-4-wave-2-audit)
5. [Master Summary & Priority Matrix](#section-5-master-summary)

---

## Section 1: Previously Fixed Issues

These were fixed during Phases 1-5 with full test coverage (51 tests, all passing).

### TDD Bug Fixes (FIX-001 to FIX-015)

| ID | Issue | File(s) | Status |
|----|-------|---------|--------|
| FIX-001 | useUnifiedRecordings crashes without electronAPI guard | useUnifiedRecordings.ts | FIXED |
| FIX-002 | "Retry Failed Downloads" button does nothing (retryFailed missing) | useAppStore.ts | FIXED |
| FIX-003 | cancelAll() doesn't cancel in-progress downloads | useAppStore.ts | FIXED |
| FIX-004 | updateProgress never sets status to 'downloading' | useAppStore.ts | FIXED |
| FIX-005 | Transcription stuck "In Progress" forever after failure | useTranscriptionStore.ts | FIXED |
| FIX-006 | AudioContext suspended causes decodeAudioData to hang | useAudioPlayback.ts | FIXED |
| FIX-007 | Dual useUIStore instances cause state divergence | useUIStore.ts (multiple) | FIXED |
| FIX-008 | Auto-connect persistence — enableAutoConnect doesn't save config | hidock-device.ts | FIXED |
| FIX-009 | Download stall detection shows toast but never aborts | useDownloadOrchestrator.ts | FIXED |
| FIX-010 | IPC progress spam — every USB chunk triggers unthrottled state updates | download-service.ts | FIXED |
| FIX-011 | Playback rate selector does nothing | useAudioPlayback.ts | FIXED |
| FIX-012 | Empty localPath passes hasLocalPath() guard | useUnifiedRecordings.ts | FIXED |
| FIX-013 | Windows path case sensitivity in readRecordingFile/deleteRecording | recording-handlers.ts | FIXED |
| FIX-014 | Missing config interface fields for calendar UI preferences | config.ts | FIXED |
| FIX-015 | USB connect listener uses case-sensitive productName match | hidock-device.ts | FIXED |

### Architecture Fixes (ARCH-001 to ARCH-006)

| ID | Issue | Scope | Status |
|----|-------|-------|--------|
| ARCH-001 | 18 Zustand selectors missing useShallow (infinite render loop risk) | All stores | FIXED |
| ARCH-002 | Duplicated MIME type determination logic | Utility extraction | FIXED |
| ARCH-003 | Hardcoded DEBUG = true ships console spam to production | jensen.ts | FIXED |
| ARCH-004 | Performance test thresholds stabilized | Test suite | FIXED |
| ARCH-005 | OperationController God Component (897 lines → 79 lines) | Component decomposition | FIXED |
| ARCH-006 | Config store extracted from monolithic useAppStore | Store extraction | FIXED |

### Phase 1.5 Quick Wins

| Issue | Status |
|-------|--------|
| Dead useDownloadQueueStore removed | FIXED |
| 4 duplicate root-level store files creating dual Zustand instances | FIXED |
| Calendar.tsx type casting issues | FIXED |
| useDeviceSyncStore async dead code removed | FIXED |
| useAppStore `any` type fixed | FIXED |
| Dead state variables removed | FIXED |
| formatEta utility extracted | FIXED |
| BulkProgressModal type casting fixed | FIXED |
| Dead DownloadController.tsx removed (335 lines) | FIXED |

---

## Section 2: Phase 5 Type Hardening

### Findings (documented in LESSON-0011)

| Finding | Category | Status |
|---------|----------|--------|
| `useTranscriptionStore.loadQueue` called non-existent `getQueue()` method | Bug: non-existent API | FIXED |
| `useQualityStore` called non-existent `getQualityAssessments()` and `setQuality()` | Dead code | Documented as ACTION ITEM |
| Filter arrays in 5 pages lacked `as const` — required `as any` casts | Type safety | FIXED |
| `window.__audioControls` global augmentation pattern incorrect | Type declaration | FIXED |
| Frontend/backend rating type mismatch (5-level vs 3-level) | Design mismatch | Documented as ACTION ITEM |

---

## Section 3: Wave 1 Audit (4 Agents)

### Agent 1: All Page Handlers Audit

| ID | Page | Issue | Severity |
|----|------|-------|----------|
| W1-PH-01 | Library.tsx:990-993 | BulkResultSummary.onRetryFailed is console.log only | STUB |
| W1-PH-02 | Actionables.tsx:318 | "View Output" button has no onClick | STUB |
| W1-PH-03 | People.tsx:88 | "Add Person" permanently disabled, no implementation | STUB |
| W1-PH-04 | PersonDetail.tsx:123-126 | "Edit" button has no onClick | STUB |
| W1-PH-05 | Projects.tsx:187-189 | "Archive/Activate" has no onClick | STUB |
| W1-PH-06 | Projects.tsx:191 | Delete project has no onClick | STUB |
| W1-PH-07 | Projects.tsx:250 | "Generate Status Report" has no onClick | STUB |
| W1-PH-08 | Projects.tsx:251 | "Summarize Decisions" has no onClick | STUB |
| W1-PH-09 | Explore.tsx:113-115 | Quick action button "Summarize" has no onClick | STUB |
| W1-PH-10 | Explore.tsx:117-119 | Quick action button "Find Tasks" has no onClick | STUB |

### Agent 2: All Component Handlers Audit

| ID | Component | Issue | Severity |
|----|-----------|-------|----------|
| W1-CH-01 | Layout.tsx:329 | QA Logs switch uses non-reactive `getState()` for checked prop | SUSPECT |

117 other component handlers verified as WORKING.

### Agent 3: All Hooks and Stores Audit

| ID | Category | Issue | Severity |
|----|----------|-------|----------|
| W1-HS-01 | BROKEN | useMeetingsStore.refreshItem — checks `result.success` on raw-return API | BROKEN |
| W1-HS-02 | BROKEN | useKnowledgeStore.refreshItem — same pattern as above | BROKEN |
| W1-HS-03 | BROKEN | useQualityStore — all backend persistence is dead code | BROKEN |
| W1-HS-04 | DEAD | useMeetingsStore — entire store never consumed by any component | DEAD |
| W1-HS-05 | DEAD | useKnowledgeStore — entire store never consumed | DEAD |
| W1-HS-06 | DEAD | useCalendarStore — entire store never consumed | DEAD |
| W1-HS-07 | DEAD | useDeviceSyncStore — entire store never consumed | DEAD |
| W1-HS-08 | DEAD | useQualityStore — entire store never consumed | DEAD |
| W1-HS-09 | DEAD | useLayoutStore — entire store never consumed | DEAD |
| W1-HS-10 | DEAD | useCalendarUIStore — entire store never consumed | DEAD |
| W1-HS-11 | DEAD | FilterBar.tsx component — never rendered | DEAD |
| W1-HS-12 | DEAD | useFilterStore — never consumed | DEAD |
| W1-HS-13 | DEAD | useContactsStore — never consumed by People page | DEAD |
| W1-HS-14 | DEAD | useProjectsStore — never consumed by Projects page | DEAD |
| W1-HS-15 | SUSPECT | useTranscriptionSync — 5s polling instead of events | SUSPECT |
| W1-HS-16 | SUSPECT | useConfigStore.loadConfig — TypeError on startup | SUSPECT |
| W1-HS-17 | SUSPECT | useAppStore.loadMeetings — TypeError on startup | SUSPECT |

### Agent 4: IPC Coverage Audit

| ID | Issue | Severity |
|----|-------|----------|
| W1-IPC-01 | `recordings:selectMeeting` — preload calls, NO handler registered | CRITICAL |
| W1-IPC-02 | `recordings:addToQueue` — preload calls, NO handler registered | CRITICAL |
| W1-IPC-03 | `recordings:processQueue` — preload calls, NO handler registered | CRITICAL |
| W1-IPC-04 | `calendar:clear-and-sync` — preload calls, NO handler registered | CRITICAL |
| W1-IPC-05 | 8 orphaned IPC handlers (registered but never called from renderer) | LOW |
| W1-IPC-06 | ~15% estimated test coverage overall | LOW |
| W1-IPC-07 | Zero E2E testing | LOW |

---

## Section 4: Wave 2 Audit (8 Agents)

### 4A. Download/Sync Flow Audit (15 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| DL-01 | `Array.from(Uint8Array)` for IPC creates 16x memory amplification — freezes/crashes app | useDownloadOrchestrator.ts | 93 | **CRITICAL** |
| DL-02 | No sidebar progress shown between queue creation and first file starting | useDownloadOrchestrator.ts | 52 | MEDIUM |
| DL-03 | Filename truncation cuts date from HiDock filenames, losing key identification | OperationsPanel.tsx | 90 | MEDIUM |
| DL-04 | Individual downloads from Library have no overall progress indicator | OperationsPanel.tsx | 68 | LOW |
| DL-05 | Dual syncing state (`syncing` local + `storeSyncing` global) causes brief flicker | Device.tsx | 37, 883 | LOW |
| DL-06 | Auto-sync uses simple filename match, shows misleading "N files to download" | useDeviceSubscriptions.ts | 68-70 | MEDIUM |
| DL-07 | Completed items never cleaned from main process queue — payload grows over time | download-service.ts | 219-232 | LOW |
| DL-08 | `rec.filename` vs `rec.deviceFilename` inconsistency between sync paths | Device.tsx | 376 | LOW |
| DL-09 | 250ms IPC throttle creates visual mismatch between sidebar and Device page progress | download-service.ts | 406 | LOW |
| DL-10 | Sequential processing with no pipelining adds unnecessary delays between files | useDownloadOrchestrator.ts | 149-177 | LOW |
| DL-11 | useEffect re-subscribes ALL listeners on every connection status change (8+ times) | Device.tsx | 281 | HIGH |
| DL-12 | Stall detection marks failed but does NOT abort actual USB transfer | useDownloadOrchestrator.ts | 270-271 | MEDIUM |
| DL-13 | Progress counter includes failed downloads, making overall progress misleading | useDownloadOrchestrator.ts | 171 | MEDIUM |
| DL-14 | Cancel button in sidebar does NOT abort current USB transfer | OperationsPanel.tsx | 54 | HIGH |
| DL-15 | No retry UI for failed downloads outside the Device page | OperationsPanel.tsx | (absent) | MEDIUM |

### 4B. Transcription Queue Audit (9 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| TQ-01 | All filenames display as "Unknown" after restart/poll — DB has no filename column | database.ts, useTranscriptionStore.ts | 277-287, 186 | **CRITICAL** |
| TQ-02 | Manual queue does NOT persist to DB — items vanish on restart | useOperations.ts | 31-34 | **CRITICAL** |
| TQ-03 | Queue item ID mismatch between manual/auto paths causes cancel/remove failures | useOperations.ts, useTranscriptionSync.ts | 33, 69-73 | HIGH |
| TQ-04 | Retry button only updates Zustand, not DB — retry is completely non-functional | OperationsPanel.tsx, useTranscriptionStore.ts | 171, 138-153 | HIGH |
| TQ-05 | cancelAllTranscriptions only cancels pending items, not processing ones | database.ts, transcription.ts | 1866-1873, 65-70 | MEDIUM |
| TQ-06 | `updateRecordingStatus` updates wrong column for transcription flow | useOperations.ts, database.ts | 32, 1678-1680 | MEDIUM |
| TQ-07 | `loadQueue` is dead code — never called anywhere | useTranscriptionStore.ts | 176-205 | MEDIUM |
| TQ-08 | Progress hardcoded to 50% for processing items | useTranscriptionStore.ts, useTranscriptionSync.ts | 188, 27 | LOW |
| TQ-09 | Transcription events sent but never received — 5s delay on all status updates | transcription.ts, preload (missing) | 62-110 | MEDIUM |

### 4C. Sidebar Panel / State Management Audit (11 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| SM-01 | QA Logs switch reads state via `getState()` — non-reactive, UI desyncs | Layout.tsx | 329-330 | HIGH |
| SM-02 | Layout destructures entire `useAppStore()` — subscribes to every state change | Layout.tsx | 77-83 | HIGH |
| SM-03 | Library.tsx destructures `useAppStore()` pulling volatile state | Library.tsx | 61 | MEDIUM |
| SM-04 | Calendar.tsx destructures entire `useAppStore()` with 8+ fields | Calendar.tsx | 60-78 | MEDIUM |
| SM-05 | useDownloadOrchestrator / useDeviceSubscriptions full-store subscription | useDownloadOrchestrator.ts, useDeviceSubscriptions.ts | 37, 26 | LOW |
| SM-06 | OperationsPanel subscribes to volatile Map references | OperationsPanel.tsx | 14, 18 | LOW |
| SM-07 | `useUIStore` not persisted — preferences lost on app restart | useUIStore.ts | entire file | MEDIUM |
| SM-08 | `isDownloading`/`getDownloadProgress` methods rely on caller subscription breadth | useAppStore.ts | 248-253 | LOW |
| SM-09 | Settings.tsx full-store subscription | Settings.tsx | 13 | LOW |
| SM-10 | Library.tsx `getState()` in callback — NOT A BUG (correct pattern) | Library.tsx | 598 | NONE |
| SM-11 | OperationsPanel retry `getState()` in onClick — NOT A BUG | OperationsPanel.tsx | 171 | NONE |

### 4D. File Listing Audit (10 issues) — **FIXED: 7 of 10 (2026-02-27)**

| ID | Issue | File | Line(s) | Severity | Status |
|----|-------|------|---------|----------|--------|
| FL-01 | `forceRefresh=true` bypasses concurrency guard — duplicate USB operations | hidock-device.ts | 802 | HIGH | ✅ FIXED |
| FL-02 | Triple-fire on device connection (connection + ready + poll) | useUnifiedRecordings.ts | 499, 510, 577 | HIGH | ✅ FIXED |
| FL-03 | `loadingRef` guard has async race window between resumptions | useUnifiedRecordings.ts | 355-478 | MEDIUM | ✅ MITIGATED |
| FL-04 | Polling effect races with connection events | useUnifiedRecordings.ts | 540-592 | MEDIUM | ✅ MITIGATED |
| FL-05 | Multiple page instances each create independent subscriptions | useUnifiedRecordings.ts | 482-592 | LOW | ACCEPTED |
| FL-06 | No progress feedback during 60-second init wait | hidock-device.ts | 762-780 | MEDIUM | ✅ ALREADY FIXED |
| FL-07 | Cache invalidation on disconnect guarantees unnecessary re-fetch | hidock-device.ts | 1228 | LOW | ACCEPTED |
| FL-08 | `forceRefresh` overwrites promise reference — corrupts lock state | hidock-device.ts | 846-926 | HIGH | ✅ FIXED |
| FL-09 | `onStatusChange('ready')` and `onConnectionChange(true)` fire back-to-back | hidock-device.ts | 1200-1210 | MEDIUM | ✅ FIXED |
| FL-10 | React StrictMode double-mount creates brief duplicate subscriptions (dev only) | useUnifiedRecordings.ts | 482-592 | LOW | ACCEPTED |

**Fix Details:** See `FILE_LISTING_BUGS_FIXED.md` for comprehensive fix report.

### 4E. Actionables Page Audit (8 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| AC-01 | `source_knowledge_id` stores recording ID, not knowledge capture ID — "Approve & Generate" always fails | transcription.ts | 439 | **CRITICAL** |
| AC-02 | "View Output" button has no onClick handler | Actionables.tsx | 317-322 | HIGH |
| AC-03 | Filter bar missing `in_progress` status — failed-approval items disappear | Actionables.tsx | 220 | MEDIUM |
| AC-04 | AI-suggested template IDs can fail Zod validation | transcription.ts, outputs.ts | 172-176, 17-22 | MEDIUM |
| AC-05 | `getAll` handler destructures `undefined` — silent crash risk | actionables-handlers.ts | 8 | MEDIUM |
| AC-06 | Stale closure in `handleAutoGenerate` rate limiter | Actionables.tsx | 64-96 | LOW |
| AC-07 | Error banner never auto-dismisses, persists across actions | Actionables.tsx | 348-363 | LOW |
| AC-08 | Loading overlay text hardcoded to "Generating Meeting Minutes" | Actionables.tsx | 371 | LOW |

### 4F. Calendar Page Audit (10 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| CA-01 | Sync button calls non-existent `calendar:clear-and-sync` IPC handler | Calendar.tsx, calendar-handlers.ts | 345 | **CRITICAL** |
| CA-02 | Sync button never sets `calendarSyncing` state — no spinner/feedback | Calendar.tsx | 342-354 | HIGH |
| CA-03 | `lastSyncAt` never persisted to config — always null on restart | calendar-sync.ts | 392 | MEDIUM |
| CA-04 | Triple-duplicated calendarView state (local, store, config) | Calendar.tsx, useAppStore.ts | 88, 21 | MEDIUM |
| CA-05 | Current time indicator never updates — red line frozen at load time | Calendar.tsx | 1173-1182 | LOW |
| CA-06 | Recordings outside 7AM-9PM silently hidden in week view | Calendar.tsx | 1239-1240 | LOW |
| CA-07 | Sync errors shown only in console, not to user | Calendar.tsx, useAppStore.ts | 352, 158 | MEDIUM |
| CA-08 | No guard on empty `viewDates` array | Calendar.tsx | 348-350 | LOW |
| CA-09 | Month view is meeting-centric, week view is recording-centric — inconsistent | Calendar.tsx | 989 vs 1086 | MEDIUM |
| CA-10 | CalendarView type not shared between store and utils | useAppStore.ts, calendar-utils.ts | 21, 9 | LOW |

### 4G. Projects Page Audit (15 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| PJ-01 | Archive/Activate button has no handler | Projects.tsx | 187-190 | **CRITICAL** |
| PJ-02 | Delete button has no handler | Projects.tsx | 191-193 | **CRITICAL** |
| PJ-03 | Delete IPC double-wrapping — always fails Zod validation | preload/index.ts, projects-handlers.ts | 434, 173-176 | **CRITICAL** |
| PJ-04 | "Generate Status Report" button no handler | Projects.tsx | 250 | MEDIUM |
| PJ-05 | "Summarize Decisions" button no handler | Projects.tsx | 251 | MEDIUM |
| PJ-06 | Hardcoded stats (12, 5, 8) — fake data displayed for every project | Projects.tsx | 201-229 | MEDIUM |
| PJ-07 | Hardcoded AI insight text referencing "Amazon Connect" | Projects.tsx | 246-248 | MEDIUM |
| PJ-08 | Page ignores Zustand store — uses local useState, cross-component sync broken | Projects.tsx | 25-29 | MEDIUM |
| PJ-09 | Setter named `setActiveConversation` (copy-paste artifact) | Projects.tsx | 26 | LOW |
| PJ-10 | `_navigate` unused, no project detail route exists | Projects.tsx | 23-24 | LOW |
| PJ-11 | Project type mismatch — 2 different interfaces (knowledge.ts vs index.ts) | Projects.tsx, useProjectsStore.ts | 19, 8 | MEDIUM |
| PJ-12 | Search fires IPC on every keystroke without debounce | Projects.tsx | 50-52 | LOW |
| PJ-13 | No confirmation dialog before delete (once wired) | Projects.tsx | (missing) | LOW |
| PJ-14 | No error feedback to user — all errors are console.error only | Projects.tsx | 43-44, 78 | MEDIUM |
| PJ-15 | Filter tabs missing "All" option | Projects.tsx | 106-118 | LOW |

### 4H. People/Contacts Page Audit (12 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| PE-01 | "Add Person" button permanently disabled — no implementation behind it | People.tsx | 88-91 | MEDIUM |
| PE-02 | "Edit" button has no onClick handler | PersonDetail.tsx | 123-126 | HIGH |
| PE-03 | Meetings data fetched but never set in state — timeline always empty | PersonDetail.tsx | 26-27, 35-47 | HIGH |
| PE-04 | People page ignores ContactsStore — duplicate local state | People.tsx | 25-51 | MEDIUM |
| PE-05 | Search has no debounce — fires IPC on every keystroke | People.tsx | 53-55, 100-102 | LOW |
| PE-06 | Type mismatch: Contact (store) vs Person (page) types diverge | types/index.ts vs knowledge.ts | 200, 192 | MEDIUM |
| PE-07 | No delete contact capability anywhere in the stack | N/A | N/A | LOW |
| PE-08 | Type filter is client-side only — misses contacts beyond limit:100 | People.tsx | 33-36, 57-62 | LOW |
| PE-09 | No pagination — hardcoded limit:100 | People.tsx | 35 | LOW |
| PE-10 | Tags access not defensively guarded at render site | People.tsx | 207 | LOW |
| PE-11 | Empty state message misleading for new users with no contacts | People.tsx | 139-143 | LOW |
| PE-12 | useEffect missing function in dependency array (lint violation) | People.tsx, PersonDetail.tsx | 53-55, 55-57 | LOW |

### 4I. Explore/Search Page Audit (7 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| EX-01 | Search calls wrong IPC channel — `rag.search` instead of `rag.globalSearch`; globalSearch not exposed in preload | Explore.tsx, preload/index.ts | 30, 559-572 | **CRITICAL** |
| EX-02 | `globalSearch` uses wrong column index for `capturedAt` — shows correlation_method instead | rag.ts | 346 | HIGH |
| EX-03 | Form onSubmit does not call preventDefault — pressing Enter reloads page | Explore.tsx | 26, 65 | HIGH |
| EX-04 | Quick action buttons have no onClick handlers | Explore.tsx | 113-120 | MEDIUM |
| EX-05 | Search errors silently swallowed — no user-facing error state | Explore.tsx | 37-38 | MEDIUM |
| EX-06 | globalSearch returns Result<> wrapper but page does not unwrap it | rag.ts, Explore.tsx | 375, 30-36 | HIGH |
| EX-07 | Knowledge/Project cards navigate to generic routes without context | Explore.tsx | 158, 212 | LOW |

### 4J. AI/Transcription/RAG Backend Audit (15 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| AI-01 | 3 IPC channels exposed but never registered (`selectMeeting`, `addToQueue`, `processQueue`) | preload/index.ts | 451, 456, 457 | **CRITICAL** |
| AI-02 | Re-transcription crashes with UNIQUE constraint violation | transcription.ts, database.ts | 396, 1746 | HIGH |
| AI-03 | Retry logic is dead code — failed transcriptions never retry | transcription.ts | 81, 104, 113-116 | HIGH |
| AI-04 | Actionables created with wrong foreign key (recording_id vs knowledge_capture_id) | transcription.ts | 439 | HIGH |
| AI-05 | RAG chat sends duplicate user message to LLM | rag.ts | 204-210 | MEDIUM |
| AI-06 | Vector store indexes with stale meeting_id after AI linking | transcription.ts | 210, 462 | MEDIUM |
| AI-07 | Ollama config completely ignored — hardcoded URL, model, provider | ollama.ts | 6-8, 179-183 | MEDIUM |
| AI-08 | Meeting-scoped RAG ignores query relevance — hardcoded 0.8 score for all docs | rag.ts | 115-128 | MEDIUM |
| AI-09 | globalSearch returns wrong column for capturedAt (same as EX-02) | rag.ts | 345 | MEDIUM |
| AI-10 | Synchronous file read blocks main process (readFileSync on 200MB+ files) | transcription.ts | 228 | MEDIUM |
| AI-11 | cancelAllTranscriptions race condition — flag resets after 1 second | transcription.ts | 65-71 | LOW |
| AI-12 | resetStuckTranscriptions returns hardcoded zero counts | database.ts | 2561-2566 | LOW |
| AI-13 | transcription_status column never updated by transcription service | transcription.ts | 225, 414 | LOW |
| AI-14 | rag:globalSearch handler not exposed in preload (same as EX-01) | preload/index.ts | (absent) | LOW |
| AI-15 | chat_messages table missing columns referenced by assistant mapper | assistant-handlers.ts | 138-141 | LOW |

### 4K. Library Page Audit (20 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| LB-01 | Sorting is stored but never applied — user sort controls have no effect | Library.tsx | 233-271 | HIGH |
| LB-02 | No sort UI controls exist on the page | LibraryHeader.tsx, LibraryFilters.tsx | - | MEDIUM |
| LB-03 | SourceReader receives `isPlaying`/`onPlay` but discards them — no play from center panel | SourceReader.tsx | 42-44 | MEDIUM |
| LB-04 | BulkProgressModal is never shown — `showBulkProgressModal` never set to true | Library.tsx | 110, 964-978 | LOW |
| LB-05 | BulkResultSummary is never shown — `bulkOperationResult` never populated | Library.tsx | 109, 981-995 | LOW |
| LB-06 | `bulkOperationItems` always empty — never populated | Library.tsx | 108 | LOW |
| LB-07 | `onRetryFailed` in BulkResultSummary is a console.log stub | Library.tsx | 990-993 | LOW |
| LB-08 | Card view has no "Transcribe" button (list view does) | SourceCard.tsx | - | MEDIUM |
| LB-09 | SourceRowExpanded calls `.toISOString()` without Invalid Date guard | SourceRowExpanded.tsx | 31 | LOW |
| LB-10 | `downloadProgress` prop accepted but intentionally discarded in SourceRow | SourceRow.tsx | 57, 76 | LOW |
| LB-11 | SourceDetailDrawer is wired but never opens — dead UI | Library.tsx | 115-116, 998-1036 | LOW |
| LB-12 | `useUIStore` not persisted — `recordingsCompactView` resets on restart (same as SM-07) | useUIStore.ts | - | MEDIUM |
| LB-13 | Two competing view mode states (useUIStore vs useLibraryStore) | Library.tsx, useLibraryStore.ts, useUIStore.ts | 102, 23, 19 | MEDIUM |
| LB-14 | AudioPlayer controls shown before playback is initiated | SourceReader.tsx | 208-213 | LOW |
| LB-15 | Row click stops audio aggressively — no background listening while browsing | Library.tsx | 592-602 | LOW |
| LB-16 | SourceRow memo does not check `recording.location` — stale state after downloads | SourceRow.tsx | 300-323 | HIGH |
| LB-17 | SourceRow memo does not check `recording.category` or `recording.quality` | SourceRow.tsx | 300-323 | LOW |
| LB-18 | SourceRow memo does not check `recording.duration` or `recording.size` | SourceRow.tsx | 300-323 | LOW |
| LB-19 | Keyboard focus navigation has no visual indicator and does not scroll | useKeyboardNavigation.ts, Library.tsx | - | HIGH |
| LB-20 | Enter key in keyboard navigation is a no-op (onOpenDetail never provided) | useKeyboardNavigation.ts | 120-122 | MEDIUM |

### 4L. Device Page Audit (12 issues)

| ID | Issue | File | Line(s) | Severity |
|----|-------|------|---------|----------|
| DV-01 | Activity Log "Clear" button does not clear the Zustand store | Device.tsx | 983 | MEDIUM |
| DV-02 | Format Storage feature completely missing from UI | Device.tsx | (absent) | MEDIUM |
| DV-03 | Main useEffect re-runs ~8x per connect due to bad dependency array | Device.tsx | 281 | HIGH |
| DV-04 | Cancel Sync does NOT abort in-progress file download | useAppStore.ts, useDownloadOrchestrator.ts | 225, 149-167 | HIGH |
| DV-05 | `formatCard`, `setAutoRecord`, `getSettings`, `setTime` lack USB lock guard | jensen.ts | 1174, 1204, 1215, 1250 | MEDIUM |
| DV-06 | `setAutoRecord` returns false but UI doesn't check — switch shows wrong state | Device.tsx | 443-449 | MEDIUM |
| DV-07 | Device settings panel only shows "Auto-record" — missing LED, notification, BT settings | Device.tsx | 822-867 | LOW |
| DV-08 | Dual syncing state variables create confusion (same as DL-05) | Device.tsx | 23, 37 | LOW |
| DV-09 | Realtime streaming offset uses stale closure — always sends offset 0 | Device.tsx | 564-580 | HIGH |
| DV-10 | Bluetooth scan timeout not cleaned up on unmount | Device.tsx | 602-618 | LOW |
| DV-11 | Auto-connect toggle — `connectOnStartup` may not sync with `enabled` | Device.tsx, hidock-device.ts | 452, 242 | MEDIUM |
| DV-12 | getSettings/setTime in Jensen lack lock guard (overlaps DV-05) | jensen.ts | 1174, 1204 | LOW |

---

## Section 5: Master Summary & Priority Matrix

### Total Bug Count by Category

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total | Fixed |
|----------|----------|------|--------|-----|-------|-------|
| Download/Sync | 1 | 2 | 5 | 7 | 15 | 1/15 |
| Transcription Queue | 2 | 2 | 3 | 2 | 9 | 9/9 ✅ |
| State Management | 0 | 2 | 3 | 6 | 11 | 7/11 |
| File Listing | 0 | 3 | 4 | 3 | 10 | **7/10** ✅ |
| Actionables | 1 | 1 | 3 | 3 | 8 | 4/8 |
| Calendar | 1 | 1 | 4 | 4 | 10 | 10/10 ✅ |
| Projects | 3 | 0 | 7 | 5 | 15 | 3/15 |
| People | 0 | 2 | 3 | 7 | 12 | 3/12 |
| Explore/Search | 1 | 3 | 2 | 1 | 7 | 4/7 |
| AI Backend | 1 | 3 | 6 | 5 | 15 | 3/15 |
| Library | 0 | 3 | 6 | 11 | 20 | 2/20 |
| Device | 0 | 3 | 5 | 4 | 12 | 1/12 |
| **TOTAL** | **10** | **25** | **51** | **58** | **144** | **54/144 (38%)** |

### Previously Fixed (not in the 144 above)

- 15 TDD bug fixes (FIX-001 to FIX-015)
- 6 architecture improvements (ARCH-001 to ARCH-006)
- 9 quick wins (Phase 1.5)
- 5 type hardening fixes (Phase 5)
- **Total previously fixed: 35**

### The 10 CRITICAL Bugs (Must Fix Immediately)

| # | ID | Bug | Impact |
|---|-----|-----|--------|
| 1 | DL-01 | `Array.from(Uint8Array)` creates 16x memory amplification during downloads | App freezes/crashes on every file download |
| 2 | CA-01 | `calendar:clear-and-sync` IPC has NO handler | Calendar sync button does nothing |
| 3 | AI-01 | 3 IPC channels with no handler (`selectMeeting`, `addToQueue`, `processQueue`) | Cannot queue transcriptions from UI, cannot link recordings to meetings |
| 4 | TQ-01 | DB has no filename column in transcription_queue | All transcription items show "Unknown" after restart |
| 5 | TQ-02 | Manual transcription queue not persisted to DB | Transcriptions vanish on restart, stuck forever |
| 6 | PJ-03 | Delete IPC double-wraps ID — always fails Zod validation | Project deletion permanently broken at protocol level |
| 7 | PJ-01 | Archive/Activate button has no handler | Dead button, no way to archive projects |
| 8 | PJ-02 | Delete button has no handler | Dead button, no way to delete projects |
| 9 | AC-01 | `source_knowledge_id` stores recording_id — "Approve & Generate" always fails | Core actionables workflow completely broken |
| 10 | EX-01 | Search calls wrong IPC; `globalSearch` not exposed in preload | Explore search returns wrong data, people/projects never appear |

### The 25 HIGH Bugs (Fix After Critical)

| # | ID | Bug |
|---|-----|-----|
| 1 | DL-11 | useEffect re-subscribes ALL listeners on every connection step (8x) |
| 2 | DL-14 | Cancel button does NOT abort current USB transfer |
| 3 | TQ-03 | Queue item ID mismatch between manual/auto paths — cancel/remove fails |
| 4 | TQ-04 | Retry button only updates Zustand, not DB — completely non-functional |
| 5 | SM-01 | QA Logs switch uses non-reactive `getState()` — toggle desyncs |
| 6 | SM-02 | Layout subscribes to entire AppStore — re-renders on every download tick |
| 7 | FL-01 | `forceRefresh=true` bypasses concurrency guard — duplicate USB operations |
| 8 | FL-02 | Triple-fire on device connection (connection + ready + poll) |
| 9 | FL-08 | `forceRefresh` overwrites promise reference — corrupts lock state |
| 10 | AC-02 | "View Output" button has no onClick handler |
| 11 | CA-02 | Sync button never sets calendarSyncing — no spinner |
| 12 | PE-02 | PersonDetail "Edit" button has no onClick handler |
| 13 | PE-03 | Meetings data fetched but never set in state — timeline always empty |
| 14 | EX-02 | globalSearch uses wrong column index for capturedAt |
| 15 | EX-03 | Form onSubmit does not call preventDefault — Enter reloads page |
| 16 | EX-06 | globalSearch returns Result<> wrapper but page doesn't unwrap |
| 17 | AI-02 | Re-transcription crashes with UNIQUE constraint violation |
| 18 | AI-03 | Retry logic is dead code — failed items never retry |
| 19 | AI-04 | Actionables created with wrong FK (recording_id) |
| 20 | LB-01 | Sorting stored but never applied to recordings |
| 21 | LB-16 | SourceRow memo doesn't check location — stale state after downloads |
| 22 | LB-19 | Keyboard navigation has no visual indicator and doesn't scroll |
| 23 | DV-03 | Main useEffect re-runs ~8x per connect |
| 24 | DV-04 | Cancel Sync doesn't abort in-progress download |
| 25 | DV-09 | Realtime streaming offset uses stale closure — always 0 |

### Dead Code Inventory (7 entire stores, 3 components)

| Item | Location | Status |
|------|----------|--------|
| useMeetingsStore | store/domain/ | DEAD — never consumed |
| useKnowledgeStore | store/domain/ | DEAD — never consumed |
| useCalendarStore | store/domain/ | DEAD — never consumed |
| useDeviceSyncStore | store/features/ | DEAD — never consumed |
| useQualityStore | store/features/ | DEAD — never consumed |
| useLayoutStore | store/ | DEAD — never consumed |
| useCalendarUIStore | store/ | DEAD — never consumed |
| FilterBar.tsx | components/ | DEAD — never rendered |
| SourceDetailDrawer | Library.tsx integration | DEAD — never opened |
| BulkProgressModal / BulkResultSummary | Library.tsx integration | DEAD — never shown |

### Original User Complaint → Bug Mapping

| User Complaint | Bug IDs |
|----------------|---------|
| "app will not sync" | CA-01 |
| "will not auto-connect" | DV-11 |
| "won't save settings properly" | DV-06, SM-07, CA-03 |
| "won't auto-transcribe" | TQ-02, AI-01, AI-03 |
| "stop downloading" (cancel doesn't work) | DL-14, DV-04 |
| "gives errors on console" | AC-05, CA-07, PJ-14, PE-05 |
| "doesn't fail after some seconds/minutes of no progress" | DL-12 |
| "doesn't consistently download the file list" | FL-01, FL-02, FL-08 |
| "does not queue transcriptions" | TQ-02, AI-01 |
| "jensen errors out unexpectedly" | DV-05 |
| "shows transcription in progress when nothing done" | TQ-08, TQ-09 |
| "has no way to stop transcription" | TQ-05, AI-11 |
| "controls to cancel queue do not work or freeze the app" | DL-01, DL-14 |
| "download stalled errors keep popping up" | DL-12 |

---

## Test Coverage Status

- **Unit tests:** 379 passing (covers previously fixed bugs)
- **Integration tests:** 0
- **E2E tests:** 0
- **Estimated overall coverage:** ~15%
- **Recommended target:** 60%+ for critical paths

---

## Recommended Fix Order

### Phase A: Critical Path Fixes (10 CRITICAL bugs)
1. DL-01 — Fix memory amplification (use IPC-safe binary transfer)
2. CA-01 — Register `calendar:clear-and-sync` handler or fix channel name
3. AI-01 — Register 3 missing IPC handlers
4. TQ-01 — Add filename column or JOIN with recordings table
5. TQ-02 — Persist manual queue to DB via registered IPC handler
6. PJ-03 — Fix delete IPC double-wrapping
7. PJ-01/PJ-02 — Wire Archive/Delete buttons
8. AC-01 — Fix source_knowledge_id to use actual knowledge_capture_id
9. EX-01 — Expose globalSearch in preload, fix Explore.tsx to call it

### Phase B: High-Impact Fixes (25 HIGH bugs)
Focus on cancel/abort, state management, and core UX.

### Phase C: Medium Fixes (51 MEDIUM bugs)
Debouncing, error feedback, missing features, state persistence.

### Phase D: Low Priority (58 LOW bugs)
Code cleanup, dead code removal, cosmetic fixes, edge cases.

### Phase E: Test Coverage
Write tests for all critical paths, targeting 60%+ coverage.

---

*Generated by comprehensive audit across 12 specialized agents, 2026-02-25.*
