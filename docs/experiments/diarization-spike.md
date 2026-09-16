# Diarization Engine Spike — Local (WhisperX + pyannote) vs. Gemini

**Date:** 2026-07-10
**Status:** Research spike (no app/DB/device changes). Exploratory — read the verdict, then decide.
**Recording under test:** Private benchmark input; identifying metadata and transcript content are intentionally omitted.

---

## TL;DR / Recommendation

**Yes — a local diarization engine clearly beats the current Gemini one-pass diarization on the two
flagged failures, and on this machine it is essentially free (fast + local).** Specifically:

- The **2:31 speaker-merge bug is decisively fixed.** WhisperX + pyannote 3.1 places a speaker
  boundary at **151.1 s → 152.5 s = 2:31**, exactly the speaker handoff. Gemini put the entire
  **first 10 minutes (0–600 s) into a single "Speaker 1" turn** — the boundary simply does not exist in
  its output.
- **Word-level timestamps** are real with WhisperX (per-word), vs. Gemini's coarse and often fabricated
  segment spans (a literal 0–600 s block).
- On the **RTX 4090 it is very fast and cheap**: the full 52.9-min file ran in **~90 s wall-clock
  (0.028× real-time, ~35× faster than the audio), peak 2.1 GB VRAM.** No per-minute API cost.

**Two honest caveats (do not oversell):**

1. **Naming is NOT solved by any diarization engine.** WhisperX/pyannote emit anonymous `SPEAKER_00…06`.
   The user's second complaint — "it failed to name Óscar Pereda / Santiago de la Colina / Emanuel who
   state their names" — is a **speaker-identification** problem, not diarization. It needs a **separate
   LLM/enrollment layer** that reads the self-intros and maps turns → names. Gemini also does not do this
   (it just labels them "Speaker 4/5/6"). So this must be built regardless of engine choice.
2. **Rapid 1–2 s roll-call turns remain hard.** In the roll-call window pyannote merged two of the
   back-to-back one-line intros (Óscar + Santiago into one label). Pure acoustic diarization of very
   short consecutive turns on a single mixed remote-audio channel is genuinely difficult; Gemini's higher
   raw speaker count there is not demonstrably more correct.

**Recommended shape:** a **hybrid pipeline** — WhisperX(`large-v3`) + pyannote `speaker-diarization-3.1`
for transcript + **word timestamps + speaker turns**, then an **LLM post-pass** for (a) naming from
self-intros/context and (b) summary/insights. This directly fixes both flagged bugs: diarization fixes
the 2:31 merge; the LLM layer — now given clean turn structure to reason over — does the naming.

**Setup it needs:** a GPU (the 4090 makes this trivial; CPU is ~35× slower and impractical for a
library) and an HF token **with the gating terms accepted for `pyannote/speaker-diarization-3.1` +
`pyannote/segmentation-3.0`**. The app's existing `transcription.localAsrHfToken` already has those
grants (it does **not** have the newer `community-1` grant — see friction log).

---

## Hardware detected

| Item | Value |
|------|-------|
| GPU | **NVIDIA GeForce RTX 4090, 24 GB** (≈22.5 GB usable), driver 596.49, CUDA 13.2 |
| CPU | 24 logical processors |
| Python | 3.14 default (too new for torch) — spike used **3.11.9** via `uv` |
| ffmpeg | present (N-125258) |
| HF token | present in app config (`localAsrHfToken`); valid; grants for 3.1 + segmentation-3.0, **not** community-1 |

> The GPU is the single most important fact here: it turns "CPU diarization is too slow to ship" into
> "diarization is a ~90 s background step." On a CPU-only box the recommendation would flip to "keep the
> cloud engine or accept minutes-per-file."

---

## The Gemini baseline (what's actually in the DB)

The baseline was evaluated from a private input. Identifying paths, recording IDs, and transcript content are intentionally
omitted. The comparison used the provider's `speakers` JSON:

