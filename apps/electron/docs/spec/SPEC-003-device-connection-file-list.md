# SPEC-003: Device Connection & File List UX

## Problem Statement
The current HiDock device connection and file listing experience in the Electron app is suboptimal and buggy. Key issues include:
1. **Broken Auto-Connect**: Users must manually click "Connect" on every startup, even when a device is plugged in and auto-connect is enabled.
2. **Frozen File Listing**: Fetching the file list for large collections (1000+ files) takes 95+ seconds without any visual feedback in the primary UI, blocking other USB operations.
3. **Duplicate Requests**: The app often requests the file list twice in rapid succession due to overlapping event triggers, effectively doubling the wait time to ~190s.

## Bugs Addressed
- **BUG-001 (P1)**: Auto-connect fails on startup. `navigator.usb.onconnect` only fires for new plugs, not devices already connected when the app starts.
- **BUG-002 (P0)**: File list fetch blocks the USB mutex for ~95s (at ~15 files/sec) with no IPC progress reporting to the renderer.
- **BUG-003 (P2)**: Double-trigger on connection. `onConnectionChange` and `onStatusChange('ready')` both trigger `loadRecordings`, leading to redundant USB scans.

## User Stories
- As a user, I want the app to automatically recognize my HiDock as soon as it opens so I don't have to click "Connect" every time.
- As a user, I want to see a progress bar and status messages while the app is scanning my device files so I know it hasn't crashed.
- As a user, I want to be able to browse my local recordings even while a device scan is in progress.

## Current Behavior (Broken)
**Timeline: 1326 files on device**
- **0s**: App launches. `initAutoConnect()` calls `tryConnectSilent()`. It fails to find the device because it's already plugged in and `onconnect` hasn't fired.
- **2s**: User clicks manual "Connect". USB lock acquired.
- **3s**: `onConnectionChange(true)` triggers `loadRecordings(false)`. This returns local/cached files instantly.
- **5s**: Device reaches `ready` state. `onStatusChange('ready')` triggers `loadRecordings(true)`.
- **5s - 100s**: `listRecordings()` acquires USB lock. `jensen.listFiles()` begins.
    - **UX**: The "Sync" button or Library view shows a spinner or nothing.
    - **USB**: Jensen service is busy fetching pages of 20 files. Lock is held continuously.
    - **Progress**: Callbacks happen in `jensen.ts` but never leave the main/service layer.
- **100s**: First `listRecordings` completes. `loadRecordings` updates state.
- **101s**: (If logic is particularly broken) A second redundant `listRecordings` might start if the triggers weren't properly deduped.

## Expected Behavior (Target)
**Timeline: 1326 files on device**
- **0s**: App launches. `initAutoConnect()` checks `navigator.usb.getDevices()`, finds the authorized HiDock, and connects immediately.
- **1s**: Device connected. UI shows "Connecting..." status with progress bar at 10%.
- **2s**: Device `ready`. `loadRecordings(true)` starts.
- **2s - 90s**: 
    - **UI**: Progress bar shows "Scanning device: 450 / 1326 files (34%)". Updates every 500ms.
    - **USB**: `jensen.listFiles()` fetches in batches.
- **92s**: Scan complete. Library updates with new files. UI returns to "Ready".

## Acceptance Criteria
- [ ] App auto-connects to a previously authorized device within 2 seconds of launch if plugged in.
- [ ] File list progress is visible in the UI (percentage or count) with updates at least every 1000ms.
- [ ] File list scan for 1300+ files completes in < 100s without redundant requests.
- [ ] User can interact with local recordings (play, view details) while a device scan is in progress.
- [ ] USB lock is released if the scan is aborted or the device is unplugged.

## Technical Approach

### Auto-Connect Fix
- **Issue**: `navigator.usb.onconnect` only triggers on physical plug events.
- **Solution**: 
    - In `initAutoConnect`, explicitly call `navigator.usb.getDevices()` to find already-authorized devices.
    - If a matching HiDock is found, call `tryConnectSilent()`.
    - Ensure `userInitiatedDisconnect` is strictly respected: if the user clicked "Disconnect" in the previous session, do not auto-connect until they manually connect once more.

### File List Progress
- **IPC reporting**:
    - Extend `jensen.listFiles` to accept a progress callback.
    - In `hidock-device.ts`, the `listRecordings` method must emit an IPC event or update a reactive state that the renderer can consume.
    - Specifically, use the existing `onStatusChange` to send `progress` values:
      ```typescript
      this.updateStatus('counting-files', `Scanning: ${found}/${total}`, (found/total)*100);
      ```
- **UI Progress Bar**: 
    - Add a progress indicator to the `Library` header or `Device` page.
    - Display current file count vs total expected count (retrieved from `getFileCount` command).

### Duplicate Request Elimination
- **Deduplication Logic**:
    - In `useUnifiedRecordings`, implement a "loading" ref or timestamp-based guard.
    - If a refresh is requested within 2 seconds of an existing one, ignore it unless `forceRefresh` is true.
    - Coordinate `onConnectionChange` and `onStatusChange('ready')`. Only the 'ready' signal should trigger the `listRecordings(true)` (USB scan). The connection event should only trigger a local state refresh.

### USB Lock Optimization
- **Lock Interleaving**: 
    - Modify `jensen.listFiles` to fetch file pages in a loop but *check for abort signals* between pages.
    - Ensure that if a user starts a download, the file listing doesn't block the download request for 90 seconds. 
    - *Constraint*: The Jensen protocol is strictly request-response. We cannot run two commands simultaneously, but we can allow a high-priority "Download" or "Delete" command to wait for the current *page* of the file list to finish rather than the *entire* list.

## UI/UX Requirements
- **Status Messages**:
    - "Searching for HiDock..." (Startup)
    - "Connected. Initializing..." (Handshake)
    - "Scanning device: 120 / 1326 files..." (Listing)
    - "Sync complete." (Finished)
- **Progress Bar**: A linear progress bar should appear at the top of the Library list or in the sidebar when a scan is active.

## Testing Strategy
- **Manual Test**: Connect a device with >1000 files. Verify progress bar increments smoothly.
- **Manual Test**: Close app, reopen while device is connected. Verify auto-connect fires.
- **Simulated Latency**: Use a mock USB bridge that returns 20 files every 1 second to verify UI responsiveness.
- **Race Condition Test**: Rapidly click "Refresh" during a 95s scan. Verify only one USB session is active.

## Dependencies & Risks
- **Risk**: `navigator.usb.getDevices()` might return empty if the browser permissions are cleared.
- **Risk**: A device disconnect during the 95s scan might leave the USB mutex in a "locked" state if not handled by `finally` blocks.

## Out of Scope
- Optimizing the actual Jensen protocol speed (hardware/firmware limit).
- Background syncing while the app is closed.
- Supporting non-HiDock USB devices.
