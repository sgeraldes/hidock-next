"""
Run the 5 transcription approaches over each clip, compute objective signals +
pairwise WER, and emit aligned side-by-side transcripts for a native-Spanish
human to judge. Reads the Gemini key/model from the electron app config.

Usage:
  python run_wer.py --clips-dir <dir> --out-dir <dir> [--clips A1 A2 B1 C1]
                    [--target-sec 30] [--skip-gemini] [--skip-local]

Outputs (in --out-dir):
  <clip>.json     raw per-approach results + signals + WER matrix
  results.md      aligned side-by-side transcripts + tables (curate into the doc)
"""
from __future__ import annotations
import argparse, json, os, sys, time
import wer_lib as L

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

APPROACHES = ["gemini_whole", "gemini_vad", "gemini_fixed", "fw_large_v3", "fw_turbo"]

def fmt_ts(t: float) -> str:
    t = int(t); return f"{t//60:02d}:{t%60:02d}"

# --- local ASR (faster-whisper) --------------------------------------------
def _register_cuda_dlls():
    """The nvidia-*-cu12 pip wheels drop cublas/cudnn DLLs under
    site-packages/nvidia/*/bin, which Windows does not auto-load. Register those
    dirs so ctranslate2 can find cublas64_12.dll / cudnn*.dll."""
    import glob, site
    roots = set(site.getsitepackages() + [os.path.dirname(os.path.dirname(__file__))])
    for sp in roots:
        for binp in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            try: os.add_dll_directory(binp)
            except Exception: pass
            os.environ["PATH"] = binp + os.pathsep + os.environ.get("PATH", "")

_MODELS = {}
def get_fw(model_name: str):
    if model_name not in _MODELS:
        _register_cuda_dlls()
        from faster_whisper import WhisperModel
        _MODELS[model_name] = WhisperModel(model_name, device="cuda", compute_type="float16")
    return _MODELS[model_name]

def run_fw(clip_wav: str, model_name: str, lang: str) -> dict:
    m = get_fw(model_name)
    t = time.time()
    segs, info = m.transcribe(clip_wav, language=lang, vad_filter=True,
                              word_timestamps=True, beam_size=5)
    out_segs, word_times = [], []
    for s in segs:
        out_segs.append({"start": s.start, "end": s.end, "text": s.text.strip()})
        if s.words:
            for w in s.words:
                word_times.append((w.start, w.end))
    dt = time.time() - t
    plain = " ".join(s["text"] for s in out_segs)
    return {"segments": out_segs, "text_plain": plain, "wall_sec": round(dt, 2),
            "word_times": word_times, "gemini_tokens": None}

# --- Gemini approaches ------------------------------------------------------
def run_gemini(audio, sr, total, mode: str, cfg, target_sec: float) -> dict:
    import google.generativeai as genai
    genai.configure(api_key=cfg["apiKey"])
    model = genai.GenerativeModel(cfg["model"])
    if mode == "whole":
        plan = [(0.0, total)]
    elif mode == "vad":
        regions = L.vad_speech_regions(audio, sr)
        plan = L.plan_vad_chunks(regions, target_sec, pad=0.3, total=total)
    elif mode == "fixed":
        plan = L.plan_fixed_chunks(total, target_sec)
    else:
        raise ValueError(mode)
    n = len(plan)
    all_segs, prev_tail, tokens, wall = [], "", 0, 0.0
    raw_texts = []
    for i, (t0, t1) in enumerate(plan):
        mp3 = L.encode_segment_mp3(audio, sr, t0, t1)
        txt, st = L.gemini_transcribe_segment(model, mp3, i, n, prev_tail)
        wall += st.seconds; tokens += st.total_tokens
        raw_texts.append({"chunk": i, "t0": round(t0, 1), "t1": round(t1, 1), "text": txt})
        segs = L.parse_gemini_turns(txt, offset=t0)
        all_segs.extend(segs)
        if segs:
            prev_tail = segs[-1]["text"][-300:]
    plain = " ".join(s["text"] for s in all_segs)
    return {"segments": all_segs, "text_plain": plain, "wall_sec": round(wall, 2),
            "chunks": [{"t0": round(a, 1), "t1": round(b, 1)} for a, b in plan],
            "raw": raw_texts, "gemini_tokens": tokens, "word_times": []}

