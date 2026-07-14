# T6 — F17: True "delete everywhere" — device checkbox + purge extensions (Phase 3)

## Objective
ONE flow can remove a capture from: device, local disk, all derived data, RAG, and the knowledge graph — each part explicit and confirmable.

## Current state (verified facts)
- Hard purge chain: recordings:deleteCascade IPC (electron/main/ipc/recording-deletion-handlers.ts) → recording-deletion-service.ts `deleteRecording(id,{hard:true})` → database.ts `deleteRecordingCascade` (removes transcripts, embeddings, vector_embeddings, knowledge_captures + children [action_items, decisions, follow_ups, outputs, audio_sources, conversation_context, knowledge_projects, artifacts, actionables], speaker tables, meeting candidates, transcription_queue, quality_assessments, preassignments, synced_files, recomputes meeting participants, deletes recordings row, journals) → service unlinks audio + wiki + artifact blobs + syncs in-memory vector store. Device copy NEVER touched (explicit design comment: USB safety). Graph + graph_ingested_transcripts NOT touched. deletion_journal keeps full `recording_snapshot` JSON.
- Device deletion exists separately: `getHiDockDeviceService().deleteRecording(deviceFilename)` (renderer service → jensen IPC → main-process Jensen DELETE_FILE cmd 7). Used by Library device-only path + Device page. USB-safe pattern already established (single command, no probing).
- deletionImpact IPC returns counts for the confirm dialog (transcripts/actionItems/embeddings/captures/artifacts/meetingLinks/hasAudioFile).

## What's missing
1. **"Also delete from device" checkbox** in the permanent-delete dialog: visible when the recording is on-device (`on_device`/location includes device) — enabled only when device connected; default UNCHECKED. When checked: after a successful local hard purge, issue the device delete via the EXISTING renderer device-service path (one Jensen DELETE_FILE; no retries beyond existing service behavior; failure = show honest partial-result toast "removed locally; device copy still present" and leave the device file listed on next scan).
   - Ordering decision: local purge first, then device delete (device failure must not orphan local state); document why.
   - The synced_files/device-cache rows for the deleted filename: verify next scan reconciles (markRecordingsNotOnDevice path) — state expected behavior in tests with a mocked device service.
2. **Purge extensions** (main process): hard cascade additionally (a) calls Phase-2 `removeRecordingFromGraph(recordingId)` (guarded — graph failure must not fail the purge; log + report), (b) deletes `graph_ingested_transcripts` rows (redundant with (a) but keep in cascade for safety), (c) journal policy: replace full `recording_snapshot` with minimal `{filename, original_filename, duration_seconds, mode, created_at}` for HARD deletes (privacy: a purge shouldn't retain the full row incl. meeting linkage/paths) — soft journal unchanged (needed for restore fidelity).
3. **deletionImpact extension**: include graph counts (from Phase-2 API dry-run/count mode) + on-device presence so the dialog states the full blast radius.
4. Tests: mocked device service (deleteRecording resolves true/false) covering checkbox flows incl. device-failure partial path; cascade calls graph cleanup (mock @hidock/knowledge-graph service seam); journal snapshot minimization for hard mode; impact counts include graph numbers.

## Dependencies
- Phase 2 cleanup API (T4). UI copy coordinates with T5.

## Constraints
- **USB SAFETY (absolute)**: implementation + tests NEVER touch real hardware — mocks only; do not add retries/probing around DELETE_FILE; reuse the existing single-command service path unchanged.
- Fixture/temp DBs only; non-interactive commands; graph cleanup failure is non-fatal to the purge (guarded, reported).
