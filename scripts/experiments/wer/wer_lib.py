"""
Shared helpers for the WER / hybrid-chunking spike.

Approaches under test (all consume the same 16 kHz mono WAV master per clip):
  gemini_whole  - the electron app's CURRENT path: whole clip -> one Gemini call,
                  using the app's EXACT transcription prompt (packages/transcription
                  gemini-engine.ts). For a <10 min clip the app sends it whole.
  gemini_vad    - HYBRID (the idea under test): faster-whisper Silero VAD finds
                  speech regions; we pack them into ~TARGET_SEC chunks cut only at
                  silence, encode each to mp3, send each to Gemini with the app's
                  multi-segment prompt (segment i of n + previous-tail hint), then
                  reassemble with absolute timestamps.
  gemini_fixed  - CONTROL: split the clip into fixed TARGET_SEC chunks REGARDLESS of
                  speech (mimics the app's arbitrary MPEG-frame cut on long files).
                  gemini_vad vs gemini_fixed isolates the one variable: does cutting
                  at silence beat cutting arbitrarily, at equal chunk granularity?
  fw_large_v3   - full-local baseline: faster-whisper large-v3 (== the WhisperX ASR
                  core; best PUBLISHED Spanish WER of anything that fits a 4090).
  fw_turbo      - Part-1 candidate: faster-whisper large-v3-turbo (speed toggle;
                  research says measurably worse Spanish than large-v3).

The Gemini API key + model are read from the electron app config at runtime
(never hardcoded). Nothing here writes to the app DB or config.
"""
from __future__ import annotations
import json, os, re, shutil, subprocess, sys, time, unicodedata, wave, tempfile
from dataclasses import dataclass, field, asdict
from typing import Optional

import numpy as np

# ---------------------------------------------------------------------------
# app config (Gemini key/model) — read-only
# ---------------------------------------------------------------------------
APP_DIR = "hidock-universal-knowledge-hub"  # the active electron app (gemini-3.5-flash, es)

def load_app_gemini_config() -> dict:
    p = os.path.join(os.environ["APPDATA"], APP_DIR, "config.json")
    t = json.load(open(p, encoding="utf-8"))["transcription"]
    key = t.get("geminiApiKey", "")
    if not key:
        raise SystemExit(f"No geminiApiKey in {p}")
    return {"apiKey": key, "model": t.get("geminiModel") or "gemini-3.5-flash",
            "language": t.get("language") or "es"}

# ---------------------------------------------------------------------------
# audio io
# ---------------------------------------------------------------------------
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"

