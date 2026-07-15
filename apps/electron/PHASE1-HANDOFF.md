# Download Cancellation — Phase 1 Handoff (backend / protocol + main process)

Phase 1 makes download cancellation **actually work and be USB-safe** at the protocol
and Electron-main layers, and defines the IPC contract Phase 2 (the UI) consumes. No
renderer UI was added — the bell popup and the "View all" operations overlay are
Phase 2.

## TL;DR for Phase 2

- Call **`window.electronAPI.downloadService.cancel(filename)`** to cancel one download
  and **`.cancelAll()`** to cancel everything. Both now **also abort the in-flight USB
  transfer in the main process** and **resolve only after the device has settled** —
  you can `await` them and treat resolution as "cancel done". You no longer need to
  separately call `jensen.cancelDownload()` from the renderer.
- Render the new transient **`'cancelling'`** item status (spinner / "Cancelling…"),
  which settles to **`'cancelled'`**.
- Cancelled items are **retryable** unless the cancel was deliberate-user
  (`cancelReason: 'user'`), which stays terminal until an explicit re-download / retry.

## Why cancellation is subtle (USB constraint)

The Jensen protocol has **no command to abort an in-flight `TRANSFER_FILE` stream**
(verified in `packages/jensen-protocol/src/jensen-device.ts` CMD enum and
`apps/desktop/src/constants.py`). After a "cancel" the device **keeps streaming the
whole file**. Sending the next command while those packets are still arriving overlaps
the device IN FIFO and wedges the firmware — the #1 forbidden failure mode.

The safe strategy lives in `JensenDevice.downloadFile()` (`settleTransfer`): on
user-cancel it **absorbs** further chunks, **keeps polling** (never `stopPoll()`
mid-stream), **drains to the protocol byte boundary** (the only proven end — silence
is not proof; the device has legitimate multi-second pauses), and only then **releases
the command slot**; if the stream stalls before the boundary it **quarantines** (clean
disconnect + bounded auto-reconnect). Disconnect is distinguished from user-cancel via
the `AbortController` reason (`'disconnect'` vs anything else). **This was already fully
implemented and unit-tested in the `beta/meeting-intelligence` line** (Phase 1 did not
change it).

## What Phase 1 added / changed (main process)

### 1. `electron/main/services/download-transfer-controller.ts` (new)
The single source of truth for the one active device→disk transfer:
`{ filename, AbortController, settled }`. `jensen:downloadFile` registers the transfer
for its lifetime; the cancel paths find and abort it and `await` its settlement.

Exports: `trackActiveTransfer`, `getActiveTransferFilename`, `hasActiveTransfer`,
`abortActiveTransfer` (fire-and-forget, for disconnect), `cancelActiveTransfer` /
`cancelActiveTransferByName` (abort + await settlement).

### 2. `electron/main/ipc/jensen-handlers.ts`
- `jensen:downloadFile` wraps the transfer in `trackActiveTransfer`.
- `jensen:cancelDownload` → `cancelActiveTransfer('user-cancel')` and **awaits settlement**.
- `jensen:disconnect` → `abortActiveTransfer('disconnect')` (teardown owns the drain).
- The live-recording poll's "busy" guard now uses `getActiveTransferFilename()`.

### 3. `electron/main/services/download-service.ts`
- `cancelDownload(filename)` is now **async**: if the file is the active USB transfer
  it sets a transient **`'cancelling'`** status (emitted), aborts + awaits USB
  settlement, then sets terminal `'cancelled'` (`cancelReason: 'user'`). A still-pending
  item (not on the bus) goes straight to `'cancelled'`.
- `cancelAll()` is now **async**: marks all pending + downloading `'cancelled'`, then
  aborts + awaits the active USB transfer. Emptying the pending set also lets the
  renderer download loop end naturally.
- `processDownload()` **re-checks the item status** before overwriting to `downloading`,
  before writing to disk, and before writing `synced_files` / `recordings` rows — a late
  completion can no longer overwrite a `cancelled` item or resurrect it as synced.
- `markFailed()` **refuses to downgrade** a `'cancelling'`/`'cancelled'` item to
  `'failed'` (the renderer's abort-triggered error path used to clobber the cancel to
  `failed`, which made it look retryable and resurrect on reconnect).

### 4. `electron/main/services/file-storage.ts`
- `saveRecording()` now writes to a unique **`.partial`** temp file and **atomically
  renames** onto the final path (rename is atomic on the same volume). A crash/cancel
  mid-write never leaves a truncated recording. It accepts an optional
  `{ isCancelled }` predicate checked just before the rename — on cancel it deletes the
  temp and returns `null` (no final file created). Collisions still get a numeric
  suffix, so a cancel **never deletes a pre-existing valid recording**.

