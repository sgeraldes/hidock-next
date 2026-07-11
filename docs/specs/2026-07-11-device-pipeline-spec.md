# DevicePipeline Coordinator Specification (C5 / BUG-R13)

## 1. Current Gate Inventory

Scope: a “gate/policy site” is code that admits, suppresses, serializes, deduplicates, cancels, retries, or orders a device action. Pure validation and display-only conditions are excluded. The inventory reflects the current tree, including the additive but not yet activated Phase 2 coordinator. `apps/electron/src/services/jensen.ts` contains no independent sequencing gate: `getJensenDevice` returns the IPC client; the deprecated `getWebUsbJensenDevice` escape hatch is an ownership risk because it can create a second USB owner and must be removed at cutover.

| Existing site (file:symbol) | Existing protection/policy |
|---|---|
| `packages/jensen-protocol/src/jensen-device.ts:JensenDevice.runExclusive` / `sendCommand` / `sendNextCommand` | Serializes the full command lifecycle and permits only one outstanding command. This is the lowest-level response-correlation/resource-conflict guard and remains as defense in depth. |
| `packages/jensen-protocol/src/jensen-device.ts:JensenDevice.tryConnect` | Returns early when already connected or `isOperationInProgress()`, preventing reconnect from colliding with a command. It also disconnects after failed setup to avoid leaving an open/claimed interface. |
| `packages/jensen-protocol/src/jensen-device.ts:JensenDevice.listFiles` | Uses `data.filelist` as a concurrent-list guard and a bounded stall timeout/partial settlement. It prevents two list accumulators consuming the same stream. |
| `packages/jensen-protocol/src/jensen-device.ts:JensenDevice.downloadFile` | Rejects disconnected/pre-aborted work and attaches an `AbortSignal` handler that resolves the active transfer and absorbs trailing packets. This is transfer cancellation, not queue policy. |
| `packages/jensen-protocol/src/jensen-device.ts:JensenDevice.abortInFlight` / `disconnect` / `gracefulCloseDevice` / `drainUntilIdle` / `reset` | Lifecycle preemption and teardown policy: clear pending protocol state, drain streaming input before stopping poll/closing, and reset only through the explicit reset path. It protects against stale FIFO bytes and claimed-interface/device wedges. |
| `apps/electron/electron/main/services/jensen.ts:setAutoConnectChecker` / `gate` / `getJensenDevice` | Injects the live `config.device.autoConnect` gate and assigns it to the singleton’s USB-connect listener. Protects user intent; manual connect bypasses this preference by design. `electron/main/index.ts:setAutoConnectChecker(...)` supplies the config reader. |
| `apps/electron/electron/main/ipc/jensen-handlers.ts:serializeDeviceOp` | A second main-process promise chain serializes connect, try-connect, disconnect, reset, and list-files IPC requests. It prevents lifecycle/scan interleaving, but does not serialize the download handler. |
| `apps/electron/electron/main/ipc/jensen-handlers.ts:pollRecordingOnce` | Skips polling unless connected and skips while `isOperationInProgress()` or `currentDownloadAbort` is set. This protects recording-status polling from stealing the single protocol slot. Backoff scheduling limits repeated failed polls. |
| `apps/electron/electron/main/ipc/jensen-handlers.ts:jensen:disconnect` / `jensen:reset` / `jensen:download-file` / `jensen:cancel-download` handlers | `currentDownloadAbort` admits one tracked download cancellation path; disconnect aborts saving, then waits through `serializeDeviceOp` so scan/FIFO teardown is ordered; reset calls `abortInFlight` before serialization. This split policy is the current disconnect-during-download safety patch. |
| `apps/electron/electron/main/ipc/jensen-handlers.ts:jensen:get-file-count` / `jensen:list-files` | Explicit connected checks reject invalid-state requests; list-files is serialized and only restarts recording polling after a non-null result while still connected. |
| `apps/electron/src/services/hidock-device.ts:HiDockDeviceService.initAutoConnect` / `startAutoConnect` / `tryConnectSilent` | Renderer-side duplicate-init (`initAutoConnectStarted`), enabled/user-disconnect, already-connected, `autoConnectInProgress`, Jensen-operation, authorized-device, and timeout gates. These protect preference semantics and duplicate/racing connection attempts, but duplicate main-process ownership. |
| `apps/electron/src/services/hidock-device.ts:HiDockDeviceService.gentleReattempt` / `startReconnectWatch` | Reconnect policy checks disconnected state, preference, manual-disconnect latch, in-progress attempt, failure cooldown, and authorized-device presence. This is a renderer-owned reconnect policy competing with USB attach handling in main. |
| `apps/electron/src/services/hidock-device.ts:HiDockDeviceService.connect` / `disconnect` / `resetDevice` | Manual connect re-enables session auto-connect and applies a timeout; disconnect sets `userInitiatedDisconnect` through `disableAutoConnect`; reset reconnects after the Jensen reset result. These are lifecycle ordering and user-intent gates outside the prospective coordinator. |
| `apps/electron/src/services/hidock-device.ts:HiDockDeviceService.listRecordings` | The largest scattered scan gate: requires connected state; debounces to cache; exponential-backs off failures; waits for an in-flight list; inspects `getLockHolder()` to wait on list, return cache during download/delete, or wait for init; waits for `initializationComplete`; skips scan if cached count matches; deduplicates with `listRecordingsLock` and `listRecordingsPromise`; avoids publishing an empty result when the device reports files; and only restores `ready` from `counting-files`. It protects races, repeated scans, false empty state, and invalid ordering. |
| `apps/electron/src/services/hidock-device.ts:HiDockDeviceService.getRecordingCount` / `deleteRecording` / `formatStorage` / `setAutoRecord` / `downloadRecording` / `downloadRecordingToFile` | Per-action connected-state gates; delete/download also validate the device path. Download methods maintain per-filename `AbortController`s and prevent an invalid/disconnected transfer, while format performs post-format state/cache work. These remain direct renderer initiators today. |
| `apps/electron/src/hooks/useDeviceConnection.ts:useDeviceConnection` (`connect` callback; module `connectInFlight`) | Module-level single-flight plus `service.isConnected()` prevents rapid/manual duplicate connect calls; a local pending flag is UI projection. |
| `apps/electron/src/hooks/useDeviceSubscriptions.ts:shouldLatchAutoSync` / `useDeviceSubscriptions` ready-status handler | `autoSyncTriggeredRef` and a two-second debounce suppress duplicate ready events; config gating via `isAutoSyncAllowed`, file-list readiness latching, and main queue inspection decide whether to reconcile/start or merely drain queued work. The idle/disconnected branch cancels active main downloads. This is the auto-sync policy site implicated by BUG-R1/R3. |
| `apps/electron/src/hooks/useDeviceSubscriptions.ts:checkInitialAutoSync` | A second auto-sync entry waits independently for config and device readiness, checks the preference, consults the same latch, may list files, reconciles, scopes filenames, and starts a session. It duplicates the ready-status path and creates ordering risk. |
| `apps/electron/src/hooks/useDownloadOrchestrator.ts:requestScopedDownloads` / `selectDownloadsToProcess` / `orderDownloadsForProcessing` | Renderer-global sets scope explicit downloads and prioritize them; auto-download selects the whole pending queue, while manual requests select only requested files; dequeue ordering is explicit FIFO first, otherwise newest recording first. This is product queue policy outside main. |
| `apps/electron/src/hooks/useDownloadOrchestrator.ts:canStartDownloadSession` / `processDownloadQueue` | Requires both live connection and renderer status `ready`, uses `isProcessingDownloads` as a mutex, reads the auto-download preference, constructs an `AbortController`, and repeatedly checks cancel, connection, and `deviceSyncing` state. It protects invalid starts and parallel drain loops but creates a second queue/FSM. |
| `apps/electron/src/hooks/useDownloadOrchestrator.ts:cancelDownloads` / subscription effect | `_cancelInProgress` and a cancel epoch make cancel idempotent; device idle aborts the renderer controller; main queue updates abort failed/cancelled active items; ready only retries failed work; pending work starts only when `canStartDownloadSession` passes. These are cancellation/reconnect policies distributed between renderer and main. |
| `apps/electron/src/store/useAppStore.ts:setDeviceSyncState` / `cancelDeviceSync` / `addToDownloadQueue` / `removeFromDownloadQueue` / `clearDownloadQueue` | Renderer-owned sync flag and `Map` act as an additional admission/cancellation/dedup source. `addToDownloadQueue` overwrites by key, and UI callers use membership as a double-click guard. This state is not authoritative because `DownloadService` owns another persisted queue. There is no current `useDeviceSyncStore`; its active equivalent is this slice in `useAppStore`. |
| `apps/electron/src/components/DeviceFileList.tsx:handleDownloadFile` | Checks renderer queue membership synchronously before starting, inserts the item before awaiting, and removes it in `finally`. This interim double-fire guard protects rapid DL clicks but bypasses `DownloadService` queue sequencing by calling `downloadRecordingToFile` directly. |
| `apps/electron/electron/main/services/download-service.ts:DownloadService.isFileAlreadySynced` / `getFilesToSync` | Four-layer reconciliation (synced table, normalized extensions, disk, recordings row) prevents duplicate downloads and repairs missing sync metadata. This is durable local-resource policy, not USB serialization. |
| `apps/electron/electron/main/services/download-service.ts:DownloadService.queueDownloads` / `startSyncSession` | Deduplicates against persisted DB rows, in-memory queue, normalized filename, and already-synced state; a session includes all pending/downloading entries after enqueue. This is the main queue admission site and can disagree with renderer scope unless all requests use one API. |
| `apps/electron/electron/main/services/download-service.ts:DownloadService.processDownload` | Requires an existing queue item, verifies destination availability and exact byte size before saving/marking synced, then changes queue/session state. It protects file integrity and local persistence; it should remain downstream of coordinator transfer ownership. |
| `apps/electron/electron/main/services/download-service.ts:DownloadService.cancelDownload` / `cancelActiveDownloads` / `retryFailed` / `checkForStalledDownloads` | Status gates restrict cancellation to active states, cancellation marks all downloading items, retry requires a connected-device argument, and stall detection fails timed-out transfers. These are queue status policies; today they do not themselves abort the USB read and therefore rely on renderer/IPC cancellation wiring. |
| `apps/electron/electron/main/services/device-pipeline.ts:DevicePipelineService` (`runPipeline`, `shouldScan`, `downloadAll`, lifecycle/action methods, `initAutoConnect`) | An additive coordinator already implements initialize → conditional scan → reconcile → sequential download → idle, one `AbortController`, live auto-connect checks, and disconnect/cancel handling. It is not yet the sole owner: legacy handlers/hooks still initiate operations, action calls lack a general single-flight/intent queue, delete can run directly during a transfer, and the coordinator is not activated/consumed by the current UI. |
| `apps/electron/electron/main/ipc/device-pipeline-handlers.ts:registerDevicePipelineHandlers` / `apps/electron/src/hooks/useDevicePipeline.ts:useDevicePipeline` | The IPC bridge exposes coordinator actions and state/files subscriptions; the hook is a read-through projection with mounted guards. Git history and the prior design mark this bridge “inert”; current pages still use legacy hooks/services. |

