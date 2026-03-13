# Bug Report: HiDock Electron App - Session 2026-03-11

**Reporter**: Sebastian Geraldes
**Date**: 2026-03-11
**App Version**: dev (electron-vite)
**Device**: HiDock H1E (SN: HD1E243505435, FW: 6.2.5)
**Files on Device**: 1326 recordings

---

## Summary

Comprehensive bug triage from a real user session. 17 bugs identified across 7 subsystems: device connection, file listing, download pipeline, transcription pipeline, meeting linking, audio player, and UI state management.

### Severity Legend
- **P0 - Critical**: Feature completely broken, data loss or corruption risk
- **P1 - High**: Major feature broken, no workaround
- **P2 - Medium**: Feature partially broken, workaround exists
- **P3 - Low**: Minor UX issue, cosmetic

---

## BUG-001: Auto-Connect Does Not Work on Startup
**Severity**: P1 - High
**Subsystem**: Device Connection
**Observed**: Device was plugged in at app startup. Auto-connect setting is ON. User had to manually navigate to Sync page and click Connect.
**Expected**: Device should auto-connect when plugged in and auto-connect is enabled.

**Root Cause**: Three possible failure modes:
1. `tryConnectSilent()` only finds *previously authorized* devices via `navigator.usb.getDevices()`. If device was never authorized in this browser context, silent connect fails.
2. `navigator.usb.onconnect` event only fires for *newly plugged* devices, NOT devices already connected at startup.
3. `userInitiatedDisconnect` flag persists across sessions — if user previously clicked Disconnect, auto-connect is blocked until user manually connects.

**Files**:
- `src/services/hidock-device.ts` lines 266-292 (`startAutoConnect`)
- `src/services/jensen.ts` lines 380-403 (`setupUsbConnectListener`)
- `src/App.tsx` lines 28-34 (init call)

---

## BUG-002: File List Download Blocks All USB Operations for ~95s with Zero UI Feedback
**Severity**: P0 - Critical
**Subsystem**: Device Communication / UX
**Observed**: After connecting, 95 seconds of silence while 1326 files were listed. No progress indicator, no status message, no way to know what's happening. Activity log only showed "Scanning device files..." then nothing for 95 seconds.
**Expected**: Progress bar showing "Loading file list: 423/1326 files..." or similar real-time feedback.

**Root Cause**: `jensen.listFiles()` acquires USB mutex lock (`withLock`) for the entire duration. Progress callbacks exist locally in `hidock-device.ts` (lines 974-1007) with animated interpolation, but are **never sent to the renderer via IPC**. The renderer has no way to know progress is happening.

**Files**:
- `src/services/jensen.ts` lines 1375-1500+ (`listFiles` with USB lock)
- `src/services/hidock-device.ts` lines 968-1007 (`listRecordings` - local progress only)

---

## BUG-003: File List Requested Twice (Duplicate USB Command)
**Severity**: P2 - Medium
**Subsystem**: Device Communication
**Observed**: Console logs show two separate "CMD: List Files" at 20:10:58 and 20:12:33, each taking ~95 seconds. Total wasted time: ~95 seconds.
**Expected**: File list should be fetched once after connection.

**Root Cause**: Two independent triggers fire sequentially:
1. `onConnectionChange(connected=true)` calls `loadRecordings(false)` (cache miss on first load)
2. ~95s later, `onStatusChange('ready')` calls `loadRecordings(true)` with `forceRefresh=true`, triggering a SECOND USB fetch

The 2-second debounce in `useUnifiedRecordings.ts` doesn't help because the events are ~95 seconds apart.

**Files**:
- `src/hooks/useUnifiedRecordings.ts` lines 551-575 (dual trigger)

---

## BUG-004: Download Silently Queued During File List with No User Feedback
**Severity**: P1 - High
**Subsystem**: Download Pipeline / UX
**Observed**: User clicked "Download" on a file while file list was loading. Nothing happened for >1 minute. No indication the download was queued. Download only started after file list completed.
**Expected**: Either (a) immediate feedback "Download queued - waiting for device..." or (b) prevent download action while device is busy with clear messaging.

**Root Cause**: Download is added to the queue in `download-service.ts` and `emitStateUpdate()` sends IPC, but the renderer's download UI doesn't receive the update because the IPC bridge for `download-service:state-update` is incomplete in the preload script.

**Files**:
- `electron/main/services/download-service.ts` lines 291-348 (`queueDownloads`)
- Preload script missing `onStateUpdate` listener bridge

---

