# SPEC-012: Capability-Driven Library Filters and Operations

## Status

- **State:** Implemented and verified in the running Electron app
- **Owner surface:** Electron Knowledge Library and Operations feedback
- **Date:** 2026-08-24
- **Amends:** SPEC-008 selection semantics and the deferred multi-artifact section of
  `src/features/library/docs/filter-architecture.md`
- **Safety boundary:** Validation MUST NOT scan, open, or otherwise probe a HiDock USB device. Existing app state may be
  observed, but automated tests use mocks.

## Problem and observed evidence

The Library currently presents itself as a universal knowledge hub while its controls still assume every source is an
audio recording. In the running app this causes concrete operating failures:

1. The header reports **1 on device only**, but the text is not actionable and the exact state is buried behind a
   two-mode, overlapping location model.
2. The type strip is hardcoded to All, Audio, Images, PDFs, and Notes instead of reading the artifact-type registry used
   by imports and add-ons.
3. Selecting Images or PDFs narrows the list, but the filter panel still offers audio Duration, meeting-only categories,
   transcription-oriented status and actions. Hidden incompatible filters can silently produce an empty list.
4. The `Inclusive` versus `Exclusive` switch asks users to understand set accounting instead of asking where a source
   actually exists.
5. Opening a row also selects it for bulk work. That exposes Download, Transcribe, Move to Trash, and Delete permanently
   for a single image even though the user only opened it.
6. Bulk and header actions are derived from recording state, not artifact capabilities. Non-audio captures can therefore
   be offered meaningless transcription or device actions.
7. Type counts, advanced-filter counts, and active state are computed in multiple places, making it easy for visible
   controls and the actual query to disagree.
8. During transcription the app exposes no stable percentage or named stage. Earlier progress percentages reported
   outside the UI were inferred from logs and MUST NOT be presented as user-visible progress.
9. Failed-operation counts can remain stale after successful retries, errors collapse distinct causes into generic
   failure, and recovery context is difficult to inspect or copy.
10. A source change can briefly retain stale prior-source content in the accessibility tree.
11. The reader is allocated before a source is opened, wasting most of the workspace on a generic empty message and
    compressing the list that the user is actually operating.
12. Reader actions and section separators do not form a coherent hierarchy: the divider touches the action buttons,
    metadata is starved, and a no-transcript/device-only source receives a full empty document canvas.
13. Operations recovery is incomplete: **View source** can leave the Library context, Back does not reliably restore the
    prior screen, failed work cannot be dismissed, and a successful retry can leave the old failure visible.
14. A durable row whose only location is `deleted` can be re-projected as device-only. That creates a ghost source with
    a Download action even after the device has already confirmed deletion.
15. Library maintained a private connection boolean while the title bar and Device Sync used the canonical app store.
    After the initial Library load cleaned up its combined effect, its device listeners were not re-subscribed. The
    title bar could truthfully show **H1E** while Library said **Device disconnected** and disabled Download/Delete.

These are specification failures: the UI shipped a recording-specific query model on a multi-artifact surface and left
the add-on contract, incompatible-filter behavior, selection semantics, and operational truth undefined.

## Product decisions

### 1. Type is a registry facet

The Library MUST render artifact types from a renderer-safe descriptor projected by the main-process artifact registry.
The descriptor contains stable `id`, singular/plural labels, extensions/MIME types, and capabilities. Audio remains a
built-in legacy descriptor until its storage path is folded into the artifact service.

An add-on registers a type once. The import picker, classifier, type facet, row metadata, filters, preview, and actions
MUST consume that registration; adding a type MUST NOT require editing a hardcoded Library switch.

When more than four populated types exist, the first four remain directly visible and the rest use one accessible
**More types** control. Zero-count types do not consume prime toolbar space unless currently selected.

### 2. Availability is exact

The primary availability values are mutually exclusive:

- `device-only` — original exists on the connected HiDock and no local usable copy exists;
- `local-only` — usable local copy exists and no device copy is known;
- `synced` — both device and local copies exist.