Migration rule: protocol integrity checks (`JensenDevice` command serialization, list accumulator, abort/drain/close, connected checks, path and byte-size validation, and DownloadService reconciliation) remain defensive boundaries. Product policy, action admission, sequencing, retry, reconnect, and authoritative state move to one main-process coordinator.

## 2. Bug Catalog

| Evidence | Verified failure caused or amplified by scattered gates | Coordinator requirement derived from it |
|---|---|---|
| `BUG-R1` in `docs/specs/2026-03-25-remaining-bugs.md`; fix commit `261224d3` | `listRecordings` emitted `ready`; the subscription interpreted `ready` as an auto-sync trigger and called `listRecordings` again, creating an indefinite re-scan loop. | Phase completion must be state, not a command trigger. Only queued intent may start a scan, and equivalent scan intent is coalesced. |
| `BUG-R2`; `261224d3` | The re-scan loop kept UI state at `counting-files`, leaving “Scanning files” stuck after a completed scan. | Main owns one phase FSM; renderer only projects it. Terminal scan transitions must occur exactly once. |
| `BUG-R3` and `BUG-R5`; `261224d3` | The ready handler and initial auto-sync check both fired before `autoSyncTriggeredRef` was latched, creating duplicate sessions and duplicate full reconciliation. | Auto-sync is one main-process intent, keyed/deduplicated per connection generation. No renderer startup and ready-event dual initiators. |
| `BUG-R4`; fix commit `1f4a98af` (also present as `9872f25c` in history) | Duplicate reconciliation made 1,300+ per-file “skipping” lines especially noisy. The direct cause was logging granularity, but BUG-R3 doubled it. | One reconciliation per coalesced sync intent; retain summary logging only. |
| `BUG-R8` | The March backlog recorded that `downloadFile` had no timeout. The current implementation has cancellation/stall machinery, but the original bug demonstrates why transfer termination cannot depend on a renderer remaining mounted. | Coordinator owns a bounded transfer deadline and `AbortSignal`; DownloadService stall state and USB abort are one operation. |
| `BUG-R9` | `cancelActiveDownloads` used `failed` rather than `cancelled` in the recorded backlog. Current `DownloadService` now exposes cancelled state; this is evidence that cancellation semantics were previously encoded at a symptom site. | Cancellation has a first-class outcome and reason, distinct from failure, propagated from coordinator to queue state. |
| `BUG-R10` | `listRecordings` did not pass `onNewFiles`; incremental detection policy existed at one layer but was not wired by its caller. | Coordinator owns scan results/events; callbacks are not optional cross-layer policy. |
| `BUG-R11` | `step1Success` in `handleConnect` was unused, showing init sequencing/status had become detached from actual outcomes. | State transitions are derived from operation results inside the coordinator, not manually mirrored steps. |
| `BUG-R12`; related stabilization commit `97fc89b2` and later reset/retry commit `b4ca3505` | Initial auto-connect sometimes issued commands before the device was ready; manual reconnect worked. | Reconnect/init retry is an explicit bounded state-machine transition, not an arbitrary caller delay or independent retry loop. |
| `BUG-R13`, auto-connect instance; commit `25d6c22e` | Main USB hot-plug reconnect did not read the user preference until `setAutoConnectChecker` was added. Renderer also retained a separate auto-connect configuration/latch. | Auto-connect is checked once, in main, at event time; manual connect remains allowed. |
| `BUG-R13`, auto-transcribe instance; commit `11ce9830` | `storage:save-recording` queued transcription unconditionally while three gates existed. | DevicePipeline ends at a successfully saved file event. Exactly one post-save ingestion funnel checks auto-transcribe; the device coordinator does not duplicate it. |
| `BUG-R13`, DL-button instance; commit `eccbeab8` | The DL button used a direct path, permitting double-fire and providing no reliable shared indicator. | Every download request enters a main queue with an idempotency key; UI cannot call the transport directly. |
| `BUG-R13`, binary round-trip instance; commit cited by the bug list as `cfdeb3fa` | Download bytes travelled main → renderer → main and trailing chunks raced listener teardown, producing size mismatch. | Download and save stay in main; IPC carries intent, progress, and outcome only. |
| Prior pipeline rollout, commit `3454f5b2` and follow-up `a6b67847` | The prior design records the live “download one → downloads all” defect: a single-file action caused a global pending queue drain. | Intent scope is immutable: `download(files)` processes only those keys unless the admitted intent is explicitly `syncAll`. |
| Lifecycle serialization, commits `5e998f81`, `ecd3f18b`, and `754d68ad` | Rapid lifecycle clicks could interleave; disconnect could preempt a scan and leave streaming data; an interrupted scan could be misreported as empty storage. | Lifecycle intents are serialized; disconnect is highest priority but uses operation-specific safe cancellation/drain before close; interrupted scan never commits an empty snapshot. |
| Disconnect during download, commit `52889927` | Download ran outside the IPC serializer. Disconnect stopped polling mid-stream, left file bytes in the device FIFO, and the next connect consumed stale bytes instead of device info—the documented wedge. | USB transfer and lifecycle teardown must share one owner. Disconnect aborts acceptance/saving, drains the device stream through the transport boundary, then closes; reconnect waits for teardown completion. |
| Additive coordinator history: `0212ca3e` (service), `177419db` (IPC/hook, explicitly inert), `4fabe72c` (cutover checklist), and `015012b2` (singleton wiring fix) | Phase 2 built most of the target alongside the old path, but did not activate it because two USB owners would be unsafe. Singleton/bundler wiring also caused a startup crash before its fix. | Cutover must be atomic at the ownership boundary, feature-flagged at handler/UI routing, and never instantiate legacy and coordinator transports concurrently. |

