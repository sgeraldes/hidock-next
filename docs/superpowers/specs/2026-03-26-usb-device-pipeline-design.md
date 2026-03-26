# USB Device Pipeline — Design Specification

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

**Auto-connect:**
- On app startup, if config has `device.autoConnect = true`, call `tryConnect()`
- On USB plug event (`usb` package device-added event), attempt `tryConnect()`
- On disconnect, if auto-connect enabled, listen for re-plug

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

```typescript
// In DevicePipelineService constructor or init
async initAutoConnect(): Promise<void> {
  const config = getConfig()
  if (!config.device?.autoConnect) return

  // Try connecting to any authorized HiDock device
  const devices = await this.webusb.getDevices()
  const hidock = devices.find(d => isHiDockDevice(d))
  if (hidock) {
    await this.connect(hidock)  // → runPipeline()
  }

  // Listen for USB plug events
  this.webusb.addEventListener('connect', (event) => {
    if (isHiDockDevice(event.device)) {
      this.connect(event.device)
    }
  })

  this.webusb.addEventListener('disconnect', (event) => {
    if (event.device === this.jensen.getDevice()) {
      this.handleDisconnect()
    }
  })
}
```

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
