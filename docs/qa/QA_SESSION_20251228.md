# QA Session Analysis - December 28, 2025

**Status:** IN PROGRESS  
**Session Focus:** Log Analysis, Error Triage, Root Cause Identification  
**Artifacts Analyzed:** `electron_app.log`, `localhost-1766970354735.log`

---

## Executive Summary
The session revealed critical instability in the Core System (Database, Device Protocol) that cascades into functional failures in the Assistant and Sync features. While the UI layer (Calendar, Settings) has usability defects, the backend errors are blockers for data integrity and basic device operation.

---

## 1. Critical System Failures (Blockers)

### [SYS-01] Broken Database Transaction Logic
*   **Severity:** **CRITICAL** (Data Loss / Feature Blocker)
*   **Component:** `apps/electron/electron/main/services/database.ts`
*   **Error Signature:**
    ```text
    Error: cannot rollback - no transaction is active
    at e.handleError ... sql-wasm.js:90:371
    at runInTransaction (index.js:1286:14)
    ```
*   **Frequency:** High (~10 occurrences/session).
*   **User Impact:**
    *   **Assistant Broken:** Chat messages fail to save.
    *   **Data Integrity Risk:** Partial writes may occur if the rollback mechanism itself crashes the handler.
*   **Root Cause Analysis:**
    The `runInTransaction` wrapper assumes that if an error occurs, a transaction *must* be active and eligible for rollback. However, if the transaction failed to *start* (e.g., SQLite busy, previous crash left a lock), or if the error occurred *during* a commit, the `ROLLBACK` command itself fails, throwing a secondary error that masks the original issue and crashes the IPC handler.

### [SYS-02] Device Protocol Flood (Jensen Protocol Mismatch)
*   **Severity:** **HIGH** (Device Instability)
*   **Component:** `apps/electron/src/services/jensen.ts`
*   **Error Signature:**
    ```text
    [Jensen] Unexpected seq: expected seq=4, got cmd=5 seq=11. Discarding.
    [Jensen] Unexpected seq: expected seq=4, got cmd=5 seq=12. Discarding.
    ... (Thousands of lines)
    ```
*   **User Impact:**
    *   **Settings Page Hangs:** Loading device settings times out.
    *   **Sync Reliability:** Command channel is flooded, causing "Download Stall" at specific percentages.
*   **Root Cause Analysis:**
    The app's protocol handler (`receiveResponse`) expects a strict request-response sequence for control commands (e.g., `CMD_GET_SETTINGS`). However, the device is simultaneously streaming Realtime Audio data (`cmd=5`). The handler does not filter or route these audio packets; instead, it treats them as "wrong sequence number" responses to the pending control command and discards them. The control command eventually times out (15s) because its actual response is buried or lost in the flood.

### [SYS-03] USB Command Timeouts
*   **Severity:** **HIGH**
*   **Error Signature:**
    ```text
    [HiDockDevice] Failed to get storage info: Error: Get storage info timed out after 15000ms
    ```
*   **Root Cause:** Direct consequence of **SYS-02**. The control loop is starved by the unhandled audio stream.

### [SYS-04] IPC Wrapper Infinite Recursion
*   **Severity:** **CRITICAL** (Introduced during instrumentation)
*   **Error Signature:** Millions of `[IPC-ERR]` logs for `recordings:getTranscriptionStatus`.
*   **Root Cause:** The `invoke` wrapper in `preload/index.ts` was calling itself instead of `ipcRenderer.invoke` after a bulk find-replace operation.
*   **Status:** ✅ Fixed (Manual correction applied to `preload/index.ts`).

### [UI-01] Missing Unique Keys in Recordings List
*   **Severity:** Low (Performance/Stability)
*   **Error Signature:** `Warning: Each child in a list should have a unique "key" prop.`
*   **Component:** `Recordings.tsx`
*   **Analysis:** React reconciliation is hampered by non-unique or missing keys in the list of recordings, specifically in the virtualized list or the mapping of capture entities.
*   **Status:** 🔴 Pending

---

## 2. Background Service Defects

