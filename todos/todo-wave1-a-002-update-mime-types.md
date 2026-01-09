# Task: Update MIME Type Mapping in transcription.ts

## Track: A (Audio Playback Fix)
## Priority: HIGH - CRITICAL
## Dependencies: todo-wave1-a-001-remove-wav-headers.md

## Current State
The `transcription.ts` file (line 127) incorrectly maps `.hda` files to `audio/wav`:
```typescript
'.hda': 'audio/wav' // WRONG - treats MPEG as WAV
```

**Verified Fact**: Gem

ini API supports both MP3 and WAV formats officially.

## What's Missing
Correct MIME type mapping for HDA files to reflect their actual MPEG MP3 format.

## Implementation Notes
- HDA files are MPEG MP3, not WAV (verified forensically)
- Gemini API officially supports `audio/mp3` MIME type
- This ensures transcription service sends correct format information
- Cross-platform compatible solution

## Acceptance Criteria
- [ ] Update `.hda` mapping from `'audio/wav'` to `'audio/mp3'` in line 127
- [ ] Verify `.wav` mapping remains `'audio/wav'` (correct)
- [ ] Verify `.mp3` mapping remains `'audio/mp3'` (correct)
- [ ] Test transcription with HDA files works correctly

## Files to Modify
- `apps/electron/electron/main/services/transcription.ts` (line 127)

## Related Specs
- See plan: Cross-Platform Solution section
- Gemini API documentation: https://ai.google.dev/gemini-api/docs/audio

## Security Considerations
- No security implications (MIME type change only)
- Validates actual file format matches declared MIME type