def read_wav_16k_mono(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1, "expect 16k mono wav"
        n = w.getnframes()
        raw = w.readframes(n)
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return audio, 16000

def encode_segment_mp3(audio: np.ndarray, sr: int, t0: float, t1: float) -> bytes:
    """Cut [t0,t1] from the float32 master and encode to mono 64 kbps mp3 (what
    the app sends Gemini). Returns raw mp3 bytes."""
    i0, i1 = max(0, int(t0 * sr)), min(len(audio), int(t1 * sr))
    seg = (np.clip(audio[i0:i1], -1, 1) * 32767).astype(np.int16)
    with tempfile.TemporaryDirectory() as d:
        wpath = os.path.join(d, "seg.wav"); mpath = os.path.join(d, "seg.mp3")
        with wave.open(wpath, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(seg.tobytes())
        subprocess.run([FFMPEG, "-y", "-v", "error", "-i", wpath, "-c:a", "libmp3lame",
                        "-b:a", "64k", mpath], check=True)
        return open(mpath, "rb").read()

# ---------------------------------------------------------------------------
# VAD (faster-whisper's bundled Silero) -> chunk plans
# ---------------------------------------------------------------------------
def vad_speech_regions(audio: np.ndarray, sr: int) -> list[tuple[float, float]]:
    from faster_whisper.vad import get_speech_timestamps, VadOptions
    ts = get_speech_timestamps(audio, VadOptions(min_silence_duration_ms=300))
    return [(s["start"] / sr, s["end"] / sr) for s in ts]

def plan_vad_chunks(regions: list[tuple[float, float]], target_sec: float,
                    pad: float, total: float) -> list[tuple[float, float]]:
    """Pack VAD speech regions into chunks of ~target_sec, only ever cutting in
    the silence BETWEEN regions. Each chunk is padded by `pad` and clamped to
    [0,total]. This is the 'clean, well-bounded chunk' the hybrid hypothesis is
    about."""
    if not regions:
        return [(0.0, total)]
    chunks, cs, ce = [], regions[0][0], regions[0][1]
    for s, e in regions[1:]:
        if e - cs > target_sec:            # would overflow -> close chunk at the gap
            chunks.append((cs, ce)); cs, ce = s, e
        else:
            ce = e
    chunks.append((cs, ce))
    return [(max(0.0, a - pad), min(total, b + pad)) for a, b in chunks]

def plan_fixed_chunks(total: float, target_sec: float) -> list[tuple[float, float]]:
    """Fixed target_sec windows regardless of speech (the arbitrary-cut control)."""
    out, t = [], 0.0
    while t < total:
        out.append((t, min(total, t + target_sec))); t += target_sec
    return out

# ---------------------------------------------------------------------------
# Gemini — replicate the app's prompt exactly (gemini-engine.ts)
# ---------------------------------------------------------------------------
def _gemini_prompt(index: int, n: int, previous_tail: str) -> str:
    position = ""
    if n > 1:
        position = f"\nThis is segment {index + 1} of {n} of a longer recording."
        if previous_tail:
            position += (f"\nThe previous segment ended with:\n«{previous_tail}»\n"
                         "Keep the Speaker N numbering consistent with it.")
    return ("Transcribe this audio recording.\n"
            "The audio may be in Spanish or English - transcribe in the original language.\n"
            "Format the transcription as one line per speaker turn, using EXACTLY this format:\n"
            "[MM:SS] Speaker N: what the speaker said\n"
            "- [MM:SS] is the time of the turn relative to the START of THIS audio segment (it starts at 00:00).\n"
            '- "Speaker N" is a stable label per distinct voice (Speaker 1, Speaker 2, ...); reuse the same number for the same voice.\n'
            "- Put every speaker turn on its own line. Do not merge different speakers onto one line.\n"
            "Transcribe ALL speech through to the very end of the audio, including brief closings and goodbyes."
            f"{position}\n"
            "Return ONLY the transcription lines, no additional commentary.")

@dataclass
class GeminiCallStat:
    prompt_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    finish: str = ""
    seconds: float = 0.0

def gemini_transcribe_segment(model, mp3: bytes, index: int, n: int,
                              previous_tail: str) -> tuple[str, GeminiCallStat]:
    """One Gemini call on one mp3 segment, mirroring the app: max_output_tokens
    8192, retry at 16384 on MAX_TOKENS. (The Python SDK 0.8.5 rejects
    thinking_config; gemini-3.5-flash empirically does not spend the output
    budget on thinking here — verified finish=STOP — so we omit it.)"""
    part = {"mime_type": "audio/mp3", "data": mp3}
    prompt = _gemini_prompt(index, n, previous_tail)
    st = GeminiCallStat()
    def attempt(maxtok):
        t = time.time()
        r = model.generate_content([part, {"text": prompt}] if False else [part, prompt],
                                   generation_config={"max_output_tokens": maxtok})
        st.seconds += time.time() - t
        um = getattr(r, "usage_metadata", None)
        if um:
            st.prompt_tokens += getattr(um, "prompt_token_count", 0) or 0
            st.output_tokens += getattr(um, "candidates_token_count", 0) or 0
            st.total_tokens += getattr(um, "total_token_count", 0) or 0
        fr = r.candidates[0].finish_reason if r.candidates else None
        st.finish = str(fr)
        try:
            txt = r.text
        except Exception:
            txt = ""
        return txt.strip(), fr
    txt, fr = attempt(8192)
    if str(fr) == "FinishReason.MAX_TOKENS" or str(fr) == "2":
        rtxt, rfr = attempt(16384)
        if rtxt:
            txt = rtxt
    return txt, st

# strip "[MM:SS] Speaker N:" markers -> plain words (for WER)
_TURN_RE = re.compile(r"\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]\s*(Speaker\s*\d+)\s*:", re.I)

def gemini_text_to_plain(text: str) -> str:
    """Remove timestamp+speaker markers, keep the spoken words only."""
    text = _TURN_RE.sub(" ", text)
    text = re.sub(r"\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]", " ", text)   # bare timestamps
    text = re.sub(r"^\s*Speaker\s*\d+\s*:", " ", text, flags=re.M | re.I)
    return re.sub(r"\s+", " ", text).strip()

def parse_gemini_turns(text: str, offset: float) -> list[dict]:
    """Very light turn parse for the side-by-side (absolute timestamps)."""
    turns = []
    for m in _TURN_RE.finditer(text):
        mm, ss, hh = int(m.group(1)), int(m.group(2)), m.group(3)
        t = mm * 3600 + ss * 60 + int(hh) if hh else mm * 60 + ss
        turns.append({"start": offset + t, "speaker": m.group(4).strip(), "pos": m.end()})
    segs = []
    for i, tn in enumerate(turns):
        end = turns[i + 1]["pos"] if i + 1 < len(turns) else len(text)
        body = re.sub(r"\s+", " ", text[tn["pos"]:end]).strip()
        if body:
            segs.append({"start": tn["start"], "speaker": tn["speaker"], "text": body})
    if not segs:  # no markers -> whole thing one turn
        body = gemini_text_to_plain(text)
        if body:
            segs = [{"start": offset, "speaker": "Speaker ?", "text": body}]
    return segs

# ---------------------------------------------------------------------------
# WER / objective quality signals
# ---------------------------------------------------------------------------
def normalize_for_wer(text: str, strip_accents: bool = False) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    if strip_accents:
        text = "".join(c for c in unicodedata.normalize("NFD", text)
                       if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^\w\sáéíóúüñ]", " ", text)   # drop punctuation, keep es letters
    return re.sub(r"\s+", " ", text).strip()

def wer(ref: str, hyp: str) -> float:
    import jiwer
    r, h = normalize_for_wer(ref), normalize_for_wer(hyp)
    if not r:
        return float("nan")
    return jiwer.wer(r, h)

def repetition_signal(plain: str) -> dict:
    """Machine-detectable hallucination/loop signals.
    - trigram_dup_ratio: 1 - unique/total trigrams (higher = more repetition).
    - max_immediate_repeat: longest run of an immediately-repeated token block
      (a classic whisper/LLM loop, e.g. 'gracias gracias gracias...').
    """
    words = normalize_for_wer(plain).split()
    n = len(words)
    if n < 4:
        return {"words": n, "trigram_dup_ratio": 0.0, "max_immediate_repeat": 0}
    tris = [tuple(words[i:i+3]) for i in range(n - 2)]
    dup = 1.0 - (len(set(tris)) / len(tris))
    best = 0
    for size in (1, 2, 3, 4, 5):
        run = 1; i = size
        while i + size <= n:
            if words[i:i+size] == words[i-size:i]:
                run += 1; best = max(best, run)
            else:
                run = 1
            i += size
    return {"words": n, "trigram_dup_ratio": round(dup, 4), "max_immediate_repeat": best}

def coverage_gap_signal(word_times: list[tuple[float, float]], regions: list[tuple[float, float]]) -> dict:
    """For word-timestamped engines: seconds of VAD speech with NO transcribed
    word inside them (dropped-segment detector). Gemini has no word times so we
    skip it there (proxied by word-count deltas in the report instead)."""
    if not regions:
        return {"speech_sec": 0.0, "uncovered_sec": 0.0}
    covered = np.zeros(0)
    speech = sum(e - s for s, e in regions)
    grid = 0.05
    tmax = max(e for _, e in regions)
    bins = int(tmax / grid) + 1
    has_speech = np.zeros(bins, bool); has_word = np.zeros(bins, bool)
    for s, e in regions:
        has_speech[int(s/grid):int(e/grid)+1] = True
    for s, e in word_times:
        has_word[int(s/grid):min(bins, int(e/grid)+1)] = True
    uncovered = float(np.sum(has_speech & ~has_word) * grid)
    return {"speech_sec": round(speech, 1), "uncovered_sec": round(uncovered, 1)}
