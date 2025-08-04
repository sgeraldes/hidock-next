#!/usr/bin/env python3
"""Check formatting issues in test files"""

files = [
    "tests/test_audio_processing_advanced.py",
    "tests/test_audio_player_enhanced.py",
    "tests/test_transcription_module.py",
    "tests/test_audio_visualization.py",
]

issues = []
for filepath in files:
    try:
        with open(filepath, "r") as f:
            lines = f.readlines()
            for i, line in enumerate(lines, 1):
                # Check line length
                if len(line.rstrip()) > 120:
                    issues.append(f"{filepath}:{i}: E501 line too long ({len(line.rstrip())} > 120 characters)")
                # Check trailing whitespace
                if line.rstrip() != line.rstrip("\n").rstrip("\r"):
                    issues.append(f"{filepath}:{i}: W291 trailing whitespace")
                # Check for tabs
                if "\t" in line:
                    issues.append(f"{filepath}:{i}: W191 indentation contains tabs")
                # Check blank lines with whitespace
                if line.strip() == "" and len(line) > 1:
                    issues.append(f"{filepath}:{i}: W293 blank line contains whitespace")
    except Exception as e:
        print(f"Error reading {filepath}: {e}")

print(f"Found {len(issues)} formatting issues:")
for issue in issues[:50]:  # Show first 50 issues
    print(issue)
if len(issues) > 50:
    print(f"... and {len(issues) - 50} more issues")