- **100 segments, 10 distinct labels** across the file.
- **Segment #1 = `Speaker 1`, start 0, end 600.01** — a single 10-minute turn that merges two speakers.
- Because that block is one segment, **every word timestamp in the first 10 minutes is effectively
  fabricated** (there is no sub-structure).

Interestingly, Gemini's second multi-speaker window is not bad — it separated several labels. So Gemini's
diarization is **inconsistent**: poor on the long opening segment, better on the later window.

---

## Engines tried (in order), with friction

### a. Local ASR MCP (`mcp-asr`, the app's configured `localAsrPath`) — DEAD END this session
- Backends: `vibevoice` (microsoft/VibeVoice-ASR, joint ASR+diarization; the app's configured default,
  `vibevoiceDevice=cuda:0`) and `cohere` (Cohere Transcribe + pyannote).
- `asr_model_status` OK: CUDA available, RTX 4090, backend `vibevoice`, model not yet loaded.
- `asr_transcribe(diarize=true, backend=vibevoice)` on the **3.5-min clip A**: **no response for 1800 s
  (30 min), aborted.** First-call model load appears to hang or is far too slow, and the MCP gives no
  progress signal, so it is unusable for iteration as-is. Not pursued further this session. (Worth a
  separate look — possibly a multi-GB model download or an attention-kernel issue — but out of scope for
  a diarization-quality comparison.)

### b. WhisperX (faster-whisper `large-v3`) + pyannote 3.1 — THE WINNER
- Install friction (all logged in `scripts/experiments/diarization/requirements.txt`):
  1. **whisperx pulls a CPU torch** and clobbers the CUDA build → must reinstall the CUDA torch trio
     **after** whisperx, and force it (`uv` treats `2.8.0` as satisfied regardless of the `+cpu` vs
     `+cu126` local tag, so `--reinstall-package` is required).
  2. **whisperx 3.8.6's default diarization model is now `pyannote/speaker-diarization-community-1`**,
     which is gated and the app token has **not** been granted → HTTP 401 `GatedRepoError`. Fix: pin
     `--diar-model pyannote/speaker-diarization-3.1` (token *does* have that grant).
  3. A **stale, invalid `HF_TOKEN` env var** was present in the shell and huggingface_hub gives env vars
     *precedence* over the passed token → 401 even with a good token. Fix: the harness overwrites the env
     vars with the known-good config token.
  4. `torchcodec` DLL fails to load (torch 2.8 vs torchcodec mismatch) → **non-fatal**, pyannote falls
     back to soundfile/torchaudio decoding. Ignored.
- API note: `DiarizationPipeline(model_name, token, device, cache_dir)` — the old `use_auth_token=` kwarg
  was removed in 3.8.x.

### c. Non-gated fallback (speechbrain ECAPA + clustering)
- **Not needed.** The gated pyannote path worked once the token/model pin was fixed, so the fallback the
  brief anticipated was unnecessary. Documented here so a future run on a token *without* pyannote grants
  knows to take that route.

---

## Comparison table

Scoring against the flagged facts. Window A = the 2:31 boundary; Window B = the roll-call self-intros.

| Metric | Gemini (`gemini-3.5-flash`, current) | WhisperX `large-v3` + pyannote 3.1 (local, GPU) |
|---|---|---|
| **(A) Boundary case** | **FAIL** — 0–600 s is one `Speaker 1` turn; no boundary | **PASS** — the local engine separates the adjacent speakers near the target boundary. |
| **(B) Distinct speakers, roll-call window** | ~7 labels in-window (10 total in file) | 5 in the isolated 60 s clip / 7 total in full file; **merged 2 short intros** (Óscar+Santiago) |
| **(C) Word-level timestamps** | No — segment-level, and fabricated for 0–600 s | **Yes** — true per-word alignment |
| **Speaker naming** | No (labels only) | No (SPEAKER_xx) — **needs an LLM/enrollment layer either way** |
| **Wall-clock, full 52.9-min file** | cloud call (network-bound; not measured here) | **~90 s** (ASR 33.4 s + align 28.5 s + diarize 28.3 s) |
| **Real-time factor** | n/a | **0.028×** (clip A 0.10×, clip B 0.30×) |
| **Peak VRAM** | n/a (cloud) | **2.1 GB** |
| **Cost / privacy** | per-call API, audio leaves device | **local, free, offline** |
| **Total distinct speakers, file** | 10 | 7 (+`UNKNOWN` bucket) |