No additional bug scenario is asserted here without one of the above document or Git-history sources.

## 3. DevicePipeline Coordinator Design

`DevicePipeline` is a process-wide main-process service. It is the sole caller allowed to initiate `JensenDevice` lifecycle, scan, download, delete, format, settings, and recording-poll commands. IPC handlers validate inputs and call this interface; they never call Jensen directly. The renderer subscribes to snapshots/events and submits intent only.

```typescript
type DeviceAction =
  | { kind: 'connect'; source: 'manual' | 'startup' | 'usb-attach' }
  | { kind: 'disconnect'; reason: 'manual' | 'usb-detach' | 'shutdown' }
  | { kind: 'sync'; mode: 'auto' | 'manual'; forceScan?: boolean }
  | { kind: 'download'; files: ReadonlyArray<{ filename: string; size: number }> }
  | { kind: 'cancel-downloads'; reason: string }
  | { kind: 'delete'; filename: string }
  | { kind: 'format' }
  | { kind: 'set-auto-record'; enabled: boolean }
  | { kind: 'poll-recording' }

type ActionOutcome<T = unknown> =
  | { status: 'completed'; actionId: string; value?: T }
  | { status: 'cancelled'; actionId: string; reason: string }
  | { status: 'rejected'; actionId: string; code: 'INVALID_STATE' | 'POLICY_DISABLED' | 'DUPLICATE' | 'NOT_CONNECTED'; message: string }
  | { status: 'failed'; actionId: string; code: string; message: string; retryable: boolean }

interface DevicePipeline {
  dispatch<T = unknown>(action: DeviceAction): Promise<ActionOutcome<T>>
  getSnapshot(): DevicePipelineSnapshot
  getFiles(): readonly FileInfo[]
  subscribe(listener: (event: DevicePipelineEvent) => void): () => void
  start(): Promise<void>   // bind USB events and evaluate startup auto-connect once
  stop(): Promise<void>    // cancel admission, safely settle/drain, unbind listeners
}

interface DeviceTransport {
  connect(signal: AbortSignal): Promise<boolean>
  tryConnect(signal: AbortSignal): Promise<boolean>
  initialize(signal: AbortSignal): Promise<PipelineDeviceState>
  listFiles(signal: AbortSignal, onProgress: (current: number, total: number) => void): Promise<FileInfo[]>
  downloadFile(request: { filename: string; size: number }, signal: AbortSignal, onChunk: (chunk: Uint8Array) => void, onProgress: (bytes: number) => void): Promise<void>
  drainAndDisconnect(reason: string): Promise<void>
  resetForRecovery(signal: AbortSignal): Promise<boolean>
  deleteFile(filename: string, signal: AbortSignal): Promise<void>
  format(signal: AbortSignal): Promise<void>
  setAutoRecord(enabled: boolean, signal: AbortSignal): Promise<void>
  pollRecording(signal: AbortSignal): Promise<string | null>
  isConnected(): boolean
}
```

