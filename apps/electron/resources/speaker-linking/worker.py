"""Local acoustic diarization + per-speaker embedding worker.

Stdout is a single JSON document. Diagnostics go to stderr so Electron can
parse the result without log scraping. The model is downloaded/cached by
Hugging Face once and can then run offline.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def as_list(value: Any) -> list[float]:
    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    if hasattr(value, "tolist"):
        value = value.tolist()
    return [float(item) for item in value]


def get_hf_token() -> str | None:
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    if token:
        return token
    config_path = Path(os.environ.get("APPDATA", "")) / "hidock-universal-knowledge-hub" / "config.json"
    try:
        return json.loads(config_path.read_text(encoding="utf-8")).get("transcription", {}).get("localAsrHfToken")
    except Exception:
        return None


def decode_audio(audio_path: str, torch: Any) -> dict[str, Any]:
    """Decode any app-supported audio without torchcodec.

    pyannote.audio 4 delegates path decoding to torchcodec. Its native DLLs are
    fragile on Windows and are unnecessary here because Electron already ships
    FFmpeg. Feeding an in-memory 16 kHz mono waveform also makes the worker's
    input contract identical in development and packaged builds.
    """

    ffmpeg = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
    if not ffmpeg or not Path(ffmpeg).is_file():
        raise RuntimeError("FFmpeg is required for local speaker linking but was not found")
    process = subprocess.run(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            audio_path,
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ac",
            "1",
            "-ar",
            "16000",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if process.returncode != 0:
        detail = process.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg could not decode recording: {detail or process.returncode}")
    if len(process.stdout) < 4:
        raise RuntimeError("FFmpeg decoded an empty recording")
    # Avoid numpy/torchaudio decoding dependencies. frombuffer reads FFmpeg's
    # little-endian float32 stream, and clone owns the immutable bytes safely.
    waveform = torch.frombuffer(bytearray(process.stdout), dtype=torch.float32).clone().unsqueeze(0)
    return {"waveform": waveform, "sample_rate": 16000, "uri": Path(audio_path).stem}


def main() -> int:
    parser = argparse.ArgumentParser(description="HiDock persistent acoustic speaker-linking worker")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="pyannote/speaker-diarization-community-1")
    parser.add_argument("--fallback-model", default="pyannote/speaker-diarization-3.1")
    parser.add_argument("--min-speech-seconds", type=float, default=4.0)
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    args = parser.parse_args()

    # Some native/model dependencies print diagnostics such as "Could not ..."
    # to stdout while importing or loading. Electron's worker contract reserves
    # stdout for exactly one JSON document, so redirect all third-party stdout to
    # stderr and retain the original stream only for the final result.
    result_stdout = sys.stdout
    sys.stdout = sys.stderr

    # Heavy imports stay inside main so --help and packaging checks do not need
    # the CUDA runtime or model dependencies installed.
    import torch
    from pyannote.audio import Pipeline

    token = get_hf_token()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    log(f"loading {args.model} on {device}")
    actual_model = args.model
    try:
        try:
            pipeline = Pipeline.from_pretrained(actual_model, token=token)
        except TypeError:
            pipeline = Pipeline.from_pretrained(actual_model, use_auth_token=token)
    except Exception as primary_error:
        if not args.fallback_model or args.fallback_model == actual_model:
            raise
        actual_model = args.fallback_model
        log(f"primary model unavailable ({primary_error}); falling back to {actual_model}")
        try:
            pipeline = Pipeline.from_pretrained(actual_model, token=token)
        except TypeError:
            pipeline = Pipeline.from_pretrained(actual_model, use_auth_token=token)
    pipeline.to(torch.device(device))
    audio_input = decode_audio(args.audio, torch)

    kwargs: dict[str, int] = {}
    if args.min_speakers is not None:
        kwargs["min_speakers"] = args.min_speakers
    if args.max_speakers is not None:
        kwargs["max_speakers"] = args.max_speakers
    output = pipeline(audio_input, **kwargs)

    diarization = getattr(output, "speaker_diarization", output)
    embeddings = getattr(output, "speaker_embeddings", None)
    if embeddings is None:
        raise RuntimeError(
            "The selected pyannote pipeline did not return speaker_embeddings. "
            "Use speaker-diarization-community-1 with a current pyannote.audio release."
        )

    labels = list(diarization.labels())
    embedding_rows = [as_list(row) for row in embeddings]
    if len(labels) != len(embedding_rows):
        raise RuntimeError(
            f"speaker label/embedding count mismatch: {len(labels)} labels, {len(embedding_rows)} embeddings"
        )

    segments: list[dict[str, Any]] = []
    speech_seconds = {label: 0.0 for label in labels}
    for segment, _, label in diarization.itertracks(yield_label=True):
        start = round(float(segment.start), 3)
        end = round(float(segment.end), 3)
        if end <= start:
            continue
        segments.append({"start": start, "end": end, "speaker": str(label)})
        speech_seconds[str(label)] = speech_seconds.get(str(label), 0.0) + (end - start)

    speakers = []
    for label, embedding in zip(labels, embedding_rows):
        duration = round(speech_seconds.get(str(label), 0.0), 3)
        if duration < args.min_speech_seconds:
            continue
        speakers.append(
            {
                "label": str(label),
                "embedding": embedding,
                "speechSeconds": duration,
            }
        )

    result = {
        "model": actual_model,
        "modelVersion": importlib.metadata.version("pyannote.audio"),
        "device": device,
        "segments": segments,
        "speakers": speakers,
    }
    json.dump(result, result_stdout, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # Electron surfaces stderr in processing provenance.
        log(f"speaker-linking failed: {exc}")
        raise
