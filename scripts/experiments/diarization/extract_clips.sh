#!/usr/bin/env bash
# Extract the two iteration windows from Rec47 as 16 kHz mono WAV.
# HiDock records MP3 payload with a .wav extension; ffmpeg auto-detects the MP3 stream.
# Window A = the Memo -> Sebastian boundary the user flagged (~2:31).
# Window B = the roll-call self-intros (~15:42-16:10).
set -euo pipefail

SRC="${1:-F:/HiDock-Next-Audios/2026Jul08-151114-Rec47.wav}"
OUT="${2:-./clips}"
mkdir -p "$OUT"

# probe (should report codec_name=mp3, sample_rate=16000, channels=1, duration ~3175s)
ffprobe -v error -show_entries format=format_name,duration -show_entries stream=codec_name,sample_rate,channels "$SRC"

# Clip A: 0:00-3:30
ffmpeg -y -v error -i "$SRC" -ss 0   -t 210 -ac 1 -ar 16000 "$OUT/rec47_A_0000-0330.wav"
# Clip B: 15:30-16:30
ffmpeg -y -v error -i "$SRC" -ss 930 -t 60  -ac 1 -ar 16000 "$OUT/rec47_B_1530-1630.wav"
# Full file (real WAV) for the final full-run — optional, large:
# ffmpeg -y -v error -i "$SRC" -ac 1 -ar 16000 "$OUT/rec47_full.wav"

echo "clips written to $OUT"
