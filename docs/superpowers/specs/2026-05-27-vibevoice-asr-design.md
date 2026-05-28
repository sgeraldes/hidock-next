# VibeVoice ASR Integration — Design

- **Date:** 2026-05-27
- **Status:** Approved for planning
- **Author:** Sebastian + Claude
- **Reference:** [VibeVoice-ASR docs](https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-asr.md)

## 1. Summary

Add `microsoft/VibeVoice-ASR` as a **secondary, local, full-file transcription engine** for
**recorded meetings and re-processing** in the HiDock Next monorepo. VibeVoice performs joint
ASR + speaker diarization + timestamping in a single pass (up to 60 min, 50+ languages,
code-switching), replacing the need for a separate diarizer.

VibeVoice does **not** replace the realtime/primary ASR (Gemini multimodal, Chirp 3 streaming,
or the Cohere `local-asr` path). It is an additional, user-selectable engine chosen for quality
on completed recordings.

## 2. Goals / Non-goals

### Goals
- Run `microsoft/VibeVoice-ASR` locally (RTX 4090, fp16 ≈ 15 GB) to transcribe a complete audio
  file into speaker-labeled, timestamped segments.
- Make VibeVoice a **shared core** reusable by every hidock-next app via the existing
  `asr_mcp` Python plugin (the common ASR surface all apps already shell out to).
- Surface VibeVoice in the **primary UI** — `apps/electron` (HiDock Meeting Intelligence) — as a
  third transcription **provider**, with a **"Re-transcribe with VibeVoice"** action for
  recorded meetings / re-processing.
- Provide a reusable **TS `VibeVoiceEngine`** in `packages/transcription` so `meeting-assistant`
  and `meeting-recorder` can later offer VibeVoice as a secondary re-process engine.

### Non-goals
- No realtime / streaming / low-latency captioning with VibeVoice (wrong tool for that).
- No change to the existing Gemini analysis layer (summary, action items, meeting-matching,
  RAG indexing) — VibeVoice only replaces the *raw transcription* step.
- No UI wiring of VibeVoice into `meeting-assistant` / `meeting-recorder` in this effort
  (the reusable engine is built and exported; wiring is a documented follow-up).
- No session-audio persistence work in `meeting-assistant` (deferred follow-up; see §8).

## 3. Background — current architecture

- **`asr_mcp` Python plugin** (`G:\Code\claude-plugins\plugins\mcp-asr`): wraps Cohere Transcribe
  (`CohereAsrForConditionalGeneration`) + a separate `pyannote` diarizer. Exposes a CLI
  (`python -m asr_mcp.cli`), an MCP server (`asr_transcribe`/`asr_list_languages`/
  `asr_model_status`), and a venv launcher (`mcp_runner.py`). Diarized output JSON shape:
  `{ "segments": [{ "speaker", "start", "end", "text" }], "num_speakers", "language", ... }`.
- **`packages/transcription`** (TS): `TranscriptionEngine` interface; `CohereEngine` shells out to
  `python -m asr_mcp.cli <file> --diarize -f json`; `Chirp3Engine` (cloud); `TranscriptionPipeline`
  with engine fallback. Consumed by `meeting-assistant` and `meeting-recorder`.
- **`apps/electron` (HiDock Meeting Intelligence)**: calendar-first platform for HiDock USB device
  recordings. Has its **own** `electron/main/services/transcription.ts` — a queue-based processor
  (retry/backoff, locking, progress) with two providers:
  - `gemini` (default, cloud multimodal) via `@google/generative-ai`.
  - `local-asr` via `execFile(python, [mcp_runner.py, asr_mcp.cli, <file>, --language, <l>,
    --format, json, --num-beams, N, --diarize, ...])`.
  After raw transcription it runs `analyzeTranscriptWithGemini` (summary/action items/
  meeting-matching), persists a `transcripts` row (`INSERT OR REPLACE`, id `trans_<recordingId>`),
  detects actionables, and indexes into the vector store.