def process_clip(key, clips_dir, cfg, target_sec, do_gemini, do_local) -> dict:
    wav = os.path.join(clips_dir, f"{key}.wav")
    audio, sr = L.read_wav_16k_mono(wav)
    total = len(audio) / sr
    regions = L.vad_speech_regions(audio, sr)
    res = {"clip": key, "duration_sec": round(total, 1),
           "vad_regions": [(round(a, 1), round(b, 1)) for a, b in regions],
           "vad_speech_sec": round(sum(b - a for a, b in regions), 1),
           "approaches": {}}
    if do_gemini:
        for mode, name in [("whole", "gemini_whole"), ("vad", "gemini_vad"), ("fixed", "gemini_fixed")]:
            print(f"  [{key}] {name} ...", flush=True)
            res["approaches"][name] = run_gemini(audio, sr, total, mode, cfg, target_sec)
    if do_local:
        for mn, name in [("large-v3", "fw_large_v3"), ("large-v3-turbo", "fw_turbo")]:
            print(f"  [{key}] {name} ...", flush=True)
            r = run_fw(wav, mn, cfg["language"])
            r["coverage"] = L.coverage_gap_signal(r["word_times"], regions)
            res["approaches"][name] = r
    # signals + pairwise WER
    for name, a in res["approaches"].items():
        plain = L.gemini_text_to_plain(a["text_plain"]) if name.startswith("gemini") else a["text_plain"]
        a["plain_words"] = plain
        a["signals"] = L.repetition_signal(plain)
    names = list(res["approaches"].keys())
    matrix = {}
    for ref in names:
        matrix[ref] = {}
        for hyp in names:
            matrix[ref][hyp] = round(L.wer(res["approaches"][ref]["plain_words"],
                                           res["approaches"][hyp]["plain_words"]), 3)
    res["wer_matrix"] = matrix
    return res

def md_for_clip(res) -> str:
    key = res["clip"]
    lines = [f"### Clip {key} — {res['duration_sec']:.0f}s "
             f"(VAD speech {res['vad_speech_sec']:.0f}s across {len(res['vad_regions'])} regions)\n"]
    # signal table
    lines.append("| approach | words | trigram-dup | max-loop | wall s | Gemini tok | uncovered-speech s |")
    lines.append("|---|--:|--:|--:|--:|--:|--:|")
    for name in APPROACHES:
        a = res["approaches"].get(name)
        if not a: continue
        s = a["signals"]; cov = a.get("coverage", {})
        lines.append(f"| {name} | {s['words']} | {s['trigram_dup_ratio']} | "
                     f"{s['max_immediate_repeat']} | {a['wall_sec']} | "
                     f"{a.get('gemini_tokens') or '-'} | {cov.get('uncovered_sec','-')} |")
    # WER matrix
    lines.append("\n**Pairwise WER (rows=reference, cols=hypothesis; not ground truth — inter-engine distance):**\n")
    names = [n for n in APPROACHES if n in res["approaches"]]
    lines.append("| ref \\ hyp | " + " | ".join(names) + " |")
    lines.append("|---" * (len(names) + 1) + "|")
    for ref in names:
        row = " | ".join(f"{res['wer_matrix'][ref][h]:.2f}" for h in names)
        lines.append(f"| {ref} | {row} |")
    # aligned transcripts
    lines.append("\n**Transcripts (absolute timestamps):**\n")
    for name in APPROACHES:
        a = res["approaches"].get(name)
        if not a: continue
        lines.append(f"\n_{name}_" + (f"  (chunks: {len(a['chunks'])})" if a.get("chunks") else ""))
        lines.append("```")
        for seg in a["segments"][:60]:
            sp = seg.get("speaker", "")
            lines.append(f"[{fmt_ts(seg['start'])}] {sp+': ' if sp else ''}{seg['text']}")
        lines.append("```")
    return "\n".join(lines) + "\n"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--clips", nargs="*", default=["A1", "A2", "B1", "C1"])
    ap.add_argument("--target-sec", type=float, default=30.0)
    ap.add_argument("--skip-gemini", action="store_true")
    ap.add_argument("--skip-local", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    cfg = L.load_app_gemini_config()
    print(f"Gemini model={cfg['model']} lang={cfg['language']} | target chunk={args.target_sec}s")
    md = [f"# WER spike raw results\n\nGemini model: `{cfg['model']}` · language `{cfg['language']}` · "
          f"chunk target {args.target_sec:.0f}s · generated {time.strftime('%Y-%m-%d %H:%M')}\n"]
    for key in args.clips:
        print(f"clip {key}", flush=True)
        res = process_clip(key, args.clips_dir, cfg, args.target_sec,
                           not args.skip_gemini, not args.skip_local)
        json.dump(res, open(os.path.join(args.out_dir, f"{key}.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        md.append(md_for_clip(res))
    open(os.path.join(args.out_dir, "results.md"), "w", encoding="utf-8").write("\n".join(md))
    print("wrote results.md")

if __name__ == "__main__":
    main()
