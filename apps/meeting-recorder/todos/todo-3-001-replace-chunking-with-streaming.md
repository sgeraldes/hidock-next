# Task: Replace chunk-based processing with true streaming

**Phase**: 3
**Priority**: High
**Estimated Complexity**: High

## Context
Eliminate 3-second chunk delay by streaming audio directly to Chirp 3. Design doc section "Phase 3: Streaming Optimization".

## Current State
Audio is buffered in 3-second chunks before processing.

## What's Missing/Needed
Modify processAudioChunk() to:
- Send audio to Chirp 3 stream immediately on arrival
- Remove buffering logic
- Process interim results as they stream
- Reduce end-to-end latency

## Dependencies
- [ ] All Phase 2 tasks completed

## Acceptance Criteria
- [ ] Audio sent to Chirp 3 immediately on arrival
- [ ] No 3-second buffering delay
- [ ] Interim results processed in real-time
- [ ] Latency improves from ~3s to <500ms
- [ ] No audio data loss
- [ ] Unit tests verify streaming behavior

## Files to Create/Modify
- `electron/main/services/transcription-pipeline.ts` - Remove chunking
- `src/hooks/useAudioCapture.ts` - May need streaming adjustments
- `electron/main/__tests__/transcription-streaming.test.ts` - NEW

## Testing Requirements
Measure latency before/after, verify <500ms target