### Key verified facts
- `microsoft/VibeVoice-ASR` loads via `VibeVoiceASRForConditionalGeneration` +
  `VibeVoiceASRProcessor` from the `vibevoice` package, `trust_remote_code=True`,
  `language_model_pretrained_name="Qwen/Qwen2.5-7B"`. Output parsed by
  `processor.post_process_transcription(text)` → segments with
  `start_time`, `end_time`, `speaker_id`, `text`.
- `mcp_runner.py` passes trailing args straight through to the launched module → a new
  `--backend` flag reaches `cli.py`.
- `apps/electron` `insertTranscript` is `INSERT OR REPLACE` → re-processing overwrites cleanly.
- `config.transcription.provider` is currently `'gemini' | 'local-asr'`; default `localAsrPath`
  is `G:\Code\claude-plugins\plugins\mcp-asr`.

## 4. Layered design

```
SHARED CORE — asr_mcp (Python)          ← reused by ALL apps via CLI/MCP
  + VibeVoice backend (lazy, optional dep, --backend vibevoice)

SHARED TS — packages/transcription      ← reused by meeting-assistant / meeting-recorder
  + VibeVoiceEngine (shells out to CLI --backend vibevoice)

PRIMARY UI — apps/electron              ← THE surface for this work
  + 'vibevoice' transcription provider
  + per-job provider override in the queue
  + "Re-transcribe with VibeVoice" action + Settings
```

## 5. Component 1 — `asr_mcp` VibeVoice backend (Python)

### 5.1 `config.py`
Add:
- `ASR_BACKEND` (env `ASR_BACKEND`, `"cohere"` default | `"vibevoice"`).
- `VIBEVOICE_MODEL_ID` (default `"microsoft/VibeVoice-ASR"`).
- `VIBEVOICE_LM_NAME` (default `"Qwen/Qwen2.5-7B"`).
- `VIBEVOICE_ATTN` (default `"flash_attention_2"`, auto-fallback to `"sdpa"` if unavailable).
- `VIBEVOICE_MAX_NEW_TOKENS` (sized for long-form, e.g. 32768).

### 5.2 New `vibevoice_model.py`
A `VibeVoiceModel` class mirroring `TranscriptionModel`'s shape:
- `load()`: **lazy import** `from vibevoice.modular.modeling_vibevoice_asr import
  VibeVoiceASRForConditionalGeneration` and `from vibevoice.processor.vibevoice_asr_processor
  import VibeVoiceASRProcessor` *inside* the method. Raise a clear `ModelInferenceError`
  ("VibeVoice not installed — run `pip install -e .[vibevoice]`") on `ImportError`.
  Try `attn_implementation=VIBEVOICE_ATTN`, fall back to `"sdpa"` on failure.
  CUDA→CPU fallback like `TranscriptionModel`.
- `transcribe(file_path, language="auto") -> DiarizedTranscriptionResult`: run the joint pass,
  call `processor.post_process_transcription()`, map `speaker_id/start_time/end_time/text` →
  `DiarizedSegment`, count distinct speakers, reuse the `_check_has_speech` gate.
- `unload()`, `get_status()` (report `backend="vibevoice"`, model id, device, GPU mem).

`DiarizedTranscriptionResult` / `DiarizedSegment` are reused from `pipeline.py` so downstream
formatting is unchanged.

### 5.3 `cli.py`
- Add `--backend {cohere,vibevoice}` (default from `ASR_BACKEND`).
- When `vibevoice`: `-l/--language` becomes optional (default `"auto"`); diarization is native
  (no pyannote, `--diarize` accepted but implied); route to `VibeVoiceModel`; reuse
  `_format_diarized` so JSON/markdown/text output shape is identical to today's diarized path.

