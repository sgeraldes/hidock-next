# USB Device Pipeline — Design Specification

> **Why this matters (ADR-0005).** Four device bugs fixed in 2026-06 — auto-connect
> and auto-transcribe ignoring their toggles, the DL-button double-fire, and the
> download size-mismatch — were traced (via `graphify-out/`) to one root: device
> actions have multiple entry points and policy is enforced at scattered call
> sites instead of one funnel. This pipeline is the structural cure. See
> `.claude/architecture-decisions/ADR-0005-device-actions-flow-through-coordinators.md`.

## Problem

The HiDock Electron app has 4 independent systems competing for the USB bus:
- `handleConnect()` in hidock-device.ts — init sequence
- `useDeviceSubscriptions.ts` — auto-sync (file list + reconciliation)
- `useDownloadOrchestrator.ts` — download queue processing
- `useUnifiedRecordings.ts` — UI data loading triggering USB operations

These systems don't coordinate intent, priority, or timing. The Jensen command queue serializes at the protocol level, but callers interleave freely — causing stalls, corrupted responses, duplicate scans, and stuck UI states.

## Solution

A single `DevicePipelineService` in the **main process** that owns all USB operations. WebUSB moves from the renderer to main via `node-usb`'s WebUSB-compatible API. The renderer becomes a pure UI subscriber with no USB access.

## Architecture

```
MAIN PROCESS                              RENDERER
─────────────────────────────────         ─────────────────

  node-usb (WebUSB API)                   React UI
       ↓                                      ↑
  JensenDevice                            useDevicePipeline()
  (protocol layer,                        (single hook, subscribes
   moved from renderer)                    to IPC state updates)
       ↓                                      ↑
  DevicePipelineService ──── IPC ─────────────┘
  (coordinator — owns
   the full sequence)
       ↓
  DownloadService
  (already in main,
   stays as-is)
       ↓
  emit file:downloaded
       ↓
  RecordingWatcher → Transcription → CalendarSync → etc.
```

## Pipeline Phases

```typescript
type PipelinePhase =
  | 'disconnected'     // No device
  | 'connecting'       // USB open + interface claim
  | 'initializing'     // Device info, storage, file count, settings, time sync
  | 'scanning'         // File list (skipped if count unchanged from cache)
  | 'reconciling'      // Compare device vs local DB (CPU only, no USB)
  | 'downloading'      // Sequential file transfers, one at a time
  | 'idle'             // Connected, synced, waiting for events
  | 'error'            // Unrecoverable — needs reconnect
```

### Phase Rules

- Transitions are **strictly linear**: each phase completes before the next starts
- **No USB interleaving** is possible — the pipeline is the sole USB caller
- SCAN is **skipped** if device file count matches cache (no USB command needed)
- DOWNLOAD processes files **one at a time**, sequentially
- After each download completes, a `file:downloaded` event is emitted for post-processing (transcription, calendar sync, etc.)
- If device file count changes during DOWNLOAD (new recording detected), finish current download, then re-enter SCAN
- User actions (disconnect, cancel, format) interrupt the current phase and reset appropriately

### Phase Sequence on Connect

```
CONNECT → INIT → SCAN → RECONCILE → DOWNLOAD → IDLE
              ↓
          (all commands     (skip if count    (CPU only)   (sequential,
           fail? reset      unchanged)                     one at a time)
           + retry once,
           else disconnect)
```

## Components

### 1. JensenDevice (moved to main process)

**File:** `electron/main/services/jensen.ts` (moved from `src/services/jensen.ts`)

**Changes from current:**
- Replace `navigator.usb` with `node-usb` WebUSB API:
  ```typescript
  import { WebUSB } from 'usb'
  const webusb = new WebUSB({ allowAllDevices: true })
  // All other API calls (getDevices, open, transferIn, transferOut,
  // claimInterface, etc.) use the same WebUSB interface
  ```
- Remove `shouldLogQa()` gating — main process logs unconditionally
- Device picker (`requestDevice` with UI prompt) uses Electron's `select-usb-device` session event to show the picker in the renderer window
- Everything else stays identical: protocol framing, command queue, carry buffer, handlers, packet parsing

