"""
Diarization spike harness: WhisperX (faster-whisper ASR + word alignment) + pyannote 3.1 diarization.

Usage:
  python run_whisperx.py <audio.wav> --out out.json --lang es \
      [--model large-v3] [--min-speakers N] [--max-speakers M] \
      [--onset 0.5] [--offset 0.5]

Requires HF_TOKEN env var (pyannote/speaker-diarization-3.1 is a gated model).
Reads the token from the app config as a fallback if HF_TOKEN is unset.

Prints a compact per-segment speaker+timestamp transcript and timing/RAM stats.
This is an experiment script — it does NOT touch the app, DB, or device.
"""
import argparse
import json
import os
import sys
import time

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def log(*a):
    print(*a, flush=True)


def get_hf_token():
    # Prefer the app config token (known-good). A stale/invalid HF_TOKEN may be set in
    # the shell and huggingface_hub gives env vars PRECEDENCE over the passed token, so
    # if we find a config token we also overwrite the env vars with it.
    cfg = os.path.join(os.environ.get("APPDATA", ""), "hidock-universal-knowledge-hub", "config.json")
    tok = None
    try:
        with open(cfg, "r", encoding="utf-8") as f:
            tok = json.load(f).get("transcription", {}).get("localAsrHfToken")
    except Exception:
        tok = None
    tok = tok or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if tok:
        # force consistency so pyannote/hf_hub don't fall back to a bad env token
        os.environ["HF_TOKEN"] = tok
        os.environ["HUGGINGFACE_HUB_TOKEN"] = tok
    return tok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--out", required=True)
    ap.add_argument("--lang", default="es")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--min-speakers", type=int, default=None)
    ap.add_argument("--max-speakers", type=int, default=None)
    ap.add_argument("--compute-type", default="float16")
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--no-diarize", action="store_true")
    ap.add_argument("--diar-model", default=None,
                    help="e.g. pyannote/speaker-diarization-3.1 (default: whisperx built-in community-1)")
    args = ap.parse_args()

    import torch
    import whisperx

    device = "cuda" if torch.cuda.is_available() else "cpu"
    log(f"[cfg] device={device} model={args.model} lang={args.lang} "
        f"min={args.min_speakers} max={args.max_speakers} compute={args.compute_type}")

    timings = {}
    t0 = time.time()
    audio = whisperx.load_audio(args.audio)
    dur = len(audio) / 16000.0
    timings["load_audio_s"] = round(time.time() - t0, 2)
    log(f"[audio] duration={dur:.1f}s")

    # 1. ASR
    t0 = time.time()
    asr = whisperx.load_model(args.model, device, compute_type=args.compute_type, language=args.lang)
    result = asr.transcribe(audio, batch_size=args.batch_size, language=args.lang)
    timings["asr_s"] = round(time.time() - t0, 2)
    log(f"[asr] {len(result['segments'])} segments in {timings['asr_s']}s")

    # 2. Word-level alignment
    t0 = time.time()
    align_model, meta = whisperx.load_align_model(language_code=args.lang, device=device)
    result = whisperx.align(result["segments"], align_model, meta, audio, device, return_char_alignments=False)
    timings["align_s"] = round(time.time() - t0, 2)
    log(f"[align] word-level alignment in {timings['align_s']}s")

    diarize_segments = None
    if not args.no_diarize:
        # 3. Diarization (pyannote 3.1)
        tok = get_hf_token()
        if not tok:
            log("[diarize] ERROR: no HF token (set HF_TOKEN or config.localAsrHfToken). Skipping diarization.")
        else:
            t0 = time.time()
            try:
                from whisperx.diarize import DiarizationPipeline
            except Exception:
                from whisperx import DiarizationPipeline  # older layout
            # whisperx 3.8.x: DiarizationPipeline(model_name, token, device, cache_dir)
            kwargs = {"token": tok, "device": device}
            if args.diar_model:
                kwargs["model_name"] = args.diar_model
            try:
                diar = DiarizationPipeline(**kwargs)
            except TypeError:
                kwargs.pop("token"); kwargs["use_auth_token"] = tok
                diar = DiarizationPipeline(**kwargs)  # <3.8 fallback
            kw = {}
            if args.min_speakers is not None:
                kw["min_speakers"] = args.min_speakers
            if args.max_speakers is not None:
                kw["max_speakers"] = args.max_speakers
            diarize_segments = diar(audio, **kw)
            result = whisperx.assign_word_speakers(diarize_segments, result)
            timings["diarize_s"] = round(time.time() - t0, 2)
            log(f"[diarize] done in {timings['diarize_s']}s")

    # collapse consecutive words/segments into speaker turns
    segs = []
    for s in result["segments"]:
        spk = s.get("speaker", "UNKNOWN")
        segs.append({
            "start": round(float(s.get("start", 0)), 2),
            "end": round(float(s.get("end", 0)), 2),
            "speaker": spk,
            "text": s.get("text", "").strip(),
        })
    # merge adjacent same-speaker
    merged = []
    for s in segs:
        if merged and merged[-1]["speaker"] == s["speaker"]:
            merged[-1]["end"] = s["end"]
            merged[-1]["text"] += " " + s["text"]
        else:
            merged.append(dict(s))

    if device == "cuda":
        timings["gpu_peak_gb"] = round(torch.cuda.max_memory_allocated() / 1e9, 2)
    timings["audio_s"] = round(dur, 1)
    total = timings.get("asr_s", 0) + timings.get("align_s", 0) + timings.get("diarize_s", 0)
    timings["realtime_factor"] = round(total / dur, 3) if dur else None

    out = {
        "audio": args.audio,
        "config": {"model": args.model, "lang": args.lang,
                   "min_speakers": args.min_speakers, "max_speakers": args.max_speakers},
        "timings": timings,
        "distinct_speakers": sorted({s["speaker"] for s in merged}),
        "segments": merged,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    log("\n===== SPEAKER TURNS =====")
    for s in merged:
        log(f"[{s['start']:>7.1f}-{s['end']:>7.1f}] {s['speaker']}: {s['text'][:200]}")
    log(f"\n[stats] {json.dumps(timings)}")
    log(f"[stats] distinct speakers: {out['distinct_speakers']}")


if __name__ == "__main__":
    main()
