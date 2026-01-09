# Device Sync Component Specification

## 1. Component Overview
The **Device Sync** page (formerly `Device`) manages the connection to HiDock hardware (H1, H1E, P1). It handles USB connectivity, file synchronization, realtime audio streaming, and device-specific configuration.

### Vision alignment (do not mirror the current UI)
- Device Sync is an *ingestion and operations* surface: it moves device captures into the system as Sources.
- The UI should focus on outcomes (connected/not, synced/not, what’s new, what failed) rather than exposing internal service wiring.
- Device-originated files become immutable Sources once ingested; the user should be able to navigate into Library/Source detail from sync results.

## 2. Component Interface

### Props
Top-level route component.
```typescript
interface DeviceSyncProps {}
```

### State Management
| State Variable | Type | Description |
| :--- | :--- | :--- |
| `deviceState` | `HiDockDeviceState` | Core hardware info (Model, SN, Firmware, Storage). |
| `connectionStatus` | `StatusObject` | Step-by-step connection progress/error info. |
| `deviceFiles` | `HiDockRecording[]` | List of files currently on the device. |
| `syncing` | `boolean` | Indicates if a sync operation is active. |
| `downloadQueue` | `Map` | Tracks status of active file downloads. |
| `realtimeActive` | `boolean` | State of live audio streaming. |
| `batteryStatus` | `BatteryStatus` | (P1 Only) Battery level and charging status. |
| `activityLog` | `LogEntry[]` | Rolling log of USB operations for debugging. |

### Data Flow & Dependencies
-   **`DeviceService`**: Singleton handling WebUSB/PyUSB communication.
-   **`DownloadService`**: Global queue manager for file transfers.
-   **`AppStore`**: Global state for connection status and sync progress.
-   **`Config`**: Persists auto-connect/auto-download preferences.

## 3. Behavior & Interactions

### 3.1 Connection Lifecycle
-   **Connect**:
    1.  User clicks "Connect" or Auto-connect triggers.
    2.  Service handshakes with USB device.
    3.  On success: Fetches Device Info + File List.
-   **Disconnect**: Clears device state and stops polling.
-   **Auto-Connect**:
    -   Configurable option to connect on app startup.
    -   Re-connects if device is momentarily unplugged (if enabled).

### 3.2 Synchronization (Sync)
-   **Logic**:
    1.  **Diff**: Compares Device file list vs Local Database (Synced Files).
    2.  **Filter**: Identifies "New" files (on device, not in DB).
    3.  **Queue**: Adds new files to `DownloadService`.
-   **Progress**:
    -   Shows aggregate progress bar for bulk operations.
    -   Updates "Files Remaining" and ETA.
-   **Retry**: Explicit "Retry Failed" button if any downloads error out.

### 3.3 Realtime Streaming
-   **Purpose**: Live audio monitoring (e.g., testing mic).
-   **Purpose**: Live audio monitoring (e.g., testing mic); not a primary capture workflow.
-   **Format**: 16kHz 16-bit Mono (PCM).
-   **Visual**: Status indicator (Streaming/Paused/Idle) and "Bytes Received" counter.

### 3.4 Hardware Management (P1 Specific)
-   **Battery**: Polls battery status.
-   **Bluetooth**: Scans for BT devices (for wireless audio).

## 4. Design & Styling

### Layout
-   **Status Cards**: Grid layout showing Connection, Storage, and Counts.
-   **Action Area**: Big primary buttons for common tasks (Sync, Connect).
-   **Log Panel**: Collapsible terminal-like view for USB logs.

### Visual Feedback
-   **Connection**:
    -   **Idle**: Placeholder illustration.
    -   **Connecting**: Progress bar + Step text.
    -   **Connected**: Green status card with device details.
-   **Storage**: Visual bar chart for usage.

## 5. Accessibility (A11y)

### ARIA Roles
-   **Progress Bars**: `role="progressbar"` with `aria-valuenow`.
-   **Log**: `aria-label="Activity Log"`.

### Live Regions
-   **Status**: Connection errors or success messages should use `aria-live="polite"`.

## 6. Error Handling

| Scenario | UX Result | Recovery |
| :--- | :--- | :--- |
| **USB Busy** | "Connection Failed" error. | User instruction: "Close other apps using the device". |
| **Sync Interrupted** | "Download Failed" status. | "Retry" button appears. |
| **Device Reset** | Connection lost state. | Auto-reconnect attempts or manual "Connect". |
| **Timeout** | "Connection Timed Out". | "Retry" button. |

## 7. Testing Requirements

### Unit Tests
-   **Diff Logic**: Test `getFilesToSync` with various scenarios (empty DB, partial sync, full sync).
-   **ETA Formatting**: Verify time string formats.

### Integration Tests
-   **USB Mocking**: Mock `DeviceService` to simulate connection steps.
-   **Sync Flow**: Verify `handleSyncAll` correctly queues items to `DownloadService`.

### Hardware Tests
-   **Real Device**: Manual QA required for actual USB plug/unplug events and transfer speeds.

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/Device.tsx` (candidate rename: `DeviceSync.tsx`).
- Current service names referenced by the app: `DeviceService`, `DownloadService`, `AppStore`, `Config`.