The `DeviceTransport` boundary wraps the existing main `JensenDevice`; tests replace this interface with a deterministic fake. `JensenDevice` retains its internal command lock and safe drain/close behavior. No test or migration phase uses real hardware.

State machine:

```text
DISCONNECTED
  -- admitted connect --> CONNECTING
CONNECTING
  -- transport open --> INITIALIZING
  -- failure/cancel --> DISCONNECTED or ERROR
INITIALIZING
  -- usable metadata --> SCANNING (cache stale/forced) or RECONCILING
  -- all commands fail --> RECOVERING
SCANNING
  -- complete snapshot --> RECONCILING
  -- disconnect requested --> CANCELLING --> DRAINING --> DISCONNECTED
RECONCILING
  -- explicit/auto-download set nonempty --> DOWNLOADING
  -- no admitted downloads --> READY
DOWNLOADING
  -- queue scope empty --> READY
  -- cancel-downloads --> CANCELLING --> READY
  -- disconnect/detach --> CANCELLING --> DRAINING --> DISCONNECTED
READY
  -- sync --> SCANNING or RECONCILING
  -- download --> DOWNLOADING
  -- delete/set/poll --> EXECUTING --> READY
  -- format --> FORMATTING --> SCANNING
  -- disconnect/detach --> DRAINING --> DISCONNECTED
RECOVERING
  -- one reset/reconnect succeeds --> INITIALIZING
  -- retry exhausted --> DRAINING --> ERROR
ERROR
  -- manual connect --> CONNECTING
  -- disconnect --> DISCONNECTED
```