The Library MUST call the first value **On device only** everywhere. It MUST NOT expose `Inclusive`, `Exclusive`,
`Count as`, or overlapping `Device`/`Local` totals in the primary filter UI.

The header count is a button. Activating **N on device only** applies `type=audio` and `availability=device-only`, clears
incompatible audio sub-filters, closes bulk selection, and announces the resulting count.

### 3. Universal versus capability-specific facets

Always-valid controls:

- artifact type;
- in-list text search;
- exact availability when more than one state is present or a state is active;
- date/name sorting;
- processing state when present in the current scope.

Capability-specific controls appear only when the selected type supports them:

| Capability | Initial provider | Controls |
|---|---|---|
| `timed` | Audio | Duration filter and duration sort |
| `conversation` | Audio | Meeting/interview/1:1/brainstorm category |
| `rateable` | Any descriptor with actual ratings | Quality filter and quality sort |
| `transcribable` | Local audio | Transcribe / Process actions |
| `device-backed` | HiDock audio | Download and device-only availability |
| `previewable` | Image, PDF, text, audio | Open/read action |

Mixed **All** view exposes only facets valid across the mixed result. A type change MUST synchronously reset every active
filter and sort that the new type cannot support. A hidden filter MUST never continue changing results.

Future add-on facets (image dimensions, PDF page count, document author, connector account) are namespaced by type and
provided by the descriptor. The Library may render them only while that type is selected; it MUST NOT teach the core
Library about every add-on's fields.

### 4. Active filters are inspectable

Every active advanced filter MUST appear as a removable chip beside the toolbar. **Clear all** remains available when
two or more filters are active. The filter button badge counts exactly the visible active facets; type and text search
remain self-evident and are not double-counted.

### 5. Opening is not bulk selection

A plain click or Enter opens the source and clears bulk selection. It MUST NOT display the bulk toolbar. Ctrl/Cmd-click,
Shift-click, and the explicit Select all control enter bulk selection. The reader's active source and the bulk selection
are separate states and receive visually distinct treatment.

Bulk actions are the intersection of capabilities across the selected items:

- show **Download** only when at least one selected item is device-only;
- show **Transcribe** only when at least one selected item is local and transcribable;
- never pass images, PDFs, notes, or unknown add-on types to the transcription queue;
- destructive actions remain available only as deliberate bulk-selection actions with their existing confirmation.

### 6. Operational truth

The Operations surface MUST display provider-backed progress only. If an engine cannot provide a numeric percentage, the
UI shows a named stage and elapsed time, such as **Preparing audio**, **Diarizing**, **Uploading**, **Transcribing**,
**Saving**, or **Finalizing**. It MUST NOT invent or interpolate a percentage.

Each failed operation MUST expose:

- the source name and failed stage;
- the provider/runtime and attempt count;
- a concise cause and the exact retained error in copyable details;
- whether retry is automatic, manual, unavailable, or already succeeded later.

Successful retry MUST resolve the corresponding stale failure badge. Switching the active source MUST atomically replace
reader content and its accessible description; stale content from the prior source is not allowed.

### 7. List-first workspace and source reader

Before a source is opened, the list owns the complete Library workspace. The reader is not rendered as an empty pane.
Opening a source contracts the list into a navigable source rail and reveals the reader beside it.

The reader header MUST use this order:

1. source identity and operational status;
2. high-value metadata in a responsive grid;
3. one action row with capability-derived primary and secondary actions;
4. a clearly separated disclosure for secondary metadata;
5. source content.

The action row has bottom spacing before the section separator. **Download**, **Ask about this source**, and the overflow
menu are part of the same action group; the separator MUST NOT touch their focus rings or button borders.

When content is unavailable, the reader shows a compact, contextual state rather than a document-sized blank canvas:

- device-only audio: **Stored on HiDock**, the next required action, and connection requirement;
- local audio without transcript: player/waveform first, followed by a compact transcript prompt;
- image/PDF/text: the registered preview reader or an honest unsupported-preview state.

### 8. Operations recovery and navigation

The failed-operation surface is an actionable history, not a dead notification list.

- **View source** always opens the Library reader with a normal history push. Browser/App Back returns to the exact
  previous surface.
