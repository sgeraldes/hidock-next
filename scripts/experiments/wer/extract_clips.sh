#!/usr/bin/env bash
# Extract the representative WER-comparison clips as 16 kHz mono WAV masters.
#
# HiDock ".wav" files are actually MP3 (the device only renames the extension).
# ffmpeg decodes the MP3 and resamples to 16 kHz mono PCM — the format both
# faster-whisper and (after mp3 re-encode) Gemini consume. HiDock's 64 kbps
# recordings are already ~16 kHz mono, so this is essentially loss-free for the
# transcription task and keeps every approach on identical audio.
#
# 3 source recordings of DIFFERENT length + speaker count; 1–2 clips each:
#   A  long, multi-speaker, Spanish (DFX5 practice mtg)  2026Jul08-151114-Rec47.wav  (52.9 min)
#        A1 140–230s  Memo->Sebastián handoff (2 speakers; the 2:31 boundary case)
#        A2 900–985s  roll-call region (rapid multi-speaker self-intros)
#   B  mid, 256 kbps                                      2025Aug06-163052-Rec22.wav  (15.8 min)
#        B1 300–390s
#   C  short recording                                    2026Feb03-092406-Rec12.wav  (2.4 min)
#        C1  25–110s
#
# Usage: AUD=F:/HiDock-Next-Audios OUT=/path/to/clips bash extract_clips.sh
set -euo pipefail
AUD="${AUD:-F:/HiDock-Next-Audios}"
OUT="${OUT:-./clips}"
mkdir -p "$OUT"

emit() { # key src ss dur
  ffmpeg -y -v error -ss "$3" -t "$4" -i "$AUD/$2" -ac 1 -ar 16000 -c:a pcm_s16le "$OUT/$1.wav"
  printf 'wrote %s.wav  (src=%s ss=%s dur=%s)\n' "$1" "$2" "$3" "$4"
}

emit A1 "2026Jul08-151114-Rec47.wav" 140 90
emit A2 "2026Jul08-151114-Rec47.wav" 900 85
emit B1 "2025Aug06-163052-Rec22.wav" 300 90
emit C1 "2026Feb03-092406-Rec12.wav"  25 85