`DevicePipelineSnapshot` contains `phase`, monotonically increasing `connectionGeneration`, current action metadata, device metadata, scan progress, one authoritative download queue/progress view, recording status, and structured error. `READY` replaces the ambiguous renderer `ready` notification: entering it never implicitly dispatches another action.

Queue, cancellation, and reconnect policy:

1. One serial intent scheduler owns all device actions. Priority is: physical detach/shutdown disconnect; manual disconnect; cancel downloads; recovery; manual connect/action; auto-connect/auto-sync; recording poll. Non-device CPU reconciliation may run inline but cannot admit a second transport call.
2. Coalescing keys are `connect:<generation>`, `sync:<generation>`, `download:<normalized filename>`, and `poll-recording:<generation>`. A duplicate receives the existing promise or a `DUPLICATE` result; it never creates new work. Manual `forceScan` upgrades a queued sync rather than adding another scan.
3. Download scope is explicit. `download` adds only named files; `sync(mode)` reconciles and adds all eligible files only when `autoDownload` is allowed for auto mode or the user explicitly requested manual sync. DownloadService remains the durable metadata/reconciliation store, but the pipeline is the only component that moves an item to active and calls `processDownload`.
4. One active operation owns one `AbortController`. Cancellation is two-stage: stop accepting/committing results, then wait for the transport’s safe settlement. For download disconnect, discard remaining data while `drainAndDisconnect` consumes the FIFO before poll stop/close. Cancellation yields `cancelled`, never `failed`, unless safe teardown itself fails.
5. Manual disconnect creates a session suppression latch for the current process connection generation; it does not mutate the saved auto-connect preference. USB attach and startup check `config.device.autoConnect` at dispatch time. Manual connect bypasses that preference and clears session suppression.
6. Unexpected detach atomically cancels active/queued generation-bound actions and increments `connectionGeneration`. Late callbacks tagged with the old generation are ignored. Pending durable downloads remain pending, not active.
7. Reconnect is never attempted concurrently. Auto-reconnect uses USB attach events, not a renderer timer. Initialization may perform one bounded reset/reconnect recovery attempt. After failure it enters `ERROR` and waits for a new attach or manual connect; no rapid retry loop.
8. Recording polling is a lowest-priority coalesced action. It runs only in `READY`, never during scan/download/lifecycle work, and uses existing normal/backoff intervals.