- Existing Library filters remain intact when an operation opens a source. If those filters exclude it, the reader still
  opens and the source rail explains that the source is outside the current filters. **Show source in this list** is an
  explicit user choice that clears the conflicting query.
- **Retry** enters a visible busy state and reports whether work was queued. It never fabricates progress.
- **Dismiss** removes one terminal transcription or download failure from actionable history without deleting the source.
- **Clear failures** dismisses terminal transcription and download failures in bulk.
- A failed download remains visible from durable main-process queue state even when it is omitted from the active
  renderer queue, including after restart. Retry is only offered while the source still exists and is device-backed;
  an unavailable source is labelled **Source unavailable** and offers Dismiss, never Retry.
- When a transcript was created after a failed attempt, the failure is superseded and absent from the actionable
  projection. A pre-existing older transcript does not hide a newer failed re-transcription. Every badge derives from
  that same projection.

### 9. Deleted-source lifecycle

`location='deleted'` is a tombstone, not an availability state. A row in that state with neither a local path nor a
current device-cache entry MUST be excluded from live Library queries and MUST NOT expose Download, Transcribe, or Ask
actions. Historical operation details may identify the filename, but must label the source **Source unavailable**.

For `2026Aug18-210520-Rec99.hda`, the running app and retained Jensen log established this sequence:

1. two successful `CMD_DELETE_FILE` exchanges targeted the exact filename;
2. a later normal in-app download entered the real transfer path and failed at 0 bytes with `USB transfer failed`;
3. reconciliation returned `Not found anywhere`;
4. the database retained metadata only: `location='deleted'`, `on_device=0`, `on_local=0`, `file_path=NULL`;
5. the device-file cache contained no matching entry.

The correct recovery is therefore to remove the ghost source from the live Library and keep the failed operation as
honest history—not to retry or probe the USB device.

### 10. One device-connection state

The app-store device state maintained by `OperationController` is the canonical reactive connection source for the
title bar, Device Sync, Library actions, and every other renderer surface. Library MUST NOT mirror that state in a
component-local boolean. Device-service events may trigger cache/list refreshes, but they do not create a second
connection truth.

Connection/status subscriptions MUST live for the whole Library mount. They MUST NOT share a one-shot initial-load
effect whose dependency update can run cleanup and then skip re-subscription. The universal Library subtitle shows
source count and actionable source availability only; it does not duplicate the global device pill with a disconnected
label. A device requirement appears contextually on device-only actions/readers.

### 11. Reader workspace layout

The source reader is a workspace, not one long page with a waveform that changes shape as a side effect of scrolling.
The context area (player and metadata) and reading area (summary and transcript) are separated by a keyboard-focusable,
draggable horizontal handle. The chosen height allocation persists across sources and app restarts.

Player, metadata, summary, and transcript each expose the same explicit layout vocabulary:

- **Expanded** shows the section's normal content.
- **Minimized** leaves a labelled section header; the player becomes a small player rather than disappearing.
- **Docked** keeps the section open and its header at the top of its scroll area. A docked player uses the small-player
  presentation and never changes because the transcript was scrolled.
- **Hidden** removes the section completely and adds a visible **Show [section]** recovery control.
- **Maximized** temporarily gives that section the reader workspace, collapses the source list, and provides a labelled
  **Return to reader** control that restores the list's prior collapsed state.

Scrolling MUST NOT mutate a section mode. Maximizing is transient; section modes and vertical split sizes persist.
The source identity and primary actions remain available as reader-level context rather than belonging to metadata.

## Required ordering

```text
registry/add-on registration
  -> renderer-safe type descriptors
  -> classify captures
  -> compute facet counts from the unfiltered eligible corpus
  -> apply type
  -> discard incompatible filters/sort
  -> apply exact availability and supported advanced facets
  -> apply in-list search
  -> derive row and bulk actions from capabilities
  -> render/announce one coherent result
```

## Failure behavior

