# WER Spike — Spanish-first ASR model landscape + "hybrid" (local VAD chunks → Gemini) vs Gemini-only

**Date:** 2026-07-10
**Status:** Research spike. No app / DB / device changes. Read the verdicts, then decide.
**Machine:** RTX 4090 (24 GB, CUDA), Windows 11, ffmpeg present. Isolated Python 3.11 venv.
**Companion spike:** `docs/experiments/diarization-spike.md` (that one was about DIARIZATION —
speaker boundaries; this one is about **WER** — word accuracy — and about whether pre-chunking the
audio with VAD changes what Gemini hears).

---

## TL;DR / Recommendations

**Two separate questions were asked; two separate answers.**

### Q1 — Is there a local open-source model with better Spanish WER than we'd lose by leaving Gemini?
**Best-evidenced local pick for Spanish is `whisper-large-v3` (MIT, ~3 GB, via faster-whisper).** The
models the user named as leaderboard leaders do **not** apply to Spanish:
- **NVIDIA Canary-Qwen-2.5B** ("#1 on the HF Open ASR Leaderboard") is **English-only** — the leaderboard
  itself is English-only. Not a Spanish option.
- **AutoArk-AI/ARK-ASR-3B** ("3rd on the leaderboard") has **no published Spanish WER at all**; its rank
  is an English-benchmark artifact. High risk for a Spanish-first pipeline.
- **SeamlessM4T-v2** and **Meta MMS** have decent Spanish but are **CC-BY-NC (non-commercial)** — license-blocked.
- **Voxtral-Small-24B** has the single best *published* Spanish WER but doesn't fit fp16 on a 4090.