## IPC contract for Phase 2

All channels are on `window.electronAPI.downloadService` (see
`electron/preload/index.ts`).

### Commands
| Method | Signature | Behavior |
|---|---|---|
| `cancel(filename)` | `=> Promise<{ success: boolean; error?: string }>` | Cancel one download. Aborts the in-flight USB transfer for this file (if active) and resolves **after USB settlement**. `success:false` for unknown / already-terminal items. |
| `cancelAll()` | `=> Promise<void>` | Cancel all pending + in-progress. Aborts + awaits the active USB transfer. |
| `cancelActive(reason?)` | `=> Promise<number>` | Mark `downloading` items `cancelled` with `cancelReason: 'interrupted'` (used on disconnect; auto-retries on reconnect). Does **not** itself abort USB (the disconnect handler does). Returns count. |
| `retryFailed(deviceConnected?, interruptedOnly?)` | `=> Promise<{ count; error? }>` | Re-queue `failed` + non-user `cancelled` items. `interruptedOnly=true` skips deliberate user cancels. |
| `clearCompleted()` | `=> Promise<void>` | Remove completed/failed/cancelled rows from the queue. |

### State events — `onStateUpdate(cb) => unsubscribe`
Payload (throttled ~250ms; immediate on status transitions):
```ts
{
  queue: Array<{
    id: string
    filename: string
    fileSize: number
    progress: number            // 0–100
    status: 'pending' | 'downloading' | 'cancelling'
          | 'completed' | 'failed' | 'cancelled'
    error?: string
    // (also present on items, though not in the preload state type: )
    // cancelReason?: 'user' | 'interrupted'
  }>
  session: { id; totalFiles; completedFiles; failedFiles;
             status: 'active'|'completed'|'cancelled'|'failed' } | null
  isProcessing: boolean
  isPaused: boolean
}
```

### Status lifecycle
```
pending ──▶ downloading ──▶ completed
   │             │
   │             ├──▶ cancelling ──▶ cancelled     (user cancel of the active transfer)
   │             └──▶ failed                        (USB / save error, stall)
   └──▶ cancelled                                   (cancel of a pending item)
```
- `'cancelling'` is **transient** and **never persisted** (durable terminal state is
  `'cancelled'`). Render it as an in-progress "Cancelling…" state.
- `cancelReason: 'user'` = deliberate → terminal until an explicit retry / re-download.
  `'interrupted'` (or absent) = disconnect/re-sync → auto-retried on reconnect. Use the
  existing `isRetryableDownloadItem()` helper (`src/hooks/useDownloadOrchestrator.ts`).

## What Phase 2 must wire (UI)
1. **Bell popup**: per-item Cancel button → `downloadService.cancel(item.filename)`, and a
   Cancel-All → `downloadService.cancelAll()`. `await` them and reflect the
   `'cancelling'` → `'cancelled'` transition from `onStateUpdate`.
2. **"View all" operations overlay**: include downloads (today it only shows
   transcriptions). Source the rows from `downloadService.getState()` / `onStateUpdate`.
3. The renderer's existing bulk `cancelDownloads()` in `useDownloadOrchestrator.ts` still
   works, but with the main process now owning the USB abort you can simplify it — a
   single `downloadService.cancelAll()` both stops the bus and empties the queue, so the
   orchestrator loop ends on its own. Keep setting `deviceSyncing=false` for immediate
   UI feedback.

## Tests (Phase 1)
- `packages/jensen-protocol/tests/jensen-device.test.ts` — user-cancel byte-boundary
  settlement, stall→quarantine, disconnect stand-down, double-settle guard (pre-existing
  in beta; 54 pass).
- `electron/main/services/__tests__/download-transfer-controller.test.ts` (new)
- `electron/main/services/__tests__/download-service-cancel.test.ts` (new) — cancel /
  cancelAll transitions, the late-completion-vs-cancelled race, the markFailed guard.
- `electron/main/services/__tests__/file-storage-atomic.test.ts` (new) — atomic write +
  cancel cleanup, no-overwrite of a pre-existing recording.

## Known / follow-up (not Phase 1 scope)
- **ACTION ITEM (pre-existing, unrelated):** `src/hooks/useDownloadOrchestrator.ts` has an
  "Unused eslint-disable directive" warning on its final `useEffect` deps (present at
  `HEAD`, not introduced here). Phase 2 will touch this hook — resolve it then.
- **ACTION ITEM (pre-existing):** the preload `getStats` return type omits
  `cancelledInQueue`, which `DownloadService.getSyncStats()` actually returns. Harmless,
  but the type should be widened when convenient.
