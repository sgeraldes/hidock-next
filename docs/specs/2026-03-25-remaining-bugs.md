# Remaining Bugs — Prioritized List

## P0 — Fix Now (blocking user experience)

### BUG-R1: File list re-scan loop after completion
**Symptom:** After successful scan (1382 files), immediately starts another scan. Repeats indefinitely.
**Root cause:** `listRecordings()` finally block calls `updateStatus('ready')` → status listener in `useDeviceSubscriptions` sees 'ready' → triggers auto-sync → calls `listRecordings()` again → loop.
**Files:** `hidock-device.ts` (updateStatus in finally), `useDeviceSubscriptions.ts` (status=ready trigger)
**Fix:** Don't emit 'ready' status from listRecordings finally block (it was set during init). Or: the auto-sync in useDeviceSubscriptions should set `autoSyncTriggeredRef = true` BEFORE calling listRecordings, not after.

### BUG-R2: Sidebar "Scanning files" notification stuck after completion
**Symptom:** Sidebar shows "H1E Scanning files (1237/1382)..." even after scan completed.
**Root cause:** The `counting-files` connection status is set during listRecordings but the status update back to 'ready' happens in the finally block — which then triggers a re-scan (BUG-R1), keeping the status at 'counting-files'.
**Files:** `hidock-device.ts` (status updates), sidebar component
**Fix:** Fixing BUG-R1 should fix this too.

### BUG-R3: Auto-sync triggered twice (duplicate download sessions)
**Symptom:** "Auto-sync triggered - 117 new recordings" appears twice at 21:21:26 and 21:21:48.
**Root cause:** Both `useDeviceSubscriptions` status=ready handler AND the initial auto-sync check fire. The `autoSyncTriggeredRef` flag is set too late.
**Files:** `useDeviceSubscriptions.ts`
**Fix:** Set `autoSyncTriggeredRef = true` immediately when starting auto-sync, not after listRecordings succeeds.

## P1 — Fix Soon (noise/quality)

### BUG-R4: Massive "Skipping" log spam from DownloadService
**Symptom:** 1300+ "Skipping X: In synced_files table" log lines on every auto-sync reconciliation. Repeated twice due to BUG-R3.
**Files:** `download-service.ts` (getFilesToSync or startSession reconciliation)
**Fix:** Remove per-file skip logging. Log summary: "Skipped N already-synced files" instead.

### BUG-R5: DownloadService reconciliation runs twice per sync
**Symptom:** The full 1382-file reconciliation (checking each against synced_files) runs TWICE because auto-sync triggers twice (BUG-R3).
**Files:** `useDeviceSubscriptions.ts`, `download-service.ts`
**Fix:** Fixing BUG-R3 fixes this.

### BUG-R6: Chromium USB errors still showing
**Symptom:** 7x SetupDiGetDeviceProperty errors on startup.
**Root cause:** The `disable-usb-device-event-log` and `device-event-log-level` flags don't work in this Electron version.
**Files:** `electron/main/index.ts`
**Fix:** These are Chromium stderr, not console.log. Can only be suppressed by redirecting stderr in the launch script, or accepted as cosmetic.

### BUG-R7: Autofill DevTools errors
**Symptom:** "Request Autofill.enable failed" when opening DevTools.
**Root cause:** Electron's DevTools protocol doesn't support Autofill commands.
**Files:** N/A (Electron/DevTools internal)
**Fix:** Cosmetic only. Can be ignored or suppressed by disabling Autofill in DevTools settings.

## P2 — Backlog (from earlier audit)

### BUG-R8: downloadFile() has no timeout (same as old listFiles issue)
**Files:** `jensen.ts:1458`

### BUG-R9: cancelActiveDownloads() uses 'failed' not 'cancelled'
**Files:** `download-service.ts:683`

### BUG-R10: onNewFiles callback never passed by listRecordings
**Files:** `hidock-device.ts:1026`

### BUG-R11: step1Success variable unused in handleConnect
**Files:** `hidock-device.ts:1363`

### BUG-R12: Initial auto-connect sometimes fails (device not ready)
**Symptom:** First auto-connect fails all commands, manual reconnect works.
**Root cause:** 300ms stabilization delay not always enough. USB subsystem timing varies.
**Files:** `jensen.ts` (setup delay), `hidock-device.ts` (handleConnect retry)
