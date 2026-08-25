# SPEC-011: Persistent Acoustic Speaker Linking

- **Status:** Implemented; local runtime validated on Windows/CUDA with automatic compatible-model fallback
- **Date:** 2026-08-24
- **Change registry:** `../CHANGE_REGISTRY.md` (`CHANGE-2026-08-24-001`)
- **Scope:** Electron recording pipeline, local acoustic diarization, cross-recording voice memory, contact identity
- **Amends:** SPEC-009 Sections 2, 4, 6, 10.6, 15, 16, and 18 where they require dedicated voice enrollment

## 1. Product decision

HiDock MUST use persistent acoustic speaker linking to keep the same voice stable within and across recordings. This is
not login, authentication, or security voice biometrics. The product MUST NOT require a separate enrollment ceremony or
a user reading a fixed phrase.

The app learns anonymous acoustic voice clusters opportunistically from ordinary, quality-validated recordings. A voice
cluster remains anonymous until independent evidence links it to a real contact. Acceptable anchors are:

1. an explicit user assignment of a diarized voice to a contact; or
2. high-confidence first-person self-identification attached to the same diarized voice.

Calendar membership, an LLM guess, a mentioned name, or a roster shortlist alone MUST NOT create a persistent
voice-to-person link. Acoustic similarity can recognize that two recordings likely contain the same voice; it cannot,
by itself, invent the person's real-world name.

## 2. Required ordering

For every transcription or re-transcription:

```text
local file ready
  -> independent VAD/no-speech gate
  -> local acoustic diarization + speaker embeddings
  -> cross-recording anonymous voice matching
  -> provider transcription with acoustic manifest/context
  -> reconcile provider turns to local acoustic voices
  -> summary, title, meeting resolution, and other provider analysis
  -> persist transcript
  -> apply previously anchored contact identities
  -> contextual self-identification / roster inference for unresolved voices
```

The acoustic pass MUST finish before the first ASR or Gemini audio request. A configured local capability that starts and
fails is a blocking preflight failure. A capability that is not installed, disabled, or inaccessible is recorded as
`unavailable`; provider-managed diarization MAY then run as an explicit fallback.

## 3. Model and execution contract

The preferred implementation uses `pyannote/speaker-diarization-community-1` locally and falls back to the compatible
`pyannote/speaker-diarization-3.1` pipeline when Community-1 access has not been granted. The actual model/version MUST
be returned and persisted; fallback MUST never be mislabeled as Community-1. The worker MUST return:

```typescript
interface AcousticWorkerResult {
  model: string;
  modelVersion: string;
  device: "cuda" | "cpu" | string;
  segments: Array<{ start: number; end: number; speaker: string }>;
  speakers: Array<{
    label: string;
    embedding: number[];
    speechSeconds: number;
    qualityScore?: number;
  }>;
}
```

The worker MUST write only JSON to stdout and diagnostics to stderr. It MUST run as a hidden child process, have a
bounded timeout, and be cancelled if the recording becomes personal, deleted, or otherwise ineligible. It MUST never
touch a HiDock USB device.

Embeddings are comparable only when `model`, `model_version`, and `embedding_dimension` all match. A model upgrade starts
a separate voice space; the app MUST NOT compare vectors across model spaces or silently rewrite old evidence.

## 4. Persistent data model

### `voice_clusters`

One global anonymous acoustic identity per model space:

- normalized centroid embedding;
- observation count and accumulated speech seconds;
- optional contact anchor, anchor method, and confidence;
- created/updated timestamps.

### `voice_cluster_observations`

One source-level piece of evidence:

- recording and local diarized label;
- normalized embedding and speech duration;
- quality, best similarity, and runner-up margin;
- target voice cluster.

### `recording_voice_clusters`

The per-recording projection:

- local acoustic label;
- stable transcript label;
- global voice cluster;
- result state: `matched`, `new`, or `needs_review`;
- similarity and runner-up margin.

The source embedding and match evidence MUST remain inspectable. A UI display label such as `Voice A1B2C3` is an
anonymous stable label, not a person profile.

## 5. Matching policy