## BUG-005: Download/Transcription Status Icons Never Update in Real-Time
**Severity**: P0 - Critical
**Subsystem**: IPC Bridge / UI State
**Observed**: Download icon stuck as loading spinner after download completed. Transcription shows "Processing" even after transcription finished. Status only updates after full page restart (Ctrl+Shift+R).
**Expected**: Icons should update in real-time as operations complete.

**Root Cause**: IPC events are emitted from main process (`download-service:state-update`, `transcription:completed`, etc.) but the **preload script does not expose event listeners** to the renderer. Events are sent into the void.

| IPC Event | Main Emits | Preload Bridge | Renderer Listens |
|-----------|-----------|----------------|-----------------|
| `download-service:state-update` | Yes | **NO** | No |
| `transcription:started` | Yes | **NO** | No |
| `transcription:completed` | Yes | **NO** | No |
| `transcription:failed` | Yes | **NO** | No |

**Fallback**: `useTranscriptionSync` has a 5-second polling interval, but this is insufficient for real-time UX.

**Files**:
- `electron/main/services/download-service.ts` line 934 (emit)
- `electron/main/services/transcription.ts` line 234 (emit)
- `electron/preload/index.ts` (missing bridges)

---

## BUG-006: No Toast/Pop-up Notifications for Completed Operations
**Severity**: P2 - Medium
**Subsystem**: Notifications
**Observed**: Download complete, transcription complete, and other operations produce NO user-visible notification. User must monitor the activity log (small panel at bottom) to know anything happened.
**Expected**: Toast notifications for: download complete, transcription complete, meeting linked, errors.

**Root Cause**: Native notification handler exists in `download-service.ts` line 1061-1083 (`ipcMain.handle('download-service:notify-completion')`) but it is **never called**. No code invokes `notifyCompletion()` after sync operations complete. No toast system in renderer for transcription events.

**Files**:
- `electron/main/services/download-service.ts` lines 1061-1083 (unused handler)
- `src/components/ui/toaster.ts` (toast utility exists, underutilized)

---

## BUG-007: Auto-Download Not Working
**Severity**: P1 - High
**Subsystem**: Download Pipeline
**Observed**: Auto-download is enabled in settings. After connecting, only the manually triggered file was downloaded. The other 62 device-only files were not queued.
**Expected**: All undownloaded files should be automatically queued for download when device connects.

**Root Cause**: **No code checks `config.device.autoDownload` to automatically queue files.** The setting exists in config and the UI toggle works, but no handler listens to device connection and auto-queues pending files based on the setting.

**Files**:
- `src/pages/Device.tsx` (toggle exists)
- Missing: handler connecting device connection event to automatic queue population

---

## BUG-008: Auto-Transcribe Not Working for Downloaded Files
**Severity**: P1 - High
**Subsystem**: Transcription Pipeline
**Observed**: Auto-transcribe is enabled in settings. After download completed, transcription did not start automatically. User had to manually click "Transcribe".
**Expected**: Transcription should auto-start when a new download completes and auto-transcribe is enabled.

**Root Cause**: `recording-watcher.ts` only auto-queues transcription for **new local files detected by the file watcher** (line 200-210). It does NOT listen to download completion events. There is **no hook connecting download completion to auto-transcription**.

**Files**:
- `electron/main/services/recording-watcher.ts` lines 200-210 (file watcher only)
- Missing: download-complete → auto-transcribe bridge

---

## BUG-009: Wrong Meeting Linked to Recording (AI Matching Error)
**Severity**: P1 - High
**Subsystem**: Meeting-Recording Linking
**Observed**: Recording made during "Technical Interview - DFX5" (Wed Mar 11, ~6:30-7:30 PM) was linked to "Antamina MAP 2024 - Daily interno" with AI confidence 0.95. Calendar clearly shows the correct meeting was the Technical Interview. Antamina meeting was on a DIFFERENT DAY (Thursday).
**Expected**: Recording should link to the correct meeting based on time overlap and content.

**Root Cause (Two-Stage Matching)**:
1. **Stage 1** (time-based): Finds candidate meetings within +/-30 min of recording time. Only 1 candidate was found (confidence 0.5545), suggesting only "Antamina" was in the database for that time window. The actual meeting ("Technical Interview") may not have been synced from calendar yet.
2. **Stage 2** (AI content): Gemini analyzes transcript and selects from candidates. With only 1 candidate, it confirmed the wrong match with 0.95 confidence.

**Key Issue**: If only 1 candidate is found, the AI has no choice — it confirms the wrong meeting. The system does NOT validate that the candidate's time actually overlaps well. No attendee matching is performed.

**Files**:
- `electron/main/services/database.ts` lines 2728-2750 (candidate selection)
- `electron/main/services/transcription.ts` lines 450-555 (AI matching prompt)

