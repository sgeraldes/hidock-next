# Task: Modify transcription-pipeline.ts for two-stage processing

**Phase**: 2
**Priority**: High
**Estimated Complexity**: High

## Context
Update pipeline to support dual-path: Chirp 3 + Gemini vs Gemini multimodal fallback. Design doc section "Two-Stage Pipeline".

## Current State
Pipeline only uses Gemini multimodal (processAudioChunk).

## What's Missing/Needed
Update processAudioChunk() to:
- Check if Chirp 3 is enabled (settings)
- Route to Chirp 3 if available
- Fall back to Gemini multimodal if not
- Handle results from both paths

## Dependencies
- [ ] Task: Create chirp3-provider.ts
- [ ] Task: Implement Chirp 3 streaming
- [ ] Task: Add analyzeTranscript method

## Acceptance Criteria
- [ ] processAudioChunk checks Chirp 3 availability
- [ ] Routes to chirp3Provider.writeAudioChunk() if enabled
- [ ] Falls back to aiProvider.transcribeAudio() if disabled
- [ ] Both code paths execute correctly
- [ ] No breaking changes to existing flow
- [ ] Unit tests cover both paths

## Files to Create/Modify
- `electron/main/services/transcription-pipeline.ts` - Update processAudioChunk
- `electron/main/services/__tests__/transcription-pipeline.test.ts` - Test dual paths

## Testing Requirements
Test both Chirp 3 path and fallback path independently
