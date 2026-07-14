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
**Two-part answer, and the interesting result is the control, not the headline.**

**Hybrid (`gemini_vad`) vs Gemini-only (`gemini_whole`): NO clear win for a clip Gemini can
already swallow whole.** On the objective signals they tie or the hybrid wins only marginally
(A1 trigram-dup 0.0102 vs 0.0103; C1 0.0335 vs 0.0447), and on the rapid roll-call clip (A2) the
VAD chunking actively *hurt* — it fragmented turns, drifted the per-segment timestamps, and garbled
proper nouns that whole-clip Gemini transcribed correctly ("Juan Camilo Hernández", "Oscar Pereyra",
"Santiago de la Colina" → the hybrid produced "A ti", "se apoya de santo"), giving a 0.35 inter-engine
WER. The hybrid also costs **more** tokens and wall-time than one whole-clip call (2–4 Gemini calls +
previous-tail hints) in every case except B1. So for recordings short enough to send whole (the app's
current <10-min path), whole-clip Gemini is as accurate or better, simpler, cheaper, and faster —
**the hybrid is not worth it there.**

**BUT silence-cut (`gemini_vad`) vs arbitrary-cut (`gemini_fixed`): YES, decisively — and this is the
finding that matters.** The app's *long-file* path today cuts at arbitrary MPEG-frame offsets (that is
exactly `gemini_fixed`). On clip B1 (mostly silence, ~13 s of speech in 90 s) the arbitrary cut sent a
near-silent window to Gemini and it **hallucinated 181 words of a fake English conversation** ("real
live people behind all of this", college-exam chatter) that is not in the audio — WER ~7.0 against every
other approach, and the **highest** token cost (9 941). The silence-cut hybrid on the same clip emitted
a clean 23 words matching whole/local at the **lowest** cost (1 769 tokens). Arbitrary cuts were also
worse than VAD on the dense clips (A1 dup 0.0154 vs 0.0102, max-loop 4 vs 3; A2 dup 0.0106 vs 0) and the
most expensive on all four. **So: if you must chunk a long file, cut at silence, never at a fixed offset
— arbitrary cuts both cost the most and risk catastrophic hallucination on low-speech windows.**

Practical takeaway: the hybrid's value is **not** to replace whole-clip Gemini on short recordings
(keep that as-is), but to **replace the app's arbitrary long-file chunking with VAD/silence-cut
chunking** — same accuracy on speech, far lower hallucination risk, lower cost.

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

### Results

**Run:** Gemini `gemini-3.5-flash` (es), chunk target 30 s, RTX 4090, 2026-07-10. All five approaches
ran on all four clips with no CUDA/OOM/download failure; `whisper-large-v3` + `large-v3-turbo` ran on GPU
fp16. Raw per-approach JSON + full transcripts are in the session scratch `out/` (private — not committed);
only the objective tables and short comparison excerpts below are reproduced here.

**How to read the signals:** `trigram-dup` and `max-loop` are hallucination/loop detectors (higher = worse).
`uncovered-speech s` = seconds where VAD says "speech" but the engine emitted no word there (a
dropped-segment detector; word-timestamped local engines only — Gemini has no word times, so its drops
show up instead as low word counts). The **WER matrix is inter-engine distance, NOT accuracy vs. ground
truth** — there is no human reference for this Spanish audio.

#### Objective signals per clip

**A1 — 90 s, dense continuous 2-speaker Spanish (VAD speech 88 s / 21 regions)**

| approach | words | trigram-dup | max-loop | wall s | Gemini tok | uncovered-speech s |
|---|--:|--:|--:|--:|--:|--:|
| gemini_whole | 197 | 0.0103 | 2 | 8.79 | 4161 | – |
| gemini_vad | 199 | **0.0102** | 3 | 22.59 | 6797 | – |
| gemini_fixed | 197 | 0.0154 | 4 | 19.1 | 6622 | – |
| fw_large_v3 | 169 | 0.012 | 0 | 6.05 | – | 13.3 |
| fw_turbo | 185 | **0.0984** | 0 | 9.12 | – | 16.4 |

**A2 — 85 s, rapid multi-speaker roll-call (VAD speech 43 s / 24 regions; lots of silence + overlap)**

| approach | words | trigram-dup | max-loop | wall s | Gemini tok | uncovered-speech s |
|---|--:|--:|--:|--:|--:|--:|
| gemini_whole | 95 | 0.0 | 0 | 13.28 | 5586 | – |
| gemini_vad | 95 | 0.0 | 0 | 21.07 | 6674 | – |
| gemini_fixed | 96 | 0.0106 | 2 | 27.21 | 8511 | – |
| fw_large_v3 | 83 | 0.0 | 0 | 3.91 | – | 19.2 |
| fw_turbo | 73 | 0.0 | 0 | 1.39 | – | 16.8 |

**B1 — 90 s, mostly silence, ~13 s Spanish greeting (VAD speech 13 s / 8 regions)** ← the decisive clip

| approach | words | trigram-dup | max-loop | wall s | Gemini tok | uncovered-speech s |
|---|--:|--:|--:|--:|--:|--:|
| gemini_whole | 22 | 0.0 | 2 | 7.07 | 3590 | – |
| gemini_vad | 23 | 0.0 | 2 | 5.93 | **1769** | – |
| gemini_fixed | **181** | 0.0112 | 2 | 31.23 | **9941** | – |
| fw_large_v3 | 23 | 0.0 | 2 | 1.48 | – | 5.7 |
| fw_turbo | 21 | 0.0 | 2 | 0.62 | – | 5.5 |

> `gemini_fixed`'s 181 words are a **hallucination**: an arbitrary 30 s window landed on near-silence and
> Gemini confabulated a fake English conversation (see excerpt). Every other approach agrees on ~22–23
> real Spanish words. This is the single clearest signal in the whole spike.

**C1 — 85 s, 2-person Spanish video-call, connection troubles (VAD speech 62 s / 23 regions)**

| approach | words | trigram-dup | max-loop | wall s | Gemini tok | uncovered-speech s |
|---|--:|--:|--:|--:|--:|--:|
| gemini_whole | 181 | 0.0447 | 5 | 15.56 | 6281 | – |
| gemini_vad | 181 | **0.0335** | 4 | 23.42 | 7722 | – |
| gemini_fixed | 183 | 0.0442 | 4 | 33.42 | 10331 | – |
| fw_large_v3 | 177 | 0.0286 | 3 | 6.06 | – | 17.2 |
| fw_turbo | 153 | 0.0265 | 3 | 1.99 | – | 16.2 |

#### Pairwise WER (inter-engine distance; rows = reference, cols = hypothesis)

Tight on the clean dense clips (engines mostly agree), divergent exactly where the audio is hard:

**A1** (all engines close; fw slightly further from Gemini):

| ref \ hyp | g_whole | g_vad | g_fixed | fw_v3 | fw_turbo |
|---|--:|--:|--:|--:|--:|
| g_whole | 0.00 | 0.08 | 0.08 | 0.17 | 0.23 |
| g_vad | 0.07 | 0.00 | 0.08 | 0.17 | 0.26 |
| fw_v3 | 0.20 | 0.20 | 0.19 | 0.00 | 0.15 |

**A2** (hard roll-call — Gemini-whole vs hybrid diverge to 0.35; fw drops the most):

| ref \ hyp | g_whole | g_vad | g_fixed | fw_v3 | fw_turbo |
|---|--:|--:|--:|--:|--:|
| g_whole | 0.00 | 0.35 | 0.24 | 0.40 | 0.39 |
| g_vad | 0.35 | 0.00 | 0.42 | 0.40 | 0.47 |
| fw_turbo | 0.51 | 0.62 | 0.53 | 0.37 | 0.00 |

**B1** (fixed-cut hallucination blows the row/column to ~7.0 — WER > 1 means more errors than words):

| ref \ hyp | g_whole | g_vad | g_fixed | fw_v3 | fw_turbo |
|---|--:|--:|--:|--:|--:|
| g_whole | 0.00 | 0.14 | **7.27** | 0.04 | 0.14 |
| g_vad | 0.13 | 0.00 | **7.04** | 0.17 | 0.26 |
| g_fixed | 0.88 | 0.90 | 0.00 | 0.88 | 0.90 |
| fw_v3 | 0.04 | 0.17 | **6.96** | 0.00 | 0.09 |

**C1** (clean 2-person; hybrid marginally closest to whole; fw a touch further):

| ref \ hyp | g_whole | g_vad | g_fixed | fw_v3 | fw_turbo |
|---|--:|--:|--:|--:|--:|
| g_whole | 0.00 | 0.18 | 0.16 | 0.21 | 0.28 |
| g_vad | 0.18 | 0.00 | 0.17 | 0.25 | 0.28 |
| fw_v3 | 0.22 | 0.25 | 0.27 | 0.00 | 0.23 |

#### Aligned transcript excerpts (for a native-Spanish eyeball)

Short, curated excerpts — the three clips where the approaches actually differ. Full transcripts stay in
the private scratch `out/`.

**B1 — the arbitrary-cut hallucination (this is the headline).** Real audio is a ~13 s Spanish greeting.

```
gemini_whole   [01:13] Hello hello, hola. ¿Cómo vamos? — Bien, por acá … tomando un café. — Claro.
               — ¿Cómo va? — Bien, mucho incendio, ¿no?                              (22 words, correct)

gemini_vad     [01:07] Seba. — Hola, hola, buenas. — ¿Cómo vamos? — Bien por acá, … tomar un café.
               — Claro. — ¿Cómo va? — Bien, mucho incendio, ¿no?          (23 words, correct, cheapest)

fw_large_v3    [01:08] Seas. Hello, hello, hola. ¿Cómo vamos? Bien, por acá … un café. Claro. ¿Cómo va?
               Bien, mucho incendio, ¿no?                                      (23 words, correct, local)

gemini_fixed   [00:00] "Yeah, definitely. And I noticed, uh, one other thing …"
               [00:06] "… there's actually real, live people behind all of this …"
               [00:36] "… usually in high school, middle school … they prepare you for exams …"
               [01:09] Hello, hello, ¿cómo va? … Bien, mucho incendio, ¿no?
               → 181 words; the first ~150 are FABRICATED English, not in the audio.  (arbitrary cut = hallucination)
```

**A2 — rapid roll-call: whole-clip Gemini keeps the names; VAD chunking garbles them.**

```
gemini_whole   [00:14] Speaker 2: … yo no estoy en el canal, Juan Camilo Hernández.
               [00:32] Speaker 4: Oscar Pereyra también, por favor, Seba.
               [00:45] Speaker 6: Yo también, Seba, Santiago de la Colina.          (names correct)

gemini_vad     [00:19] Speaker 1: A ti.   ← ("Abby"/name lost)
               [00:57] Speaker 5: Yo también, Seba. Santiago de la colina.
               [01:08] Speaker 2: Sí, bien por ahí, también se apoya de santo.   ← (garbled)

gemini_fixed   [00:14] Atby…   [00:49] Óscar Perera…   [01:00] Santiago de la Colina.  (names partly garbled)

fw_large_v3    drops turns: 83 words vs Gemini's 95; "¿Quién más?" repeated, several names missing.
```

**A1 — dense continuous speech: all three Gemini variants near-identical; `fw_turbo` loops at the end.**

```
gemini_vad     … entender quién está trabajando con qué artefactos … cuándo van a certificar,
               son las dos métricas que tenemos.                                  (clean)

fw_turbo       … Son las dos métricas que tenemos.
               Son las dos métricas que tenemos.
               Son las dos métricas que tenemos.
               Son las dos métricas que tenemos.       ← whisper loop (trigram-dup 0.098, the worst signal)
```

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