### 5.4 `server.py` (MCP)
- `TranscribeInput` gains optional `backend` field; `asr_transcribe` routes accordingly.
- `asr_model_status` reports active backend. (Warm model = basis for a future persistent-server
  optimization; out of scope now.)

### 5.5 Dependencies
`pyproject.toml` `[project.optional-dependencies]`:
```
vibevoice = ["vibevoice"]   # plus any pins the upstream package requires
```
`vibevoice` is **never imported at module load** — only inside `VibeVoiceModel.load()`.
`trust_remote_code=True` is scoped to the VibeVoice backend; Cohere stays `False`.

## 6. Component 2 — `VibeVoiceEngine` (TS, `packages/transcription`)

- New `engines/vibevoice-engine.ts`, `class VibeVoiceEngine implements TranscriptionEngine`
  (`isLocal = true`, `isStreaming = false`), modeled on `CohereEngine`:
  - Write the input `Buffer` to a temp `.wav`.
  - Spawn `python -m asr_mcp.cli <tmp> --backend vibevoice -f json` (language `auto` unless
    `options.language` provided; pass `--vocabulary` if configured).
  - Parse `parsed.segments` (`{ text, start, end, speaker }`).
  - `isAvailable()` mirrors `CohereEngine` (`asr_mcp.cli --help` exit 0).
- **Speaker mapping:** preserve VibeVoice's `speaker_id` as the segment `speaker` (e.g.
  `"Speaker 1"`, `"Speaker 2"`) — do **not** collapse to `you`/`them` (that's a live two-source
  concern). `source` defaults to the option's `source` (`'mic'` for a single mixed file).
- Export `VibeVoiceEngine` + `VibeVoiceEngineOptions` from `index.ts`.
- Unit test with a mocked `spawn` (mirror `engines.test.ts`).

> Scope note: building/exporting the engine is in scope. Wiring it into the `meeting-assistant`
> / `meeting-recorder` UIs is a documented follow-up (their primary ASR stays realtime).

## 7. Component 3 — `apps/electron` VibeVoice provider (primary UI)

### 7.1 `electron/main/services/transcription.ts`
- Extend `RawTranscriptionResult.provider` to `'gemini' | 'local-asr' | 'vibevoice'`.
- New `transcribeWithVibeVoice(filePath, progressCallback)`: same `execFile(python,
  [mcp_runner.py, asr_mcp.cli, <file>, --backend, vibevoice, --format, json, ...])` mechanism as
  `transcribeWithLocalAsr`, but: `--backend vibevoice`, language optional/`auto`, diarization
  native, `model = "microsoft/VibeVoice-ASR"`. Reuse the existing segment→`fullText`
  (`"Speaker N: text"`) join and `speakers` JSON serialization.
- `transcribeRecording` selects the transcription function by effective provider.

### 7.2 Per-job provider override (re-processing)
- Add a nullable `provider` column to `transcription_queue` (via the existing ALTER-TABLE repair
  pattern in `database.ts`).
- `addToQueue(recordingId, provider?)` writes the override.
- `processQueue` / `transcribeRecording` use `item.provider ?? config.transcription.provider`.
- Provider-prerequisite validation in `processQueue` handles `vibevoice` (runner present).

### 7.3 IPC + action
- New IPC `recordings:reprocessWith` `{ recordingId, provider }` → validates, enqueues with the
  override, triggers `processQueueManually()`. Overwrites the existing `trans_<recordingId>`
  (already `INSERT OR REPLACE`). Re-emits standard `transcription:*` progress/result events.
- Add a thin `transcribeManually(recordingId, providerOverride?)` overload for direct (non-queue)
  invocation parity.

### 7.4 `config.ts` + `Settings.tsx`
- `config.transcription.provider` type extended to include `'vibevoice'`.
- New config fields: `vibevoiceModelId` (default `microsoft/VibeVoice-ASR`), `vibevoiceDevice`
  (default `cuda:0`), `vibevoiceAttn` (default `flash_attention_2`), `vibevoiceLanguage`
  (default `auto`). VibeVoice reuses `localAsrPath` / `mcp_runner.py`.
