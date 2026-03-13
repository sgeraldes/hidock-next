# SPEC-004: Auto-Download & Auto-Transcribe Pipeline

## Problem Statement
The HiDock Next Electron application currently features user settings for `autoDownload` and `autoTranscribe`, but these settings are not integrated into the backend logic. 
- **BUG-007**: When a HiDock device is connected, the application does not automatically trigger the download of new recordings even if `autoDownload` is enabled.
- **BUG-008**: When a file is successfully downloaded from a device, it does not automatically enter the transcription queue even if `autoTranscribe` is enabled. 
The pipeline is fragmented, requiring manual user intervention at each step, which defeats the purpose of the "Universal Knowledge Hub" automation vision.

## Bugs Addressed
| Bug ID | Summary | Severity |
|--------|---------|----------|
| **BUG-007** | Auto-download not working upon device connection | High (P1) |
| **BUG-008** | Auto-transcribe not triggered for downloaded files | High (P1) |

## User Stories
1. **As a user**, I want my recordings to start downloading automatically as soon as I plug in my HiDock device, so I don't have to manually select and sync files every time.
2. **As a user**, I want the app to start transcribing my new recordings as soon as they reach my computer, so the insights are ready for me to review without delay.
3. **As a user with many files (60+)**, I want the auto-download process to be efficient and stable, not crashing my USB connection or freezing the UI.

## Current Behavior (Broken)
1. Device connects. `DeviceService` detects it, but `DownloadService` remains idle.
2. User must navigate to the "Device" page and manually click "Sync" or "Download".
3. Once a download completes, the file sits in the local storage.
4. `RecordingWatcher` only watches for *manually* added files in the filesystem to suggest transcription, but it does not receive a direct signal from `DownloadService`.
5. User must manually click "Transcribe" for each downloaded file or wait for the watcher to eventually detect it (which is unreliable for synced files).

## Expected Behavior (Target)
1. **Trigger**: Device connection event is detected by `DeviceService`.
2. **Auto-Download**: 
   - `PipelineManager` (new service) checks `config.device.autoDownload`.
   - If `true`, it requests `DownloadService` to scan for new files and queue them.
3. **Auto-Transcribe**:
   - `DownloadService` emits a `DOWNLOAD_COMPLETED` event for each file.
   - `PipelineManager` catches this event and checks `config.transcription.autoTranscribe`.
   - If `true`, it adds the file to the `TranscriptionService` queue.
4. **Completion**: User receives a notification when the entire pipeline (Download -> Transcribe) finishes for a batch.

## Acceptance Criteria
1. **Automatic Trigger**: Connecting a HiDock device MUST trigger a sync check within 2 seconds.
2. **Config Respect**: The pipeline MUST NOT start if the respective `autoDownload` or `autoTranscribe` flags are `false`.
3. **Batch Handling**:
   - The system MUST handle up to 100 files in the queue without losing connection.
   - Concurrency for USB downloads MUST be limited to **1 file at a time** (Jensen protocol limitation).
   - Concurrency for transcription MUST follow the `TranscriptionService`'s existing limits (default 2-3 simultaneous API calls).
4. **Error Recovery**:
   - If a download fails, the pipeline MUST retry up to 3 times before skipping the file.
   - If a transcription fails (e.g., API limit), it MUST remain in the queue with an "Error" state for manual retry.
6. **UI Synchronization**:
   - All automated transitions MUST be reflected in the UI in real-time via SPEC-001 IPC events.
   - The "Sync" button in the UI MUST reflect the "Auto-Syncing" state if triggered automatically.

## Technical Approach

### Architecture
We will introduce a `PipelineManager` service in the main process to orchestrate the flow between `DeviceService`, `DownloadService`, and `TranscriptionService`. This avoids circular dependencies between the services.

### Key Changes

- **`PipelineManager` (New Service)**:
  - Listens to `DeviceService` for `device:connected`.
  - Listens to `DownloadService` for `file:downloaded`.
  - Orchestrates the logic: `Device Connect -> Download -> Transcribe`.

- **`electron/main/services/download-service.ts`**:
  - Add an internal `EventEmitter` to signal when a file download is finished.
  - Expose a `checkForNewFiles()` method that can be called by the `PipelineManager`.

- **`electron/main/services/device-service.ts`**:
  - Ensure it emits an internal event when a connection is established and the file list is retrieved.

- **`electron/main/services/transcription.ts`**:
  - Ensure the `addToQueue` method is robust and handles duplicates (files already in queue).

### Event Chain
1. `DeviceService` -> emits `device:ready` (internal).
2. `PipelineManager` -> catches `device:ready` -> checks `config.autoDownload`.
3. `PipelineManager` -> calls `DownloadService.syncNewFiles()`.
4. `DownloadService` -> emits `download:file-success` (internal) for each file.
5. `PipelineManager` -> catches `download:file-success` -> checks `config.autoTranscribe`.
6. `PipelineManager` -> calls `TranscriptionService.enqueue(file)`.

### IPC Event Contract (Extensions)
| Event Name | Payload Shape | Direction | Trigger |
|------------|---------------|-----------|---------|
| `pipeline:status` | `{ stage: 'downloading' \| 'transcribing', progress: number }` | Main → Renderer | Pipeline step change |
| `pipeline:complete` | `{ downloaded: number, transcribed: number }` | Main → Renderer | All automated tasks finished |

## Batch Operations & Concurrency
- **Prioritization**: Newest files (by date) should be downloaded first.
- **USB Limit**: Jensen protocol only supports one active transfer session. The `DownloadService` queue manager must enforce this strictly.
- **Resource Management**: Auto-transcribe should be throttled to avoid hitting Gemini/OpenAI rate limits during large batch syncs.

## Error Recovery & Retry Logic
- **USB Disconnect**: If the device is unplugged during auto-download, the `PipelineManager` must pause the queue and mark pending items as "Paused/Interrupted".
- **Network Error**: If transcription fails due to network, it should wait 30 seconds and retry once.
- **Persistence**: The queue state MUST be persisted in SQLite (`transcription_queue` and `synced_files`) so that if the app restarts, it can resume.

## Dependencies & Risks
- **Dependency**: Relies on SPEC-001 for real-time UI updates.
- **Risk**: USB bandwidth saturation if other operations are happening.
- **Risk**: Rate limiting on AI providers during large batch auto-transcriptions.

## Out of Scope
- Auto-deleting files from the device after download (this should always be manual for safety).
- Auto-summarization (this belongs in SPEC-006).