**Public API (unchanged):**
- `connect(signal?)`, `tryConnect(device?)`, `disconnect()`, `reset()`
- `getDeviceInfo()`, `getCardInfo()`, `getFileCount()`, `getSettings()`, `setTime()`
- `listFiles(onProgress?, expectedCount?, onNewFiles?)`
- `downloadFile(filename, size, onChunk, onProgress?, signal?)`
- `deleteFile(filename)`, `formatCard()`
- `setAutoRecord(enabled)`
- `isConnected()`, `getModel()`, `isOperationInProgress()`

### 2. DevicePipelineService (new — the coordinator)

**File:** `electron/main/services/device-pipeline.ts`

**Responsibilities:**
- Owns the JensenDevice instance
- Runs the phase sequence on connect
- Delegates downloads to DownloadService
- Manages all device state (info, storage, file list, cache)
- Emits state updates to renderer via IPC
- Handles user actions (connect, disconnect, sync, cancel, delete, format)

**State:**

```typescript
interface PipelineState {
  phase: PipelinePhase
  device: {
    model: DeviceModel
    serialNumber: string | null
    firmwareVersion: string | null
    storage: { used: number; capacity: number; freePercent: number } | null
    settings: { autoRecord: boolean } | null
    recordingCount: number
  } | null
  scanProgress: { current: number; total: number } | null
  downloadProgress: {
    filename: string
    current: number
    total: number
    bytesDownloaded: number
    totalBytes: number
    eta: number | null
  } | null
  error: string | null
}
```

**Core method:**

```typescript
class DevicePipelineService {
  private jensen: JensenDevice
  private downloadService: DownloadService
  private phase: PipelinePhase = 'disconnected'
  private cachedFiles: FileInfo[] | null = null
  private cachedFileCount: number = -1
  private abortController: AbortController | null = null

  async runPipeline(): Promise<void> {
    // INIT
    this.setPhase('initializing')
    const initOk = await this.initialize()
    if (!initOk) {
      await this.handleInitFailure()  // reset + retry, then disconnect
      return
    }

    // SCAN (skip if count unchanged)
    if (this.shouldScan()) {
      this.setPhase('scanning')
      this.cachedFiles = await this.scanFiles()
      this.cachedFileCount = this.state.device!.recordingCount
    }

    // RECONCILE
    this.setPhase('reconciling')
    const toDownload = await this.reconcile(this.cachedFiles!)

    // DOWNLOAD
    if (toDownload.length > 0) {
      this.setPhase('downloading')
      await this.downloadAll(toDownload)
    }

    this.setPhase('idle')
  }

  private shouldScan(): boolean {
    const deviceCount = this.state.device?.recordingCount ?? 0
    return this.cachedFiles === null
      || this.cachedFileCount !== deviceCount
      || deviceCount === 0
  }

  private async downloadAll(files: DownloadItem[]): Promise<void> {
    for (const file of files) {
      if (this.abortController?.signal.aborted) break
      if (!this.jensen.isConnected()) break

      await this.downloadOne(file)
      // file:downloaded event emitted inside downloadOne
      // Post-processing (transcription, calendar) is triggered
      // by RecordingWatcher detecting the new file on disk
    }
  }

  // User actions
  async connect(): Promise<void>          // → runPipeline()
  async disconnect(): Promise<void>       // abort + jensen.disconnect()
  async manualSync(): Promise<void>       // abort downloads → re-SCAN
  async cancelDownloads(): Promise<void>  // abort downloads → IDLE
  async deleteFile(f: string): Promise<void>  // direct Jensen command
  async formatDevice(): Promise<void>     // format → re-SCAN
}
```

**Init failure handling:**
1. If all init commands fail → USB reset → reconnect → retry pipeline once
2. If still failing → disconnect cleanly → phase = 'error' with message "Please unplug and reconnect"

