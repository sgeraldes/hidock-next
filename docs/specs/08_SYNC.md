# Sync Specification

**Version:** 1.1 (2025-12-29)
**Module:** Device Management (Ingestion path)
**Screen / Route:** Sync (`/sync`)
**Component:** `apps/electron/src/pages/Device.tsx`
**References:** [11_CONCEPTUAL_FRAMEWORK.md](./11_CONCEPTUAL_FRAMEWORK.md), [01_LIBRARY.md](./01_LIBRARY.md)
**Screenshot:** ![Sync View](../qa/screenshots/sync_master.png)

## 1. Overview
Sync covers the **Legacy Device Management** functionality. It handles the physical connection to HiDock hardware, file transfer, and storage cleanup.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Connection Status** | Status Indicator | Plug/Unplug USB | Updates to "Connected (H1E)" or "Disconnected". | "Device Status" panel. |
| **Storage Bar** | Progress Bar | View | Shows used/free space on device. | "Storage: X GB / Y GB". |
| **Sync All** | "Sync [N] Recordings" | Click | Queues all new files for download. Shows global progress. | "Quick Actions - Sync All New". |
| **Auto-Settings** | Toggles | Click | Enables/Disables "Auto-connect", "Auto-download", "Auto-transcribe". | "Auto-Sync Settings". |
| **Activity Log** | Log Console | View | Displays real-time protocol events (Connect, Handshake, File Transfer). | Debugging visibility. |

---

## 2. Component Specification

### 2.1 State Management
| State Variable | Type | Description | Persistence |
| :--- | :--- | :--- | :--- |
| `connecting` | `boolean` | Connection attempt in progress. | Local |
| `recordings` | `HiDockRecording[]` | File list from device. | Local |
| `syncing` | `boolean` | Sync operation active. | Local |
| `downloadProgress` | `object` | Current file bytes/percent. | Local |
| `logExpanded` | `boolean` | Activity log visibility. | Local |
| `autoConnectConfig` | `object` | Settings for auto-connect behavior. | Local (Init from Service) |

### 2.2 Lifecycle & Events
*   **Mount:** Loads `syncedFilenames` from DB -> Configures `autoConnect` from store -> Checks `downloadService` state.
*   **Connection Change:** Listener updates `deviceState` -> Triggers `loadRecordings`.
*   **Unmount:** Cleans up listeners. `App.tsx` handles disconnect on window close.

---

## 3. Detailed Behavior

### 3.1 Device Connection
*   **Manual:** Click "Connect" -> `deviceService.connect()`.
*   **Auto:** Service polls USB bus. If authorized device found -> Connects automatically.
*   **Timeout:** Connection attempt fails after 15s (`CONNECTION_TIMEOUT_MS`).

### 3.2 Sync Logic
*   **Trigger:** Manual "Sync All" or Auto-Download logic.
*   **Flow:**
    1.  `downloadService.getFilesToSync(recordings)` -> Filters duplicates.
    2.  `downloadService.queueDownloads(files)` -> Adds to background queue.
    3.  `toast` notification ("Queued N files").
*   **Progress:** Updates via `onDownloadProgress` listener.

### 3.3 Realtime Streaming
*   **Action:** Click "Start" in Realtime Card.
*   **Flow:** `deviceService.startRealtime()` -> Polls buffer every 100ms.
*   **Outcome:** "Received: X KB" counter updates.

---

## 4. API Contracts

### `HiDockRecording` (Hardware Entity)
```typescript
interface HiDockRecording {
  filename: string; // e.g., "20231225_143000.wav"
  size: number;     // Bytes
  duration: number; // Seconds
  dateCreated: Date;
}
```

### IPC Methods
*   `downloadService.getState()`: Checks queue status.
*   `downloadService.queueDownloads(files[])`: Adds jobs.
*   `syncedFiles.getFilenames()`: Returns set of already downloaded files.
*   `config.get()`: Loads user preferences.

---

## 5. Error Handling

*   **Connection Failed:** "Connection timed out" or "Device in use" error message.
*   **Sync Error:** "Sync failed: [Reason]" Toast.
*   **Retry:** "Retry Failed Downloads" button appears if failures exist.

---

## 6. Accessibility & Styling

*   **Log:** Monospace font, auto-scrolls to bottom.
*   **Status Colors:**
    *   **Green:** Connected/Success.
    *   **Red:** Disconnected/Error.
    *   **Blue:** USB Out.
    *   **Purple:** USB In.

---

## 7. Testing Strategy

### Integration Tests
*   **Connect:** Mock `deviceService.connect` -> Verify UI updates to "Connected".
*   **Sync:** Mock `listRecordings` -> Click Sync -> Verify `queueDownloads` called.
*   **Log:** Trigger an action -> Verify log entry added to `activityLog`.

### Performance
*   **File List:** Load 1000 files < 1s (Paginated protocol).
*   **Log:** Cap at 100 entries to prevent DOM lag.