- `Settings.tsx`: add `VibeVoice (local, full-file)` to the provider dropdown + its config inputs.
- Recording/library UI: a **"Re-transcribe with VibeVoice"** menu item/button on a recording that
  calls `recordings:reprocessWith`. Existing progress UI (`TranscriptionStatusBadge`,
  `transcription:progress`) is reused.

## 8. Deferred / future (explicitly out of scope)

- Wiring `VibeVoiceEngine` into `meeting-assistant` / `meeting-recorder` UIs.
- `meeting-assistant` session-audio persistence (it streams live chunks but never saves a file;
  required before VibeVoice can re-process a *live-recorded* session there).
- Persistent warm-model server to avoid 7B reload per invocation (the MCP server already keeps the
  model warm; a TS path that prefers it is a later optimization).

## 9. Error handling

All surfaced through the existing queue-failure path + `transcription:failed`:
- **VibeVoice not installed** → non-retryable, message "run `pip install -e .[vibevoice]`".
- **CUDA OOM** → actionable suggestion (shorter audio / free VRAM).
- **No speech** → reuse the existing RMS no-speech gate.
- **File not found / unsupported format / runner not found** → non-retryable (added to
  `NON_RETRYABLE_ERRORS`).
- Flash-attn missing → automatic `sdpa` fallback (no user-facing error).

## 10. Testing

- **Python:** unit test mapping mocked `post_process_transcription()` segments →
  `DiarizedTranscriptionResult`; CLI `--backend vibevoice` arg routing; lazy-import error message.
- **TS (`packages/transcription`):** `VibeVoiceEngine` test with mocked `spawn` (segment parsing,
  speaker passthrough, language `auto`) — mirror `engines.test.ts`.
- **`apps/electron`:** `transcription.ts` test for the `vibevoice` provider branch (mocked
  `execFile`, mirror `transcription.test.ts`); queue provider-override test; IPC handler test for
  `recordings:reprocessWith`.
- **Runtime (mandatory per project rules):** launch the Electron app via the Electron MCP tools,
  verify it starts with no console errors, exercise "Re-transcribe with VibeVoice" on a sample
  recording, and confirm speaker-labeled segments render. Document with screenshots + console
  output in the QA report. No "manual testing recommended".

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| `vibevoice` package install on Windows (flash-attn) | Optional extra; `sdpa` fallback; document install. |
| 7B cold-load (~30–60 s) per CLI invocation | Acceptable for user-initiated re-processing; future warm-server path noted. |
| VRAM pressure (15 GB) alongside other GPU use | `get_status` reports memory; CUDA-OOM handled with guidance; `cuda`→CPU fallback. |
| Upstream `vibevoice` API drift / `trust_remote_code` | Pin version; scope `trust_remote_code` to VibeVoice; lazy import keeps Cohere path unaffected. |
| Output-shape mismatch with existing JSON consumers | Reuse `_format_diarized` and `DiarizedSegment` so the contract is byte-compatible with the diarized Cohere path. |

## 12. Acceptance criteria

1. `python -m asr_mcp.cli <file> --backend vibevoice -f json` produces valid diarized JSON
   (speakers + timestamps) on the 4090, with the existing schema.
2. `VibeVoiceEngine` (TS) returns parsed segments with preserved speaker labels; exported and
   unit-tested.
3. In HiDock Meeting Intelligence, selecting provider `vibevoice` (or using "Re-transcribe with
   VibeVoice") transcribes a recording, persists the transcript, runs the unchanged Gemini
   analysis, and shows speaker-labeled segments — without changing the global default provider.
4. All new unit tests pass; the Electron app launches and the action works end-to-end (verified
   via Electron MCP, evidence in QA report).
