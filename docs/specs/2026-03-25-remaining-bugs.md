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

### BUG-R4: Massive "Skipping" log spam from DownloadService — FIXED
**Symptom:** 1300+ "Skipping X: In synced_files table" log lines on every auto-sync reconciliation. Repeated twice due to BUG-R3.
**Files:** `download-service.ts` (getFilesToSync / isFileAlreadySynced / queueDownloads)
**Fix (done):** Removed the per-file logs inside `isFileAlreadySynced` (the "Found orphaned file on disk" / "Found in recordings table" lines) and the per-file "already synced, skipping" lines in `queueDownloads`. Reconciliation now emits a single summary line — `getFilesToSync` reports `N files skipped (already synced)[ (R reconciled from disk/recordings)], M files queued`, and `queueDownloads` emits one `skipped X already queued, Y already synced` line only when something was skipped. Steady-state summary format is unchanged when nothing is reconciled.

### BUG-R5: DownloadService reconciliation runs twice per sync
**Symptom:** The full 1382-file reconciliation (checking each against synced_files) runs TWICE because auto-sync triggers twice (BUG-R3).
**Files:** `useDeviceSubscriptions.ts`, `download-service.ts`
**Fix:** Fixing BUG-R3 fixes this.

### BUG-R6: Chromium USB errors still showing — ACCEPTED (cosmetic, documented)
**Symptom:** 7x SetupDiGetDeviceProperty errors on startup.
**Root cause:** The `disable-usb-device-event-log` and `device-event-log-level` flags don't fully suppress these in this Electron version.
**Files:** `electron/main/index.ts`
**Decision (done):** These are written to stderr by native Chromium code (fd 2), not via `console.log`. A JS-level `process.stderr.write` filter cannot intercept native writes, and raising the global `--log-level` would also hide genuine errors. The existing `disable-usb-device-event-log` / `device-event-log-level=3` switches are the clean mechanism and cover most of the noise; anything residual can only be suppressed by redirecting the Electron child's stderr in the dev launcher (dev-only). We ACCEPT the remaining lines as cosmetic rather than add a risky filter. Rationale documented inline in `index.ts` next to the USB switches.

### BUG-R7: Autofill DevTools errors — ACCEPTED (cosmetic, documented)
**Symptom:** "Request Autofill.enable failed" when opening DevTools.
**Root cause:** Electron's DevTools protocol backend doesn't implement the Autofill domain, so the DevTools frontend's `Autofill.enable`/`Autofill.setAddresses` calls fail and print to stderr. Only appears in dev with DevTools open.
**Files:** N/A (Electron/DevTools internal); decision recorded in `electron/main/index.ts`.
**Decision (done):** Native DevTools-protocol stderr, not interceptable in-process; no Electron switch disables it. ACCEPTED as cosmetic, documented inline in `index.ts` (BUG-R6/R7 comment block).

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

## Architectural — root cause of a recurring bug class (ADR-0005)

The 2026-06 device fixes below were each patched at the symptom site, but share
one root: device actions have multiple entry points and user-preference policy
is enforced at scattered call sites instead of one funnel. The structural cure
is the DevicePipeline coordinator (`docs/superpowers/specs/2026-03-26-usb-device-pipeline-design.md`).
Full analysis + graph traces: `.claude/architecture-decisions/ADR-0005-device-actions-flow-through-coordinators.md`.

### BUG-R13: Device actions lack single coordinators / policy funnels
**Instances (all fixed as interim patches; collapse into DevicePipeline):**
- Auto-connect ignored toggle — main USB-plug trigger never read the preference (`25d6c22e`). Cat. C.
- Auto-transcribe ignored toggle — `storage:save-recording` queued unconditionally; 3 duplicate gates exist (`11ce9830`). Cat. A/B. **Cure:** RecordingWatcher is the sole transcription funnel; remove `addToQueue` from `download-service` + `storage-handlers`.
- DL button double-fire / no indicator — DL path bypasses `DownloadService` (`eccbeab8`). Cat. B/D. **Cure:** route all downloads through the coordinator.
- Download size mismatch — binary round-trips main→renderer→main (`cfdeb3fa`). Cat. E. **Cure:** download+save in one main pass.
**Files:** `device-pipeline.ts` (new), `download-service.ts`, `storage-handlers.ts`, `recording-watcher.ts`, `jensen.ts`, `hidock-device.ts`, `DeviceFileList.tsx`
