#!/usr/bin/env python
"""
Batch convert all .hda files to .wav in the HiDock recordings folder.
"""

import os
import sys

# Add src directory to path
script_dir = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.join(script_dir, "src")
sys.path.insert(0, src_dir)

from hta_converter import HTAConverter

RECORDINGS_DIR = r"C:\Users\Sebastian\HiDock\recordings"


def main():
    print("=" * 60)
    print("HiDock HDA to WAV Batch Converter")
    print("=" * 60)

    converter = HTAConverter()

    # Find all .hda files
    hda_files = [f for f in os.listdir(RECORDINGS_DIR) if f.endswith('.hda')]
    print(f"\nFound {len(hda_files)} .hda files to convert")

    # Find existing .wav files
    wav_files = set(f.replace('.wav', '') for f in os.listdir(RECORDINGS_DIR) if f.endswith('.wav'))
    print(f"Found {len(wav_files)} existing .wav files")

    # Filter to only convert files that don't already have .wav versions
    to_convert = []
    for hda in hda_files:
        base_name = hda.replace('.hda', '')
        if base_name not in wav_files:
            to_convert.append(hda)

    print(f"Need to convert {len(to_convert)} files (others already have .wav)")

    if not to_convert:
        print("\nAll files already converted!")
        return 0

    # Convert files
    success_count = 0
    fail_count = 0

    for i, hda_file in enumerate(to_convert, 1):
        hda_path = os.path.join(RECORDINGS_DIR, hda_file)
        wav_path = hda_path.replace('.hda', '.wav')

        print(f"\n[{i}/{len(to_convert)}] Converting: {hda_file}")

        try:
            result = converter.convert_hta_to_wav(hda_path, wav_path)
            if result:
                success_count += 1
                print(f"  OK: {wav_path}")
            else:
                fail_count += 1
                print(f"  FAILED: Conversion returned None")
        except Exception as e:
            fail_count += 1
            print(f"  ERROR: {e}")

    print("\n" + "=" * 60)
    print(f"Conversion complete:")
    print(f"  Success: {success_count}")
    print(f"  Failed: {fail_count}")
    print("=" * 60)

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