Existing-site migration mapping:

| Current sites from section 1 | Migration |
|---|---|
| Shared `JensenDevice` locks, list accumulator, abort/drain/reset | Keep behind `DeviceTransport`; do not expose them to renderer or generic IPC. |
| `setAutoConnectChecker`, Jensen singleton listener, renderer auto-connect/reconnect cluster, `useDeviceConnection` single-flight | Move event binding, preference check, session latch, single-flight, timeout, and recovery to `DevicePipeline.start`/scheduler; manual UI calls `dispatch(connect)`. Remove renderer timers/listeners and direct listener setup. |
| `serializeDeviceOp`, connected checks, `currentDownloadAbort`, recording poll scheduling in `jensen-handlers` | Replace device-action handlers with calls to DevicePipeline. Retain only compatibility handlers during a flagged bridge phase; they must delegate, never call `getJensenDevice`. Poll timer dispatches low-priority `poll-recording`. |
| `HiDockDeviceService.listRecordings` debounce/cache/backoff/locks/init wait | Replace with coordinator cache validity, sync coalescing, explicit state transitions, and bounded recovery. UI reads `getFiles`; it cannot initiate a hidden scan on `READY`. |
| Other `HiDockDeviceService` direct actions | Map to `dispatch(delete/format/set-auto-record/download)`; retain renderer service temporarily as a facade, then delete it and the WebUSB escape hatch. Validation remains at IPC and transport boundaries. |
| `useDeviceSubscriptions` two auto-sync paths and cancellation | Delete both initiators. Pipeline dispatches at most one auto-sync after successful initialization for a generation, checks main config once, and owns disconnect cancellation. Hook becomes snapshot projection only. |
| `useDownloadOrchestrator` scopes, ordering, mutex, aborts, ready/retry listeners | Move scope, priority/recency ordering, active mutex, retry eligibility, and cancellation to the main scheduler. Delete module-global renderer sets/controllers and renderer drain loop. |
| `useAppStore` device sync/queue fields and `DeviceFileList` direct DL guard | Derive read-only UI state from `DevicePipelineSnapshot`. DL calls `dispatch(download)`; main idempotency supplies immediate accepted/existing action state. Remove renderer queue as an authority. |
| `DownloadService` reconciliation, queue persistence, integrity, cancellation/status methods | Keep as a repository used only by DevicePipeline. Add atomic claim/complete/cancel operations if needed; stop accepting queue-processing control from renderer. Pipeline cancellation invokes both transport abort/settlement and queue status update. |
| Existing additive `DevicePipelineService`, its IPC handlers, singleton, and `useDevicePipeline` | Evolve rather than duplicate: add the scheduler/generation/state guarantees above, then make the existing bridge authoritative. `useDevicePipeline` becomes the sole device hook consumed by pages/layout/library. |