---

## BUG-010: "Invalid Recording ID" Error When Changing Linked Meeting
**Severity**: P0 - Critical
**Subsystem**: Recording ID Schema
**Observed**: Clicking pencil icon to change linked meeting shows "Invalid recording ID" error. Console shows Zod validation: `rec_2026Mar11_185933_Rec71_wav` doesn't match UUID format.
**Expected**: Dialog should open and allow meeting change.

**Root Cause**: Recording IDs are generated in `rec_xxx` format by `recording-watcher.ts` (line 124-127: `rec_${filename.replace(/[^a-zA-Z0-9]/g, '_')}`), but the `recordings:getCandidates` IPC handler validates with `z.string().uuid()` which requires UUID format. The formats are fundamentally incompatible.

**Files**:
- `electron/main/services/recording-watcher.ts` lines 124-127 (ID generation)
- `electron/main/validation/common.ts` line 16 (`RecordingIdSchema = z.string().uuid()`)
- `electron/main/ipc/recording-handlers.ts` lines 339-352 (validation)
- `src/components/RecordingLinkDialog.tsx` line 73 (sends `recording.id`)

---

## BUG-011: Audio Player/Waveform Not Visible When Recording Selected
**Severity**: P2 - Medium
**Subsystem**: Audio Player
**Observed**: Selecting a recording shows metadata but no audio player or waveform. Must click "Play" to see the player. "Select a recording to view waveform" message shows even when a recording IS selected.
**Expected**: Waveform visualization should appear immediately when a downloaded recording is selected.

**Root Cause**: `SourceReader.tsx` line 496 — player only renders when `isPlaying` is true:
```tsx
{canPlay && isPlaying && ( <AudioPlayer ... /> )}
```
Additionally, `AudioPlayer.tsx` line 105 checks `currentlyPlayingId` for the loading skeleton, which is null when not playing.

**Files**:
- `src/features/library/components/SourceReader.tsx` line 496
- `src/components/AudioPlayer.tsx` lines 91-124

---

## BUG-012: Stop Button Deselects Recording (Shows "No Recording Selected")
**Severity**: P1 - High
**Subsystem**: Audio Player / Selection State
**Observed**: Clicking Stop in the center panel closes the player AND clears the selection, showing "No recording selected". User only wanted to stop playback, not deselect.
**Expected**: Stop should stop audio playback but keep the recording selected and visible.

**Root Cause**: `Library.tsx` has two different stop handlers:
- **SourceRow stop** (line 674-676): Only calls `audioControls.stop()` — correct behavior
- **SourceReader stop** (line 678-681): Calls `audioControls.stop()` AND `setSelectedSourceId(null)` — clears selection

The SourceReader's `onStop` is wired to `AudioPlayer`'s `onClose` prop (SourceReader.tsx line 498), conflating "stop playback" with "close/dismiss player".

**Files**:
- `src/pages/Library.tsx` lines 674-681 (dual handlers)
- `src/features/library/components/SourceReader.tsx` line 498 (`onClose={onStop}`)

---

## BUG-013: Transcription Status Shows "Pending"/"Queued" After Completion
**Severity**: P2 - Medium
**Subsystem**: Transcription Status
**Observed**: After restart (Ctrl+Shift+R), completed transcription shows as "Pending" in metadata and "Queued" on the Transcribe button (disabled). Full transcript and summary ARE present below.
**Expected**: Status should show "Complete" with no Transcribe button visible.

**Root Cause**: Multiple issues:
1. Transcription status in the `recordings` table may not update after `transcription:completed` event due to broken IPC bridge (see BUG-005)
2. `SourceReader.tsx` line 439: Transcribe button shows when `transcriptionStatus !== 'complete'` — if status is stale, button remains
3. On startup, stuck `processing` status is not reset to `pending` (no cleanup logic)

**Files**:
- `src/features/library/components/SourceReader.tsx` lines 439-468
- `electron/main/services/transcription.ts` (missing startup cleanup)

---

## BUG-014: Summary Displayed Twice in Detail Panel
**Severity**: P2 - Medium
**Subsystem**: UI / Component Layout
**Observed**: After restart, the summary text appears twice — once in the header area and once in the collapsible "Summary" accordion section.
**Expected**: Summary should appear only once.

**Root Cause**: `SourceReader.tsx` renders summary in TWO places:
1. **Line 355**: Inline in header: `{transcript?.summary && ( <div>...summary...</div> )}`
2. **Line 509**: Passes `showSummary={true}` to `<TranscriptViewer>` which renders its own collapsible "Summary" section (TranscriptViewer.tsx line 173)