### [SVC-01] Implicit Auto-Download Trigger
*   **Severity:** **MEDIUM** (UX / Performance)
*   **Component:** `apps/electron/src/pages/Device.tsx`
*   **Observation:** Visiting the `/sync` route immediately triggers a massive queueing operation (`[DownloadService] Queued: ...`) for hundreds of files.
*   **Root Cause Analysis:**
    The "Auto-Sync" logic is tightly coupled to the `Device.tsx` component's mount lifecycle (`useEffect`). It is not handled by a persistent background service. This violates the separation of concerns and causes unexpected network/USB activity simply by navigating the UI.

### [SVC-02] "Zombie" Transcription (Ignoring Config)
*   **Severity:** **MEDIUM** (Resource Drain)
*   **Observation:** Files show "Processing" (orange animation) immediately after download, even when "Auto-transcribe" is disabled in Settings.
*   **Log Evidence:**
    ```text
    [DownloadService] Completed: 2025Jun03-173925-Rec65.hda
    Transcribing: 2025Jun03-173925-Rec65.hda  <-- IMMEDIATE TRIGGER
    ```
*   **Root Cause Analysis:**
    The `DownloadService` or `RecordingWatcher` has a hardcoded call to `transcribeRecording()` upon file completion, bypassing the `config.transcription.autoTranscribe` check.

### [SVC-03] Download Queue Race Condition
*   **Severity:** **MEDIUM** (UI State Glitch)
*   **Observation:** "Perpetual Loading" state on downloaded files; Audio Player fails to load them.
*   **Log Evidence:**
    ```text
    [DownloadService] Completed: ...
    Processing new recording: ...
    Recording added to database: ...
    ```
*   **Root Cause Analysis:**
    Race condition between `DownloadService` (which updates the DB status to "downloaded") and `RecordingWatcher` (which sees the new file on disk and inserts a *new, duplicate* record with "pending" status). The UI likely renders the "pending" duplicate, blocking playback.

---

## 3. UI & Feature Gaps

### [CAL-01] Broken Day View Navigation
*   **Severity:** Low (Usability)
*   **Issue:** Clicking "<" or ">" in Day View jumps by 7 days (Week) instead of 1 Day.
*   **Root Cause:** Hardcoded `navigateWeek()` call in the pager component logic.

### [CAL-02] Missing Queue Progress (Calendar)
*   **Severity:** Low (UX)
*   **Issue:** Bulk downloads initiated from Calendar do not update the global sidebar progress indicator.
*   **Root Cause:** `handleBulkDownload` in `Calendar.tsx` manages local state but fails to dispatch actions to the global `useAppStore` `deviceSyncState`.

### [SET-01] Dangerous Operations Visibility
*   **Severity:** Low (Safety)
*   **Issue:** "Purge missing files" and "Delete wrongly named files" are exposed in the main Settings view.
*   **Fix Required:** Wrap in "Advanced Operations" collapsible section.

### [ACT-01] Actionables Feature Missing
*   **Severity:** Medium (Incomplete Feature)
*   **Issue:** Page is static/empty.
*   **Root Cause:** The backend logic (LLM extraction worker) to populate the `actionables` table from transcripts has not been implemented yet.

### [UI-01] React Reconciliation Warnings
*   **Severity:** Low
*   **Log Evidence:** `Warning: Each child in a list should have a unique "key" prop` in `Recordings.tsx`.

---

## Action Plan (Prioritized)

1.  **[SYS-01] Fix Database Transactions:** Rewrite `runInTransaction` to safely handle transaction states and prevent IPC crashes.
2.  **[SYS-02] Fix Jensen Protocol:** Patch `jensen.ts` to route `cmd=5` (Audio) packets to a dedicated stream handler, unblocking the Control Command queue.
3.  **[SVC-01] Centralize Sync Logic:** Decouple auto-sync from `Device.tsx` and move it to `OperationController` or `DownloadService`.
4.  **[SVC-02] Enforce Transcribe Config:** Ensure `RecordingWatcher` respects the `autoTranscribe` flag.