## 4. Migration Plan

All phases are analysis-driven and mock-only until a separately authorized supervised hardware session. Automated tests inject a fake `DeviceTransport`; they must never import or instantiate `usb`, enumerate devices, open endpoints, or run probing code.

**Phase 0 — Freeze behavior and ownership map.** Add characterization tests around the existing coordinator interfaces and IPC contracts: duplicate connect/sync, ready-without-rescan, scoped download, disconnect during scan/download, cancellation status, stale-generation callbacks, preference checks, and recording-poll exclusion. Introduce no runtime routing change. Rollback: remove tests/fake only; production behavior is untouched.

**Phase 1 — Harden the additive coordinator.** Extend the existing `DevicePipelineService` with the serial scheduler, generation tokens, explicit cancellation/draining/recovery states, scoped download admission, and fake `DeviceTransport` boundary. Keep its IPC route inert. Test every legal transition and reject every illegal action; use deferred promises to deterministically interleave disconnect with each phase. Assert call order (`abort acceptance` → `drain` → `close`) and that no two fake transport calls overlap. Rollback: revert coordinator-only changes; legacy path remains active.

**Phase 2 — Make main queue/state authoritative behind a feature flag.** Route device-pipeline download intents to DownloadService atomically, keep bytes in main, and publish one snapshot. Add repository tests for duplicate normalized filenames, persisted pending work, exact-size validation, cancel vs fail, scoped single-download, and retry after a new connection generation. The flag defaults off; legacy IPC remains active but must not share an instantiated transport when the flag is on. Rollback: disable the flag and return to legacy queue routing; persisted queue schema remains backward-compatible.