| Condition | Required outcome |
|---|---|
| Registry IPC unavailable | Use built-in descriptors, show existing captures, log one recoverable diagnostic |
| Add-on descriptor is invalid | Ignore that descriptor; do not break built-in filters |
| Selected add-on is disabled/removed | Fall back to All and clear its namespaced facets |
| Type change conflicts with duration/category sort | Reset conflict before computing/rendering the new result |
| Availability state has zero matches | Hide it unless active; an active stale state remains visible with count 0 and removable |
| Selected items have mixed capabilities | Show only actions with at least one eligible target; handler processes eligible targets only and reports skipped count |
| Engine has no numeric progress | Show stage + elapsed time, never a fabricated percentage |
| Retry later succeeds | Resolve the old failure entry and refresh all failure badges |
| View source while filters exclude it | Open the reader, preserve filters, explain the mismatch, and offer an explicit reveal action |
| Durable source location is `deleted` | Exclude it from the live Library; operation history says Source unavailable |
| Device-only source is disconnected | Keep Start download disabled and state that the HiDock must be connected |
| Global device state changes | Every renderer surface updates from the same store; refresh listeners remain subscribed |
| No source is selected | Give the full workspace to the source list; do not render an empty reader pane |
| A reader section is hidden | Remove it completely and keep a visible, keyboard-accessible restore control |
| A section is maximized | Collapse the list temporarily; Return to reader restores its exact prior state |
| Collapsing/reopening replaces the list scroll element | Rebind virtualization to the replacement element and render the populated list immediately |

## Acceptance criteria

- [x] Clicking the header's **1 on device only** count immediately shows that exact audio source.
- [x] The filter panel contains no Inclusive/Exclusive switch.
- [x] Selecting Images or PDFs removes Duration, duration sort, and conversation categories.
- [x] Switching away from Audio clears an active duration/category filter and an incompatible duration sort.
- [x] Type controls are generated from artifact descriptors; a test add-on appears without changing `LibraryFilters`.
- [x] Empty registered types do not bloat the primary strip; overflow remains keyboard accessible.
- [x] Active availability/status/category/quality/duration filters are visible and individually removable.
- [x] Plain row click opens the reader without showing the bulk toolbar.
- [x] Image/PDF selection never offers or invokes Transcribe; device-only audio selection exposes Download.
- [x] Search placeholder and result announcement describe the post-facet corpus accurately.
- [x] No displayed transcription progress percentage exists unless supplied by the operation provider.
- [x] Failed operations retain stage, cause, attempt, retry state, and copyable details; later success clears stale failure counts.
- [x] Failed operations provide View source, Retry, Dismiss, and Clear failures according to source/queue state.
- [x] View source opens the Library with a history push; Back returns to the prior surface and active filters remain intact.
- [x] A source excluded by active filters still opens in the reader and exposes an explicit Show source in this list action.
- [x] Source changes leave no stale prior-source text in the visible or accessibility tree.
- [x] With no source selected, the list occupies the workspace; selecting one reveals the reader and contracts the list.
- [x] Reader actions have deliberate spacing; metadata precedes content; empty transcript/device states are compact.
- [x] A draggable, keyboard-focusable handle reallocates height between context and reading areas and persists the split.
- [x] Player, metadata, summary, and transcript support expanded, minimized, docked, hidden, and maximized states.
- [x] Maximizing survives the pane remount, and returning restores a populated virtualized source list.
- [x] Scrolling never changes the player presentation; dock/minimize are explicit persisted choices.
- [x] Hidden sections remain recoverable, and maximizing/restoring preserves the source list's prior state.
- [x] `location='deleted'` rows are excluded from live Library queries and cannot be offered for download.
- [x] Library and the title-bar pill derive connection state from the same reactive store and cannot contradict.
- [x] A connected-device event still refreshes the Library after its initial loaded state is committed.
- [x] Visible and assistive result counts update on both filter application and filter clearing.
- [x] Focused component, store, main-process registry, and renderer type tests pass without USB access.
- [x] The redesigned flow is verified in the running Electron app with Audio, Image, and PDF views.

## Out of scope

- Changing Jensen commands, timings, connection behavior, or scanning the hardware.
- Inventing metadata that an artifact type or operation does not provide.
- Shipping every future add-on-specific facet in this implementation; this spec defines the contract they plug into.