1. Normalize every embedding before storage or comparison.
2. Ignore clusters with less than the configured minimum speech duration (default four seconds).
3. Compare only compatible model spaces using cosine similarity.
4. Require both an absolute similarity threshold (default `0.72`) and a margin over the runner-up (default `0.08`).
5. When either requirement fails, do not bind to an existing cluster. Return `new` or `needs_review` and preserve the
   evidence.
6. Do not assign two distinct diarized speakers in one recording to the same existing cluster automatically.
7. Update a matched cluster centroid using speech-duration weighting, then re-normalize it.
8. A re-transcription MUST replace that recording's prior observations before matching. It MUST rebuild affected
   centroids first so the same source is not counted twice.
9. Never force all voices to calendar invitees or known contacts.

Thresholds are conservative defaults, not universal scientific constants. They MUST be configurable and later
calibrated against HiDock-channel data with false-match/false-reject reporting.

## 6. Turn reconciliation

Provider transcript text and timestamps remain provider output. For each valid timed provider turn, the app finds the
local acoustic speaker with maximum temporal overlap. The speaker label is replaced by the stable anonymous voice label
only when overlap covers at least 35% of the provider turn. Otherwise the provider label remains unchanged and is
explicitly unresolved.

This reconciliation MUST NOT repair fabricated or invalid timestamps by inventing time. Existing VAD/timestamp quality
gates still reject ungrounded, zero-duration, non-monotonic, or materially uncovered transcript output.

## 7. Real-person anchoring

- Manual assignment anchors the mapped voice cluster at confidence `1.0`.
- Accepted first-person self-identification anchors it at confidence `0.97`.
- Contextual/calendar/LLM speaker inference may label the current recording but MUST NOT anchor the global cluster.
- Once anchored, later high-confidence acoustic matches may create a recording-scoped `transcript_speakers` binding to
  that contact.
- An existing manual recording-scoped binding always wins.
- Contact merge repoints anchored voice clusters and unmerge restores the clusters recorded in the merge manifest.
- Contact deletion clears the contact anchor but preserves the anonymous acoustic cluster.

## 8. Deletion, privacy, and eligibility

Hard deletion MUST remove the recording's observations and mappings. Every affected centroid MUST be rebuilt from the
remaining observations; a cluster with no remaining evidence MUST be deleted. Re-transcription follows the same
replace-and-rebuild rule.

Soft-deleted, personal, and value-excluded recordings MUST not be newly processed or used as matching evidence. Their
acoustic observations MUST be removed immediately and affected centroids rebuilt. Restoring or reclassifying content
does not silently restore old voice evidence; a deliberate re-transcription may rebuild it. A future retention control
MAY allow users to clear all voice memory without deleting transcripts; that UI is not required for the initial pipeline
implementation.

## 9. Provenance and UI

The reader MUST show independent processing chips/runs for:

- `Diarization · pyannote · community-1 · <version> · local`; and
- `Voice ID · persistent acoustic speaker linking · <model> · local`.

Run details MUST show availability/fallback, CUDA/CPU device, thresholds, counts of matched/new/review voices, and count
of contact-anchored voices. `self-id+trusted-roster` MUST remain a separate contextual identity method. The UI MUST NOT
label roster inference as an acoustic match.

Settings MUST expose the Community-1 access state independently of the selected transcription provider because the
local acoustic pass also precedes Gemini transcription. A stored token is not evidence of access. The app MUST verify:

1. that Hugging Face accepts the token; and
2. that the same token can read a gated Community-1 model file.

The UI MUST distinguish `token missing`, `token rejected`, `model conditions pending`, `access granted`, and
`check unavailable`. It MUST provide a direct action to review the conditions on the official model page and a separate
retry action. It MUST identify the validated Hugging Face account when available, never render the token in status or
logs, and explain that the actual compatible fallback remains visible in processing metadata.

## 10. Failure behavior