**Phase 3 — Delegate compatibility IPC to the coordinator.** Change existing Jensen device-action IPC handlers to delegate to DevicePipeline when flagged; preserve channel response shapes for callers. The legacy `serializeDeviceOp` and `currentDownloadAbort` cease to own sequencing on that route. Contract tests invoke old and new channels and assert both produce the same coordinator intent, never two transport calls. Rollback: switch handlers back to legacy delegation with the flag off; no renderer change is required.

**Phase 4 — Renderer projection cutover.** Replace `HiDockDeviceService` actions, `useDeviceSubscriptions`, `useDownloadOrchestrator`, device-related `useAppStore` authority, and direct `DeviceFileList` download with `useDevicePipeline`. First retain thin adapters so component changes are mechanical. Tests cover React StrictMode double-mount, reload during every phase, rapid DL clicks, auto-download off with pending rows, manual sync, and disconnect UI. Assert renderer tests have no WebUSB/USB mocks because the renderer no longer owns transport. Rollback: switch the renderer feature flag to the compatibility adapters; main coordinator route can remain dormant.

**Phase 5 — Atomic sole-owner activation and dead-path removal.** At startup choose exactly one owner before creating a Jensen singleton. With DevicePipeline enabled, call `start`, do not call legacy `setupUsbConnectListener`, and prevent deprecated renderer/direct-WebUSB construction. Remove renderer reconnect timers, dual queue/FSM, direct download/save path, and superseded interim gates only after their coordinator tests pass. A static test/search allowlist fails CI if device actions call `getJensenDevice` outside `DeviceTransport` or if renderer code references `navigator.usb`. Rollback: ship one release with the startup flag able to select the complete legacy owner before process start; never hot-switch owners within a process. If rollback is selected, restart the app so only the legacy owner is instantiated.

**Phase 6 — Verification and flag retirement.** Required automated suite: state-machine table tests; property-style sequences of actions asserting one active transport call; fake-timer retry/backoff tests; IPC validation/contracts; DownloadService persistence/integrity tests; renderer projection tests; full typecheck/build/Vitest. Hardware remains explicitly deferred by this spec. A future supervised verification plan requires separate user authorization and must follow the repository’s “one clean connection attempt, one proper cleanup” safety rule; it is not part of implementing this spec. After a stable release and separately approved verification, remove the legacy branch and flag. Rollback before flag retirement is Phase 5’s cold-start selection; after retirement, rollback is a release revert, not runtime dual ownership.

## 5. Non-Goals

- Rewriting the Jensen wire protocol, framing, checksum, 24-bit body-length parsing, native polling, endpoint selection, or USB driver/backend.
- Running diagnostic probes, descriptor dumps, endpoint experiments, real-device tests, or any automated hardware access.
- Supporting multiple concurrently connected HiDock devices; this pass coordinates the existing single process-wide device.
- Improving raw USB throughput, changing transfer sizes, parallelizing downloads, or allowing commands to interleave. Downloads remain sequential.
- Changing file formats, conversion, transcription models, calendar correlation, knowledge extraction, or downstream artifact processing.
- Making DevicePipeline a second transcription scheduler. It emits/records successful local availability; the single ingestion funnel owns the auto-transcribe preference and queue.
- Redesigning DownloadService’s database schema except for minimal atomic ownership/status operations required by the coordinator.
- Solving unrelated Chromium USB stderr noise (BUG-R6), DevTools autofill noise (BUG-R7), or general application logging.
- Changing user-facing auto-connect, auto-download, auto-transcribe, manual sync, delete, format, or auto-record semantics beyond enforcing each existing policy once.
- Hot-switching between legacy and coordinator USB owners inside a running process; feature-flag rollback is cold-start only.
- Removing protocol-level defensive locks and validation after centralization. The coordinator is the policy owner; Jensen and persistence checks remain safety boundaries.
