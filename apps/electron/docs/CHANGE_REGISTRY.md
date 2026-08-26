# Electron Change Registry

This append-only registry records behavior changes that amend a specification or close a production incident. Each
entry names the governing spec, implementation boundary, tests, and known remaining work.

## CHANGE-2026-08-24-002 — Honest Community-1 access diagnosis in Settings

- **Date:** 2026-08-24
- **Status:** Implemented and validated without device access
- **Governing spec:** `spec/SPEC-011-persistent-acoustic-speaker-linking.md`

### Problem

The app stored a Hugging Face token and told the user to accept Community-1 conditions, but did not verify either the
token or the gated model. An invalid/expired token, a token from another account, and genuinely pending model conditions
all surfaced as the same opaque 401/fallback behavior. The token control was also hidden whenever Gemini was selected,
even though persistent acoustic speaker linking runs before Gemini.

### Decision and implementation

- Expose speaker-model access independently of the transcription provider.
- Validate the saved token against Hugging Face identity before testing a fixed Community-1 model file.
- Distinguish missing token, rejected token, pending conditions, granted access, timeout, and network/server failure.
- Show the validated account name when Hugging Face supplies it, without logging or rendering the token.
- Add official `Review model access` and explicit `Check again` actions; keep the actual 3.1 fallback honest in Tools
  metadata.
- Restrict external navigation and token transmission to fixed official `https://huggingface.co` endpoints.

### Verification

- The signed-in work-browser account reports that Community-1 access is already granted.
- The token currently saved by the app independently returns HTTP 401 for both identity and Community-1, proving this
  incident is a rejected token, not missing acceptance on the signed-in account.
- Focused main/renderer tests: 23 passed. Electron node and web typechecks passed.
- No HiDock USB access or application launch was used.

## CHANGE-2026-08-24-001 — Pre-ASR persistent acoustic speaker linking

- **Date:** 2026-08-24
- **Status:** Implemented; code tests, production build, and Windows/CUDA synthetic-audio worker contract validated
- **Governing specs:** `spec/SPEC-009-recording-enrichment-transcription-pipeline.md` and
  `spec/SPEC-011-persistent-acoustic-speaker-linking.md`

### Problem

The app recorded `Voice ID · not-available` after transcription and used only self-identification or calendar/LLM
context. It had no acoustic memory, so the same voice could receive different speaker labels within or across calls,
and a roster guess could look stronger than its evidence.

### Decision

Run local pyannote diarization and embedding extraction before ASR, preferring Community-1 and recording the actual
compatible 3.1 fallback when Community-1 access is not granted. Match anonymous voices across recordings with a strict
similarity threshold plus runner-up margin, and attach a real contact only after manual or explicit first-person
evidence. No dedicated enrollment recording is required and the capability is not used for authentication.

### Implementation

- Added the packaged Python worker contract and CUDA-oriented runtime setup script.
- Added v53 `voice_clusters`, `voice_cluster_observations`, and `recording_voice_clusters` persistence.
- Added normalized cosine matching, same-recording exclusivity, duration-weighted centroid updates, and reprocess-safe
  evidence replacement.
- Added pre-provider diarization and voice-linking processing runs and provider-context acoustic manifests.
- Reconciled provider speaker labels to independent local segments by temporal overlap.
- Added manual and self-identification contact anchoring; roster inference cannot anchor a global voice.
- Added contact delete/merge/unmerge handling and hard-purge centroid rebuilding.
- Personal, soft-deleted, and value-excluded recordings now immediately remove acoustic evidence and rebuild affected
  centroids.
- Added FFmpeg-to-memory audio decoding so Windows execution does not depend on torchcodec native DLL loading.
- Replaced the hard-coded `not-available` provenance placeholder with the actual model/run/status.

### Verification

- Focused speaker-linking tests cover threshold/margin, centroid updates, temporal reconciliation, v53 schema,
  source-lifecycle cleanup, explicit contact anchoring, and truthful fallback provenance.
- Transcription, database, contact identity, recording-deletion, value-classification, and value-rating suites pass
  (254 tests total).
- Electron node and web typechecks pass.
- Electron production build passes.
- The isolated Python 3.11 runtime loaded pyannote 4.0.7 on an RTX 4090/CUDA and completed the worker contract using
  synthetic silence; Community-1 correctly returned gated access and the worker completed with the 3.1 fallback.
