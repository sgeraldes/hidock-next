# SPEC-010: Permanent Deletion Experience and Device Reconciliation

## Status

- **State:** Approved for implementation
- **Owner surface:** Electron Knowledge Library
- **Related contracts:** SPEC-005/F17 deletion semantics, SPEC-006/F17 hard-purge integrity, SPEC-008 selection
- **Safety boundary:** Automated validation uses mocks only. This work must not probe or access a real USB device.

## Problem

Permanent deletion is a two-system operation:

1. purge local metadata, derived knowledge, and files;
2. optionally erase the original recording from the HiDock.

The local purge can finish before the device erase. During that interval the unified renderer may rebuild the row from a stale in-memory device-file cache. The user then sees the smart title and metadata disappear while the raw `.hda` row remains until a later device reconciliation. The defect occurs for both single and bulk deletion: a confirmed 13-item local + device purge was immediately reconstructed as 13 raw device-only rows. In compact view there is no visible row-level deleting state, so a successful operation looks stuck or failed.

## Product Decision

The Knowledge Library represents usable knowledge, not raw hardware inventory. Once a hard local purge commits, that item must leave the Library immediately. If a hardware copy remains, it is shown honestly on the Device/Sync surface as **Deleted — still on device**, where it can be erased or explicitly re-downloaded.

The UI uses a staged optimistic presentation with pessimistic truth:

- before the local commit, keep the row and show a disabled **Removing local data…** state;
- after the local commit, remove the row from the Library immediately;
- while a requested hardware erase is outstanding, show persistent **Erasing the H1E copy…** feedback;
- never announce complete deletion until the actual outcome is known;
- on queued or partial outcomes, name exactly what remains and where recovery happens.

## State Machine

| State | Library row | Persistent feedback | Allowed transition |
|---|---|---|---|
| `idle` | Normal | None | User confirms permanent delete |
| `removing-local` | Visible, disabled, spinner | “Removing local data…” | Local purge succeeds or fails |
| `erasing-device` | Hidden from Library | “Removed from Library. Erasing the H1E copy…” | Device confirms, queues, or fails |
| `complete` | Hidden | Success toast with actual removed counts | Terminal |
| `queued` | Hidden; Device page owns residual copy | Warning: erase queued for reconnect | Automatic retry |
| `partial` | Hidden; Device page owns residual copy | Warning: local data removed, device copy remains | User retry/device reconcile |
| `failed-local` | Restored/unchanged | Error: nothing was removed | Retry |
| `failed-device-only` | Visible as a hardware row | “Device copy remains” with Retry | User retries the device erase |

## Functional Requirements

### FR-1 — Immediate Library suppression

- A successful hard purge MUST add every known filename variant to the Library's purge suppression set before the next renderer rebuild.
- The Library MUST load the durable `purged_files` set on mount and refresh it after download/reconciliation events.
- Purge suppression MUST compare case-insensitive base filenames so `.hda`, `.wav`, and `.mp3` variants are treated as the same source.
- The Device page MUST continue showing a surviving hardware copy with its existing Deleted badge.

### FR-2 — Renderer cache reconciliation

- Every immediate Jensen delete entry point MUST join the shared device-operation serializer so erase commands cannot interleave with scans, counts, downloads, or cleanup sweeps.
- `result === "success"` and `result === "not-exists"` both satisfy an idempotent erase: in either case the requested file is absent. Other non-null failure responses are not success.
- A confirmed device erase MUST remove the exact device filename from the renderer's in-memory recording cache before `refreshLocal()`.
- The cache update MUST preserve every other device recording.
- The update MUST NOT start a USB file-list scan.
- The persistent `device_file_cache` entry MUST still be removed through `recordings:markNotOnDevice`.

### FR-3 — Visible progress

- Device-only confirmation MUST say **Erase from device**, disclose that no local copy exists, and MUST NOT show an “Also delete the device copy” checkbox.
- Closing the confirmation dialog MUST immediately expose a visible and screen-reader-announced progress state.
- Compact `SourceRow` MUST accept `isDeleting` and render a spinner plus an action-specific label.
- While deleting, the row MUST be non-interactive and its overflow menu MUST be unavailable.
- After the local purge commits, a Library-level status MUST remain visible while the device outcome is pending.

### FR-4 — Honest completion

- Local failure MUST keep the row and say that nothing was removed.
- Confirmed local + device removal MAY use the existing success toast.
- A queued device erase MUST say it will retry on reconnect.
- A failed device erase MUST say the local purge succeeded but the device copy remains.
- A failed device-only erase MUST keep the hardware row visible, say **Device copy remains**, and expose a Retry action.
- Device failure feedback MUST preserve the best available reason (disconnected before start, no device confirmation, or explicit rejection) instead of collapsing every outcome to “Device deletion failed”. `not-exists` MUST reconcile caches rather than appear as a rejection.
- A bulk success toast MUST not be emitted until every confirmed device erase has reconciled the corresponding renderer-cache entry.
- A stale-view or cache-reconciliation failure MUST never use the plain success variant.

### FR-5 — Concurrency and cleanup

- Duplicate confirmation for the same row MUST be prevented while deletion is active.
- Progress state MUST clear in `finally`, including exceptions.
- Selection and playback for a successfully purged row MUST be cleared as soon as the local commit succeeds.

## Acceptance Criteria

- [ ] Within one render after confirmation, the compact row reads **Removing local data…**, is disabled, and exposes `role="status"` feedback.
- [ ] A device-only selection confirms the sole hardware erase directly, without implying local data or offering a redundant device-copy checkbox.
- [ ] After a successful hard purge, no filename-only ghost appears in the Knowledge Library.
- [ ] A stale renderer cache containing the deleted `.hda` file cannot recreate the Library row.
- [ ] A confirmed device erase removes only that filename from the renderer cache and performs zero `listRecordings()` calls.
- [ ] A device erase waits behind an in-flight serialized operation and begins only after that operation settles.
- [ ] `{ result: "failure" }` is queued/reported as failure and can never produce a success toast.
- [ ] `{ result: "not-exists" }` clears renderer and persistent cache projections and removes the stale row without another device scan.
- [ ] A queued or failed device erase remains discoverable on the Device page, not as an ordinary Library source.
- [ ] Successful single and bulk permanent deletion apply the same cache and suppression rules.
- [ ] A confirmed 13-item device purge cannot be reconstructed as 13 raw device-only rows from the pre-delete renderer cache.
- [ ] A failed device-only erase keeps its row and offers Retry instead of reporting generic completion.
- [ ] Reconciliation failures produce the existing honest stale-view warning.
- [ ] Screen-reader announcements cover both local removal and device erasure stages.
- [ ] Focused unit/component tests pass without USB access.

## Test Contract

1. `HiDockDeviceService` cache test: removing one confirmed-deleted filename preserves all siblings and does not call the Jensen client.
2. `useUnifiedRecordings.refreshLocal` fixture: provide `recordings.getTrash`; prove local rebuilds remain scan-free.
3. Library regression: successful main-process device deletion invalidates the renderer cache before `refreshLocal()`.
4. Library regression: a purged filename is filtered from Library even while the unified store still projects a stale device-only row.
5. `SourceRow` component: deleting state is announced, disables activation, shows no overflow trigger, and preserves the fixed 48 px compact-row contract.

## Out of Scope

- Changing Jensen protocol commands or USB timing.
- Adding cancellation after the irreversible local hard purge begins.
- Removing the existing purge tombstone or allowing automatic re-download.
- Hiding a surviving purged file from the Device/Sync inventory.