**The 2:31 verdict:** unambiguous PASS for the local engine, unambiguous FAIL for Gemini.

---

## Sample outputs

Raw transcript excerpts and identifying speaker names are intentionally omitted. The evaluation compared
segment boundaries, speaker labels, and word timestamps.

---

## Recommendation detail

1. **Adopt the hybrid pipeline.** WhisperX `large-v3` + pyannote `speaker-diarization-3.1` becomes the
   diarization + word-timestamp engine; keep an LLM (Gemini or local) for summary/insight AND add a
   **naming pass** that consumes the clean speaker-turn structure + self-intros to label
   `SPEAKER_xx → real name`, ideally backed by the app's existing identity/contacts store for
   cross-recording voice consistency.
2. **Pin the model + token.** Use `pyannote/speaker-diarization-3.1` (not the whisperx-default
   `community-1`). Ensure the token has accepted 3.1 + `segmentation-3.0` gating (the app token has).
   Grant `community-1` on HF later if you want the newer model — it may separate short turns better and
   is worth a follow-up A/B.
3. **Gate on GPU.** Detect CUDA at runtime; run local diarization only when a capable GPU is present.
   Fall back to the cloud engine (or a queued CPU run) otherwise.
4. **Integration surface already exists:** config keys `localAsrPath`, `localAsrDiarize`,
   `localAsrHfToken`, `vibevoiceDevice` are present. Rather than the hung vibevoice MCP path, wire a
   WhisperX worker (subprocess/venv, same pattern as this spike's harness) invoked by the transcription
   service, emitting `{start,end,speaker,words[]}` per turn into the `transcripts` / `transcript_speakers`
   tables.
5. **Follow-ups / open items (tracked, not dismissed):**
   - **ACTION ITEM:** investigate why the `mcp-asr` vibevoice backend hangs 30 min on a 3.5-min clip
     (model download vs. attention kernel) — it is the app's currently-configured local path and is
     effectively non-functional as observed here.
   - **ACTION ITEM:** build the LLM naming/enrollment layer — this is the other half of the user's
     complaint and no diarizer solves it alone.
   - Optional A/B: `community-1` vs `3.1`, and a min/max-speaker sweep, to improve roll-call separation.
     (Default auto speaker-count already nails the 2:31 boundary, so no tuning was needed for that.)

---

## Reproduce

```bash
# 1. clips (MP3-in-.wav → 16 kHz mono)
bash scripts/experiments/diarization/extract_clips.sh

# 2. venv + deps (see requirements.txt for the CUDA-torch ordering gotcha)
uv venv --python 3.11 .venv
uv pip install --python .venv/Scripts/python.exe torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 \
    --index-url https://download.pytorch.org/whl/cu126
uv pip install --python .venv/Scripts/python.exe whisperx==3.8.6
# (force CUDA torch back if whisperx downgraded it — see requirements.txt)

# 3. run (token read from app config automatically; pin the 3.1 diar model)
python scripts/experiments/diarization/run_whisperx.py clips/rec47_A_0000-0330.wav \
    --out out/A.json --lang es --model large-v3 --diar-model pyannote/speaker-diarization-3.1

# 4. score against the 2:31 fact
python scripts/experiments/diarization/score.py out/A.json --window A
```

Scripts: `scripts/experiments/diarization/{extract_clips.sh, run_whisperx.py, score.py, requirements.txt}`.
Raw run outputs live in the session scratch dir (not committed — they contain private meeting content).