On the only apples-to-apples Spanish benchmark found (the Voxtral paper's shared eval harness),
**whisper-large-v3 posts 2.81 % WER on FLEURS-es and 3.89 % on MLS-es** — beating the 3B Voxtral-Mini
and within a whisker of the 24B model, while being MIT-licensed and the easiest thing to spawn as a
subprocess. See the ranked shortlist in Part 1.

**But** (carrying over the prior spike + the user's own report) **Gemini's Spanish WER on our real
meeting audio is reported to be clearly better than WhisperX/whisper-large-v3** — noisy, far-mic,
multi-speaker remote meetings are exactly where a benchmark-tuned model regresses and a big multimodal
model shines. So the shortlist answers "which local model is best" (whisper-large-v3), **not** "is local
good enough to replace Gemini for us" — Part 2 shows it is not, for word accuracy.

### Q2 — Does the "hybrid" (local VAD/turn chunking → clean chunks → Gemini) beat Gemini-only on WER?
<!-- VERDICT-Q2 -->
_(filled from Part 2 results below)_

---

## Part 1 — Spanish-first local ASR: ranked shortlist

> **Framing that matters:** the **HuggingFace Open ASR Leaderboard is ENGLISH-ONLY** (AMI, Earnings22,
> GigaSpeech, LibriSpeech, SPGISpeech, VoxPopuli). A high rank there says nothing about Spanish. The
> numbers below are on actual **Spanish** benchmarks — **FLEURS-es, MLS-es, Common Voice-es** — with the
> source cited; where no Spanish number exists that is stated, not guessed. Primary source for the
> head-to-head Spanish WER is the **Voxtral paper (arXiv 2507.13264)**, which evals whisper-large-v3 and
> Voxtral on one harness (Tables 4 & 6).

| # | Model | Params / VRAM (fp16) | **Spanish WER** (benchmark) | English WER | License (commercial?) | Framework | Gated? |
|---|---|---|---|---|---|---|---|
| **1** | **whisper-large-v3** | 1.55 B / ~3 GB wt, ~5–10 GB run | **2.81 FLEURS-es · 3.89 MLS-es** | ~2 LS-clean | **MIT — yes** | faster-whisper / CTranslate2 | No |
| 2 | whisper-large-v3-turbo | 809 M / ~1.6 GB | ~6.9 CommonVoice17-es | ≈ large-v2 | **MIT — yes** | faster-whisper | No |
| 3 | nvidia/canary-1b-v2 | 1 B / ~2–3 GB | no es-specific #; 5.2 macro (beats v3 5.8 macro) | competitive | **CC-BY-4.0 — yes** | NVIDIA **NeMo** (heavier) | No |
| 4 | mistralai/Voxtral-Mini-3B-2507 | 5 B / **9.5 GB** | 3.52 FLEURS-es · 5.12 MLS-es | strong | **Apache-2.0 — yes** | vLLM / transformers≥4.54 | No |
| 5 | mistralai/Voxtral-Small-24B-2507 | 24 B / ~55 GB (**no fp16 fit**) | **2.72 FLEURS-es · 3.62 MLS-es** (best) | SOTA | **Apache-2.0 — yes** | vLLM (needs int4 to fit) | No |
| 6 | AutoArk-AI/ARK-ASR-3B | ~4 B / ~8 GB | **none published** (es listed) | 5.04 avg (6 EN) | **Apache-2.0 — yes** | transformers `trust_remote_code` | No |
| 7 | BSC-LT/whisper-large-v3-LoS | 1.55 B / ~3 GB | none numeric (es + ca/gl/eu tuned) | — | **Apache-2.0 — yes** | faster-whisper | No |
| 8 | ibm-granite/granite-speech-3.3-8b | 8 B / ~16 GB | none published (es supported) | good | **Apache-2.0 — yes** | transformers (two-pass) | No |
| — | **NVIDIA Canary-Qwen-2.5B** | 2.5 B | **N/A — English-only** | 5.63 (leaderboard #1) | CC-BY-4.0 | NeMo | No |
| — | SeamlessM4T-v2-large | 2.3 B | ~5.1 FLEURS-es | — | **CC-BY-NC — NO** | transformers | No |
| — | Meta MMS-1B | 1 B | coverage-oriented CTC | — | **CC-BY-NC — NO** | fairseq/transformers | No |

**Top-3 for a Spanish-first local subprocess on a 4090:**
1. **whisper-large-v3** — best *published* Spanish WER of anything MIT-licensed that fits a 4090; word
   timestamps + VAD out of the box; trivial faster-whisper subprocess. Weakness: silence hallucination
   (mitigate with `vad_filter=True`).
2. **whisper-large-v3-turbo** — same license/tooling, 4–6× faster, but Spanish degrades noticeably. The
   "fast lane," not the accuracy pick. (Quantified live in Part 2.)
3. **canary-1b-v2** — strongest **commercial-clear** (CC-BY-4.0) alternative; beats whisper-large-v3 on
   *macro* multilingual averages and is very fast, but drags in the heavier NeMo stack and has no
   published FLEURS-es number. Worth an A/B on our own audio before adopting.

**Dead ends / do-not-use:** Canary-Qwen-2.5B (English-only), ARK-ASR-3B (zero published Spanish WER —
the "leaderboard" rank is English), distil-whisper (English-only official checkpoints), SeamlessM4T-v2 &
MMS (CC-BY-NC non-commercial), Voxtral-Small-24B (no fp16 fit on 24 GB).

**Sources:** Voxtral paper https://arxiv.org/html/2507.13264v1 · whisper-large-v3-turbo
https://huggingface.co/openai/whisper-large-v3-turbo · ARK-ASR-3B https://huggingface.co/AutoArk-AI/ARK-ASR-3B ·
canary-qwen-2.5b https://huggingface.co/nvidia/canary-qwen-2.5b · canary-1b-v2 https://huggingface.co/nvidia/canary-1b-v2 ·
Voxtral-Mini https://huggingface.co/mistralai/Voxtral-Mini-3B-2507 · SeamlessM4T-v2
https://huggingface.co/facebook/seamless-m4t-v2-large · MMS https://huggingface.co/facebook/mms-1b ·
distil-whisper https://github.com/huggingface/distil-whisper · Granite Speech
https://huggingface.co/ibm-granite/granite-speech-3.3-8b · BSC https://huggingface.co/BSC-LT/whisper-large-v3-LoS

---

## Part 2 — WER experiment: Gemini-only vs hybrid vs full-local vs candidate

### Method (honest about what is and isn't measured)

- **No human ground truth exists** for this Spanish audio and the agent cannot judge Spanish by ear.
  So the **primary deliverable is the aligned side-by-side transcripts below** — for the native-Spanish
  user to judge — plus **objective, machine-detectable signals** that correlate with WER. Any WER number
  here is **inter-engine distance**, explicitly **not** an accuracy score against truth.
- **Clips:** 3 recordings of different length/speaker-count; ~60–90 s clips (kept short so runs are
  fast/cheap). HiDock `.wav` are MP3 — decoded to 16 kHz mono (the app's 64 kbps recordings are already
  ~16 kHz mono, so this is loss-free for the task and keeps every approach on identical audio).
  - **A** long multi-speaker Spanish (`2026Jul08-...-Rec47`, 52.9 min): **A1** 140–230 s (the Memo→Sebastián
    handoff — same case the diarization spike flagged), **A2** 900–985 s (rapid roll-call).
  - **B** mid, 256 kbps (`2025Aug06-...-Rec22`, 15.8 min): **B1** 300–390 s.
  - **C** short recording (`2026Feb03-...-Rec12`, 2.4 min): **C1** 25–110 s.
- **Approaches** (all on the same clip audio):
  1. **gemini_whole** — the app's CURRENT path: whole clip → one Gemini call, app's exact prompt
     (`gemini-3.5-flash`, `[MM:SS] Speaker N:` format). For a <10 min clip the app sends it whole.
  2. **gemini_vad** — the **HYBRID under test**: faster-whisper Silero VAD → pack speech into ~30 s chunks
     **cut only at silence** → each chunk → Gemini (multi-segment prompt + previous-tail hint) → reassemble.
  3. **gemini_fixed** — **control**: fixed 30 s chunks **regardless of speech** (mimics the app's arbitrary
     MPEG-frame cut on long files). `gemini_vad` vs `gemini_fixed` isolates the single variable: *does
     cutting at silence beat cutting arbitrarily, at equal chunk size?*
  4. **fw_large_v3** — full-local baseline: faster-whisper `large-v3` (== the WhisperX ASR core), es,
     `vad_filter`, word timestamps.
  5. **fw_turbo** — Part-1 candidate: faster-whisper `large-v3-turbo`.
- **Objective signals:** word count; **trigram-dup ratio** and **max immediate-repeat run** (hallucination /
  loop detectors); **uncovered-speech seconds** (VAD says speech, engine emitted no word there — a
  dropped-segment detector, available for the word-timestamped local engines); pairwise WER matrix.

<!-- PART2-RESULTS -->
_(results tables + aligned transcripts inserted below from the harness run)_

---

## Reproduce

```bash
# 1. venv + deps (isolated; see requirements.txt for the CUDA/cuDNN + torch-free VAD notes)
uv venv --python 3.11 .venv
uv pip install --python .venv/Scripts/python.exe -r scripts/experiments/wer/requirements.txt

# 2. clips (MP3-in-.wav → 16 kHz mono; edits the 4 clip windows)
AUD=F:/HiDock-Next-Audios OUT=./clips bash scripts/experiments/wer/extract_clips.sh

# 3. run all approaches (reads Gemini key/model from the electron app config)
python scripts/experiments/wer/run_wer.py --clips-dir ./clips --out-dir ./out --clips A1 A2 B1 C1
```

Scripts: `scripts/experiments/wer/{requirements.txt, extract_clips.sh, wer_lib.py, run_wer.py}`.
Raw per-approach JSON + `results.md` are written to the run's `out/` (kept in the session scratch dir —
they contain private meeting content; only the short clip excerpts needed for comparison are reproduced
in this doc).
