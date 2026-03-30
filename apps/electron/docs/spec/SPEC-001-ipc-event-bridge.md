# SPEC-001: IPC Event Bridge & Real-time Status Updates

## Problem Statement
HiDock Next relies on asynchronous background services (Download, Transcription) to process data. While the main process correctly emits IPC events during these operations, the `preload/index.ts` script lacks the necessary bridges to expose these listeners to the React renderer. Consequently, the UI remains static, failing to provide real-time progress, status updates, or completion notifications. This results in a "black box" user experience where operations appear to hang or fail silently.

## Bugs Addressed
| Bug ID | Summary | Severity |
|--------|---------|----------|
| **BUG-004** | Download silently queued with no user feedback | Medium |
| **BUG-005** | Download/Transcription status icons never update in real-time | High |
| **BUG-006** | No toast/pop-up notifications for completed operations | Medium |

## User Stories
1. **As a user**, I want to see a progress bar and status icon update immediately when I start downloading a recording from my HiDock device, so I know the transfer is actually happening.
2. **As a user**, I want to receive a toast notification when a long transcription job completes in the background, so I can immediately view the results without constantly checking the library.
3. **As a user**, I want the UI to reflect if a download or transcription fails due to a connection or API error, so I can take corrective action (like checking my internet or re-connecting the device).

## Current Behavior (Broken)
1. User clicks "Download" or "Transcribe".
2. Renderer invokes IPC (`download-service:start-session` or `recordings:transcribe`).
3. Main process receives request and begins background processing.
4. Main process emits `download-service:state-update` or `transcription:progress`.
5. **Preload script ignores these events** (no `ipcRenderer.on` listeners defined for these channels).
6. Renderer's `onStateUpdate` or `onTranscriptionProgress` callbacks are never triggered.
7. UI only updates if the user manually refreshes or if a low-frequency (5s) polling fallback hits.

## Expected Behavior (Target)
1. User initiates operation.
2. Main process emits status events.
3. **Preload script catches events** and forwards them to registered renderer callbacks.
4. `useDownloadOrchestrator` and `useTranscriptionSync` hooks receive updates instantly.
5. Zustand stores update, triggering reactive UI changes (progress bars, status badges).
6. Completion events trigger `toast.success()` or `toast.error()` in the renderer.

## Acceptance Criteria
1. `electron/preload/index.ts` MUST expose `onDownloadStateUpdate` within the `downloadService` namespace.
2. `electron/preload/index.ts` MUST expose all `onTranscription*` events (`started`, `progress`, `completed`, `failed`, `cancelled`) within the `recordings` or global namespace.
3. The `download-service:state-update` event MUST trigger a UI update in the sidebar/library within 300ms of emission (accounting for main process throttling).
4. Transcription progress MUST update the library status badge in real-time without requiring a 5s poll.
5. Every completed download session MUST trigger a toast notification via `download-service:notify-completion`.
6. Edge Case: If the renderer is reloaded during an active download, the preload script MUST correctly re-establish listeners upon mount.
7. Edge Case: If the main process service emits an error event, the toast notification MUST display the specific error message provided in the IPC payload.

## Technical Approach
### Architecture
The solution involves completing the IPC Bridge pattern. We will standardize the `onEvent(callback): unsubscribe` pattern in `preload/index.ts` to ensure clean lifecycle management in React hooks. The renderer hooks will be updated to prioritize these events over polling.

### Key Changes
- **`electron/preload/index.ts`**: Implement the missing listener bridges using `ipcRenderer.on` and return cleanup functions using `ipcRenderer.removeListener`.
- **`electron/main/services/download-service.ts`**: Verify `emitStateUpdate` correctly targets all windows (already implemented but needs verification of channel names).
- **`electron/main/services/transcription.ts`**: Ensure `notifyRenderer` uses the correct `mainWindow` reference.
- **`src/hooks/useDownloadOrchestrator.ts`**: Connect to the new `onStateUpdate` listener to sync the `useAppStore` queue.
- **`src/hooks/useTranscriptionSync.ts`**: Remove/Reduce polling dependency in favor of the new real-time event listeners.

### IPC Event Contract
| Event Name | Payload Shape | Direction | Trigger |
|------------|---------------|-----------|---------|
| `download-service:state-update` | `{ queue: DownloadItem[], session: Session \| null }` | Main → Renderer | Any download state change |
| `transcription:started` | `{ queueItemId?: string, recordingId: string }` | Main → Renderer | Transcription job begins |
| `transcription:progress` | `{ queueItemId: string, progress: number, stage: string }` | Main → Renderer | Ticker or API progress update |
| `transcription:completed` | `{ queueItemId?: string, recordingId: string }` | Main → Renderer | Job finished successfully |
| `transcription:failed` | `{ queueItemId?: string, recordingId: string, error: string }` | Main → Renderer | Job failed with error |

## UI/UX Requirements
- **Immediate Feedback**: Icons MUST transition from "Cloud" (Device) to "Downloading" (Spinner/Progress) immediately upon click.
- **Toasts**: Success toasts should be green (`variant: 'success'`), error toasts red (`variant: 'destructive'`).
- **Persistence**: If a user navigates away from the Library and back, the status MUST still be accurate (synced from Main via initial `getState` call).

## Testing Strategy
1. **Manual Verification**:
   - Start a batch download of 5+ files. Observe sidebar progress.
   - Disconnect USB during download. Observe "Failed" status and error toast.
   - Start transcription. Observe progress % incrementing in Library view.
2. **Automated Testing**:
   - Unit test for `preload/index.ts` listener registration (using mocks).
   - Integration test: Mock `ipcMain.send` and verify renderer-side store updates.

## Dependencies & Risks
- **Dependency**: Requires `mainWindow` to be correctly set in services via `setMainWindowForTranscription`.
- **Risk**: IPC spam from high-frequency progress updates. *Mitigation*: Main process already implements a 250ms throttle for downloads.

## Out of Scope
- Implementing the actual USB transfer logic (existing).
- Implementing the AI transcription engine (existing).
- Redesigning the Library UI (only functional status updates covered).