- No real USB device, app launch, or production audio was used.
- A complete Electron run passed 5,483 tests; 14 unrelated tests plus one performance suite remain red from existing
  stale Library/meeting/trash/timeout mocks in the shared dirty worktree. All eight failures caused by the v53/anchor
  contract change were updated and pass.

### Known remaining work

Thresholds need calibration on a labeled HiDock-channel set. A voice-memory review/forget/merge/split UI and clean
installer validation of the Python/CUDA runtime remain open. The preferred Community-1 path also needs its model terms
accepted; the currently validated local 3.1 fallback remains truthful and usable. If neither local model/runtime is
accessible, the processing run reports `unavailable` and uses the explicit provider-managed diarization fallback.

## CHANGE-2026-08-14-001 — Fail-closed no-speech transcription gate

- **Date:** 2026-08-14
- **Status:** Implemented and validated
- **Governing spec:** `spec/SPEC-009-recording-enrichment-transcription-pipeline.md`
- **Incident fixture:** `2026Aug14-170410-Rec73` (174.85 seconds; cough/noise only; approximately 99% silence)

### Problem

The production path treated a provider-managed transcription response as VAD evidence. Calendar candidates and their
descriptions were passed to Gemini before any independent audio-content gate. Gemini fabricated a meeting transcript,
summary, title, action items, speakers, and a link to a cancelled calendar event.

### Decision

Automatic and manual transcription now run a local ffmpeg energy/silence safety gate before the first provider call.
A long recording with less than three seconds and less than 3% non-silent activity terminates as `no_speech`. The
terminal result is visible and auditable, and it creates no downstream derived content. Preflight failure blocks the
provider. Provider timestamps are additionally checked against local activity intervals.

### Implementation

- Added `audio-preflight.ts` with versioned `energy-vad-safety-v1` thresholds and activity manifest.
- Added `NoSpeechDetectedError` and Gemini's exact `[NO_SPEECH]` contract.
- Added the durable/visible `no_speech` status across main/renderer types, mapping, badge, legend, and reader state.
- Separated the local VAD run from provider-managed diarization/transcription runs.
- Blocked summary, title, participant/action extraction, meeting resolution, and other downstream work on no speech.
- When a reprocess proves `no_speech`, retires the prior transcript, embeddings, knowledge-graph provenance,
  transcript-derived actionables,
  transcript meeting/contact/project memberships, AI capture summary/quality, and automatic meeting link while
  preserving the source recording, immutable filename, user title, manual meeting link, and processing-run audit.
- Raised automatic meeting-link confidence to 0.85, required content evidence and a 0.15 margin, and excluded cancelled
  event subjects from positive candidate context/automatic linking.
- Bundled `ffmpeg-static` and unpacked its executable for packaged Electron builds.
- Corrected the explicit re-transcription gate: an old AI-generated `garbage/low-value` rating no longer cancels the
  corrective local VAD pass before it starts. Deleted, personal, and missing recordings remain blocked. This closes the
  Rec73 regression where the UI changed queue/value indicators but retained the old fabricated transcript because no
  new local VAD processing run was created.
- Corrected the primary `Re-transcribe` button, which previously returned without queueing whenever the recording was
  already complete. It now uses the configured provider through the explicit corrective-reprocess IPC, matching the
  provider dropdown's real behavior.

### Verification

- Unit: cough-only/noise fixture, sustained-activity fixture, fail-closed parsing.
- Provider: exact no-speech sentinel and context-is-not-speech prompt contract.
- Quality: ungrounded provider speaker turns fail local activity validation.
- Required gates: Electron node/web typecheck and focused Vitest suites.
- Regression: an existing AI-garbage transcript can be explicitly reprocessed to `no_speech`; the cleanup runs and
  Gemini/provider call count remains zero.

### Known remaining work

See SPEC-009 Section 18.1. This change is the hallucination-prevention safety floor; it does not claim semantic VAD,
production WhisperX/pyannote, Voice ID, full diarization tail reconciliation, or complete cost telemetry.

## CHANGE-2026-08-18-002 — Bounded device reconciliation and reliable auto-download handoff

- **Date:** 2026-08-18
- **Status:** Implemented and validated with mocks
- **Governing spec:** `spec/SPEC-009-recording-enrichment-transcription-pipeline.md`
- **Incident fixture:** 322 cached device files, approximately 2,000 Library recordings, and 18 eligible queue rows left
  `pending` during one device-ready cycle