Both render the same `transcript.summary` data.

**Files**:
- `src/features/library/components/SourceReader.tsx` lines 355 and 509
- `src/features/library/components/TranscriptViewer.tsx` lines 173-193

---

## BUG-015: Transcript Appears Truncated (Missing Last ~10 Minutes)
**Severity**: P2 - Medium
**Subsystem**: Transcription
**Observed**: For a ~1h10m recording, transcript ends at "encontrar que fue lo que paso" — approximately 10 minutes before the actual meeting ended with goodbyes.
**Expected**: Full transcript covering entire recording duration.

**Root Cause**: Likely one of:
1. **Gemini API token limit**: Transcription may hit output token limit, causing truncation
2. **Audio chunking**: If audio is split into chunks for transcription, the last chunk(s) may fail silently
3. **Actionable detection truncation**: `transcription.ts` line 307-309 truncates to last 5000 words for actionable detection, but this should not affect stored `full_text`

**Needs investigation**: Check the `transcripts.full_text` value in the database vs what the UI renders. The `TranscriptViewer` has a `max-h-96 overflow-y-auto` container (line 237) which limits visible height but scrolls — visual truncation is possible if user doesn't scroll.

**Files**:
- `electron/main/services/transcription.ts` lines 307-309 (5000-word truncation for actionables)
- `src/features/library/components/TranscriptViewer.tsx` line 237 (scroll container)

---

## BUG-016: Selection Model Inconsistency (Checkbox vs Click)
**Severity**: P2 - Medium
**Subsystem**: UI / Selection UX
**Observed**: Clicking a row opens it in the center panel (click-to-view). Checkboxes select rows for bulk operations. These are independent — user can have Rec71 checkbox-selected while viewing Rec70 in the center panel. "1 of 1333 selected" refers to checkboxes, not the viewed item. This creates confusion about what "selected" means.
**Expected**: Clear mental model — either:
- **Option A**: Click anywhere on row = select (single) + view in center panel. Checkboxes only for multi-select/bulk.
- **Option B**: Checkboxes for selection, click row body for viewing. But make the distinction visually obvious.

**Root Cause**: Two independent state systems:
- `selectedSourceId` (store) = which recording is displayed in center panel (single)
- `selectedIds` (state) = which recordings have checked checkboxes (multiple)
These never synchronize.

**Files**:
- `src/pages/Library.tsx` (both states managed independently)
- `src/features/library/components/SourceRow.tsx` (checkbox vs row click)

---

## BUG-017: No "Open File" or "Open Containing Folder" for Recordings
**Severity**: P3 - Low (Missing Feature)
**Subsystem**: File Operations
**Observed**: No way to open the source audio file in an external program (VLC, Media Player) or open its containing folder from the recording detail panel. The top-level "Open Folder" button opens the root recordings directory, not the specific file's location.
**Expected**: Per-recording actions: "Open in default app", "Show in Explorer/Finder", or "Copy file path".

**Root Cause**: Feature not implemented. Electron provides `shell.openPath()` and `shell.showItemInFolder()` APIs that could be exposed via IPC.

**Files**:
- `src/features/library/components/SourceReader.tsx` (action buttons section, lines 372-493)
- Missing: IPC handlers for `shell.openPath` / `shell.showItemInFolder`

---

## BUG-018: Recording Duration Shows "Unknown" Despite Being Available
**Severity**: P2 - Medium
**Subsystem**: Data Pipeline / Duration Calculation
**Observed**: Downloaded recording shows "Duration: Unknown" in the detail panel. The device file list provides file size and version info from which jensen.ts correctly calculates duration (line 1607). Other apps (desktop, web) display duration correctly.
**Expected**: Duration should be shown for ALL recordings — from device file list (pre-download) AND from actual audio file analysis (post-download).

**Root Cause**: Two record creation paths with different ID formats create orphaned data:
1. **Device scan** path: `database.ts:upsertDeviceRecording()` creates a record with **UUID** and **correct duration** from jensen's file list data
2. **File watcher** path: `recording-watcher.ts` creates a SEPARATE record with **`rec_xxx` ID** and `duration_seconds: undefined` (line 190, comment: "Will be updated after processing" — but it never is)

These two records for the SAME file have different IDs (`UUID` vs `rec_xxx`), so when the UI loads the file-watcher record (which is the "local" record), it gets `undefined` duration even though the device record has the correct value.

Additionally, after download completes, NO code reads the WAV file header or probes audio duration to update the recording-watcher record.

