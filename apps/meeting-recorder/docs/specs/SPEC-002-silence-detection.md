# SPEC-002: Silence Detection and Hallucination Prevention

**Created:** 2026-03-03
**Status:** Active
**Component:** `electron/main/ipc/audio-handlers.ts` (isSilent function)
**Related:** `electron/main/services/ai-prompts.ts` (transcription prompt)

## Problem Statement

During recording silence (user not speaking), the AI transcription hallucinates content — generating fabricated speech like "Uno dos tres probando" in Spanish even though the user was speaking English. The root cause is that background room noise passes the silence detection threshold, causing silent chunks to be sent to the AI, which then hallucinates speech from the noise.

## Evidence (from user session 1a57e94b)

Volume analysis of 3-second chunks from a real recording:

| Chunk | Time | Max Volume | Mean Volume | Content |
|-------|------|-----------|-------------|---------|
| 015 | 45-48s | -28.4 dB | -53.0 dB | Background noise (no speech) — SENT TO AI |
| 016 | 48-51s | -32.5 dB | -57.0 dB | Background noise (no speech) — SENT TO AI |
| 023 | 69-72s | -34.7 dB | -59.0 dB | Background noise (no speech) — SENT TO AI |
| 024 | 72-75s | -78.3 dB | -91.0 dB | True silence — would be caught at -50dB |
| 028 | 84-87s | -39.7 dB | -64.3 dB | Background noise (no speech) — SENT TO AI |

Current threshold: max_volume < -50 dB → silent. This catches only truly dead silence, missing all background noise chunks.

## Root Causes

1. **Threshold too generous**: -50 dB max volume threshold only catches near-total silence. Typical room background noise is -25 to -45 dB max, which passes the check.
2. **Using max volume instead of mean**: Max volume captures transient noise spikes (mouse clicks, fan bursts). Mean volume better represents sustained audio energy and correlates with speech presence.
3. **No speech-specific detection**: Even with better thresholds, volume alone can't distinguish speech from constant background noise at similar levels.

## Requirements

### REQ-1: Improved Silence Threshold

1. Use **mean volume** as the primary silence indicator (not max)
2. Default mean volume threshold: **-40 dB** (above this = likely has speech; below = likely noise/silence)
3. Use max volume as a secondary check: if max < -45 dB, always classify as silent regardless of mean
4. The thresholds should be defined as named constants, not magic numbers

### REQ-2: Combined Silence Detection Algorithm

```
isSilent(chunk) =
  (maxVolume < MAX_SILENCE_THRESHOLD_DB)    // -45 dB: no peaks at all → definitely silent
  OR
  (meanVolume < MEAN_SILENCE_THRESHOLD_DB)  // -40 dB: low average energy → no sustained speech
```

This catches:
- True silence (max < -45 dB): chunks 024, 030, 032
- Background noise without speech (mean < -40 dB): chunks 015, 016, 023, 028, 029
- Still allows through: chunks with actual speech (mean > -30 dB typically)

### REQ-3: AI Prompt Reinforcement

1. The transcription prompt MUST explicitly state: "If the audio contains only noise, silence, or unintelligible sounds with no clear human speech, you MUST return an empty segments array with no text."
2. Add language consistency check: "The transcript language should be consistent with the language setting. Do not switch languages unless the speaker clearly does."

### REQ-4: Empty Response Handling

1. If the AI returns segments where ALL text is empty or whitespace, treat the chunk as having no speech
2. If the AI returns a single very short segment (< 3 words) with low confidence for a 3-second chunk, consider it suspicious and log it

## Acceptance Criteria

- [ ] AC-1: Background noise chunks (mean < -40 dB) are classified as silent and skipped
- [ ] AC-2: True silence chunks (max < -45 dB) are classified as silent and skipped
- [ ] AC-3: Speech chunks (mean > -30 dB) are correctly passed through for transcription
- [ ] AC-4: Silence thresholds are defined as named constants
- [ ] AC-5: AI prompt includes explicit instruction about silence/noise handling
- [ ] AC-6: No hallucinated transcription during silence gaps
- [ ] AC-7: Unit tests verify silence detection at various volume levels

## Test Requirements

### Unit Tests (isSilent function)
1. Returns true when max volume is below -45 dB (true silence)
2. Returns true when mean volume is below -40 dB (background noise)
3. Returns false when both max > -45 dB AND mean > -40 dB (speech present)
4. Returns false when ffmpeg analysis fails (fail open)
5. Correctly parses `-inf` mean volume
6. Returns true for edge case: max = -44.9 dB, mean = -39.5 dB (both barely below)

### Integration Verification
7. Replay user's session 1a57e94b chunks through silence detection — chunks 15, 16, 23, 28, 29 should be classified as silent
