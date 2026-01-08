# Task: Remove Incorrect WAV Header Code from file-storage.ts

## Track: A (Audio Playback Fix)
## Priority: HIGH - CRITICAL
## Dependencies: None

## Current State
The uncommitted code in `file-storage.ts` incorrectly adds WAV headers to HDA files:
- Lines 91-130: `createWavHeader()` and `hasWavHeader()` functions
- Lines 173-176: Prepends WAV headers to HDA files during save
- Lines 381-385: Prepends WAV headers to WAV files during read

**Verified Fact**: HDA files are MPEG MP3 format (verified via forensic analysis):
- Binary comparison: 100% identical to .wav files
- File format: "MPEG ADTS, layer III, v2, 64 kbps, 16 kHz, Monaural"
- Headers: Start with `FF F3` (MPEG sync), NOT `RIFF` (WAV)

## What's Missing
Complete removal of WAV header addition logic that corrupts MPEG MP3 files.

## Implementation Notes
- **DO NOT** add WAV headers to MPEG MP3 data
- Keep the simple rename logic (`.hda` → `.wav`) on line 152 - already works
- Modern browsers detect format by content (magic bytes), not extension
- Cross-platform compatible: Format detection works on all platforms

## Acceptance Criteria
- [ ] Remove `createWavHeader()` function (lines 91-119)
- [ ] Remove `hasWavHeader()` function (lines 125-130)
- [ ] Remove WAV header addition in `saveRecording()` (lines 173-176)
- [ ] Remove WAV header addition in `readRecordingFile()` (lines 381-385)
- [ ] Keep rename logic `.hda` → `.wav` (line 152) unchanged
- [ ] Verify no other references to WAV header functions exist

## Files to Modify
- `apps/electron/electron/main/services/file-storage.ts`

## Related Specs
- See plan: `.claude/plans/melodic-jumping-kurzweil.md` (Root Cause Analysis section)
- FIX-002 (audio duration display) - depends on this fix

## Security Considerations
- Ensure file path validation remains intact
- No new vulnerabilities introduced by removals