**Files**:
- `src/services/jensen.ts` line 1607 (`calculateDurationSeconds` — works correctly)
- `electron/main/services/recording-watcher.ts` line 190 (`duration_seconds: undefined`)
- `electron/main/services/database.ts` line 1871 (`upsertDeviceRecording` — writes duration)
- `electron/main/ipc/recording-handlers.ts` line 419 (`duration_seconds: undefined`)

---

## BUG-019: AI Summary/Analysis Generated in English for Spanish Transcripts
**Severity**: P2 - Medium
**Subsystem**: Transcription / AI Analysis
**Observed**: Recording transcript is in Spanish. The AI-generated summary is in English. The suggested questions are in English. Only the transcript text itself is in Spanish.
**Expected**: Summary, action items, key points, and suggested questions should be in the SAME language as the transcript.

**Root Cause**: The analysis prompt in `transcription.ts` (line 474) is entirely in English with no instruction to respond in the transcript's language:
```
"Analyze this meeting transcript and provide:
1. A brief summary (2-3 sentences)
2. A list of action items..."
```
The prompt asks for a `"language"` field in the output (line 497) to detect the language, but does NOT instruct the model to generate summary/action_items/questions in that language. The LLM defaults to responding in the language of the prompt (English).

**Fix**: Add explicit instruction: "Respond in the SAME language as the transcript. If the transcript is in Spanish, write summary, action items, topics, key points, title, and questions in Spanish."

**Files**:
- `electron/main/services/transcription.ts` lines 474-501 (analysis prompt)

---

## BUG-020: AI-Generated Title Not Displayed When Meeting Is Linked
**Severity**: P3 - Low
**Subsystem**: UI / Title Display
**Observed**: The AI generates a `title_suggestion` and `updateKnowledgeCaptureTitle()` stores it (line 584-585). However, the detail panel always shows the **meeting subject** as the title when a meeting is linked: `{meeting?.subject || recording.title || recording.filename}` (SourceReader.tsx line 240). The AI title is invisible.
**Expected**: Either (a) show AI title as the recording title and meeting subject separately, or (b) use AI title to improve/override the meeting name for this recording's context.

**Root Cause**: Display priority in SourceReader.tsx line 240 — `meeting?.subject` takes absolute precedence. The AI title stored in `knowledge_captures.title` is never shown when a meeting is linked. The same happens in the file list (SourceRow) where meeting subject overrides the title.

**Files**:
- `src/features/library/components/SourceReader.tsx` line 240
- `electron/main/services/transcription.ts` lines 584-585 (title IS saved)

---

## Cross-Cutting Issues

### IPC Bridge Gap (Affects BUG-004, BUG-005, BUG-006, BUG-008, BUG-013)
The most impactful systemic issue is the **incomplete IPC event bridge** in the preload script. Main process emits events that renderer never receives. This single fix would resolve or improve 5 bugs simultaneously.

### Pipeline Connectivity (Affects BUG-007, BUG-008)
Auto-download and auto-transcribe settings exist but lack the trigger logic connecting:
- Device connection → auto-download queue population
- Download completion → auto-transcription queue

### Recording ID Format (Affects BUG-010, BUG-018, potentially BUG-009)
The `rec_xxx` vs UUID format mismatch is a schema-level issue that:
- Blocks meeting link changes (BUG-010)
- Creates duplicate/orphaned records with data loss (BUG-018 — duration lost)
- Potentially affects all operations that cross the device-record/local-record boundary

### Dual Record Creation (Affects BUG-010, BUG-013, BUG-018)
The same physical file can produce TWO database records with different IDs:
1. Device scan: UUID ID, has duration, device metadata
2. File watcher: `rec_xxx` ID, no duration, local metadata
These never merge, causing data fragmentation across the entire system.

---

## Recommended Fix Priority

| Priority | Bugs | Impact |
|----------|------|--------|
| **Fix First** | BUG-005 (IPC bridge) | Unblocks real-time status updates for 5+ bugs |
| **Fix Second** | BUG-010 + BUG-018 (recording ID / dual records) | Unblocks meeting changes, fixes duration, eliminates data fragmentation |
| **Fix Third** | BUG-012 (stop deselects) | Fixes most disruptive UX issue |
| **Fix Fourth** | BUG-002, BUG-003 (file list) | Fixes 95s+ dead time on every connection |
| **Fix Fifth** | BUG-007, BUG-008 (auto pipelines) | Completes auto-download/transcribe features |
| **Fix Sixth** | BUG-014 (duplicate summary) | Quick fix, one-line change |
| **Fix Seventh** | BUG-019 (language) | One-line prompt fix |
| **Remaining** | BUG-001, BUG-006, BUG-009, BUG-011, BUG-013, BUG-015, BUG-016, BUG-017, BUG-020 | Incremental improvements |