| Condition | Required outcome |
|---|---|
| Feature disabled | `voice-id: unavailable`; explicit provider fallback allowed |
| Worker/interpreter/dependency absent | `unavailable` with exact reason; explicit provider fallback allowed |
| Preferred gated model access absent | try the declared compatible local fallback and record its actual model/version |
| Saved token is invalid or expired | show `token rejected`; do not misreport this as unaccepted model conditions |
| Token valid but conditions not accepted | show `model conditions pending` with official review action |
| Access check offline/timed out | show recoverable `check unavailable`; do not claim either granted or denied |
| Preferred and fallback model access absent | `unavailable` with exact reason; explicit provider fallback allowed |
| Worker starts but audio/model execution fails | acoustic run `failed`; no provider audio request |
| Recording becomes ineligible | worker cancelled; no provider audio request or persistence |
| No speaker has minimum speech | valid empty anonymous result; transcript may proceed |
| Close best and runner-up matches | `needs_review`; no existing-cluster/contact binding |
| Known cluster has no contact | stable anonymous label only |
| Known cluster has anchored contact | recording-scoped contact binding after transcript persistence |

## 11. Acceptance criteria

- [x] Acoustic diarization and matching are invoked before transcription.
- [x] The worker provides timestamped speakers and one embedding per speaker.
- [x] Voice memory persists separately from transcript labels and contacts.
- [x] Matching requires threshold plus runner-up margin and can return unknown/review.
- [x] Re-transcription removes old observations and rebuilds centroids before rematching.
- [x] Provider turns are reconciled by temporal overlap without inventing timestamps.
- [x] A manual or self-ID anchor can attach a cluster to a real contact.
- [x] Calendar/LLM inference cannot anchor a persistent cluster.
- [x] Known anchored voices create recording-scoped speaker bindings without overwriting an existing binding.
- [x] Tool/model/version/execution/status are represented by processing runs and existing provenance chips.
- [x] Hard purge removes source evidence and rebuilds/deletes affected clusters.
- [x] Personal, soft-deleted, and value-excluded sources immediately lose acoustic evidence.
- [x] Contact delete and merge preserve honest anchor state.
- [x] All code-level tests run without a real USB device or production audio.
- [x] Windows/CUDA worker contract validated with synthetic audio and the 3.1 fallback.
- [x] Settings validates token identity and gated Community-1 file access as separate checks.
- [x] Settings shows an official access-review action, retry, recoverable network state, and honest fallback copy.
- [ ] Calibrate thresholds on a labeled HiDock-channel evaluation set and publish FAR/FRR/DER results.
- [ ] Add an owner-facing voice-memory review/forget/merge/split interface.
- [ ] Accept the Community-1 model terms and validate its preferred-path output on a clean installer image.

## 12. Normative test cases

1. **Clear recurring voice:** one candidate exceeds `0.72` and beats the runner-up by `0.08`; match the existing
   anonymous cluster.
2. **Close candidates:** two candidates exceed the threshold but differ by less than `0.08`; create no automatic match
   and mark `needs_review`.
3. **Weak candidate:** best similarity is below threshold; create a new anonymous cluster.
4. **Two speakers, one recording:** both embeddings resemble one prototype; at most one may use that prototype.
5. **Short cough/noise:** speaker duration is below minimum; create no voice observation and do not defeat the
   independent no-speech gate.
6. **Re-transcription:** the old observation disappears, cluster counts do not double, and the centroid reflects only
   current plus other surviving evidence.
7. **Manual identity:** assigning `Voice ABC123` to Arturo anchors only that cluster and later matches bind Arturo.
8. **Roster guess:** contextual inference proposes Arturo but creates no `voice_clusters.contact_id` anchor.
9. **Provider label drift:** provider calls the same person `Speaker 1` then `Speaker 3`; temporal overlap reconciles both
   to the same stable anonymous voice where evidence is sufficient.
10. **Invalid timestamps:** acoustic matching succeeds but provider turns fail grounding; the transcript is rejected,
    while the successful acoustic processing run remains truthful.
11. **Hard purge:** delete one of several observations; the cluster centroid/count is rebuilt. Delete the last
    observation; the cluster is removed.
12. **Unavailable runtime:** no Python/model dependency; provenance shows the exact unavailable reason and provider
    fallback, never a fake completed Voice ID.
13. **Invalid saved token:** Hugging Face identity returns 401; Settings shows `Token rejected`, not `Acceptance required`.
14. **Pending model conditions:** identity succeeds and gated model file returns 401/403; Settings shows the account and
    `Acceptance required` with review and retry actions.
15. **Granted model access:** both checks succeed; Settings shows `Community-1 ready`.
16. **Access-check outage:** network failure or timeout yields a retryable, non-blocking unavailable state and never
    exposes the token.