### Problem

A complete device catalog was handled as hundreds of individual new-recording discoveries. Device-native `.hda` names
were upserted before factual local-sync resolution, even when the canonical local row used a converted extension and
stored the device name as `original_filename`. Each item emitted `recording:new`; the renderer logged/toasted it and
attempted a full multi-source Library rebuild. The genuinely unsynced files were persisted and queued, but execution
relied on a renderer-observed state-update edge and could remain `pending`. Unexpected disconnect handling also scheduled
multiple quick connection attempts.

### Decision

Device lists are reconciled as snapshots. Canonical identity is resolved before insertion or enrichment, already-synced
history is silent, and a snapshot publishes at most one discovery notification. Persisting a new auto-download session
is followed by an explicit idempotent drain call to the single queue owner. Unexpected disconnects receive one guarded
quick reconnect attempt; the existing low-frequency watcher is the only backstop.

### Implementation

- Match device-native filenames through both `filename` and `original_filename`; reconcile presence using normalized
  base identity and preserve local file facts.
- Check factual local/synced state before metadata upsert or enrichment and suppress historical discovery events.
- Batch newly discovered snapshot rows into one main-to-renderer event; coalesce legacy bursts into one toast and one
  cache-only Library rebuild without another USB file-list request.
- Explicitly drain the download queue after session creation in device-ready, initial-ready, and recording-reconcile
  paths. The existing mutex preserves one transfer owner.
- Reduce unexpected-disconnect quick recovery from multiple scheduled attempts to one guarded attempt.

### Verification

- Database: native `.hda` discovery updates the existing local `.wav` row and device-presence reconciliation uses the
  native original filename.
- Download service: 500 newly eligible files produce one batched event; 500 already-synced historical files produce no
  event or enrichment.
- Renderer: a discovery burst produces one cache-only four-source aggregation.
- Auto-sync: one ready cycle creates one session and one explicit queue drain; duplicate ready state does neither again.
- Connection safety: one unexpected disconnect creates exactly one guarded quick recovery attempt in mock timers.
- Required gates: Electron node/web typechecks and focused Vitest suites. No real USB access was used.

### Known remaining work

The change restores the download execution handoff; transcription remains correctly downstream of local-file readiness,
preprocessing, candidate context, and the SPEC-009 gate. Semantic VAD, production WhisperX/pyannote, Voice ID, complete
diarization-tail reconciliation, full processing cost telemetry, and the remaining responsive-reader viewport checks are
still incomplete as listed in SPEC-009.

## CHANGE-2026-08-18-003 — Consistent operation state and bounded renderer reconciliation

- **Date:** 2026-08-18
- **Status:** Implemented and validated with mocks
- **Governing spec:** `spec/SPEC-009-recording-enrichment-transcription-pipeline.md`
- **Incident fixture:** approximately 2,000 terminal transcription rows, 16 actionable rows, and Library rows showing
  `Synced`/`Not transcribed` while Operations showed queued downloads/transcriptions

### Problem

The renderer requested and scanned the complete transcription queue history every five seconds. At production scale,
that serialized roughly 2,000 terminal rows to maintain a small active queue and caused periodic input stalls. Library,
Operations, bulk counts, the recordings table, and capture state also projected status independently: metadata-only
device rows appeared synced, active retranscriptions could look complete or untranscribed, and already-local files could
reappear in the restored download queue.

### Decision

Main owns durable queue/location facts; the renderer receives only actionable operations and applies each snapshot once.
Live events drive progress and a 30-second bounded poll only repairs missed events. Active operation state overrides old
derived output for display. Enqueue is idempotent per recording, and restart recovery reconciles download rows against
factual local state before exposing them.

### Implementation

- Added a bounded actionable queue projection (`pending`, `processing`, `failed`) for renderer synchronization.
- Replaced per-item hydration/poll mutations with one Zustand reconciliation transaction and changed the poll from five
  to 30 seconds.
- Prevented progress-only events from rebuilding the full Library recording projection.
- Derived `device-only`, `local-only`, and `both` from durable/factual presence instead of database-row existence.
- Made pending/processing status outrank an old ready capture and overlaid live queue status on Library/bulk counts.
- Deduplicated active transcription enqueue and persisted the recording's pending state in the same transaction.
- Removed already-synced restored download rows and reset interrupted in-progress rows to pending at zero progress.