**Auto-connect:** see the [Auto-Connect Flow](#auto-connect-flow) section — the
plug-event handler re-checks `config.device.autoConnect` at event time.

**Single-funnel invariants (ADR-0005).** Each device action has exactly one
initiator, and each user setting is enforced once, at that funnel:
- **Downloads:** every download — Sync *and* the per-file DL button — goes
  through `DevicePipelineService`/`DownloadService`. There is no direct
  `storage:save-recording` download path. One queue, one integrity check, one
  progress/state. (Interim DL guard: commit `eccbeab8`.)
- **Transcription:** exactly **one** ingestion funnel queues transcription —
  `RecordingWatcher` detecting the saved file on disk. `download-service` and
  `storage:save-recording` must **not** call `addToQueue`; the auto-transcribe
  preference is checked only in that one place. (Interim duplicate-gate fix:
  commit `11ce9830`.)
- **State:** authoritative download/connection/device state lives in main
  (`PipelineState`) and is projected to the renderer via one subscription; the
  renderer holds no second queue or connection FSM.

### 3. IPC Contract

**State updates (main → renderer) — frequent, small:**

```typescript
// Channel: 'device-pipeline:state'
// Emitted on every phase change, progress update, or state mutation
// Payload: PipelineState (see above)
```

**File list (main → renderer) — infrequent, large:**

```typescript
// Channel: 'device-pipeline:files'
// Emitted once after SCAN completes
// Payload: FileInfo[] (full file list with metadata)
```

**Activity log (main → renderer) — ongoing:**

```typescript
// Channel: 'device-pipeline:activity'
// Emitted for every USB operation, status change, error
// Payload: { type, message, details, timestamp }
// (Same ActivityLogEntry format as current)
```

**User actions (renderer → main):**

```typescript
// All use ipcMain.handle (request/response)
'device-pipeline:connect'        → Promise<boolean>
'device-pipeline:disconnect'     → Promise<void>
'device-pipeline:sync'           → Promise<void>
'device-pipeline:cancel'         → Promise<void>
'device-pipeline:delete-file'    → Promise<{ result: string }>
'device-pipeline:format'         → Promise<boolean>
'device-pipeline:set-auto-record' → Promise<boolean>
'device-pipeline:get-state'      → Promise<PipelineState>
'device-pipeline:get-files'      → Promise<FileInfo[]>
```

### 4. Renderer Hook

**File:** `src/hooks/useDevicePipeline.ts`

Single hook replaces `useDeviceSubscriptions`, `useDownloadOrchestrator`, and the device-related parts of `useUnifiedRecordings`:

```typescript
export function useDevicePipeline() {
  const [state, setState] = useState<PipelineState>(initialState)
  const [files, setFiles] = useState<FileInfo[]>([])

  useEffect(() => {
    // Subscribe to state updates
    const unsubState = window.electronAPI.devicePipeline.onState(setState)
    const unsubFiles = window.electronAPI.devicePipeline.onFiles(setFiles)

    // Get initial state
    window.electronAPI.devicePipeline.getState().then(setState)
    window.electronAPI.devicePipeline.getFiles().then(setFiles)

    return () => { unsubState(); unsubFiles() }
  }, [])

  return {
    // State
    phase: state.phase,
    device: state.device,
    scanProgress: state.scanProgress,
    downloadProgress: state.downloadProgress,
    error: state.error,
    files,

    // Derived
    isConnected: state.phase !== 'disconnected' && state.phase !== 'error',
    isScanning: state.phase === 'scanning',
    isDownloading: state.phase === 'downloading',
    isBusy: !['disconnected', 'idle', 'error'].includes(state.phase),

    // Actions
    connect: () => window.electronAPI.devicePipeline.connect(),
    disconnect: () => window.electronAPI.devicePipeline.disconnect(),
    sync: () => window.electronAPI.devicePipeline.sync(),
    cancel: () => window.electronAPI.devicePipeline.cancel(),
    deleteFile: (f: string) => window.electronAPI.devicePipeline.deleteFile(f),
    format: () => window.electronAPI.devicePipeline.format(),
    setAutoRecord: (v: boolean) => window.electronAPI.devicePipeline.setAutoRecord(v),
  }
}
```

### 5. Preload Bridge

**File:** `electron/preload/index.ts` — add `devicePipeline` section:

```typescript
devicePipeline: {
  connect: () => ipcRenderer.invoke('device-pipeline:connect'),
  disconnect: () => ipcRenderer.invoke('device-pipeline:disconnect'),
  sync: () => ipcRenderer.invoke('device-pipeline:sync'),
  cancel: () => ipcRenderer.invoke('device-pipeline:cancel'),
  deleteFile: (f: string) => ipcRenderer.invoke('device-pipeline:delete-file', f),
  format: () => ipcRenderer.invoke('device-pipeline:format'),
  setAutoRecord: (v: boolean) => ipcRenderer.invoke('device-pipeline:set-auto-record', v),
  getState: () => ipcRenderer.invoke('device-pipeline:get-state'),
  getFiles: () => ipcRenderer.invoke('device-pipeline:get-files'),
  onState: (cb: (state: PipelineState) => void) => {
    const handler = (_: any, state: PipelineState) => cb(state)
    ipcRenderer.on('device-pipeline:state', handler)
    return () => ipcRenderer.removeListener('device-pipeline:state', handler)
  },
  onFiles: (cb: (files: FileInfo[]) => void) => {
    const handler = (_: any, files: FileInfo[]) => cb(files)
    ipcRenderer.on('device-pipeline:files', handler)
    return () => ipcRenderer.removeListener('device-pipeline:files', handler)
  },
  onActivity: (cb: (entry: ActivityLogEntry) => void) => {
    const handler = (_: any, entry: ActivityLogEntry) => cb(entry)
    ipcRenderer.on('device-pipeline:activity', handler)
    return () => ipcRenderer.removeListener('device-pipeline:activity', handler)
  },
}
```

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `electron/main/services/device-pipeline.ts` | Pipeline coordinator |
| `electron/main/services/jensen.ts` | Jensen protocol (moved from renderer) |
| `electron/main/ipc/device-pipeline-handlers.ts` | IPC handler registration |
| `src/hooks/useDevicePipeline.ts` | Single renderer hook |

### Deleted Files

| File | Replaced By |
|------|-------------|
| `src/services/hidock-device.ts` | DevicePipelineService |
| `src/services/jensen.ts` | electron/main/services/jensen.ts |
| `src/hooks/useDeviceSubscriptions.ts` | useDevicePipeline |
| `src/hooks/useDownloadOrchestrator.ts` | DevicePipelineService.downloadAll() |
| `src/utils/autoSyncGuard.ts` | Pipeline phase logic |

### Modified Files

| File | Change |
|------|--------|
| `electron/preload/index.ts` | Add `devicePipeline` bridge |
| `electron/main/ipc/handlers.ts` | Register device-pipeline handlers |
| `electron/main/index.ts` | Create DevicePipelineService, remove renderer WebUSB permissions |
| `src/hooks/useUnifiedRecordings.ts` | Remove USB calls, subscribe to pipeline files instead |
| `src/store/useAppStore.ts` | Simplify device state (fed by pipeline) |
| `src/pages/Device.tsx` (or Sync page) | Use useDevicePipeline instead of multiple hooks |
| `src/components/layout/Layout.tsx` | Use useDevicePipeline for sidebar status |
| `package.json` | Add `usb` dependency |

### Unchanged Files

| File | Why |
|------|-----|
| `electron/main/services/download-service.ts` | Pipeline delegates to it |
| `electron/main/services/database.ts` | No USB involvement |
| `electron/main/services/recording-watcher.ts` | Triggers on file:downloaded |
| `electron/main/services/transcription.ts` | Post-download processing |
| `electron/main/services/calendar-sync.ts` | Post-download processing |

## USB Device Picker Handling

In the renderer, `navigator.usb.requestDevice()` shows a browser-native picker. In the main process with `node-usb`, there's no UI.

**Solution:** Use Electron's `select-usb-device` session event:

```typescript
// In electron/main/index.ts
session.defaultSession.on('select-usb-device', (event, details, callback) => {
  // This fires when requestDevice() is called
  // We can auto-select if only one HiDock device, or show a custom picker
  const hidockDevice = details.deviceList.find(d =>
    USB_VENDOR_IDS.includes(d.vendorId)
  )
  if (hidockDevice) {
    callback(hidockDevice.deviceId)
  } else {
    callback()  // No device selected
  }
})
```

For `tryConnect()` (auto-connect with previously authorized device), `node-usb`'s `webusb.getDevices()` returns authorized devices without needing a picker.

## Auto-Connect Flow

**Policy is checked at event time, not at registration.** The earlier
implementation registered the USB-plug listener only when auto-connect was on at
startup, and the listener then auto-connected on every plug **without
re-reading the preference** — so toggling auto-connect off did not stop power-on
reconnects (shipped interim fix: `setAutoConnectChecker`, commit `25d6c22e`; see
ADR-0005 category C). The listener must always be registered and must consult
`config.device.autoConnect` **inside** the handler, every time it fires.

```typescript
// In DevicePipelineService constructor or init
async initAutoConnect(): Promise<void> {
  // The plug/disconnect listeners are ALWAYS registered. The auto-connect
  // PREFERENCE is re-checked at event time so toggling it takes effect live.
  this.webusb.addEventListener('connect', (event) => {
    if (!isHiDockDevice(event.device)) return
    if (!getConfig().device?.autoConnect) return  // ← event-time policy gate
    this.connect(event.device)                     // → runPipeline()
  })

  this.webusb.addEventListener('disconnect', (event) => {
    if (event.device === this.jensen.getDevice()) {
      this.handleDisconnect()
    }
  })

  // Startup: only auto-connect to an already-attached device if enabled now.
  if (!getConfig().device?.autoConnect) return
  const devices = await this.webusb.getDevices()
  const hidock = devices.find(d => isHiDockDevice(d))
  if (hidock) await this.connect(hidock)  // → runPipeline()
}
```

Manual connect (the "Connect Device" button → `connect()`) never passes through
this gate, so it always works regardless of the preference.

## Error Handling

| Scenario | Pipeline Response |
|----------|-------------------|
| Init: all commands fail | USB reset → retry once → disconnect if still failing |
| Init: partial success (1-3 commands timeout) | Continue with available data, warn in UI |
| Scan: timeout (120s) | Return partial results, continue to RECONCILE |
| Scan: null response | Return empty, skip to IDLE |
| Download: USB transfer fails | Mark failed, continue to next file |
| Download: stall detected (60s no progress) | Abort transfer, mark failed, continue next |
| Download: device disconnects | Abort all, phase = 'disconnected' |
| User: clicks disconnect during download | Abort download, disconnect cleanly |
| User: clicks cancel during download | Abort downloads, phase = 'idle' |
| USB: read loop dies | Log warning, continue (next command restarts it) |
| USB: decode error | Return partial results from handler, unblock queue |

## Testing Strategy

### Unit Tests
- Pipeline phase transitions (each phase → next, error handling)
- Cache validity logic (shouldScan)
- Reconciliation (device files vs local DB)
- IPC contract (state shape, event payloads)

### Integration Tests
- Full pipeline run with mocked JensenDevice
- Disconnect during each phase
- Cancel during downloads
- Init failure → reset → retry
- Auto-connect flow

### Manual Testing
- Connect device → verify init → scan → download sequence
- Unplug during download → verify clean state
- App restart with pending downloads → verify no stale state
- Multiple connect/disconnect cycles → verify no leaks

## Dependencies

**New npm dependency:**
```json
{
  "usb": "^2.13.0"
}
```

The `usb` package requires native compilation. electron-builder handles this via `rebuild`. May need `electron-rebuild` for dev mode.

**Platform notes:**
- Windows: WinUSB driver (already working for WebUSB)
- macOS: libusb (auto-installed by usb package)
- Linux: libusb-1.0 + udev rules (existing setup script handles this)

---

## Phased Rollout (added 2026-06-25)

Sequenced so each slice is independently shippable, leaves the tree green, and
the USB-locking blast radius is contained. Motivated by ADR-0005 and the live
"download one → downloads all 52" bug (one global queue with drain-all-on-pending
semantics; `useDownloadOrchestrator` line 377 → `processDownloadQueue` line 184).

**Acceptance criteria (the defects that must die):**
1. Download exactly what's requested — selecting 1 file downloads 1, regardless of what else is pending.
2. auto-connect / auto-download / auto-transcribe each honored, checked at action time, in one place.
3. One queue, one progress/state, projected read-only to the renderer.
4. No binary round-trips the renderer.

**Verification policy (overnight constraint):** USB-flow slices are gated by the
mock test harness + typecheck + full build + full Vitest suite (+ app boot smoke
where safe). **Live hardware verification is DEFERRED** to a supervised session
(one clean connect, power-cycle available) — never run unattended (device-safety
rules in CLAUDE.md override). Each slice's QA notes carry a `HARDWARE: DEFERRED` stamp.

### Slice 0 — Safety net (test-only, no behavior change)
- Mock WebUSB/Jensen harness reusable across services (no hardware in tests).
- Characterization tests pinning current connect / scan / download / transcribe behavior.
- **Files:** `electron/main/services/__tests__/*`, test utils.

### Slice 1 — Scoped downloads + queue hygiene (fixes the P0 "downloads all" bug)
- `DownloadService.requestDownloads(files)` is the single entry; `processDownloadQueue(scope?)` downloads only the requested filenames.
- Auto-resume of persisted pending gated by `config.device.autoDownload`; prune stale/orphaned queue rows on load.
- Manual Sync / Download-selected / single / DL button all route through the scoped entry.
- **Files:** `download-service.ts`, `useDownloadOrchestrator.ts`, `useOperations.ts`, `Library.tsx`, `DeviceFileList.tsx`.

### Slice 2 — Single ingestion funnel (fixes auto-transcribe duplication)
- `RecordingWatcher` becomes the sole post-save → transcription funnel; remove `addToQueue` from `download-service` and `storage:save-recording`. `autoTranscribe` checked once.
- **Files:** `recording-watcher.ts`, `download-service.ts`, `storage-handlers.ts`.

### Slice 3 — DevicePipelineService coordinator (main)
- One owner of `JensenDevice` + `DownloadService`; connect→scan→reconcile→download phase machine; auto-connect plug handler re-checks config at event time. Becomes the sole initiator, replacing the 4 competing renderer callers.
- **Files:** new `device-pipeline.ts`, `index.ts`, `jensen.ts`, ipc handlers.

### Slice 4 — Single state projection
- `PipelineState` in main is authoritative; renderer subscribes via one channel; no second queue/FSM in the renderer. Removes the reload "stuck connecting" desync + dual download-queue.
- **Files:** `device-pipeline.ts`, `hidock-device.ts`, `useDeviceSubscriptions.ts`, `useDownloadOrchestrator.ts`, `useAppStore.ts`.

### Slice 5 — Binary stays in main
- Download + save in one main pass; renderer gets progress events only. Removes the chunk-drain workaround in `jensen-ipc-client.ts`.
- **Files:** `device-pipeline.ts`, `download-service.ts`, `jensen-handlers.ts`, `jensen-ipc-client.ts`.

### Slice 6 — Delete dead paths + interim patches
- Retire the renderer auto-connect cluster on `HiDockDeviceService`, the direct `storage:save-recording` download path, and the interim patches (`cfdeb3fa`/`25d6c22e`/`11ce9830`/`eccbeab8`) once their slice subsumes them.

**Disposition of interim patches:** keep each until its slice subsumes it (Slice 1 ⊃ DL guard; Slice 2 ⊃ auto-transcribe gate; Slice 3 ⊃ auto-connect checker; Slice 5 ⊃ chunk drain).
