# Task: Implement handleChirp3Result callback in transcription-pipeline.ts

**Phase**: 2
**Priority**: High
**Estimated Complexity**: Medium

## Context
Handle results from Chirp 3 stream and trigger Stage 2 (Gemini analysis). Design doc specifies this as glue between stages.

## Current State
Pipeline doesn't have Chirp 3 result handling.

## What's Missing/Needed
Add method:
- Takes raw transcript + word data from Chirp 3
- Calls aiProvider.analyzeTranscript() for Stage 2
- Stores and broadcasts results
- Maintains speaker continuity

## Dependencies
- [ ] Task: Modify transcription-pipeline for two-stage
- [ ] Task: Add analyzeTranscript method

## Acceptance Criteria
- [ ] handleChirp3Result method exists
- [ ] Takes rawTranscript and Word[] as parameters
- [ ] Calls aiProvider.analyzeTranscript with context
- [ ] Stores segments in database
- [ ] Broadcasts results to UI
- [ ] Maintains knownSpeakers set
- [ ] Unit tests verify flow

## Files to Create/Modify
- `electron/main/services/transcription-pipeline.ts` - Add handleChirp3Result
- `electron/main/services/__tests__/transcription-pipeline-chirp3.test.ts` - NEW

## Testing Requirements
Mock Chirp 3 results and verify Stage 2 is triggered correctly