### Verification

- Focused renderer/main/database/download/transcription suites: 284 tests passed.
- Regression coverage includes a device-only durable row, offline both-locations row, stale ready capture during
  reprocessing, single-store queue reconciliation, actionable-only IPC, active enqueue deduplication, and download
  restart recovery.
- Electron node/web typecheck passed after implementation.
- No real USB access or application launch was used.

### Known remaining work

See SPEC-009 Sections 18.1 and 18.3. This change addresses status correctness and the identified periodic queue-sync
slowdown; it does not complete acoustic diarization, Voice ID, semantic VAD, cost telemetry, or all responsive-reader
acceptance checks.

## CHANGE-2026-08-18-004 — Pre-download meeting identity and fail-closed Gemini turn timing

- **Date:** 2026-08-18
- **Status:** Implemented and validated with mocks/read-only production evidence
- **Governing spec:** `spec/SPEC-009-recording-enrichment-transcription-pipeline.md`
- **Incident fixture:** `2026Aug18-170709-Rec92.hda` (`Sync Arturo-Seba`, 35m45s)

### Problem

The deterministic schedule pass ran before transcription, but a cancelled overlapping event and harmless nearby events
were all counted as a conflict. The only viable meeting therefore was not assigned until transcript analysis, so the
Library retained the filename during download/transcription. After assignment, AI content title incorrectly remained the
primary source heading. The published ICS event omitted organizer/attendee properties, yet the UI asserted `Not
available`. Gemini returned turn boundaries at the end of utterances; the bare-speaker fallback stored each turn at the
chunk boundary and created a synthetic `you: 00:00` turn. A blocked identity run still displayed its attempted method as
if it had resolved speakers.

### Decision

Cancelled events are not viable candidates; conflict means multiple credible overlaps, not every buffered same-day
event. The official meeting subject is the source heading as soon as an assignment exists, including device-only rows;
filename and content title remain independent. Missing calendar people are explicitly source-missing, never inferred.
Trailing provider boundaries are normalized only with repeated structural evidence. Multi-turn output with collapsed
timestamps is retried once and then rejected rather than persisted. A blocked identity run is labeled `blocked`.

### Implementation

- Excluded `Cancelled`, `Canceled`, `Cancelada`, and `Cancelado` subject prefixes from deterministic scoring,
  persistence, and candidate IPC; content disambiguation does not run before a transcript exists.
- Defined schedule conflict from multiple credible overlapping candidates and preassigned a single strong overlap.
- Loaded linked meeting metadata for device-only rows, so the official subject can replace the filename heading before
  download completion.
- Changed source-title precedence to assigned meeting subject, then immutable filename. Moved content-title editing to
  its separately labeled metadata field.
- Replaced `Organizer: Not available` with `Not supplied by calendar` when ICS omits organizer data.
- Recovered Gemini's observed `Speaker N: text MM:SS` output into monotonic original-timeline turns without a bogus
  default speaker; added retry/fail-closed handling for repeated chunk-boundary timestamps.
- Made degraded/failed tool state visible in provenance chips and rendered blocked speaker identity as `blocked` rather
  than the attempted inference method.

### Verification

- Gemini parser/engine: trailing timestamps, chunk offsets, no synthetic `you`, spoken-clock guard, format retry, and
  persistent-invalid fail-closed behavior.
- Schedule/database: cancelled-overlap exclusion and immediate assignment of the sole viable `Sync Arturo-Seba` match.
- Renderer: official meeting subject heading, independent filename/content title, device-only meeting enrichment, and
  blocked identity provenance.
- Focused suites: 241 tests passed across transcription, database/scoring, unified recording mapping, title resolution, SourceReader, and SourceRow.
- Production database and ICS were inspected read-only; no real USB access or application launch was used.

### Known remaining work

The published ICS feed for the incident contains no `ORGANIZER` or `ATTENDEE` properties, so it cannot name Sebastian or
Arturo. An authenticated Microsoft 365/Graph calendar connector can supply that authoritative roster. Acoustic Voice ID,
production WhisperX/pyannote, semantic VAD, and historical repair/retranscription of already-corrupted transcripts remain
separate work; this change prevents the same malformed Gemini format from being accepted in future runs.
